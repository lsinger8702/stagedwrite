export type Value = string | number | boolean | null;
// Prototype paths address top-level fields only. Absence means undeclared.
export type Field = { kind: "value"; value: Value } | { kind: "clear" };
export type Fields = Record<string, Field>;
export type Op = { op: "set"; path: string; value: Value }
  | { op: "remove" | "reset"; path: string };
export interface Draft { id: string; version: number; fields: Fields }
export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  resolution: { kind: "ops"; ops: Op[] }
    | { kind: "blocked"; reason: "human_intent" | "unsupported" };
}
export type Rule = (draft: Draft) => Diagnostic[];
export interface Step {
  id: string;
  payload: Record<string, Value>;
  /** Dependencies must precede this step in the fixed sequential plan. */
  dependsOn?: readonly string[];
  /** Payload field -> dependency step whose remoteRef supplies that field. */
  inputRefs?: Record<string, string>;
  /** Opt-in mapping for create-only graph continuation. */
  effect?: { kind: "create"; nodeId: string };
}
type Applied = { kind: "applied"; remoteRef: string };
type Unknown = { kind: "unknown"; reason: string };
/** A refusal proves this dispatch produced no effect and cannot later take effect.
 * HTTP status alone is not proof. Omitted retryable means final refusal. */
export type ApplyOutcome = Applied | Unknown
  | { kind: "not_applied"; reason: string; retryable?: boolean };
/** no_effect proves the earlier request has no effect and cannot still complete.
 * An empty search (even after a visibility delay) is not sufficient proof. */
export type ReconcileOutcome = Applied | Unknown | { kind: "no_effect"; reason: string };
/** Compatibility name for apply results. Reconciliation uses ReconcileOutcome. */
export type Outcome = ApplyOutcome;
export interface Adapter {
  /** Pure and synchronous. Must not create remote effects. */
  plan(draft: Draft): Step[];
  apply(step: Step, key: string): Promise<ApplyOutcome>;
  /** Recovery must be possible from the persisted step/key and stable target configuration.
   * Process-local caches must not be the only source of reconciliation evidence. */
  reconcile(step: Step, key: string): Promise<ReconcileOutcome>;
}
export interface Check {
  draftId: string;
  version: number;
  diagnostics: Diagnostic[];
  certificate?: string;
}
export interface ReusedReceipt {
  nodeId: string;
  sourceRunId: string;
  sourceStepId: string;
  remoteRef: string;
  resolvedPayload: Record<string, Value>;
}
export interface ExecutionStep extends Step {
  reusedFrom?: ReusedReceipt;
  /** Explanation only; eligibility still uses recorded effect evidence. */
  failureReason?: "remote_refusal" | "manual_no_effect" | "retry_stopped";
  failureEventSequence?: number;
  key: string;
  status: "ready" | "dispatching" | "applied" | "unknown" | "failed" | "skipped" | "reused";
  skipReason?: "dependency_failed" | "run_stopped";
  blockedBy?: string;
  /** Frozen dispatch inputs reused for reconciliation and retries. */
  resolvedPayload?: Record<string, Value>;
  remoteRef?: string;
}
/** Caller-verified evidence, not evidence independently verified by this library. */
export type ManualDecision = { kind: "applied"; remoteRef: string }
  | { kind: "no_effect"; next: "retry" | "stop" }
  | { kind: "close_unresolved" };
export interface Adjudication {
  /** Unique command identity within this run, for safe resubmission. */
  requestId: string;
  /** Last observed event sequence (not the draft version). */
  expectedSequence: number;
  actor: string;
  /** Reference to externally retained verification evidence. */
  evidence: string;
  note: string;
  decision: ManualDecision;
}
/** Trusted synchronous epoch-millisecond clock; sequence remains the ordering authority. */
export type Clock = () => number;
export interface StopRetry {
  requestId: string;
  expectedSequence: number;
  actor: string;
  reason: string;
}
export interface Event {
  sequence: number;
  stepId: string;
  kind: "dispatching" | "applied" | "unknown" | "not_applied" | "no_effect" | "reconciling" | "skipped" | "adjudicated" | "reused" | "retry_stopped";
  stopRetry?: StopRetry;
  reusedFrom?: ReusedReceipt;
  adjudication?: Adjudication;
  recordedAt: string;
  reason?: string;
  retryable?: boolean;
}
export interface ExecutionBinding {
  checkId: string;
  definitionDigest: string;
  rulesDigest: string;
  executorId: string;
  executorVersion: string;
  target: string;
  planDigest: string;
  continuationDigest?: string;
}
export interface Run {
  binding?: ExecutionBinding;
  id: string;
  draftId: string;
  version: number;
  state: "running" | "unknown" | "blocked" | "failed" | "published" | "closed";
  steps: ExecutionStep[];
  events: Event[];
}
