import { canonicalJson, isObject, jsonSnapshot, type Json } from "../registry/json.js";
import { projectDeclarations } from "../edit/fields.js";
import type { FieldDeclaration } from "../edit/evaluate-topology.js";

/** Schema-independent durable consistency. Definition-specific checks remain in
 * the registered evaluator; a backend must still reject inconsistent snapshots. */
export function validateStoredSnapshot(raw: unknown): void {
  const invalid = (): never => { throw new Error("STATE_INTENT_INVALID"); };
  const value = jsonSnapshot(raw, invalid);
  if (!isObject(value) || !isObject(value.graph) || !isObject(value.graph.nodes) || !isObject(value.graph.edges) || !isObject(value.fieldIntents)) return invalid();
  const { nodes, edges } = value.graph, intents = value.fieldIntents;
  for (const [ref, declarations] of Object.entries(intents)) {
    if (!Object.hasOwn(nodes, ref) || !isObject(declarations)) return invalid();
    for (const declaration of Object.values(declarations)) {
      if (!isObject(declaration)) return invalid();
      if (declaration.kind === "set") {
        if (Object.keys(declaration).sort().join() !== "kind,value") return invalid();
      } else if (declaration.kind !== "remove" || Object.keys(declaration).join() !== "kind") return invalid();
    }
  }
  for (const [id, node] of Object.entries(nodes)) {
    if (!isObject(node) || node.id !== id || typeof node.nodeType !== "string" || !node.nodeType.trim() || !isObject(node.fields)) return invalid();
    const declarations = Object.hasOwn(intents, id) ? intents[id] : {};
    let fields: Record<string, Json>;
    try { fields = projectDeclarations(declarations as Record<string, FieldDeclaration>); }
    catch { return invalid(); }
    if (canonicalJson(fields) !== canonicalJson(node.fields)) return invalid();
  }
  for (const [id, edge] of Object.entries(edges)) {
    if (!isObject(edge) || edge.id !== id || typeof edge.relationType !== "string" || !edge.relationType.trim() ||
      typeof edge.from !== "string" || typeof edge.to !== "string" || !Object.hasOwn(nodes, edge.from) || !Object.hasOwn(nodes, edge.to)) return invalid();
  }
}
