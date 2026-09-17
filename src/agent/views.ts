import type { ManagedCheck, ManagedDraft } from "../managed/types.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import { previewDraft } from "../preflight/preview.js";
import type { AgentEngine } from "./types.js";
export function contextView(draft: ManagedDraft, registry: DefinitionRegistry) {
  return { draftId: draft.id, version: draft.version, status: draft.status, currentRunId: draft.currentRunId, preview: previewDraft(draft, registry) };
}
export function checkView(check: ManagedCheck) {
  return structuredClone({ formatVersion: check.formatVersion, scope: check.scope, checkId: check.checkId, draftId: check.draftId, version: check.version,
    status: check.status, preview: check.preview, diagnostics: check.diagnostics,
    ...(check.certificate ? { certificate: check.certificate } : {}),
    ...(check.pendingRules ? { pendingRules: check.pendingRules } : {}),
    ...(check.executionHint ? { executionHint: check.executionHint } : {}),
    ...(check.updatePreview ? { update: check.updatePreview.slots.map(s => ({ nodeId: s.nodeId, kind: s.kind, changes: s.changes })) } : {}) });
}
export function publicationView(result: Awaited<ReturnType<AgentEngine["publish"]>>, draftId: string) {
  return structuredClone({ draftId, runId: result.id, kind: result.kind, state: result.state, version: result.version,
    currentRunId: result.currentRunId, isCurrentIntent: result.isCurrentIntent, previewVersion: result.previewVersion,
    preview: result.preview, diagnostics: result.diagnostics,
    ...("steps" in result ? { steps: result.steps.map(s => ({ stepId: s.id, nodeId: s.effect.nodeId, status: s.status })) } : {}),
    ...("check" in result && result.check ? { check: checkView(result.check) } : {}) });
}
