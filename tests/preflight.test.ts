import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, createMemoryBackend, defineDraftType, type ManagedRule, type GraphDiagnostic, type ManagedOptions } from "../src/index.js";
const definition = defineDraftType({ id: "example.check", version: "1", nodeTypes: { project: { valueSchema: { type: "object", properties: { capacity: { type: "number", minimum: 0 }, note: { type: ["string", "null"] } }, additionalProperties: false }, requiredAtPublish: ["capacity", "note"] } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: definition.version };
const rule = (check: ManagedRule["check"], version = "1"): ManagedRule => ({ ...selector, id: "capacity-policy", version, check });
const initial = (fields: Record<string, string | number | null> = { capacity: 20, note: null }) => ({ nodes: { "c/1": { id: "c/1", nodeType: "project", fields } }, edges: {} });
async function setup(rules: ManagedRule[] = [], options: Partial<ManagedOptions> = {}) { const engine = createStagedWrite({ definitions: [definition], rules, ...options }), draft = await engine.create(selector, initial()); return { engine, draft }; }
const suggestion: GraphDiagnostic = { code: "capacity.limit", path: "/nodes/c~11/fields/capacity", message: "Capacity exceeds the example limit.", hint: "Choose a capacity according to user intent.", candidates: [{ value: 8, message: "An option, not a required choice.", repairOps: { patches: [{ op: "set", ref: "c/1", scope: "canonical", path: "/capacity", value: 8 }] } }], related: ["/nodes/c~11/fields/note"] };
test("preflight: missing fields and explicit clearing are diagnosed; reset restores the original null", async () => {
    const { engine, draft } = await setup(), missing = await engine.create(selector, initial({})), check = await engine.preflight(missing.id);
    assert.equal(check.status, "blocked");
    assert.deepEqual(check.diagnostics.map(d => d.path), ["/nodes/c~11/fields/capacity", "/nodes/c~11/fields/note"]);
    assert.deepEqual(check.preview.nodes["c/1"]!.fields, { "/capacity": { kind: "undeclared" }, "/note": { kind: "undeclared" } });
    assert.equal((await engine.preflight(draft.id)).status, "passed");
    await engine.edit(draft.id, 0, { patches: [{ op: "remove", ref: "c/1", scope: "canonical", path: "/note" }] });
    assert.equal((await engine.preflight(draft.id)).status, "blocked");
    await engine.edit(draft.id, 1, { patches: [{ op: "reset", ref: "c/1", scope: "canonical", path: "/note" }] });
    assert.equal((await engine.preflight(draft.id)).status, "passed");
    assert.deepEqual((await engine.getDraft(draft.id)).fieldIntents["c/1"]!["/note"], { kind: "set", value: null });
    await engine.close();
});
test("preflight: concrete diagnoses are advisory and caller-selected OPs require a new check", async () => {
    const { engine, draft } = await setup([rule(d => Number(d.graph.nodes["c/1"]!.fields.capacity) > 10 ? [suggestion] : [])]), check = await engine.preflight(draft.id);
    assert.equal(check.status, "blocked");
    assert.deepEqual(await engine.getDraft(draft.id), draft);
    assert.deepEqual(check.diagnostics[0]!.candidates, suggestion.candidates);
    assert.equal("resolution" in check.diagnostics[0]!, false);
    await engine.edit(draft.id, 0, { patches: [{ op: "set", ref: "c/1", scope: "canonical", path: "/capacity", value: 7 }] });
    await assert.rejects(engine.getCheck(draft.id), /CHECK_NOT_CURRENT/);
    const passed = await engine.preflight(draft.id);
    assert.equal(passed.status, "passed");
    assert.equal(passed.scope, "draft");
    assert.equal(passed.certificate, undefined);
    await assert.rejects(engine.publish(draft.id, "invented"), /EXECUTABLE_MODE_REQUIRED/);
    await engine.close();
});
test("preflight: current check is isolated by Draft and invalidated by accepted edits", async () => {
    const { engine, draft } = await setup(), first = await engine.preflight(draft.id), second = await engine.preflight(draft.id);
    assert.notEqual(first.checkId, second.checkId);
    assert.deepEqual(await engine.getCheck(draft.id), second);
    const other = await engine.create(selector, initial());
    await assert.rejects(engine.getCheck(other.id), /CHECK_NOT_CURRENT/);
    await engine.edit(draft.id, 0, { patches: [{ op: "set", ref: "c/1", scope: "canonical", path: "/capacity", value: 20 }] });
    await assert.rejects(engine.getCheck(draft.id), /CHECK_NOT_CURRENT/);
    await engine.close();
});
test("preflight: preview and rejected edits preserve the accepted check", async () => {
    const { engine, draft } = await setup(), check = await engine.preflight(draft.id);
    await engine.preview(draft.id, 0, { patches: [{ op: "remove", ref: "c/1", scope: "canonical", path: "/note" }] });
    await assert.rejects(engine.edit(draft.id, 0, { patches: [] }), /no operations/);
    await assert.rejects(engine.edit(draft.id, 0, { patches: [{ op: "set", ref: "c/1", scope: "canonical", path: "/capacity", value: -1 }] }), /must be >=/);
    assert.deepEqual(await engine.getCheck(draft.id), check);
    await engine.close();
});
test("preflight: throwing, async-in-sync and malformed rules cannot certify a draft", async () => {
    const bad: unknown[] = [() => { throw Error("private provider detail"); }, async () => { throw Error("async unsupported"); }, () => [{ code: "bad", path: "not-pointer" }], () => [{ ...suggestion, severity: "fatal" }], () => [{ ...suggestion, message: " " }], () => [{ ...suggestion, related: ["not-pointer"] }], () => [{ ...suggestion, candidates: [{ value: Infinity }] }], () => [{ ...suggestion, repairs: [{ message: "bad", ops: { patches: [] } }] }], () => [{ ...suggestion, resolution: { ops: { patches: [] } } }]];
    for (const callback of bad) {
        const { engine, draft } = await setup([rule(callback as ManagedRule["check"])]), check = await engine.preflight(draft.id);
        assert.equal(check.status, "incomplete");
        assert.equal(check.diagnostics[0]!.code, "rule.error");
        assert.ok(!JSON.stringify(check).includes("private provider detail"));
        assert.deepEqual(await engine.getDraft(draft.id), draft);
        assert.ok(check.preview.nodes["c/1"]);
        await engine.close();
    }
});
test("preflight: one invalid diagnosis discards that rule's entire output", async () => {
    const { engine, draft } = await setup([rule(() => [suggestion, { ...suggestion, message: "" }])]);
    assert.deepEqual((await engine.preflight(draft.id)).diagnostics.map(d => d.code), ["rule.error"]);
    await engine.close();
});
test("preflight: frozen inputs and detached outputs cannot corrupt subsequent rules or saved state", async () => {
    let observed = 0;
    const { engine, draft } = await setup([rule(d => { d.graph.nodes["c/1"]!.fields.capacity = 999; return []; }), { ...rule(d => { observed = Number(d.graph.nodes["c/1"]!.fields.capacity); return [suggestion]; }), id: "reader" }]);
    const check = await engine.preflight(draft.id);
    assert.equal(observed, 20);
    assert.equal(check.status, "incomplete");
    check.diagnostics.length = 0;
    check.preview.nodes["c/1"]!.fields["/capacity"] = { kind: "value", value: 999 };
    assert.equal((await engine.getCheck(draft.id)).diagnostics.length, 2);
    assert.deepEqual(await engine.getDraft(draft.id), draft);
    await engine.close();
});
test("preflight: duplicate rule identities and unknown definitions are rejected at assembly", () => {
    const r = rule(() => []);
    assert.throws(() => createStagedWrite({ definitions: [definition], rules: [r, r] }));
    assert.throws(() => createStagedWrite({ definitions: [definition], rules: [{ ...r, typeVersion: "missing" }] }));
    assert.throws(() => createStagedWrite({ definitions: [definition], rules: [r], asyncRules: [{ ...r, check: async () => ({ status: "complete", diagnostics: [] }) }] }));
});
test("preflight: an I/O timeout is incomplete and aborts the callback, never a pass", async () => {
    let signal: AbortSignal | undefined;
    const { engine, draft } = await setup([], { preflightTimeoutMs: 15, asyncRules: [{ ...selector, id: "slow", version: "1", check: async (_d, c) => { signal = c.signal; return new Promise(() => { }); } }] });
    const check = await engine.preflight(draft.id);
    assert.equal(check.status, "incomplete");
    assert.equal(check.certificate, undefined);
    assert.equal(signal!.aborted, true);
    assert.ok(check.preview.nodes["c/1"]);
    await engine.close();
});

test("preflight: synchronous and asynchronous callbacks receive detached managed intent snapshots", async () => {
    let calls = 0;
    const inspect = (d: import("../src/index.js").ManagedDraft) => {
        calls++;
        assert.equal(d.graph.nodes["c/1"]!.fields.note, null);
        assert.deepEqual(d.fieldIntents["c/1"]!["/note"], { kind: "set", value: null });
        assert.deepEqual(d.initialSnapshot.graph.nodes["c/1"]!.fields, { capacity: 20, note: null });
        assert.throws(() => { d.graph.nodes["c/1"]!.fields.capacity = 999; }, TypeError);
        assert.throws(() => { d.initialSnapshot.graph.nodes["c/1"]!.fields.capacity = 999; }, TypeError);
        return [];
    };
    const { engine, draft } = await setup([rule(inspect)], {
        asyncRules: [{ ...selector, id: "async-snapshot", version: "1", check: async d => ({ status: "complete", diagnostics: inspect(d) }) }]
    });
    try {
        for (let i = 0; i < 2; i++) {
            const check = await engine.preflight(draft.id);
            assert.equal(check.status, "passed");
            assert.equal("initialSnapshot" in check.preview, false);
            assert.equal("currentRunId" in check.preview, false);
        }
        assert.equal(calls, 4);
        assert.deepEqual(await engine.getDraft(draft.id), draft);
    } finally { await engine.close(); }
});


test("preflight: an older preview contract must be checked again before first publication", async () => {
    const backend = createMemoryBackend();
    const engine = createStagedWrite({ definitions: [definition], ...backend, executors: [{ ...selector,
        id: "contract", version: "1", target: "mock", plan: () => [{ id: "create", payload: {}, effect: { kind: "create", nodeId: "c/1" } }],
        apply: async () => ({ kind: "applied", remoteRef: "created" }), reconcile: { unsupported: "test" }
    }] });
    try {
        const draft = await engine.create(selector, initial()), check = await engine.preflight(draft.id);
        const { lockResource } = await import("../src/managed/storage.js");
        const lease = await backend.locks.acquire(lockResource(backend.storage.namespace, draft.id), { ttlMs: 30000 });
        assert.ok(lease);
        try { await backend.storage.transact(draft.id, lease, state => {
            assert.ok(state?.check);
            // Simulate a persisted pre-migration check, not a supported new response.
            Object.assign(state.check, { formatVersion: 2 }); return state;
        }); } finally { await lease.release(); }
        await assert.rejects(engine.getCheck(draft.id), /CHECK_NOT_CURRENT/);
        await assert.rejects(engine.publish(draft.id, check.certificate!), /PREFLIGHT_REQUIRED/);
        assert.equal((await engine.getDraft(draft.id)).currentRunId, null);
        const refreshed = await engine.preflight(draft.id);
        assert.equal(refreshed.formatVersion, 3);
        assert.equal((await engine.publish(draft.id, refreshed.certificate!)).state, "published");
    } finally { await engine.close(); }
});
