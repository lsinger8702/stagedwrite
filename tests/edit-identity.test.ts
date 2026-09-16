import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityAllocator } from "../src/edit/identity.js";
import { EditInputError, parseEditBatch } from "../src/edit/protocol.js";
import type { EditReceipt, EditPreview, EditChange } from "../src/edit/results.js";

test("edit identities: preview uses a separate namespace and never consumes durable ID source", () => {
  const reserved = ["preview:node_1", "node_fixed"];
  const allocate = createIdentityAllocator({ preview: true, reserved, next: () => { throw new Error("must not run"); } });
  assert.equal(allocate("node"), "preview:node_2");
  assert.equal(allocate("edge"), "preview:edge_3");
  assert.deepEqual(reserved, ["preview:node_1", "node_fixed"]);
  assert.equal(createIdentityAllocator({ preview: false, reserved: [], next: () => "fixed" })("node"), "node_fixed");
});
test("edit identities: current and retired IDs cannot be reallocated; bad or exhausted sources fail closed", () => {
  const suffixes = ["current", "retired", "new"];
  const allocate = createIdentityAllocator({ preview: false, reserved: ["node_current", "node_retired"], next: () => suffixes.shift()! });
  assert.equal(allocate("node"), "node_new");
  const stuck = createIdentityAllocator({ preview: false, reserved: ["node_same"], next: () => "same" });
  assert.throws(() => stuck("node"), /IDENTITY_ALLOCATION_EXHAUSTED/);
  assert.throws(() => createIdentityAllocator({ preview: false, reserved: [], next: () => "preview:x" })("node"), /INVALID_IDENTITY_SOURCE/);
});
test("edit identities: all input ref forms reject provisional identities with message and hint", () => {
  for (const batch of [
    { patches: [{ op: "reset", ref: "preview:node_1", scope: "canonical", path: "/title" }] },
    { graphPatches: [{ op: "remove", ref: "preview:node_1" }] },
    { graphPatches: [{ op: "set", parentRef: "preview:node_1", path: "/uses", value: { nodeType: "task", fields: {} } }] },
    { graphPatches: [{ op: "set", parentRef: "n", path: "/uses", value: { cloneFromRef: "preview:node_1" } }] },
    { graphPatches: [{ op: "set", ref: "n", path: "/uses", value: [{ ref: "preview:node_1" }] }] }
  ]) assert.throws(() => parseEditBatch(batch), e => e instanceof EditInputError && /provisional/.test(e.message) && /createdRefs/.test(e.hint));
});

const changes: EditChange[] = [{ inputPath: "/patches/0", op: "remove", ref: "n", target: "field", scope: "canonical", path: "/title", before: { kind: "set", value: null }, after: { kind: "remove" } }];
const receipt: EditReceipt = { draftId: "d", version: 1, preflightRequired: true, changes, createdRefs: [] };
// @ts-expect-error edit never grants publication eligibility
const invalidReceipt: EditReceipt = { ...receipt, preflightRequired: false };
// @ts-expect-error a receipt is not a candidate preview
const invalidPreview: EditPreview<{ id: string }> = receipt;
// @ts-expect-error topology-specific action names are not accepted in changes either
const oldChange: EditChange = { inputPath: "/graphPatches/0", op: "node.add", ref: "n", target: "node", before: null, after: { nodeType: "task" } };
void [invalidReceipt, invalidPreview, oldChange];
