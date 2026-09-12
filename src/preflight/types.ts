import type { GraphDraft, GraphOp } from "../graph/types.js";
import type { DefinitionSelector } from "../registry/types.js";

export interface GraphDiagnostic {
  code: string;
  path: string;
  message: string;
  resolution: { kind: "ops"; ops: readonly GraphOp[] }
    | { kind: "blocked"; reason: "human_intent" | "unsupported"; message?: string };
}
export interface GraphRule extends DefinitionSelector {
  id: string;
  version: string;
  /** Trusted, pure, synchronous callback; receives a deeply frozen independent snapshot. */
  check: (draft: GraphDraft) => readonly GraphDiagnostic[];
}
export interface SourcedGraphDiagnostic extends GraphDiagnostic {
  source: { kind: "builtin"; version: string } | { kind: "rule"; id: string; version: string };
}
export interface GraphCheck {
  scope: "draft";
  checkId: string;
  draftId: string;
  version: number;
  definitionDigest: string;
  rulesDigest: string;
  /** passed is a draft check, not authorization or readiness to publish. */
  status: "passed" | "blocked" | "incomplete";
  diagnostics: SourcedGraphDiagnostic[];
}
