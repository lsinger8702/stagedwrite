import assert from "node:assert/strict";
import { createStagedWrite, defineDraftType } from "../src/index.js";
import type { GraphExecutor, Step } from "../src/index.js";

const node = { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] } as const;
const definition = defineDraftType({ id: "example.dependencies", version: "1",
  nodeTypes: { campaign: node, adset: node }, relationTypes: { contains: { from: ["campaign"], to: ["adset"] } } });
const selector = { type: definition.id, typeVersion: definition.version };
let rejectChild = true;
const created: string[] = [];
const executor: GraphExecutor = { ...selector, id: "example.dependencies", version: "1", target: "mock:local",
  plan: draft => {
    const edges = Object.values(draft.edges);
    if (edges.length !== 1 || Object.keys(draft.nodes).length !== 2) throw new Error("EXPECTED_PARENT_CHILD_PAIR");
    const edge = edges[0]!;
    const name = (id: string) => { const field = draft.nodes[id]!.fields.name; return field?.kind === "value" ? field.value : null; };
    // This executor explicitly maps its business relation to execution dependencies.
    return [
      { id: edge.from, effect: { kind: "create", nodeId: edge.from }, payload: { name: name(edge.from) } },
      { id: edge.to, effect: { kind: "create", nodeId: edge.to }, payload: { name: name(edge.to) }, dependsOn: [edge.from], inputRefs: { campaignId: edge.from } }
    ];
  },
  apply: async (step: Step) => {
    if (step.id === "campaign") {
      
      created.push(step.id);
      return { kind: "applied", remoteRef: "remote_campaign" };
    }
    assert.equal(step.payload.campaignId, "remote_campaign");
    if (rejectChild) return { kind: "not_applied", reason: "Synthetic child name refusal" };
    created.push(step.id);
    return { kind: "unknown", reason: "Synthetic response lost after creating adset" };
  },
  reconcile: async step => {
    assert.equal(step.payload.campaignId, "remote_campaign");
    return { kind: "applied", remoteRef: "remote_adset" };
  }
};
const engine = createStagedWrite({ definitions: [definition], mode: "executable", executors: [executor] });
const draft = engine.create(selector);
engine.edit(draft.id, 0, [
  { op: "node.add", id: "campaign", nodeType: "campaign" }, { op: "set", nodeId: "campaign", path: "/name", value: "Rejected name" },
  { op: "node.add", id: "adset", nodeType: "adset" }, { op: "set", nodeId: "adset", path: "/name", value: "Synthetic adset" },
  { op: "edge.add", id: "contains", relationType: "contains", from: "campaign", to: "adset" }
]);
const failed = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
assert.deepEqual(created, ["campaign"]);
console.log("1. Parent applied, child refused:", failed.steps.map(s => s.status));
const revised = engine.continueFrom(failed.id);
engine.edit(revised.id, 0, [{ op: "set", nodeId: "adset", path: "/name", value: "Accepted child name" }]);
rejectChild = false;
const partial = await engine.publish(revised.id, engine.preflight(revised.id).certificate!);
assert.equal(partial.state, "unknown");
console.log("2. Child received parent ID:", partial.steps[1]?.resolvedPayload);
const complete = await engine.resume(partial.id);
assert.equal(complete.state, "published");
assert.equal(complete.steps[0]?.status, "reused");
assert.equal(complete.steps[0]?.reusedFrom?.sourceRunId, failed.id);
assert.deepEqual(created, ["campaign", "adset"]);
assert.equal(engine.getRun(failed.id).state, "failed");
console.log("3. Recovered without duplicate creation:", complete.state, created);
console.log("Offline simulation only; no remote requests or process-restart guarantee.");
