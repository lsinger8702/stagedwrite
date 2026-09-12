import { randomUUID } from "node:crypto";
import { DefinitionRegistry } from "./registry/registry.js";
import type { DefinitionSelector, EmptyGraphDraft } from "./registry/types.js";

/** M1 draft-only engine. The legacy StagedWrite execution prototype is separate. */
export function createStagedWrite(options: { definitions: readonly unknown[] }) {
  const registry = new DefinitionRegistry(options?.definitions);
  const drafts = new Map<string, EmptyGraphDraft>();
  return Object.freeze({
    create(selector: DefinitionSelector): EmptyGraphDraft {
      const { digest } = registry.getDefinition(selector);
      const draft: EmptyGraphDraft = {
        id: randomUUID(), version: 0, type: selector.type, typeVersion: selector.typeVersion,
        definitionDigest: digest, nodes: {}, edges: {}
      };
      drafts.set(draft.id, draft);
      return structuredClone(draft);
    },
    getDraft(id: string): EmptyGraphDraft {
      const draft = drafts.get(id);
      if (!draft) throw new Error("DRAFT_NOT_FOUND");
      return structuredClone(draft);
    },
    getDefinition: (selector: DefinitionSelector) => registry.getDefinition(selector),
    validateValues: (selector: DefinitionSelector, nodeType: string, values: unknown) => registry.validateValues(selector, nodeType, values)
  });
}
export type DraftEngine = ReturnType<typeof createStagedWrite>;
