import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, createMemoryBackend, defineDraftType } from "../src/index.js";
import { compileUpdate, validateUpdatePlan, type UpdateProjection } from "../src/managed/update-plan.js";
import type { NormalizedValue, RemoteObservation } from "../src/managed/types.js";
const value = (v: string | number | boolean | null): NormalizedValue => ({ kind: "value", value: v });
async function setup(B = value("A"), D = value("B"), O = value("A")) {
    const definition = defineDraftType({ id: "plan.tasks", version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { title: { type: ["string", "null"] }, note: { type: "string" } }, additionalProperties: false } } }, relationTypes: {} });
    const selector = { type: definition.id, typeVersion: "1" }, backend = createMemoryBackend();
    const e = createStagedWrite({ definitions: [definition], ...backend, executors: [{ ...selector, id: "tasks", version: "1", target: "test", plan: d => Object.values(d.graph.nodes).map(n => ({ id: "a/b", payload: n.fields as Record<string, import("../src/index.js").Value>, effect: { kind: "create", nodeId: n.id } })), apply: async () => ({ kind: "applied", remoteRef: "remote-a" }), reconcile: { unsupported: "no evidence" } }] });
    const { draft, createdRefs } = await e.create(selector, { roots: [{ nodeType: "task", fields: { title: "A" } }] });
    const check = await e.preflight(draft.id), run = await e.publish(draft.id, check.certificate!);
    // Deliberately give this detached pure-compiler fixture an escaped identity.
    // The live engine and its store retain the server-generated ref.
    const s: NonNullable<Awaited<ReturnType<typeof backend.storage.read>>> = JSON.parse(JSON.stringify((await backend.storage.read(draft.id))!).replaceAll(createdRefs[0]!.ref, "a/b")); await e.close();
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

test("update plan: shared effects preserve identity and cannot hide changes as noop", async () => {
    const { s, p, o } = await setup(); const compiled = compileUpdate(s,p,o); assert.equal(compiled.status, "passed");
    if (compiled.status !== "passed") return;
    const plan = [{ id: "a/b", payload: { title: "B" }, effect: { kind: "update" as const, nodeId: "a/b", remoteId: "remote-a" } }];
    assert.deepEqual(validateUpdatePlan(plan, compiled, s), plan);
    assert.throws(() => validateUpdatePlan([{ ...plan[0], effect: { kind: "noop", nodeId: "a/b", remoteId: "remote-a" }, payload: {} }], compiled, s), /UPDATE_EFFECT_MISMATCH/);
    assert.throws(() => validateUpdatePlan([{ ...plan[0], effect: { ...plan[0]!.effect, remoteId: "different" } }], compiled, s), /UPDATE_EFFECT_MISMATCH/);
    assert.throws(() => validateUpdatePlan([{ ...plan[0], id: "renamed" }], compiled, s), /UPDATE_PLAN_TOPOLOGY/);
    assert.throws(() => validateUpdatePlan([{ ...plan[0], effect: { kind: "create", nodeId: "a/b" } }], compiled, s), /INVALID_PLAN/);
});
test("update plan: noop cannot carry a payload or an input reference", async () => {
    const { s, p, o } = await setup(value("A"), value("A"), value("A")); const compiled = compileUpdate(s,p,o);
    assert.equal(compiled.status, "passed"); if (compiled.status !== "passed") return;
    const step = { id: "a/b", payload: {}, effect: { kind: "noop" as const, nodeId: "a/b", remoteId: "remote-a" } };
    assert.deepEqual(validateUpdatePlan([step], compiled, s), [step]);
    assert.throws(() => validateUpdatePlan([{ ...step, payload: { title: "hidden write" } }], compiled, s), /INVALID_NOOP_PLAN/);
    assert.throws(() => validateUpdatePlan([{ ...step, inputRefs: {} }], compiled, s), /INVALID_NOOP_PLAN/);
});

test("update readback: fresh provenance preserves conditions and returns detached execution inputs", async () => {
    const { verifyUpdateReadback } = await import("../src/managed/update-readback.js");
    const { s, p, o } = await setup();
    o[0]!.remoteVersion = "revision-1";
    const checked = compileUpdate(s, p, o); assert.equal(checked.status, "passed"); if (checked.status !== "passed") return;
    const plan = [{ id: "a/b", payload: { title: "B" }, effect: { kind: "update" as const, nodeId: "a/b", remoteId: "remote-a" } }];
    const fresh = structuredClone(o); fresh[0]!.id = "fresh-read"; fresh[0]!.observedAt = "2026-09-17T00:00:00Z";
    const before = structuredClone({ s, checked, plan, p, fresh });
    const result = verifyUpdateReadback(s, checked, plan, p, fresh, plan);
    assert.equal(result.status, "passed"); if (result.status !== "passed") return;
    assert.equal(result.compilation.context.observations[0]!.id, "fresh-read");
    result.plan[0]!.payload.title = "mutated";
    result.compilation.context.observations[0]!.values.title = value("mutated");
    assert.deepEqual({ s, checked, plan, p, fresh }, before);
});

test("update readback: changed local ownership or facts require a new check even with identical remote values", async () => {
    const { verifyUpdateReadback } = await import("../src/managed/update-readback.js");
    for (const change of [
        (s: Awaited<ReturnType<typeof setup>>["s"]) => { s.draft.version++; },
        (s: Awaited<ReturnType<typeof setup>>["s"]) => { s.resourceRevision++; },
        (s: Awaited<ReturnType<typeof setup>>["s"]) => { s.draft.currentRunId = "other-owner"; },
        (s: Awaited<ReturnType<typeof setup>>["s"]) => { const old = s.artifacts[s.draft.publishedArtifactId!]!; s.artifacts.other = { ...structuredClone(old), id: "other" }; s.draft.publishedArtifactId = "other"; },
    ]) {
        const { s, p, o } = await setup(), checked = compileUpdate(s, p, o);
        assert.equal(checked.status, "passed"); if (checked.status !== "passed") return;
        const plan = [{ id: "a/b", payload: { title: "B" }, effect: { kind: "update" as const, nodeId: "a/b", remoteId: "remote-a" } }];
        change(s);
        const result = verifyUpdateReadback(s, checked, plan, p, o, plan);
        assert.equal(result.status, "blocked"); if (result.status !== "blocked") return;
        assert.equal(result.diagnostics[0]!.code, "update.check_stale");
        assert.ok(result.diagnostics[0]!.message && result.diagnostics[0]!.hint);
    }
});

test("update readback: changed remote conditions or payload never silently replace the checked plan", async () => {
    const { verifyUpdateReadback } = await import("../src/managed/update-readback.js");
    const { s, p, o } = await setup(); o[0]!.remoteVersion = "revision-1";
    const checked = compileUpdate(s, p, o); assert.equal(checked.status, "passed"); if (checked.status !== "passed") return;
    const plan = [{ id: "a/b", payload: { title: "B" }, effect: { kind: "update" as const, nodeId: "a/b", remoteId: "remote-a" } }];
    for (const change of [
        (next: typeof o) => { next[0]!.remoteVersion = "revision-2"; },
        (next: typeof o) => { delete next[0]!.remoteVersion; },
        (next: typeof o) => { next[0]!.values.title = value("B"); }, // Now noop is not permission to replace the original write.
        (next: typeof o) => { next[0]!.values.title = value("external"); },
    ]) {
        const fresh = structuredClone(o); change(fresh);
        const result = verifyUpdateReadback(s, checked, plan, p, fresh, plan);
        assert.equal(result.status, "blocked");
    }
    const changed = structuredClone(plan); changed[0]!.payload.title = "different-request";
    const result = verifyUpdateReadback(s, checked, plan, p, o, changed);
    assert.equal(result.status, "blocked"); if (result.status === "blocked") assert.equal(result.diagnostics[0]!.code, "update.plan_changed");
    const mapped = structuredClone(p); mapped[0]!.fields.title!.clearValue = { kind: "absent" };
    assert.equal(verifyUpdateReadback(s, checked, plan, mapped, o, plan).status, "blocked");
});

test("update readback: noop still checks conditions; matching values cannot resolve an unknown request", async () => {
    const { verifyUpdateReadback } = await import("../src/managed/update-readback.js");
    const { s, p, o, run } = await setup(value("A"), value("A"), value("A")); o[0]!.remoteVersion = "v1";
    const checked = compileUpdate(s, p, o); assert.equal(checked.status, "passed"); if (checked.status !== "passed") return;
    const plan = [{ id: "a/b", payload: {}, effect: { kind: "noop" as const, nodeId: "a/b", remoteId: "remote-a" } }];
    assert.equal(verifyUpdateReadback(s, checked, plan, p, o, plan).status, "passed");
    const fresh = structuredClone(o); fresh[0]!.remoteVersion = "v2";
    assert.equal(verifyUpdateReadback(s, checked, plan, p, fresh, plan).status, "blocked");
    s.runs[run.id]!.attempts[0]!.status = "unknown";
    const unresolved = verifyUpdateReadback(s, checked, plan, p, o, plan);
    assert.equal(unresolved.status, "blocked"); if (unresolved.status === "blocked") assert.equal(unresolved.diagnostics[0]!.code, "update.unresolved_request");
});

test("update readback: malformed evidence and accessors fail without side effects", async () => {
    const { verifyUpdateReadback } = await import("../src/managed/update-readback.js");
    const { s, p, o } = await setup(), checked = compileUpdate(s, p, o);
    assert.equal(checked.status, "passed"); if (checked.status !== "passed") return;
    let reads = 0;
    const invalid = { get context() { reads++; return checked.context; } } as typeof checked;
    assert.equal(verifyUpdateReadback(s, invalid, [], p, o, []).status, "blocked"); assert.equal(reads, 0);
    assert.equal(verifyUpdateReadback(s, {} as typeof checked, [], p, o, []).status, "blocked");
});
