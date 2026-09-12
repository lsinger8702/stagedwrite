import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType, GraphEditError } from "../src/index.js";
import type { GraphOp } from "../src/index.js";

function setup() {
  const definition = defineDraftType({
    id: "example.graph", version: "1",
    nodeTypes: {
      campaign: {
        valueSchema: { type: "object", properties: {
          budget: { $ref: "#/$defs/money" }, note: { type: ["string", "null"] },
          "a/b~c": { type: "string" }
        }, $defs: { money: { type: "number", minimum: 0 } }, additionalProperties: false },
        requiredAtPublish: ["budget"]
      },
      asset: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false } }
    },
    relationTypes: { uses: { from: ["campaign"], to: ["asset"] } }
  });
  const engine = createStagedWrite({ definitions: [definition] });
  const draft = engine.create({ type: definition.id, typeVersion: definition.version });
  return { engine, draft };
}
const initial: GraphOp[] = [
  { op: "node.add", id: "c1", nodeType: "campaign" },
  { op: "node.add", id: "c2", nodeType: "campaign" },
  { op: "node.add", id: "asset", nodeType: "asset" },
  { op: "set", nodeId: "c1", path: "/budget", value: 10 },
  { op: "edge.add", id: "e1", relationType: "uses", from: "c1", to: "asset" },
  { op: "edge.add", id: "e2", relationType: "uses", from: "c2", to: "asset" }
];
function hasCode(code: string) {
  return (error: unknown) => error instanceof GraphEditError && error.code === code;
}

test("one batch fills a graph with a shared reference and increments version once", () => {
  const { engine, draft } = setup();
  const result = engine.edit(draft.id, 0, initial);
  assert.equal(result.version, 1);
  assert.equal(result.edges.e1?.to, result.edges.e2?.to);
  assert.deepEqual(result.nodes.c1?.fields.budget, { kind: "value", value: 10 });
  assert.deepEqual(result.nodes.c2?.fields, {}); // publish completeness is separate
  assert.equal(result.definitionDigest, draft.definitionDigest);
  assert.equal("publish" in engine, false);
});

test("preview and edit produce identical candidates; previews consume no state or IDs", () => {
  const { engine, draft } = setup();
  const ops = structuredClone(initial);
  const preview = engine.preview(draft.id, 0, ops);
  assert.deepEqual(engine.getDraft(draft.id), draft);
  assert.deepEqual(engine.evaluateEdit(draft.id, 0, ops), preview);
  assert.deepEqual(ops, initial);
  assert.equal(preview.changes.length, initial.length);
  assert.deepEqual(preview.changes[3]?.after, { kind: "value", value: 10 });
  assert.deepEqual(engine.edit(draft.id, 0, ops), preview.candidate);
  preview.candidate.nodes.c1!.fields.budget = { kind: "value", value: 999 };
  preview.candidate.tombstones.nodes.push("corruption");
  assert.deepEqual(engine.getDraft(draft.id).nodes.c1?.fields.budget, { kind: "value", value: 10 });
  assert.deepEqual(engine.getDraft(draft.id).tombstones.nodes, []);
});

test("invalid final field values and relations roll back graph, version and tombstones", () => {
  const { engine, draft } = setup();
  engine.edit(draft.id, 0, initial);
  const before = engine.getDraft(draft.id);
  for (const tail of [
    { op: "set", nodeId: "c2", path: "/budget", value: -1 },
    { op: "edge.add", id: "bad", relationType: "uses", from: "asset", to: "c2" },
    { op: "edge.add", id: "bad", relationType: "missing", from: "c2", to: "asset" },
    { op: "edge.add", id: "bad", relationType: "uses", from: "c2", to: "missing" }
  ] as GraphOp[]) {
    assert.throws(() => engine.edit(draft.id, 1, [{ op: "edge.remove", id: "e1" }, { op: "node.remove", id: "c1" }, tail]), hasCode("INVALID_GRAPH"));
    assert.deepEqual(engine.getDraft(draft.id), before);
  }
});

test("deleting a shared target requires explicit removal of every incoming edge", () => {
  const { engine, draft } = setup();
  engine.edit(draft.id, 0, initial);
  assert.throws(() => engine.edit(draft.id, 1, [{ op: "node.remove", id: "asset" }, { op: "edge.remove", id: "e1" }]), hasCode("INVALID_GRAPH"));
  const result = engine.edit(draft.id, 1, [{ op: "node.remove", id: "asset" }, { op: "edge.remove", id: "e1" }, { op: "edge.remove", id: "e2" }]);
  assert.deepEqual(result.edges, {});
  assert.equal(Object.hasOwn(result.nodes, "asset"), false);
  assert.deepEqual(result.tombstones, { nodes: ["asset"], edges: ["e1", "e2"] });
});

test("deleted node and edge identities cannot be reused within a batch or later", () => {
  const { engine, draft } = setup();
  engine.edit(draft.id, 0, initial);
  assert.throws(() => engine.edit(draft.id, 1, [{ op: "node.remove", id: "c1" }, { op: "node.add", id: "c1", nodeType: "asset" }]), hasCode("ID_ALREADY_USED"));
  engine.edit(draft.id, 1, [{ op: "edge.remove", id: "e1" }, { op: "node.remove", id: "c1" }]);
  for (const op of [initial[0]!, initial[4]!]) assert.throws(() => engine.edit(draft.id, 2, [op]), hasCode("ID_ALREADY_USED"));
  const other = engine.create(draft);
  assert.equal(engine.edit(other.id, 0, initial).version, 1);
});

test("failed batches do not reserve newly introduced IDs", () => {
  const { engine, draft } = setup();
  assert.throws(() => engine.edit(draft.id, 0, [...initial, { op: "set", nodeId: "c1", path: "/budget", value: "bad" }]), hasCode("INVALID_GRAPH"));
  assert.deepEqual(engine.getDraft(draft.id), draft);
  assert.equal(engine.edit(draft.id, 0, initial).version, 1);
});

test("operations run in order while structural validity is checked on the final graph", () => {
  const { engine, draft } = setup();
  assert.throws(() => engine.edit(draft.id, 0, [{ op: "set", nodeId: "c1", path: "/budget", value: 10 }, initial[0]!]), hasCode("NODE_NOT_FOUND"));
  const ops: GraphOp[] = [initial[4]!, initial[0]!, initial[2]!,
    { op: "set", nodeId: "c1", path: "/budget", value: -1 },
    { op: "set", nodeId: "c1", path: "/budget", value: 5 }];
  const result = engine.preview(draft.id, 0, ops);
  assert.deepEqual(result.changes[3]?.after, { kind: "value", value: -1 });
  assert.deepEqual(result.candidate.nodes.c1?.fields.budget, { kind: "value", value: 5 });
  assert.deepEqual(engine.edit(draft.id, 0, ops), result.candidate);
});

test("clear, null and reset preserve distinct author intent with escaped field paths", () => {
  const { engine, draft } = setup();
  engine.edit(draft.id, 0, [initial[0]!]);
  const evaluated = engine.preview(draft.id, 1, [
    { op: "set", nodeId: "c1", path: "/note", value: null },
    { op: "remove", nodeId: "c1", path: "/note" },
    { op: "reset", nodeId: "c1", path: "/note" },
    { op: "remove", nodeId: "c1", path: "/budget" },
    { op: "set", nodeId: "c1", path: "/a~1b~0c", value: "escaped" }
  ]);
  assert.deepEqual(evaluated.changes.slice(0, 3).map(c => c.after), [{ kind: "value", value: null }, { kind: "clear" }, null]);
  assert.equal(Object.hasOwn(evaluated.candidate.nodes.c1!.fields, "note"), false);
  assert.deepEqual(evaluated.candidate.nodes.c1?.fields.budget, { kind: "clear" });
  assert.deepEqual(evaluated.candidate.nodes.c1?.fields["a/b~c"], { kind: "value", value: "escaped" });
  assert.throws(() => engine.edit(draft.id, 1, [{ op: "set", nodeId: "c1", path: "/budget", value: null }]), hasCode("INVALID_GRAPH"));
});

test("stale edits, stale previews and empty batches never change accepted state", () => {
  const { engine, draft } = setup();
  const old = engine.preview(draft.id, 0, initial);
  engine.edit(draft.id, 0, [initial[0]!]);
  const before = engine.getDraft(draft.id);
  for (const version of [old.candidate.version - 1, -1, 1.5, NaN]) {
    assert.throws(() => engine.edit(draft.id, version, initial), hasCode("STALE_VERSION"));
    assert.throws(() => engine.preview(draft.id, version, initial), hasCode("STALE_VERSION"));
  }
  assert.throws(() => engine.edit(draft.id, 1, []), hasCode("EMPTY_OP_BATCH"));
  assert.deepEqual(engine.getDraft(draft.id), before);
});

test("invalid op shapes, unsafe IDs, unknown fields and nested paths are rejected atomically", () => {
  const { engine, draft } = setup();
  engine.edit(draft.id, 0, [initial[0]!]);
  const before = engine.getDraft(draft.id);
  for (const op of [
    { op: "node.add", id: "__proto__", nodeType: "asset" },
    { op: "node.add", id: "new", nodeType: "missing" },
    { op: "set", nodeId: "c1", path: "/budget", value: Infinity },
    { op: "set", nodeId: "c1", path: "/budget", value: [] },
    { op: "set", nodeId: "c1", path: "/budget", value: 1, surprise: true },
    { op: "set", nodeId: "c1", path: "/budget" },
    { op: "remove", nodeId: "c1", path: "/missing" },
    { op: "reset", nodeId: "c1", path: "/missing" },
    { op: "reset", nodeId: "c1", path: "/note/child" },
    { op: "reset", nodeId: "c1", path: "/a~2b" },
    { op: "edge.remove", id: "missing" }, { op: "constructor" }
  ]) {
    assert.throws(() => engine.edit(draft.id, 1, [op as GraphOp]), GraphEditError);
    assert.deepEqual(engine.getDraft(draft.id), before);
  }
  assert.equal(Object.hasOwn(Object.prototype, "nodeType"), false);
});

test("nonempty no-op edits increment once and snapshots cannot corrupt history", () => {
  const { engine, draft } = setup();
  const result = engine.edit(draft.id, 0, [initial[0]!, { op: "reset", nodeId: "c1", path: "/note" }]);
  const next = engine.edit(draft.id, 1, [{ op: "reset", nodeId: "c1", path: "/note" }]);
  assert.equal(next.version, 2);
  assert.deepEqual(next.nodes, result.nodes);
  next.nodes.c1!.fields.note = { kind: "clear" };
  next.tombstones.nodes.push("future");
  assert.deepEqual(engine.getDraft(draft.id).nodes.c1?.fields, {});
  assert.deepEqual(engine.getDraft(draft.id).tombstones.nodes, []);
});
