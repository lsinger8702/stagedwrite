import type { ManagedDraft } from "../managed/types.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import type { GraphDraftPreview, PreviewField } from "./types.js";
import { previewFields } from "../edit/fields.js";

/** Field keys are canonical JSON Pointers, including every registered child path.
 * Values are reconstructed business values, never internal object presence markers. */
export function previewDraft(draft: ManagedDraft, registry: DefinitionRegistry): GraphDraftPreview {
  const states = previewFields(registry, draft, draft);
  return structuredClone({
    id: draft.id, version: draft.version, type: draft.type, typeVersion: draft.typeVersion,
    definitionDigest: draft.definitionDigest,
    nodes: Object.fromEntries(Object.entries(draft.graph.nodes).map(([id, node]) => [id, {
      id, nodeType: node.nodeType,
      fields: Object.fromEntries(Object.entries(states[id]!).map(([path, state]) => {
        const field: PreviewField = state.kind === "set" ? { kind: "value", value: state.value }
          : state.kind === "remove" ? { kind: "clear" } : { kind: "undeclared" };
        return [path, field];
      }))
    }])),
    edges: draft.graph.edges, tombstones: draft.tombstones
  });
}
