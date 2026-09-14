import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType } from "../src/index.js";
import type { GraphRule, GraphDiagnostic, DraftEngine } from "../src/index.js";

const definition = defineDraftType({
  id: "example.check", version: "1",
  nodeTypes: { project: {
    valueSchema: { type: "object", properties: { capacity: { type: "number", minimum: 0 }, note: { type: ["string", "null"] } }, additionalProperties: false },
    requiredAtPublish: ["capacity", "note"]
  } }, relationTypes: {}
});
const selector = { type: definition.id, typeVersion: definition.version };
function rule(check: GraphRule["check"], version = "1"): GraphRule { return { ...selector, id: "capacity-policy", version, check }; }
function setup(rules: GraphRule[] = []) {
  const engine = createStagedWrite({ definitions: [definition], rules });
  const draft = engine.create(selector);
  return { engine, draft };
}
function fill(engine: DraftEngine, id: string) {
  return engine.edit(id, 0, [{ op: "node.add", id: "c/1", nodeType: "project" },
    { op: "set", nodeId: "c/1", path: "/capacity", value: 20 },
    { op: "set", nodeId: "c/1", path: "/note", value: null }]);
}
const suggestion: GraphDiagnostic = {
  code: "capacity.limit", path: "/nodes/c~11/fields/capacity", message: "Capacity exceeds the example limit.",
  hint: "Choose a capacity within the limit according to user intent.",
  candidates: [{ value: 8, message: "An example option, not a required choice." }],
  related: ["/nodes/c~11/fields/note"]
};

test("empty graphs and missing required values block, with escaped graph paths", () => {
  const { engine, draft } = setup();
  const empty = engine.preflight(draft.id);
  assert.equal(empty.status, "blocked");
  assert.equal(empty.diagnostics[0]?.code, "graph.empty");
  engine.edit(draft.id, 0, [{ op: "node.add", id: "c/1", nodeType: "project" }]);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "blocked");
  assert.deepEqual(check.diagnostics.map(d => d.path), ["/nodes/c~11/fields/capacity", "/nodes/c~11/fields/note"]);
  assert.ok(check.diagnostics.every(d => d.severity === "error" && d.message.includes("undeclared")));
  assert.deepEqual(check.preview.nodes["c/1"]?.fields, { capacity: { kind: "undeclared" }, note: { kind: "undeclared" } });
  assert.equal(engine.getDraft(draft.id).version, 1);
});

test("schema-allowed null is explicit value; clear and reset both block required fields", () => {
  const { engine, draft } = setup();
  fill(engine, draft.id);
  assert.equal(engine.preflight(draft.id).status, "passed");
  for (const op of ["remove", "reset"] as const) {
    const current = engine.getDraft(draft.id);
    engine.edit(draft.id, current.version, [{ op, nodeId: "c/1", path: "/note" }]);
    assert.equal(engine.preflight(draft.id).status, "blocked");
  }
});

test("caller chooses edits from diagnostics and preview, then preflight must rerun", () => {
  const { engine, draft } = setup([rule(d => {
    const capacity = d.nodes["c/1"]?.fields.capacity;
    return capacity?.kind === "value" && Number(capacity.value) > 10 ? [suggestion] : [];
  })]);
  const before = fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "blocked");
  assert.deepEqual(engine.getDraft(draft.id), before);
  assert.equal(check.preview.version, check.version);
  assert.deepEqual(check.preview.nodes["c/1"]?.fields.capacity, { kind: "value", value: 20 });
  assert.deepEqual(check.diagnostics[0]?.candidates, suggestion.candidates);
  assert.equal("resolution" in check.diagnostics[0]!, false);
  // The caller chooses 7, independently of the optional candidate 8.
  engine.edit(draft.id, check.version, [{ op: "set", nodeId: "c/1", path: "/capacity", value: 7 }]);
  assert.throws(() => engine.edit(draft.id, check.version, [{ op: "set", nodeId: "c/1", path: "/capacity", value: 9 }]), /STALE_VERSION/);
  assert.throws(() => engine.getCheck(draft.id, check.checkId), /CHECK_NOT_CURRENT/);
  const passed = engine.preflight(draft.id);
  assert.equal(passed.status, "passed");
  assert.equal(passed.scope, "draft");
  assert.equal("certificate" in passed, false);
  assert.equal("publish" in engine, false);
});

test("checks are latest-only and isolated by draft, engine and edit version", () => {
  const { engine, draft } = setup(); fill(engine, draft.id);
  const first = engine.preflight(draft.id);
  assert.deepEqual(engine.getCheck(draft.id, first.checkId), first);
  const second = engine.preflight(draft.id);
  assert.notEqual(first.checkId, second.checkId);
  assert.throws(() => engine.getCheck(draft.id, first.checkId), /CHECK_NOT_CURRENT/);
  const otherDraft = engine.create(selector);
  assert.throws(() => engine.getCheck(otherDraft.id, second.checkId), /CHECK_NOT_CURRENT/);
  const other = setup(); fill(other.engine, other.draft.id); other.engine.preflight(other.draft.id);
  assert.throws(() => other.engine.getCheck(other.draft.id, second.checkId), /CHECK_NOT_CURRENT/);
  engine.edit(draft.id, 1, [{ op: "set", nodeId: "c/1", path: "/capacity", value: 20 }]);
  assert.throws(() => engine.getCheck(draft.id, second.checkId), /CHECK_NOT_CURRENT/);
});

test("preview and rejected edits keep the last check usable", () => {
  const { engine, draft } = setup(); fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  engine.preview(draft.id, 1, [{ op: "remove", nodeId: "c/1", path: "/note" }]);
  assert.throws(() => engine.edit(draft.id, 1, []), /EMPTY_OP_BATCH/);
  assert.throws(() => engine.edit(draft.id, 0, [{ op: "reset", nodeId: "c/1", path: "/note" }]), /STALE_VERSION/);
  assert.throws(() => engine.edit(draft.id, 1, [{ op: "set", nodeId: "c/1", path: "/capacity", value: -1 }]), /INVALID_GRAPH/);
  assert.deepEqual(engine.getCheck(draft.id, check.checkId), check);
});

test("throwing, async and malformed diagnostic rules yield incomplete checks with previews", async () => {
  const badChecks: GraphRule["check"][] = [
    () => { throw new Error("provider detail should not leak"); },
    (async () => { throw new Error("async unsupported"); }) as unknown as GraphRule["check"],
    (() => [{ code: "bad", path: "not-a-pointer" }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, severity: ["warning"] }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, severity: "fatal" }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, message: " " }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, hint: 1 }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, related: ["not-a-pointer"] }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, candidates: [{ message: "missing value" }] }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, candidates: [{ value: {} }] }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, candidates: [{ value: Infinity }] }]) as unknown as GraphRule["check"],
    (() => [{ ...suggestion, resolution: { kind: "ops", ops: [] } }]) as unknown as GraphRule["check"]
  ];
  for (const check of badChecks) {
    const { engine, draft } = setup([rule(check)]); const before = fill(engine, draft.id);
    const result = engine.preflight(draft.id);
    assert.equal(result.status, "incomplete");
    assert.equal(result.diagnostics[0]?.code, "rule.error");
    assert.deepEqual(result.preview, before); // All schema fields in this fixture already have explicit values.
    assert.ok(!JSON.stringify(result).includes("provider detail should not leak"));
    assert.deepEqual(engine.getDraft(draft.id), before);
    assert.deepEqual(engine.getCheck(draft.id, result.checkId), result);
  }
  await new Promise(resolve => setImmediate(resolve));
});

test("one invalid diagnostic discards all output from that rule", () => {
  const { engine, draft } = setup([rule(() => [suggestion, { ...suggestion, message: "" }])]);
  fill(engine, draft.id);
  assert.deepEqual(engine.preflight(draft.id).diagnostics.map(d => d.code), ["rule.error"]);
});

test("rule input is frozen and isolated, and returned checks cannot mutate cached diagnostics", () => {
  let observed = 0;
  const modifying = rule(d => { d.nodes["c/1"]!.fields.capacity = { kind: "value", value: 999 }; return []; });
  const reading = { ...rule(d => { observed = Number((d.nodes["c/1"]!.fields.capacity as { value: number }).value); return [suggestion]; }), id: "read" };
  const { engine, draft } = setup([modifying, reading]); fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "incomplete");
  assert.equal(observed, 20);
  check.diagnostics.length = 0;
  assert.equal(engine.getCheck(draft.id, check.checkId).diagnostics.length, 2);
  assert.deepEqual(engine.getDraft(draft.id).nodes["c/1"]?.fields.capacity, { kind: "value", value: 20 });
});

test("bindings are frozen, versioned and restricted to their definition", () => {
  const input = rule(() => []);
  const { engine, draft } = setup([input]); fill(engine, draft.id);
  const original = engine.preflight(draft.id);
  input.version = "changed"; input.check = () => [suggestion];
  assert.equal(engine.preflight(draft.id).status, "passed");
  assert.equal(engine.preflight(draft.id).rulesDigest, original.rulesDigest);
  const other = setup([rule(() => [], "2")]); fill(other.engine, other.draft.id);
  assert.notEqual(other.engine.preflight(other.draft.id).rulesDigest, original.rulesDigest);
  const alternate = { ...definition, version: "2" };
  const isolated = createStagedWrite({ definitions: [definition, alternate], rules: [rule(() => { throw new Error("wrong version"); })] });
  const v2 = isolated.create({ ...selector, typeVersion: "2" }); fill(isolated, v2.id);
  assert.equal(isolated.preflight(v2.id).status, "passed");
  assert.throws(() => setup([rule(() => []), rule(() => [], "2")]), /RULE_CONFLICT/);
  assert.throws(() => setup([{ ...rule(() => []), typeVersion: "missing" }]), /TYPE_VERSION_NOT_FOUND/);
  assert.throws(() => setup([{ ...rule(() => []), check: undefined } as unknown as GraphRule]), /INVALID_RULE/);
});

test("same-draft callback reentry is blocked and the check lock is always released", () => {
  let engine!: DraftEngine;
  let draftId = "";
  let action: "edit" | "preflight" | "none" = "edit";
  engine = createStagedWrite({ definitions: [definition], rules: [rule(() => {
    if (action === "edit") engine.edit(draftId, 1, [{ op: "reset", nodeId: "c/1", path: "/note" }]);
    if (action === "preflight") engine.preflight(draftId);
    return [];
  })] });
  draftId = engine.create(selector).id; fill(engine, draftId);
  const old = engine.preflight(draftId);
  assert.equal(old.status, "incomplete");
  action = "preflight";
  assert.equal(engine.preflight(draftId).status, "incomplete");
  assert.throws(() => engine.getCheck(draftId, old.checkId), /CHECK_NOT_CURRENT/);
  action = "none";
  assert.equal(engine.preflight(draftId).status, "passed");
  assert.equal(engine.edit(draftId, 1, [{ op: "reset", nodeId: "c/1", path: "/note" }]).version, 2);
});

test("a graph relationship diagnostic leaves node and edge choices to the caller", () => {
  const graphDefinition = { ...definition, relationTypes: { related: { from: ["project"], to: ["project"] } } };
  const graphRule = rule(d => Object.keys(d.edges).length ? [] : [{
    code: "graph.related", path: "/edges", message: "Project c/1 has no related project.",
    hint: "Connect another project or create one according to user intent.", related: ["/nodes/c~11"]
  }]);
  const engine = createStagedWrite({ definitions: [graphDefinition], rules: [graphRule] });
  const draft = engine.create(selector); fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "blocked");
  assert.deepEqual(check.preview.edges, {});
  assert.equal(Object.hasOwn(check.preview.nodes, "related"), false);
  engine.edit(draft.id, check.version, [
    { op: "node.add", id: "related", nodeType: "project" },
    { op: "set", nodeId: "related", path: "/capacity", value: 0 },
    { op: "set", nodeId: "related", path: "/note", value: null },
    { op: "edge.add", id: "relation", relationType: "related", from: "c/1", to: "related" }
  ]);
  const passed = engine.preflight(draft.id);
  assert.equal(passed.status, "passed");
  assert.equal(passed.preview.edges.relation?.to, "related");
  assert.deepEqual(check.preview.edges, {}); // Old snapshots cannot change after an edit.
});

test("preview distinguishes explicit null, clear and undeclared without mutating the draft", () => {
  const { engine, draft } = setup();
  fill(engine, draft.id);
  const valued = engine.preflight(draft.id);
  assert.deepEqual(valued.preview.nodes["c/1"]?.fields.note, { kind: "value", value: null });
  let current = engine.edit(draft.id, valued.version, [{ op: "remove", nodeId: "c/1", path: "/note" }]);
  const cleared = engine.preflight(draft.id);
  assert.deepEqual(cleared.preview.nodes["c/1"]?.fields.note, { kind: "clear" });
  assert.match(cleared.diagnostics[0]!.message, /current intent is clear/);
  current = engine.edit(draft.id, current.version, [{ op: "reset", nodeId: "c/1", path: "/note" }]);
  const reset = engine.preflight(draft.id);
  assert.deepEqual(reset.preview.nodes["c/1"]?.fields.note, { kind: "undeclared" });
  assert.match(reset.diagnostics[0]!.message, /current intent is undeclared/);
  assert.equal(Object.hasOwn(current.nodes["c/1"]!.fields, "note"), false);
  reset.preview.nodes["c/1"]!.fields.note = { kind: "value", value: "caller mutation" };
  reset.preview.tombstones.nodes.push("c/1");
  assert.deepEqual(engine.getDraft(draft.id), current);
  const stored = engine.getCheck(draft.id, reset.checkId);
  assert.deepEqual(stored.preview.nodes["c/1"]?.fields.note, { kind: "undeclared" });
  assert.deepEqual(stored.preview.tombstones.nodes, []);
});

test("message-only rules work, unmatched rules stay absent, and warnings do not block", () => {
  const { engine, draft } = setup([
    rule(() => [{ code: "note.review", path: "/nodes/c~11/fields/note", message: "The note is explicitly null; review if a note is useful.", severity: "warning" }]),
    { ...rule(() => []), id: "unmatched" }
  ]);
  fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "passed");
  assert.equal(check.diagnostics.length, 1);
  assert.equal(check.diagnostics[0]?.source.kind, "rule");
  assert.equal("hint" in check.diagnostics[0]!, false);
  assert.deepEqual(check.preview.nodes["c/1"]?.fields.note, { kind: "value", value: null });
  const blocking = setup([rule(() => [{ code: "business.error", path: "", message: "This draft conflicts with the current policy." }])]);
  fill(blocking.engine, blocking.draft.id);
  assert.equal(blocking.engine.preflight(blocking.draft.id).status, "blocked");
});

test("preview includes undeclared optional escaped field names, graph edges and retired identities", () => {
  const special = defineDraftType({ id: "escaped", version: "1", nodeTypes: { item: {
    valueSchema: { type: "object", properties: { "a/b~c": { type: "string" } }, additionalProperties: false }
  } }, relationTypes: { uses: { from: ["item"], to: ["item"] } } });
  const engine = createStagedWrite({ definitions: [special] });
  const draft = engine.create({ type: "escaped", typeVersion: "1" });
  engine.edit(draft.id, 0, [
    { op: "node.add", id: "a", nodeType: "item" }, { op: "node.add", id: "b", nodeType: "item" },
    { op: "set", nodeId: "b", path: "/a~1b~0c", value: "known" },
    { op: "edge.add", id: "a/b", relationType: "uses", from: "a", to: "b" },
    { op: "node.add", id: "retired", nodeType: "item" }, { op: "node.remove", id: "retired" }
  ]);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "passed");
  assert.deepEqual(check.preview.nodes.a?.fields["a/b~c"], { kind: "undeclared" });
  assert.deepEqual(check.preview.nodes.b?.fields["a/b~c"], { kind: "value", value: "known" });
  assert.equal(check.preview.edges["a/b"]?.to, "b");
  assert.deepEqual(check.preview.tombstones.nodes, ["retired"]);
  assert.equal(check.preview.id, check.draftId);
  assert.equal(check.preview.definitionDigest, check.definitionDigest);
});
