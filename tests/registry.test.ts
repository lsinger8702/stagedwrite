import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createStagedWrite, defineDraftType, DefinitionAssemblyError } from "../src/index.js";
import type { DefinitionIssue } from "../src/index.js";
import { canonicalJson, definitionDigest } from "../src/registry/json.js";
import { DefinitionRegistry } from "../src/registry/registry.js";
const assemble = ({ definitions }: {
    definitions: readonly unknown[];
}) => new DefinitionRegistry(definitions);
function definition(version = "1") {
    return {
        id: "example.project", version,
        nodeTypes: {
            project: {
                valueSchema: {
                    type: "object" as const,
                    $defs: { quantity: { type: "number" as const, minimum: 0 } },
                    properties: { name: { type: "string" as const }, capacity: { $ref: "#/$defs/quantity" }, limit: { $ref: "#/$defs/quantity" } },
                    additionalProperties: false as const
                },
                requiredAtPublish: ["name", "capacity"]
            }
        },
        relationTypes: { related: { from: ["project"], to: ["project"] } }
    };
}
const selector = { type: "example.project", typeVersion: "1" };
function issues(...definitions: unknown[]): readonly DefinitionIssue[] {
    try {
        assemble({ definitions });
    }
    catch (error) {
        assert.ok(error instanceof DefinitionAssemblyError);
        return error.issues;
    }
    assert.fail("Expected atomic assembly failure");
}
function withSchema(schema: unknown) {
    const d = definition();
    return { ...d, nodeTypes: { project: { valueSchema: schema } } };
}
function withField(field: unknown, defs: unknown = {}) {
    return withSchema({ type: "object", properties: { value: field }, $defs: defs, additionalProperties: false });
}
test("helper and ordinary JSON have the same identity; current entry requires initial work", async () => {
    const helper = defineDraftType(definition()), json = JSON.parse(JSON.stringify(helper));
    const registry = assemble({ definitions: [helper, json] });
    assert.equal(registry.getDefinition(selector).digest, assemble({ definitions: [json] }).getDefinition(selector).digest);
    const engine = createStagedWrite({ definitions: [helper, json] });
    const draft = await engine.create(selector, { nodes: { one: { id: "one", nodeType: "project", fields: { capacity: 1 } } }, edges: {} });
    assert.equal(draft.definitionDigest, registry.getDefinition(selector).digest);
    assert.equal(draft.version, 0);
    assert.equal(draft.graph.nodes.one!.fields.capacity, 1);
    const check = await engine.preflight(draft.id);
    assert.equal(check.scope, "draft");
    assert.equal(check.status, "blocked");
    assert.equal(check.certificate, undefined);
    await engine.close();
});
test("definition snapshots, caller input and separate registries stay isolated", () => {
    const input = definition(), registry = assemble({ definitions: [input] }), original = registry.getDefinition(selector);
    input.nodeTypes.project.valueSchema.$defs.quantity.minimum = 10;
    const other = assemble({ definitions: [input] }), returned = registry.getDefinition(selector);
    (returned.definition as ReturnType<typeof definition>).nodeTypes.project.valueSchema.$defs.quantity.minimum = 999;
    assert.deepEqual(registry.getDefinition(selector), original);
    assert.equal(registry.validateValues(selector, "project", { capacity: 1 }).valid, true);
    assert.equal(other.validateValues(selector, "project", { capacity: 1 }).valid, false);
    assert.notEqual(other.getDefinition(selector).digest, original.digest);
});
test("versions remain explicit; current drafts retain their selected definition", async () => {
    const v2 = definition("2");
    v2.nodeTypes.project.valueSchema.$defs.quantity.minimum = 20;
    const engine = createStagedWrite({ definitions: [definition(), v2] });
    const initial = { nodes: { one: { id: "one", nodeType: "project", fields: { name: "Work", capacity: 20 } } }, edges: {} };
    const one = await engine.create(selector, initial), two = await engine.create({ ...selector, typeVersion: "2" }, initial);
    assert.notEqual(one.id, two.id);
    assert.notEqual(one.definitionDigest, two.definitionDigest);
    assert.equal((await engine.getDraft(one.id)).definitionDigest, one.definitionDigest);
    for (const typeVersion of ["latest", "3", "01"])
        await assert.rejects(engine.create({ ...selector, typeVersion }, initial), /TYPE_VERSION_NOT_FOUND/);
    await assert.rejects(engine.getDraft("missing"), /DRAFT_NOT_FOUND/);
    await engine.close();
});
test("assembly reports independent problems across definitions in stable order", () => {
    const bad = { ...definition(), id: "z", unknown: true, relationTypes: { broken: { from: [], to: ["missing"] } } };
    const invalid = { ...withField({ type: "string", minLength: -1, surprise: 1 }), id: "a" };
    const errors = issues(bad, invalid);
    assert.ok(errors.length >= 5);
    assert.equal(errors[0]?.definitionId, "a");
    assert.ok(errors.some(e => e.path === "/relationTypes/broken/to/0"));
    assert.ok(errors.some(e => e.path === "/unknown"));
    assert.deepEqual(errors, issues(invalid, bad));
    const conflict = definition();
    conflict.nodeTypes.project.valueSchema.$defs.quantity.minimum = 9;
    assert.equal(issues(definition(), conflict)[0]?.code, "DEFINITION_CONFLICT");
    assert.equal(assemble({ definitions: [definition()] }).selectors().length, 1);
});
test("shared references compile constraints without coercion, defaults or deletion", () => {
    const engine = assemble({ definitions: [definition()] });
    for (const field of ["capacity", "limit"]) {
        assert.equal(engine.validateValues(selector, "project", { [field]: 0 }).valid, true);
        for (const value of [-1, "2", null])
            assert.equal(engine.validateValues(selector, "project", { [field]: value }).valid, false);
    }
    const values = { capacity: "2", extra: 7 };
    const before = structuredClone(values);
    const result = engine.validateValues(selector, "project", values);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(e => e.keyword === "additionalProperties"));
    assert.deepEqual(values, before);
});
test("acyclic chains, escaped names and per-document definitions resolve independently", () => {
    const defs = { alias: { $ref: "#/$defs/a~1b~0c" }, "a/b~c": { type: "integer", minimum: 3 } };
    const first = withField({ $ref: "#/$defs/alias" }, defs);
    const secondSchema = { type: "object", properties: { value: { $ref: "#/$defs/alias" } }, $defs: { alias: { type: "string" } }, additionalProperties: false };
    const input = { ...first, nodeTypes: { ...first.nodeTypes, other: { valueSchema: secondSchema } } };
    const engine = assemble({ definitions: [input] });
    assert.equal(engine.validateValues(selector, "project", { value: 3 }).valid, true);
    assert.equal(engine.validateValues(selector, "project", { value: 2 }).valid, false);
    assert.equal(engine.validateValues(selector, "other", { value: "text" }).valid, true);
    assert.equal(engine.validateValues(selector, "other", { value: 3 }).valid, false);
});
test("unused dangling references and direct or indirect cycles block assembly", () => {
    const dangling = issues(withField({ type: "string" }, { unused: { $ref: "#/$defs/missing" } }));
    assert.equal(dangling[0]?.code, "SCHEMA_REF_NOT_FOUND");
    assert.equal(dangling[0]?.target, "#/$defs/missing");
    assert.ok(dangling[0]?.path.includes("/$defs/unused/$ref"));
    for (const defs of [{ a: { $ref: "#/$defs/a" } }, { a: { $ref: "#/$defs/b" }, b: { $ref: "#/$defs/a" } }]) {
        const errors = issues(withField({ type: "string" }, defs));
        assert.ok(errors.some(e => e.code === "SCHEMA_REF_CYCLE" && e.chain!.length >= 2));
    }
});
test("unsupported refs and ref siblings are rejected before compilation", () => {
    for (const ref of ["https://example.invalid/schema", "other.json#/$defs/a", "#anchor", "#/properties/a", "#/$defs/a/b", "#/$defs/a%20b"]) {
        assert.ok(issues(withField({ $ref: ref })).some(e => e.code === "UNSUPPORTED_SCHEMA_FEATURE" && e.target === ref));
    }
    assert.equal(issues(withField({ $ref: "#/$defs/a~2b" }))[0]?.code, "INVALID_DEFINITION");
    assert.ok(issues(withField({ $ref: "#/$defs/a", minimum: 5 }, { a: { type: "number" } })).some(e => e.code === "UNSUPPORTED_SCHEMA_FEATURE"));
});
test("profile rejects unsupported and malformed features, including unused defs", () => {
    for (const field of [
        { type: "object", properties: {} }, { type: "array" }, { type: "null" },
        { type: ["number", "string"] }, { type: "number", minimum: "0" },
        { type: "number", minimum: 5, maximum: 2 }, { type: "boolean", minimum: 0 },
        { type: "string", minLength: -1 }, { type: "string", maxLength: 1.5 },
        { type: "string", title: 5 }, { type: "string", enum: [1] },
        { type: "string", enum: [] }, { type: "string", enum: ["a", "a"] },
        { type: "string", default: "a" }, { type: "string", nullable: true },
        { type: "string", pattern: ".*" }, { $id: "x", type: "string" }
    ])
        assert.ok(issues(withField({ type: "string" }, { unused: field })).length > 0, JSON.stringify(field));
    for (const extra of [{ required: ["value"] }, { additionalProperties: true }, { $schema: "http://json-schema.org/draft-07/schema#" }]) {
        assert.ok(issues(withSchema({ type: "object", properties: {}, additionalProperties: false, ...extra })).length > 0);
    }
    const badRequired = definition();
    badRequired.nodeTypes.project.requiredAtPublish = ["missing"];
    assert.ok(issues(badRequired).some(e => e.path.includes("requiredAtPublish")));
});
test("nullable scalar constraints and Unicode string length follow JSON Schema", () => {
    const engine = assemble({ definitions: [withField({ type: ["string", "null"], minLength: 1, maxLength: 1, enum: [null, "😀"] })] });
    for (const value of [null, "😀"])
        assert.equal(engine.validateValues(selector, "project", { value }).valid, true);
    for (const value of ["", "xx", 1])
        assert.equal(engine.validateValues(selector, "project", { value }).valid, false);
});
test("JSON input rejects dangerous keys, cycles and values JSON.stringify would discard", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "id", { enumerable: true, get() { getterCalls++; return "x"; } });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const raw of [undefined, NaN, Infinity, () => 1, new Date(), { ...definition(), omitted: undefined },
        { ...definition(), symbol: Symbol() }, { ...definition(), nested: cycle }, accessor,
        JSON.parse('{"__proto__": {"polluted": true}}'), { ...definition(), array: new Array(1) }
    ])
        assert.ok(issues(raw).some(e => e.code === "INVALID_DEFINITION"));
    assert.equal(getterCalls, 0);
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
    const engine = assemble({ definitions: [definition()] });
    assert.equal(engine.validateValues(selector, "project", { capacity: Infinity }).valid, false);
});
test("canonical JSON has fixed key/number rules and a known digest vector", () => {
    const value = { z: -0, "2": 2, "10": 10, a: [1, null, "x"] };
    const canonical = '{"10":10,"2":2,"a":[1,null,"x"],"z":0}';
    assert.equal(canonicalJson(value), canonical);
    assert.equal(definitionDigest(value), `sha256:stagedwrite-json-v1:${createHash("sha256").update(canonical).digest("hex")}`);
    assert.notEqual(definitionDigest([1, 2]), definitionDigest([2, 1]));
});
test("key ordering is irrelevant but unused defs and scalar changes alter definition digest", () => {
    const original = definition();
    function reversed(value: unknown): unknown {
        if (Array.isArray(value))
            return value.map(reversed);
        if (value !== null && typeof value === "object")
            return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]));
        return value;
    }
    const digest = (d: unknown) => assemble({ definitions: [d] }).getDefinition(selector).digest;
    assert.equal(digest(original), digest(reversed(original)));
    const updated = definition();
    updated.nodeTypes.project.valueSchema.$defs.quantity.minimum = 1;
    assert.notEqual(digest(original), digest(updated));
    const unused = structuredClone(original);
    Object.assign(unused.nodeTypes.project.valueSchema.$defs, { unused: { type: "boolean" } });
    assert.notEqual(digest(original), digest(unused));
});
