import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionRegistry, DefinitionAssemblyError } from "../src/registry/registry.js";
import { registeredTopology } from "../src/edit/registered-topology.js";
import { EditInputError } from "../src/edit/protocol.js";
import type { TopologyState } from "../src/edit/evaluate-topology.js";
const selector = { type: "nested", typeVersion: "1" };
const definition = () => ({ id: "nested", version: "1", nodeTypes: { task: { valueSchema: { type: "object", additionalProperties: false, $defs: {
  profile: { type: ["object", "null"], properties: { name: { type: "string" }, note: { type: ["string", "null"] } }, additionalProperties: false }
}, properties: { profile: { $ref: "#/$defs/profile" }, items: { type: "array", items: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false }, minItems: 0 }, "a/b~c": { type: "string" } } } } }, relationTypes: {} });
function setup() {
  const registry = new DefinitionRegistry([definition()]), engine = registeredTopology(registry, selector);
  const initial = engine.initialize({ roots: [{ nodeType: "task", fields: { profile: { name: "A", note: "B" }, items: [{ title: "one" }] } }] });
  const ref = initial.createdRefs[0]!.ref;
  const patch = (op: string, path: string, value?: unknown) => ({ op, ref, scope: "canonical", path, ...(op === "set" ? { value } : {}) });
  const apply = (state: TopologyState, patches: unknown[], base = initial.candidate) => engine.evaluate(state, base, engine.definitionDigest, { patches });
  return { registry, engine, initial: initial.candidate, ref, patch, apply };
}
test("nested fields: parent remove preserves sibling clears when a child is set then reset", () => {
  const { initial, ref, patch, apply } = setup(); const before = structuredClone(initial);
  const result = apply(initial, [patch("remove", "/profile"), patch("set", "/profile/name", "C")]);
  assert.deepEqual(result.candidate.graph.nodes[ref]!.fields.profile, { name: "C" });
  assert.deepEqual(result.candidate.fieldIntents[ref]!["/profile/note"], { kind: "remove" });
  const reset = apply(result.candidate, [patch("reset", "/profile/name")]);
  assert.deepEqual(reset.candidate.graph.nodes[ref]!.fields.profile, { name: "A" });
  assert.deepEqual(reset.candidate.fieldIntents[ref]!["/profile/note"], { kind: "remove" });
  assert.deepEqual(apply(reset.candidate, [patch("reset", "/profile")]).candidate.graph, initial.graph);
  assert.deepEqual(initial, before);
});
test("nested fields: parent and child order is explicit; set object replaces omitted children", () => {
  const { initial, ref, patch, apply } = setup();
  const a = apply(initial, [patch("set", "/profile", { name: "P" }), patch("set", "/profile/name", "C")]);
  const b = apply(initial, [patch("set", "/profile/name", "C"), patch("set", "/profile", { name: "P" })]);
  assert.deepEqual(a.candidate.graph.nodes[ref]!.fields.profile, { name: "C" });
  assert.deepEqual(b.candidate.graph.nodes[ref]!.fields.profile, { name: "P" });
  assert.equal(b.candidate.fieldIntents[ref]!["/profile/note"], undefined);
  const edited = apply(a.candidate, [patch("set", "/profile/name", "D")]);
  assert.equal((apply(edited.candidate, [patch("reset", "/profile/name")]).candidate.graph.nodes[ref]!.fields.profile as { name: string }).name, "A");
});
test("nested fields: null, clear and undeclared differ, arrays are whole values, escaped keys work", () => {
  const { initial, ref, patch, apply } = setup();
  const nil = apply(initial, [patch("set", "/profile", null)]);
  assert.equal(nil.candidate.graph.nodes[ref]!.fields.profile, null);
  assert.throws(() => apply(nil.candidate, [patch("set", "/profile/name", "X")]), e => e instanceof EditInputError && /explicit null/.test(e.message) && !!e.hint);
  assert.throws(() => apply(initial, [patch("set", "/items/0/title", "X")]), EditInputError);
  const result = apply(initial, [patch("set", "/items", []), patch("set", "/a~1b~0c", "escaped")]);
  assert.deepEqual(result.candidate.graph.nodes[ref]!.fields.items, []);
  const reset = apply(result.candidate, [patch("reset", "/a~1b~0c")]);
  assert.equal(reset.candidate.fieldIntents[ref]!["/a~1b~0c"], undefined);
  assert.deepEqual(apply(reset.candidate, [patch("reset", "/items")]).candidate.graph, initial.graph);
});
test("nested fields: inherited baseline remove restores clear instead of undeclared", () => {
  const { initial, ref, patch, apply } = setup();
  const baseline = apply(initial, [patch("remove", "/profile")]).candidate;
  const current = apply(baseline, [patch("set", "/profile", { name: "X" })], baseline).candidate;
  const reset = apply(current, [patch("reset", "/profile/name")], baseline);
  assert.deepEqual(reset.candidate.fieldIntents[ref]!["/profile/name"], { kind: "remove" });
  assert.deepEqual(reset.candidate.graph.nodes[ref]!.fields.profile, {});
});
test("nested fields: invalid schema values, duplicate coordinates and projection corruption fail atomically", () => {
  const { initial, ref, patch, apply } = setup(); const before = structuredClone(initial);
  for (const patches of [[patch("set", "/profile/name", 5)], [patch("set", "/items", [{ title: 4 }])], [patch("set", "/profile", { unknown: true })], [patch("remove", "/profile/name"), patch("reset", "/profile/name")]]) assert.throws(() => apply(initial, patches), EditInputError);
  assert.deepEqual(initial, before);
  const bad = structuredClone(initial); bad.graph.nodes[ref]!.fields.profile = { name: "diverged" };
  assert.throws(() => apply(bad, [patch("reset", "/profile")]), e => e instanceof EditInputError && /projection/.test(e.message));
});
test("recursive schema: refs resolve through objects and array items, and recursive cycles remain rejected", () => {
  const { registry } = setup();
  assert.equal(registry.validateValues(selector, "task", { profile: null, items: [{ title: "A" }] }).valid, true);
  assert.equal(registry.validateValues(selector, "task", { profile: { extra: 1 } }).valid, false);
  const d = definition();
  (d.nodeTypes.task.valueSchema.$defs.profile.properties as Record<string, unknown>).loop = { $ref: "#/$defs/profile" };
  assert.throws(() => new DefinitionRegistry([d]), e => e instanceof DefinitionAssemblyError && e.issues.some(i => i.code === "SCHEMA_REF_CYCLE"));
});

test("nested fields: topology reset then field edits still read the fixed baseline, and preview shows effective states", async () => {
  const { previewFields } = await import("../src/edit/fields.js");
  const { initial, registry, engine, ref, patch, apply } = setup();
  const edited = apply(initial, [patch("set", "/profile/name", "changed")]).candidate;
  const result = engine.evaluate(edited, initial, engine.definitionDigest, {
    graphPatches: [{ op: "reset", ref }],
    patches: [patch("remove", "/profile"), patch("reset", "/profile/name")]
  });
  assert.deepEqual(result.candidate.graph.nodes[ref]!.fields.profile, { name: "A" });
  const preview = previewFields(registry, selector, result.candidate)[ref]!;
  assert.deepEqual(preview["/profile"], { kind: "set", value: { name: "A" } });
  assert.deepEqual(preview["/profile/note"], { kind: "remove" });
  assert.deepEqual(preview["/a~1b~0c"], { kind: "undeclared" });
  assert.equal(result.changes[0]!.inputPath, "/graphPatches/0");
  assert.equal(result.changes[1]!.inputPath, "/patches/0");
});
