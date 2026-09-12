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
export type Outcome = { kind: "applied"; remoteRef: string }
  | { kind: "not_applied"; reason: string }
  | { kind: "unknown"; reason: string };
export interface Adapter {
  /** Pure and synchronous. Must not create remote effects. */
  plan(draft: Draft): Step[];
  apply(step: Step, key: string): Promise<Outcome>;
  /** not_applied must rule out a still-running original request. */
  reconcile(step: Step, key: string): Promise<Outcome>;
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
  kind: "dispatching" | "applied" | "unknown" | "not_applied" | "reconciling";
}
export interface Run {
  id: string;
  draftId: string;
  version: number;
  state: "running" | "unknown" | "failed" | "published";
  steps: ExecutionStep[];
  events: Event[];
}
