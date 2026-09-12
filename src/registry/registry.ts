import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { deepFreeze, definitionDigest, isObject, jsonSnapshot, pointer, type Json } from "./json.js";
import { checkValueSchema } from "./profile.js";
import type { DefinitionIssue, DefinitionSelector, DraftTypeDefinition, ValueIssue } from "./types.js";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const identity = (type: string, version: string) => JSON.stringify([type, version]);
export class DefinitionAssemblyError extends Error {
  readonly issues: readonly DefinitionIssue[];
  constructor(issues: DefinitionIssue[]) {
    const sorted = [...issues].sort((a, b) => compare(a.definitionId, b.definitionId) || compare(a.version, b.version) || compare(a.path, b.path) || compare(a.code, b.code) || compare(a.message, b.message));
    super(`DEFINITION_ASSEMBLY_FAILED: ${sorted.length} issue(s)`);
    this.name = "DefinitionAssemblyError";
    this.issues = deepFreeze(sorted);
  }
}
interface Entry {
  definition: DraftTypeDefinition;
  digest: string;
  validators: Map<string, ValidateFunction>;
}

/** Instance-owned, atomically assembled registry. No registration mutation API. */
export class DefinitionRegistry {
  #entries: Map<string, Entry>;
  constructor(definitions: readonly unknown[]) {
    const issues: DefinitionIssue[] = [];
    const entries = new Map<string, Entry>();
    // No loadSchema: only our already-resolved local profile is compiled synchronously.
    const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false, ownProperties: true });
    if (!Array.isArray(definitions)) throw new DefinitionAssemblyError([{ code: "INVALID_DEFINITION", definitionId: "", version: "", path: "/definitions", message: "definitions must be an array" }]);
    for (const raw of definitions) {
      const start = issues.length;
      let definitionId = "", version = "";
      const report = (code: DefinitionIssue["code"], path: string, message: string, detail: { target?: string; chain?: string[] } = {}) => {
        issues.push({ code, definitionId, version, path, message, ...detail });
      };
      const snapshot = jsonSnapshot(raw, (path, message) => report("INVALID_DEFINITION", path, message));
      if (isObject(snapshot)) {
        definitionId = typeof snapshot.id === "string" ? snapshot.id : "";
        version = typeof snapshot.version === "string" ? snapshot.version : "";
        for (let i = start; i < issues.length; i++) Object.assign(issues[i]!, { definitionId, version });
      }
      if (issues.length !== start) continue;
      if (!isObject(snapshot)) { report("INVALID_DEFINITION", "", "Definition must be an object"); continue; }
      const invalid = (path: string, message: string) => report("INVALID_DEFINITION", path, message);
      function keys(obj: Record<string, Json>, allowed: string[], path: string) {
        for (const k of Object.keys(obj)) if (!allowed.includes(k)) invalid(`${path}/${pointer(k)}`, "Unknown definition field");
      }
      keys(snapshot, ["id", "version", "nodeTypes", "relationTypes"], "");
      if (!definitionId.trim()) invalid("/id", "id must be a nonempty string");
      if (!version.trim()) invalid("/version", "version must be a nonempty string");
      const nodes = snapshot.nodeTypes;
      const relations = snapshot.relationTypes;
      if (!isObject(nodes) || Object.keys(nodes).length === 0) invalid("/nodeTypes", "At least one node type is required");
      if (!isObject(relations)) invalid("/relationTypes", "relationTypes must be an object (possibly empty)");
      const schemas = new Map<string, Record<string, Json>>();
      if (isObject(nodes)) for (const [name, node] of Object.entries(nodes)) {
        const path = `/nodeTypes/${pointer(name)}`;
        if (!name.trim()) invalid(path, "Node type name must be nonempty");
        if (!isObject(node)) { invalid(path, "Node type must be an object"); continue; }
        keys(node, ["valueSchema", "requiredAtPublish"], path);
        const schema = checkValueSchema(node.valueSchema, `${path}/valueSchema`, report);
        if (schema) schemas.set(name, schema);
        if ("requiredAtPublish" in node) {
          const required = node.requiredAtPublish;
          if (!Array.isArray(required) || required.some(n => typeof n !== "string")) invalid(`${path}/requiredAtPublish`, "Expected an array of field names");
          else {
            if (new Set(required).size !== required.length) invalid(`${path}/requiredAtPublish`, "Duplicate required field");
            required.forEach((field, i) => {
              if (typeof field === "string" && (!isObject(node.valueSchema) || !isObject(node.valueSchema.properties) || !Object.hasOwn(node.valueSchema.properties, field))) invalid(`${path}/requiredAtPublish/${i}`, "Required field is not declared in properties");
            });
          }
        }
      }
      if (isObject(relations)) for (const [name, relation] of Object.entries(relations)) {
        const path = `/relationTypes/${pointer(name)}`;
        if (!name.trim()) invalid(path, "Relation type name must be nonempty");
        if (!isObject(relation)) { invalid(path, "Relation type must be an object"); continue; }
        keys(relation, ["from", "to"], path);
        for (const end of ["from", "to"]) {
          const names = relation[end];
          if (!Array.isArray(names) || !names.length) { invalid(`${path}/${end}`, "Expected a nonempty node type array"); continue; }
          if (new Set(names).size !== names.length) invalid(`${path}/${end}`, "Duplicate node type");
          names.forEach((name, i) => {
            if (typeof name !== "string" || !isObject(nodes) || !Object.hasOwn(nodes, name)) invalid(`${path}/${end}/${i}`, "Unknown node type");
          });
        }
      }
      // Do not compile anything that failed the local profile gate.
      if (issues.length !== start) continue;
      const validators = new Map<string, ValidateFunction>();
      for (const [name, schema] of schemas) {
        try { validators.set(name, ajv.compile(schema)); }
        catch (error) { invalid(`/nodeTypes/${pointer(name)}/valueSchema`, error instanceof Error ? error.message : "Schema compilation failed"); }
      }
      if (issues.length !== start) continue;
      const digest = definitionDigest(snapshot);
      const key = identity(definitionId, version);
      const existing = entries.get(key);
      if (existing && existing.digest !== digest) { report("DEFINITION_CONFLICT", "", "Same id/version has different definition content"); continue; }
      if (!existing) entries.set(key, { definition: deepFreeze(snapshot) as unknown as DraftTypeDefinition, digest, validators });
    }
    if (issues.length) throw new DefinitionAssemblyError(issues);
    this.#entries = entries;
  }
  #entry(selector: DefinitionSelector): Entry {
    if (!selector || typeof selector.type !== "string" || typeof selector.typeVersion !== "string") throw new Error("TYPE_VERSION_NOT_FOUND");
    const entry = this.#entries.get(identity(selector.type, selector.typeVersion));
    if (!entry) throw new Error("TYPE_VERSION_NOT_FOUND");
    return entry;
  }
  selectors(): DefinitionSelector[] {
    return [...this.#entries.values()].map(({ definition }) => ({ type: definition.id, typeVersion: definition.version }));
  }
  getDefinition(selector: DefinitionSelector): { definition: DraftTypeDefinition; digest: string } {
    const entry = this.#entry(selector);
    return { definition: structuredClone(entry.definition), digest: entry.digest };
  }
  /** Pure filled-value check, not intent interpretation or publish completeness. */
  validateValues(selector: DefinitionSelector, nodeType: string, values: unknown): { valid: boolean; issues: ValueIssue[] } {
    const validate = this.#entry(selector).validators.get(nodeType);
    if (!validate) throw new Error("NODE_TYPE_NOT_FOUND");
    const issues: ValueIssue[] = [];
    const snapshot = jsonSnapshot(values, (path, message) => issues.push({ path, keyword: "json", message }));
    if (issues.length) return { valid: false, issues };
    const valid = validate(snapshot);
    return { valid: !!valid, issues: (validate.errors ?? []).map(e => ({ path: e.instancePath, keyword: e.keyword, message: e.message ?? "Invalid value" })) };
  }
}
