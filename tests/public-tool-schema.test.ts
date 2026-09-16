import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createStagedWrite, editBatchSchema, initialIntentSchema, EditInputError, type InitialIntent, type EditBatch } from "../src/index.js";
const selector = { type: "tool-work", typeVersion: "1" };
const definition = { id: selector.type, version: "1", nodeTypes: { task: {
    valueSchema: { type: "object", properties: { name: { type: "string" }, detail: { type: "object", properties: { note: { type: ["string", "null"] } }, additionalProperties: false } }, additionalProperties: false }
} }, relationTypes: { contains: { from: ["task"], to: ["task"], ownership: "owned", cardinality: "many" } } };
const ajv = new Ajv2020({ strict: false });
const validInitial = ajv.compile<InitialIntent>(initialIntentSchema), validBatch = ajv.compile<EditBatch>(editBatchSchema);

test("public tool schemas: initial nested content is accepted; existing refs, clones and old shapes are excluded", async () => {
    const engine = createStagedWrite({ definitions: [definition] });
    try {
        const input: unknown = JSON.parse('{"roots":[{"nodeType":"task","fields":{"name":"Initial work","detail":{"note":null}},"relations":{"contains":[{"nodeType":"task","fields":{"name":"Child"}}]}}]}');
        assert.ok(validInitial(input));
        const created = await engine.create(selector, input);
        assert.equal(created.createdRefs.length, 2);
        for (const invalid of [
            { roots: [] }, { nodes: {}, edges: {} }, { roots: [{ ref: "old" }] }, { roots: [{ cloneFromRef: "old" }] },
            { roots: [{ nodeType: "task" }] }, { roots: [{ nodeType: "task", fields: {}, id: "caller-id" }] },
            ...[{ ref: "old" }, { cloneFromRef: "old" }].map(child => ({ roots: [{ nodeType: "task", fields: {}, relations: { contains: [child] } }] }))
        ]) {
            assert.equal(validInitial(invalid), false);
            await assert.rejects(engine.create(selector, invalid as InitialIntent), e => e instanceof EditInputError && !!e.message && !!e.hint);
        }
    } finally { await engine.close(); }
});

test("public tool schemas: model JSON edits the real draft; structure alone cannot authorize a duplicate coordinate", async () => {
    const engine = createStagedWrite({ definitions: [definition], rules: [{ ...selector, id: "name", version: "1", check: d => {
        const node = Object.values(d.graph.nodes)[0]!;
        return node.fields.name === "reserved" ? [{ code: "name.reserved", path: `/nodes/${node.id}/fields/name`, message: "Choose another task name.", hint: "Keep the existing note.",
            candidates: [{ value: "chosen", repairOps: { patches: [{ op: "set", ref: node.id, scope: "canonical", path: "/name", value: "chosen" }] } }] }] : [];
    } }] });
    try {
        const { draft, createdRefs } = await engine.create(selector, { roots: [{ nodeType: "task", fields: { name: "reserved", detail: { note: null } } }] });
        const check = await engine.preflight(draft.id);
        assert.equal(check.status, "blocked");
        const batch: unknown = JSON.parse(JSON.stringify(check.diagnostics[0]!.candidates![0]!.repairOps));
        assert.ok(validBatch(batch));
        const preview = await engine.preview(draft.id, 0, batch);
        assert.equal(preview.preview, true); assert.deepEqual(await engine.getDraft(draft.id), draft);
        const receipt = await engine.edit(draft.id, 0, batch);
        assert.equal(receipt.preflightRequired, true);
        const passed = await engine.preflight(draft.id);
        assert.equal(passed.status, "passed");
        assert.deepEqual(passed.preview.nodes[createdRefs[0]!.ref]!.fields["/detail/note"], { kind: "value", value: null });
        const duplicate = { patches: [batch.patches![0]!, batch.patches![0]!] };
        assert.ok(validBatch(duplicate)); // JSON Schema cannot enforce coordinate tuple uniqueness.
        await assert.rejects(engine.edit(draft.id, 1, duplicate), e => e instanceof EditInputError && e.code === "PATCH_SELF_CONFLICT" && !!e.message && !!e.hint);
        assert.deepEqual(await engine.getCheck(draft.id), passed);
        const wrongType = { patches: [{ op: "set", ref: createdRefs[0]!.ref, scope: "canonical", path: "/name", value: 42 }] };
        assert.ok(validBatch(wrongType)); // Registration-specific validation remains in the engine.
        await assert.rejects(engine.edit(draft.id, 1, wrongType), EditInputError);
    } finally { await engine.close(); }
});

test("public tool schemas: frozen shared exports can be customized only on detached copies", () => {
    const before = JSON.stringify([editBatchSchema, initialIntentSchema]);
    assert.throws(() => { editBatchSchema.$defs.field.oneOf.length = 0; }, TypeError);
    assert.throws(() => { initialIntentSchema.properties.roots.minItems = 0; }, TypeError);
    const copy = structuredClone(editBatchSchema);
    copy.$defs.field.oneOf.length = 0;
    assert.equal(JSON.stringify([editBatchSchema, initialIntentSchema]), before);
});
