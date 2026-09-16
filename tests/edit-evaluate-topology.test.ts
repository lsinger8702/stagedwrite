import assert from "node:assert/strict";
import test from "node:test";
import { initializeTopology, evaluateTopology, type TopologyState, type TopologyOptions } from "../src/edit/evaluate-topology.js";
import { EditInputError } from "../src/edit/protocol.js";
const options: TopologyOptions = { nodeTypes: ["task"], relations: {
  children: { from: ["task"], to: ["task"], ownership: "owned", cardinality: "many" },
  uses: { from: ["task"], to: ["task"], ownership: "reference", cardinality: "many" }
} };
function fixture(): TopologyState {
  return { graph: {
    nodes: Object.fromEntries(["root", "child", "leaf", "shared"].map(id => [id, { id, nodeType: "task", fields: { title: id } }])),
    edges: { a: { id: "a", from: "root", to: "child", relationType: "children" }, b: { id: "b", from: "child", to: "leaf", relationType: "children" }, c: { id: "c", from: "child", to: "shared", relationType: "uses" }, d: { id: "d", from: "child", to: "leaf", relationType: "uses" } }
  }, fieldIntents: Object.fromEntries(["root", "child", "leaf", "shared"].map(id => [id, { "/title": { kind: "set" as const, value: id }, "/note": { kind: "remove" as const } }])), tombstones: { nodes: [], edges: [] } };
}
const err = (pattern: RegExp) => (e: unknown) => e instanceof EditInputError && pattern.test(e.message) && !!e.hint;
const apply = (s: TopologyState, graphPatches: unknown[], baseline = s) => evaluateTopology(s, baseline, { graphPatches }, options);
test("topology evaluator: create expands initial work and maps input positions without caller IDs", () => {
  const input = { roots: [{ nodeType: "task", fields: { title: "Work", settings: { label: null }, empty: {} }, relations: { children: [{ nodeType: "task", fields: { title: "Child" } }] } }] };
  const before = structuredClone(input);
  const result = initializeTopology(input, options);
  assert.equal(result.createdRefs.length, 2);
  assert.deepEqual(result.createdRefs.map(r => r.path), ["/roots/0", "/roots/0/relations/children/0"]);
  const root = result.createdRefs[0]!.ref;
  assert.deepEqual(result.candidate.fieldIntents[root]!["/settings"], { kind: "set", value: {} });
  assert.deepEqual(result.candidate.fieldIntents[root]!["/settings/label"], { kind: "set", value: null });
  assert.deepEqual(input, before);
  assert.throws(() => initializeTopology({ roots: [] }, options), err(/nonempty/));
  assert.throws(() => initializeTopology({ roots: [{ cloneFromRef: root }] }, options), err(/must exist/));
  assert.throws(() => initializeTopology({ roots: [{ nodeType: "task" }] }, options), e => e instanceof EditInputError && e.issues[0]!.path === "/roots/0/fields");
});
test("topology evaluator: clone copies owned closure, preserves remove intent and remaps only internal refs", () => {
  const input = fixture(), before = structuredClone(input);
  const r = apply(input, [{ op: "set", parentRef: "root", path: "/children", value: { cloneFromRef: "child" } }]);
  const clone = r.createdRefs.find(c => c.sourceRef === "child")!.ref;
  const leaf = r.createdRefs.find(c => c.sourceRef === "leaf")!.ref;
  assert.notEqual(clone, "child");
  assert.deepEqual(r.candidate.fieldIntents[clone]!["/note"], { kind: "remove" });
  assert.ok(Object.values(r.candidate.graph.edges).some(e => e.from === clone && e.to === leaf && e.relationType === "uses"));
  assert.ok(Object.values(r.candidate.graph.edges).some(e => e.from === clone && e.to === "shared" && e.relationType === "uses"));
  r.candidate.graph.nodes[clone]!.fields.title = "Changed";
  assert.deepEqual(input, before);
});
test("topology evaluator: deletion blocks inbound shared references and failures leave all inputs unchanged", () => {
  const s = fixture();
  s.graph.edges.external = { id: "external", from: "shared", to: "leaf", relationType: "uses" };
  const before = structuredClone(s);
  assert.throws(() => apply(s, [{ op: "remove", ref: "child" }]), err(/surviving node shared/));
  assert.deepEqual(s, before);
  const removed = apply(s, [{ op: "set", ref: "shared", path: "/uses", value: [] }, { op: "remove", ref: "child" }]);
  assert.deepEqual(Object.keys(removed.candidate.graph.nodes).sort(), ["root", "shared"]);
  assert.equal(removed.candidate.fieldIntents.leaf, undefined);
  assert.deepEqual(removed.candidate.tombstones.nodes.sort(), ["child", "leaf"]);
  assert.deepEqual(s, before);
});
test("topology evaluator: request-before refs reject guessed new IDs and fields targeting removed nodes", () => {
  const s = fixture();
  assert.throws(() => evaluateTopology(s, s, { graphPatches: [{ op: "remove", ref: "child" }], patches: [{ op: "set", ref: "leaf", scope: "canonical", path: "/title", value: "X" }] }, options), err(/must exist/));
  assert.throws(() => evaluateTopology(s, s, { graphPatches: [
    { op: "set", parentRef: "root", path: "/children", value: { nodeType: "task", fields: {} } },
    { op: "set", parentRef: "node_fixed", path: "/children", value: { nodeType: "task", fields: {} } }
  ] }, { ...options, nextId: () => "fixed" }), err(/must exist/));
  assert.throws(() => apply(s, [{ op: "remove", ref: "child" }, { op: "set", ref: "root", path: "/uses", value: [{ ref: "child" }] }]), err(/must exist/));
});
test("topology evaluator: reset restores baseline identity without restoring ordinary children", () => {
  const base = fixture(); delete base.graph.edges.d;
  const removed = apply(base, [{ op: "remove", ref: "child" }]).candidate;
  assert.throws(() => apply(removed, [{ op: "reset", ref: "leaf" }], base), err(/baseline endpoint child/));
  const restored = apply(removed, [{ op: "reset", ref: "child" }], base);
  assert.deepEqual(restored.createdRefs, []);
  assert.ok(restored.candidate.graph.nodes.child);
  assert.equal(restored.candidate.graph.nodes.leaf, undefined);
  assert.ok(restored.candidate.graph.edges.a);
  assert.ok(restored.candidate.graph.edges.c);
  assert.equal(restored.candidate.tombstones.nodes.includes("child"), false);
  assert.deepEqual(restored.candidate.fieldIntents.child, base.fieldIntents.child);
  const both = apply(removed, [{ op: "reset", ref: "child" }, { op: "reset", ref: "leaf" }], base);
  assert.deepEqual(both.candidate.graph, base.graph);
});
test("topology evaluator: baseline-external reset removes new nodes and receipts omit reclaimed new refs", () => {
  const base = fixture();
  const added = apply(base, [{ op: "set", parentRef: "root", path: "/children", value: { nodeType: "task", fields: { title: "New" } } }]);
  const id = added.createdRefs[0]!.ref;
  const reset = apply(added.candidate, [{ op: "reset", ref: id }], base);
  assert.equal(reset.candidate.graph.nodes[id], undefined);
  const discarded = apply(base, [
    { op: "set", parentRef: "root", path: "/children", value: { nodeType: "task", fields: { title: "New" } } },
    { op: "set", ref: "root", path: "/children", value: [{ ref: "child" }] }
  ]);
  assert.deepEqual(discarded.createdRefs, []);
  assert.equal(discarded.candidate.graph.edges.a!.id, "a");
});
test("topology evaluator: reset needs reference endpoints and clone uses frozen original contents", () => {
  const base = fixture();
  const s = structuredClone(base); s.graph.nodes.child!.fields.title = "edited"; s.fieldIntents.child!["/title"] = { kind: "set", value: "edited" };
  const r = apply(s, [{ op: "reset", ref: "child" }, { op: "set", parentRef: "root", path: "/children", value: { cloneFromRef: "child" } }], base);
  const clone = r.createdRefs.find(c => c.sourceRef === "child")!.ref;
  assert.equal(r.candidate.graph.nodes.child!.fields.title, "child");
  assert.equal(r.candidate.graph.nodes[clone]!.fields.title, "edited");
  const missing = structuredClone(base); delete missing.graph.nodes.shared; delete missing.fieldIntents.shared; delete missing.graph.edges.c;
  assert.throws(() => apply(missing, [{ op: "reset", ref: "child" }], base), err(/baseline endpoint shared/));
});
test("topology evaluator: replacing multiple owned children removes their internal cross-references together", () => {
  const s = fixture();
  s.graph.edges.b = { id: "b", from: "root", to: "leaf", relationType: "children" };
  s.graph.edges.back = { id: "back", from: "leaf", to: "child", relationType: "uses" };
  const result = apply(s, [{ op: "set", ref: "root", path: "/children", value: [] }]);
  assert.deepEqual(Object.keys(result.candidate.graph.nodes).sort(), ["root", "shared"]);
  assert.deepEqual(result.candidate.graph.edges, {});
});
