import type { ManagedDraft } from "../managed/types.js";
import type { DraftTypeDefinition } from "../registry/types.js";
import type { GraphDraftPreview, PreviewField } from "./types.js";
import { pointer } from "../registry/json.js";

/** Public preview of the checked intent. Never include execution pointers or storage baselines. */
export function previewDraft(draft: ManagedDraft, definition: DraftTypeDefinition): GraphDraftPreview {
  return structuredClone({
    id: draft.id, version: draft.version, type: draft.type, typeVersion: draft.typeVersion,
    definitionDigest: draft.definitionDigest,
    nodes: Object.fromEntries(Object.entries(draft.graph.nodes).map(([id, node]) => [id, {
      id, nodeType: node.nodeType,
      fields: Object.fromEntries(Object.keys(definition.nodeTypes[node.nodeType]!.valueSchema.properties)
        .map(field => {
          const intent = draft.fieldIntents[id]?.[`/${pointer(field)}`];
          const state: PreviewField = intent?.kind === "set" ? { kind: "value", value: intent.value }
            : intent?.kind === "remove" ? { kind: "clear" } : { kind: "undeclared" };
          return [field, state];
        }))
    }])),
    edges: draft.graph.edges, tombstones: draft.tombstones
  });
}
