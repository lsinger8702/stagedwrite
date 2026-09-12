import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStagedWrite } from "../src/index.js";
import type { GraphExecutor } from "../src/index.js";
const selector = { type: "migration", typeVersion: "1" };
const definition = { id: selector.type, version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} };
const executor: GraphExecutor = { ...selector, id: "fixture", version: "1", target: "mock", plan: () => [{ id: "one", payload: {} }], apply: async () => ({ kind: "unknown", reason: "lost" }), reconcile: async () => ({ kind: "applied", remoteRef: "remote-one" }) };
function file(t: { after(fn: () => void): void }) { const dir = mkdtempSync(join(tmpdir(), "sw-migrate-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "data.sqlite"); }
for (const version of [2, 3]) test(`real schema ${version} layout upgrades with sealed plans and run evidence intact`, async t => {
  const path = file(t);
  const memory = createStagedWrite({ definitions: [definition], mode: "executable", executors: [executor] });
  const d = memory.create(selector); const draft = memory.edit(d.id, 0, [{ op: "node.add", id: "one", nodeType: "item" }]);
  const check = memory.preflight(d.id); const run = await memory.publish(d.id, check.certificate!); memory.close();
  const db = new DatabaseSync(path);
  // Actual historical table layouts, not a current database with its version relabeled.
  db.exec(`CREATE TABLE sw_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE sw_definitions (type TEXT NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(type,version)) STRICT;
    CREATE TABLE sw_drafts (id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, check_epoch INTEGER NOT NULL DEFAULT 0, check_body TEXT) STRICT;
    CREATE TABLE sw_plans (draft_id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
    CREATE TABLE sw_runs (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, body TEXT NOT NULL) STRICT;
    CREATE TABLE sw_derivations (source_run TEXT NOT NULL, kind TEXT NOT NULL, draft_id TEXT NOT NULL UNIQUE, PRIMARY KEY(source_run,kind)) STRICT;`);
  db.prepare("INSERT INTO sw_meta VALUES ('schema',?)").run(String(version));
  db.prepare("INSERT INTO sw_definitions VALUES (?,?,?,?)").run(selector.type, "1", draft.definitionDigest, JSON.stringify(definition));
  db.prepare("INSERT INTO sw_drafts VALUES (?,?,?,?,?)").run(d.id, draft.version, JSON.stringify(draft), 1, JSON.stringify(check));
  db.prepare("INSERT INTO sw_plans VALUES (?,?)").run(d.id, JSON.stringify({ certificate: check.certificate, binding: run.binding, plan: executor.plan(draft) }));
  db.prepare("INSERT INTO sw_runs VALUES (?,?,?,?)").run(run.id, d.id, "old-owner", JSON.stringify(run));
  if (version === 3) {
    db.exec("CREATE TABLE sw_sessions (owner TEXT PRIMARY KEY, pid INTEGER NOT NULL, host TEXT NOT NULL, released INTEGER NOT NULL) STRICT;");
    db.prepare("INSERT INTO sw_sessions VALUES (?,?,?,1)").run("old-owner", process.pid, hostname());
  }
  db.close();
  const next = createStagedWrite({ definitions: [definition], mode: "executable", executors: [executor], storage: { kind: "sqlite", path } });
  assert.deepEqual(next.getDraft(d.id), draft); assert.deepEqual(next.getRun(run.id), run);
  assert.deepEqual(await next.publish(d.id, check.certificate!), run);
  assert.throws(() => next.edit(d.id, draft.version, [{ op: "node.remove", id: "one" }]), /DRAFT_SEALED/);
  const command = { requestId: "recover", expectedSequence: run.events.length, actor: "operator", reason: "migrated" };
  if (version === 2) assert.throws(() => next.recover(run.id, command), /OWNER_EVIDENCE_REQUIRED/);
  else { next.recover(run.id, command); assert.equal((await next.resume(run.id)).state, "published"); }
  next.close();
  const inspect = new DatabaseSync(path); assert.equal(inspect.prepare("SELECT value FROM sw_meta WHERE key='schema'").get()?.value, "4"); inspect.close();
});
test("missing historical columns reject startup without advancing the schema version", t => {
  const path = file(t); const db = new DatabaseSync(path);
  db.exec("CREATE TABLE sw_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; INSERT INTO sw_meta VALUES ('schema','1'); CREATE TABLE sw_drafts (id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL) STRICT;"); db.close();
  assert.throws(() => createStagedWrite({ definitions: [definition], storage: { kind: "sqlite", path } }), /STORAGE_SCHEMA_MISMATCH/);
  const inspect = new DatabaseSync(path); assert.equal(inspect.prepare("SELECT value FROM sw_meta WHERE key='schema'").get()?.value, "1"); inspect.close();
});
