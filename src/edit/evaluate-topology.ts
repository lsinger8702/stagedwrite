import { pointer, isObject, jsonSnapshot, type Json } from "../registry/json.js";
import { createIdentityAllocator } from "./identity.js";
import { parseEditBatch, EditInputError, decodeEditPath, type NodeInput, type NodeSpec, type CreatedRef } from "./protocol.js";
import { validateTopology, removableOwnedClosures, type TopologyGraph, type Relations } from "./topology.js";
import type { EditChange } from "./results.js";

export type FieldDeclaration = { kind: "set"; value: Json } | { kind: "remove" };
export interface TopologySnapshot {
  graph: TopologyGraph;
  fieldIntents: Record<string, Record<string, FieldDeclaration>>;
}
export interface TopologyState extends TopologySnapshot { tombstones: { nodes: string[]; edges: string[] } }
export interface TopologyOptions { relations: Relations; nodeTypes: readonly string[]; preview?: boolean; nextId?: () => string }
const fail = (path: string, message: string, hint: string): never => { throw new EditInputError([{ code: "INVALID_EDIT_INPUT", path, message, hint }]); };

/** Canonical initial declarations: object containers hold presence, never a second copy of child values. */
export function declareFields(fields: Record<string, Json>): Record<string, FieldDeclaration> {
  const out: Record<string, FieldDeclaration> = {};
  const visit = (value: Json, path: string) => {
    out[path] = { kind: "set", value: isObject(value) ? {} : structuredClone(value) };
    if (isObject(value)) for (const [key, child] of Object.entries(value)) visit(child, `${path}/${pointer(key)}`);
  };
  for (const [key, value] of Object.entries(fields)) visit(value, `/${pointer(key)}`);
  return out;
}

function evaluator(original: TopologyState, baseline: TopologySnapshot, options: TopologyOptions) {
  const candidate = structuredClone(original);
  const createdRefs: CreatedRef[] = [], changes: EditChange[] = [];
  const allocate = createIdentityAllocator({ preview: options.preview ?? false,
    reserved: [...Object.keys(original.graph.nodes), ...Object.keys(original.graph.edges), ...Object.keys(baseline.graph.nodes), ...Object.keys(baseline.graph.edges), ...original.tombstones.nodes, ...original.tombstones.edges], next: options.nextId });
  const has = (ref: string) => Object.hasOwn(candidate.graph.nodes, ref);
  const existing = (ref: string, path: string) => {
    if (!Object.hasOwn(original.graph.nodes, ref) || !has(ref)) fail(path, `Node ${ref} must exist both before this request and at this operation.`, "Use a persisted ref that has not been removed; edit newly created nodes in a later request.");
  };
  const relation = (name: string, path: string) => {
    if (!Object.hasOwn(options.relations, name)) fail(path, `Unknown relation ${name}.`, "Use a registered relationship slot.");
    return options.relations[name]!;
  };
  const retireEdge = (id: string) => { delete candidate.graph.edges[id]; if (!candidate.tombstones.edges.includes(id)) candidate.tombstones.edges.push(id); };
  const addEdge = (from: string, to: string, relationType: string) => { const id = allocate("edge"); candidate.graph.edges[id] = { id, from, to, relationType }; };
  const noteNode = (ref: string, path: string, op: "set" | "remove" | "reset", before: string | null, after: string | null) => changes.push({ inputPath: path, op, ref, target: "node", before: before === null ? null : { nodeType: before }, after: after === null ? null : { nodeType: after } });
  const eraseMany = (refs: string[], path: string, op: "remove" | "reset" | "set") => {
    const removed = removableOwnedClosures(candidate.graph, options.relations, refs, path);
    for (const e of Object.values(candidate.graph.edges)) if (removed.has(e.from) || removed.has(e.to)) retireEdge(e.id);
    for (const id of removed) {
      noteNode(id, path, op, candidate.graph.nodes[id]!.nodeType, null);
      delete candidate.graph.nodes[id]; delete candidate.fieldIntents[id];
      if (!candidate.tombstones.nodes.includes(id)) candidate.tombstones.nodes.push(id);
    }
  };
  const erase = (ref: string, path: string, op: "remove" | "reset" | "set") => eraseMany([ref], path, op);
  const clone = (ref: string, path: string): string => {
    existing(ref, path);
    const map = new Map<string, string>(), pending = [ref];
    while (pending.length) {
      const id = pending.pop()!; if (map.has(id)) continue;
      map.set(id, allocate("node"));
      for (const e of Object.values(original.graph.edges)) if (e.from === id && relation(e.relationType, path).ownership === "owned") pending.push(e.to);
    }
    for (const [sourceRef, id] of map) {
      candidate.graph.nodes[id] = { ...structuredClone(original.graph.nodes[sourceRef]!), id };
      candidate.fieldIntents[id] = structuredClone(original.fieldIntents[sourceRef] ?? {});
      createdRefs.push({ path, ref: id, sourceRef });
      noteNode(id, path, "set", null, candidate.graph.nodes[id]!.nodeType);
    }
    for (const e of Object.values(original.graph.edges)) if (map.has(e.from)) {
      const target = map.get(e.to) ?? e.to;
      if (!has(target)) fail(path, `Clone references removed external node ${e.to}.`, "Keep the shared target alive or change the source in a separate edit before cloning.");
      addEdge(map.get(e.from)!, target, e.relationType);
    }
    return map.get(ref)!;
  };
  const expand = (spec: NodeInput, path: string): string => {
    if ("ref" in spec) { existing(spec.ref, path); return spec.ref; }
    if (spec.cloneFromRef !== undefined) return clone(spec.cloneFromRef, path);
    if (!options.nodeTypes.includes(spec.nodeType)) fail(path, `Unknown node type ${spec.nodeType}.`, "Use a registered nodeType and its field schema.");
    const id = allocate("node");
    candidate.graph.nodes[id] = { id, nodeType: spec.nodeType, fields: structuredClone(spec.fields) };
    candidate.fieldIntents[id] = declareFields(spec.fields);
    createdRefs.push({ path, ref: id }); noteNode(id, path, "set", null, spec.nodeType);
    for (const [slot, entries] of Object.entries(spec.relations ?? {})) {
      relation(slot, path);
      entries.forEach((entry, i) => addEdge(id, expand(entry, `${path}/relations/${pointer(slot)}/${i}`), slot));
    }
    return id;
  };
  const reset = (ref: string, path: string) => {
    const base = Object.hasOwn(baseline.graph.nodes, ref) ? baseline.graph.nodes[ref] : undefined;
    if (!base) { existing(ref, path); erase(ref, path, "reset"); return; }
    const parentEdges = Object.values(baseline.graph.edges).filter(e => e.to === ref && relation(e.relationType, path).ownership === "owned");
    const refs = Object.values(baseline.graph.edges).filter(e => e.from === ref && relation(e.relationType, path).ownership === "reference");
    for (const e of [...parentEdges, ...refs]) {
      const needed = e.to === ref ? e.from : e.to;
      if (needed !== ref && !has(needed)) fail(path, `Reset requires baseline endpoint ${needed}.`, "Restore the missing parent or reference target before resetting this node.");
    }
    const prior = candidate.graph.nodes[ref]?.nodeType ?? null;
    candidate.graph.nodes[ref] = structuredClone(base);
    candidate.fieldIntents[ref] = structuredClone(baseline.fieldIntents[ref] ?? {});
    candidate.tombstones.nodes = candidate.tombstones.nodes.filter(id => id !== ref);
    for (const e of Object.values(candidate.graph.edges)) if ((e.to === ref && relation(e.relationType, path).ownership === "owned") || (e.from === ref && relation(e.relationType, path).ownership === "reference")) retireEdge(e.id);
    for (const e of [...parentEdges, ...refs]) {
      if (Object.hasOwn(candidate.graph.edges, e.id)) fail(path, `Baseline edge identity ${e.id} is already occupied.`, "Resolve the conflicting graph identity before restoring this baseline.");
      candidate.graph.edges[e.id] = structuredClone(e);
      candidate.tombstones.edges = candidate.tombstones.edges.filter(id => id !== e.id);
    }
    noteNode(ref, path, "reset", prior, base.nodeType);
  };
  return { candidate, changes, expand, reset, existing, erase, eraseMany, relation, retireEdge, addEdge,
    finish() { return { candidate, changes, createdRefs: createdRefs.filter(c => has(c.ref)) }; } };
}

/** Atomic candidate-only topology pass. Does not edit fields, persist or authorize remote I/O. */
export function evaluateTopology(original: TopologyState, baseline: TopologySnapshot, raw: unknown, options: TopologyOptions) {
  const batch = parseEditBatch(raw);
  validateTopology(original.graph, options.relations, "");
  const e = evaluator(original, baseline, options);
  for (const [i, patch] of (batch.patches ?? []).entries()) e.existing(patch.ref, `/patches/${i}`);
  for (const [i, patch] of (batch.graphPatches ?? []).entries()) {
    const path = `/graphPatches/${i}`;
    if (patch.op === "remove") { e.existing(patch.ref, path); e.erase(patch.ref, path, "remove"); }
    else if (patch.op === "reset") e.reset(patch.ref, path);
    else {
      const from = patch.parentRef ?? patch.ref!;
      e.existing(from, path);
      const slot = decodeEditPath(patch.path)![0]!;
      const definition = e.relation(slot, path);
      const old = Object.values(e.candidate.graph.edges).filter(edge => edge.from === from && edge.relationType === slot);
      const before = old.map(edge => edge.to);
      if (patch.parentRef !== undefined) {
        if (definition.cardinality === "one" && old.length) fail(path, "The single-target slot is already occupied.", "Use ref/path with the full replacement array instead of parentRef append.");
        e.addEdge(from, e.expand(patch.value as NodeSpec, `${path}/value`), slot);
      } else {
        const next = (patch.value as NodeInput[]).map((spec, j) => e.expand(spec, `${path}/value/${j}`));
        for (const edge of old) if (!next.includes(edge.to)) e.retireEdge(edge.id);
        // Reclaim old owned children before introducing replacement ownership edges.
        if (definition.ownership === "owned") e.eraseMany(old.filter(edge => !next.includes(edge.to)).map(edge => edge.to), path, "set");
        for (const target of next) if (!old.some(edge => edge.to === target)) e.addEdge(from, target, slot);
        if (new Set(next).size !== next.length) fail(path, "The replacement repeats a target.", "List each target only once.");
      }
      const after = Object.values(e.candidate.graph.edges).filter(edge => edge.from === from && edge.relationType === slot).map(edge => edge.to);
      e.changes.push({ inputPath: path, op: "set", ref: from, target: "relation", path: patch.path!, before, after });
    }
    validateTopology(e.candidate.graph, options.relations, path);
  }
  for (const [i, patch] of (batch.patches ?? []).entries()) e.existing(patch.ref, `/patches/${i}`);
  return e.finish();
}

/** Create intent before storing a Draft. No existing identity can be referenced at birth. */
export function initializeTopology(raw: unknown, options: TopologyOptions) {
  const input = jsonSnapshot(raw, (path, message) => fail(path, message, "Provide plain finite JSON initial intent."));
  if (!isObject(input) || Object.keys(input).join() !== "roots" || !Array.isArray(input.roots) || !input.roots.length)
    fail("/roots", "Initial intent requires a nonempty roots array.", "Supply nodeType and initial fields for at least one root.");
  const roots = (input as { roots: Json[] }).roots;
  // Reuse the strict spec boundary; rebase errors to the create request coordinates.
  let specs: NodeSpec[];
  try {
    const parsed = parseEditBatch({ graphPatches: roots.map(value => ({ op: "set", parentRef: "initial", path: "/roots", value })) });
    specs = parsed.graphPatches!.map(p => (p as { value: NodeSpec }).value);
  } catch (error) {
    if (error instanceof EditInputError) throw new EditInputError(error.issues.map(i => ({ ...i, path: i.path.replace(/^\/graphPatches\/(\d+)\/value/, "/roots/$1") })));
    throw error;
  }
  const empty: TopologyState = { graph: { nodes: {}, edges: {} }, fieldIntents: {}, tombstones: { nodes: [], edges: [] } };
  const e = evaluator(empty, empty, options);
  specs.forEach((spec, i) => e.expand(spec, `/roots/${i}`));
  validateTopology(e.candidate.graph, options.relations, "/roots");
  return e.finish();
}
