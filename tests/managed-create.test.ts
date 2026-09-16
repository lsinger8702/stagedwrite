import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, createMemoryBackend, EditInputError, type InitialIntent } from "../src/index.js";
const selector = { type: "create-work", typeVersion: "1" };
const definition = { id: selector.type, version: "1", nodeTypes: {
    work: { valueSchema: { type: "object", properties: { name: { type: "string" }, profile: { type: "object", properties: { note: { type: ["string", "null"] } }, additionalProperties: false } }, additionalProperties: false } }
}, relationTypes: { children: { from: ["work"], to: ["work"], ownership: "owned", cardinality: "many" } } };
const initial = (): InitialIntent => ({ roots: [{ nodeType: "work", fields: { name: "Project", profile: { note: null } }, relations: { children: [{ nodeType: "work", fields: { name: "Task" } }] } }] });
test("public create: nested initial work allocates disjoint identities and detached receipts", async () => {
    const engine = createStagedWrite({ definitions: [definition] });
    try {
        const input = initial(), first = await engine.create(selector, input), second = await engine.create(selector, input);
        assert.deepEqual(Object.keys(first).sort(), ["createdRefs", "draft"]);
        assert.deepEqual(first.createdRefs.map(r => r.path), ["/roots/0", "/roots/0/relations/children/0"]);
        const [parent, child] = first.createdRefs.map(r => r.ref);
        assert.ok(parent && child); assert.notEqual(parent, child);
        assert.ok(second.createdRefs.every(r => !first.createdRefs.some(old => old.ref === r.ref)));
        assert.notEqual(first.draft.id, second.draft.id);
        const edge = Object.values(first.draft.graph.edges)[0]!;
        assert.equal(edge.from, parent); assert.equal(edge.to, child);
        assert.deepEqual(first.draft.initialSnapshot.graph, first.draft.graph);
        assert.deepEqual(first.draft.fieldIntents[parent]!["/profile/note"], { kind: "set", value: null });
        assert.equal(first.draft.currentRunId, null); assert.equal(first.draft.version, 0);
        const saved = structuredClone(first.draft);
        first.draft.graph.nodes[parent]!.fields.name = "tampered";
        first.createdRefs[0]!.ref = "tampered";
        input.roots.length = 0;
        assert.deepEqual(await engine.getDraft(saved.id), saved);
    } finally { await engine.close(); }
});
test("public create: invalid specs never acquire storage ownership or save a partial Draft", async () => {
    const backend = createMemoryBackend(); let acquires = 0, writes = 0;
    const engine = createStagedWrite({ definitions: [definition], storage: { ...backend.storage, transact: async (...args) => { writes++; return backend.storage.transact(...args); } },
        locks: { ...backend.locks, acquire: async (...args) => { acquires++; return backend.locks.acquire(...args); } } });
    try {
        for (const input of [
            { roots: [] }, { nodes: {}, edges: {} }, { roots: [{ nodeType: "work", fields: { name: "A" }, id: "chosen" }] },
            { roots: [{ cloneFromRef: "other-draft-node" }] },
            { roots: [{ nodeType: "work", fields: { name: "A" }, relations: { children: [{ nodeType: "work", fields: { name: 4 } }] } }] },
        ]) await assert.rejects(engine.create(selector, input as InitialIntent), error => error instanceof EditInputError && !!error.message && !!error.hint);
        assert.equal(acquires, 0); assert.equal(writes, 0);
        const valid = await engine.create(selector, initial());
        assert.equal(acquires, 1); assert.equal(writes, 1); assert.equal(Object.keys(valid.draft.graph.nodes).length, 2);
    } finally { await engine.close(); }
});
