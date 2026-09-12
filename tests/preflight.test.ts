import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType } from "../src/index.js";
import type { GraphRule, GraphDiagnostic, DraftEngine } from "../src/index.js";

const definition = defineDraftType({
  id: "example.check", version: "1",
  nodeTypes: { campaign: {
    valueSchema: { type: "object", properties: { budget: { type: "number", minimum: 0 }, note: { type: ["string", "null"] } }, additionalProperties: false },
    requiredAtPublish: ["budget", "note"]
  } }, relationTypes: {}
});
const selector = { type: definition.id, typeVersion: definition.version };
function rule(check: GraphRule["check"], version = "1"): GraphRule { return { ...selector, id: "budget-policy", version, check }; }
function setup(rules: GraphRule[] = []) {
  const engine = createStagedWrite({ definitions: [definition], rules });
  const draft = engine.create(selector);
  return { engine, draft };
}
function fill(engine: DraftEngine, id: string) {
  return engine.edit(id, 0, [{ op: "node.add", id: "c/1", nodeType: "campaign" },
    { op: "set", nodeId: "c/1", path: "/budget", value: 20 },
    { op: "set", nodeId: "c/1", path: "/note", value: null }]);
}
const suggestion: GraphDiagnostic = {
  code: "budget.limit", path: "/nodes/c~11/fields/budget", message: "Budget exceeds the example limit.",
  resolution: { kind: "ops", ops: [{ op: "set", nodeId: "c/1", path: "/budget", value: 10 }] }
};

test("empty graphs and missing required values block, with escaped graph paths", () => {
  const { engine, draft } = setup();
  const empty = engine.preflight(draft.id);
  assert.equal(empty.status, "blocked");
  assert.equal(empty.diagnostics[0]?.code, "graph.empty");
  engine.edit(draft.id, 0, [{ op: "node.add", id: "c/1", nodeType: "campaign" }]);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "blocked");
  assert.deepEqual(check.diagnostics.map(d => d.path), ["/nodes/c~11/fields/budget", "/nodes/c~11/fields/note"]);
  assert.ok(check.diagnostics.every(d => d.resolution.kind === "blocked" && d.resolution.reason === "human_intent"));
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

test("rule repair is validated but only explicit edit applies it, then preflight must rerun", () => {
  const { engine, draft } = setup([rule(d => {
    const budget = d.nodes["c/1"]?.fields.budget;
    return budget?.kind === "value" && Number(budget.value) > 10 ? [suggestion] : [];
  })]);
  const before = fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "blocked");
  assert.deepEqual(engine.getDraft(draft.id), before);
  const resolution = check.diagnostics[0]!.resolution;
  assert.equal(resolution.kind, "ops");
  if (resolution.kind !== "ops") assert.fail();
  engine.edit(draft.id, check.version, resolution.ops);
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
  engine.edit(draft.id, 1, [{ op: "set", nodeId: "c/1", path: "/budget", value: 20 }]);
  assert.throws(() => engine.getCheck(draft.id, second.checkId), /CHECK_NOT_CURRENT/);
});

test("preview and rejected edits keep the last check usable", () => {
  const { engine, draft } = setup(); fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  engine.preview(draft.id, 1, [{ op: "remove", nodeId: "c/1", path: "/note" }]);
  assert.throws(() => engine.edit(draft.id, 1, []), /EMPTY_OP_BATCH/);
  assert.throws(() => engine.edit(draft.id, 0, [{ op: "reset", nodeId: "c/1", path: "/note" }]), /STALE_VERSION/);
  assert.throws(() => engine.edit(draft.id, 1, [{ op: "set", nodeId: "c/1", path: "/budget", value: -1 }]), /INVALID_GRAPH/);
  assert.deepEqual(engine.getCheck(draft.id, check.checkId), check);
});

test("throwing, async, malformed and impossible repair rules yield incomplete checks", async () => {
  const badChecks: GraphRule["check"][] = [
    () => { throw new Error("provider detail should not leak"); },
    (async () => { throw new Error("async unsupported"); }) as unknown as GraphRule["check"],
    (() => [{ code: "bad", path: "not-a-pointer" }]) as unknown as GraphRule["check"],
    () => [{ ...suggestion, resolution: { kind: "ops", ops: [] } }],
    () => [{ ...suggestion, resolution: { kind: "ops", ops: [{ op: "set", nodeId: "missing", path: "/budget", value: 1 }] } }],
    () => [{ ...suggestion, resolution: { kind: "ops", ops: [{ op: "set", nodeId: "c/1", path: "/budget", value: -1 }] } }]
  ];
  for (const check of badChecks) {
    const { engine, draft } = setup([rule(check)]); const before = fill(engine, draft.id);
    const result = engine.preflight(draft.id);
    assert.equal(result.status, "incomplete");
    assert.equal(result.diagnostics[0]?.code, "rule.error");
    assert.deepEqual(engine.getDraft(draft.id), before);
    assert.deepEqual(engine.getCheck(draft.id, result.checkId), result);
  }
  await new Promise(resolve => setImmediate(resolve));
});

test("one invalid diagnostic discards all suggestions from that rule", () => {
  const { engine, draft } = setup([rule(() => [suggestion, { ...suggestion, resolution: { kind: "ops", ops: [] } }])]);
  fill(engine, draft.id);
  assert.deepEqual(engine.preflight(draft.id).diagnostics.map(d => d.code), ["rule.error"]);
});

test("rule input is frozen and isolated, and returned checks cannot mutate cached diagnostics", () => {
  let observed = 0;
  const modifying = rule(d => { d.nodes["c/1"]!.fields.budget = { kind: "value", value: 999 }; return []; });
  const reading = { ...rule(d => { observed = Number((d.nodes["c/1"]!.fields.budget as { value: number }).value); return [suggestion]; }), id: "read" };
  const { engine, draft } = setup([modifying, reading]); fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "incomplete");
  assert.equal(observed, 20);
  check.diagnostics.length = 0;
  assert.equal(engine.getCheck(draft.id, check.checkId).diagnostics.length, 2);
  assert.deepEqual(engine.getDraft(draft.id).nodes["c/1"]?.fields.budget, { kind: "value", value: 20 });
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

test("a graph rule can propose a node-and-edge repair without reserving identities", () => {
  const graphDefinition = { ...definition, relationTypes: { related: { from: ["campaign"], to: ["campaign"] } } };
  const graphRule = rule(d => Object.keys(d.edges).length ? [] : [{
    code: "graph.related", path: "/edges", message: "The example requires a related campaign.",
    resolution: { kind: "ops", ops: [
      { op: "node.add", id: "related", nodeType: "campaign" },
      { op: "set", nodeId: "related", path: "/budget", value: 0 },
      { op: "set", nodeId: "related", path: "/note", value: null },
      { op: "edge.add", id: "relation", relationType: "related", from: "c/1", to: "related" }
    ] }
  }]);
  const engine = createStagedWrite({ definitions: [graphDefinition], rules: [graphRule] });
  const draft = engine.create(selector); fill(engine, draft.id);
  const check = engine.preflight(draft.id);
  const repair = check.diagnostics[0]!.resolution;
  assert.equal(check.status, "blocked");
  assert.deepEqual(engine.getDraft(draft.id).edges, {});
  assert.equal(Object.hasOwn(engine.getDraft(draft.id).nodes, "related"), false);
  if (repair.kind !== "ops") assert.fail();
  engine.edit(draft.id, check.version, repair.ops);
  assert.equal(engine.preflight(draft.id).status, "passed");
  assert.equal(engine.getDraft(draft.id).edges.relation?.to, "related");
});
