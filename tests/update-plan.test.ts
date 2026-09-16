import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, createMemoryBackend, defineDraftType } from "../src/index.js";
import { compileUpdate, type UpdateProjection } from "../src/managed/update-plan.js";
import type { NormalizedValue, RemoteObservation } from "../src/managed/types.js";
const value = (v: string | number | boolean | null): NormalizedValue => ({ kind: "value", value: v });
async function setup(B = value("A"), D = value("B"), O = value("A")) {
    const definition = defineDraftType({ id: "plan.tasks", version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { title: { type: ["string", "null"] }, note: { type: "string" } }, additionalProperties: false } } }, relationTypes: {} });
    const selector = { type: definition.id, typeVersion: "1" }, backend = createMemoryBackend();
    const e = createStagedWrite({ definitions: [definition], ...backend, executors: [{ ...selector, id: "tasks", version: "1", target: "test", plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, payload: n.fields, effect: { kind: "create", nodeId: n.id } })), apply: async () => ({ kind: "applied", remoteRef: "remote-a" }), reconcile: { unsupported: "no evidence" } }] });
    const draft = await e.create(selector, { nodes: { "a/b": { id: "a/b", nodeType: "task", fields: { title: "A" } } }, edges: {} });
    const check = await e.preflight(draft.id), run = await e.publish(draft.id, check.certificate!);
    const s = (await backend.storage.read(draft.id))!; await e.close();
    // Compiler fixtures are detached copies; the public update entry remains disabled.
    s.draft.version++; s.draft.status = "pending";
    s.draft.fieldIntents["a/b"]!["/title"] = D.kind === "value" ? { kind: "set", value: D.value } : { kind: "remove" };
    const p: UpdateProjection[] = [{ nodeId: "a/b", projectionDigest: "title-v1", fields: { title: { path: "/title", writable: true, desired: D } } }];
    const o: RemoteObservation[] = [{ id: "read-1", nodeId: "a/b", targetId: "test", remoteId: "remote-a", projectionDigest: "title-v1", values: { title: O }, observedAt: "2026-09-16T00:00:00Z" }];
    s.remoteFacts.fact = { id: "fact", nodeId: "a/b", targetId: "test", remoteId: "remote-a", projectionDigest: "title-v1", values: { title: B }, source: { kind: "attempt", runId: run.id, stepId: "a/b", attemptNumber: 1 }, confirmedAt: o[0]!.observedAt };
    s.latestFactByNode["a/b"] = "fact";
    return { s, p, o, run };
}
for (const [B, D, O, expected] of [
    ["A", "A", "A", "noop"], ["A", "B", "A", "update"], ["A", "A", "B", "blocked"],
    ["A", "B", "B", "noop"], ["A", "B", "C", "blocked"],
] as const) test(`update diff: B=${B}, D=${D}, O=${O} -> ${expected}`, async () => {
    const { s, p, o } = await setup(value(B), value(D), value(O));
    const before = structuredClone({ s, p, o }), out = compileUpdate(s, p, o);
    assert.deepEqual({ s, p, o }, before);
    if (expected === "blocked") { assert.equal(out.status, "blocked"); assert.equal(out.diagnostics[0]!.code, "update.drift"); assert.equal(out.diagnostics[0]!.path, "/nodes/a~1b/fields/title"); assert.ok(!("slots" in out)); assert.deepEqual(out.diagnostics[0]!.metadata, { baseline: value(B), desired: value(D), observed: value(O) }); }
    else { assert.equal(out.status, "passed"); if (out.status !== "passed") return; assert.equal(out.slots[0]!.kind, expected); assert.equal(out.context.basePublishedArtifactId, s.draft.publishedArtifactId); }
});
test("update diff: remote equality does not resolve an unknown request", async () => {
    const { s, p, o, run } = await setup(value("A"), value("B"), value("B"));
    s.runs[run.id]!.attempts[0]!.status = "unknown";
    assert.equal(compileUpdate(s, p, o).diagnostics[0]!.code, "update.unresolved_request");
});
test("update diff: absent, null, empty string and omitted evidence remain distinct", async () => {
    const { s, p, o } = await setup(value(null), { kind: "absent" }, value(null));
    assert.equal(compileUpdate(s, p, o).diagnostics[0]!.code, "update.clear_unsupported");
    p[0]!.fields.title!.clearValue = { kind: "absent" };
    const result = compileUpdate(s, p, o); assert.equal(result.status, "passed");
    if (result.status === "passed") assert.deepEqual(result.slots[0]!.changes[0]!.after, { kind: "absent" });
    p[0]!.fields.title!.desired = value(""); p[0]!.fields.title!.clearValue = value("");
    assert.equal(compileUpdate(s, p, o).status, "passed");
    delete o[0]!.values.title;
    assert.equal(compileUpdate(s, p, o).diagnostics[0]!.code, "update.field_scope_mismatch");
});
test("update diff: undeclared fields cannot receive implicit targets and still detect drift", async () => {
    const { s, p, o } = await setup(); delete s.draft.fieldIntents["a/b"]!["/title"];
    assert.equal(compileUpdate(s, p, o).diagnostics[0]!.code, "update.undeclared_write");
    delete p[0]!.fields.title!.desired;
    assert.equal(compileUpdate(s, p, o).status, "passed");
    o[0]!.values.title = value("external");
    assert.equal(compileUpdate(s, p, o).diagnostics[0]!.code, "update.drift");
});
test("update diff: reject missing baseline, wrong identity, scope, topology and immutable writes", async () => {
    const { s, p, o } = await setup();
    const check = (mutate: (x: typeof s, y: typeof p, z: typeof o) => void, code: string) => {
        const a = structuredClone(s), b = structuredClone(p), c = structuredClone(o); mutate(a,b,c);
        assert.equal(compileUpdate(a,b,c).diagnostics[0]!.code, `update.${code}`);
    };
    check(s => { s.draft.publishedArtifactId = null; }, "baseline_missing");
    check(s => { delete s.latestFactByNode["a/b"]; }, "evidence_missing");
    check((_s,_p,o) => { o[0]!.remoteId = "different"; }, "identity_mismatch");
    check((_s,p) => { p[0]!.projectionDigest = "changed"; }, "projection_mismatch");
    check(s => { s.draft.graph.nodes.extra = { id: "extra", nodeType: "task", fields: {} }; }, "topology_changed");
    check((_s,p) => { p[0]!.fields.title!.writable = false; }, "immutable_field");
    check(s => { s.draft.fieldIntents["a/b"]!["/note"] = { kind: "set", value: "ignored" }; }, "unmapped_intent");
});
test("update diff: malformed adapter data cannot become a passing empty plan", async () => {
    const { s, p, o } = await setup();
    assert.equal(compileUpdate(s, [], []).status, "blocked");
    assert.equal(compileUpdate(s, [...p, ...p], o).status, "blocked");
    assert.equal(compileUpdate(s, p, [...o, ...o]).status, "blocked");
    p[0]!.fields.title!.desired = value(NaN);
    assert.equal(compileUpdate(s, p, o).diagnostics[0]!.code, "update.invalid_input");
});
test("update diff: output is detached and recompiles against each fresh observation", async () => {
    const { s, p, o } = await setup(); const out = compileUpdate(s,p,o); assert.equal(out.status, "passed");
    if (out.status !== "passed") return;
    out.context.observations[0]!.values.title = value("tampered");
    assert.deepEqual(o[0]!.values.title, value("A"));
    o[0]!.values.title = value("external");
    assert.equal(compileUpdate(s,p,o).status, "blocked");
});
