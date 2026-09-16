import type { Field } from "../types.js";
import type { DefinitionSelector } from "../registry/types.js";

export interface GraphNode { id: string; nodeType: string; fields: Record<string, Field> }
export interface GraphEdge { id: string; relationType: string; from: string; to: string }
export interface GraphDraft extends DefinitionSelector {
  id: string;
  version: number;
  definitionDigest: string;
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  tombstones: { nodes: string[]; edges: string[] };
}
