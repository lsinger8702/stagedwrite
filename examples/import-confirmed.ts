import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite } from "../src/index.js";
import type { GraphExecutor, Step } from "../src/index.js";
const dir = mkdtempSync(join(tmpdir(), "sw-import-demo-")), path = join(dir, "state.sqlite");
const selector = { type: "example.import", typeVersion: "1" };
const definition = { id: selector.type, version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} };
const calls: string[] = [];
const executor: GraphExecutor = { ...selector, id: "mock.import", version: "1", target: "mock:local",
  plan: (d): Step[] => Object.keys(d.nodes).map(id => ({ id, payload: {}, effect: { kind: "create", nodeId: id }, ...(id !== "project" ? { dependsOn: ["project"], inputRefs: { projectId: "project" } } : {}) })),
  apply: async step => { calls.push(step.id); if (step.id === "original-task") return { kind: "unknown", reason: "Simulated lost response" };
    if (step.id !== "project") assert.equal(step.payload.projectId, "remote-project");
    return { kind: "applied", remoteRef: `remote-${step.id}` };
  }, reconcile: { unsupported: "Offline example" }
};
const open = () => createStagedWrite({ definitions: [definition], mode: "executable", executors: [executor], storage: { kind: "sqlite", path } });
let engine = open();
try {
  const d = engine.create(selector);
  engine.edit(d.id, 0, [{ op: "node.add", id: "project", nodeType: "item" }, { op: "node.add", id: "original-task", nodeType: "item" }]);
  const unknown = await engine.publish(d.id, engine.preflight(d.id).certificate!);
  const closed = engine.adjudicate(unknown.id, "original-task", { requestId: "close", expectedSequence: unknown.events.length, actor: "demo", evidence: "inconclusive-check", note: "Leave original request unresolved", decision: { kind: "close_unresolved" } });
  const command = { requestId: "independent-work", expectedSequence: closed.events.length, actor: "demo", evidence: "confirmed-project-receipt", purpose: "Create a separate follow-up task", independentWork: true as const };
  const imported = engine.importConfirmed(closed.id, command);
  assert.deepEqual(Object.keys(imported.nodes), ["project"]);
  engine.close(); engine = open();
  assert.equal(engine.importConfirmed(closed.id, command).id, imported.id);
  engine.edit(imported.id, 0, [{ op: "node.add", id: "follow-up", nodeType: "item" }]);
  const result = await engine.publish(imported.id, engine.preflight(imported.id).certificate!);
  assert.deepEqual(result.steps.map(s => s.status), ["reused", "applied"]);
  assert.deepEqual(calls, ["project", "original-task", "follow-up"]);
  assert.deepEqual(engine.getRun(closed.id), closed);
  console.log("Confirmed project reused after reopen:", result.state);
  console.log("Remote calls:", calls);
  console.log("Original task remains unknown in the closed source run.");
} finally { engine.close(); rmSync(dir, { recursive: true, force: true }); }
