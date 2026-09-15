import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createStagedWrite, createMemoryBackend, createSqliteBackend, defineDraftType, type ManagedExecutor, type ManagedOptions, type ManagedInitialIntent, type ApplyOutcome } from "../src/index.js";
const definition = defineDraftType({ id: "example.tasks", version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { name: { type: "string" }, note: { type: ["string", "null"] } }, additionalProperties: false }, requiredAtPublish: ["name"] } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: "1" };
const initial = (): ManagedInitialIntent => ({ nodes: { a: { id: "a", nodeType: "task", fields: { name: "First", note: null } }, b: { id: "b", nodeType: "task", fields: { name: "Second" } } }, edges: {} });
function executor(overrides: Partial<ManagedExecutor> = {}): ManagedExecutor { return { ...selector, id: "tasks.create", version: "1", target: "mock:test", plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, payload: { ...n.fields }, effect: { kind: "create", nodeId: n.id } })), apply: async (s) => ({ kind: "applied", remoteRef: `remote:${s.id}` }), reconcile: async () => ({ kind: "unknown", reason: "No evidence" }), ...overrides }; }
function engine(e = executor(), options: Partial<ManagedOptions> = {}) { return createStagedWrite({ definitions: [definition], executors: [e], ...options }); }
async function ready(e = engine()) { const d = await e.create(selector, initial()), c = await e.preflight(d.id); assert.equal(c.status, "passed"); return { e, d, c }; }
test("managed: initial intent is required, plain values and fixed reset baseline survive many edits", async () => {
    const e = engine(), input = initial();
    const d = await e.create(selector, input);
    input.nodes.a!.fields.name = "mutated";
    assert.equal(d.graph.nodes.a!.fields.name, "First");
    assert.deepEqual(d.fieldIntents.a!["/note"], { kind: "set", value: null });
    let next = await e.edit(d.id, 0, [{ op: "set", nodeId: "a", path: "/name", value: "v1" }]);
    next = await e.edit(d.id, next.version, [{ op: "set", nodeId: "a", path: "/name", value: "v2" }, { op: "remove", nodeId: "a", path: "/note" }, { op: "set", nodeId: "b", path: "/note", value: "new" }]);
    assert.equal("note" in next.graph.nodes.a!.fields, false);
    assert.deepEqual(next.fieldIntents.a!["/note"], { kind: "remove" });
    next = await e.edit(d.id, next.version, [{ op: "reset", nodeId: "a", path: "/name" }, { op: "reset", nodeId: "a", path: "/note" }, { op: "reset", nodeId: "b", path: "/note" }]);
    assert.deepEqual(next.graph, initial());
    assert.equal(next.fieldIntents.b!["/note"], undefined);
    assert.deepEqual(next.initialSnapshot, d.initialSnapshot);
    await assert.rejects(e.create(selector, { nodes: {}, edges: {} }), /INITIAL_INTENT_REQUIRED/);
    await assert.rejects(e.edit(d.id, 0, [{ op: "remove", nodeId: "a", path: "/name" }]));
    await e.close();
});
test("managed: atomic batches and preview neither mutate the draft nor turn reset into undo", async () => {
    const { e, d } = await ready();
    const p = await e.preview(d.id, 0, [{ op: "set", nodeId: "a", path: "/name", value: "edited" }, { op: "reset", nodeId: "a", path: "/name" }]);
    assert.equal(p.candidate.graph.nodes.a!.fields.name, "First");
    assert.equal((await e.getDraft(d.id)).version, 0);
    await assert.rejects(e.edit(d.id, 0, [{ op: "set", nodeId: "a", path: "/name", value: "edited" }, { op: "set", nodeId: "b", path: "/nope", value: "bad" }]));
    assert.deepEqual(await e.getDraft(d.id), d);
    await e.close();
});
test("managed: partial create is owned by one run, repairs resume only unfinished effects", async () => {
    const calls: string[] = [], keys: string[] = [];
    const e = engine(executor({ apply: async (s, k) => { calls.push(`${s.id}:${s.payload.name}`); keys.push(k); return s.payload.name === "Second" ? { kind: "not_applied", reason: "Name reserved", diagnostics: [{ code: "name.reserved", path: "/nodes/b/fields/name", message: "Choose another name", candidates: [{ value: "Fixed", repairOps: [{ op: "set", nodeId: "b", path: "/name", value: "Fixed" }] }] }] } : { kind: "applied", remoteRef: `remote:${s.id}` }; } }));
    const { d, c } = await ready(e), r = await e.publish(d.id, c.certificate!, { runId: "initial-create" });
    assert.equal(r.state, "blocked");
    assert.equal(r.diagnostics[0]?.message, "Choose another name");
    assert.equal(r.diagnostics[0]?.candidates?.[0]?.repairOps?.length, 1);
    const partial = await e.getDraft(d.id);
    assert.equal(partial.status, "pending");
    assert.equal(partial.currentRunId, r.id);
    assert.equal(partial.lastPublishedAt, null);
    assert.equal((await e.publish(d.id, "stale certificate")).id, r.id);
    assert.equal(calls.length, 2);
    await assert.rejects(e.publish(d.id, c.certificate!, { runId: "another" }), /RUN_ID_CONFLICT/);
    await assert.rejects(e.edit(d.id, 0, [{ op: "set", nodeId: "a", path: "/name", value: "changed" }]), /APPLIED_STEP_IMMUTABLE/);
    await assert.rejects(e.edit(d.id, 0, [{ op: "node.add", id: "c", nodeType: "task" }]), /REPAIR_TOPOLOGY_CHANGED/);
    await e.edit(d.id, 0, [{ op: "set", nodeId: "b", path: "/name", value: "Fixed" }]);
    const checked = await e.preflight(d.id);
    assert.deepEqual(checked.executionHint, { runId: r.id, nextAction: "resume" });
    const done = await e.resume(r.id);
    assert.equal(done.state, "published");
    assert.equal(done.id, r.id);
    assert.equal(done.revisions.length, 1);
    assert.deepEqual(calls, ["a:First", "b:Second", "b:Fixed"]);
    assert.notEqual(keys[1], keys[2]);
    assert.equal((await e.getDraft(d.id)).publishedArtifactId, done.artifactId);
    assert.equal(Object.keys(await e.getBindings(d.id)).length, 2);
    assert.equal((await e.publish(d.id, "ignored")).id, r.id);
    assert.equal((await e.resume(r.id)).state, "published");
    assert.equal(calls.length, 3);
    await assert.rejects(e.edit(d.id, 1, [{ op: "set", nodeId: "b", path: "/name", value: "Update" }]), /UPDATE_NOT_SUPPORTED/);
    await e.close();
});
test("managed: unknown is reconciled with original payload before adopting edits", async () => {
    const inputs: string[] = [], keys: string[] = [];
    let calls = 0;
    const e = engine(executor({ apply: async (s, k) => { calls++; keys.push(k); return s.id === "b" && calls === 2 ? { kind: "unknown", reason: "Timeout" } : { kind: "applied", remoteRef: s.id }; }, reconcile: async (s, k) => { inputs.push(String(s.payload.name)); assert.equal(k, keys[1]); return { kind: "no_effect", reason: "Cancelled before acceptance" }; } }));
    const { d, c } = await ready(e), r = await e.publish(d.id, c.certificate!);
    await e.edit(d.id, 0, [{ op: "set", nodeId: "b", path: "/name", value: "Repaired" }]);
    const done = await e.resume(r.id);
    assert.equal(done.state, "published");
    assert.deepEqual(inputs, ["Second"]);
    assert.equal(calls, 3);
    assert.notEqual(keys[1], keys[2]);
    await e.close();
});
test("managed: unknown that resolves applied blocks contradictory repair until intent matches receipt", async () => {
    let calls = 0;
    const e = engine(executor({ apply: async (s) => { calls++; return s.id === "b" ? { kind: "unknown", reason: "Timeout" } : { kind: "applied", remoteRef: s.id }; }, reconcile: async (s) => ({ kind: "applied", remoteRef: s.id }) }));
    const { d, c } = await ready(e), r = await e.publish(d.id, c.certificate!);
    await e.edit(d.id, 0, [{ op: "set", nodeId: "b", path: "/name", value: "Different" }]);
    const blocked = await e.resume(r.id);
    assert.equal(blocked.check?.status, "blocked");
    assert.equal(calls, 2);
    await e.edit(d.id, 1, [{ op: "reset", nodeId: "b", path: "/name" }]);
    assert.equal((await e.resume(r.id)).state, "published");
    assert.equal(calls, 2);
    await e.close();
});
test("managed: same-input refusal can resume without edit, same request key and no redoing success", async () => {
    const keys: string[] = [];
    let count = 0;
    const { e, d, c } = await ready(engine(executor({ apply: async (s, k) => { keys.push(k); count++; return count === 2 ? { kind: "not_applied", reason: "Temporary refusal", retryable: true } : { kind: "applied", remoteRef: s.id }; } })));
    const r = await e.publish(d.id, c.certificate!);
    assert.equal((await e.resume(r.id)).state, "published");
    assert.equal(keys[1], keys[2]);
    assert.equal(keys.length, 3);
    await e.close();
});
test("managed: rich diagnostics and async pending do not issue a publish certificate", async () => {
    let done = false;
    const e = engine(executor(), { rules: [{ ...selector, id: "note", version: "1", check: d => d.graph.nodes.b!.fields.note ? [] : [{ code: "note.missing", path: "/nodes/b/fields/note", message: "Add context", severity: "warning", hint: "Be specific", repairs: [{ message: "Example", ops: [{ op: "set", nodeId: "b", path: "/note", value: "Review" }] }], metadata: { origin: "test" } }] }], asyncRules: [{ ...selector, id: "remote.ready", version: "1", check: async () => done ? { status: "complete", diagnostics: [] } : { status: "pending", message: "Still checking", retryAfterSeconds: 1 } }] });
    const d = await e.create(selector, initial()), pending = await e.preflight(d.id);
    assert.equal(pending.status, "pending");
    assert.equal(pending.certificate, undefined);
    assert.equal(pending.diagnostics[0]?.repairs?.length, 1);
    assert.ok(pending.preview.nodes.b);
    await assert.rejects(e.publish(d.id, "none"), /PREFLIGHT_REQUIRED/);
    done = true;
    assert.equal((await e.preflight(d.id)).status, "passed");
    await e.close();
});
test("managed: stale async completion cannot certify an edited draft; close rejects in-flight checks", async () => {
    let finish!: () => void, entered!: () => void;
    const started = new Promise<void>(r => entered = r);
    const e = engine(executor(), { asyncRules: [{ ...selector, id: "wait", version: "1", check: () => new Promise(resolve => { finish = () => resolve({ status: "complete", diagnostics: [] }); entered(); }) }] });
    const d = await e.create(selector, initial()), checking = e.preflight(d.id);
    await started;
    await assert.rejects(e.close(), /DRAFT_BUSY/);
    await e.edit(d.id, 0, [{ op: "set", nodeId: "b", path: "/name", value: "Later" }]);
    finish();
    await assert.rejects(checking, /STALE_CHECK/);
    await assert.rejects(e.getCheck(d.id), /CHECK_NOT_CURRENT/);
    await e.close();
});
test("managed: shared lock excludes publish, edit and resume across engine instances", async () => {
    let finish!: (o: ApplyOutcome) => void, entered!: () => void;
    const started = new Promise<void>(r => entered = r), backend = createMemoryBackend();
    const e = engine(executor({ apply: s => s.id === "a" ? new Promise(resolve => { finish = resolve; entered(); }) : Promise.resolve({ kind: "applied", remoteRef: s.id }) }), backend), other = engine(executor(), backend);
    const { d, c } = await ready(e), work = e.publish(d.id, c.certificate!, { runId: "concurrent" });
    await started;
    await assert.rejects(other.publish(d.id, c.certificate!), /DRAFT_BUSY/);
    await assert.rejects(other.edit(d.id, 0, []), /DRAFT_BUSY/);
    await assert.rejects(other.resume("concurrent"), /DRAFT_BUSY/);
    const independent = await other.create(selector, initial());
    assert.notEqual(independent.id, d.id);
    finish({ kind: "applied", remoteRef: "a" });
    assert.equal((await work).state, "published");
    await e.close();
    await other.close();
});
test("managed: SQLite reopen restores partial facts, baseline, run pointer and same request key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-managed-")), path = join(dir, "state.sqlite");
    try {
        const backend = createSqliteBackend(path), e = engine(executor({ apply: async (s) => s.id === "b" ? { kind: "unknown", reason: "Disconnected" } : { kind: "applied", remoteRef: s.id } }), backend);
        const { d, c } = await ready(e), r = await e.publish(d.id, c.certificate!);
        await e.close();
        let calls = 0;
        const next = engine(executor({ apply: async () => { calls++; throw Error("must not create"); }, reconcile: async (s, k) => { assert.equal(k, r.steps[1]!.key); return { kind: "applied", remoteRef: s.id }; } }), createSqliteBackend(path));
        assert.equal((await next.getDraft(d.id)).currentRunId, r.id);
        assert.equal((await next.resume(r.id)).state, "published");
        assert.equal(calls, 0);
        assert.deepEqual((await next.getDraft(d.id)).initialSnapshot.graph, initial());
        await next.close();
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("managed: result persistence failure records a receipt, resume does not resend", async () => {
    const backend = createMemoryBackend();
    let inject = true, calls = 0;
    const storage = { ...backend.storage, transact: async (...args: Parameters<typeof backend.storage.transact>) => { const [id, l, update] = args; return backend.storage.transact(id, l, s => { const next = update(s); if (inject && Object.keys(next.bindings).length) {
            inject = false;
            throw Error("injected commit failure");
        } return next; }); } };
    const e = engine(executor({ apply: async (s) => { calls++; return { kind: "applied", remoteRef: s.id }; }, reconcile: async () => { throw Error("receipt is already known"); } }), { storage, locks: backend.locks });
    const { d, c } = await ready(e);
    await assert.rejects(e.publish(d.id, c.certificate!, { runId: "receipt" }), /injected/);
    assert.equal((await backend.storage.read(d.id))!.lateFacts.length, 1);
    assert.equal((await e.resume("receipt")).state, "published");
    assert.equal(calls, 2);
    await e.close();
});
test("managed: lease expiry fences writes and old release cannot unlock the new owner", async () => {
    for (const sqlite of [false, true]) {
        const dir = mkdtempSync(join(tmpdir(), "sw-lease-")), backend = sqlite ? createSqliteBackend(join(dir, "state.sqlite")) : createMemoryBackend();
        try {
            const resource = JSON.stringify([backend.storage.namespace, "draft", "draft"]), old = (await backend.locks.acquire(resource, { ttlMs: 30 }))!;
            assert.ok(old);
            await delay(45);
            const next = (await backend.locks.acquire(resource, { ttlMs: 1000 }))!;
            assert.ok(next);
            assert.ok(next.fence > old.fence);
            assert.equal(await old.renew(), false);
            await old.release();
            assert.equal(await backend.locks.acquire(resource, { ttlMs: 100 }), null);
            await assert.rejects(backend.storage.transact("draft", old, () => { throw Error("callback must not run"); }), /LEASE_LOST/);
            await next.release();
        }
        finally {
            await backend.storage.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }
});
test("managed: SQLite leases contend in a separate OS process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-process-")), path = join(dir, "state.sqlite"), backend = createSqliteBackend(path);
    try {
        const resource = JSON.stringify([backend.storage.namespace, "draft", "id"]), held = (await backend.locks.acquire(resource, { ttlMs: 10000 }))!;
        const code = `import {createSqliteBackend} from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)};const b=createSqliteBackend(${JSON.stringify(path)});const l=await b.locks.acquire(${JSON.stringify(resource)},{ttlMs:1000});process.stdout.write(l?'acquired':'busy');if(l)await l.release();await b.storage.close();`;
        const child = () => new Promise<string>((resolve, reject) => { const p = spawn(process.execPath, ["--input-type=module", "-e", code]); let out = "", err = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d); p.on("error", reject); p.on("exit", c => c === 0 ? resolve(out) : reject(Error(err))); });
        assert.equal(await child(), "busy");
        await held.release();
        assert.equal(await child(), "acquired");
    }
    finally {
        await backend.storage.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test("managed: another registration cannot use a stored certificate to dispatch", async () => {
    const backend = createMemoryBackend(), e = engine(executor(), backend), { d, c } = await ready(e);
    const other = engine(executor(), { ...backend, rules: [{ ...selector, id: "new", version: "1", check: () => [] }] });
    await assert.rejects(other.publish(d.id, c.certificate!), /REGISTRATION_BINDING_MISMATCH/);
    assert.equal((await e.getDraft(d.id)).currentRunId, null);
    await e.close();
    await other.close();
});
test("managed: executor must map every node exactly once and storage cannot omit its lock provider", async () => {
    assert.throws(() => engine(executor(), { storage: createMemoryBackend().storage }), /STORAGE_LOCK_PAIR_REQUIRED/);
    const e = engine(executor({ plan: () => [{ id: "a", payload: {} }] })), d = await e.create(selector, initial());
    assert.equal((await e.preflight(d.id)).status, "blocked");
    await e.close();
});
test("managed: process exit after remote creation resumes from durable original attempt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-crash-")), path = join(dir, "state.sqlite"), receipts = join(dir, "remote.json");
    try {
        const code = `import {createStagedWrite,createSqliteBackend} from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)};import{writeFileSync}from'node:fs';const e=createStagedWrite({definitions:[${JSON.stringify(definition)}],...createSqliteBackend(${JSON.stringify(path)}),leaseTtlMs:60,executors:[{...${JSON.stringify(selector)},id:'tasks.create',version:'1',target:'mock:test',plan:d=>Object.values(d.graph.nodes).map(n=>({id:n.id,payload:{...n.fields},effect:{kind:'create',nodeId:n.id}})),apply:async(s,k)=>{if(s.id==='b'){writeFileSync(${JSON.stringify(receipts)},JSON.stringify({key:k,input:s.payload,remoteRef:'b'}));process.exit(0);}return{kind:'applied',remoteRef:s.id};},reconcile:async()=>({kind:'unknown',reason:'no evidence'})}]});const d=await e.create(${JSON.stringify(selector)},${JSON.stringify(initial())});const c=await e.preflight(d.id);await e.publish(d.id,c.certificate,{runId:'crash'});process.exit(1);`;
        await new Promise<void>((resolve, reject) => { const p = spawn(process.execPath, ["--input-type=module", "-e", code]); let err = ""; p.stderr.on("data", d => err += d); p.on("error", reject); p.on("exit", c => c === 0 ? resolve() : reject(Error(err))); });
        await delay(90);
        const { readFileSync } = await import("node:fs"), receipt = JSON.parse(readFileSync(receipts, "utf8"));
        let applies = 0;
        const e = engine(executor({ apply: async () => { applies++; throw Error("duplicate creation"); }, reconcile: async (s, k) => { assert.equal(k, receipt.key); assert.deepEqual(s.payload, receipt.input); return { kind: "applied", remoteRef: receipt.remoteRef }; } }), createSqliteBackend(path));
        const before = await e.getRun("crash");
        assert.deepEqual(before.steps.map(s => s.status), ["applied", "dispatching"]);
        assert.equal((await e.resume("crash")).state, "published");
        assert.equal(applies, 0);
        await e.close();
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("managed: failed renewal stops advancement, late receipt survives and next owner finishes", async () => {
    const backend = createMemoryBackend();
    let expire = false, seen = 0;
    const locks = { acquire: async (...args: Parameters<typeof backend.locks.acquire>) => { const l = await backend.locks.acquire(...args); return !l ? null : { ...l, renew: async () => expire ? false : l.renew() }; } };
    const e = engine(executor({ apply: async (s) => { seen++; if (s.id === "a") {
            expire = true;
            await delay(85);
        } return { kind: "applied", remoteRef: s.id }; } }), { storage: backend.storage, locks, leaseTtlMs: 30 });
    const { d, c } = await ready(e);
    await assert.rejects(e.publish(d.id, c.certificate!, { runId: "lease-loss" }), /LEASE_LOST/);
    assert.equal(seen, 1);
    const other = engine(executor({ apply: async (s) => { seen++; return { kind: "applied", remoteRef: s.id }; }, reconcile: async () => { throw Error("durable receipt must be used"); } }), backend);
    assert.equal((await other.resume("lease-loss")).state, "published");
    assert.equal(seen, 2);
    await e.close();
    await other.close();
});
