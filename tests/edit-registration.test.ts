import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionRegistry, DefinitionAssemblyError } from "../src/registry/registry.js";
import { registeredTopology } from "../src/edit/registered-topology.js";
import { EditInputError } from "../src/edit/protocol.js";
const definition = () => ({ id: "example.registered", version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false } } }, relationTypes: { children: { from: ["task"], to: ["task"], ownership: "owned", cardinality: "many" } } });
const selector = { type: "example.registered", typeVersion: "1" };
test("registered topology: source registry validates metadata and binds ownership into definition digest", () => {
  const original = definition();
  const registry = new DefinitionRegistry([original]);
  const bound = registeredTopology(registry, selector);
  original.relationTypes.children.ownership = "reference";
  const changed = registeredTopology(new DefinitionRegistry([original]), selector);
  assert.notEqual(bound.definitionDigest, changed.definitionDigest);
  const created = bound.initialize({ roots: [{ nodeType: "task", fields: { title: "Root" } }] });
  assert.throws(() => bound.evaluate(created.candidate, created.candidate, changed.definitionDigest, { graphPatches: [{ op: "reset", ref: created.createdRefs[0]!.ref }] }), e => e instanceof EditInputError && /definition/.test(e.message));
  for (const [key, value] of [["ownership", "guess"], ["cardinality", "zero"], ["ownership", null], ["ownership", ["owned"]], ["cardinality", ["many"]]] as const) {
    const d = definition(); Object.assign(d.relationTypes.children, { [key]: value });
    assert.throws(() => new DefinitionRegistry([d]), e => e instanceof DefinitionAssemblyError && e.issues.some(i => i.path.endsWith(`/${key}`)));
  }
});
test("registered topology: incomplete metadata never receives defaults", () => {
  const d = definition(); const relation: Record<string, unknown> = d.relationTypes.children;
  delete relation.ownership;
  assert.throws(() => new DefinitionRegistry([d]), DefinitionAssemblyError);
});
test("registered topology: schema failures remain atomic and valid specs use one immutable registration", () => {
  const bound = registeredTopology(new DefinitionRegistry([definition()]), selector);
  assert.throws(() => bound.initialize({ roots: [{ nodeType: "task", fields: { title: 5 } }] }), e => e instanceof EditInputError && e.issues[0]!.path.endsWith("/fields/title"));
  const created = bound.initialize({ roots: [{ nodeType: "task", fields: { title: "Root" } }] });
  const before = structuredClone(created.candidate), ref = created.createdRefs[0]!.ref;
  const batch = { graphPatches: [{ op: "set", parentRef: ref, path: "/children", value: { nodeType: "task", fields: { title: false } } }] };
  assert.throws(() => bound.evaluate(created.candidate, created.candidate, bound.definitionDigest, batch), EditInputError);
  assert.deepEqual(created.candidate, before);
  const valid = { graphPatches: [{ op: "set", parentRef: ref, path: "/children", value: { nodeType: "task", fields: { title: "Child" } } }] };
  const result = bound.evaluate(created.candidate, created.candidate, bound.definitionDigest, valid);
  assert.equal(Object.keys(result.candidate.graph.nodes).length, 2);
  assert.deepEqual(created.candidate, before);
});
