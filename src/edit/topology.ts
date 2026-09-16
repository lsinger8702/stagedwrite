import type { Json } from "../registry/json.js";
import { EditInputError, type EditInputIssue } from "./protocol.js";
export interface TopologyNode { id: string; nodeType: string; fields: Record<string, Json> }
export interface TopologyEdge { id: string; relationType: string; from: string; to: string }
export interface TopologyGraph { nodes: Record<string, TopologyNode>; edges: Record<string, TopologyEdge> }
export interface RelationDefinition {
  from: readonly string[];
  to: readonly string[];
  ownership: "owned" | "reference";
  cardinality: "one" | "many";
}
export type Relations = Readonly<Record<string, RelationDefinition>>;
const issue = (path: string, message: string, hint: string): EditInputIssue => ({ code: "INVALID_EDIT_INPUT", path, message, hint });

/** Pure structural guard. Reference cycles are legal; ownership cycles are not.
 * This is independent of executor dependency validation and performs no I/O. */
export function validateTopology(graph: TopologyGraph, relations: Relations, inputPath: string): void {
  const issues: EditInputIssue[] = [];
  if (!Object.keys(graph.nodes).length) issues.push(issue(inputPath, "The Draft graph cannot be empty.", "Keep at least one node carrying the Draft's work intent."));
  const parent = new Map<string, string>();
  const slots = new Map<string, Set<string>>();
  const owned = new Map<string, string[]>();
  for (const [id, node] of Object.entries(graph.nodes)) if (node.id !== id)
    issues.push(issue(inputPath, `Node identity ${id} does not match its record.`, "Use server-allocated node identities without rewriting the graph map keys."));
  for (const [id, edge] of Object.entries(graph.edges)) {
    const relation = Object.hasOwn(relations, edge.relationType) ? relations[edge.relationType]! : undefined;
    if (edge.id !== id) issues.push(issue(inputPath, `Edge identity ${id} does not match its record.`, "Do not rewrite server-allocated edge identities."));
    if (!relation || !["owned", "reference"].includes(relation.ownership) || !["one", "many"].includes(relation.cardinality)) {
      issues.push(issue(inputPath, `Edge ${id} has an unregistered or incomplete relation ${edge.relationType}.`, "Register endpoint types, explicit ownership and cardinality for every relation.")); continue;
    }
    const from = Object.hasOwn(graph.nodes, edge.from) ? graph.nodes[edge.from] : undefined;
    const to = Object.hasOwn(graph.nodes, edge.to) ? graph.nodes[edge.to] : undefined;
    if (!from || !to) { issues.push(issue(inputPath, `Edge ${id} has a missing endpoint.`, "Remove the dangling relationship or restore its target before committing.")); continue; }
    if (!relation.from.includes(from.nodeType) || !relation.to.includes(to.nodeType)) issues.push(issue(inputPath, `Edge ${id} connects node types not allowed for ${edge.relationType}.`, "Use target nodes whose types match the registered relation."));
    const key = JSON.stringify([edge.from, edge.relationType]);
    const targets = slots.get(key) ?? new Set<string>();
    if (targets.has(edge.to)) issues.push(issue(inputPath, `Slot ${edge.from}/${edge.relationType} repeats target ${edge.to}.`, "List each target only once in the replacement array."));
    targets.add(edge.to); slots.set(key, targets);
    if (relation.cardinality === "one" && targets.size > 1) issues.push(issue(inputPath, `Slot ${edge.from}/${edge.relationType} accepts only one target.`, "Replace the existing target instead of appending another."));
    if (relation.ownership === "owned") {
      if (parent.has(edge.to)) issues.push(issue(inputPath, `Node ${edge.to} has more than one owning edge.`, "Use a reference relation for sharing; an owned node can have only one parent."));
      parent.set(edge.to, edge.from);
      const children = owned.get(edge.from) ?? []; children.push(edge.to); owned.set(edge.from, children);
    }
  }
  // Iterative traversal avoids stack overflow for deep user-authored graphs.
  const color = new Map<string, number>();
  for (const start of Object.keys(graph.nodes)) {
    if (color.has(start)) continue;
    const stack: { id: string; exit: boolean }[] = [{ id: start, exit: false }];
    while (stack.length) {
      const item = stack.pop()!;
      if (item.exit) { color.set(item.id, 2); continue; }
      if (color.get(item.id) === 1) { issues.push(issue(inputPath, `Owned relationships contain a cycle at ${item.id}.`, "Break the ownership cycle; use a reference relation for non-owning links.")); continue; }
      if (color.get(item.id) === 2) continue;
      color.set(item.id, 1); stack.push({ id: item.id, exit: true });
      for (const child of owned.get(item.id) ?? []) stack.push({ id: child, exit: false });
    }
  }
  if (issues.length) throw new EditInputError(issues);
}

/** Compute the deletion set only. No graph or intent mutation happens here. */
export function removableOwnedClosure(graph: TopologyGraph, relations: Relations, ref: string, inputPath: string): Set<string> {
  validateTopology(graph, relations, inputPath);
  if (!Object.hasOwn(graph.nodes, ref)) throw new EditInputError([issue(inputPath, `Node ${ref} does not exist.`, "Use a node ref from the current persisted Draft.")]);
  const children = new Map<string, string[]>();
  for (const edge of Object.values(graph.edges)) if (relations[edge.relationType]!.ownership === "owned") {
    const group = children.get(edge.from) ?? []; group.push(edge.to); children.set(edge.from, group);
  }
  const removed = new Set<string>(), pending = [ref];
  while (pending.length) { const id = pending.pop()!; if (removed.has(id)) continue; removed.add(id); pending.push(...(children.get(id) ?? [])); }
  const inbound = Object.values(graph.edges).filter(e => !removed.has(e.from) && removed.has(e.to) && relations[e.relationType]!.ownership === "reference");
  if (inbound.length) throw new EditInputError(inbound.map(e => issue(inputPath,
    `Cannot remove ${ref}: surviving node ${e.from} references ${e.to} through ${e.relationType}.`,
    `Clear the ${e.relationType} slot on ${e.from} before deleting the owned subtree. No referencing node is deleted automatically.`)));
  return removed;
}
