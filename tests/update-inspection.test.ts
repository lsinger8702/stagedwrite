import { rememberRefs, nodeRef } from "./fixtures/refs.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, createMemoryBackend, defineDraftType, type ManagedUpdateInspector, type ManagedOptions } from "../src/index.js";
const definition = defineDraftType({ id: "inspect.tasks", version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false } } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: "1" };
const complete = (d: import("../src/index.js").ManagedDraft, title = "A") => ({ status: "complete" as const,
    projections: [{ nodeId: nodeRef(d, "a"), projectionDigest: "v1", fields: { title: { path: "/title", writable: true, desired: { kind: "value" as const, value: "A" } } } }],
    observations: [{ id: "read", nodeId: nodeRef(d, "a"), targetId: "test", remoteId: "remote-a", projectionDigest: "v1", values: { title: { kind: "value" as const, value: title } }, observedAt: "2026-09-16T00:00:00.000Z" }],
});
async function setup(inspect: ManagedUpdateInspector["inspect"], overrides: Partial<ManagedOptions> = {}, plan?: ManagedUpdateInspector["plan"]) {
    const backend = createMemoryBackend();
    const e = createStagedWrite({ definitions: [definition], ...backend, ...overrides, executors: [{ ...selector, id: "task.executor", version: "1", target: "test",
        update: { inspect, ...(plan ? { plan } : {}) }, plan: d => [{ id: "a", payload: { title: "A" }, effect: { kind: "create", nodeId: nodeRef(d, "a") } }],
        apply: async () => ({ kind: "applied", remoteRef: "remote-a", confirmed: { projectionDigest: "v1", values: { title: { kind: "value", value: "A" } } } }), reconcile: { unsupported: "not implemented" },
    }] });
    const draft = rememberRefs(await e.create(selector, { roots: [{ nodeType: "task", fields: { title: "A" } }] }), ["a"]);
    const check = await e.preflight(draft.id); await e.publish(draft.id, check.certificate!);
    return { e, draft, backend };
}
test("update inspection: real preflight returns a full preview and noop diff without execution authority", async () => {
    let calls = 0;
    const { e, draft, backend } = await setup(async (d, c) => {
        calls++; assert.ok(Object.isFrozen(d)); assert.ok(Object.isFrozen(c.bindings)); assert.equal(c.bindings[nodeRef(d, "a")]!.remoteId, "remote-a"); return complete(d);
    });
    try {
        assert.equal(calls, 0); // Initial create path does not invoke update inspection.
        const before = await backend.storage.read(draft.id);
        const check = await e.preflight(draft.id);
        assert.equal(check.status, "passed"); assert.equal(check.scope, "draft"); assert.equal(check.certificate, undefined);
        assert.equal(check.updatePreview!.slots[0]!.kind, "noop"); assert.ok(check.preview.nodes[nodeRef(draft, "a")]);
        await e.preflight(draft.id); assert.equal(calls, 2);
        const after = await backend.storage.read(draft.id);
        assert.deepEqual(after!.remoteFacts, before!.remoteFacts); assert.equal(after!.resourceRevision, before!.resourceRevision);
        assert.deepEqual(after!.artifacts, before!.artifacts);
        await assert.rejects(e.edit(draft.id, 0, { patches: [{ op: "set", ref: nodeRef(draft, "a"), scope: "canonical", path: "/title", value: "B" }] }), /UPDATE_NOT_SUPPORTED/);
    } finally { await e.close(); }
});
test("update inspection: pending can be retried and drift carries concrete observed values", async () => {
    let pending = true;
    const { e, draft } = await setup(async d => pending ? { status: "pending", message: "Remote snapshot is still processing", retryAfterSeconds: 2 } : complete(d, "external"));
    try {
        const first = await e.preflight(draft.id); assert.equal(first.status, "pending"); assert.equal(first.pendingRules![0]!.retryAfterSeconds, 2); assert.ok(first.preview.nodes[nodeRef(draft, "a")]); assert.equal(first.certificate, undefined);
        pending = false;
        const next = await e.preflight(draft.id); assert.equal(next.status, "blocked"); assert.equal(next.diagnostics[0]!.code, "update.drift"); assert.deepEqual(next.diagnostics[0]!.metadata!.observed, { kind: "value", value: "external" });
    } finally { await e.close(); }
});
test("update inspection: timeout aborts and ignores late results", async () => {
    let signal: AbortSignal | undefined, finish!: (v: ReturnType<typeof complete>) => void;
    const { e, draft } = await setup(async (_d, c) => { signal = c.signal; return new Promise(resolve => { finish = resolve; }); }, { preflightTimeoutMs: 25 });
    try {
        const check = await e.preflight(draft.id); assert.equal(check.status, "incomplete"); assert.equal(signal!.aborted, true); assert.equal(check.certificate, undefined);
        finish(complete(draft)); await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal((await e.getCheck(draft.id)).status, "incomplete"); assert.equal((await e.getCheck(draft.id)).updatePreview, undefined);
    } finally { await e.close(); }
});
test("update inspection: invalid pending and invalid diagnostics cannot become passed", async () => {
    let bad = true;
    const { e, draft } = await setup(async d => bad ? { status: "pending", message: "" } : { ...complete(d), diagnostics: [{ code: "bad", path: "not-a-pointer", message: "invalid" }] });
    try {
        assert.equal((await e.preflight(draft.id)).status, "incomplete"); bad = false;
        const c = await e.preflight(draft.id); assert.equal(c.status, "incomplete"); assert.equal(c.updatePreview, undefined);
    } finally { await e.close(); }
});
test("update inspection: concurrent check supersedes old remote result", async () => {
    let release!: (v: ReturnType<typeof complete>) => void, entered!: () => void, calls = 0;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const { e, draft } = await setup(async d => { if (++calls === 1) { entered(); return new Promise(resolve => { release = resolve; }); } return complete(d); });
    try {
        const stale = e.preflight(draft.id); const rejected = assert.rejects(stale, /STALE_CHECK/); await started;
        const fresh = await e.preflight(draft.id); release(complete(draft, "late")); await rejected;
        assert.equal((await e.getCheck(draft.id)).checkId, fresh.checkId);
    } finally { await e.close(); }
});

test("update inspection: optional mapper previews the shared plan but grants no publication certificate", async () => {
    const { e, draft } = await setup(async d => complete(d), {}, (draft, compiled) => {
        assert.ok(Object.isFrozen(draft)); assert.ok(Object.isFrozen(compiled));
        return [{ id: "a", payload: {}, effect: { kind: "noop", nodeId: nodeRef(draft, "a"), remoteId: compiled.slots[0]!.remoteId } }];
    });
    try { const c = await e.preflight(draft.id); assert.equal(c.status, "passed"); assert.equal(c.updatePreview!.plan![0]!.effect.kind, "noop"); assert.equal(c.certificate, undefined); }
    finally { await e.close(); }
});
