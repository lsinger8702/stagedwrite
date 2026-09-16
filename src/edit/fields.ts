import type { DefinitionRegistry } from "../registry/registry.js";
import type { DefinitionSelector } from "../registry/types.js";
import { canonicalJson, isObject, pointer, type Json } from "../registry/json.js";
import { EditInputError, decodeEditPath, parseEditBatch, type FieldPatch } from "./protocol.js";
import { declareFields, type FieldDeclaration, type TopologySnapshot, type TopologyState } from "./evaluate-topology.js";
import type { EditChange, EditFieldState } from "./results.js";
const fail = (path: string, message: string, hint: string): never => { throw new EditInputError([{ code: "INVALID_EDIT_INPUT", path, message, hint }]); };
const encoded = (parts: string[]) => `/${parts.map(pointer).join("/")}`;
const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
function locate(schema: Record<string, Json>, parts: string[], at: string): Record<string, Json> {
  let current = schema;
  for (const part of parts) {
    if (!isObject(current.properties) || !Object.hasOwn(current.properties, part)) fail(at, "Path is not a registered object field; array indexing is not supported.", "Use a registered field path. Replace an entire array rather than addressing its elements.");
    current = (current.properties as Record<string, Record<string, Json>>)[part]!;
  }
  return current;
}
/** Reject contradictory representations instead of trusting graph values over declarations. */
export function projectDeclarations(intents: Record<string, FieldDeclaration>): Record<string, Json> {
  const fields: Record<string, Json> = {};
  for (const [path, intent] of Object.entries(intents).sort(([a], [b]) => a.split("/").length - b.split("/").length)) {
    const parts = decodeEditPath(path);
    if (!parts) fail(path, "Invalid persisted intent path.", "Load a valid canonical intent snapshot.");
    let parent = fields;
    for (const part of parts!.slice(0, -1)) {
      const child = Object.hasOwn(parent, part) ? parent[part] : undefined;
      if (!isObject(child)) fail(path, "An intent descendant lacks an explicit object parent.", "Preserve normalized object presence and its child declarations together.");
      parent = child as Record<string, Json>;
    }
    if (intent.kind === "set") {
      if (isObject(intent.value) && Object.keys(intent.value).length) fail(path, "Object declaration duplicates child values.", "Store object presence as set {} and values in child declarations.");
      parent[parts![parts!.length - 1]!] = structuredClone(intent.value);
    } else if (intent.kind !== "remove") fail(path, "Unknown persisted declaration kind.", "Persist set/remove only; reset is an operation.");
  }
  return fields;
}
function stateAt(intents: Record<string, FieldDeclaration>, path: string): EditFieldState {
  const parts = decodeEditPath(path)!;
  for (let n = 1; n <= parts.length; n++) {
    if (intents[encoded(parts.slice(0, n))]?.kind === "remove") return { kind: "remove" };
  }
  const intent = intents[path];
  if (!intent) return { kind: "undeclared" };
  let value: Json = projectDeclarations(intents);
  for (const part of parts) value = (value as Record<string, Json>)[part]!;
  return { kind: "set", value: structuredClone(value) };
}
export function evaluateFields(registry: DefinitionRegistry, selector: DefinitionSelector, current: TopologyState, baseline: TopologySnapshot, raw: readonly FieldPatch[]) {
  const patches = raw.length ? parseEditBatch({ patches: raw }).patches! : [];
  const candidate = structuredClone(current), changes: EditChange[] = [];
  for (const [ref, node] of Object.entries(current.graph.nodes)) {
    if (canonicalJson(projectDeclarations(current.fieldIntents[ref] ?? {})) !== canonicalJson(node.fields)) fail(`/nodes/${pointer(ref)}`, "Intent projection does not match graph fields.", "Load the graph and field declarations from the same atomic snapshot.");
  }
  for (const [index, patch] of patches.entries()) {
    const at = `/patches/${index}`;
    if (!Object.hasOwn(candidate.graph.nodes, patch.ref)) fail(at, `Missing field target ${patch.ref}.`, "Use an existing node that survived the topology edits.");
    const node = candidate.graph.nodes[patch.ref]!;
    const schema = registry.getValueSchema(selector, node.nodeType);
    const parts = decodeEditPath(patch.path)!;
    locate(schema, parts, at);
    const intents = candidate.fieldIntents[patch.ref] ??= {};
    const before = stateAt(intents, patch.path);
    // Expand a removed parent only as needed, retaining untouched siblings' clear declarations.
    for (let n = 1; n < parts.length; n++) {
      const prefix = encoded(parts.slice(0, n));
      const parentSchema = locate(schema, parts.slice(0, n), at);
      if (!isObject(parentSchema.properties)) fail(at, "Cannot edit a child of a non-object field.", "Replace the containing field as a whole.");
      const prior = intents[prefix];
      if (prior?.kind === "set" && !isObject(prior.value)) fail(at, "Cannot silently replace an explicit null or scalar parent.", "Set the parent to an object first, then apply the child edit.");
      if (prior?.kind === "remove") for (const key of Object.keys(parentSchema.properties as Record<string, Json>)) intents[`${prefix}/${pointer(key)}`] = { kind: "remove" };
      intents[prefix] = { kind: "set", value: {} };
    }
    for (const key of Object.keys(intents)) if (under(key, patch.path)) delete intents[key];
    if (patch.op === "set") {
      const last = parts[parts.length - 1]!;
      const prefix = parts.length === 1 ? "" : encoded(parts.slice(0, -1));
      for (const [path, declaration] of Object.entries(declareFields({ [last]: patch.value }))) intents[`${prefix}${path}`] = declaration;
    } else if (patch.op === "remove") intents[patch.path] = { kind: "remove" };
    else {
      const source = baseline.fieldIntents[patch.ref] ?? {};
      const effective = stateAt(source, patch.path);
      if (effective.kind === "remove") intents[patch.path] = { kind: "remove" };
      else for (const [path, declaration] of Object.entries(source)) if (under(path, patch.path)) intents[path] = structuredClone(declaration);
    }
    node.fields = projectDeclarations(intents);
    changes.push({ inputPath: at, op: patch.op, ref: patch.ref, scope: "canonical", target: "field", path: patch.path, before, after: stateAt(intents, patch.path) });
  }
  for (const node of Object.values(candidate.graph.nodes)) {
    const result = registry.validateValues(selector, node.nodeType, node.fields);
    if (!result.valid) throw new EditInputError(result.issues.map(issue => ({ code: "INVALID_EDIT_INPUT", path: `/nodes/${pointer(node.id)}/fields${issue.path}`, message: issue.message, hint: "Provide fields matching the registered schema; no changes in this batch were stored." })));
  }
  return { candidate, changes };
}

/** Flattened field preview for diagnostics: includes undeclared registered paths.
 * Object values are reconstructed, not the internal set {} presence marker. */
export function previewFields(registry: DefinitionRegistry, selector: DefinitionSelector, snapshot: TopologySnapshot) {
  const nodes: Record<string, Record<string, EditFieldState>> = {};
  for (const [ref, node] of Object.entries(snapshot.graph.nodes)) {
    const schema = registry.getValueSchema(selector, node.nodeType);
    const intents = snapshot.fieldIntents[ref] ?? {};
    const fields: Record<string, EditFieldState> = {};
    const visit = (current: Record<string, Json>, parts: string[]) => {
      if (parts.length) fields[encoded(parts)] = stateAt(intents, encoded(parts));
      if (isObject(current.properties)) for (const [key, child] of Object.entries(current.properties)) visit(child as Record<string, Json>, [...parts, key]);
    };
    visit(schema, []); nodes[ref] = fields;
  }
  return nodes;
}
