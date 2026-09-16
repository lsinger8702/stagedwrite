export type Value = string | number | boolean | null;
/** Internal OP/preview projection. Persistence uses ManagedDraft.fieldIntents. */
export type Field = {
    kind: "value";
    value: Value;
} | {
    kind: "clear";
};
export interface Diagnostic {
    code: string;
    path: string;
    message: string;
    /** Defaults to error. Warnings do not prevent a passing check. */
    severity?: "error" | "warning";
    hint?: string;
    candidates?: readonly {
        value: Value;
        message?: string;
    }[];
    related?: readonly string[];
}
export interface Step {
    id: string;
    payload: Record<string, Value>;
    /** Dependencies must precede this step in the sequential plan. */
    dependsOn?: readonly string[];
    /** Payload field -> dependency step whose remoteRef supplies that field. */
    inputRefs?: Record<string, string>;
    /** Fixed-node effects share the same plan/request protocol. */
    effect: { kind: "create"; nodeId: string }
        | { kind: "update" | "noop"; nodeId: string; remoteId: string };
}
type Applied = {
    kind: "applied";
    remoteRef: string;
    /** Adapter-confirmed remote values, not guessed from the request. */
    confirmed?: { projectionDigest: string; values: Record<string, import("./managed/types.js").NormalizedValue> };
};
type Unknown = {
    kind: "unknown";
    reason: string;
};
export interface ExecutionFeedback {
    code?: string;
    message?: string;
    diagnostics?: readonly import("./preflight/types.js").GraphDiagnostic[];
}
/** not_applied proves this request produced no effect and cannot later take effect.
 * HTTP status alone is not proof. retryable is advisory; the caller chooses resume. */
export type ApplyOutcome = (Applied | Unknown | {
    kind: "not_applied";
    reason: string;
    retryable?: boolean;
}) & ExecutionFeedback;
/** no_effect proves the old request has no effect and cannot still complete.
 * An empty search, including after a visibility delay, is not sufficient proof. */
export type ReconcileOutcome = (Applied | Unknown | {
    kind: "no_effect";
    reason: string;
}) & ExecutionFeedback;
export interface ExecutionStep extends Step {
    feedback?: ExecutionFeedback & {
        reason?: string;
    };
    requestRevision?: number;
    key: string;
    status: "ready" | "dispatching" | "applied" | "unknown" | "satisfied";
    /** No remote request: immutable observation-backed completion evidence. */
    satisfaction?: { artifactId: string; observationId: string; factId: string };
    /** Exact dispatch inputs reused for reconciliation. */
    resolvedPayload?: Record<string, Value>;
    remoteRef?: string;
}
export interface Event {
    sequence: number;
    stepId: string;
    kind: "dispatching" | "applied" | "unknown" | "not_applied" | "no_effect" | "reconciling" | "plan_repaired" | "satisfied";
    recordedAt: string;
    reason?: string;
}
export interface ExecutionBinding {
    checkId: string;
    definitionDigest: string;
    rulesDigest: string;
    executorId: string;
    executorVersion: string;
    target: string;
    planDigest: string;
}
