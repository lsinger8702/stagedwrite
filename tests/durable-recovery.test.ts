import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createStagedWrite } from "../src/index.js";
import type { GraphExecutor, Run, Clock, ApplyOutcome, Step } from "../src/index.js";
const definition = { id: "recovery", version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} };
const selector = { type: "recovery", typeVersion: "1" };
const plan: Step[] = [{ id: "a", payload: { title: "Project" } }, { id: "b", payload: {}, dependsOn: ["a"], inputRefs: { projectId: "a" } }];
function file(t: { after(fn: () => void): void }) { const dir = mkdtempSync(join(tmpdir(), "sw-recovery-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "data.sqlite"); }
function open(path: string, overrides: Partial<GraphExecutor> = {}, clock: Clock = () => 0) {
  return createStagedWrite({ definitions: [definition], mode: "executable", storage: { kind: "sqlite", path }, clock, executors: [{
    ...selector, id: "mock", version: "1", target: "mock:local", plan: () => structuredClone(plan),
    apply: async (): Promise<ApplyOutcome> => ({ kind: "unknown", reason: "lost" }), reconcile: { unsupported: "no evidence" }, ...overrides }] });
}
async function start(engine: ReturnType<typeof open>) { const draft = engine.create(selector); engine.edit(draft.id, 0, [{ op: "node.add", id: "a", nodeType: "item" }]); return engine.publish(draft.id, engine.preflight(draft.id).certificate!); }
const command = (run: Run, requestId = "claim") => ({ requestId, expectedSequence: run.events.length, actor: "operator", reason: "Resume interrupted work" });
function crash(path: string, phase = "apply") {
  const api = new URL("../src/index.js", import.meta.url).href;
  const code = `import {createStagedWrite} from ${JSON.stringify(api)}; import {writeFileSync} from 'node:fs';
  const engine=createStagedWrite({definitions:[${JSON.stringify(definition)}],mode:'executable',storage:{kind:'sqlite',path:${JSON.stringify(path)}},executors:[{...${JSON.stringify(selector)},id:'mock',version:'1',target:'mock:local',plan:()=>${JSON.stringify(plan)},
  apply:async(step,key)=>{writeFileSync(${JSON.stringify(path + '.receipt')},JSON.stringify({key,payload:step.payload,remoteRef:'project-remote'}));process.exit(19)},
  reconcile:async()=>process.exit(20)}]});
  ${phase === 'apply' ? `const d=engine.create(${JSON.stringify(selector)});engine.edit(d.id,0,[{op:"node.add",id:"a",nodeType:"item"}]);await engine.publish(d.id,engine.preflight(d.id).certificate);` : `const run=engine.getRun(engine.listRunIds()[0]);engine.recover(run.id,{requestId:'child',expectedSequence:run.events.length,actor:'child',reason:'recover'});await engine.resume(run.id);`}`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, phase === "apply" ? 19 : 20, result.stderr);
}

test("a dead process is recovered by remote evidence without repeating its effect or replanning", async t => {
  const path = file(t); crash(path);
  const receipt = JSON.parse(readFileSync(path + ".receipt", "utf8")); let applies = 0, reconciles = 0;
  const engine = open(path, { plan: () => { throw new Error("must not plan"); },
    reconcile: async (s, key) => { reconciles++; assert.equal(key, receipt.key); assert.deepEqual(s.payload, receipt.payload); return { kind: "applied", remoteRef: receipt.remoteRef }; },
    apply: async s => { applies++; assert.equal(s.id, "b"); assert.equal(s.payload.projectId, receipt.remoteRef); return { kind: "applied", remoteRef: "task-remote" }; } }); t.after(() => engine.close());
  const old = engine.getRun(engine.listRunIds()[0]!);
  await assert.rejects(engine.resume(old.id), /RECOVERY_REQUIRED/);
  const claimed = engine.recover(old.id, command(old));
  assert.equal(claimed.state, "unknown"); assert.equal(claimed.steps[0]?.status, "unknown");
  assert.equal(applies + reconciles, 0); assert.equal(claimed.steps[0]?.key, old.steps[0]?.key);
  assert.equal(claimed.events.at(-1)?.recordedAt, new Date(0).toISOString());
  const done = await engine.resume(old.id); assert.equal(done.state, "published"); assert.equal(applies, 1); assert.equal(reconciles, 1);
});

test("a second crash during reconciliation still requires reconciliation", async t => {
  const path = file(t); crash(path); crash(path, "reconcile");
  const engine = open(path, { apply: async () => { throw new Error("unexpected apply"); } }); t.after(() => engine.close());
  const run = engine.getRun(engine.listRunIds()[0]!); assert.equal(run.events.at(-1)?.kind, "reconciling");
  engine.recover(run.id, command(run)); const unresolved = await engine.resume(run.id); assert.equal(unresolved.state, "unknown");
  assert.equal(unresolved.events.filter(e => e.kind === "dispatching").length, 1);
});

test("a live owner, including another instance in this process, cannot be displaced", async t => {
  const path = file(t); const first = open(path); const run = await start(first); const second = open(path);
  assert.throws(() => second.recover(run.id, command(run)), /RUN_OWNER_ACTIVE/);
  assert.throws(() => first.recover(run.id, command(run)), /RUN_OWNER_ACTIVE/);
  first.close(); const next = second.recover(run.id, command(run)); assert.equal(next.state, "unknown");
  assert.throws(() => first.getRun(run.id), /STORE_CLOSED/); second.close();
});

test("in-flight apply blocks close and takeover, and the owner can still finish", async t => {
  const path = file(t); let finish!: (result: ApplyOutcome) => void;
  const first = open(path, { apply: async s => s.id === "a" ? new Promise(resolve => { finish = resolve; }) : { kind: "applied", remoteRef: "b" } });
  const pending = start(first); const second = open(path); const run = second.getRun(second.listRunIds()[0]!);
  assert.throws(() => first.close(), /RUN_BUSY/); assert.throws(() => first.recover(run.id, command(run)), /RUN_BUSY/);
  assert.throws(() => second.recover(run.id, command(run)), /RUN_OWNER_ACTIVE/);
  finish({ kind: "applied", remoteRef: "a" }); assert.equal((await pending).state, "published"); first.close(); second.close();
});

test("recovery commands are idempotent, conflict checked and cannot be replayed by another owner", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close();
  const second = open(path), third = open(path); const request = command(run);
  assert.throws(() => second.recover(run.id, { ...request, expectedSequence: 99 }), /STALE_RUN/);
  const claimed = second.recover(run.id, request); assert.deepEqual(second.recover(run.id, request), claimed);
  assert.throws(() => second.recover(run.id, { ...request, reason: "changed" }), /RECOVERY_CONFLICT/);
  assert.throws(() => third.recover(run.id, request), /RECOVERY_OWNER_MISMATCH/);
  assert.throws(() => third.recover(run.id, command(claimed, "competitor")), /RUN_OWNER_ACTIVE/);
  second.close(); const transferred = third.recover(run.id, command(claimed, "new-owner"));
  assert.notEqual(transferred.events.at(-1)?.recovery?.owner, claimed.events.at(-1)?.recovery?.owner); third.close();
});

test("only authoritative no-effect evidence retries, using the original request key", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close(); let allow = false, applies = 0;
  const second = open(path, { reconcile: async () => allow ? { kind: "no_effect", reason: "original request definitively rejected" } : { kind: "unknown", reason: "empty search" },
    apply: async (s, key) => { applies++; if (s.id === "a") assert.equal(key, run.steps[0]?.key); return { kind: "applied", remoteRef: s.id }; } });
  second.recover(run.id, command(run)); assert.equal((await second.resume(run.id)).state, "unknown"); assert.equal(applies, 0);
  allow = true; assert.equal((await second.resume(run.id)).state, "published"); assert.equal(applies, 2); second.close();
});

test("a blocked retry keeps its refusal evidence through recovery and can be stopped", async t => {
  const path = file(t); const first = open(path, { apply: async () => ({ kind: "not_applied", reason: "busy", retryable: true }) });
  const run = await start(first); first.close(); const second = open(path); const claimed = second.recover(run.id, command(run));
  assert.equal(second.stopRetry(run.id, { ...command(claimed), requestId: "stop" }).state, "failed"); second.close();
});

test("recovered unknown can be adjudicated and resumed explicitly", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close();
  const second = open(path, { apply: async s => { assert.equal(s.id, "b"); return { kind: "applied", remoteRef: "b" }; } });
  const recovered = second.recover(run.id, command(run));
  const decided = second.adjudicate(run.id, "a", { requestId: "manual", expectedSequence: recovered.events.length, actor: "operator", evidence: "receipt-1", note: "Verified", decision: { kind: "applied", remoteRef: "a" } });
  assert.equal(decided.state, "blocked"); assert.equal((await second.resume(run.id)).state, "published"); second.close();
});

test("failed ownership checkpoint rolls back both owner and recovery event", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close(); const second = open(path);
  const db = new DatabaseSync(path); db.exec("CREATE TRIGGER reject_claim BEFORE UPDATE ON sw_runs BEGIN SELECT RAISE(ABORT, 'claim failure'); END;");
  assert.throws(() => second.recover(run.id, command(run)), /claim failure/); assert.deepEqual(second.getRun(run.id), run);
  await assert.rejects(second.resume(run.id), /RECOVERY_REQUIRED/); db.exec("DROP TRIGGER reject_claim");
  assert.equal(second.recover(run.id, command(run)).state, "unknown"); db.close(); second.close();
});

test("binding drift and malformed commands cannot claim ownership", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close();
  for (const overrides of [{ target: "mock:other" }, { id: "other" }, { version: "2" }]) {
    const next = open(path, overrides); assert.throws(() => next.recover(run.id, command(run)), /EXECUTOR_BINDING_MISMATCH/); next.close();
  }
  const next = open(path); assert.throws(() => next.recover(run.id, { ...command(run), actor: " " }), /INVALID_RECOVERY_REQUEST/);
  assert.deepEqual(next.getRun(run.id), run); next.close();
});

test("legacy owners and owners on another host require evidence, without a timeout override", async t => {
  for (const legacy of [true, false]) {
    const path = file(t); const first = open(path); const run = await start(first); first.close(); const db = new DatabaseSync(path);
    if (legacy) { db.exec("DROP TABLE sw_sessions; UPDATE sw_meta SET value='2' WHERE key='schema'"); }
    else db.exec("UPDATE sw_sessions SET released=0, host='another-host'");
    db.close(); const next = open(path); assert.throws(() => next.recover(run.id, command(run)), /OWNER_EVIDENCE_REQUIRED/); next.close();
  }
});

test("corrupted persisted dispatch input is never recovered", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close(); const db = new DatabaseSync(path);
  db.exec("UPDATE sw_runs SET body=json_set(body,'$.steps[0].resolvedPayload.title','changed')"); db.close();
  const next = open(path); assert.throws(() => next.recover(run.id, command(run)), /STORED_RUN_CORRUPT/); next.close();
});

test("recovery clock callbacks cannot close or mutate the recovering run", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close(); let checked = false;
  const next = open(path, {}, () => { assert.throws(() => next.close(), /RUN_BUSY/); assert.throws(() => next.recover(run.id, command(run)), /RUN_BUSY/); checked = true; return 0; });
  next.recover(run.id, command(run)); assert.equal(checked, true); next.close();
});

test("exit before the dispatch checkpoint leaves ready work that can safely resume", async t => {
  const path = file(t), api = new URL("../src/index.js", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import {createStagedWrite} from ${JSON.stringify(api)};
  const e=createStagedWrite({definitions:[${JSON.stringify(definition)}],mode:'executable',storage:{kind:'sqlite',path:${JSON.stringify(path)}},clock:()=>process.exit(21),executors:[{...${JSON.stringify(selector)},id:'mock',version:'1',target:'mock:local',plan:()=>${JSON.stringify(plan)},apply:async()=>process.exit(99),reconcile:{unsupported:'fixture'}}]});
  const d=e.create(${JSON.stringify(selector)});e.edit(d.id,0,[{op:'node.add',id:'a',nodeType:'item'}]);await e.publish(d.id,e.preflight(d.id).certificate);`], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 21, child.stderr); let calls = 0;
  const e = open(path, { apply: async s => { calls++; return { kind: "applied", remoteRef: s.id }; } });
  const run = e.getRun(e.listRunIds()[0]!); assert.equal(run.steps[0]?.status, "ready"); assert.equal(run.events.length, 0);
  assert.equal(e.recover(run.id, command(run)).state, "blocked"); assert.equal((await e.resume(run.id)).state, "published"); assert.equal(calls, 2); e.close();
});

test("two competing processes cannot both take ownership", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close();
  const api = new URL("../src/index.js", import.meta.url).href;
  const source = `import {createStagedWrite} from ${JSON.stringify(api)};
  const e=createStagedWrite({definitions:[${JSON.stringify(definition)}],mode:'executable',storage:{kind:'sqlite',path:${JSON.stringify(path)}},executors:[{...${JSON.stringify(selector)},id:'mock',version:'1',target:'mock:local',plan:()=>[],apply:async()=>({kind:'unknown',reason:'fixture'}),reconcile:{unsupported:'fixture'}}]});
  process.on('message',()=>{try{e.recover(${JSON.stringify(run.id)},{...${JSON.stringify(command(run))},requestId:String(process.pid)});process.send('claimed')}catch(error){process.send(error.message)}});process.send('ready');`;
  const children = [0, 1].map(() => spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "ignore", "ignore", "ipc"] }));
  t.after(() => { for (const child of children) child.kill(); });
  const message = (child: typeof children[number]) => new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("child timeout")), 10000);
    child.once("message", value => { clearTimeout(timer); resolve(String(value)); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
  assert.deepEqual(await Promise.all(children.map(message)), ["ready", "ready"]);
  const results = children.map(message); for (const child of children) child.send("go");
  const outcomes = await Promise.all(results); assert.equal(outcomes.filter(v => v === "claimed").length, 1); assert.equal(outcomes.filter(v => v === "STALE_RUN").length, 1);
});

test("replaying a recovery command cannot unlock a failed local checkpoint", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close();
  const next = open(path); const request = command(run); next.recover(run.id, request);
  const db = new DatabaseSync(path); db.exec("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON sw_runs BEGIN SELECT RAISE(ABORT, 'checkpoint failure'); END;");
  await assert.rejects(next.resume(run.id), /checkpoint failure/); db.exec("DROP TRIGGER reject_checkpoint");
  assert.throws(() => next.recover(run.id, request), /RUN_STORAGE_FAILED/); await assert.rejects(next.resume(run.id), /RUN_STORAGE_FAILED/);
  next.close(); const reopened = open(path); const latest = reopened.getRun(run.id);
  assert.equal(reopened.recover(run.id, command(latest, "fresh")).state, "unknown"); reopened.close(); db.close();
});

test("released sessions without runs are pruned but live sessions remain", t => {
  const path = file(t); const live = open(path); const db = new DatabaseSync(path);
  for (let i = 0; i < 4; i++) { const observer = open(path); observer.close(); }
  assert.equal(db.prepare("SELECT count(*) AS n FROM sw_sessions").get()?.n, 1);
  const draft = live.create(selector); live.close();
  assert.equal(db.prepare("SELECT count(*) AS n FROM sw_sessions").get()?.n, 0);
  const reopened = open(path); assert.deepEqual(reopened.getDraft(draft.id), draft); reopened.close(); db.close();
});

test("session cleanup preserves ownership evidence until every run has transferred", async t => {
  const path = file(t); const first = open(path); const a = await start(first), b = await start(first); first.close();
  const db = new DatabaseSync(path); const oldOwner = db.prepare("SELECT owner FROM sw_runs WHERE id=?").get(a.id)!.owner!;
  assert.equal(db.prepare("SELECT released FROM sw_sessions WHERE owner=?").get(oldOwner)?.released, 1);
  const next = open(path); const claimed = next.recover(a.id, command(a));
  assert.ok(db.prepare("SELECT owner FROM sw_sessions WHERE owner=?").get(oldOwner));
  next.recover(b.id, command(b)); assert.equal(db.prepare("SELECT owner FROM sw_sessions WHERE owner=?").get(oldOwner), undefined);
  assert.equal(claimed.events.at(-1)?.recovery?.previousOwner, oldOwner);
  assert.deepEqual(next.recover(a.id, command(a)), claimed); next.close();
  const third = open(path); const snapshot = third.getRun(a.id);
  assert.equal(third.recover(a.id, command(snapshot, "third")).state, "unknown"); third.close(); db.close();
});

test("cleanup failure rolls back close and ownership transfer without losing evidence", async t => {
  const path = file(t); const first = open(path); const run = await start(first); first.close();
  const next = open(path); const db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER reject_cleanup BEFORE DELETE ON sw_sessions BEGIN SELECT RAISE(ABORT, 'cleanup failure'); END;");
  assert.throws(() => next.recover(run.id, command(run)), /cleanup failure/);
  assert.deepEqual(next.getRun(run.id), run); await assert.rejects(next.resume(run.id), /RECOVERY_REQUIRED/);
  assert.throws(() => next.close(), /cleanup failure/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sw_sessions WHERE released=0").get()?.n, 1);
  db.exec("DROP TRIGGER reject_cleanup"); assert.equal(next.recover(run.id, command(run)).state, "unknown"); next.close(); db.close();
});
