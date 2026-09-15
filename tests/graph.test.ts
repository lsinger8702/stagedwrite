import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType, GraphEditError, type GraphOp } from "../src/index.js";
const definition = defineDraftType({ id: "example.graph", version: "1", nodeTypes: { project: { valueSchema: { type: "object", properties: { capacity: { $ref: "#/$defs/quantity" }, note: { type: ["string", "null"] }, "a/b~c": { type: "string" } }, $defs: { quantity: { type: "number", minimum: 0 } }, additionalProperties: false }, requiredAtPublish: ["capacity"] }, document: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false } } }, relationTypes: { uses: { from: ["project"], to: ["document"] } } });
const selector = { type: definition.id, typeVersion: definition.version };
async function setup() { const engine = createStagedWrite({ definitions: [definition] }); const draft = await engine.create(selector, { nodes: { seed: { id: "seed", nodeType: "document", fields: { name: "Initial work" } } }, edges: {} }); return { engine, draft }; }
const initial: GraphOp[] = [{ op: "node.add", id: "c1", nodeType: "project" }, { op: "node.add", id: "c2", nodeType: "project" }, { op: "node.add", id: "document", nodeType: "document" }, { op: "set", nodeId: "c1", path: "/capacity", value: 10 }, { op: "edge.add", id: "e1", relationType: "uses", from: "c1", to: "document" }, { op: "edge.add", id: "e2", relationType: "uses", from: "c2", to: "document" }];
const hasCode = (code: string) => (e: unknown) => e instanceof GraphEditError && e.code === code;
test("graph: one batch adds shared references and projects ordinary values", async () => {
    const { engine, draft } = await setup(), result = await engine.edit(draft.id, 0, initial);
    assert.equal(result.version, 1);
    assert.equal(result.graph.edges.e1?.to, result.graph.edges.e2?.to);
    assert.equal(result.graph.nodes.c1?.fields.capacity, 10);
    assert.deepEqual(result.fieldIntents.c1?.["/capacity"], { kind: "set", value: 10 });
    assert.deepEqual(result.graph.nodes.c2?.fields, {});
    assert.equal((await engine.preflight(draft.id)).status, "blocked");
    await engine.close();
});
test("graph: preview does not consume state or identities and predicts the accepted intent", async () => {
    const { engine, draft } = await setup(), ops = structuredClone(initial), preview = await engine.preview(draft.id, 0, ops);
    assert.deepEqual(await engine.getDraft(draft.id), draft);
    assert.deepEqual(ops, initial);
    assert.equal(preview.changes.length, initial.length);
    const actual = await engine.edit(draft.id, 0, ops);
    assert.deepEqual(actual.graph, preview.candidate.graph);
    assert.deepEqual(actual.fieldIntents, preview.candidate.fieldIntents);
    preview.candidate.graph.nodes.c1!.fields.capacity = 999;
    preview.candidate.tombstones.nodes.push("corruption");
    assert.equal((await engine.getDraft(draft.id)).graph.nodes.c1!.fields.capacity, 10);
    assert.deepEqual((await engine.getDraft(draft.id)).tombstones.nodes, []);
    await engine.close();
});
test("graph: invalid final fields and relations roll back nodes, edges, intents and tombstones", async () => {
    const { engine, draft } = await setup();
    await engine.edit(draft.id, 0, initial);
    const before = await engine.getDraft(draft.id);
    for (const tail of [{ op: "set", nodeId: "c2", path: "/capacity", value: -1 }, { op: "edge.add", id: "bad", relationType: "uses", from: "document", to: "c2" }, { op: "edge.add", id: "bad", relationType: "missing", from: "c2", to: "document" }, { op: "edge.add", id: "bad", relationType: "uses", from: "c2", to: "missing" }] as GraphOp[]) {
        await assert.rejects(engine.edit(draft.id, 1, [{ op: "edge.remove", id: "e1" }, { op: "node.remove", id: "c1" }, tail]), hasCode("INVALID_GRAPH"));
        assert.deepEqual(await engine.getDraft(draft.id), before);
    }
    await engine.close();
});
test("graph: deleting a shared target requires explicitly removing all incoming edges", async () => {
    const { engine, draft } = await setup();
    await engine.edit(draft.id, 0, initial);
    await assert.rejects(engine.edit(draft.id, 1, [{ op: "node.remove", id: "document" }, { op: "edge.remove", id: "e1" }]), hasCode("INVALID_GRAPH"));
    const result = await engine.edit(draft.id, 1, [{ op: "node.remove", id: "document" }, { op: "edge.remove", id: "e1" }, { op: "edge.remove", id: "e2" }]);
    assert.deepEqual(result.graph.edges, {});
    assert.equal(Object.hasOwn(result.fieldIntents, "document"), false);
    assert.deepEqual(result.tombstones, { nodes: ["document"], edges: ["e1", "e2"] });
    await engine.close();
});
test("graph: deleted node and edge IDs stay reserved, failed batches reserve nothing", async () => {
    const { engine, draft } = await setup();
    await assert.rejects(engine.edit(draft.id, 0, [...initial, { op: "set", nodeId: "c1", path: "/capacity", value: "bad" }]), hasCode("INVALID_GRAPH"));
    await engine.edit(draft.id, 0, initial);
    await assert.rejects(engine.edit(draft.id, 1, [{ op: "node.remove", id: "c1" }, { op: "node.add", id: "c1", nodeType: "document" }]), hasCode("ID_ALREADY_USED"));
    await engine.edit(draft.id, 1, [{ op: "edge.remove", id: "e1" }, { op: "node.remove", id: "c1" }]);
    for (const op of [initial[0]!, initial[4]!])
        await assert.rejects(engine.edit(draft.id, 2, [op]), hasCode("ID_ALREADY_USED"));
    await engine.close();
});
test("graph: OP order is explicit and structural validity is checked on the final candidate", async () => {
    const { engine, draft } = await setup();
    await assert.rejects(engine.edit(draft.id, 0, [initial[3]!, initial[0]!]), hasCode("NODE_NOT_FOUND"));
    const ops: GraphOp[] = [initial[4]!, initial[0]!, initial[2]!, { op: "set", nodeId: "c1", path: "/capacity", value: -1 }, { op: "set", nodeId: "c1", path: "/capacity", value: 5 }];
    const result = await engine.preview(draft.id, 0, ops);
    assert.deepEqual(result.changes[3]!.after, { kind: "value", value: -1 });
    assert.equal(result.candidate.graph.nodes.c1!.fields.capacity, 5);
    assert.deepEqual((await engine.edit(draft.id, 0, ops)).graph, result.candidate.graph);
    await engine.close();
});
test("graph: clear, null and undeclared stay distinct with escaped field paths", async () => {
    const { engine, draft } = await setup();
    await engine.edit(draft.id, 0, [initial[0]!]);
    const result = await engine.preview(draft.id, 1, [{ op: "set", nodeId: "c1", path: "/note", value: null }, { op: "remove", nodeId: "c1", path: "/note" }, { op: "reset", nodeId: "c1", path: "/note" }, { op: "remove", nodeId: "c1", path: "/capacity" }, { op: "set", nodeId: "c1", path: "/a~1b~0c", value: "escaped" }]);
    assert.deepEqual(result.changes.slice(0, 3).map(c => c.after), [{ kind: "value", value: null }, { kind: "clear" }, null]);
    assert.equal(result.candidate.fieldIntents.c1!["/note"], undefined);
    assert.deepEqual(result.candidate.fieldIntents.c1!["/capacity"], { kind: "remove" });
    assert.equal(result.candidate.graph.nodes.c1!.fields["a/b~c"], "escaped");
    await assert.rejects(engine.edit(draft.id, 1, [{ op: "set", nodeId: "c1", path: "/capacity", value: null }]), hasCode("INVALID_GRAPH"));
    await engine.close();
});
test("graph: stale/empty/invalid batches never change accepted state", async () => {
    const { engine, draft } = await setup();
    await engine.edit(draft.id, 0, [initial[0]!]);
    const before = await engine.getDraft(draft.id);
    for (const version of [0, -1, 1.5, NaN]) {
        await assert.rejects(engine.edit(draft.id, version, initial), hasCode("STALE_VERSION"));
        await assert.rejects(engine.preview(draft.id, version, initial), hasCode("STALE_VERSION"));
    }
    await assert.rejects(engine.edit(draft.id, 1, []), hasCode("EMPTY_OP_BATCH"));
    for (const op of [{ op: "node.add", id: "__proto__", nodeType: "document" }, { op: "node.add", id: "new", nodeType: "missing" }, { op: "set", nodeId: "c1", path: "/capacity", value: Infinity }, { op: "set", nodeId: "c1", path: "/capacity", value: [] }, { op: "set", nodeId: "c1", path: "/capacity", value: 1, surprise: true }, { op: "remove", nodeId: "c1", path: "/missing" }, { op: "reset", nodeId: "c1", path: "/note/child" }, { op: "reset", nodeId: "c1", path: "/a~2b" }, { op: "edge.remove", id: "missing" }, { op: "constructor" }])
        await assert.rejects(engine.edit(draft.id, 1, [op as GraphOp]));
    assert.deepEqual(await engine.getDraft(draft.id), before);
    assert.equal(Object.hasOwn(Object.prototype, "nodeType"), false);
    await engine.close();
});
test("graph: nonempty no-op edits advance version without corrupting snapshots", async () => {
    const { engine, draft } = await setup();
    await engine.edit(draft.id, 0, [initial[0]!, { op: "reset", nodeId: "c1", path: "/note" }]);
    const before = await engine.getDraft(draft.id);
    const next = await engine.edit(draft.id, 1, [{ op: "reset", nodeId: "c1", path: "/note" }]);
    assert.equal(next.version, 2);
    assert.deepEqual(next.graph, before.graph);
    next.graph.nodes.c1!.fields.note = "corruption";
    next.tombstones.nodes.push("bad");
    assert.deepEqual((await engine.getDraft(draft.id)).graph, before.graph);
    await engine.close();
});
