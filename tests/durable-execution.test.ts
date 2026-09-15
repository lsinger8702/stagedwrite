import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createLegacyStagedWrite } from "../src/index.js";
import type { GraphExecutor, ApplyOutcome } from "../src/index.js";
const definition = { id: "durable", version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} };
const selector = { type: "durable", typeVersion: "1" };
function file(t: { after(fn: () => void): void }) { const dir = mkdtempSync(join(tmpdir(), "sw-runs-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "data.sqlite"); }
function open(path: string, overrides: Partial<GraphExecutor> = {}) {
  const binding: GraphExecutor = { ...selector, id: "mock", version: "1", target: "mock:local",
    plan: () => [{ id: "a", payload: {}, effect: { kind: "create", nodeId: "a" } }, { id: "b", payload: {}, effect: { kind: "create", nodeId: "b" }, dependsOn: ["a"], inputRefs: { aId: "a" } }],
    apply: async s => ({ kind: "applied", remoteRef: s.id }), reconcile: { unsupported: "fixture" }, ...overrides };
  return createLegacyStagedWrite({ definitions: [definition], mode: "executable", executors: [binding], storage: { kind: "sqlite", path }, clock: () => 0 });
}
function ready(engine: ReturnType<typeof open>) { const d = engine.create(selector); engine.edit(d.id, 0, [
  { op: "node.add", id: "a", nodeType: "item" }, { op: "node.add", id: "b", nodeType: "item" }]); return { id: d.id, check: engine.preflight(d.id) }; }

test("fixed plans survive reopening and are not recompiled before first publication", async t => {
  const path = file(t); const first = open(path); const { id, check } = ready(first); first.close();
  let planned = 0, applied = 0;
  const second = open(path, { plan: () => { planned++; throw new Error("must not plan"); }, apply: async s => { applied++; return { kind: "applied", remoteRef: s.id }; } });
  const run = await second.publish(id, check.certificate!); assert.equal(run.state, "published"); assert.equal(planned, 0); assert.equal(applied, 2); second.close();
  const third = open(path); t.after(() => third.close());
  assert.deepEqual(third.listRunIds(), [run.id]); assert.deepEqual(third.getRun(run.id), run);
  assert.deepEqual(await third.publish(id, check.certificate!, { runId: run.id }), run);
  assert.equal(third.preflight(id).status, "passed");
});

test("durable sealing prevents a second instance and draft mode from redispatching or editing", async t => {
  const path = file(t); let finish!: (o: ApplyOutcome) => void, calls = 0;
  const first = open(path, { apply: async s => { calls++; if (s.id === "a") return new Promise(resolve => { finish = resolve; }); return { kind: "applied", remoteRef: "b" }; } });
  const { id, check } = ready(first); const pending = first.publish(id, check.certificate!, { runId: "shared-submit" });
  const second = open(path); const observer = createLegacyStagedWrite({ definitions: [definition], storage: { kind: "sqlite", path } });
  const observed = await second.publish(id, check.certificate!, { runId: "shared-submit" });
  assert.equal(observed.steps[0]?.status, "dispatching"); assert.ok(observed.steps[0]?.resolvedPayload);
  await assert.rejects(second.resume(observed.id), /RECOVERY_REQUIRED/);
  assert.throws(() => observer.edit(id, 1, [{ op: "node.remove", id: "b" }]), /DRAFT_SEALED/);
  assert.equal(observer.preflight(id).status, "passed"); // Does not modify the active Run input.
  assert.throws(() => first.close(), /RUN_BUSY/);
  finish({ kind: "applied", remoteRef: "a" }); const completed = await pending;
  assert.deepEqual(second.getRun(observed.id), completed); assert.equal(calls, 2);
  first.close(); second.close(); observer.close();
});

test("partial receipts and derivation identity survive repeated reopen", async t => {
  const path = file(t); const first = open(path, { apply: async s => s.id === "a" ? { kind: "applied", remoteRef: "remote-a" } : { kind: "not_applied", reason: "refused" } });
  const { id, check } = ready(first); const failed = await first.publish(id, check.certificate!); first.close();
  const second = open(path); const next = second.continueFrom(failed.id); second.close();
  let calls = 0;
  const third = open(path, { apply: async s => { calls++; assert.equal(s.id, "b"); assert.equal(s.payload.aId, "remote-a"); return { kind: "applied", remoteRef: "b" }; } });
  assert.equal(third.continueFrom(failed.id).id, next.id);
  const completed = await third.publish(next.id, third.preflight(next.id).certificate!);
  assert.equal(completed.steps[0]?.status, "reused"); assert.equal(calls, 1); third.close();
  const fourth = open(path); t.after(() => fourth.close()); assert.deepEqual(fourth.getRun(completed.id), completed);
});

test("manual and stop commands are saved atomically with their resulting state", async t => {
  const path = file(t); const first = open(path, { apply: async () => ({ kind: "unknown", reason: "lost" }) });
  const { id, check } = ready(first); const unknown = await first.publish(id, check.certificate!);
  const known = first.adjudicate(unknown.id, "a", { requestId: "manual", expectedSequence: unknown.events.length, actor: "operator", evidence: "receipt", note: "Verified no effect", decision: { kind: "no_effect", next: "retry" } });
  const stopped = first.stopRetry(known.id, { requestId: "stop", expectedSequence: known.events.length, actor: "operator", reason: "limit" }); first.close();
  const second = open(path); assert.deepEqual(second.getRun(stopped.id), stopped);
  const next = second.revise(stopped.id); second.close();
  const third = open(path); t.after(() => third.close()); assert.equal(third.revise(stopped.id).id, next.id);
});

test("a failed dispatch checkpoint makes no remote call and poisons local advancement", async t => {
  const path = file(t); let calls = 0; const engine = open(path, { apply: async () => { calls++; return { kind: "applied", remoteRef: "a" }; } });
  const { id, check } = ready(engine); const db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER reject_run_update BEFORE UPDATE ON sw_runs BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END;");
  await assert.rejects(engine.publish(id, check.certificate!), /fixture disk failure/);
  const runId = engine.listRunIds()[0]!; assert.equal(calls, 0);
  assert.equal(engine.getRun(runId).steps[0]?.status, "ready");
  db.exec("DROP TRIGGER reject_run_update");
  await assert.rejects(engine.resume(runId), /RUN_STORAGE_FAILED/);
  db.close(); engine.close();
});

test("a failed outcome checkpoint preserves dispatch intent and never sends the next step", async t => {
  const path = file(t); let calls = 0; const engine = open(path, { apply: async s => { calls++; return { kind: "applied", remoteRef: s.id }; } });
  const { id, check } = ready(engine); const db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER reject_receipt BEFORE UPDATE ON sw_runs WHEN json_extract(NEW.body, '$.steps[0].status') = 'applied' BEGIN SELECT RAISE(ABORT, 'fixture receipt failure'); END;");
  await assert.rejects(engine.publish(id, check.certificate!), /fixture receipt failure/);
  const runId = engine.listRunIds()[0]!; assert.equal(calls, 1); assert.equal(engine.getRun(runId).steps[0]?.status, "dispatching");
  await assert.rejects(engine.resume(runId), /RUN_STORAGE_FAILED/); db.close(); engine.close();
});

test("process exit inside an adapter leaves durable dispatch intent and a sealed draft", t => {
  const path = file(t); const api = new URL("../src/index.js", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import {createLegacyStagedWrite} from ${JSON.stringify(api)}; const e=createLegacyStagedWrite({definitions:[${JSON.stringify(definition)}],mode:'executable',storage:{kind:'sqlite',path:${JSON.stringify(path)}},executors:[{type:'durable',typeVersion:'1',id:'mock',version:'1',target:'mock:local',plan:()=>[{id:'a',payload:{value:1}}],apply:async()=>process.exit(19),reconcile:{unsupported:'fixture'}}]});const d=e.create({type:'durable',typeVersion:'1'});e.edit(d.id,0,[{op:'node.add',id:'a',nodeType:'item'}]);await e.publish(d.id,e.preflight(d.id).certificate);`], { encoding: "utf8" });
  assert.equal(result.status, 19, result.stderr);
  const engine = open(path); t.after(() => engine.close()); const run = engine.getRun(engine.listRunIds()[0]!);
  assert.equal(run.state, "running"); assert.equal(run.steps[0]?.status, "dispatching"); assert.deepEqual(run.steps[0]?.resolvedPayload, { value: 1 });
  assert.equal(run.events.at(-1)?.kind, "dispatching"); assert.equal(engine.getRunInput(run.id).draft.id, run.draftId);
});

test("changed executor identity cannot publish a stored plan", async t => {
  const path = file(t); const first = open(path); const { id, check } = ready(first); first.close();
  for (const overrides of [{ target: "mock:other" }, { version: "2" }, { id: "other" }]) {
    const next = open(path, overrides); await assert.rejects(next.publish(id, check.certificate!), /EXECUTOR_BINDING_MISMATCH/); assert.deepEqual(next.listRunIds(), []); next.close();
  }
});

test("a failed manual checkpoint cannot turn unknown evidence into a revision", async t => {
  const path = file(t); const engine = open(path, { apply: async () => ({ kind: "unknown", reason: "lost" }) });
  const { id, check } = ready(engine); const run = await engine.publish(id, check.certificate!);
  const db = new DatabaseSync(path); db.exec("CREATE TRIGGER reject_manual BEFORE UPDATE ON sw_runs BEGIN SELECT RAISE(ABORT, 'fixture manual failure'); END;");
  assert.throws(() => engine.adjudicate(run.id, "a", { requestId: "manual", expectedSequence: run.events.length, actor: "operator", evidence: "receipt", note: "Verified", decision: { kind: "no_effect", next: "stop" } }), /fixture manual failure/);
  assert.deepEqual(engine.getRun(run.id), run);
  assert.throws(() => engine.revise(run.id), /ZERO_EFFECT_FAILURE_REQUIRED/);
  db.close(); engine.close();
});

test("schema version one upgrades without losing draft data and future versions are rejected", t => {
  const path = file(t); const db = new DatabaseSync(path);
  db.exec("CREATE TABLE sw_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; INSERT INTO sw_meta VALUES ('schema','1'); CREATE TABLE sw_drafts (id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, check_epoch INTEGER NOT NULL DEFAULT 0, check_body TEXT) STRICT;");
  // Construct the pre-M5 database layout; no run or plan tables existed in that version.
  const memory = createLegacyStagedWrite({ definitions: [definition] }); const original = memory.create(selector); memory.close();
  db.prepare("INSERT INTO sw_drafts (id,version,body) VALUES (?,?,?)").run(original.id, original.version, JSON.stringify(original));
  db.close(); const engine = open(path); assert.deepEqual(engine.getDraft(original.id), original); const { id } = ready(engine); engine.close();
  const inspect = new DatabaseSync(path); assert.equal(inspect.prepare("SELECT value FROM sw_meta WHERE key='schema'").get()?.value, "5");
  inspect.exec("UPDATE sw_meta SET value='99' WHERE key='schema'"); inspect.close();
  assert.throws(() => open(path), /STORAGE_VERSION_UNSUPPORTED/);
  const restore = new DatabaseSync(path); restore.exec("UPDATE sw_meta SET value='2' WHERE key='schema'"); restore.close();
  const next = open(path); assert.equal(next.getDraft(id).version, 1); next.close();
});
