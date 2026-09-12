import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite } from "../src/index.js";
import type { GraphExecutor } from "../src/index.js";
const directory = mkdtempSync(join(tmpdir(), "sw-durable-demo-"));
const path = join(directory, "data.sqlite");
const selector = { type: "example.durable", typeVersion: "1" };
const definition = { id: selector.type, version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} };
let rejectTask = true;
const effects: string[] = [];
const executor: GraphExecutor = { ...selector, id: "mock.durable", version: "1", target: "mock:local",
  plan: () => [ { id: "project", payload: {}, effect: { kind: "create", nodeId: "project" } },
    { id: "task", payload: {}, effect: { kind: "create", nodeId: "task" }, dependsOn: ["project"], inputRefs: { projectId: "project" } } ],
  apply: async step => {
    if (step.id === "task") { assert.equal(step.payload.projectId, "remote-project"); if (rejectTask) return { kind: "not_applied", reason: "Synthetic refusal" }; }
    effects.push(step.id); return { kind: "applied", remoteRef: `remote-${step.id}` };
  }, reconcile: { unsupported: "Offline fixture" }
};
const open = () => createStagedWrite({ definitions: [definition], mode: "executable", executors: [executor], storage: { kind: "sqlite", path } });
let engine = open();
try {
  const draft = engine.create(selector);
  engine.edit(draft.id, 0, [{ op: "node.add", id: "project", nodeType: "item" }, { op: "node.add", id: "task", nodeType: "item" }]);
  const check = engine.preflight(draft.id); engine.close(); engine = open();
  const failed = await engine.publish(draft.id, check.certificate!);
  console.log("1. Stored plan executed after reopen:", failed.state);
  engine.close(); engine = open();
  assert.deepEqual(engine.getRun(engine.listRunIds()[0]!), failed);
  const next = engine.continueFrom(failed.id); engine.close(); engine = open();
  assert.equal(engine.continueFrom(failed.id).id, next.id);
  rejectTask = false;
  const completed = await engine.publish(next.id, engine.preflight(next.id).certificate!);
  assert.deepEqual(effects, ["project", "task"]);
  engine.close(); engine = open();
  assert.deepEqual(engine.getRun(completed.id), completed);
  console.log("2. Persisted partial receipts reused:", completed.steps.map(s => s.status));
  console.log("3. Reopened completed run:", completed.state, "effects:", effects);
  console.log("M5 persists execution facts. Advancing pre-existing unfinished runs after restart remains disabled until M6.");
} finally { engine.close(); rmSync(directory, { recursive: true, force: true }); }
