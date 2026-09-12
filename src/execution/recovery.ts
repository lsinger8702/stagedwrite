import type { Clock, RecoveryRequest, Run, Step } from "../types.js";
import type { StoredPlan } from "../storage/drafts.js";
import { definitionDigest, type Json } from "../registry/json.js";
import { validateStopRetry } from "./stop-retry.js";
import { validatePlan } from "./plan.js";

export function validateRecovery(input: unknown): RecoveryRequest {
  try { return validateStopRetry(input); }
  catch { throw new Error("INVALID_RECOVERY_REQUEST"); }
}
const digest = (value: unknown) => definitionDigest(value as Json);

/** Validate persisted inputs against the sealed plan; never rerun the planner. */
export function prepareRecovery(run: Run, fixed: StoredPlan | undefined, command: RecoveryRequest,
  previousOwner: string, owner: string, clock: Clock = Date.now): Run {
  if (!fixed || !run.binding || digest(fixed.binding) !== digest(run.binding) ||
      digest(validatePlan(fixed.plan)) !== run.binding.planDigest || run.steps.length !== fixed.plan.length ||
      !["running", "blocked", "unknown"].includes(run.state) ||
      run.events.some((event, i) => event.sequence !== i + 1)) throw new Error("STORED_RUN_CORRUPT");
  let pending = false;
  for (let i = 0; i < run.steps.length; i++) {
    const step = run.steps[i]!;
    const original: Step = { id: step.id, payload: step.payload,
      ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}),
      ...(step.inputRefs ? { inputRefs: step.inputRefs } : {}),
      ...(step.effect ? { effect: step.effect } : {}) };
    if (digest(original) !== digest(fixed.plan[i]) || step.key !== `${run.id}:${step.id}` ||
        !["ready", "dispatching", "unknown", "applied", "reused"].includes(step.status)) throw new Error("STORED_RUN_CORRUPT");
    if (step.status === "applied" && pending) throw new Error("STORED_RUN_CORRUPT");
    if (["dispatching", "unknown"].includes(step.status) && pending) throw new Error("STORED_RUN_CORRUPT");
    if (!["applied", "reused"].includes(step.status)) pending = true;
    if (["applied", "reused"].includes(step.status) && (typeof step.remoteRef !== "string" || !step.remoteRef.length)) throw new Error("STORED_RUN_CORRUPT");
    if (step.status !== "ready" && !step.resolvedPayload) throw new Error("STORED_RUN_CORRUPT");
    if (step.resolvedPayload) {
      const expected = structuredClone(step.payload);
      for (const id of step.dependsOn ?? []) {
        if (!["applied", "reused"].includes(run.steps.find(s => s.id === id)?.status ?? "")) throw new Error("STORED_RUN_CORRUPT");
      }
      for (const [field, id] of Object.entries(step.inputRefs ?? {})) expected[field] = run.steps.find(s => s.id === id)!.remoteRef!;
      if (digest(expected) !== digest(step.resolvedPayload)) throw new Error("STORED_RUN_CORRUPT");
    }
    if (step.status === "ready") {
      const events = run.events.filter(e => e.stepId === step.id && e.kind !== "recovery_claimed");
      const last = events.at(-1);
      if (events.some(e => e.kind === "dispatching") &&
          !(last?.kind === "not_applied" && last.retryable === true) &&
          !(last?.kind === "adjudicated" && last.adjudication?.decision.kind === "no_effect" && last.adjudication.decision.next === "retry")) throw new Error("STORED_RUN_CORRUPT");
    }
  }
  for (const step of run.steps) if (step.status === "dispatching") step.status = "unknown";
  run.state = run.steps.some(s => s.status === "unknown") ? "unknown" : "blocked";
  let recordedAt: string;
  try { const now = clock(); if (typeof now !== "number" || !Number.isFinite(now)) throw new Error("INVALID_CLOCK"); recordedAt = new Date(now).toISOString(); }
  catch { recordedAt = new Date().toISOString(); }
  // Empty stepId denotes a run-level event and does not replace any step's effect evidence.
  run.events.push({ sequence: run.events.length + 1, stepId: "", kind: "recovery_claimed", recordedAt,
    recovery: { command, previousOwner, owner } });
  return run;
}
