import { canonicalJson, definitionDigest, deepFreeze, type Json } from "../registry/json.js";
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

/** Pass a detached frozen copy of the original conditions to either adapter callback. */
export function updateContext(state: ManagedState, attempt: Attempt): NonNullable<import("./types.js").ManagedExecutionContext["update"]> | undefined {
    if (attempt.request.step.effect.kind === "create") return undefined;
    const ref = attempt.request.update, artifact = ref && state.artifacts[ref.artifactId];
    const observation = artifact?.update?.context.observations.find(o => o.id === ref?.observationId && o.nodeId === attempt.request.step.effect.nodeId);
    requireEvidence(attempt.request.step.effect.kind === "update" && ref && observation &&
        same(updateRequest(artifact!, attempt.stepId, state.bindings), attempt.request), "UPDATE_REQUEST_EVIDENCE_MISMATCH");
    return deepFreeze(structuredClone({ artifactId: ref!.artifactId, observation: observation! }));
}

export function validateSatisfiedSlot(state: ManagedState, run: ManagedRun, step: import("../types.js").ExecutionStep): void {
    if (step.status !== "satisfied") {
        requireEvidence(!step.satisfaction && !(step.effect.kind === "noop" && step.status === "applied"), "NOOP_COMPLETION_INVALID");
        return;
    }
    const proof = step.satisfaction, artifact = proof && state.artifacts[proof.artifactId];
    const slot = artifact?.update?.slots.find(s => s.nodeId === step.effect.nodeId);
    const fact = proof && state.remoteFacts[proof.factId];
    const planned = artifact?.plan.find(s => s.id === step.id);
    requireEvidence(run.kind === "update" && step.effect.kind === "noop" && proof && slot?.kind === "noop" && planned &&
        [run.initialArtifactId, run.artifactId, ...run.revisions.map(r => r.artifactId)].includes(proof.artifactId) &&
        same(planned, { id: step.id, payload: step.payload, ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}),
            ...(step.inputRefs ? { inputRefs: step.inputRefs } : {}), effect: step.effect }) &&
        slot.observationId === proof.observationId && step.remoteRef === slot.remoteId &&
        fact?.nodeId === step.effect.nodeId && fact.source.kind === "observation" &&
        fact.source.artifactId === proof.artifactId && fact.source.observationId === proof.observationId &&
        !run.attempts.some(a => a.stepId === step.id && a.status !== "no_effect"), "NOOP_COMPLETION_INVALID");
}

/** Transaction mutation only. Caller must separately establish fresh readback and
 * ownership before entering the transaction. This helper grants no execution rights. */
export function satisfyNoop(state: ManagedState, runId: string, stepId: string, now: string): void {
    const run = state.runs[runId], step = run?.steps.find(s => s.id === stepId);
    requireEvidence(run && step && run.kind === "update" && state.draft.currentRunId === runId &&
        run.version === state.draft.version, "NOOP_OWNER_MISMATCH");
    if (step!.status === "satisfied") { validateSatisfiedSlot(state, run!, step!); return; }
    requireEvidence(step!.status === "ready" && !Object.values(state.runs).some(r => r.attempts.some(a => a.status === "pending" || a.status === "unknown")), "UNRESOLVED_EXECUTION");
    requireEvidence((step!.dependsOn ?? []).every(id => ["applied", "satisfied"].includes(run!.steps.find(s => s.id === id)?.status ?? "")), "DEPENDENCY_NOT_APPLIED");
    const artifact = state.artifacts[run!.artifactId], slot = artifact?.update?.slots.find(s => s.nodeId === step!.effect.nodeId);
    const observation = artifact?.update?.context.observations.find(o => o.id === slot?.observationId);
    requireEvidence(step!.effect.kind === "noop" && slot?.kind === "noop" && observation, "NOOP_COMPLETION_INVALID");
    const factId = JSON.stringify(["noop", runId, artifact!.id, stepId]);
    requireEvidence(!state.remoteFacts[factId], "FACT_IMMUTABLE");
    state.remoteFacts[factId] = { id: factId, nodeId: observation!.nodeId, targetId: observation!.targetId, remoteId: observation!.remoteId,
        projectionDigest: observation!.projectionDigest, values: structuredClone(observation!.values),
        source: { kind: "observation", artifactId: artifact!.id, observationId: observation!.id }, confirmedAt: now };
    state.latestFactByNode[observation!.nodeId] = factId;
    state.resourceRevision++;
    step!.status = "satisfied"; step!.remoteRef = observation!.remoteId;
    step!.satisfaction = { artifactId: artifact!.id, observationId: observation!.id, factId };
    delete step!.feedback;
    validateSatisfiedSlot(state, run!, step!);
    run!.events.push({ sequence: run!.events.length + 1, stepId, kind: "satisfied", recordedAt: now });
}
