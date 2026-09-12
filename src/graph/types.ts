import type { Field, Value } from "../types.js";
import type { DefinitionSelector } from "../registry/types.js";

export interface GraphNode { id: string; nodeType: string; fields: Record<string, Field> }
export interface GraphEdge { id: string; relationType: string; from: string; to: string }
export interface GraphDraft extends DefinitionSelector {
  id: string;
  version: number;
  definitionDigest: string;
  /** Proven zero-effect failed run from which this editable draft was copied. */
  sourceRunId?: string;
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  tombstones: { nodes: string[]; edges: string[] };
}
export type GraphOp = { op: "node.add"; id: string; nodeType: string }
  | { op: "node.remove" | "edge.remove"; id: string }
  | { op: "edge.add"; id: string; relationType: string; from: string; to: string }
  | { op: "set"; nodeId: string; path: string; value: Value }
  | { op: "remove" | "reset"; nodeId: string; path: string };
export interface GraphChange {
  opIndex: number;
  target: "node" | "edge" | "field";
  id: string;
  path?: string;
  before: GraphNode | GraphEdge | Field | null;
  after: GraphNode | GraphEdge | Field | null;
}
export interface GraphIssue { path: string; message: string }
export interface EditEvaluation { candidate: GraphDraft; changes: GraphChange[] }
export class GraphEditError extends Error {
  constructor(readonly code: string, readonly opIndex?: number, readonly path?: string, readonly issues: GraphIssue[] = []) {
    super(code);
    this.name = "GraphEditError";
  }
}
