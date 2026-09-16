import { evaluateFields, validateIntentSnapshot } from "./fields.js";
import { parseEditBatch } from "./protocol.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import type { DefinitionSelector } from "../registry/types.js";
import { pointer } from "../registry/json.js";
import { EditInputError, type EditInputIssue } from "./protocol.js";
import { evaluateTopology, initializeTopology, type TopologySnapshot, type TopologyState } from "./evaluate-topology.js";
import type { Relations, RelationDefinition } from "./topology.js";

/** Bind once to the same immutable definition identity used by preflight and execution.
 * Shared by public editing and candidate diagnostics; no ownership inference. */
export function registeredTopology(registry: DefinitionRegistry, selector: DefinitionSelector) {
  const { definition, digest } = registry.getDefinition(selector);
  const relations: Record<string, RelationDefinition> = {};
  const issues: EditInputIssue[] = [];
  for (const [name, relation] of Object.entries(definition.relationTypes)) {
    if (relation.ownership === undefined || relation.cardinality === undefined) {
      issues.push({ code: "INVALID_EDIT_INPUT", path: `/relationTypes/${pointer(name)}`,
        message: `Relation ${name} requires explicit ownership and cardinality for three-state editing.`,
        hint: "Register ownership as owned/reference and cardinality as one/many; the library does not infer deletion or sharing semantics." });
    } else relations[name] = { ...relation, ownership: relation.ownership, cardinality: relation.cardinality };
  }
  if (issues.length) throw new EditInputError(issues);
  const options = { relations: relations as Relations, nodeTypes: Object.keys(definition.nodeTypes) };
  const validate = <T extends { candidate: TopologyState }>(result: T): T => {
    const errors: EditInputIssue[] = [];
    for (const node of Object.values(result.candidate.graph.nodes)) {
      const values = registry.validateValues(selector, node.nodeType, node.fields);
      for (const issue of values.issues) errors.push({ code: "INVALID_EDIT_INPUT", path: `/nodes/${pointer(node.id)}/fields${issue.path}`,
        message: issue.message, hint: `Provide fields matching the registered ${node.nodeType} schema; this candidate was not stored.` });
    }
    if (errors.length) throw new EditInputError(errors);
    return result;
  };
  return {
    definitionDigest: digest,
    initialize(input: unknown, allocation: { preview?: boolean; nextId?: () => string } = {}) {
      return validate(initializeTopology(input, { ...options, ...allocation }));
    },
    evaluate(state: TopologyState, baseline: TopologySnapshot, expectedDigest: string, batch: unknown, allocation: { preview?: boolean; nextId?: () => string } = {}) {
      if (expectedDigest !== digest) throw new EditInputError([{ code: "INVALID_EDIT_INPUT", path: "/definitionDigest", message: "The Draft definition does not match the registered definition.", hint: "Use the original definition version; do not reinterpret an existing Draft under changed relationship semantics." }]);
      validateIntentSnapshot(registry, selector, state);
      validateIntentSnapshot(registry, selector, baseline);
      const parsed = parseEditBatch(batch);
      const topology = evaluateTopology(state, baseline, parsed, { ...options, ...allocation });
      const fields = evaluateFields(registry, selector, topology.candidate, baseline, parsed.patches ?? []);
      return { ...topology, candidate: fields.candidate, changes: [...topology.changes, ...fields.changes] };
    }
  };
}
