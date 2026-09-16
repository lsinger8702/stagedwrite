import assert from "node:assert/strict";
import test from "node:test";
import { validateStoredSnapshot } from "../src/managed/snapshot.js";
import { declareFields } from "../src/edit/evaluate-topology.js";
test("stored snapshot: normalized nested fields preserve null, arrays, empty objects and explicit clears", () => {
  const fields = { profile: { title: "A", nullable: null }, items: [{ title: "Item" }], empty: {} };
  const intents = declareFields(fields); intents["/profile/note"] = { kind: "remove" };
  const snapshot = { graph: { nodes: { n: { id: "n", nodeType: "task", fields } }, edges: {} }, fieldIntents: { n: intents } };
  const before = structuredClone(snapshot);
  validateStoredSnapshot(snapshot);
  assert.deepEqual(snapshot, before);
  for (const mutate of [
    (s: typeof snapshot) => { delete s.fieldIntents.n["/profile"]; },
    (s: typeof snapshot) => { s.fieldIntents.n["/profile"] = { kind: "set", value: fields.profile }; },
    (s: typeof snapshot) => { s.fieldIntents.n["/profile/title"] = { kind: "remove" }; }
  ]) { const invalid = structuredClone(snapshot); mutate(invalid); assert.throws(() => validateStoredSnapshot(invalid), /STATE_INTENT_INVALID/); }
});
test("stored snapshot: non-JSON input and malformed declaration shapes fail closed", () => {
  const snapshot = (declaration: unknown) => ({ graph: { nodes: { n: { id: "n", nodeType: "task", fields: {} } }, edges: {} }, fieldIntents: { n: { "/note": declaration } } });
  for (const value of [{ kind: "reset" }, { kind: "remove", value: null }, { kind: "set" }, { kind: "set", value: undefined }, { kind: "remove", extra: true }])
    assert.throws(() => validateStoredSnapshot(snapshot(value)), /STATE_INTENT_INVALID/);
  let read = false;
  assert.throws(() => validateStoredSnapshot({ get graph() { read = true; return {}; } }), /STATE_INTENT_INVALID/);
  assert.equal(read, false);
});
