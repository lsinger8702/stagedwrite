import { canonicalJson, definitionDigest, type Json } from "../registry/json.js";
import { compileUpdate, validateUpdatePlan } from "./update-plan.js";
import type { Artifact, Attempt, ManagedRun, ManagedState, ResourceBinding } from "./types.js";
const same = (a: unknown, b: unknown) => canonicalJson(a as Json) === canonicalJson(b as Json);
const requireEvidence = (ok: unknown, code: string) => { if (!ok) throw new Error(code); };

/** Validate historical evidence against its own pinned facts, never today's latest values.
 * This proves stored consistency, not freshness or permission to dispatch. */
export function validateUpdateArtifact(state: ManagedState, artifact: Artifact): void {
    const checked = artifact.update;
    const isUpdate = artifact.plan.some(step => step.effect.kind !== "create");
    requireEvidence(!!checked === isUpdate, "UPDATE_ARTIFACT_EVIDENCE_REQUIRED");
    if (!checked) return;
    const c = checked.context, baseline = state.artifacts[c.basePublishedArtifactId];
    requireEvidence(baseline && baseline.id !== artifact.id && c.basePublishedArtifactId === artifact.draft.publishedArtifactId &&
        c.baseRunId === artifact.draft.currentRunId && (!c.baseRunId || state.runs[c.baseRunId]) &&
        c.draftId === artifact.draft.id && c.version === artifact.draft.version && c.resourceRevision === artifact.resourceRevision &&
        c.targetId === artifact.binding.target && c.targetId === artifact.draft.targetId, "UPDATE_ARTIFACT_CONTEXT_MISMATCH");
    const registration = (a: Artifact) => ({ definitionDigest: a.binding.definitionDigest, rulesDigest: a.binding.rulesDigest,
        executorId: a.binding.executorId, executorVersion: a.binding.executorVersion, target: a.binding.target });
    requireEvidence(artifact.binding.definitionDigest === artifact.draft.definitionDigest && same(registration(baseline!), registration(artifact)), "UPDATE_ARTIFACT_REGISTRATION_MISMATCH");
    requireEvidence(artifact.observations === undefined, "UPDATE_OBSERVATIONS_DUPLICATED");
    requireEvidence(artifact.intentDigest === definitionDigest({ graph: artifact.draft.graph, fieldIntents: artifact.draft.fieldIntents } as unknown as Json) &&
        artifact.binding.planDigest === definitionDigest(artifact.plan as unknown as Json), "UPDATE_ARTIFACT_DIGEST_MISMATCH");
    const latestFactByNode = Object.fromEntries(checked.slots.map(slot => [slot.nodeId, slot.factId]));
    // History can have newer Runs (including unknown ones) and newer facts now.
    // Reconstruct ONLY the old compilation's evidence view, without claiming old
    // requests are currently resolved. Live execution uses the separate readback guard.
    const view = { ...state, draft: artifact.draft, resourceRevision: artifact.resourceRevision, latestFactByNode, runs: {} };
    const rebuilt = compileUpdate(view, c.projections, c.observations);
    requireEvidence(rebuilt.status === "passed" && same(rebuilt, checked), "UPDATE_ARTIFACT_COMPILATION_MISMATCH");
    validateUpdatePlan(artifact.plan, checked, view);
}

/** Builds the original immutable request from a pinned artifact. No I/O or Attempt creation. */
export function updateRequest(artifact: Artifact, stepId: string, bindings: Record<string, ResourceBinding>): Attempt["request"] {
    const planned = artifact.plan.find(step => step.id === stepId);
    requireEvidence(artifact.update && planned?.effect.kind === "update", "UPDATE_REQUEST_PLAN_MISMATCH");
    const step = structuredClone(planned!);
    const slot = artifact.update!.slots.find(slot => slot.nodeId === step.effect.nodeId);
    requireEvidence(slot?.kind === "update", "UPDATE_REQUEST_PLAN_MISMATCH");
    for (const [field, depId] of Object.entries(step.inputRefs ?? {})) {
        const dep = artifact.plan.find(item => item.id === depId);
        const binding = dep && bindings[dep.effect.nodeId];
        requireEvidence(binding && binding.targetId === artifact.binding.target, "UPDATE_REQUEST_DEPENDENCY_MISSING");
        step.payload[field] = binding!.remoteId;
    }
    return { step, target: artifact.binding.target, executorId: artifact.binding.executorId, executorVersion: artifact.binding.executorVersion,
        update: { artifactId: artifact.id, observationId: slot!.observationId } };
}

export function validateUpdateAttempt(state: ManagedState, run: ManagedRun, attempt: Attempt): void {
    if (attempt.request.step.effect.kind === "create") {
        requireEvidence(run.kind === "initial_create" && !attempt.request.update, "ATTEMPT_EFFECT_KIND_MISMATCH");
        return;
    }
    requireEvidence(run.kind === "update" && attempt.request.step.effect.kind === "update", "ATTEMPT_EFFECT_KIND_MISMATCH");
    const ref = attempt.request.update, artifact = ref && state.artifacts[ref.artifactId];
    requireEvidence(ref && artifact && [run.initialArtifactId, run.artifactId, ...run.revisions.map(r => r.artifactId)].includes(ref.artifactId), "UPDATE_REQUEST_ARTIFACT_MISSING");
    requireEvidence(same(updateRequest(artifact!, attempt.stepId, state.bindings), attempt.request), "UPDATE_REQUEST_EVIDENCE_MISMATCH");
}

/** An update receipt must establish the original target, including unchanged managed
 * fields. Remote equality alone is never used here: the adapter must report applied. */
export function updateOutcome(state: ManagedState, attempt: Attempt,
    outcome: import("../types.js").ApplyOutcome | import("../types.js").ReconcileOutcome
): import("../types.js").ApplyOutcome | import("../types.js").ReconcileOutcome {
    if (attempt.request.step.effect.kind !== "update" || outcome.kind !== "applied") return outcome;
    const ref = attempt.request.update, artifact = ref && state.artifacts[ref.artifactId];
    const nodeId = attempt.request.step.effect.nodeId;
    const observation = artifact?.update?.context.observations.find(o => o.id === ref?.observationId && o.nodeId === nodeId);
    const slot = artifact?.update?.slots.find(s => s.nodeId === nodeId);
    const expected = observation && structuredClone(observation.values);
    if (expected && slot) for (const change of slot.changes) expected[change.field] = change.after;
    if (slot?.kind === "update" && observation && outcome.remoteRef === slot.remoteId &&
        outcome.confirmed?.projectionDigest === observation.projectionDigest && same(outcome.confirmed.values, expected)) return outcome;
    return { kind: "unknown", code: "UPDATE_RECEIPT_MISMATCH",
        reason: "The receipt does not establish the original update target and all checked values.",
        message: "The remote write may have taken effect, but its receipt cannot confirm this update.",
        diagnostics: [{ code: "UPDATE_RECEIPT_MISMATCH", path: "", message: "The update receipt is missing or contradicts its checked resource or normalized values.",
            hint: "Reconcile the original request and key with authoritative evidence. Do not resend or replace the resource based on this receipt." }] };
}
