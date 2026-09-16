import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionRegistry } from "../src/registry/registry.js";
import { registeredTopology } from "../src/edit/registered-topology.js";
import { prepareEdit } from "../src/managed/prepare-edit.js";
import type { EditBatch } from "../src/edit/protocol.js";
import type { RepairProtection } from "../src/managed/edit-guards.js";
const selector = { type: "boundary", typeVersion: "1" };
function setup() {
  const registry = new DefinitionRegistry([{ id: selector.type, version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { title: { type: "string" }, ignoredByPlanner: { type: "string" } }, additionalProperties: false } } }, relationTypes: { children: { from: ["task"], to: ["task"], ownership: "owned", cardinality: "many" } } }]);
  const bound = registeredTopology(registry, selector);
  const result = bound.initialize({ roots: [{ nodeType: "task", fields: { title: "A", ignoredByPlanner: "original" } }, { nodeType: "task", fields: { title: "B" } }] });
  const [a, b] = result.createdRefs.map(r => r.ref) as [string, string];
  const draft = { ...result.candidate, ...selector, id: "draft", version: 7, definitionDigest: bound.definitionDigest, status: "pending" as const, updatedAt: "before", currentRunId: "run", initialSnapshot: structuredClone(result.candidate) };
  const run: RepairProtection = { state: "blocked", adopted: structuredClone(draft), successfulNodes: [a] };
  const edit = (batch: EditBatch, preview = false, expected = 7, protection: RepairProtection | undefined = run) => prepareEdit(registry, draft, draft.initialSnapshot, expected, batch, { preview, now: "after", run: protection });
  return { registry, draft, a, b, run, edit };
}
test("managed edit boundary: preview and commit candidates share version, successful-node and topology guards", () => {
  const { draft, a, b, edit } = setup(), before = structuredClone(draft);
  for (const preview of [false, true]) {
    assert.throws(() => edit({ patches: [{ op: "set", ref: a, scope: "canonical", path: "/ignoredByPlanner", value: "changed" }] }, preview), /APPLIED_STEP_IMMUTABLE/);
    assert.throws(() => edit({ graphPatches: [{ op: "set", parentRef: b, path: "/children", value: { nodeType: "task", fields: { title: "new" } } }] }, preview), /REPAIR_TOPOLOGY_CHANGED/);
    assert.throws(() => edit({ patches: [{ op: "reset", ref: b, scope: "canonical", path: "/title" }] }, preview, 6), /STALE_VERSION/);
  }
  assert.deepEqual(draft, before);
});
test("managed edit boundary: allowed repair returns a light receipt, preserves metadata, and cannot mutate the baseline", () => {
  const { draft, b, edit } = setup(); const before = structuredClone(draft);
  const batch: EditBatch = { patches: [{ op: "set", ref: b, scope: "canonical", path: "/title", value: "fixed" }] };
  const preview = edit(batch, true), actual = edit(batch);
  assert.deepEqual(actual.candidate, preview.candidate);
  assert.equal(actual.candidate.currentRunId, "run");
  assert.equal(actual.receipt.version, 8);
  assert.equal(actual.receipt.preflightRequired, true);
  assert.deepEqual(Object.keys(actual.receipt).sort(), ["changes", "createdRefs", "draftId", "preflightRequired", "version"]);
  actual.preview.candidate.graph.nodes[b]!.fields.title = "tampered";
  assert.equal(actual.candidate.graph.nodes[b]!.fields.title, "fixed");
  assert.deepEqual(draft, before);
  assert.deepEqual(actual.candidate.initialSnapshot, before.initialSnapshot);
});
test("managed edit boundary: unknown permits only unsuccessful intent repair, and published still has no update dispatch", () => {
  const { registry, draft, a, b, edit, run } = setup();
  const unknown = { ...run, state: "unknown" as const };
  assert.equal(edit({ patches: [{ op: "set", ref: b, scope: "canonical", path: "/title", value: "new intent" }] }, false, 7, unknown).candidate.graph.nodes[b]!.fields.title, "new intent");
  assert.throws(() => edit({ patches: [{ op: "remove", ref: a, scope: "canonical", path: "/title" }] }, false, 7, unknown), /APPLIED_STEP_IMMUTABLE/);
  assert.throws(() => prepareEdit(registry, { ...draft, status: "published" }, draft.initialSnapshot, 7, { patches: [{ op: "reset", ref: b, scope: "canonical", path: "/title" }] }, { preview: true, now: "after" }), /UPDATE_NOT_SUPPORTED/);
  const max = { ...draft, version: Number.MAX_SAFE_INTEGER };
  assert.throws(() => prepareEdit(registry, max, draft.initialSnapshot, max.version, { patches: [{ op: "reset", ref: b, scope: "canonical", path: "/title" }] }, { preview: false, now: "after" }), /VERSION_EXHAUSTED/);
});
