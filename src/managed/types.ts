import type { Json } from "../registry/json.js";
import type { DefinitionSelector } from "../registry/types.js";
import type { GraphEdge } from "../graph/types.js";
import type { Value, Step, ExecutionStep, Event, ApplyOutcome, ReconcileOutcome } from "../types.js";
import type { GraphDiagnostic, GraphCheck } from "../preflight/types.js";
export type Intent = {
    kind: "set";
    value: Json;
} | {
    kind: "remove";
};
export interface IntentSnapshot {
    graph: {
        nodes: Record<string, {
            id: string;
            nodeType: string;
            fields: Record<string, Json>;
        }>;
        edges: Record<string, GraphEdge>;
    };
    fieldIntents: Record<string, Record<string, Intent>>;
}
export interface ManagedDraft extends IntentSnapshot, DefinitionSelector {
    formatVersion: 3;
    id: string;
    version: number;
    definitionDigest: string;
    status: "pending" | "published";
    currentRunId: string | null;
    targetId: string | null;
    initialSnapshot: IntentSnapshot;
    publishedArtifactId: string | null;
    lastPublishedAt: string | null;
    tombstones: {
        nodes: string[];
        edges: string[];
    };
    createdAt: string;
    updatedAt: string;
}
/** Edit acknowledgement, not a storage snapshot or publication certificate. */
export type ManagedEditResult = import("../edit/results.js").EditReceipt;
export interface ManagedCheck extends GraphCheck {
    /** Diagnostic-only until the update execution path is enabled. Never a certificate. */
    updatePreview?: { slots: readonly import("./update-plan.js").UpdateSlot[]; plan?: readonly Step[] };
    artifactId?: string;
    executionHint?: {
        runId: string;
        nextAction: "resume" | "observe";
    };
}
export interface Artifact {
    id: string;
    intentDigest: string;
    draft: ManagedDraft;
    plan: Step[];
    binding: NonNullable<GraphCheck["execution"]>;
    resourceRevision: number;
    observations?: readonly RemoteObservation[];
}
export interface Attempt {
    stepId: string;
    key: string;
    number: number;
    input: Step["payload"];
    request: { step: Step; target: string; executorId: string; executorVersion: string };
    status: "pending" | "applied" | "no_effect" | "unknown";
    outcome?: ApplyOutcome | ReconcileOutcome;
}
export interface ManagedRun {
    id: string;
    draftId: string;
    kind: "initial_create" | "update";
    version: number;
    state: "running" | "blocked" | "unknown" | "published";
    artifactId: string;
    /** Latest recoverable execution interruption; cleared when dispatch resumes. */
    interruption?: GraphDiagnostic;
    initialArtifactId: string;
    certificate: string;
    revision: number;
    steps: ExecutionStep[];
    attempts: Attempt[];
    events: Event[];
    revisions: {
        artifactId: string;
        version: number;
        steps: ExecutionStep[];
    }[];
}
export interface ResourceBinding {
    nodeId: string;
    targetId: string;
    remoteId: string;
    runId: string;
    stepId: string;
    key: string;
    attemptNumber: number;
    input: Step["payload"];
}
export interface LateFact {
    runId: string;
    stepId: string;
    key: string;
    attemptNumber: number;
    outcome: ApplyOutcome | ReconcileOutcome;
}
/** Normalized remote facts are separate from author intent and creation bindings. */
export type NormalizedValue = { kind: "absent" } | { kind: "value"; value: Value };
export interface RemoteObservation {
    id: string;
    nodeId: string;
    targetId: string;
    remoteId: string;
    projectionDigest: string;
    values: Record<string, NormalizedValue>;
    observedAt: string;
    remoteVersion?: string;
}
export interface RemoteFact {
    id: string;
    nodeId: string;
    targetId: string;
    remoteId: string;
    projectionDigest: string;
    values: Record<string, NormalizedValue>;
    source: { kind: "attempt"; runId: string; stepId: string; attemptNumber: number }
        | { kind: "observation"; artifactId: string; observationId: string };
    confirmedAt: string;
}
export type PublicationAdoption = {
    kind: "run"; certificate: string; draftId: string; version: number; runId: string; adoptedAt: string;
} | {
    kind: "noop"; certificate: string; draftId: string; version: number; artifactId: string; committedAt: string;
};
export interface ManagedState {
    draft: ManagedDraft;
    checkEpoch: number;
    check: ManagedCheck | null;
    artifacts: Record<string, Artifact>;
    runs: Record<string, ManagedRun>;
    bindings: Record<string, ResourceBinding>;
    resourceRevision: number;
    lateFacts: LateFact[];
    remoteFacts: Record<string, RemoteFact>;
    latestFactByNode: Record<string, string>;
    publications: Record<string, PublicationAdoption>;
}
/** All mutations must atomically verify this lease against the authoritative lock service. */
export interface DraftLease {
    resource: string;
    token: string;
    fence: number;
    renew(): Promise<boolean>;
    release(): Promise<void>;
}
export interface DraftLockProvider {
    acquire(resource: string, options: {
        ttlMs: number;
    }): Promise<DraftLease | null>;
}
/** Implement transaction as one atomic unit. Callback is pure and cannot perform I/O. */
export interface ManagedStore {
    namespace: string;
    read(id: string): Promise<ManagedState | undefined>;
    findRun(runId: string): Promise<string | undefined>;
    transact(id: string, lease: DraftLease, update: (state: ManagedState | undefined) => ManagedState): Promise<ManagedState>;
    appendLateFact(id: string, fact: LateFact): Promise<void>;
    close(): Promise<void>;
}
export interface ManagedRule extends DefinitionSelector {
    id: string;
    version: string;
    check(draft: ManagedDraft): readonly GraphDiagnostic[];
}
export interface ManagedAsyncRule extends DefinitionSelector {
    id: string;
    version: string;
    check(draft: ManagedDraft, context: {
        signal: AbortSignal;
    }): Promise<{
        status: "complete";
        diagnostics: readonly GraphDiagnostic[];
    } | {
        status: "pending";
        message: string;
        retryAfterSeconds?: number;
        diagnostics?: readonly GraphDiagnostic[];
    }>;
}
export interface ManagedUpdateInspector {
    /** Pure mapping of checked update differences to the shared Step protocol. No dispatch authority. */
    plan?(draft: ManagedDraft, compilation: Extract<import("./update-plan.js").UpdateCompilation, { status: "passed" }>): readonly Step[];
    /** Read-only; the host owns pending work. Registration changes require an executor version bump. */
    inspect(draft: ManagedDraft, context: { signal: AbortSignal; bindings: Readonly<Record<string, ResourceBinding>> }): Promise<
        | { status: "complete"; projections: readonly import("./update-plan.js").UpdateProjection[]; observations: readonly RemoteObservation[]; diagnostics?: readonly GraphDiagnostic[] }
        | { status: "pending"; message: string; retryAfterSeconds?: number; diagnostics?: readonly GraphDiagnostic[] }
    >;
}
export interface ManagedExecutor extends DefinitionSelector {
    update?: ManagedUpdateInspector;
    id: string;
    version: string;
    target: string;
    plan(draft: ManagedDraft): readonly Step[];
    apply(step: Step, key: string, context: {
        signal: AbortSignal;
    }): Promise<ApplyOutcome>;
    reconcile: ((step: Step, key: string, context: {
        signal: AbortSignal;
    }) => Promise<ReconcileOutcome>) | {
        unsupported: string;
    };
}
export interface ManagedOptions {
    definitions: readonly unknown[];
    rules?: readonly ManagedRule[];
    asyncRules?: readonly ManagedAsyncRule[];
    executors?: readonly ManagedExecutor[];
    storage?: ManagedStore;
    locks?: DraftLockProvider;
    leaseTtlMs?: number;
    preflightTimeoutMs?: number;
}
/** Temporary scalar create input; roots/spec migration is tracked in M05. */
export interface ManagedInitialIntent {
    nodes: Record<string, { id: string; nodeType: string; fields: Record<string, Value> }>;
    edges: Record<string, GraphEdge>;
}
