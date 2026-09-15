import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType, type ManagedRule, type GraphDiagnostic, type ManagedOptions } from "../src/index.js";
const definition = defineDraftType({ id: "example.check", version: "1", nodeTypes: { project: { valueSchema: { type: "object", properties: { capacity: { type: "number", minimum: 0 }, note: { type: ["string", "null"] } }, additionalProperties: false }, requiredAtPublish: ["capacity", "note"] } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: definition.version };
const rule = (check: ManagedRule["check"], version = "1"): ManagedRule => ({ ...selector, id: "capacity-policy", version, check });
const initial = (fields: Record<string, string | number | null> = { capacity: 20, note: null }) => ({ nodes: { "c/1": { id: "c/1", nodeType: "project", fields } }, edges: {} });
async function setup(rules: ManagedRule[] = [], options: Partial<ManagedOptions> = {}) { const engine = createStagedWrite({ definitions: [definition], rules, ...options }), draft = await engine.create(selector, initial()); return { engine, draft }; }
const suggestion: GraphDiagnostic = { code: "capacity.limit", path: "/nodes/c~11/fields/capacity", message: "Capacity exceeds the example limit.", hint: "Choose a capacity according to user intent.", candidates: [{ value: 8, message: "An option, not a required choice.", repairOps: [{ op: "set", nodeId: "c/1", path: "/capacity", value: 8 }] }], related: ["/nodes/c~11/fields/note"] };
test("preflight: missing fields and explicit clearing are diagnosed; reset restores the original null", async () => {
    const { engine, draft } = await setup(), missing = await engine.create(selector, initial({})), check = await engine.preflight(missing.id);
    assert.equal(check.status, "blocked");
    assert.deepEqual(check.diagnostics.map(d => d.path), ["/nodes/c~11/fields/capacity", "/nodes/c~11/fields/note"]);
    assert.deepEqual(check.preview.nodes["c/1"]!.fields, { capacity: { kind: "undeclared" }, note: { kind: "undeclared" } });
    assert.equal((await engine.preflight(draft.id)).status, "passed");
    await engine.edit(draft.id, 0, [{ op: "remove", nodeId: "c/1", path: "/note" }]);
    assert.equal((await engine.preflight(draft.id)).status, "blocked");
    await engine.edit(draft.id, 1, [{ op: "reset", nodeId: "c/1", path: "/note" }]);
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
    await engine.edit(draft.id, 0, [{ op: "set", nodeId: "c/1", path: "/capacity", value: 7 }]);
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
    await engine.edit(draft.id, 0, [{ op: "set", nodeId: "c/1", path: "/capacity", value: 20 }]);
    await assert.rejects(engine.getCheck(draft.id), /CHECK_NOT_CURRENT/);
    await engine.close();
});
test("preflight: preview and rejected edits preserve the accepted check", async () => {
    const { engine, draft } = await setup(), check = await engine.preflight(draft.id);
    await engine.preview(draft.id, 0, [{ op: "remove", nodeId: "c/1", path: "/note" }]);
    await assert.rejects(engine.edit(draft.id, 0, []), /EMPTY_OP_BATCH/);
    await assert.rejects(engine.edit(draft.id, 0, [{ op: "set", nodeId: "c/1", path: "/capacity", value: -1 }]), /INVALID_GRAPH/);
    assert.deepEqual(await engine.getCheck(draft.id), check);
    await engine.close();
});
test("preflight: throwing, async-in-sync and malformed rules cannot certify a draft", async () => {
    const bad: unknown[] = [() => { throw Error("private provider detail"); }, async () => { throw Error("async unsupported"); }, () => [{ code: "bad", path: "not-pointer" }], () => [{ ...suggestion, severity: "fatal" }], () => [{ ...suggestion, message: " " }], () => [{ ...suggestion, related: ["not-pointer"] }], () => [{ ...suggestion, candidates: [{ value: Infinity }] }], () => [{ ...suggestion, repairs: [{ message: "bad", ops: [] }] }], () => [{ ...suggestion, resolution: { ops: [] } }]];
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
    check.preview.nodes["c/1"]!.fields.capacity = { kind: "value", value: 999 };
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
