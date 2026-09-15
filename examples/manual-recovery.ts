import assert from "node:assert/strict";
import { createLegacyStagedWrite } from "../src/index.js";
import type { GraphExecutor } from "../src/index.js";

const selector = { type: "example.manual", typeVersion: "1" };
const calls: string[] = [];
const executor: GraphExecutor = { ...selector, id: "example.manual", version: "1", target: "mock:local",
  plan: () => [{ id: "parent", payload: {} }, { id: "child", payload: {}, dependsOn: ["parent"], inputRefs: { parentId: "parent" } }],
  apply: async step => {
    calls.push(step.id);
    if (step.id === "parent") return { kind: "unknown", reason: "Synthetic committed effect with lost response" };
    assert.equal(step.payload.parentId, "remote-parent");
    return { kind: "applied", remoteRef: "remote-child" };
  }, reconcile: { unsupported: "This simulated service has no lookup API" }
};
const engine = createLegacyStagedWrite({ mode: "executable", executors: [executor], definitions: [{ id: selector.type, version: "1",
  nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} }] });
const draft = engine.create(selector);
engine.edit(draft.id, 0, [{ op: "node.add", id: "one", nodeType: "item" }]);
const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
const unknown = await engine.resume(run.id);
console.log("1. Automatic recovery unavailable:", unknown.state);
// Fictional evidence for an offline example. Real hosts must authenticate the actor
// and verify evidence for this exact request/target before calling this API.
const decided = engine.adjudicate(run.id, "parent", {
  requestId: "synthetic-review-1", expectedSequence: unknown.events.length,
  actor: "example-operator", evidence: "synthetic-receipt:parent", note: "Simulated independent verification of the exact parent creation",
  decision: { kind: "applied", remoteRef: "remote-parent" }
});
assert.deepEqual(calls, ["parent"]);
console.log("2. Recorded without dispatch:", decided.state, decided.events.at(-1)?.kind);
const finished = await engine.resume(run.id);
assert.equal(finished.state, "published");
assert.deepEqual(calls, ["parent", "child"]);
console.log("3. Explicit resume created only the child:", finished.state, calls);
console.log("Offline simulation; evidence and actor are fictional. No real remote requests.");
