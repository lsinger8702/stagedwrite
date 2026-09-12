import { createStagedWrite, defineDraftType } from "../src/index.js";
import { MockAdapter } from "../src/adapters/mock.js";
import type { GraphExecutor, Step } from "../src/index.js";

const definition = defineDraftType({ id: "example.graph-execution", version: "1", nodeTypes: {
  campaign: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] }
}, relationTypes: {} });
const selector = { type: definition.id, typeVersion: definition.version };
const remote = new MockAdapter("commit_then_timeout");
const executor: GraphExecutor = { ...selector, id: "example.mock", version: "1", target: "mock:local",
  plan: (draft): Step[] => {
    const name = draft.nodes.campaign!.fields.name;
    return [{ id: "create_campaign", payload: { name: name?.kind === "value" ? name.value : null } }, { id: "record_change", payload: {} }];
  },
  apply: (step, key) => remote.apply(step, key), reconcile: (step, key) => remote.reconcile(step, key)
};
const engine = createStagedWrite({ definitions: [definition], mode: "executable", executors: [executor] });
let draft = engine.create(selector);
draft = engine.edit(draft.id, 0, [{ op: "node.add", id: "campaign", nodeType: "campaign" }]);
console.log("1. Graph preflight blocks missing intent:", engine.preflight(draft.id).status);
draft = engine.edit(draft.id, draft.version, [{ op: "set", nodeId: "campaign", path: "/name", value: "Synthetic campaign" }]);
const check = engine.preflight(draft.id);
console.log("2. Fixed graph plan:", check.execution);
const partial = await engine.publish(draft.id, check.certificate!);
console.log("3. Response lost after effect:", partial.state);
const finished = await engine.resume(partial.id);
console.log("4. Reconciled:", finished.state, "effects:", remote.effectCount, "apply calls:", remote.applyCalls);
console.log("In-memory graph execution only. Remote effects are simulated; process restart is not yet supported.");
