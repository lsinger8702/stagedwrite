import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite } from "../src/index.js";
const directory = mkdtempSync(join(tmpdir(), "stagedwrite-demo-"));
const path = join(directory, "drafts.sqlite");
const definitions = [{ id: "example.stored", version: "1", nodeTypes: { item: {
  valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] } }, relationTypes: {} }];
const open = () => createStagedWrite({ definitions, storage: { kind: "sqlite", path } });
let engine = open();
try {
  const draft = engine.create({ type: "example.stored", typeVersion: "1" });
  engine.edit(draft.id, 0, [{ op: "node.add", id: "one", nodeType: "item" }]);
  const blocked = engine.preflight(draft.id);
  console.log("1. Persisted incomplete draft and check:", blocked.status);
  engine.close(); engine = open();
  assert.equal(engine.getCheck(draft.id, blocked.checkId).status, "blocked");
  const restored = engine.getDraft(engine.listDraftIds()[0]!);
  console.log("2. Reopened draft version:", restored.version);
  engine.edit(restored.id, restored.version, [{ op: "set", nodeId: "one", path: "/name", value: "Saved intent" }]);
  const passed = engine.preflight(restored.id); engine.close(); engine = open();
  assert.deepEqual(engine.getCheck(restored.id, passed.checkId), passed);
  assert.equal("publish" in engine, false);
  console.log("3. Reopened completed draft check:", passed.status, "scope:", passed.scope);
  console.log("M4: durable drafts/checks only. Execution records and restart recovery remain pending.");
} finally { engine.close(); rmSync(directory, { recursive: true, force: true }); }
