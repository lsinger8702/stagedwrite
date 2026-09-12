import { createStagedWrite, defineDraftType } from "../src/index.js";
import type { GraphRule } from "../src/index.js";

const definition = defineDraftType({
  id: "example.budget", version: "1",
  nodeTypes: { campaign: {
    valueSchema: { type: "object", properties: { budget: { type: "number", minimum: 0 } }, additionalProperties: false },
    requiredAtPublish: ["budget"]
  } }, relationTypes: {}
});
const budgetRule: GraphRule = {
  id: "example.budget-limit", version: "1", type: definition.id, typeVersion: definition.version,
  check: draft => {
    const budget = draft.nodes.campaign?.fields.budget;
    return budget?.kind === "value" && Number(budget.value) > 10 ? [{
      code: "budget.limit", path: "/nodes/campaign/fields/budget", message: "Example policy caps the budget at 10.",
      resolution: { kind: "ops", ops: [{ op: "set", nodeId: "campaign", path: "/budget", value: 10 }] }
    }] : [];
  }
};
const engine = createStagedWrite({ definitions: [definition], rules: [budgetRule] });
let draft = engine.create({ type: definition.id, typeVersion: definition.version });
draft = engine.edit(draft.id, 0, [{ op: "node.add", id: "campaign", nodeType: "campaign" }]);
console.log("1. Missing intent:", engine.preflight(draft.id).diagnostics);
draft = engine.edit(draft.id, draft.version, [{ op: "set", nodeId: "campaign", path: "/budget", value: 20 }]);
const blocked = engine.preflight(draft.id);
console.log("2. Policy diagnostic:", blocked.status, blocked.diagnostics);
const repair = blocked.diagnostics[0]?.resolution;
if (repair?.kind === "ops") {
  console.log("3. Demo author explicitly chooses the lower budget; the engine did not apply it automatically.");
  draft = engine.edit(draft.id, blocked.version, repair.ops);
}
try { engine.getCheck(draft.id, blocked.checkId); }
catch (error) { console.log("4. Old check rejected:", (error as Error).message); }
const passed = engine.preflight(draft.id);
console.log("5. Rechecked:", passed.status, "scope:", passed.scope);
console.log("Draft checks only. No publication permission, remote requests or durable execution.");
