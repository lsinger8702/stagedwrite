import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLegacyStagedWrite } from "../src/index.js";
import type { GraphInitialIntent } from "../src/index.js";
import { definition, selector, initial, rules, chosen } from "../examples/fixtures/project-tasks.js";

for (const mode of ["memory", "sqlite"] as const) {
  test(`${mode}: create stores initial intent atomically; preflight diagnoses it and edit changes it`, t => {
    const dir = mkdtempSync(join(tmpdir(), "stagedwrite-initial-"));
    const storage = mode === "sqlite" ? { kind: "sqlite" as const, path: join(dir, "drafts.sqlite") } : undefined;
    let engine = createLegacyStagedWrite({ definitions: [definition], rules, storage });
    t.after(() => { engine.close(); rmSync(dir, { recursive: true, force: true }); });
    const input = structuredClone(initial);
    const draft = engine.create(selector, input);
    assert.equal(draft.version, 0);
    assert.deepEqual(draft.nodes, initial.nodes);
    assert.deepEqual(draft.edges, initial.edges);
    assert.deepEqual(draft.tombstones, { nodes: [], edges: [] });
    input.nodes["project-1"]!.fields.name = { kind: "value", value: "outside change" };
    draft.nodes["project-1"]!.fields.name = { kind: "clear" };
    if (mode === "sqlite") { engine.close(); engine = createLegacyStagedWrite({ definitions: [definition], rules, storage }); }
    assert.deepEqual(engine.getDraft(draft.id).nodes, initial.nodes);
    const check = engine.preflight(draft.id);
    assert.equal(check.status, "blocked"); assert.equal(check.diagnostics.length, 3);
    assert.equal(engine.edit(draft.id, check.version, chosen).version, 1);
    assert.equal(engine.preflight(draft.id).status, "passed");
    const before = engine.listDraftIds();
    const badValue = structuredClone(initial); badValue.nodes["task-1"]!.fields.estimateHours = { kind: "value", value: "wrong" };
    const dangling = structuredClone(initial); dangling.edges["contains-1"]!.to = "missing";
    const badType = structuredClone(initial); badType.nodes["task-1"]!.nodeType = "missing";
    const wrongEndpoint = structuredClone(initial); wrongEndpoint.edges["contains-1"]!.to = "project-1";
    const mismatch = structuredClone(initial); mismatch.nodes["task-1"]!.id = "different";
    let getterCalled = false;
    const getter = { get nodes() { getterCalled = true; return initial.nodes; }, edges: initial.edges };
    for (const value of [badValue, dangling, badType, wrongEndpoint, mismatch, getter, { nodes: {}, edges: {} }, { ...initial, version: 99 }, { nodes: [], edges: {} }]) {
      assert.throws(() => engine.create(selector, value as GraphInitialIntent));
      assert.deepEqual(engine.listDraftIds(), before);
    }
    assert.equal(getterCalled, false);
  });
}

test("initial intent preserves undeclared, clear and explicit null without schema defaults", () => {
  const engine = createLegacyStagedWrite({ definitions: [definition] });
  try {
    const input = structuredClone(initial);
    delete input.nodes["project-1"]!.fields.capacityHours;
    input.nodes["task-2"]!.fields.owner = { kind: "value", value: null };
    const draft = engine.create(selector, input);
    assert.equal(Object.hasOwn(draft.nodes["project-1"]!.fields, "capacityHours"), false);
    const check = engine.preflight(draft.id);
    assert.deepEqual(check.preview.nodes["project-1"]!.fields.capacityHours, { kind: "undeclared" });
    assert.deepEqual(check.preview.nodes["task-1"]!.fields.owner, { kind: "clear" });
    assert.deepEqual(check.preview.nodes["task-2"]!.fields.owner, { kind: "value", value: null });
  } finally { engine.close(); }
});
