import type { GraphDraft } from "../graph/types.js";
import type { Run, Step, ReusedReceipt } from "../types.js";
import { definitionDigest, type Json } from "../registry/json.js";
const digest = (v: unknown) => definitionDigest(v as Json);
const intent = (s: Step): Step => ({ id: s.id, payload: s.payload,
  ...(s.dependsOn ? { dependsOn: s.dependsOn } : {}), ...(s.inputRefs ? { inputRefs: s.inputRefs } : {}),
  ...(s.effect ? { effect: s.effect } : {}) });

export function requireCreateMapping(plan: readonly Step[], draft: GraphDraft): void {
  if (plan.some(s => ["__proto__", "constructor", "prototype"].includes(s.id))) throw new Error("CREATE_MAPPING_REQUIRED");
  const mapped = plan.map(s => s.effect?.nodeId);
  if (mapped.some(id => !id || !Object.hasOwn(draft.nodes, id)) || new Set(mapped).size !== plan.length ||
      mapped.length !== Object.keys(draft.nodes).length) throw new Error("CREATE_MAPPING_REQUIRED");
}
export function continuationReceipts(run: Run, draft: GraphDraft): Record<string, ReusedReceipt> {
  if (run.state !== "failed" || !run.steps.some(s => s.status === "failed") ||
      !run.steps.some(s => s.status === "applied" || s.status === "reused") ||
      run.steps.some(s => !["applied", "reused", "failed", "skipped"].includes(s.status))) throw new Error("PARTIAL_FAILURE_REQUIRED");
  requireCreateMapping(run.steps, draft);
  const receipts: Record<string, ReusedReceipt> = {};
  for (const step of run.steps) if (step.status === "applied" || step.status === "reused") {
    if (!step.remoteRef || !step.resolvedPayload) throw new Error("RECEIPT_REQUIRED");
    receipts[step.id] = { nodeId: step.effect!.nodeId, sourceRunId: run.id, sourceStepId: step.id, remoteRef: step.remoteRef, resolvedPayload: structuredClone(step.resolvedPayload) };
  }
  return receipts;
}
export function validateContinuation(plan: Step[], draft: GraphDraft, source: Run, original: GraphDraft): void {
  requireCreateMapping(plan, draft);
  for (const [id, receipt] of Object.entries((draft.continuation ?? draft.imported)!.receipts)) {
    const old = source.steps.find(s => s.id === id)!;
    const next = plan.find(s => s.id === id);
    if (!next || digest(intent(old)) !== digest(intent(next)) ||
        digest(original.nodes[old.effect!.nodeId]) !== digest(draft.nodes[old.effect!.nodeId])) throw new Error("REUSED_INTENT_CHANGED");
    // Every dependency of a reused step must itself be reused, with the same result.
    if ((next.dependsOn ?? []).some(dep => !Object.hasOwn((draft.continuation ?? draft.imported)!.receipts, dep))) throw new Error("REUSED_DEPENDENCY_CHANGED");
    if (receipt.remoteRef !== old.remoteRef) throw new Error("RECEIPT_MISMATCH");
  }
}
