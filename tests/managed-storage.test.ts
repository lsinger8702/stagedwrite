import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMemoryBackend, createSqliteBackend, createStagedWrite, defineDraftType } from "../src/index.js";
import type { ManagedState, ManagedExecutor } from "../src/managed/types.js";
import { lockResource } from "../src/managed/storage.js";

const definition = defineDraftType({ id: "storage.tasks", version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false } } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: "1" };
const executor: ManagedExecutor = { ...selector, id: "storage.executor", version: "1", target: "test", plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, payload: n.fields, effect: { kind: "create", nodeId: n.id } })), apply: async s => ({ kind: "applied", remoteRef: `remote:${s.id}`, confirmed: { projectionDigest: "title-v1", values: { title: { kind: "value", value: "A" } } } }), reconcile: { unsupported: "test" } };
async function fixture(sqlite: boolean) {
    const dir = mkdtempSync(join(tmpdir(), "sw-model-")), path = join(dir, "state.sqlite");
    const backend = sqlite ? createSqliteBackend(path) : createMemoryBackend();
    const engine = createStagedWrite({ definitions: [definition], executors: [executor], ...backend });
    const draft = await engine.create(selector, { nodes: { a: { id: "a", nodeType: "task", fields: { title: "A" } } }, edges: {} });
    const check = await engine.preflight(draft.id);
    const run = await engine.publish(draft.id, check.certificate!);
    const lease = await backend.locks.acquire(lockResource(backend.storage.namespace, draft.id), { ttlMs: 60_000 });
    assert.ok(lease);
    const edit = (fn: (s: ManagedState) => void) => backend.storage.transact(draft.id, lease, s => { assert.ok(s); fn(s); return s; });
    const cleanup = async () => { await lease.release(); await engine.close(); rmSync(dir, { recursive: true, force: true }); };
    return { backend, engine, draft, run, edit, cleanup, path };
}
function addUpdate(s: ManagedState, id: string) {
    const original = s.runs[s.draft.currentRunId!]!;
    s.runs[id] = { ...structuredClone(original), id, kind: "update", state: "blocked", attempts: [], events: [], revisions: [], steps: original.steps.map(step => ({ ...step, status: "ready" })) };
    s.draft.currentRunId = id;
    s.draft.status = "pending";
}
for (const sqlite of [false, true]) {
    const label = sqlite ? "sqlite" : "memory";
    test(`${label}: completed run history permits one update owner and rejects a second atomically`, async () => {
        const f = await fixture(sqlite);
        try {
            await f.edit(s => addUpdate(s, "update-1"));
            const before = await f.backend.storage.read(f.draft.id);
            await assert.rejects(f.edit(s => addUpdate(s, "update-2")), /UNRESOLVED_RUN_ALREADY_EXISTS/);
            assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
            await assert.rejects(f.edit(s => { delete s.runs[f.run.id]; }), /RUN_HISTORY_IMMUTABLE|FACT_EVIDENCE_MISSING/);
            await assert.rejects(f.edit(s => { s.runs[f.run.id]!.state = "blocked"; }), /COMPLETED_RUN_IMMUTABLE|UNRESOLVED_RUN_ALREADY_EXISTS/);
            await assert.rejects(f.edit(s => { s.draft.currentRunId = f.run.id; }), /RUN_POINTER/);
            assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
        } finally { await f.cleanup(); }
    });
    test(`${label}: latest remote facts are separate from immutable creation evidence`, async () => {
        const f = await fixture(sqlite);
        try {
            const original = await f.engine.getBindings(f.draft.id);
            await f.edit(s => {
                s.remoteFacts.fact1 = { id: "fact1", nodeId: "a", targetId: "test", remoteId: "remote:a", projectionDigest: "title-v1", values: { title: { kind: "value", value: "A" } }, source: { kind: "attempt", runId: f.run.id, stepId: "a", attemptNumber: 1 }, confirmedAt: "2026-09-16T00:00:00Z" };
                s.latestFactByNode.a = "fact1"; s.resourceRevision++;
            });
            const before = await f.backend.storage.read(f.draft.id);
            assert.deepEqual(await f.engine.getBindings(f.draft.id), original);
            await assert.rejects(f.edit(s => { s.remoteFacts.fact1!.values.title = { kind: "value", value: "corrupt" }; }), /FACT_IMMUTABLE|FACT_EVIDENCE_MISSING/);
            await assert.rejects(f.edit(s => { s.latestFactByNode.a = "missing"; }), /LATEST_FACT_MISMATCH/);
            await assert.rejects(f.edit(s => { s.bindings.a!.remoteId = "another"; }), /BINDING_IMMUTABLE|FACT_IDENTITY/);
            await assert.rejects(f.edit(s => { s.remoteFacts.fact2 = { ...s.remoteFacts.fact1!, id: "fact2" }; s.latestFactByNode.a = "fact2"; }), /FACT_REVISION_REQUIRED/);
            await assert.rejects(f.edit(s => { s.remoteFacts.fact2 = { ...s.remoteFacts.fact1!, id: "fact2", source: { kind: "attempt", runId: "missing", stepId: "a", attemptNumber: 1 } }; }), /FACT_EVIDENCE_MISSING/);
            assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
        } finally { await f.cleanup(); }
    });
    test(`${label}: adoption records survive reopen and cannot be reassigned`, async () => {
        const f = await fixture(sqlite);
        try {
            assert.equal((await f.backend.storage.read(f.draft.id))!.publications[f.run.certificate]!.kind, "run");
            const before = await f.backend.storage.read(f.draft.id);
            await assert.rejects(f.edit(s => { delete s.publications[f.run.certificate]; }), /PUBLICATION_IMMUTABLE/);
            await assert.rejects(f.edit(s => { s.publications[f.run.certificate]!.version = 100; }), /PUBLICATION_IMMUTABLE|PUBLICATION_IDENTITY/);
            if (sqlite) {
                const other = createSqliteBackend(f.path);
                try { assert.deepEqual(await other.storage.read(f.draft.id), before); } finally { await other.storage.close(); }
            }
            assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
            await assert.rejects(f.engine.edit(f.draft.id, 0, [{ op: "set", nodeId: "a", path: "/title", value: "B" }]), /DRAFT_BUSY/);
        } finally { await f.cleanup(); }
    });
}
test("sqlite: old schema is rejected before journal or DDL changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-old-")), path = join(dir, "old.sqlite");
    try {
        const db = new DatabaseSync(path);
        db.exec("CREATE TABLE sw_managed_meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO sw_managed_meta VALUES('schema','1'); CREATE TABLE precious(value TEXT); INSERT INTO precious VALUES('keep');");
        db.close();
        const before = readFileSync(path);
        assert.throws(() => createSqliteBackend(path), /STORAGE_VERSION_UNSUPPORTED/);
        assert.deepEqual(readFileSync(path), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const sqlite of [false, true]) {
    test(`${sqlite ? "sqlite" : "memory"}: malformed intent snapshots are rejected before commit without damaging durable state`, async () => {
        const f = await fixture(sqlite);
        try {
            const before = await f.backend.storage.read(f.draft.id);
            const corruptions: ((s: ManagedState) => void)[] = [
                s => { s.draft.graph.nodes.a!.fields.title = "not declared"; },
                s => { s.draft.fieldIntents.ghost = { "/title": { kind: "remove" } }; },
                s => { s.draft.fieldIntents.a!["/title/child"] = { kind: "remove" }; },
                s => { s.draft.fieldIntents.a!["/title"] = { kind: "remove" }; },
                s => { s.draft.graph.edges.bad = { id: "bad", relationType: "uses", from: "a", to: "missing" }; }
            ];
            for (const corrupt of corruptions) {
                await assert.rejects(f.edit(corrupt), /STATE_INTENT_INVALID/);
                assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
            }
            await assert.rejects(f.edit(s => { s.draft.initialSnapshot.graph.nodes.a!.fields.title = "corrupt baseline"; }), /INITIAL_SNAPSHOT_IMMUTABLE/);
            await assert.rejects(f.edit(s => { s.artifacts[f.run.artifactId]!.draft.graph.nodes.a!.fields.title = "corrupt artifact"; }), /ARTIFACT_IMMUTABLE/);
            await assert.rejects(f.edit(s => { delete s.artifacts[f.run.artifactId]; }), /ARTIFACT_IMMUTABLE/);
            await assert.rejects(f.edit(s => {
                const a = structuredClone(s.artifacts[f.run.artifactId]!);
                a.id = "new-corrupt"; a.draft.graph.nodes.a!.fields.title = "not declared";
                s.artifacts[a.id] = a;
            }), /STATE_INTENT_INVALID/);
            assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
            if (sqlite) {
                const reopened = createSqliteBackend(f.path);
                try { assert.deepEqual(await reopened.storage.read(f.draft.id), before); }
                finally { await reopened.storage.close(); }
            }
        } finally { await f.cleanup(); }
    });
}

test("sqlite: reopening independently corrupted intent data refuses it without rewriting the evidence", async () => {
    const f = await fixture(true);
    const db = new DatabaseSync(f.path);
    try {
        const row = db.prepare("SELECT body FROM sw_managed_drafts WHERE id=?").get(f.draft.id)!;
        const data = JSON.parse(row.body as string);
        data.draft.graph.nodes.a.fields.title = "corrupt outside the library";
        const damaged = JSON.stringify(data);
        db.prepare("UPDATE sw_managed_drafts SET body=? WHERE id=?").run(damaged, f.draft.id);
        const reopened = createSqliteBackend(f.path);
        try { await assert.rejects(reopened.storage.read(f.draft.id), /STATE_INTENT_INVALID/); }
        finally { await reopened.storage.close(); }
        assert.equal(db.prepare("SELECT body FROM sw_managed_drafts WHERE id=?").get(f.draft.id)!.body, damaged);
        db.prepare("UPDATE sw_managed_drafts SET body=? WHERE id=?").run(row.body as string, f.draft.id);
    } finally { db.close(); await f.cleanup(); }
});

test("sqlite: historical artifact corruption is still checked on read and transaction before the callback", async () => {
    const f = await fixture(true), db = new DatabaseSync(f.path);
    try {
        const row = db.prepare("SELECT body FROM sw_managed_artifacts WHERE id=?").get(f.run.artifactId)!;
        for (const baseline of [false, true]) {
            const data = JSON.parse(row.body as string);
            const snapshot = baseline ? data.draft.initialSnapshot : data.draft;
            snapshot.graph.nodes.a.fields.title = "external corruption";
            const damaged = JSON.stringify(data);
            db.prepare("UPDATE sw_managed_artifacts SET body=? WHERE id=?").run(damaged, f.run.artifactId);
            let invoked = false;
            await assert.rejects(f.backend.storage.read(f.draft.id), /STATE_INTENT_INVALID/);
            await assert.rejects(f.edit(() => { invoked = true; }), /STATE_INTENT_INVALID/);
            assert.equal(invoked, false);
            assert.equal(db.prepare("SELECT body FROM sw_managed_artifacts WHERE id=?").get(f.run.artifactId)!.body, damaged);
        }
        db.prepare("UPDATE sw_managed_artifacts SET body=? WHERE id=?").run(row.body as string, f.run.artifactId);
    } finally { db.close(); await f.cleanup(); }
});
