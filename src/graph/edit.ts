import type { DefinitionRegistry } from "../registry/registry.js";
import { isObject, jsonSnapshot, pointer } from "../registry/json.js";
import type { Value } from "../types.js";
import { GraphEditError, type GraphDraft, type GraphOp, type EditEvaluation, type GraphChange, type GraphIssue } from "./types.js";

const safeName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && !["__proto__", "prototype", "constructor"].includes(value);

/** Pure candidate evaluation over a trusted engine snapshot and immutable registry.
 * No storage writes, generated IDs, remote calls or mutation of caller inputs. */
export function evaluateGraphEdit(registry: DefinitionRegistry, draft: GraphDraft, expectedVersion: number, ops: readonly GraphOp[]): EditEvaluation {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion !== draft.version) throw new GraphEditError("STALE_VERSION");
  if (draft.version === Number.MAX_SAFE_INTEGER) throw new GraphEditError("VERSION_EXHAUSTED");
  const { definition, digest } = registry.getDefinition(draft);
  if (digest !== draft.definitionDigest) throw new GraphEditError("DEFINITION_MISMATCH");
  const jsonIssues: GraphIssue[] = [];
  const input = jsonSnapshot(ops, (path, message) => jsonIssues.push({ path, message }));
  if (jsonIssues.length || !Array.isArray(input)) throw new GraphEditError("INVALID_OP", undefined, undefined, jsonIssues);
  if (!input.length) throw new GraphEditError("EMPTY_OP_BATCH");
  const candidate = structuredClone(draft);
  const changes: GraphChange[] = [];
  const usedNodes = new Set([...Object.keys(candidate.nodes), ...candidate.tombstones.nodes]);
  const usedEdges = new Set([...Object.keys(candidate.edges), ...candidate.tombstones.edges]);
  for (const [opIndex, raw] of input.entries()) {
    const fail = (code: string, path?: string): never => { throw new GraphEditError(code, opIndex, path); };
    if (!isObject(raw) || typeof raw.op !== "string") fail("INVALID_OP");
    // Validate raw JSON even when a caller bypasses the TypeScript signature.
    const op = raw as Record<string, unknown>;
    const shapes: Record<string, string[]> = {
      "node.add": ["op", "id", "nodeType"], "node.remove": ["op", "id"],
      "edge.add": ["op", "id", "relationType", "from", "to"], "edge.remove": ["op", "id"],
      set: ["op", "nodeId", "path", "value"], remove: ["op", "nodeId", "path"], reset: ["op", "nodeId", "path"]
    };
    const allowed = Object.hasOwn(shapes, String(op.op)) ? shapes[String(op.op)] : undefined;
    if (!allowed || Object.keys(op).length !== allowed.length || Object.keys(op).some(k => !allowed.includes(k))) fail("INVALID_OP");
    const note = (target: GraphChange["target"], id: string, before: GraphChange["before"], after: GraphChange["after"], path?: string) => {
      changes.push(structuredClone({ opIndex, target, id, ...(path === undefined ? {} : { path }), before, after }));
    };
    if (op.op === "node.add" || op.op === "node.remove") {
      if (!safeName(op.id)) fail("INVALID_OP", "/id");
      const id = op.id as string;
      if (op.op === "node.add") {
        if (!safeName(op.nodeType)) fail("INVALID_OP", "/nodeType");
        if (!Object.hasOwn(definition.nodeTypes, op.nodeType as string)) fail("NODE_TYPE_NOT_FOUND", "/nodeType");
        if (usedNodes.has(id)) fail("ID_ALREADY_USED", "/id");
        const node = { id, nodeType: op.nodeType as string, fields: {} };
        candidate.nodes[id] = node;
        usedNodes.add(id);
        note("node", id, null, node);
      } else {
        if (!Object.hasOwn(candidate.nodes, id)) fail("NODE_NOT_FOUND", "/id");
        note("node", id, candidate.nodes[id]!, null);
        delete candidate.nodes[id];
        candidate.tombstones.nodes.push(id);
      }
    } else if (op.op === "edge.add" || op.op === "edge.remove") {
      if (!safeName(op.id)) fail("INVALID_OP", "/id");
      const id = op.id as string;
      if (op.op === "edge.add") {
        if (![op.relationType, op.from, op.to].every(safeName)) fail("INVALID_OP");
        if (usedEdges.has(id)) fail("ID_ALREADY_USED", "/id");
        const edge = { id, relationType: op.relationType as string, from: op.from as string, to: op.to as string };
        candidate.edges[id] = edge;
        usedEdges.add(id);
        note("edge", id, null, edge);
      } else {
        if (!Object.hasOwn(candidate.edges, id)) fail("EDGE_NOT_FOUND", "/id");
        note("edge", id, candidate.edges[id]!, null);
        delete candidate.edges[id];
        candidate.tombstones.edges.push(id);
      }
    } else {
      if (!safeName(op.nodeId) || typeof op.path !== "string") fail("INVALID_OP");
      const nodeId = op.nodeId as string, path = op.path as string;
      if (!Object.hasOwn(candidate.nodes, nodeId)) fail("NODE_NOT_FOUND", path);
      if (!path.startsWith("/") || path.slice(1).includes("/") || /~(?![01])/.test(path)) fail("UNSUPPORTED_PATH", path);
      const fieldName = path.slice(1).replaceAll("~1", "/").replaceAll("~0", "~");
      const node = candidate.nodes[nodeId]!;
      if (!Object.hasOwn(definition.nodeTypes[node.nodeType]!.valueSchema.properties, fieldName)) fail("UNKNOWN_FIELD", path);
      const before = node.fields[fieldName] ?? null;
      if (op.op === "set") {
        const value = op.value;
        if (value !== null && !["string", "number", "boolean"].includes(typeof value)) fail("INVALID_OP", path);
        node.fields[fieldName] = { kind: "value", value: value as Value };
      } else if (op.op === "remove") node.fields[fieldName] = { kind: "clear" };
      else delete node.fields[fieldName];
      note("field", nodeId, before, node.fields[fieldName] ?? null, path);
    }
  }
  const issues: GraphIssue[] = [];
  for (const node of Object.values(candidate.nodes)) {
    const values: Record<string, Value> = {};
    for (const [name, field] of Object.entries(node.fields)) if (field.kind === "value") values[name] = field.value;
    const result = registry.validateValues(candidate, node.nodeType, values);
    for (const issue of result.issues) issues.push({ path: `/nodes/${pointer(node.id)}/fields${issue.path}`, message: issue.message });
  }
  for (const edge of Object.values(candidate.edges)) {
    const path = `/edges/${pointer(edge.id)}`;
    const relation = Object.hasOwn(definition.relationTypes, edge.relationType) ? definition.relationTypes[edge.relationType] : undefined;
    if (!relation) { issues.push({ path: `${path}/relationType`, message: "Unknown relation type" }); continue; }
    for (const end of ["from", "to"] as const) {
      const node = Object.hasOwn(candidate.nodes, edge[end]) ? candidate.nodes[edge[end]] : undefined;
      if (!node) issues.push({ path: `${path}/${end}`, message: "Dangling node reference" });
      else if (!relation[end].includes(node.nodeType)) issues.push({ path: `${path}/${end}`, message: "Node type is not allowed at this endpoint" });
    }
  }
  if (issues.length) throw new GraphEditError("INVALID_GRAPH", undefined, undefined, issues);
  candidate.version++;
  return { candidate, changes };
}
