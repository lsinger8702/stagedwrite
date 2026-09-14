import type { DefinitionRegistry } from "../registry/registry.js";
import { isObject, jsonSnapshot, pointer } from "../registry/json.js";
import type { Value } from "../types.js";
import { evaluateGraphEdit } from "./edit.js";
import { GraphEditError, type GraphDraft, type GraphInitialIntent, type GraphIssue, type GraphOp } from "./types.js";

/** Validate all initial work before the first storage write. Reuse OP structural semantics. */
export function initializeGraph(registry: DefinitionRegistry, empty: GraphDraft, intent: GraphInitialIntent): GraphDraft {
  const issues: GraphIssue[] = [];
  const input = jsonSnapshot(intent, (path, message) => issues.push({ path, message }));
  const fail = (path: string): never => { throw new GraphEditError("INVALID_INITIAL_INTENT", undefined, path, issues); };
  if (issues.length || !isObject(input) || Object.keys(input).length !== 2 || !isObject(input.nodes) || !isObject(input.edges)) return fail("");
  if (!Object.keys(input.nodes).length) return fail("/nodes");
  const ops: GraphOp[] = [];
  for (const [id, node] of Object.entries(input.nodes)) {
    const path = `/nodes/${pointer(id)}`;
    if (!isObject(node) || Object.keys(node).length !== 3 || node.id !== id || typeof node.nodeType !== "string" || !isObject(node.fields)) return fail(path);
    ops.push({ op: "node.add", id, nodeType: node.nodeType });
    for (const [name, field] of Object.entries(node.fields)) {
      if (!isObject(field)) return fail(`${path}/fields/${pointer(name)}`);
      if (field.kind === "clear" && Object.keys(field).length === 1) ops.push({ op: "remove", nodeId: id, path: `/${pointer(name)}` });
      else if (field.kind === "value" && Object.keys(field).length === 2 && Object.hasOwn(field, "value")) ops.push({ op: "set", nodeId: id, path: `/${pointer(name)}`, value: field.value as Value });
      else return fail(`${path}/fields/${pointer(name)}`);
    }
  }
  for (const [id, edge] of Object.entries(input.edges)) {
    if (!isObject(edge) || Object.keys(edge).length !== 4 || edge.id !== id || typeof edge.relationType !== "string" || typeof edge.from !== "string" || typeof edge.to !== "string") return fail(`/edges/${pointer(id)}`);
    ops.push({ op: "edge.add", id, relationType: edge.relationType, from: edge.from, to: edge.to });
  }
  const { candidate } = evaluateGraphEdit(registry, empty, 0, ops);
  candidate.version = 0; // Initial content is the first snapshot, not a later edit.
  return candidate;
}
