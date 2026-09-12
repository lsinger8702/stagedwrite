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
export interface Step { id: string; payload: Record<string, Value> }
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
  reconcile(step: Step, key: string): Promise<ReconcileOutcome>;
}
export interface Check {
  draftId: string;
  version: number;
  diagnostics: Diagnostic[];
  certificate?: string;
}
export interface ExecutionStep extends Step {
  key: string;
  status: "ready" | "dispatching" | "applied" | "unknown" | "failed";
  remoteRef?: string;
}
export interface Event {
  sequence: number;
  stepId: string;
  kind: "dispatching" | "applied" | "unknown" | "not_applied" | "no_effect" | "reconciling";
  reason?: string;
  retryable?: boolean;
}
export interface Run {
  id: string;
  draftId: string;
  version: number;
  state: "running" | "unknown" | "blocked" | "failed" | "published";
  steps: ExecutionStep[];
  events: Event[];
}
