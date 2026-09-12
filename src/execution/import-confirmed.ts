import { randomUUID } from "node:crypto";
import { isObject, jsonSnapshot } from "../registry/json.js";
import type { GraphDraft } from "../graph/types.js";
import type { ImportConfirmedRequest, ReusedReceipt, Run } from "../types.js";
import { requireCreateMapping } from "./continuation.js";

export function validateImportConfirmed(input: unknown): ImportConfirmedRequest {
  const issues: string[] = [];
  const v = jsonSnapshot(input, (_path, message) => issues.push(message));
  if (issues.length || !isObject(v) || Object.keys(v).length !== 6 || v.independentWork !== true ||
      !["requestId", "actor", "evidence", "purpose"].every(k => typeof v[k] === "string" && !!(v[k] as string).trim()) ||
      !Number.isSafeInteger(v.expectedSequence) || (v.expectedSequence as number) < 0) throw new Error("INVALID_IMPORT_REQUEST");
  return v as unknown as ImportConfirmedRequest;
}

/** Copy only confirmed, dependency-closed creates. Never copy unresolved intent. */
export function confirmedDraft(run: Run, original: GraphDraft, command: ImportConfirmedRequest): GraphDraft {
  if (!["published", "failed", "closed"].includes(run.state)) throw new Error("TERMINAL_SOURCE_REQUIRED");
  if (command.expectedSequence !== run.events.length) throw new Error("STALE_RUN");
  requireCreateMapping(run.steps, original);
  const confirmed = run.steps.filter(s => s.status === "applied" || s.status === "reused");
  if (!confirmed.length) throw new Error("CONFIRMED_RECEIPT_REQUIRED");
  const stepIds = new Set(confirmed.map(s => s.id));
  const nodeIds = new Set(confirmed.map(s => s.effect!.nodeId));
  const receipts: Record<string, ReusedReceipt> = {};
  for (const step of confirmed) {
    if (!step.remoteRef || !step.resolvedPayload) throw new Error("CONFIRMED_RECEIPT_REQUIRED");
    if ((step.dependsOn ?? []).some(id => !stepIds.has(id))) throw new Error("REUSED_DEPENDENCY_CHANGED");
    receipts[step.id] = { sourceRunId: run.id, sourceStepId: step.id, nodeId: step.effect!.nodeId,
      remoteRef: step.remoteRef, resolvedPayload: structuredClone(step.resolvedPayload) };
  }
  const nodes = Object.fromEntries(Object.entries(original.nodes).filter(([id]) => nodeIds.has(id)));
  const edges = Object.fromEntries(Object.entries(original.edges).filter(([, e]) => nodeIds.has(e.from) && nodeIds.has(e.to)));
  return structuredClone({ id: randomUUID(), version: 0, type: original.type, typeVersion: original.typeVersion,
    definitionDigest: original.definitionDigest, sourceRunId: run.id, imported: { sourceRunId: run.id, receipts, command },
    nodes, edges, tombstones: {
      nodes: [...new Set([...original.tombstones.nodes, ...Object.keys(original.nodes).filter(id => !nodeIds.has(id))])],
      edges: [...new Set([...original.tombstones.edges, ...Object.keys(original.edges).filter(id => !Object.hasOwn(edges, id))])]
    } });
}
