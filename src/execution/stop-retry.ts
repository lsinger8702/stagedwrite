import type { StopRetry, Run } from "../types.js";
import { isObject, jsonSnapshot } from "../registry/json.js";
export function validateStopRetry(input: unknown): StopRetry {
  const issues: string[] = [];
  const v = jsonSnapshot(input, (_p, message) => issues.push(message));
  if (issues.length || !isObject(v) || Object.keys(v).length !== 4 ||
      !["requestId", "actor", "reason"].every(k => typeof v[k] === "string" && !!(v[k] as string).trim()) ||
      !Number.isSafeInteger(v.expectedSequence) || (v.expectedSequence as number) < 0) throw new Error("INVALID_STOP_RETRY");
  return v as unknown as StopRetry;
}
/** Ready alone is insufficient: require no dispatch, or authoritative no-effect evidence. */
export function requireSafeStop(run: Run): void {
  if (run.state !== "blocked" || run.steps.some(s => !["ready", "applied", "reused"].includes(s.status))) throw new Error("BLOCKED_RUN_REQUIRED");
  for (const step of run.steps.filter(s => s.status === "ready")) {
    const events = run.events.filter(e => e.stepId === step.id);
    if (!events.some(e => e.kind === "dispatching")) continue;
    const last = events.at(-1);
    if (!(last?.kind === "not_applied" && last.retryable === true) &&
        !(last?.kind === "adjudicated" && last.adjudication?.decision.kind === "no_effect" && last.adjudication.decision.next === "retry")) throw new Error("NO_EFFECT_EVIDENCE_REQUIRED");
  }
}
