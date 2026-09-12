import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, StagedWrite } from "../src/index.js";
import type { GraphExecutor, ApplyOutcome, Clock, Run, StopRetry } from "../src/index.js";
const selector = { type: "stop", typeVersion: "1" };
const definition = { id: "stop", version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: {}, additionalProperties: false } } }, relationTypes: {} };
function setup(overrides: Partial<GraphExecutor> = {}, clock: Clock = () => 0) {
  const calls: string[] = [];
  const executor: GraphExecutor = { ...selector, id: "stop", version: "1", target: "mock",
    plan: () => [{ id: "a", payload: {}, effect: { kind: "create", nodeId: "a" } }, { id: "b", payload: {}, effect: { kind: "create", nodeId: "b" }, dependsOn: ["a"], inputRefs: { aId: "a" } }],
    apply: async s => { calls.push(s.id); return { kind: "not_applied", retryable: true, reason: "quota" }; },
    reconcile: { unsupported: "no lookup" }, ...overrides };
  const engine = createStagedWrite({ definitions: [definition], mode: "executable", executors: [executor], clock });
  const draft = engine.create(selector);
  engine.edit(draft.id, 0, [{ op: "node.add", id: "a", nodeType: "item" }, { op: "node.add", id: "b", nodeType: "item" }]);
  const certificate = engine.preflight(draft.id).certificate!;
  return { engine, draft, calls, publish: () => engine.publish(draft.id, certificate) };
}
const command = (r: Run, requestId = "stop-1"): StopRetry => ({ requestId, expectedSequence: r.events.length, actor: "operator", reason: "Retry limit exhausted" });

test("stopping repeated zero-effect refusals is terminal, idempotent and permits revision", async () => {
  const { engine, publish, calls } = setup(); let run = await publish(); run = await engine.resume(run.id);
  const request = command(run); const stopped = engine.stopRetry(run.id, request);
  assert.equal(stopped.state, "failed"); assert.deepEqual(stopped.steps.map(s => s.status), ["failed", "skipped"]);
  assert.equal(stopped.steps[1]?.skipReason, "run_stopped");
  assert.equal(stopped.events.find(e => e.kind === "retry_stopped")?.stopRetry?.reason, request.reason);
  assert.deepEqual(engine.stopRetry(run.id, request), stopped);
  assert.deepEqual(await engine.resume(run.id), stopped); assert.deepEqual(await publish(), stopped);
  assert.equal(calls.length, 2); assert.equal(engine.revise(run.id).sourceRunId, run.id);
  request.reason = "mutated";
  assert.throws(() => engine.stopRetry(run.id, request), /STOP_RETRY_CONFLICT/);
  assert.deepEqual(engine.getRun(run.id), stopped);
});

test("stopping partial and reused runs preserves receipts for continuation", async () => {
  let calls = 0;
  const { engine, publish } = setup({ apply: async s => {
    if (s.id === "a") { calls++; return { kind: "applied", remoteRef: "a" }; }
    assert.equal(s.payload.aId, "a"); return { kind: "not_applied", retryable: true, reason: "quota" };
  } });
  const first = await publish(); engine.stopRetry(first.id, command(first));
  assert.throws(() => engine.revise(first.id), /ZERO_EFFECT_FAILURE_REQUIRED/);
  const next = engine.continueFrom(first.id); const second = await engine.publish(next.id, engine.preflight(next.id).certificate!);
  assert.equal(second.steps[0]?.status, "reused");
  const stopped = engine.stopRetry(second.id, command(second));
  assert.equal(stopped.steps[0]?.remoteRef, "a"); assert.equal(calls, 1);
  assert.ok(engine.continueFrom(stopped.id).continuation);
});

test("unknown cannot be stopped as no-effect; manually established no-effect can", async () => {
  const { engine, publish } = setup({ apply: async () => ({ kind: "unknown", reason: "lost" }) });
  const run = await publish(); assert.throws(() => engine.stopRetry(run.id, command(run)), /BLOCKED_RUN_REQUIRED/);
  assert.deepEqual(engine.getRun(run.id), run);
  const known = engine.adjudicate(run.id, "a", { requestId: "review", expectedSequence: run.events.length,
    actor: "operator", evidence: "verified:request", note: "Request cannot complete", decision: { kind: "no_effect", next: "retry" } });
  const stopped = engine.stopRetry(run.id, command(known));
  assert.equal(stopped.state, "failed"); assert.ok(engine.revise(run.id));
});

test("stale, malformed, and concurrent stop commands cannot change the run", async () => {
  let finish!: (v: ApplyOutcome) => void;
  const { engine, publish } = setup({ apply: () => new Promise(resolve => { finish = resolve; }) });
  const pending = publish(); const inFlight = await publish();
  assert.throws(() => engine.stopRetry(inFlight.id, command(inFlight)), /RUN_BUSY/);
  finish({ kind: "not_applied", retryable: true, reason: "quota" }); const blocked = await pending;
  assert.throws(() => engine.stopRetry(blocked.id, command(inFlight)), /STALE_RUN/);
  for (const invalid of [{ ...command(blocked), actor: " " }, { ...command(blocked), reason: "" },
    { ...command(blocked), expectedSequence: -1 }, { ...command(blocked), extra: true }]) {
    assert.throws(() => engine.stopRetry(blocked.id, invalid), /INVALID_STOP_RETRY/);
  }
  assert.deepEqual(engine.getRun(blocked.id), blocked);
});

test("all-applied manual pause requires finalization, not a fabricated failed step", async () => {
  const engine = new StagedWrite({ plan: () => [{ id: "a", payload: {} }], apply: async () => ({ kind: "unknown", reason: "lost" }), reconcile: async () => ({ kind: "unknown", reason: "no" }) }, [], { clock: () => 0 });
  const d = engine.create(); const run = await engine.publish(d.id, engine.preflight(d.id).certificate!);
  const known = engine.adjudicate(run.id, "a", { requestId: "review", expectedSequence: run.events.length, actor: "operator", evidence: "receipt", note: "Verified", decision: { kind: "applied", remoteRef: "a" } });
  assert.throws(() => engine.stopRetry(run.id, command(known)), /NO_PENDING_STEPS/);
  assert.equal((await engine.resume(run.id)).state, "published");
});

test("all events use the injected clock, including reconciliation, manual, stop, skip and reuse", async () => {
  let now = 1000;
  const { engine, publish } = setup({ apply: async s => s.id === "a" ? { kind: "unknown", reason: "lost" } : { kind: "not_applied", retryable: true, reason: "quota" } }, () => now++);
  let run = await publish(); run = await engine.resume(run.id);
  run = engine.adjudicate(run.id, "a", { requestId: "review", expectedSequence: run.events.length, actor: "operator", evidence: "receipt", note: "Verified", decision: { kind: "applied", remoteRef: "a" } });
  run = await engine.resume(run.id); run = engine.stopRetry(run.id, command(run));
  assert.deepEqual(run.events.map(e => e.recordedAt), run.events.map((_, i) => new Date(1000 + i).toISOString()));
  const next = engine.continueFrom(run.id); const continued = await engine.publish(next.id, engine.preflight(next.id).certificate!);
  assert.equal(continued.events[0]?.kind, "reused");
  assert.equal(continued.events[0]?.recordedAt, new Date(1000 + run.events.length).toISOString());
});

test("clock failure and clock reentry cannot lose remote evidence or override a stop", async () => {
  for (const clock of [() => { throw new Error("clock failed"); }, () => NaN]) {
    const { engine, publish } = setup({ apply: async () => ({ kind: "applied", remoteRef: "exists" }) }, clock);
    const run = await publish(); assert.equal(run.state, "published");
    assert.ok(run.events.every(e => Number.isFinite(Date.parse(e.recordedAt))));
  }
  let onClock = () => {};
  const { engine, publish } = setup({}, () => { onClock(); return 0; }); const run = await publish();
  let rejected = false;
  onClock = () => { assert.throws(() => engine.stopRetry(run.id, command(run, "nested")), /RUN_BUSY/); rejected = true; };
  assert.equal(engine.stopRetry(run.id, command(run)).state, "failed"); assert.equal(rejected, true);
});
