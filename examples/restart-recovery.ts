import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLegacyStagedWrite } from "../src/index.js";
import type { GraphExecutor, Step } from "../src/index.js";

const childMode = process.argv[2] === "child";
const directory = childMode ? process.argv[3]! : mkdtempSync(join(tmpdir(), "sw-restart-demo-"));
const path = join(directory, "state.sqlite"), ledger = join(directory, "receipt.json");
const selector = { type: "example.restart", typeVersion: "1" };
const definition = { id: selector.type, version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} };
const executor: GraphExecutor = { ...selector, id: "mock.restart", version: "1", target: "mock:local",
  plan: (): Step[] => [{ id: "project", payload: { title: "Example" } }, { id: "task", payload: {}, dependsOn: ["project"], inputRefs: { projectId: "project" } }],
  apply: async (step, key) => {
    if (step.id === "project") {
      assert.ok(childMode, "Recovered project must not be created twice");
      writeFileSync(ledger, JSON.stringify({ key, payload: step.payload, remoteRef: "remote-project" }));
      process.exit(19); // Simulated effect is durable; no response reaches the runtime.
    }
    assert.equal(step.payload.projectId, "remote-project");
    return { kind: "applied", remoteRef: "remote-task" };
  },
  reconcile: async (step, key) => {
    const receipt = JSON.parse(readFileSync(ledger, "utf8"));
    assert.equal(key, receipt.key); assert.deepEqual(step.payload, receipt.payload);
    return { kind: "applied", remoteRef: receipt.remoteRef };
  }
};
const open = () => createLegacyStagedWrite({ definitions: [definition], mode: "executable", storage: { kind: "sqlite", path }, executors: [executor] });
if (childMode) {
  const engine = open(), draft = engine.create(selector);
  engine.edit(draft.id, 0, [{ op: "node.add", id: "project", nodeType: "item" }]);
  await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
} else {
  try {
    const child = spawnSync(process.execPath, [process.argv[1]!, "child", directory], { encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 19, child.stderr);
    const engine = open();
    try {
      const interrupted = engine.getRun(engine.listRunIds()[0]!);
      console.log("1. Child exited before saving its receipt:", interrupted.steps[0]!.status);
      const recovered = engine.recover(interrupted.id, { requestId: "demo-recovery", expectedSequence: interrupted.events.length, actor: "demo", reason: "Child exited" });
      console.log("2. Explicit claim, no remote dispatch:", recovered.state);
      const done = await engine.resume(recovered.id);
      assert.equal(done.state, "published");
      assert.equal(done.events.filter(e => e.stepId === "project" && e.kind === "dispatching").length, 1);
      console.log("3. Original receipt reconciled; child used recovered parent ID:", done.state);
    } finally { engine.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
