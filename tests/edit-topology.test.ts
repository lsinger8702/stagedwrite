import assert from "node:assert/strict";
import test from "node:test";
import { validateTopology, removableOwnedClosure, type TopologyGraph, type Relations } from "../src/edit/topology.js";
import { EditInputError } from "../src/edit/protocol.js";
const relations: Relations = { contains: { from: ["task"], to: ["task"], ownership: "owned", cardinality: "many" }, uses: { from: ["task"], to: ["task"], ownership: "reference", cardinality: "many" } };
function graph(edges: [string, string, string][]): TopologyGraph { return {
  nodes: Object.fromEntries(["a", "b", "c", "shared"].map(id => [id, { id, nodeType: "task", fields: {} }])),
  edges: Object.fromEntries(edges.map(([from, to, relationType], i) => [`e${i}`, { id: `e${i}`, from, to, relationType }]))
}; }
const error = (match: RegExp) => (e: unknown) => e instanceof EditInputError && match.test(e.message) && e.issues.every(i => i.hint.length > 0 && i.path === "/graphPatches/0");
test("edit topology: reference cycles and sharing are legal; owned cycles and multiple parents are rejected", () => {
  validateTopology(graph([["a", "b", "uses"], ["b", "a", "uses"], ["c", "b", "uses"]]), relations, "/graphPatches/0");
  assert.throws(() => validateTopology(graph([["a", "b", "contains"], ["b", "a", "contains"]]), relations, "/graphPatches/0"), error(/cycle/));
  assert.throws(() => validateTopology(graph([["a", "b", "contains"], ["c", "b", "contains"]]), relations, "/graphPatches/0"), error(/owning edge/));
});
test("edit topology: ownership deletion never silently removes shared targets or surviving referrers", () => {
  const input = graph([["a", "b", "contains"], ["b", "c", "contains"], ["b", "shared", "uses"]]);
  const before = structuredClone(input);
  assert.deepEqual([...removableOwnedClosure(input, relations, "a", "/graphPatches/0")].sort(), ["a", "b", "c"]);
  assert.deepEqual(input, before);
  input.edges.inbound = { id: "inbound", from: "shared", to: "c", relationType: "uses" };
  assert.throws(() => removableOwnedClosure(input, relations, "a", "/graphPatches/0"), error(/surviving node shared/));
  assert.ok(input.nodes.c); assert.ok(input.nodes.shared);
});
test("edit topology: duplicates, cardinality, dangling targets and malformed registration fail closed", () => {
  for (const [input, definitions, match] of [
    [graph([["a", "b", "uses"], ["a", "b", "uses"]]), relations, /repeats target/],
    [graph([["a", "b", "uses"], ["a", "c", "uses"]]), { ...relations, uses: { ...relations.uses!, cardinality: "one" } }, /one target/],
    [graph([["a", "missing", "uses"]]), relations, /missing endpoint/],
    [graph([["a", "b", "unknown"]]), relations, /unregistered/],
    [{ nodes: {}, edges: {} }, relations, /cannot be empty/]
  ] as const) assert.throws(() => validateTopology(input, definitions as Relations, "/graphPatches/0"), error(match));
});
