import type { GraphDraftPreview } from "../preflight/types.js";
import { pointer } from "../registry/json.js";
import type { ManagedCheck, ManagedDraft } from "../managed/types.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import { previewDraft } from "../preflight/preview.js";
import type { AgentEngine } from "./types.js";
/** Render relationships using edit coordinates; never infer reset eligibility from tombstones. */
export function previewView(preview: GraphDraftPreview) {
  const outgoing = new Map<string, Record<string, string[]>>();
  for (const edge of Object.values(preview.edges)) {
    const relations = outgoing.get(edge.from) ?? {};
    (relations[`/${pointer(edge.relationType)}`] ??= []).push(edge.to);
    outgoing.set(edge.from, relations);
  }
  return structuredClone({
    id: preview.id, version: preview.version, type: preview.type, typeVersion: preview.typeVersion,
    definitionDigest: preview.definitionDigest,
    nodes: Object.fromEntries(Object.entries(preview.nodes).map(([ref, node]) => {
      const relations = outgoing.get(ref) ?? {};
      return [ref, { id: node.id, nodeType: node.nodeType, fields: node.fields, relations }];
    })),
    ...(preview.tombstones.nodes.length ? { removedNodeRefs: preview.tombstones.nodes,
      removedNodeHint: "These refs are absent. Reset can restore a baseline node only when required endpoints exist and lifecycle rules allow it; removal alone does not prove restorability. Use preview to validate a proposed reset." } : {})
  });
}
export function contextView(draft: ManagedDraft, registry: DefinitionRegistry) {
  return { draftId: draft.id, version: draft.version, status: draft.status, currentRunId: draft.currentRunId, preview: previewView(previewDraft(draft, registry)) };
}
export function checkView(check: ManagedCheck) {
  return structuredClone({ formatVersion: check.formatVersion, scope: check.scope, checkId: check.checkId, draftId: check.draftId, version: check.version,
    status: check.status, preview: previewView(check.preview), diagnostics: check.diagnostics,
    ...(check.certificate ? { certificate: check.certificate } : {}),
    ...(check.pendingRules ? { pendingRules: check.pendingRules } : {}),
    ...(check.executionHint ? { executionHint: check.executionHint } : {}),
    ...(check.updatePreview ? { update: check.updatePreview.slots.map(s => ({ nodeId: s.nodeId, kind: s.kind, changes: s.changes })) } : {}) });
}
export function publicationView(result: Awaited<ReturnType<AgentEngine["publish"]>>, draftId: string) {
  return structuredClone({ draftId, runId: result.id, kind: result.kind, state: result.state, version: result.version,
    currentRunId: result.currentRunId, isCurrentIntent: result.isCurrentIntent, previewVersion: result.previewVersion,
    preview: previewView(result.preview), diagnostics: result.diagnostics,
    ...("steps" in result ? { steps: result.steps.map(s => ({ stepId: s.id, nodeId: s.effect.nodeId, status: s.status })) } : {}),
    ...("check" in result && result.check ? { check: checkView(result.check) } : {}) });
}
