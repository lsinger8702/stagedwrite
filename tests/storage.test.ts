import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createStagedWrite } from "../src/index.js";
import type { DraftOptions, GraphRule } from "../src/index.js";
const definition = { id: "stored", version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] } }, relationTypes: { uses: { from: ["item"], to: ["item"] } } };
const selector = { type: "stored", typeVersion: "1" };
const create = (path: string, rules: readonly GraphRule[] = []) => createStagedWrite({ definitions: [definition], rules, storage: { kind: "sqlite", path } });
function file(t: { after(fn: () => void): void }) { const dir = mkdtempSync(join(tmpdir(), "stagedwrite-storage-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "drafts.sqlite"); }
const api = new URL("../src/index.js", import.meta.url).href;
function child(path: string, code: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `import { createStagedWrite } from ${JSON.stringify(api)}; const engine = createStagedWrite({definitions:[${JSON.stringify(definition)}],storage:{kind:'sqlite',path:${JSON.stringify(path)}}}); ${code}`], { encoding: "utf8" });
}
test("SQLite restores graph fields, edges, tombstones and current checks across processes", t => {
  const path = file(t); const engine = create(path); const draft = engine.create(selector);
  const saved = engine.edit(draft.id, 0, [ { op: "node.add", id: "a", nodeType: "item" }, { op: "node.add", id: "b", nodeType: "item" },
    { op: "set", nodeId: "a", path: "/name", value: "Alice" }, { op: "remove", nodeId: "b", path: "/name" },
    { op: "edge.add", id: "edge", relationType: "uses", from: "a", to: "b" },
    { op: "node.add", id: "retired", nodeType: "item" }, { op: "node.remove", id: "retired" } ]);
  const check = engine.preflight(draft.id); assert.equal(check.status, "blocked"); engine.close();
  const result = child(path, `console.log(JSON.stringify({ids:engine.listDraftIds(),draft:engine.getDraft('${draft.id}'),check:engine.getCheck('${draft.id}')})); engine.close();`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ids: [draft.id], draft: saved, check });
  const reopened = create(path); t.after(() => reopened.close());
  assert.throws(() => reopened.edit(draft.id, saved.version, [{ op: "node.add", id: "retired", nodeType: "item" }]), /ID_ALREADY_USED/);
});
test("SQLite edit CAS rejects stale writers and failed edits preserve the prior check", t => {
  const path = file(t); const a = create(path), b = create(path); t.after(() => { a.close(); b.close(); });
  const d = a.create(selector); const check = a.preflight(d.id);
  assert.throws(() => b.edit(d.id, 0, [{ op: "node.add", id: "x", nodeType: "item" }, { op: "set", nodeId: "x", path: "/name", value: 4 }]), /INVALID_GRAPH/);
  assert.equal(a.getDraft(d.id).version, 0); assert.deepEqual(a.getCheck(d.id, check.checkId), check);
  a.edit(d.id, 0, [{ op: "node.add", id: "a", nodeType: "item" }]);
  assert.throws(() => b.edit(d.id, 0, [{ op: "node.add", id: "b", nodeType: "item" }]), /STALE_VERSION/);
  assert.throws(() => b.getCheck(d.id, check.checkId), /CHECK_NOT_CURRENT/);
  assert.deepEqual(Object.keys(b.getDraft(d.id).nodes), ["a"]);
});
test("an edit from another connection during a rule prevents stale check publication", t => {
  const path = file(t); const other = create(path); let changed = false;
  const engine = create(path, [{ ...selector, id: "race", version: "1", check: d => {
    if (!changed) { changed = true; other.edit(d.id, d.version, [{ op: "set", nodeId: "a", path: "/name", value: "new" }]); } return [];
  } }]); t.after(() => { engine.close(); other.close(); });
  const d = engine.create(selector); engine.edit(d.id, 0, [{ op: "node.add", id: "a", nodeType: "item" }]);
  assert.throws(() => engine.preflight(d.id), /STALE_CHECK/);
  assert.equal(engine.getDraft(d.id).nodes.a?.fields.name?.kind, "value");
  assert.equal(engine.preflight(d.id).status, "passed");
});
test("check epochs prevent an older same-version preflight from overwriting a newer one", t => {
  const path = file(t); const other = create(path); let newerId = "";
  const engine = create(path, [{ ...selector, id: "race", version: "1", check: d => { newerId = other.preflight(d.id).checkId; return []; } }]);
  t.after(() => { engine.close(); other.close(); });
  const d = engine.create(selector);
  assert.throws(() => engine.preflight(d.id), /STALE_CHECK/);
  assert.equal(other.getCheck(d.id, newerId).checkId, newerId);
});
test("definition identity persists and rule changes invalidate restored checks", t => {
  const path = file(t); const first = create(path); const d = first.create(selector); const check = first.preflight(d.id); first.close();
  const changed = structuredClone(definition); changed.nodeTypes.item.requiredAtPublish = [];
  assert.throws(() => createStagedWrite({ definitions: [changed], storage: { kind: "sqlite", path } }), /STORED_DEFINITION_CONFLICT/);
  const other = create(path, [{ ...selector, id: "new-rule", version: "1", check: () => [] }]); t.after(() => other.close());
  assert.throws(() => other.getCheck(d.id, check.checkId), /CHECK_NOT_CURRENT/);
  assert.equal(other.preflight(d.id).scope, "draft");
});
test("process exit inside preflight leaves the old check invalidated and the graph readable", t => {
  const path = file(t); const engine = create(path); const d = engine.create(selector); const check = engine.preflight(d.id); engine.close();
  const crash = spawnSync(process.execPath, ["--input-type=module", "-e", `import {createStagedWrite} from ${JSON.stringify(api)}; const e=createStagedWrite({definitions:[${JSON.stringify(definition)}],storage:{kind:'sqlite',path:${JSON.stringify(path)}},rules:[{type:'stored',typeVersion:'1',id:'exit',version:'1',check:()=>process.exit(17)}]});e.preflight('${d.id}');`], { encoding: "utf8" });
  assert.equal(crash.status, 17, crash.stderr);
  const restored = create(path); t.after(() => restored.close());
  assert.deepEqual(restored.getDraft(d.id), d);
  assert.throws(() => restored.getCheck(d.id, check.checkId), /CHECK_NOT_CURRENT/);
  assert.equal(restored.preflight(d.id).status, "blocked");
});
test("draft SQLite mode has no publishing capability and executable storage is rejected", t => {
  const path = file(t); const engine = create(path); assert.equal("publish" in engine, false); engine.close();
  assert.throws(() => engine.listDraftIds(), /STORE_CLOSED/);
  assert.throws(() => createStagedWrite({ definitions: [], mode: "executable", executors: [], storage: { kind: "sqlite", path } } as unknown as DraftOptions), /DRAFT_STORAGE_ONLY/);
});
