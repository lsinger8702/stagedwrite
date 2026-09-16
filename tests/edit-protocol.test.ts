import assert from "node:assert/strict";
import test from "node:test";
import { EditInputError, parseEditBatch, type FieldPatch, type TopologyPatch } from "../src/edit/protocol.js";
const set = (ref = "task1", path = "/title", value: unknown = "A") => ({ op: "set", ref, scope: "canonical", path, value });
function rejected(batch: unknown): EditInputError {
  try { parseEditBatch(batch); } catch (error) {
    assert.ok(error instanceof EditInputError);
    assert.ok(error.message.trim()); assert.ok(error.hint.trim());
    for (const issue of error.issues) { assert.ok(issue.message.trim()); assert.ok(issue.hint.trim()); }
    assert.ok(JSON.parse(JSON.stringify(error)).message);
    return error;
  }
  assert.fail("Expected batch rejection");
}
test("edit protocol: all duplicate groups and locations are diagnosed, including identical values", () => {
  const batch = { patches: [set(), { op: "remove", ref: "task1", scope: "canonical", path: "/title" }, set(), set("other"), set("other")] };
  const before = structuredClone(batch);
  const errors = rejected(batch).issues;
  assert.deepEqual(errors.map(e => [e.code, e.path, e.relatedPaths]), [
    ["PATCH_SELF_CONFLICT", "/patches/1", ["/patches/0", "/patches/2"]],
    ["PATCH_SELF_CONFLICT", "/patches/4", ["/patches/3"]]
  ]);
  assert.equal(errors[0]!.fieldPath, "/title"); assert.equal(errors[0]!.ref, "task1");
  assert.match(errors[0]!.message, /entire batch is rejected/);
  assert.match(errors[0]!.hint, /version returned/);
  assert.deepEqual(batch, before);
  for (const op of ["set", "remove", "reset"]) {
    const p = op === "set" ? set() : { op, ref: "task1", scope: "canonical", path: "/title" };
    assert.equal(rejected({ patches: [p, p] }).code, "PATCH_SELF_CONFLICT");
  }
});
test("edit protocol: decoded coordinate tuples avoid delimiter collisions and do not confuse ancestor paths", () => {
  assert.equal(rejected({ patches: [set("n", "/a~1b~0c"), set("n", "/a~1b~0c")] }).code, "PATCH_SELF_CONFLICT");
  const batch = { patches: [set("a", "/b/c"), set("a/b", "/c"), set("a", "/b"), set("a", "/a~01"), set("a", "/a~1")] };
  assert.deepEqual(parseEditBatch(batch), batch);
});
test("edit protocol: legacy actions, incompatible shapes and missing scope fail with actionable messages", () => {
  const invalid = [
    {}, [], { patches: null }, { patches: [], graphPatches: [] },
    { patches: [{ op: "set", nodeId: "n", path: "/title", value: "A" }] },
    { patches: [{ ...set(), scope: "override" }] },
    { patches: [{ ...set(), scope: "" }] },
    { patches: [{ op: "set", ref: "n", scope: "canonical", path: "/title" }] },
    ...["remove", "reset"].map(op => ({ patches: [{ ...set(), op, value: null }] })),
    ...["node.add", "node.remove", "edge.add", "edge.remove", "clone"].map(op => ({ graphPatches: [{ op, ref: "n" }] })),
    { graphPatches: [{ op: "remove", ref: "n", path: "/uses" }] },
    { graphPatches: [{ op: "set", ref: "n", parentRef: "p", path: "/uses", value: [] }] },
    { graphPatches: [{ op: "set", parentRef: "p", path: "/uses", value: { cloneFromRef: "n", fields: {} } }] },
    { graphPatches: [{ op: "set", parentRef: "p", path: "/uses", value: { ref: "n" } }] },
    { graphPatches: [{ op: "set", ref: "n", path: "/uses", value: { ref: "n" } }] },
    { patches: [set("n", "/x~2")] }, { patches: [set("n", "/constructor")] }
  ];
  invalid.forEach(rejected);
});
test("edit protocol: nested content, clones, shared refs and null survive an isolated JSON snapshot", () => {
  const batch = { graphPatches: [
    { op: "set", parentRef: "p", path: "/contains", value: { nodeType: "task", fields: { title: "A", detail: { note: null } }, relations: { uses: [{ ref: "shared" }] } } },
    { op: "set", parentRef: "p", path: "/contains", value: { cloneFromRef: "original" } },
    { op: "set", ref: "p", path: "/uses", value: [] },
    { op: "reset", ref: "old" }
  ], patches: [set("p", "/note", null)] };
  const result = parseEditBatch(batch);
  assert.deepEqual(result, batch);
  assert.notEqual(result, batch);
  batch.patches[0]!.value = "changed";
  assert.equal((result.patches![0] as { value: unknown }).value, null);
});
test("edit protocol: hostile or non-JSON values cannot invoke accessors or silently disappear", () => {
  let reads = 0;
  const value = { get title() { reads++; return "bad"; } };
  rejected({ patches: [set("n", "/x", value)] });
  assert.equal(reads, 0);
  for (const value of [undefined, NaN, Infinity, new Date(), BigInt(1), [, 1]]) rejected({ patches: [{ ...set("n", "/x"), value }] });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  rejected({ patches: [set("n", "/x", cycle)] });
});
// Type-level rejection accompanies runtime checks; these are not exported compatibility forms.
// @ts-expect-error scope is mandatory
const missingScope: FieldPatch = { op: "reset", ref: "n", path: "/title" };
// @ts-expect-error remove cannot carry a value
const invalidRemove: FieldPatch = { op: "remove", ref: "n", scope: "canonical", path: "/title", value: null };
// @ts-expect-error new node and existing node coordinates are mutually exclusive
const bothTargets: TopologyPatch = { op: "set", ref: "n", parentRef: "p", path: "/uses", value: [] };
void [missingScope, invalidRemove, bothTargets];

test("edit tool schema: recursive creation and three-state forms validate without exposing old actions", async () => {
  const { Ajv2020 } = await import("ajv/dist/2020.js");
  const { editBatchSchema } = await import("../src/edit/tool-schema.js");
  const validate = new Ajv2020({ strict: false }).compile(editBatchSchema);
  const examples = [
    { patches: [set()] },
    { patches: [{ op: "reset", ref: "n", scope: "canonical", path: "/a~1b/note" }] },
    { graphPatches: [{ op: "set", parentRef: "p", path: "/uses", value: { nodeType: "task", fields: { title: "A" }, relations: { uses: [{ ref: "shared" }, { cloneFromRef: "original" }] } } }] },
    { graphPatches: [{ op: "remove", ref: "n" }] }
  ];
  for (const input of examples) {
    assert.equal(validate(input), true, JSON.stringify(validate.errors));
    assert.deepEqual(parseEditBatch(input), input);
  }
  for (const input of [
    {}, { patches: [] }, { patches: [{ ...set(), extra: true }] },
    { patches: [{ op: "remove", ref: "n", scope: "canonical", path: "/x", value: null }] },
    { graphPatches: [{ op: "node.add", id: "n", nodeType: "task" }] },
    { graphPatches: [{ op: "set", ref: "p", parentRef: "p", path: "/uses", value: [] }] }
  ]) { assert.equal(validate(input), false); rejected(input); }
  // JSON Schema is structural; tuple uniqueness must still go through the parser.
  const duplicate = { patches: [set(), set()] };
  assert.equal(validate(duplicate), true);
  assert.equal(rejected(duplicate).code, "PATCH_SELF_CONFLICT");
});
