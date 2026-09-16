/** Structural schema for the edit batch payload. The evaluator additionally checks
 * coordinate uniqueness, registered schema, graph identities, version and Run guards.
 * Kept internal until the managed public API accepts this protocol. */
const string = { type: "string", minLength: 1 };
const fieldPath = { type: "string", pattern: "^/([^~/]|~[01])+(\/([^~/]|~[01])+)*$" };
const relationPath = { type: "string", pattern: "^/([^~/]|~[01])+$" };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
export const editBatchSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...object({
    graphPatches: { type: "array", items: ref("topology") },
    patches: { type: "array", items: ref("field") }
  }, []),
  anyOf: [
    { required: ["patches"], properties: { patches: { minItems: 1 } } },
    { required: ["graphPatches"], properties: { graphPatches: { minItems: 1 } } }
  ],
  $defs: {
    json: { anyOf: [
      { type: ["null", "string", "number", "boolean"] },
      { type: "array", items: ref("json") },
      { type: "object", additionalProperties: ref("json") }
    ] },
    field: { oneOf: [
      object({ op: { const: "set" }, ref: string, scope: { const: "canonical" }, path: fieldPath, value: ref("json") }),
      object({ op: { enum: ["remove", "reset"] }, ref: string, scope: { const: "canonical" }, path: fieldPath })
    ] },
    node: { oneOf: [
      object({ nodeType: string, fields: { type: "object", additionalProperties: ref("json") },
        relations: { type: "object", additionalProperties: { type: "array", items: ref("nodeInput") } }
      }, ["nodeType", "fields"]),
      object({ cloneFromRef: string })
    ] },
    nodeInput: { oneOf: [ref("node"), object({ ref: string })] },
    topology: { oneOf: [
      object({ op: { const: "set" }, parentRef: string, path: relationPath, value: ref("node") }),
      object({ op: { const: "set" }, ref: string, path: relationPath, value: { type: "array", items: ref("nodeInput") } }),
      object({ op: { enum: ["remove", "reset"] }, ref: string })
    ] }
  }
};
