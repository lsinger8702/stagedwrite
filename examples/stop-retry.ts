import assert from "node:assert/strict";
import { createStagedWrite } from "../src/index.js";
import type { GraphExecutor } from "../src/index.js";
const selector = { type: "example.stop", typeVersion: "1" };
let limited = true, calls = 0;
const executor: GraphExecutor = { ...selector, id: "example.stop", version: "1", target: "mock:local",
  plan: () => [{ id: "create", payload: {} }],
  apply: async () => { calls++; return limited ? { kind: "not_applied", retryable: true, reason: "Synthetic quota exhausted" } : { kind: "applied", remoteRef: "remote-object" }; },
  reconcile: { unsupported: "Offline example" }
};
const engine = createStagedWrite({ definitions: [{ id: selector.type, version: "1", nodeTypes: { item: {
  valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} }], mode: "executable", executors: [executor] });
const draft = engine.create(selector);
engine.edit(draft.id, 0, [{ op: "node.add", id: "one", nodeType: "item" }]);
let run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
run = await engine.resume(run.id);
const stopped = engine.stopRetry(run.id, { requestId: "stop-budget-1", expectedSequence: run.events.length,
  actor: "example-operator", reason: "Two attempts exhausted the example retry budget" });
assert.equal(stopped.state, "failed");
await engine.resume(run.id); assert.equal(calls, 2);
console.log("1. Stopped without another request:", stopped.state, "calls:", calls);
console.log("2. Recorded decision:", stopped.events.at(-1));
const revised = engine.revise(run.id);
limited = false;
const finished = await engine.publish(revised.id, engine.preflight(revised.id).certificate!);
assert.equal(finished.state, "published");
assert.notEqual(finished.steps[0]?.key, stopped.steps[0]?.key);
console.log("3. New revision and certificate:", finished.state);
console.log("Offline simulation only; no remote requests.");
