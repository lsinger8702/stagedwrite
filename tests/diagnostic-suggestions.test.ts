import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite } from "../src/index.js";
import type { GraphDiagnostic, GraphRule } from "../src/index.js";
import { definition, selector, initial, rules, chosen } from "../examples/fixtures/project-tasks.js";

for (const durable of [false, true]) test(`optional candidates and repairs survive snapshots; never auto-apply (${durable ? "sqlite" : "memory"})`, t => {
  const dir = mkdtempSync(join(tmpdir(), "stagedwrite-suggestions-"));
  const storage = durable ? { kind: "sqlite" as const, path: join(dir, "drafts.sqlite") } : undefined;
  let engine = createStagedWrite({ definitions: [definition], rules, storage });
  t.after(() => { engine.close(); rmSync(dir, { recursive: true, force: true }); });
  const draft = engine.create(selector, initial);
  const check = engine.preflight(draft.id);
  assert.equal(check.status, "blocked"); assert.equal(check.diagnostics.length, 3);
  assert.deepEqual(engine.getDraft(draft.id), draft);
  assert.equal(check.diagnostics[0]!.metadata!.excessHours, 6);
  assert.equal(check.diagnostics[1]!.repairs!.length, 2);
  const owner = check.diagnostics[2]!;
  assert.equal(owner.candidates![0]!.label, "林");
  assert.deepEqual(owner.candidates![0]!.metadata!.skills, ["documentation"]);
  assert.deepEqual(owner.constraintIds, ["demo-current-period-availability"]);
  assert.equal(owner.excludedCandidates![0]!.value, "zhou");
  assert.equal("repairOps" in owner.excludedCandidates![0]!, false);
  if (durable) { engine.close(); engine = createStagedWrite({ definitions: [definition], rules, storage }); }
  assert.deepEqual(engine.getCheck(draft.id), check);
  // Selecting one repair really uses ordinary edit, without implicitly accepting other alternatives.
  const ops = owner.candidates![0]!.repairOps!;
  const selected = engine.edit(draft.id, check.version, ops);
  assert.deepEqual(selected.nodes["task-1"]!.fields.owner, { kind: "value", value: "lin" });
  assert.deepEqual(engine.preflight(draft.id).diagnostics.map(d => d.code), ["project.capacity_exceeded", "task.after_project_deadline"]);
  assert.throws(() => engine.edit(draft.id, check.version, ops), /STALE_VERSION/);
  engine.edit(draft.id, selected.version, chosen);
  assert.equal(engine.preflight(draft.id).status, "passed");
});

const minimal = { code: "test.issue", path: "/nodes/task-1/fields/owner", message: "An owner decision is needed." };
function checkWith(output: unknown) {
  const rule: GraphRule = { ...selector, id: "test.optional", version: "1", check: (() => output) as GraphRule["check"] };
  const engine = createStagedWrite({ definitions: [definition], rules: [rule] });
  const draft = engine.create(selector, initial);
  try { const result = engine.preflight(draft.id); assert.deepEqual(engine.getDraft(draft.id), draft); return result; }
  finally { engine.close(); }
}
test("minimal diagnostics need no suggestions; optional context and multi-op repairs work", () => {
  const basic = checkWith([minimal]);
  assert.equal(basic.status, "blocked");
  assert.equal("repairs" in basic.diagnostics[0]!, false);
  assert.equal("candidates" in basic.diagnostics[0]!, false);
  const full: GraphDiagnostic = { ...minimal, stage: "availability", retryable: true, retryAfterSeconds: 10,
    metadata: { observed: { status: "pending", counts: [1, 2] }, note: null },
    repairs: [{ message: "Create an alternative task and attach it to this project if desired.", ops: [
      { op: "node.add", id: "task-3", nodeType: "task" },
      { op: "set", nodeId: "task-3", path: "/name", value: "Optional follow-up" },
      { op: "edge.add", id: "contains-3", relationType: "contains", from: "project-1", to: "task-3" }
    ] }] };
  assert.deepEqual(checkWith([full]).diagnostics[0], { ...full, severity: "error", source: { kind: "rule", id: "test.optional", version: "1" } });
});

test("malformed optional data or inapplicable repair batches fail the whole rule output", () => {
  const bad = [
    { repairs: [{ message: "empty batch", ops: [] }] },
    { repairs: [{ message: "wrong type", ops: [{ op: "set", nodeId: "task-1", path: "/estimateHours", value: "wrong" }] }] },
    { repairs: [{ message: "dangling", ops: [{ op: "edge.add", id: "e", relationType: "contains", from: "project-1", to: "absent" }] }] },
    { repairs: [{ ops: [{ op: "remove", nodeId: "task-1", path: "/owner" }] }] },
    { candidates: [{ value: "lin", repairOps: [{ op: "sendRequest" }] }] },
    { candidates: [{ value: "lin", repairOps: [{ op: "set", nodeId: "missing", path: "/owner", value: "lin" }] }] },
    { candidates: [{ value: "lin", metadata: [] }] },
    { candidates: [{ value: "lin", label: 123 }] },
    { excludedCandidates: [{ value: "lin", repairOps: [{ op: "reset", nodeId: "task-1", path: "/owner" }] }] },
    { constraintIds: [12] }, { stage: "" }, { retryable: "true" },
    { retryAfterSeconds: 10 }, { retryable: false, retryAfterSeconds: 10 }, { retryable: true, retryAfterSeconds: -1 },
    { metadata: { nested: { bad: Infinity } } }, { metadata: { bad: () => 1 } }
  ];
  for (const fields of bad) {
    const result = checkWith([minimal, { ...minimal, ...fields }]);
    assert.equal(result.status, "incomplete", JSON.stringify(fields));
    assert.deepEqual(result.diagnostics.map(d => d.code), ["rule.error"]);
  }
});

test("returned optional nested data cannot mutate cached checks", () => {
  const engine = createStagedWrite({ definitions: [definition], rules });
  try {
    const draft = engine.create(selector, initial); const check = engine.preflight(draft.id);
    const copy = structuredClone(check);
    check.diagnostics[2]!.candidates![0]!.metadata!.skills = ["changed"];
    check.diagnostics[2]!.candidates![0]!.repairOps![0]!.op = "reset";
    assert.deepEqual(engine.getCheck(draft.id), copy);
    assert.deepEqual(engine.getDraft(draft.id), draft);
  } finally { engine.close(); }
});
