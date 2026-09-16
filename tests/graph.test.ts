import { rememberRefs, nodeRef } from "./fixtures/refs.js";
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
    const draft = rememberRefs(await engine.create(selector, { roots: [{ nodeType: "project", fields: { note: null } }, { nodeType: "project", fields: {} }, { nodeType: "document", fields: { name: "Initial work" } }] }), ["c1","c2","document"]);
    return { engine, draft };
}
const links = (draft: import("../src/index.js").ManagedDraft): EditBatch => ( { graphPatches: [ { op: "set", ref: nodeRef(draft, "c1"), path: "/uses", value: [{ ref: nodeRef(draft, "document") }] }, { op: "set", ref: nodeRef(draft, "c2"), path: "/uses", value: [{ ref: nodeRef(draft, "document") }] } ], patches: [{ op: "set", ref: nodeRef(draft, "c1"), scope: "canonical", path: "/capacity", value: 10 }] });
const child = (draft: import("../src/index.js").ManagedDraft): EditBatch => ( { graphPatches: [{ op: "set", parentRef: nodeRef(draft, "c1"), path: "/contains", value: { nodeType: "document", fields: { name: "Child" } } }] });
const field = (draft: import("../src/index.js").ManagedDraft, op: "set" | "remove" | "reset", path: string, value?: unknown): EditBatch => ({ patches: [{ op, ref: nodeRef(draft, "c1"), scope: "canonical", path, ...(op === "set" ? { value } : {}) }] } as EditBatch);

test("graph: double-channel edit creates shared references and projects author values", async () => {
    const { engine, draft } = await setup(); try {
        const receipt = await engine.edit(draft.id, 0, links(draft)), result = await engine.getDraft(draft.id);
        assert.equal(receipt.version, 1); assert.deepEqual(receipt.createdRefs, []);
        assert.deepEqual(Object.values(result.graph.edges).map(e => e.to), [nodeRef(draft, "document"), nodeRef(draft, "document")]);
        assert.equal(result.graph.nodes[nodeRef(draft, "c1")]!.fields.capacity, 10);
        assert.deepEqual(result.fieldIntents[nodeRef(draft, "c1")]!["/capacity"], { kind: "set", value: 10 });
        assert.equal((await engine.preflight(draft.id)).status, "blocked");
    } finally { await engine.close(); }
});
test("graph: preview identities cannot be reused; real edits allocate detached server identities", async () => {
    const { engine, draft } = await setup(); try {
        const preview = await engine.preview(draft.id, 0, child(draft));
        assert.equal(preview.preview, true); assert.deepEqual(await engine.getDraft(draft.id), draft);
        const provisional = preview.createdRefs[0]!; assert.match(provisional.ref, /^preview:/);
        await assert.rejects(engine.edit(draft.id, 0, { graphPatches: [{ op: "remove", ref: provisional.ref }] }), EditInputError);
        const actual = await engine.edit(draft.id, 0, child(draft)), real = actual.createdRefs[0]!;
        assert.equal(real.path, provisional.path); assert.notEqual(real.ref, provisional.ref);
        assert.deepEqual((await engine.getDraft(draft.id)).graph.nodes[real.ref]!.fields, preview.candidate.graph.nodes[provisional.ref]!.fields);
        preview.candidate.graph.nodes[provisional.ref]!.fields.name = "tampered";
        assert.equal((await engine.getDraft(draft.id)).graph.nodes[real.ref]!.fields.name, "Child");
    } finally { await engine.close(); }
});
test("graph: invalid fields or relations roll back generated nodes, version and tombstones", async () => {
    const { engine, draft } = await setup(); try {
        for (const batch of [ { ...child(draft), ...field(draft, "set", "/capacity", -1) }, { graphPatches: [{ op: "set", ref: nodeRef(draft, "document"), path: "/uses", value: [{ ref: nodeRef(draft, "c1") }] }] }, { graphPatches: [{ op: "set", ref: nodeRef(draft, "c1"), path: "/missing", value: [] }] } ] as EditBatch[]) {
            await assert.rejects(engine.edit(draft.id, 0, batch), EditInputError);
            assert.deepEqual(await engine.getDraft(draft.id), draft);
        }
        assert.equal((await engine.edit(draft.id, 0, child(draft))).createdRefs.length, 1);
    } finally { await engine.close(); }
});
test("graph: removing a shared target requires both reference slots to be cleared first", async () => {
    const { engine, draft } = await setup(); try {
        await engine.edit(draft.id, 0, links(draft));
        const before = await engine.getDraft(draft.id);
        await assert.rejects(engine.edit(draft.id, 1, { graphPatches: [{ op: "remove", ref: nodeRef(draft, "document") }] }), EditInputError);
        assert.deepEqual(await engine.getDraft(draft.id), before);
        await engine.edit(draft.id, 1, { graphPatches: [{ op: "set", ref: nodeRef(draft, "c1"), path: "/uses", value: [] }, { op: "set", ref: nodeRef(draft, "c2"), path: "/uses", value: [] }, { op: "remove", ref: nodeRef(draft, "document") }] });
        const result = await engine.getDraft(draft.id);
        assert.deepEqual(result.graph.edges, {}); assert.equal(result.fieldIntents[nodeRef(draft, "document")], undefined);
        assert.ok(result.tombstones.nodes.includes(nodeRef(draft, "document")));
    } finally { await engine.close(); }
});
test("graph: reset restores baseline identity; new specs cannot choose a retired ID", async () => {
    const { engine, draft } = await setup(); try {
        await engine.edit(draft.id, 0, { graphPatches: [{ op: "remove", ref: nodeRef(draft, "document") }] });
        const restored = await engine.edit(draft.id, 1, { graphPatches: [{ op: "reset", ref: nodeRef(draft, "document") }] });
        assert.deepEqual(restored.createdRefs, []);
        assert.equal((await engine.getDraft(draft.id)).graph.nodes[nodeRef(draft, "document")]!.fields.name, "Initial work");
        const bad = { graphPatches: [{ op: "set", parentRef: nodeRef(draft, "c1"), path: "/contains", value: { nodeType: "document", fields: {}, id: "document" } }] };
        await assert.rejects(engine.edit(draft.id, 2, bad as EditBatch), EditInputError);
    } finally { await engine.close(); }
});
test("graph: duplicate field coordinates reject atomically with message and hint", async () => {
    const { engine, draft } = await setup(); try {
        for (const batch of [ { patches: [...field(draft, "set", "/capacity", 1).patches!, ...field(draft, "set", "/capacity", 1).patches!] }, { patches: [...field(draft, "remove", "/note").patches!, ...field(draft, "reset", "/note").patches!] } ]) {
            for (const method of [engine.preview, engine.edit]) await assert.rejects(method(draft.id, 0, batch), e => e instanceof EditInputError && e.code === "PATCH_SELF_CONFLICT" && !!e.message && !!e.hint);
        }
        assert.deepEqual(await engine.getDraft(draft.id), draft);
        await engine.edit(draft.id, 0, { patches: [...field(draft, "set", "/profile", { title: "A", note: "B" }).patches!, ...field(draft, "set", "/profile/title", "C").patches!] });
        assert.deepEqual((await engine.getDraft(draft.id)).graph.nodes[nodeRef(draft, "c1")]!.fields.profile, { title: "C", note: "B" });
    } finally { await engine.close(); }
});
test("graph: null, clear and fixed-baseline reset stay distinct across edits", async () => {
    const { engine, draft } = await setup(); try {
        await engine.edit(draft.id, 0, field(draft, "remove", "/note"));
        assert.deepEqual((await engine.getDraft(draft.id)).fieldIntents[nodeRef(draft, "c1")]!["/note"], { kind: "remove" });
        await engine.edit(draft.id, 1, field(draft, "reset", "/note"));
        assert.deepEqual((await engine.getDraft(draft.id)).fieldIntents[nodeRef(draft, "c1")]!["/note"], { kind: "set", value: null });
        await engine.edit(draft.id, 2, field(draft, "set", "/a~1b~0c", "escaped"));
        assert.equal((await engine.getDraft(draft.id)).graph.nodes[nodeRef(draft, "c1")]!.fields["a/b~c"], "escaped");
        await engine.edit(draft.id, 3, field(draft, "reset", "/a~1b~0c"));
        assert.equal((await engine.getDraft(draft.id)).fieldIntents[nodeRef(draft, "c1")]!["/a~1b~0c"], undefined);
    } finally { await engine.close(); }
});
test("graph: stale, empty, legacy and malformed inputs never modify state", async () => {
    const { engine, draft } = await setup(); try {
        for (const version of [-1, 1, 0.5, NaN]) await assert.rejects(engine.edit(draft.id, version, field(draft, "reset", "/note")), /STALE_VERSION/);
        for (const batch of [[], { patches: [] }, { graphPatches: [{ op: "node.add", id: "x", nodeType: "document" }] }, { patches: [{ op: "set", nodeId: "c1", path: "/note", value: "old" }] }, field(draft, "set", "/capacity", Infinity), field(draft, "set", "/capacity", []), field(draft, "reset", "/a~2b"), field(draft, "remove", "/missing")])
            await assert.rejects(engine.edit(draft.id, 0, batch as EditBatch), EditInputError);
        assert.deepEqual(await engine.getDraft(draft.id), draft);
    } finally { await engine.close(); }
});
test("graph: no-op field resets still advance version and invalidate the current check", async () => {
    const { engine, draft } = await setup(); try {
        await engine.preflight(draft.id);
        const receipt = await engine.edit(draft.id, 0, field(draft, "reset", "/a~1b~0c"));
        assert.equal(receipt.version, 1); assert.equal(receipt.preflightRequired, true);
        assert.deepEqual((await engine.getDraft(draft.id)).graph, draft.graph);
        await assert.rejects(engine.getCheck(draft.id), /CHECK_NOT_CURRENT/);
    } finally { await engine.close(); }
});

test("graph: public clone spec copies author declarations with new identity and no execution ownership", async () => {
    const { engine, draft } = await setup(); try {
        const source = nodeRef(draft, "document");
        await engine.edit(draft.id, 0, { patches: [{ op: "remove", ref: source, scope: "canonical", path: "/name" }] });
        const receipt = await engine.edit(draft.id, 1, { graphPatches: [{ op: "set", parentRef: nodeRef(draft, "c1"), path: "/contains", value: { cloneFromRef: source } }] });
        assert.equal(receipt.createdRefs.length, 1);
        const clone = receipt.createdRefs[0]!;
        assert.equal(clone.path, "/graphPatches/0/value"); assert.equal(clone.sourceRef, source); assert.notEqual(clone.ref, source);
        const stored = await engine.getDraft(draft.id);
        assert.deepEqual(stored.graph.nodes[clone.ref]!.fields, {});
        assert.deepEqual(stored.fieldIntents[clone.ref], stored.fieldIntents[source]);
        assert.equal(stored.currentRunId, null); assert.deepEqual(await engine.getBindings(draft.id), {});
        assert.equal(stored.initialSnapshot.graph.nodes[clone.ref], undefined);
        assert.deepEqual(draft.initialSnapshot, stored.initialSnapshot);
    } finally { await engine.close(); }
});
