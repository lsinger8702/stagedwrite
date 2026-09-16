import type { DefinitionRegistry } from "../registry/registry.js";
import type { DefinitionSelector } from "../registry/types.js";
import type { TopologyState, TopologySnapshot } from "../edit/evaluate-topology.js";
import type { EditBatch } from "../edit/protocol.js";
import type { EditPreview, EditReceipt } from "../edit/results.js";
import { registeredTopology } from "../edit/registered-topology.js";
import { protectIntentRepair, requireEditVersion, type RepairProtection } from "./edit-guards.js";

/** Required intent slice for managed candidate preparation; no alternate engine or storage API. */
export interface EditableDraft extends TopologyState, DefinitionSelector {
  id: string;
  version: number;
  definitionDigest: string;
  status: "pending" | "published";
  updatedAt: string;
}
/** Single candidate preparation path. The caller must load Run protection and baseline
 * from storage, and commit under the existing paired lease/store transaction. */
export function prepareEdit<D extends EditableDraft>(registry: DefinitionRegistry, draft: D, baseline: TopologySnapshot,
  expectedVersion: number, batch: EditBatch, context: {
    preview: boolean;
    run?: RepairProtection;
    nextId?: () => string;
    now: string;
  }): { candidate: D; receipt: EditReceipt; preview: EditPreview<D> } {
  if (draft.status === "published" || context.run?.state === "published") throw new Error("UPDATE_NOT_SUPPORTED");
  requireEditVersion(draft.version, expectedVersion);
  const result = registeredTopology(registry, draft).evaluate(draft, baseline, draft.definitionDigest, batch, { preview: context.preview, nextId: context.nextId });
  protectIntentRepair(result.candidate, context.run);
  // Spread only owned intent fields from the evaluator; Run pointers and immutable
  // baseline/artifact metadata on the managed snapshot are preserved verbatim.
  const candidate = { ...structuredClone(draft), ...result.candidate, version: draft.version + 1, status: "pending" as const, updatedAt: context.now };
  const receipt: EditReceipt = { draftId: draft.id, version: candidate.version, preflightRequired: true, changes: result.changes, createdRefs: result.createdRefs };
  return { candidate, receipt, preview: { preview: true, candidate: structuredClone(candidate), changes: structuredClone(result.changes), createdRefs: structuredClone(result.createdRefs) } };
}
