import type { Json } from "../registry/json.js";
import type { GraphDraft, GraphNode, GraphOp } from "../graph/types.js";
import type { Diagnostic, Field } from "../types.js";
import type { DefinitionSelector } from "../registry/types.js";

/** Paths are JSON Pointers from the graph root, including related locations. */
export interface GraphCandidate {
  value: import("../types.js").Value;
  label?: string;
  message?: string;
  metadata?: Record<string, Json>;
  /** Optional, complete edit batch for selecting this candidate; never applied by preflight. */
  repairOps?: readonly GraphOp[];
}
export interface GraphRepair {
  id?: string;
  message: string;
  /** One alternative atomic batch, not instructions to concatenate all alternatives. */
  ops: readonly GraphOp[];
}
export interface GraphDiagnostic extends Diagnostic {
  candidates?: readonly GraphCandidate[];
  excludedCandidates?: readonly Omit<GraphCandidate, "repairOps">[];
  repairs?: readonly GraphRepair[];
  constraintIds?: readonly string[];
  stage?: string;
  /** Advisory preflight retry information; does not schedule retries or authorize execution. */
  retryable?: boolean;
  retryAfterSeconds?: number;
  metadata?: Record<string, Json>;
}
export interface GraphRule extends DefinitionSelector {
  id: string;
  version: string;
  /** Trusted, pure, synchronous callback; diagnoses a frozen current draft, optionally suggesting edits without choosing or applying them. */
  check: (draft: GraphDraft) => readonly GraphDiagnostic[];
}
/** The application owns long-running work and deduplication; each callback checks it once. */
export interface AsyncGraphRule extends DefinitionSelector {
  id: string;
  version: string;
  check: (draft: GraphDraft, context: { signal: AbortSignal }) => Promise<AsyncRuleResult>;
}
export type AsyncRuleResult =
  | { status: "complete"; diagnostics: readonly GraphDiagnostic[] }
  | { status: "pending"; message: string; retryAfterSeconds?: number; diagnostics?: readonly GraphDiagnostic[] };
export interface PendingRule {
  ruleId: string;
  ruleVersion: string;
  message: string;
  retryAfterSeconds?: number;
}
export interface SourcedGraphDiagnostic extends GraphDiagnostic {
  severity: "error" | "warning";
  source: { kind: "builtin"; version: string } | { kind: "rule" | "executor"; id: string; version: string };
}
/** Preview-only state: reset/absent fields become explicit undeclared entries. */
export type PreviewField = Field | { kind: "undeclared" };
export interface GraphDraftPreview extends Omit<GraphDraft, "nodes"> {
  nodes: Record<string, Omit<GraphNode, "fields"> & { fields: Record<string, PreviewField> }>;
}
export interface GraphCheck {
  /** Response contract version, separate from execution rule identity. */
  formatVersion: 2;
  scope: "draft" | "execution";
  certificate?: string;
  execution?: import("../types.js").ExecutionBinding;
  checkId: string;
  draftId: string;
  version: number;
  definitionDigest: string;
  rulesDigest: string;
  /** The checked draft, present even when blocked/incomplete; not a remote request or predicted remote state. */
  preview: GraphDraftPreview;
  /** Draft scope is diagnostic-only. Execution scope requires certificate + fixed plan to publish; neither scope supplies external authorization. */
  status: "passed" | "blocked" | "pending" | "incomplete";
  pendingRules?: PendingRule[];
  diagnostics: SourcedGraphDiagnostic[];
}

/** Execution facts plus LLM-facing diagnostics for the associated input snapshot. */
export type GraphExecutionResult = import("../types.js").Run & { preview: GraphDraftPreview; diagnostics: GraphDiagnostic[]; check?: GraphCheck };
