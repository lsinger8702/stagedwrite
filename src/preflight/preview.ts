import type { GraphDraft } from "../graph/types.js";
import type { DraftTypeDefinition } from "../registry/types.js";
import type { GraphDraftPreview } from "./types.js";

/** Preserve graph identity, edges and metadata; expose every declared field's intent state. */
export function previewDraft(draft: GraphDraft, definition: DraftTypeDefinition): GraphDraftPreview {
  const snapshot = structuredClone(draft);
  return {
    ...snapshot,
    nodes: Object.fromEntries(Object.entries(snapshot.nodes).map(([id, node]) => [id, {
      ...node,
      fields: Object.fromEntries(Object.keys(definition.nodeTypes[node.nodeType]!.valueSchema.properties)
        .map(field => [field, node.fields[field] ?? { kind: "undeclared" }]))
    }]))
  };
}
