import { isObject, pointer, type Json } from "./json.js";
import type { DefinitionErrorCode } from "./types.js";

type Report = (code: DefinitionErrorCode, path: string, message: string, detail?: { target?: string; chain?: string[] }) => void;
export const dialect = "https://json-schema.org/draft/2020-12/schema";
const scalars = new Set(["string", "number", "integer", "boolean"]);

/** Validate the restricted profile and resolve local refs before handing data to Ajv.
 * There is deliberately no URI loader, remote resolver or cross-document registry. */
export function checkValueSchema(input: Json | undefined, path: string, report: Report): Record<string, Json> | undefined {
  const invalid = (at: string, message: string) => report("INVALID_DEFINITION", at, message);
  const unsupported = (at: string, message: string, detail: { target?: string; chain?: string[] } = {}) => report("UNSUPPORTED_SCHEMA_FEATURE", at, message, detail);
  function keys(obj: Record<string, Json>, allowed: string[], at: string) {
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) unsupported(`${at}/${pointer(key)}`, "Keyword is outside the M1 profile");
  }
  function metadata(obj: Record<string, Json>, at: string) {
    for (const k of ["title", "description"]) if (k in obj && typeof obj[k] !== "string") invalid(`${at}/${k}`, "Metadata must be a string");
  }
  if (!isObject(input)) { invalid(path, "valueSchema must be an object"); return; }
  keys(input, ["$schema", "$defs", "type", "properties", "additionalProperties", "title", "description"], path);
  metadata(input, path);
  if (input.type !== "object") invalid(`${path}/type`, "Root type must be object");
  if (input.additionalProperties !== false) invalid(`${path}/additionalProperties`, "additionalProperties must be explicitly false");
  if ("$schema" in input && input.$schema !== dialect) unsupported(`${path}/$schema`, "Only JSON Schema 2020-12 is supported");
  if (!isObject(input.properties)) invalid(`${path}/properties`, "properties must be an object");
  if ("$defs" in input && !isObject(input.$defs)) invalid(`${path}/$defs`, "$defs must be an object");
  const defs = isObject(input.$defs) ? input.$defs : {};
  const cache = new Map<string, Record<string, Json> | undefined>();
  function resolve(schema: Json | undefined, at: string, chain: string[]): Record<string, Json> | undefined {
    if (!isObject(schema)) { invalid(at, "Expected a scalar schema or reference object"); return; }
    if ("$ref" in schema) {
      keys(schema, ["$ref"], at);
      const ref = schema.$ref;
      if (typeof ref !== "string") { invalid(`${at}/$ref`, "$ref must be a string"); return; }
      if (!ref.startsWith("#/$defs/") || ref.slice(8).includes("/")) {
        unsupported(`${at}/$ref`, "Only #/$defs/<name> references are supported", { target: ref, chain }); return;
      }
      const encoded = ref.slice(8);
      if (/~(?![01])/.test(encoded) || /%(?![0-9a-fA-F]{2})/.test(encoded)) {
        report("INVALID_DEFINITION", `${at}/$ref`, "Invalid reference escape", { target: ref }); return;
      }
      // URI percent encoding is outside this profile; JSON Pointer escapes are supported.
      if (encoded.includes("%")) { unsupported(`${at}/$ref`, "Use literal names and JSON Pointer ~0/~1 escapes", { target: ref, chain }); return; }
      const name = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
      if (!Object.hasOwn(defs, name)) { report("SCHEMA_REF_NOT_FOUND", `${at}/$ref`, "Reference target is missing", { target: ref, chain: [...chain, name] }); return; }
      if (chain.includes(name)) { report("SCHEMA_REF_CYCLE", `${at}/$ref`, "Reference cycle", { target: ref, chain: [...chain, name] }); return; }
      return resolveDef(name, chain);
    }
    keys(schema, ["type", "title", "description", "enum", "minimum", "maximum", "minLength", "maxLength"], at);
    metadata(schema, at);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const base = types.find(t => typeof t === "string" && scalars.has(t));
    const validType = base !== undefined && (types.length === 1 && !Array.isArray(schema.type) ||
      types.length === 2 && types.includes("null") && new Set(types).size === 2);
    if (!validType) unsupported(`${at}/type`, "Expected one scalar type, optionally unioned with null");
    for (const k of ["minimum", "maximum"]) if (k in schema) {
      if (base !== "number" && base !== "integer") unsupported(`${at}/${k}`, "Numeric constraint requires a numeric type");
      if (typeof schema[k] !== "number") invalid(`${at}/${k}`, "Expected a finite number");
    }
    for (const k of ["minLength", "maxLength"]) if (k in schema) {
      if (base !== "string") unsupported(`${at}/${k}`, "Length constraint requires a string type");
      if (!Number.isSafeInteger(schema[k]) || (schema[k] as number) < 0) invalid(`${at}/${k}`, "Expected a nonnegative safe integer");
    }
    for (const [low, high] of [["minimum", "maximum"], ["minLength", "maxLength"]] as const) {
      if (typeof schema[low] === "number" && typeof schema[high] === "number" && schema[low] > schema[high]) invalid(at, `${low} exceeds ${high}`);
    }
    if ("enum" in schema) {
      if (!Array.isArray(schema.enum) || schema.enum.length === 0) invalid(`${at}/enum`, "enum must be a nonempty array");
      else {
        if (new Set(schema.enum.map(v => JSON.stringify(v))).size !== schema.enum.length) invalid(`${at}/enum`, "enum values must be unique");
        schema.enum.forEach((value, i) => {
          const matches = value === null ? types.includes("null") : base === "integer" ? typeof value === "number" && Number.isInteger(value) : typeof value === base;
          if (!matches) invalid(`${at}/enum/${i}`, "enum value must match the declared scalar type");
        });
      }
    }
    return schema;
  }
  function resolveDef(name: string, chain: string[]): Record<string, Json> | undefined {
    if (cache.has(name)) return cache.get(name);
    const resolved = resolve(defs[name], `${path}/$defs/${pointer(name)}`, [...chain, name]);
    cache.set(name, resolved);
    return resolved;
  }
  for (const name of Object.keys(defs).sort()) resolveDef(name, []);
  const properties: Record<string, Json> = {};
  if (isObject(input.properties)) for (const name of Object.keys(input.properties).sort()) {
    const resolved = resolve(input.properties[name], `${path}/properties/${pointer(name)}`, []);
    if (resolved) properties[name] = resolved;
  }
  return { $schema: dialect, type: "object", properties, additionalProperties: false };
}
