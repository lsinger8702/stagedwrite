import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, StagedWrite } from "../src/index.js";
import type { Adjudication, GraphExecutor, Run, ApplyOutcome, ReconcileOutcome } from "../src/index.js";
const definition = { id: "manual", version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} };
const selector = { type: "manual", typeVersion: "1" };
function setup(overrides: Partial<GraphExecutor> = {}) {
  const engine = createStagedWrite({ definitions: [definition], mode: "executable", executors: [{ ...selector,
    id: "manual", version: "1", target: "mock", plan: () => [
      { id: "parent", payload: {} }, { id: "child", payload: {}, dependsOn: ["parent"], inputRefs: { parentId: "parent" } }
    ], apply: async (): Promise<ApplyOutcome> => ({ kind: "unknown", reason: "lost" }), reconcile: { unsupported: "No lookup API" }, ...overrides }] });
  const draft = engine.create(selector);
  engine.edit(draft.id, 0, [{ op: "node.add", id: "one", nodeType: "item" }]);
  const certificate = engine.preflight(draft.id).certificate!;
  const publish = () => engine.publish(draft.id, certificate);
  return { engine, draft, publish, certificate };
}
const command = (run: Run, decision: Adjudication["decision"], requestId = "review-1"): Adjudication => ({
  requestId, expectedSequence: run.events.length, actor: "operator:alice", evidence: "ticket:123/verified-receipt", note: "Verified exact request and target", decision
});

test("manual applied evidence resumes unsupported recovery without recreating the parent", async () => {
  const calls: string[] = [];
  const { engine, publish } = setup({ apply: async s => {
    calls.push(s.id);
    if (s.id === "parent") return { kind: "unknown", reason: "lost" };
    assert.equal(s.payload.parentId, "remote-parent");
    return { kind: "applied", remoteRef: "remote-child" };
  } });
  const run = await publish();
  const request = command(run, { kind: "applied", remoteRef: "remote-parent" });
  const decided = engine.adjudicate(run.id, "parent", request);
  assert.equal(decided.state, "blocked"); assert.deepEqual(calls, ["parent"]);
  assert.equal(decided.events.at(-1)?.kind, "adjudicated");
  assert.deepEqual(decided.events.at(-1)?.adjudication, request);
  request.note = "mutated";
  decided.steps[0]!.remoteRef = "mutated";
  assert.equal(engine.getRun(run.id).steps[0]?.remoteRef, "remote-parent");
  assert.equal(engine.getRun(run.id).events.at(-1)?.adjudication?.note, "Verified exact request and target");
  const finished = await engine.resume(run.id);
  assert.equal(finished.state, "published"); assert.deepEqual(calls, ["parent", "child"]);
});

test("manual no-effect retry keeps the original key and requires explicit resume", async () => {
  const calls: string[] = [];
  const { engine, publish } = setup({ apply: async (s, key) => {
    calls.push(key); return calls.length === 1 ? { kind: "unknown", reason: "lost" } : { kind: "applied", remoteRef: s.id };
  } });
  const run = await publish();
  const decided = engine.adjudicate(run.id, "parent", command(run, { kind: "no_effect", next: "retry" }));
  assert.equal(decided.state, "blocked"); assert.equal(calls.length, 1);
  assert.equal((await engine.resume(run.id)).state, "published");
  assert.equal(calls[0], calls[1]);
});

test("manual no-effect stop permits zero-effect revision while closure preserves uncertainty", async () => {
  for (const close of [false, true]) {
    const { engine, publish } = setup(); const run = await publish();
    const stopped = engine.adjudicate(run.id, "parent", command(run, close ? { kind: "close_unresolved" } : { kind: "no_effect", next: "stop" }));
    assert.equal(stopped.state, close ? "closed" : "failed");
    assert.equal(stopped.steps[0]?.status, close ? "unknown" : "failed");
    assert.equal(stopped.steps[1]?.status, "skipped");
    assert.equal(stopped.steps[1]?.skipReason, close ? "run_stopped" : "dependency_failed");
    assert.deepEqual(await engine.resume(run.id), stopped);
    if (close) assert.throws(() => engine.revise(run.id), /ZERO_EFFECT_FAILURE_REQUIRED/);
    else assert.equal(engine.revise(run.id).sourceRunId, run.id);
  }
});

test("adjudication is idempotent and rejects conflicting or stale decisions without changing history", async () => {
  const { engine, publish } = setup(); const run = await publish();
  const stale = command(run, { kind: "applied", remoteRef: "parent" });
  const current = await engine.resume(run.id);
  assert.throws(() => engine.adjudicate(run.id, "parent", stale), /STALE_RUN/);
  const request = command(current, { kind: "applied", remoteRef: "parent" });
  const decided = engine.adjudicate(run.id, "parent", request);
  assert.deepEqual(engine.adjudicate(run.id, "parent", request), decided);
  assert.throws(() => engine.adjudicate(run.id, "parent", { ...request, note: "different" }), /ADJUDICATION_CONFLICT/);
  assert.throws(() => engine.adjudicate(run.id, "child", request), /ADJUDICATION_CONFLICT/);
  assert.throws(() => engine.adjudicate(run.id, "parent", command(decided, { kind: "close_unresolved" }, "review-2")), /UNRESOLVED_STEP_REQUIRED/);
  assert.deepEqual(engine.getRun(run.id), decided);
});

test("malformed evidence and decisions for noncurrent steps do not mutate the run", async () => {
  const { engine, publish } = setup(); const run = await publish();
  const valid = command(run, { kind: "applied", remoteRef: "parent" });
  for (const invalid of [
    { ...valid, actor: " " }, { ...valid, evidence: "" }, { ...valid, note: "" }, { ...valid, requestId: "" },
    { ...valid, expectedSequence: NaN }, { ...valid, unexpected: true },
    { ...valid, decision: { kind: "applied", remoteRef: " " } }, { ...valid, decision: { kind: "no_effect" } },
    { ...valid, decision: { kind: "no_effect", next: ["retry"] } },
    { ...valid, decision: { kind: "no_effect", next: "retry", remoteRef: "bad" } }
  ]) assert.throws(() => engine.adjudicate(run.id, "parent", invalid as Adjudication), /INVALID_ADJUDICATION/);
  for (const stepId of ["child", "missing"]) assert.throws(() => engine.adjudicate(run.id, stepId, valid), /UNRESOLVED_STEP_REQUIRED/);
  assert.deepEqual(engine.getRun(run.id), run);
});

test("in-flight dispatch and reconciliation exclude manual adjudication", async () => {
  let finishApply!: (value: ApplyOutcome) => void;
  let finishReconcile!: (value: ReconcileOutcome) => void;
  const { engine, publish } = setup({ apply: () => new Promise(resolve => { finishApply = resolve; }), reconcile: () => new Promise(resolve => { finishReconcile = resolve; }) });
  const pending = publish();
  const dispatching = await publish();
  assert.equal(dispatching.state, "running");
  assert.throws(() => engine.adjudicate(dispatching.id, "parent", command(dispatching, { kind: "close_unresolved" })), /RUN_BUSY/);
  finishApply({ kind: "unknown", reason: "lost" });
  const run = await pending;
  const recovering = engine.resume(run.id);
  assert.throws(() => engine.adjudicate(run.id, "parent", command(run, { kind: "close_unresolved" })), /RUN_BUSY/);
  finishReconcile({ kind: "unknown", reason: "not proven" });
  const current = await recovering;
  assert.throws(() => engine.adjudicate(run.id, "parent", command(run, { kind: "close_unresolved" })), /STALE_RUN/);
  assert.equal(engine.adjudicate(run.id, "parent", command(current, { kind: "close_unresolved" })).state, "closed");
});

test("legacy entry uses the same manual evidence contract", async () => {
  const engine = new StagedWrite({ plan: () => [{ id: "one", payload: {} }], apply: async () => ({ kind: "unknown", reason: "lost" }), reconcile: async () => ({ kind: "unknown", reason: "unsupported" }) }, []);
  const draft = engine.create();
  const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  assert.equal(engine.adjudicate(run.id, "one", command(run, { kind: "applied", remoteRef: "one" })).state, "blocked");
  assert.equal((await engine.resume(run.id)).state, "published");
});
