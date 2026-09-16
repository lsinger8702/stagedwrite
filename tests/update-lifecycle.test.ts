import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite, createMemoryBackend, createSqliteBackend, defineDraftType, type ManagedUpdateExecutor, type ManagedOptions, type Step } from "../src/index.js";
const def = defineDraftType({ id: "lifecycle", version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false } } }, relationTypes: {} });
const selector = { type: def.id, typeVersion: "1" };
async function setup(sqlite: boolean, count = 2, options: Partial<ManagedOptions> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "sw-update-live-"));
    const backend = sqlite ? createSqliteBackend(join(dir, "state.sqlite")) : createMemoryBackend();
    const remote = new Map<string, string>(), calls: { id: string; kind: string; key: string; title: string }[] = [];
    let rejectNode = "", loseNode = "";
    let inspectHook: ((signal: AbortSignal) => Promise<void>) | undefined;
    let applyHook: ((signal: AbortSignal) => Promise<void>) | undefined;
    const executor: ManagedUpdateExecutor = { ...selector, id: "writer", version: "1", target: "test", updateWrites: true,
        plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, payload: { title: n.fields.title as string }, effect: { kind: "create", nodeId: n.id } })),
        update: {
            inspect: async (d, { signal }) => { await inspectHook?.(signal); return ({ status: "complete", projections: Object.values(d.graph.nodes).map(n => ({ nodeId: n.id, projectionDigest: "v1", fields: { title: { path: "/title", writable: true, desired: { kind: "value", value: n.fields.title as string } } } })),
                observations: Object.keys(d.graph.nodes).map(id => ({ id: `obs:${id}`, nodeId: id, targetId: "test", remoteId: `remote:${id}`, projectionDigest: "v1", values: { title: { kind: "value", value: remote.get(id)! } }, observedAt: "2026-09-17T00:00:00Z", remoteVersion: remote.get(id)! })) }); },
            plan: (d, c) => Object.values(d.graph.nodes).map((n): Step => { const slot = c.slots.find(s => s.nodeId === n.id)!; return { id: n.id, payload: slot.kind === "update" ? { title: n.fields.title as string } : {}, effect: { kind: slot.kind, nodeId: n.id, remoteId: slot.remoteId } }; })
        },
        apply: async (step, key, { signal }) => {
            const title = step.payload.title as string; calls.push({ id: step.id, kind: step.effect.kind, key, title });
            if (step.effect.kind === "update" && rejectNode === step.id) return { kind: "not_applied", reason: "Rejected title", message: "Choose another title" };
            remote.set(step.id, title);
            if (step.effect.kind === "update") await applyHook?.(signal);
            if (step.effect.kind === "update" && loseNode === step.id) { loseNode = ""; return { kind: "unknown", reason: "Receipt lost" }; }
            return { kind: "applied", remoteRef: `remote:${step.id}`, confirmed: { projectionDigest: "v1", values: { title: { kind: "value", value: title } } } };
        },
        reconcile: async step => ({ kind: "applied", remoteRef: `remote:${step.id}`, confirmed: { projectionDigest: "v1", values: { title: { kind: "value", value: remote.get(step.id)! } } } })
    };
    const e = createStagedWrite({ definitions: [def], executors: [executor], ...backend, ...options });
    const { draft } = await e.create(selector, { roots: Array.from({ length: count }, () => ({ nodeType: "task", fields: { title: "A" } })) });
    const ids = Object.keys(draft.graph.nodes), check = await e.preflight(draft.id), first = await e.publish(draft.id, check.certificate!); assert.ok(first.id !== null);
    const edit = async (id: string, value: string) => e.edit(draft.id, (await e.getDraft(draft.id)).version, { patches: [{ op: "set", ref: id, scope: "canonical", path: "/title", value }] });
    return { e, backend, remote, calls, draft, ids, first, edit, onApply: (hook: ((signal: AbortSignal) => Promise<void>) | undefined) => { applyHook = hook; }, onInspect: (hook: ((signal: AbortSignal) => Promise<void>) | undefined) => { inspectHook = hook; }, reject: (id: string) => { rejectNode = id; }, lose: (id: string) => { loseNode = id; }, close: async () => { await e.close(); rmSync(dir, { recursive: true, force: true }); } };
}
for (const sqlite of [false, true]) {
    const label = sqlite ? "sqlite" : "memory";
    test(`${label}: public update and noop publication preserve identity and replay history`, async () => {
        const f = await setup(sqlite, 1);
        try {
            const bindings = await f.e.getBindings(f.draft.id);
            await f.edit(f.ids[0]!, "B");
            const check = await f.e.preflight(f.draft.id); assert.ok(check.certificate);
            const update = await f.e.publish(f.draft.id, check.certificate); assert.ok(update.id !== null);
            assert.equal(update.kind, "update"); assert.equal(update.state, "published"); assert.equal(f.remote.get(f.ids[0]!), "B");
            assert.notEqual(update.id, f.first.id); assert.notEqual(update.steps[0]!.key, f.first.steps[0]!.key);
            assert.deepEqual(await f.e.publish(f.draft.id, check.certificate), update);
            assert.deepEqual(await f.e.getBindings(f.draft.id), bindings);
            await f.edit(f.ids[0]!, "C");
            await f.e.edit(f.draft.id, (await f.e.getDraft(f.draft.id)).version, { patches: [{ op: "reset", ref: f.ids[0]!, scope: "canonical", path: "/title" }] });
            assert.equal((await f.e.getDraft(f.draft.id)).graph.nodes[f.ids[0]!]!.fields.title, "B");
            const noCheck = await f.e.preflight(f.draft.id), before = f.calls.length;
            await assert.rejects(f.e.publish(f.draft.id, noCheck.certificate!, { runId: "extra" }), /NOOP_RUN_ID_NOT_ALLOWED/);
            const noop = await f.e.publish(f.draft.id, noCheck.certificate!);
            assert.equal(noop.kind, "noop"); assert.equal(noop.id, null); assert.equal(noop.state, "published"); assert.equal(f.calls.length, before);
            assert.equal(Object.keys((await f.backend.storage.read(f.draft.id))!.runs).length, 2);
            assert.deepEqual(await f.e.publish(f.draft.id, noCheck.certificate!), noop);
            assert.equal((await f.e.resume(f.first.id)).isCurrentIntent, false);
            await f.edit(f.ids[0]!, "A"); const next = await f.e.preflight(f.draft.id);
            const back = await f.e.publish(f.draft.id, next.certificate!); assert.ok(back.id !== null);
            assert.equal(back.state, "published"); assert.equal(f.remote.get(f.ids[0]!), "A");
            assert.notEqual(back.steps[0]!.key, update.steps[0]!.key);
            assert.equal((await f.e.publish(f.draft.id, noCheck.certificate!)).isCurrentIntent, false);
        } finally { await f.close(); }
    });
    test(`${label}: public partial update repairs and resumes the same run`, async () => {
        const f = await setup(sqlite);
        try {
            for (const id of f.ids) await f.edit(id, "B"); f.reject(f.ids[1]!);
            const c = await f.e.preflight(f.draft.id), run = await f.e.publish(f.draft.id, c.certificate!); assert.ok(run.id !== null);
            assert.equal(run.state, "blocked");
            await assert.rejects(f.edit(f.ids[0]!, "C"), /APPLIED_STEP_IMMUTABLE/);
            await f.edit(f.ids[1]!, "C");
            const repeated = await f.e.publish(f.draft.id, "ignored"); assert.equal(repeated.id, run.id);
            f.reject(""); const resumed = await f.e.resume(run.id);
            assert.equal(resumed.state, "published", JSON.stringify(resumed.diagnostics));
            assert.equal(f.remote.get(f.ids[0]!), "B"); assert.equal(f.remote.get(f.ids[1]!), "C");
            assert.equal(f.calls.filter(c => c.id === f.ids[0] && c.kind === "update").length, 1);
        } finally { await f.close(); }
    });
    test(`${label}: public unknown update is reconciled before contradictory repair`, async () => {
        const f = await setup(sqlite, 1);
        try {
            await f.edit(f.ids[0]!, "B"); f.lose(f.ids[0]!);
            const c = await f.e.preflight(f.draft.id), run = await f.e.publish(f.draft.id, c.certificate!); assert.ok(run.id !== null);
            assert.equal(run.state, "unknown"); await f.edit(f.ids[0]!, "C");
            await assert.rejects(f.e.resume(run.id), /APPLIED_STEP_IMMUTABLE/);
            assert.equal(f.remote.get(f.ids[0]!), "B");
            await f.edit(f.ids[0]!, "B"); assert.equal((await f.e.resume(run.id)).state, "published");
            assert.equal(f.calls.filter(c => c.kind === "update").length, 1);
        } finally { await f.close(); }
    });
}
for (const sqlite of [false, true]) {
    const label = sqlite ? "sqlite" : "memory";
    test(`${label}: public pre-publish drift cannot adopt or write`, async () => {
        const f = await setup(sqlite, 1);
        try {
            await f.edit(f.ids[0]!, "B"); const check = await f.e.preflight(f.draft.id);
            f.remote.set(f.ids[0]!, "C"); const before = f.calls.length;
            const result = await f.e.publish(f.draft.id, check.certificate!);
            assert.equal(result.kind, "not_started"); assert.equal(result.id, null);
            assert.ok(result.diagnostics.some(d => d.code === "update.drift"));
            assert.equal(f.calls.length, before); assert.equal(Object.keys((await f.backend.storage.read(f.draft.id))!.runs).length, 1);
            f.remote.set(f.ids[0]!, "A"); assert.equal((await f.e.publish(f.draft.id, check.certificate!)).state, "published");
        } finally { await f.close(); }
    });
    for (const phase of ["adoption", "receipt", "completion", "noop"] as const) test(`${label}: public update recovers atomic ${phase} failure without duplicate effects`, async () => {
        const f = await setup(sqlite, 1);
        try {
            if (phase !== "noop") await f.edit(f.ids[0]!, "B");
            const check = await f.e.preflight(f.draft.id), original = f.backend.storage.transact.bind(f.backend.storage);
            let injected = false;
            f.backend.storage.transact = (id, lease, change) => original(id, lease, current => {
                const before = structuredClone(current!); const next = change(current);
                const active = next.draft.currentRunId && next.runs[next.draft.currentRunId];
                const old = active && before.runs[active.id];
                const hit = phase === "adoption" ? Object.keys(next.runs).length > Object.keys(before.runs).length :
                    phase === "noop" ? Object.keys(next.publications).some(k => !before.publications[k] && next.publications[k]!.kind === "noop") :
                    phase === "receipt" ? active && old && active.attempts.some((a, i) => a.status === "applied" && old.attempts[i]?.status === "pending") :
                    active && old && active.state === "published" && old.state !== "published";
                if (!injected && hit) { injected = true; throw Error(`injected-${phase}`); }
                return next;
            });
            await assert.rejects(f.e.publish(f.draft.id, check.certificate!), new RegExp(`injected-${phase}`)); assert.ok(injected);
            f.backend.storage.transact = original;
            const state = (await f.backend.storage.read(f.draft.id))!;
            if (phase === "adoption" || phase === "noop") {
                assert.equal(Object.keys(state.runs).length, 1);
                assert.equal(state.publications[check.certificate!], undefined);
                assert.equal((await f.e.publish(f.draft.id, check.certificate!)).state, "published");
            } else assert.equal((await f.e.resume(state.draft.currentRunId!)).state, "published");
            assert.equal(f.calls.filter(c => c.kind === "update").length, phase === "noop" ? 0 : 1);
            assert.equal(f.remote.get(f.ids[0]!), phase === "noop" ? "A" : "B");
        } finally { await f.close(); }
    });
}

for (const sqlite of [false, true]) test(`${sqlite ? "sqlite" : "memory"}: public publish holds one lease across update readback and dispatch`, async () => {
    const f = await setup(sqlite, 1);
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    try {
        await f.edit(f.ids[0]!, "B"); const c = await f.e.preflight(f.draft.id);
        f.onInspect(async () => { entered(); await waiting; });
        const work = f.e.publish(f.draft.id, c.certificate!);
        await started;
        await assert.rejects(f.e.publish(f.draft.id, c.certificate!), /DRAFT_BUSY/);
        await assert.rejects(f.edit(f.ids[0]!, "C"), /DRAFT_BUSY/);
        release(); assert.equal((await work).state, "published");
        assert.equal(f.calls.filter(c => c.kind === "update").length, 1);
    } finally { release(); await f.close(); }
});

for (const sqlite of [false, true]) {
    test(`${sqlite ? "sqlite" : "memory"}: timed out update read cannot dispatch after its late completion`, async () => {
        const f = await setup(sqlite, 1, { preflightTimeoutMs: 25 }); let release!: () => void, aborted = false;
        try {
            await f.edit(f.ids[0]!, "B"); const c = await f.e.preflight(f.draft.id);
            f.onInspect(signal => new Promise<void>(r => { release = r; signal.addEventListener("abort", () => { aborted = true; }); }));
            const result = await f.e.publish(f.draft.id, c.certificate!);
            assert.equal(result.kind, "not_started"); assert.ok(aborted);
            assert.ok(result.diagnostics.some(d => d.code === "rule.timeout"));
            release(); f.onInspect(undefined);
            assert.equal(f.calls.filter(c => c.kind === "update").length, 0);
            assert.equal((await f.e.publish(f.draft.id, c.certificate!)).state, "published");
        } finally { release?.(); await f.close(); }
    });
    for (const stage of ["read", "apply"] as const) test(`${sqlite ? "sqlite" : "memory"}: lost lease during update ${stage} preserves the original run and effects`, async () => {
        const f = await setup(sqlite, 1, { leaseTtlMs: 60 });
        const acquire = f.backend.locks.acquire.bind(f.backend.locks);
        try {
            await f.edit(f.ids[0]!, "B"); const c = await f.e.preflight(f.draft.id);
            f.backend.locks.acquire = async (...args) => { const lease = await acquire(...args); if (!lease) return null; return { ...lease, renew: async () => { await lease.release(); return false; } }; };
            const pause = (signal: AbortSignal) => new Promise<void>(r => { if (signal.aborted) r(); else signal.addEventListener("abort", () => r(), { once: true }); });
            if (stage === "read") f.onInspect(pause); else f.onApply(pause);
            await assert.rejects(f.e.publish(f.draft.id, c.certificate!), /LEASE_LOST/);
            f.backend.locks.acquire = acquire; f.onInspect(undefined); f.onApply(undefined);
            if (stage === "read") {
                assert.equal(f.calls.filter(c => c.kind === "update").length, 0);
                assert.equal((await f.e.publish(f.draft.id, c.certificate!)).state, "published");
            } else {
                const d = await f.e.getDraft(f.draft.id);
                assert.equal((await f.e.resume(d.currentRunId!)).state, "published");
            }
            assert.equal(f.calls.filter(c => c.kind === "update").length, 1);
        } finally { f.backend.locks.acquire = acquire; await f.close(); }
    });
}
