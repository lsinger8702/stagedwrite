import { definitionDigest, type Json } from "../registry/json.js";
import type { GraphDraft } from "../graph/types.js";
import type { Run, Step } from "../types.js";
export const same = (a: unknown, b: unknown) => definitionDigest(a as Json) === definitionDigest(b as Json);
export const declaration = (step: Step): Step => ({ id: step.id, payload: step.payload,
  ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}), ...(step.inputRefs ? { inputRefs: step.inputRefs } : {}), ...(step.effect ? { effect: step.effect } : {}) });
export function validateRepair(run: Run, previous: GraphDraft, draft: GraphDraft, plan: readonly Step[]): void {
  if (["published", "closed", "running"].includes(run.state) || run.steps.some(s => s.failureReason === "retry_stopped" || s.failureReason === "manual_no_effect")) throw new Error("DRAFT_SEALED");
  if (plan.length !== run.steps.length) throw new Error("REPAIR_TOPOLOGY_CHANGED");
  for (let i = 0; i < plan.length; i++) {
    const old = run.steps[i]!, next = plan[i]!;
    if (!same({ ...declaration(old), payload: {} }, { ...next, payload: {} })) throw new Error("REPAIR_TOPOLOGY_CHANGED");
    if (["applied", "reused"].includes(old.status)) {
      if (!same(declaration(old), next)) throw new Error("APPLIED_STEP_IMMUTABLE");
      if (old.effect && !same(previous.nodes[old.effect.nodeId], draft.nodes[old.effect.nodeId])) throw new Error("APPLIED_STEP_IMMUTABLE");
    }
  }
  if (!same(previous.edges, draft.edges) || !same(Object.keys(previous.nodes).sort(), Object.keys(draft.nodes).sort())) throw new Error("REPAIR_TOPOLOGY_CHANGED");
}
