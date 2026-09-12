import { randomUUID } from "node:crypto";
import { DefinitionRegistry } from "./registry/registry.js";
import type { DefinitionSelector } from "./registry/types.js";

import type { GraphDraft, GraphOp } from "./graph/types.js";
import { evaluateGraphEdit } from "./graph/edit.js";
import { GraphPreflight } from "./preflight/check.js";
import type { GraphRule, GraphCheck } from "./preflight/types.js";

/** Draft-only graph engine. The legacy StagedWrite execution prototype is separate. */
export function createStagedWrite(options: { definitions: readonly unknown[]; rules?: readonly GraphRule[] }) {
  const registry = new DefinitionRegistry(options?.definitions);
  const drafts = new Map<string, GraphDraft>();
  const preflight = new GraphPreflight(registry, options.rules === undefined ? [] : options.rules);
  const checks = new Map<string, GraphCheck>();
  const checking = new Set<string>();
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
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const { candidate } = evaluateEdit(id, expectedVersion, ops);
      // Synchronous in-memory CAS: no await or callback between evaluation and save.
      drafts.set(id, candidate);
      checks.delete(id);
      return structuredClone(candidate);
    },
    preflight(id: string): GraphCheck {
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const draft = requireDraft(id);
      checks.delete(id);
      checking.add(id);
      try {
        const result = preflight.run(draft);
        checks.set(id, result);
        return structuredClone(result);
      } finally { checking.delete(id); }
    },
    getCheck(id: string, checkId: string): GraphCheck {
      const draft = requireDraft(id);
      const check = checks.get(id);
      if (!check || check.checkId !== checkId || check.version !== draft.version ||
          check.definitionDigest !== draft.definitionDigest || check.rulesDigest !== preflight.rulesDigest(draft)) throw new Error("CHECK_NOT_CURRENT");
      return structuredClone(check);
    },
    getDefinition: (selector: DefinitionSelector) => registry.getDefinition(selector),
    validateValues: (selector: DefinitionSelector, nodeType: string, values: unknown) => registry.validateValues(selector, nodeType, values)
  });
}
export type DraftEngine = ReturnType<typeof createStagedWrite>;
