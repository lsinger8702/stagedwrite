import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType, EditInputError, type EditBatch } from "../src/index.js";
const definition = defineDraftType({ id: "example.graph", version: "1", nodeTypes: {
    project: { valueSchema: { type: "object", properties: { capacity: { type: "number", minimum: 0 }, note: { type: ["string", "null"] }, "a/b~c": { type: "string" }, profile: { type: "object", properties: { title: { type: "string" }, note: { type: "string" } }, additionalProperties: false } }, additionalProperties: false }, requiredAtPublish: ["capacity"] },
    document: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false } }
}, relationTypes: { uses: { from: ["project"], to: ["document"], ownership: "reference", cardinality: "many" }, contains: { from: ["project"], to: ["document"], ownership: "owned", cardinality: "many" } } });
const selector = { type: definition.id, typeVersion: "1" };
async function setup() {
    const engine = createStagedWrite({ definitions: [definition] });
    const draft = await engine.create(selector, { nodes: {
        c1: { id: "c1", nodeType: "project", fields: { note: null } }, c2: { id: "c2", nodeType: "project", fields: {} },
        document: { id: "document", nodeType: "document", fields: { name: "Initial work" } }
    }, edges: {} });
    return { engine, draft };
}
const links: EditBatch = { graphPatches: [ { op: "set", ref: "c1", path: "/uses", value: [{ ref: "document" }] }, { op: "set", ref: "c2", path: "/uses", value: [{ ref: "document" }] } ], patches: [{ op: "set", ref: "c1", scope: "canonical", path: "/capacity", value: 10 }] };
const child: EditBatch = { graphPatches: [{ op: "set", parentRef: "c1", path: "/contains", value: { nodeType: "document", fields: { name: "Child" } } }] };
const field = (op: "set" | "remove" | "reset", path: string, value?: unknown): EditBatch => ({ patches: [{ op, ref: "c1", scope: "canonical", path, ...(op === "set" ? { value } : {}) }] } as EditBatch);

test("graph: double-channel edit creates shared references and projects author values", async () => {
    const { engine, draft } = await setup(); try {
        const receipt = await engine.edit(draft.id, 0, links), result = await engine.getDraft(draft.id);
        assert.equal(receipt.version, 1); assert.deepEqual(receipt.createdRefs, []);
        assert.deepEqual(Object.values(result.graph.edges).map(e => e.to), ["document", "document"]);
        assert.equal(result.graph.nodes.c1!.fields.capacity, 10);
        assert.deepEqual(result.fieldIntents.c1!["/capacity"], { kind: "set", value: 10 });
        assert.equal((await engine.preflight(draft.id)).status, "blocked");
    } finally { await engine.close(); }
});
test("graph: preview identities cannot be reused; real edits allocate detached server identities", async () => {
    const { engine, draft } = await setup(); try {
        const preview = await engine.preview(draft.id, 0, child);
        assert.equal(preview.preview, true); assert.deepEqual(await engine.getDraft(draft.id), draft);
        const provisional = preview.createdRefs[0]!; assert.match(provisional.ref, /^preview:/);
        await assert.rejects(engine.edit(draft.id, 0, { graphPatches: [{ op: "remove", ref: provisional.ref }] }), EditInputError);
        const actual = await engine.edit(draft.id, 0, child), real = actual.createdRefs[0]!;
        assert.equal(real.path, provisional.path); assert.notEqual(real.ref, provisional.ref);
        assert.deepEqual((await engine.getDraft(draft.id)).graph.nodes[real.ref]!.fields, preview.candidate.graph.nodes[provisional.ref]!.fields);
        preview.candidate.graph.nodes[provisional.ref]!.fields.name = "tampered";
        assert.equal((await engine.getDraft(draft.id)).graph.nodes[real.ref]!.fields.name, "Child");
    } finally { await engine.close(); }
});
test("graph: invalid fields or relations roll back generated nodes, version and tombstones", async () => {
    const { engine, draft } = await setup(); try {
        for (const batch of [ { ...child, ...field("set", "/capacity", -1) }, { graphPatches: [{ op: "set", ref: "document", path: "/uses", value: [{ ref: "c1" }] }] }, { graphPatches: [{ op: "set", ref: "c1", path: "/missing", value: [] }] } ] as EditBatch[]) {
            await assert.rejects(engine.edit(draft.id, 0, batch), EditInputError);
            assert.deepEqual(await engine.getDraft(draft.id), draft);
        }
        assert.equal((await engine.edit(draft.id, 0, child)).createdRefs.length, 1);
    } finally { await engine.close(); }
});
test("graph: removing a shared target requires both reference slots to be cleared first", async () => {
    const { engine, draft } = await setup(); try {
        await engine.edit(draft.id, 0, links);
        const before = await engine.getDraft(draft.id);
        await assert.rejects(engine.edit(draft.id, 1, { graphPatches: [{ op: "remove", ref: "document" }] }), EditInputError);
        assert.deepEqual(await engine.getDraft(draft.id), before);
        await engine.edit(draft.id, 1, { graphPatches: [{ op: "set", ref: "c1", path: "/uses", value: [] }, { op: "set", ref: "c2", path: "/uses", value: [] }, { op: "remove", ref: "document" }] });
        const result = await engine.getDraft(draft.id);
        assert.deepEqual(result.graph.edges, {}); assert.equal(result.fieldIntents.document, undefined);
        assert.ok(result.tombstones.nodes.includes("document"));
    } finally { await engine.close(); }
});
test("graph: reset restores baseline identity; new specs cannot choose a retired ID", async () => {
    const { engine, draft } = await setup(); try {
        await engine.edit(draft.id, 0, { graphPatches: [{ op: "remove", ref: "document" }] });
        const restored = await engine.edit(draft.id, 1, { graphPatches: [{ op: "reset", ref: "document" }] });
        assert.deepEqual(restored.createdRefs, []);
        assert.equal((await engine.getDraft(draft.id)).graph.nodes.document!.fields.name, "Initial work");
        const bad = { graphPatches: [{ op: "set", parentRef: "c1", path: "/contains", value: { nodeType: "document", fields: {}, id: "document" } }] };
        await assert.rejects(engine.edit(draft.id, 2, bad as EditBatch), EditInputError);
    } finally { await engine.close(); }
});
test("graph: duplicate field coordinates reject atomically with message and hint", async () => {
    const { engine, draft } = await setup(); try {
        for (const batch of [ { patches: [...field("set", "/capacity", 1).patches!, ...field("set", "/capacity", 1).patches!] }, { patches: [...field("remove", "/note").patches!, ...field("reset", "/note").patches!] } ]) {
            for (const method of [engine.preview, engine.edit]) await assert.rejects(method(draft.id, 0, batch), e => e instanceof EditInputError && e.code === "PATCH_SELF_CONFLICT" && !!e.message && !!e.hint);
        }
        assert.deepEqual(await engine.getDraft(draft.id), draft);
        await engine.edit(draft.id, 0, { patches: [...field("set", "/profile", { title: "A", note: "B" }).patches!, ...field("set", "/profile/title", "C").patches!] });
        assert.deepEqual((await engine.getDraft(draft.id)).graph.nodes.c1!.fields.profile, { title: "C", note: "B" });
    } finally { await engine.close(); }
});
test("graph: null, clear and fixed-baseline reset stay distinct across edits", async () => {
    const { engine, draft } = await setup(); try {
        await engine.edit(draft.id, 0, field("remove", "/note"));
        assert.deepEqual((await engine.getDraft(draft.id)).fieldIntents.c1!["/note"], { kind: "remove" });
        await engine.edit(draft.id, 1, field("reset", "/note"));
        assert.deepEqual((await engine.getDraft(draft.id)).fieldIntents.c1!["/note"], { kind: "set", value: null });
        await engine.edit(draft.id, 2, field("set", "/a~1b~0c", "escaped"));
        assert.equal((await engine.getDraft(draft.id)).graph.nodes.c1!.fields["a/b~c"], "escaped");
        await engine.edit(draft.id, 3, field("reset", "/a~1b~0c"));
        assert.equal((await engine.getDraft(draft.id)).fieldIntents.c1!["/a~1b~0c"], undefined);
    } finally { await engine.close(); }
});
test("graph: stale, empty, legacy and malformed inputs never modify state", async () => {
    const { engine, draft } = await setup(); try {
        for (const version of [-1, 1, 0.5, NaN]) await assert.rejects(engine.edit(draft.id, version, field("reset", "/note")), /STALE_VERSION/);
        for (const batch of [[], { patches: [] }, { graphPatches: [{ op: "node.add", id: "x", nodeType: "document" }] }, { patches: [{ op: "set", nodeId: "c1", path: "/note", value: "old" }] }, field("set", "/capacity", Infinity), field("set", "/capacity", []), field("reset", "/a~2b"), field("remove", "/missing")])
            await assert.rejects(engine.edit(draft.id, 0, batch as EditBatch), EditInputError);
        assert.deepEqual(await engine.getDraft(draft.id), draft);
    } finally { await engine.close(); }
});
test("graph: no-op field resets still advance version and invalidate the current check", async () => {
    const { engine, draft } = await setup(); try {
        await engine.preflight(draft.id);
        const receipt = await engine.edit(draft.id, 0, field("reset", "/a~1b~0c"));
        assert.equal(receipt.version, 1); assert.equal(receipt.preflightRequired, true);
        assert.deepEqual((await engine.getDraft(draft.id)).graph, draft.graph);
        await assert.rejects(engine.getCheck(draft.id), /CHECK_NOT_CURRENT/);
    } finally { await engine.close(); }
});
