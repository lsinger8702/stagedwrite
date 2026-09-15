import { DefinitionRegistry } from "../registry/registry.js";
import { definitionDigest, type Json, pointer } from "../registry/json.js";
import { evaluateGraphEdit } from "../graph/edit.js";
import type { GraphDraft, GraphOp } from "../graph/types.js";
import type { ManagedDraft, IntentSnapshot, ManagedInitialIntent } from "./types.js";
export const same = (a: unknown, b: unknown) => definitionDigest(a as Json) === definitionDigest(b as Json);
export const snapshot = (d: IntentSnapshot): IntentSnapshot => structuredClone({ graph: d.graph, fieldIntents: d.fieldIntents });
export function toInternal(d: ManagedDraft): GraphDraft {
    const nodes: GraphDraft["nodes"] = {};
    for (const [id, node] of Object.entries(d.graph.nodes)) {
        const fields: GraphDraft["nodes"][string]["fields"] = {};
        for (const [path, intent] of Object.entries(d.fieldIntents[id] ?? {})) {
            if (!path.startsWith("/") || path.slice(1).includes("/") || /~(?![01])/.test(path))
                throw new Error("INTENT_PROJECTION_MISMATCH");
            const key = path.slice(1).replaceAll("~1", "/").replaceAll("~0", "~");
            if (intent.kind === "set")
                fields[key] = { kind: "value", value: intent.value };
            else if (intent.kind === "remove")
                fields[key] = { kind: "clear" };
            else
                throw new Error("INTENT_PROJECTION_MISMATCH");
        }
        const values = Object.fromEntries(Object.entries(fields).filter(([, f]) => f.kind === "value").map(([k, f]) => [k, f.kind === "value" ? f.value : null]));
        if (!same(values, node.fields) || node.id !== id)
            throw new Error("INTENT_PROJECTION_MISMATCH");
        nodes[id] = { id, nodeType: node.nodeType, fields };
    }
    if (Object.keys(d.fieldIntents).some(id => !nodes[id]))
        throw new Error("INTENT_PROJECTION_MISMATCH");
    return { id: d.id, version: d.version, type: d.type, typeVersion: d.typeVersion, definitionDigest: d.definitionDigest, nodes, edges: structuredClone(d.graph.edges), tombstones: structuredClone(d.tombstones) };
}
export function fromInternal(d: GraphDraft): IntentSnapshot {
    const result: IntentSnapshot = { graph: { nodes: {}, edges: structuredClone(d.edges) }, fieldIntents: {} };
    for (const [id, n] of Object.entries(d.nodes)) {
        const fields: ManagedInitialIntent["nodes"][string]["fields"] = {};
        const intents: IntentSnapshot["fieldIntents"][string] = {};
        for (const [key, f] of Object.entries(n.fields)) {
            intents[`/${pointer(key)}`] = f.kind === "value" ? { kind: "set", value: f.value } : { kind: "remove" };
            if (f.kind === "value")
                fields[key] = f.value;
        }
        result.graph.nodes[id] = { id, nodeType: n.nodeType, fields };
        result.fieldIntents[id] = intents;
    }
    return result;
}
export function initialize(registry: DefinitionRegistry, draft: ManagedDraft, initial: ManagedInitialIntent): ManagedDraft {
    if (!initial || !initial.nodes || !initial.edges || Object.keys(initial).sort().join() !== "edges,nodes" || !Object.keys(initial.nodes).length)
        throw new Error("INITIAL_INTENT_REQUIRED");
    const ops: GraphOp[] = [];
    for (const [id, node] of Object.entries(initial.nodes)) {
        if (id !== node.id || Object.keys(node).sort().join() !== "fields,id,nodeType")
            throw new Error("INVALID_INITIAL_INTENT");
        ops.push({ op: "node.add", id, nodeType: node.nodeType });
        for (const [key, value] of Object.entries(node.fields))
            ops.push({ op: "set", nodeId: id, path: `/${pointer(key)}`, value });
    }
    for (const [id, edge] of Object.entries(initial.edges)) {
        if (id !== edge.id || Object.keys(edge).sort().join() !== "from,id,relationType,to")
            throw new Error("INVALID_INITIAL_INTENT");
        ops.push({ op: "edge.add", id, relationType: edge.relationType, from: edge.from, to: edge.to });
    }
    const out = evaluateGraphEdit(registry, toInternal(draft), 0, ops).candidate;
    return { ...draft, ...fromInternal(out), initialSnapshot: fromInternal(out) };
}
export function editIntent(registry: DefinitionRegistry, draft: ManagedDraft, baseline: IntentSnapshot, version: number, ops: readonly GraphOp[]) {
    // A fixed baseline for the entire batch. Reset never means "undo the previous OP".
    const restored = ops.map(op => {
        if (op.op !== "reset")
            return op;
        const intent = baseline.fieldIntents[op.nodeId]?.[op.path];
        return intent?.kind === "set" ? { op: "set" as const, nodeId: op.nodeId, path: op.path, value: intent.value }
            : intent?.kind === "remove" ? { op: "remove" as const, nodeId: op.nodeId, path: op.path } : op;
    });
    const { candidate, changes } = evaluateGraphEdit(registry, toInternal(draft), version, restored);
    return { candidate: { ...draft, ...fromInternal(candidate), version: candidate.version, tombstones: candidate.tombstones, status: "pending" as const, updatedAt: new Date().toISOString() }, changes };
}
