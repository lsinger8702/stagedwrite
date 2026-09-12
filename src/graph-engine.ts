import { randomUUID } from "node:crypto";
import { DefinitionRegistry } from "./registry/registry.js";
import type { DefinitionSelector } from "./registry/types.js";

import type { GraphDraft, GraphOp } from "./graph/types.js";
import { evaluateGraphEdit } from "./graph/edit.js";

/** Draft-only graph engine. The legacy StagedWrite execution prototype is separate. */
export function createStagedWrite(options: { definitions: readonly unknown[] }) {
  const registry = new DefinitionRegistry(options?.definitions);
  const drafts = new Map<string, GraphDraft>();
  const requireDraft = (id: string): GraphDraft => {
    const draft = drafts.get(id);
    if (!draft) throw new Error("DRAFT_NOT_FOUND");
    return draft;
  };
  const evaluateEdit = (id: string, expectedVersion: number, ops: readonly GraphOp[]) =>
    evaluateGraphEdit(registry, requireDraft(id), expectedVersion, ops);
  return Object.freeze({
    create(selector: DefinitionSelector): GraphDraft {
      const { digest } = registry.getDefinition(selector);
      const draft: GraphDraft = {
        id: randomUUID(), version: 0, type: selector.type, typeVersion: selector.typeVersion,
        definitionDigest: digest, nodes: {}, edges: {}, tombstones: { nodes: [], edges: [] }
      };
      drafts.set(draft.id, draft);
      return structuredClone(draft);
    },
    getDraft(id: string): GraphDraft { return structuredClone(requireDraft(id)); },
    evaluateEdit,
    preview: evaluateEdit,
    edit(id: string, expectedVersion: number, ops: readonly GraphOp[]): GraphDraft {
      const { candidate } = evaluateEdit(id, expectedVersion, ops);
      // Synchronous in-memory CAS: no await or callback between evaluation and save.
      drafts.set(id, candidate);
      return structuredClone(candidate);
    },
    getDefinition: (selector: DefinitionSelector) => registry.getDefinition(selector),
    validateValues: (selector: DefinitionSelector, nodeType: string, values: unknown) => registry.validateValues(selector, nodeType, values)
  });
}
export type DraftEngine = ReturnType<typeof createStagedWrite>;
