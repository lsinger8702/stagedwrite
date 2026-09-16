import { compileUpdate } from "../src/managed/update-plan.js";
import { updateRequest, updateOutcome, updateContext, satisfyNoop } from "../src/managed/update-evidence.js";
import { definitionDigest, type Json } from "../src/registry/json.js";
import { rememberRefs, nodeRef } from "./fixtures/refs.js";
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
const executor: ManagedExecutor = { ...selector, id: "storage.executor", version: "1", target: "test", plan: d => Object.values(d.graph.nodes).map(n => ({ id: "a", payload: n.fields as Record<string, import("../src/index.js").Value>, effect: { kind: "create", nodeId: n.id } })), apply: async s => ({ kind: "applied", remoteRef: `remote:${s.id}`, confirmed: { projectionDigest: "title-v1", values: { title: { kind: "value", value: "A" } } } }), reconcile: { unsupported: "test" } };
async function fixture(sqlite: boolean, implementation = executor, count = 1) {
    const dir = mkdtempSync(join(tmpdir(), "sw-model-")), path = join(dir, "state.sqlite");
    const backend = sqlite ? createSqliteBackend(path) : createMemoryBackend();
    const engine = createStagedWrite({ definitions: [definition], executors: [implementation], ...backend });
    const draft = rememberRefs(await engine.create(selector, { roots: Array.from({ length: count }, () => ({ nodeType: "task", fields: { title: "A" } })) }), count === 1 ? ["a"] : ["a", "b"]);
    const check = await engine.preflight(draft.id);
    const run = await engine.publish(draft.id, check.certificate!);
    const lease = await backend.locks.acquire(lockResource(backend.storage.namespace, draft.id), { ttlMs: 60_000 });
    assert.ok(lease);
    const edit = (fn: (s: ManagedState) => void) => backend.storage.transact(draft.id, lease, s => { assert.ok(s); fn(s); return s; });
    const cleanup = async () => { await lease.release(); await engine.close(); rmSync(dir, { recursive: true, force: true }); };
    return { backend, engine, draft, run, edit, cleanup, path, lease };
}
function addUpdate(s: ManagedState, id: string) {
    const original = s.runs[s.draft.currentRunId!]!;
    const nodes = Object.values(s.draft.graph.nodes);
    const compilation = compileUpdate(s, nodes.map(n => ({ nodeId: n.id, projectionDigest: "title-v1", fields: { title: { path: "/title", writable: true, desired: { kind: "value", value: n.fields.title as string } } } })),
        nodes.map(n => ({ id: `read:${id}:${n.id}`, nodeId: n.id, targetId: "test", remoteId: s.bindings[n.id]!.remoteId, projectionDigest: "title-v1", values: structuredClone(s.remoteFacts[s.latestFactByNode[n.id]!]!.values), observedAt: "2026-09-17T00:00:00Z", remoteVersion: "v1" })));
    assert.equal(compilation.status, "passed"); if (compilation.status !== "passed") throw Error("fixture compilation failed");
    const plan = original.steps.map((step): import("../src/types.js").Step => { const slot = compilation.slots.find(slot => slot.nodeId === step.effect.nodeId)!;
        return { id: step.id, ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}), ...(slot.kind === "update" && step.inputRefs ? { inputRefs: step.inputRefs } : {}), payload: slot.kind === "update" ? { title: s.draft.graph.nodes[slot.nodeId]!.fields.title as string } : {}, effect: { kind: slot.kind, nodeId: slot.nodeId, remoteId: slot.remoteId } }; });
    const artifactId = `${id}:artifact`, source = s.artifacts[original.artifactId]!;
    s.artifacts[artifactId] = { ...structuredClone(source), id: artifactId, draft: structuredClone(s.draft), plan, update: compilation,
        intentDigest: definitionDigest({ graph: s.draft.graph, fieldIntents: s.draft.fieldIntents } as unknown as Json), resourceRevision: s.resourceRevision,
        binding: { ...source.binding, planDigest: definitionDigest(plan as unknown as Json) } };
    s.runs[id] = { ...structuredClone(original), id, kind: "update", state: "blocked", artifactId, initialArtifactId: artifactId, certificate: artifactId,
        version: s.draft.version, attempts: [], events: [], revisions: [], steps: plan.map(step => ({ ...step, key: `${id}:${step.id}`, status: "ready" })) };
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
                s.remoteFacts.fact1 = { id: "fact1", nodeId: nodeRef(f.draft, "a"), targetId: "test", remoteId: "remote:a", projectionDigest: "title-v1", values: { title: { kind: "value", value: "A" } }, source: { kind: "attempt", runId: f.run.id, stepId: "a", attemptNumber: 1 }, confirmedAt: "2026-09-16T00:00:00Z" };
                s.latestFactByNode[nodeRef(f.draft, "a")] = "fact1"; s.resourceRevision++;
            });
            const before = await f.backend.storage.read(f.draft.id);
            assert.deepEqual(await f.engine.getBindings(f.draft.id), original);
            await assert.rejects(f.edit(s => { s.remoteFacts.fact1!.values.title = { kind: "value", value: "corrupt" }; }), /FACT_IMMUTABLE|FACT_EVIDENCE_MISSING/);
            await assert.rejects(f.edit(s => { s.latestFactByNode[nodeRef(f.draft, "a")] = "missing"; }), /LATEST_FACT_MISMATCH/);
            await assert.rejects(f.edit(s => { s.bindings[nodeRef(f.draft, "a")]!.remoteId = "another"; }), /BINDING_IMMUTABLE|FACT_IDENTITY/);
            await assert.rejects(f.edit(s => { s.remoteFacts.fact2 = { ...s.remoteFacts.fact1!, id: "fact2" }; s.latestFactByNode[nodeRef(f.draft, "a")] = "fact2"; }), /FACT_REVISION_REQUIRED/);
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
            await assert.rejects(f.engine.edit(f.draft.id, 0, { patches: [{ op: "set", ref: nodeRef(f.draft, "a"), scope: "canonical", path: "/title", value: "B" }] }), /DRAFT_BUSY/);
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
                s => { s.draft.graph.nodes[nodeRef(f.draft, "a")]!.fields.title = "not declared"; },
                s => { s.draft.fieldIntents.ghost = { "/title": { kind: "remove" } }; },
                s => { s.draft.fieldIntents[nodeRef(f.draft, "a")]!["/title/child"] = { kind: "remove" }; },
                s => { s.draft.fieldIntents[nodeRef(f.draft, "a")]!["/title"] = { kind: "remove" }; },
                s => { s.draft.graph.edges.bad = { id: "bad", relationType: "uses", from: "a", to: "missing" }; }
            ];
            for (const corrupt of corruptions) {
                await assert.rejects(f.edit(corrupt), /STATE_INTENT_INVALID/);
                assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
            }
            await assert.rejects(f.edit(s => { s.draft.initialSnapshot.graph.nodes[nodeRef(f.draft, "a")]!.fields.title = "corrupt baseline"; }), /INITIAL_SNAPSHOT_IMMUTABLE/);
            await assert.rejects(f.edit(s => { s.artifacts[f.run.artifactId]!.draft.graph.nodes[nodeRef(f.draft, "a")]!.fields.title = "corrupt artifact"; }), /ARTIFACT_IMMUTABLE/);
            await assert.rejects(f.edit(s => { delete s.artifacts[f.run.artifactId]; }), /ARTIFACT_IMMUTABLE/);
            await assert.rejects(f.edit(s => {
                const a = structuredClone(s.artifacts[f.run.artifactId]!);
                a.id = "new-corrupt"; a.draft.graph.nodes[nodeRef(f.draft, "a")]!.fields.title = "not declared";
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
        data.draft.graph.nodes[nodeRef(f.draft, "a")].fields.title = "corrupt outside the library";
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
            snapshot.graph.nodes[nodeRef(f.draft, "a")].fields.title = "external corruption";
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


for (const sqlite of [false, true]) test(`${sqlite ? "sqlite" : "memory"}: update evidence pins historical facts and the original request`, async () => {
    const f = await fixture(sqlite), ref = nodeRef(f.draft, "a");
    try {
        await f.edit(s => {
            s.draft.graph.nodes[ref]!.fields.title = "B"; s.draft.fieldIntents[ref]!["/title"] = { kind: "set", value: "B" }; s.draft.version++;
            s.draft.status = "pending"; addUpdate(s, "update-1");
        });
        const before = (await f.backend.storage.read(f.draft.id))!;
        const artifact = before.artifacts[before.runs["update-1"]!.artifactId]!;
        const request = updateRequest(artifact, "a", before.bindings);
        assert.equal(request.step.effect.kind, "update"); assert.equal(request.step.payload.title, "B");
        assert.equal(request.update!.observationId, artifact.update!.context.observations[0]!.id);
        const addAttempt = (s: ManagedState) => {
            const run = s.runs["update-1"]!;
            run.attempts.push({ stepId: "a", key: run.steps[0]!.key, number: 1, input: structuredClone(request.step.payload), request: structuredClone(request), status: "unknown" });
            run.state = "unknown"; run.steps[0]!.status = "unknown";
        };
        for (const mutate of [
            (s: ManagedState) => { delete s.runs["update-1"]!.attempts[0]!.request.update; },
            (s: ManagedState) => { s.runs["update-1"]!.attempts[0]!.request.update!.observationId = "unrelated"; },
            (s: ManagedState) => { s.runs["update-1"]!.attempts[0]!.request.step.payload.title = "C"; s.runs["update-1"]!.attempts[0]!.input.title = "C"; },
        ]) {
            await assert.rejects(f.edit(s => { addAttempt(s); mutate(s); }), /UPDATE_REQUEST_/);
            assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
        }
        await f.edit(addAttempt);
        const saved = (await f.backend.storage.read(f.draft.id))!;
        await assert.rejects(f.edit(s => { s.artifacts[artifact.id]!.update!.context.observations[0]!.remoteVersion = "v2"; }), /ARTIFACT_IMMUTABLE/);
        await assert.rejects(f.edit(s => { s.runs["update-1"]!.attempts[0]!.request.update!.observationId = "new"; }), /ATTEMPT_IMMUTABLE/);
        assert.deepEqual(await f.backend.storage.read(f.draft.id), saved);
        await f.edit(s => { s.draft.version++; s.draft.graph.nodes[ref]!.fields.title = "C"; s.draft.fieldIntents[ref]!["/title"] = { kind: "set", value: "C" }; });
        if (sqlite) {
            const reopened = createSqliteBackend(f.path);
            try {
                const stored = (await reopened.storage.read(f.draft.id))!;
                assert.equal(stored.draft.graph.nodes[ref]!.fields.title, "C");
                assert.deepEqual(stored.runs["update-1"]!.attempts[0]!.request, request);
                assert.equal(stored.artifacts[artifact.id]!.update!.context.observations[0]!.remoteVersion, "v1");
            } finally { await reopened.storage.close(); }
        }
    } finally { await f.cleanup(); }
});


for (const sqlite of [false, true]) test(`${sqlite ? "sqlite" : "memory"}: new update artifacts cannot omit or contradict their pinned evidence`, async () => {
    const f = await fixture(sqlite);
    try {
        const before = await f.backend.storage.read(f.draft.id);
        for (const damage of [
            (a: import("../src/managed/types.js").Artifact) => { delete a.update; },
            (a: import("../src/managed/types.js").Artifact) => { a.update!.context.version++; },
            (a: import("../src/managed/types.js").Artifact) => { a.update!.slots[0]!.factId = "missing"; },
            (a: import("../src/managed/types.js").Artifact) => { a.update!.context.observations[0]!.remoteId = "another-resource"; },
            (a: import("../src/managed/types.js").Artifact) => { a.observations = []; },
            (a: import("../src/managed/types.js").Artifact) => { a.binding.planDigest = "tampered"; },
        ]) {
            await assert.rejects(f.edit(s => { addUpdate(s, "bad"); damage(s.artifacts["bad:artifact"]!); }), /UPDATE_|RUN_ARTIFACT_KIND_MISMATCH/);
            assert.deepEqual(await f.backend.storage.read(f.draft.id), before);
        }
    } finally { await f.cleanup(); }
});

test("sqlite: corrupted historical update conditions reject reads without rewriting the evidence", async () => {
    const f = await fixture(true), db = new DatabaseSync(f.path);
    try {
        await f.edit(s => addUpdate(s, "update-1"));
        const row = db.prepare("SELECT body FROM sw_managed_artifacts WHERE id=?").get("update-1:artifact")!;
        const artifact = JSON.parse(row.body as string);
        artifact.update.context.observations[0].values.title = { kind: "value", value: "corrupt" };
        const damaged = JSON.stringify(artifact);
        db.prepare("UPDATE sw_managed_artifacts SET body=? WHERE id=?").run(damaged, "update-1:artifact");
        const reopened = createSqliteBackend(f.path);
        try {
            await assert.rejects(reopened.storage.read(f.draft.id), /UPDATE_ARTIFACT_COMPILATION_MISMATCH/);
            let called = false;
            await assert.rejects(f.edit(() => { called = true; }), /UPDATE_ARTIFACT_COMPILATION_MISMATCH/);
            assert.equal(called, false);
            assert.equal(db.prepare("SELECT body FROM sw_managed_artifacts WHERE id=?").get("update-1:artifact")!.body, damaged);
        } finally { await reopened.storage.close(); }
        db.prepare("UPDATE sw_managed_artifacts SET body=? WHERE id=?").run(row.body as string, "update-1:artifact");
    } finally { db.close(); await f.cleanup(); }
});

for (const sqlite of [false, true]) test(`${sqlite ? "sqlite" : "memory"}: update receipts require original identity and complete confirmed values`, async () => {
    const f = await fixture(sqlite);
    try {
        await f.edit(s => {
            const node = Object.values(s.draft.graph.nodes)[0]!;
            node.fields.title = "B";
            s.draft.fieldIntents[node.id]!["/title"] = { kind: "set", value: "B" };
            s.draft.version++;
            addUpdate(s, "receipt-update");
        });
        const s = (await f.backend.storage.read(f.draft.id))!, r = s.runs["receipt-update"]!;
        const request = updateRequest(s.artifacts[r.artifactId]!, "a", s.bindings);
        const attempt: import("../src/managed/types.js").Attempt = { stepId: "a", key: r.steps[0]!.key, number: 1, input: request.step.payload, request, status: "pending" };
        const good = { kind: "applied" as const, remoteRef: "remote:a", confirmed: { projectionDigest: "title-v1", values: { title: { kind: "value" as const, value: "B" } } } };
        assert.deepEqual(updateOutcome(s, attempt, good), good);
        const invalidReceipts: import("../src/types.js").ApplyOutcome[] = [
            { kind: "applied" as const, remoteRef: "remote:a" },
            { ...good, remoteRef: "other" },
            { ...good, confirmed: { ...good.confirmed, projectionDigest: "other" } },
            { ...good, confirmed: { ...good.confirmed, values: {} } },
            { ...good, confirmed: { ...good.confirmed, values: { title: { kind: "value" as const, value: "A" } } } },
            { ...good, confirmed: { ...good.confirmed, values: { title: { kind: "absent" as const } } } },
        ];
        for (const bad of invalidReceipts) {
            const result = updateOutcome(s, attempt, bad);
            assert.equal(result.kind, "unknown");
            assert.ok(result.message && result.diagnostics?.[0]?.hint);
            await assert.rejects(f.edit(next => { next.runs[r.id]!.attempts.push({ ...structuredClone(attempt), status: "applied", outcome: bad }); }), /UPDATE_RECEIPT_MISMATCH/);
        }
        const unknown = { kind: "unknown" as const, reason: "timeout" };
        assert.deepEqual(updateOutcome(s, attempt, unknown), unknown);
        await f.edit(next => { next.runs[r.id]!.attempts.push({ ...structuredClone(attempt), status: "applied", outcome: good }); });
        assert.deepEqual((await f.backend.storage.read(f.draft.id))!.bindings, s.bindings);
    } finally { await f.cleanup(); }
});

for (const sqlite of [false, true]) test(`${sqlite ? "sqlite" : "memory"}: shared resume reconciles update without overwriting creation binding`, async () => {
    let correct = false;
    const seen: { step: import("../src/types.js").Step; key: string }[] = [];
    const f = await fixture(sqlite, { ...executor, reconcile: async (step, key, context) => {
        assert.equal(context.update?.observation.remoteVersion, "v1");
        assert.equal(context.update?.observation.values.title?.kind, "value");
        assert.ok(Object.isFrozen(context.update?.observation.values));
        assert.throws(() => { context.update!.observation.values.title = { kind: "absent" }; }, TypeError);
        seen.push({ step: structuredClone(step), key });
        return { kind: "applied", remoteRef: "remote:a", ...(correct ? { confirmed: { projectionDigest: "title-v1", values: { title: { kind: "value" as const, value: "B" } } } } : {}) };
    } });
    try {
        const bindings = await f.engine.getBindings(f.draft.id);
        await f.edit(s => {
            const node = Object.values(s.draft.graph.nodes)[0]!;
            node.fields.title = "B"; s.draft.fieldIntents[node.id]!["/title"] = { kind: "set", value: "B" }; s.draft.version++;
            addUpdate(s, "resume-update");
            const r = s.runs["resume-update"]!, request = updateRequest(s.artifacts[r.artifactId]!, "a", s.bindings);
            r.attempts.push({ stepId: "a", key: r.steps[0]!.key, number: 1, input: request.step.payload, request, status: "unknown" });
            r.steps[0]!.status = "unknown"; r.state = "unknown";
        });
        await f.lease.release();
        const first = await f.engine.resume("resume-update");
        assert.equal(first.state, "unknown");
        assert.equal(first.attempts[0]!.outcome?.code, "UPDATE_RECEIPT_MISMATCH");
        assert.deepEqual(await f.engine.getBindings(f.draft.id), bindings);
        correct = true;
        const second = await f.engine.resume("resume-update");
        assert.equal(second.state, "published");
        assert.equal(second.attempts.length, 1);
        assert.deepEqual(seen[0], seen[1]);
        assert.equal(seen[0]!.step.payload.title, "B");
        assert.deepEqual(await f.engine.getBindings(f.draft.id), bindings);
        const state = (await f.backend.storage.read(f.draft.id))!;
        const fact = state.remoteFacts[state.latestFactByNode[nodeRef(f.draft, "a")]!]!;
        assert.deepEqual(fact.values.title, { kind: "value", value: "B" });
        assert.equal(fact.source.kind, "attempt");
    } finally { await f.cleanup(); }
});

for (const sqlite of [false, true]) test(`${sqlite ? "sqlite" : "memory"}: noop completion is durable observation evidence with no attempt`, async () => {
    let creates = 0;
    const f = await fixture(sqlite, { ...executor, apply: async (...args) => { creates++; return executor.apply(...args); } });
    try {
        await f.edit(s => addUpdate(s, "noop-slots"));
        const initial = (await f.backend.storage.read(f.draft.id))!;
        await assert.rejects(f.edit(s => { s.runs["noop-slots"]!.steps[0]!.status = "satisfied"; }), /NOOP_COMPLETION_INVALID/);
        await assert.rejects(f.edit(s => { s.runs["noop-slots"]!.steps[0]!.status = "applied"; }), /NOOP_COMPLETION_INVALID/);
        await assert.rejects(f.edit(s => {
            s.runs["noop-slots"]!.steps[0]!.dependsOn = ["missing"];
            satisfyNoop(s, "noop-slots", "a", "2026-09-17T00:00:01Z");
        }), /DEPENDENCY_NOT_APPLIED/);
        await assert.rejects(f.edit(s => {
            satisfyNoop(s, "noop-slots", "a", "2026-09-17T00:00:01Z");
            throw Error("injected commit failure");
        }), /injected commit failure/);
        assert.deepEqual(await f.backend.storage.read(f.draft.id), initial);
        await f.edit(s => satisfyNoop(s, "noop-slots", "a", "2026-09-17T00:00:01Z"));
        const completed = (await f.backend.storage.read(f.draft.id))!;
        const step = completed.runs["noop-slots"]!.steps[0]!;
        assert.equal(step.status, "satisfied");
        assert.equal(step.remoteRef, "remote:a");
        assert.equal(completed.runs["noop-slots"]!.attempts.length, 0);
        assert.equal(completed.remoteFacts[step.satisfaction!.factId]!.source.kind, "observation");
        assert.equal(completed.resourceRevision, initial.resourceRevision + 1);
        assert.deepEqual(completed.bindings, initial.bindings);
        await f.edit(s => satisfyNoop(s, "noop-slots", "a", "2026-09-17T00:00:02Z"));
        assert.deepEqual(await f.backend.storage.read(f.draft.id), completed);
        await assert.rejects(f.edit(s => { s.runs["noop-slots"]!.steps[0]!.status = "ready"; }), /SATISFIED_STEP_IMMUTABLE/);
        await assert.rejects(f.edit(s => { s.runs["noop-slots"]!.steps[0]!.satisfaction!.observationId = "wrong"; }), /SATISFIED_STEP_IMMUTABLE/);
        if (sqlite) {
            const reopened = createSqliteBackend(f.path);
            try { assert.deepEqual(await reopened.storage.read(f.draft.id), completed); } finally { await reopened.storage.close(); }
        }
        await f.lease.release();
        const result = await f.engine.resume("noop-slots");
        assert.equal(result.state, "published");
        assert.equal(creates, 1); // Only the real fixture's initial create used the adapter.
        assert.equal(result.attempts.length, 0);
    } finally { await f.cleanup(); }
});

test("original update adapter conditions are independent of later draft edits", async () => {
    const f = await fixture(false);
    try {
        await f.edit(s => {
            const node = Object.values(s.draft.graph.nodes)[0]!;
            node.fields.title = "B"; s.draft.fieldIntents[node.id]!["/title"] = { kind: "set", value: "B" }; s.draft.version++;
            addUpdate(s, "context-update");
        });
        const s = (await f.backend.storage.read(f.draft.id))!, r = s.runs["context-update"]!;
        const request = updateRequest(s.artifacts[r.artifactId]!, "a", s.bindings);
        const attempt: import("../src/managed/types.js").Attempt = { stepId: "a", key: "key", number: 1, request, input: request.step.payload, status: "unknown" };
        const context = updateContext(s, attempt)!;
        s.draft.graph.nodes[nodeRef(f.draft, "a")]!.fields.title = "C";
        assert.deepEqual(updateContext(s, attempt), context);
        assert.equal(context.observation.remoteVersion, "v1");
        assert.notEqual(context.observation, s.artifacts[r.artifactId]!.update!.context.observations[0]);
        attempt.request.update!.observationId = "missing";
        assert.throws(() => updateContext(s, attempt), /UPDATE_REQUEST_EVIDENCE_MISMATCH/);
    } finally { await f.cleanup(); }
});

for (const sqlite of [false, true]) test(`${sqlite ? "sqlite" : "memory"}: update resumes after a satisfied dependency using its existing binding`, async () => {
    let calls = 0;
    const f = await fixture(sqlite, { ...executor,
        plan: d => Object.values(d.graph.nodes).map((node, i) => ({ id: i ? "b" : "a", payload: { title: "A" },
            ...(i ? { dependsOn: ["a"], inputRefs: { parent: "a" } } : {}), effect: { kind: "create", nodeId: node.id } })),
        reconcile: async (step, _key, context) => {
            calls++; assert.equal(step.id, "b"); assert.equal(step.payload.parent, "remote:a");
            assert.equal(context.update!.observation.remoteId, "remote:b");
            return { kind: "applied", remoteRef: "remote:b", confirmed: { projectionDigest: "title-v1", values: { title: { kind: "value", value: "B" } } } };
        }
    }, 2);
    try {
        const bindings = await f.engine.getBindings(f.draft.id);
        await f.edit(s => {
            const id = nodeRef(f.draft, "b");
            s.draft.graph.nodes[id]!.fields.title = "B";
            s.draft.fieldIntents[id]!["/title"] = { kind: "set", value: "B" }; s.draft.version++;
            addUpdate(s, "mixed-update");
            satisfyNoop(s, "mixed-update", "a", "2026-09-17T00:00:01Z");
            const r = s.runs["mixed-update"]!, request = updateRequest(s.artifacts[r.artifactId]!, "b", s.bindings);
            r.attempts.push({ stepId: "b", key: r.steps[1]!.key, number: 1, request, input: request.step.payload, status: "unknown" });
            r.steps[1]!.status = "unknown"; r.state = "unknown";
        });
        await f.lease.release();
        const result = await f.engine.resume("mixed-update");
        assert.equal(result.state, "published"); assert.equal(calls, 1);
        assert.deepEqual(result.steps.map(s => s.status), ["satisfied", "applied"]);
        assert.equal(result.attempts.length, 1);
        assert.deepEqual(await f.engine.getBindings(f.draft.id), bindings);
    } finally { await f.cleanup(); }
});
