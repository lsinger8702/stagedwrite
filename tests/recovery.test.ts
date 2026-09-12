import assert from "node:assert/strict";
import test from "node:test";
import { StagedWrite } from "../src/index.js";
import type { Adapter, ApplyOutcome, ReconcileOutcome, Step } from "../src/index.js";
import { subscriptionRule } from "../src/adapters/mock.js";

function ready(adapter: Adapter) {
  const engine = new StagedWrite(adapter, [subscriptionRule]);
  let draft = engine.create();
  draft = engine.edit(draft.id, 0, [
    { op: "set", path: "/seats", value: 2 },
    { op: "set", path: "/timing", value: "next_cycle" }
  ]);
  return { engine, draft, certificate: engine.preflight(draft.id).certificate! };
}

// S1 — a transient refusal must not be terminal.
test("a retryable refusal leaves the run resumable under the original key", async () => {
  const keys: string[] = [];
  let refusals = 0;
  let firstCalls = 0;
  const rateLimited: Adapter = {
    plan: () => [{ id: "first", payload: {} }, { id: "second", payload: {} }],
    apply: async (step, key) => {
      if (step.id === "first") { firstCalls++; return { kind: "applied", remoteRef: "first_ref" }; }
      keys.push(key);
      return ++refusals < 3
        ? { kind: "not_applied", reason: "429 rate limited", retryable: true }
        : { kind: "applied", remoteRef: "second_ref" };
    },
    reconcile: async () => ({ kind: "unknown", reason: "not reached" })
  };
  const { engine, certificate, draft } = ready(rateLimited);

  const blocked = await engine.publish(draft.id, certificate);
  assert.equal(blocked.state, "blocked");
  assert.deepEqual(blocked.events.at(-1), { sequence: 4, stepId: "second", kind: "not_applied", reason: "429 rate limited", retryable: true });
  assert.equal((await engine.publish(draft.id, certificate)).state, "blocked");
  assert.equal(keys.length, 1);
  assert.deepEqual(blocked.steps.map(s => s.status), ["applied", "ready"]);
  assert.equal(blocked.steps[0]?.remoteRef, "first_ref");

  assert.equal((await engine.resume(blocked.id)).state, "blocked");
  assert.equal((await engine.resume(blocked.id)).state, "published");

  // Every retry reused one key, and the already-applied step was never redispatched.
  assert.equal(firstCalls, 1);
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 1);
});

// S1 — a final refusal stays terminal and keeps earlier receipts visible.
test("a final refusal is terminal and preserves earlier receipts", async () => {
  let calls = 0;
  const rejected: Adapter = {
    plan: () => [{ id: "first", payload: {} }, { id: "second", payload: {} }],
    apply: async () => ++calls === 1
      ? { kind: "applied", remoteRef: "first_ref" }
      : { kind: "not_applied", reason: "Account is not eligible" },
    reconcile: async () => ({ kind: "unknown", reason: "not reached" })
  };
  const { engine, certificate, draft } = ready(rejected);
  const run = await engine.publish(draft.id, certificate);
  assert.equal(run.state, "failed");
  assert.equal(run.steps[0]?.remoteRef, "first_ref");
  assert.equal((await engine.resume(run.id)).state, "failed");
  assert.equal(calls, 2);
});

/**
 * S4 — a remote with no idempotency key, whose only evidence is a list query
 * that lags behind its own writes. "Search found nothing" is NOT proof of no effect.
 */
class InferentialRemote {
  readonly created: { ref: string; visibleAt: number }[] = [];
  applyCalls = 0;
  constructor(private clock: { now: number }, private readonly visibilityMs = 2000) {}
  plan(): Step[] { return [{ id: "create_object", payload: {} }]; }
  async apply(): Promise<ApplyOutcome> {
    this.applyCalls++;
    // The key is ignored: a second dispatch creates a SECOND object.
    this.created.push({ ref: `obj_${this.created.length + 1}`, visibleAt: this.clock.now + this.visibilityMs });
    throw new Error("connection reset after the remote committed");
  }
  async reconcile(): Promise<ReconcileOutcome> {
    const visible = this.created.filter(c => c.visibleAt <= this.clock.now);
    if (visible.length) return { kind: "applied", remoteRef: visible[0]!.ref };
    return { kind: "unknown", reason: "Search returned nothing inside the visibility horizon" };
  }
}

test("an empty search inside the visibility horizon does not authorize a redispatch", async () => {
  const clock = { now: 0 };
  const remote = new InferentialRemote(clock);
  const { engine, certificate, draft } = ready(remote);

  const run = await engine.publish(draft.id, certificate);
  assert.equal(run.state, "unknown");
  assert.equal(remote.created.length, 1);

  // Resuming before the object becomes searchable must not create a duplicate.
  assert.equal((await engine.resume(run.id)).state, "unknown");
  assert.equal(remote.applyCalls, 1);
  assert.equal(remote.created.length, 1);

  clock.now = 5000;
  const done = await engine.resume(run.id);
  assert.equal(done.state, "published");
  assert.equal(done.steps[0]?.remoteRef, "obj_1");
  assert.equal(remote.created.length, 1);
});

test("an adapter that reports an empty search as no-effect duplicates the remote object", async () => {
  const clock = { now: 0 };
  const remote = new InferentialRemote(clock);
  // The contract violation: absence of evidence reported as evidence of absence.
  const naive: Adapter = {
    plan: () => remote.plan(),
    apply: () => remote.apply(),
    reconcile: async () => {
      const result = await remote.reconcile();
      return result.kind === "unknown" ? { kind: "no_effect", reason: "not found" } : result;
    }
  };
  const { engine, certificate, draft } = ready(naive);

  const run = await engine.publish(draft.id, certificate);
  assert.equal(run.state, "unknown");
  assert.equal((await engine.resume(run.id)).state, "unknown");

  // Two objects exist for one intent. The engine cannot prevent this; only the adapter can.
  assert.equal(remote.created.length, 2);
});

test("an empty edit preserves the draft and its usable certificate", async () => {
  let calls = 0;
  const { engine, draft, certificate } = ready({
    plan: () => [{ id: "one", payload: {} }],
    apply: async () => { calls++; return { kind: "applied", remoteRef: "one" }; },
    reconcile: async () => ({ kind: "unknown", reason: "unused" })
  });
  assert.throws(() => engine.edit(draft.id, draft.version, []), /EMPTY_OP_BATCH/);
  assert.deepEqual(engine.getDraft(draft.id), draft);
  assert.equal((await engine.publish(draft.id, certificate)).state, "published");
  assert.equal(calls, 1);
});

test("a reconcile refusal tag cannot authorize another dispatch", async () => {
  let calls = 0;
  const { engine, draft, certificate } = ready({
    plan: () => [{ id: "one", payload: {} }],
    apply: async () => { calls++; return { kind: "unknown", reason: "response lost" }; },
    // Simulate an old or untyped adapter violating the new contract.
    reconcile: async () => ({ kind: "not_applied", reason: "not found" } as unknown as ReconcileOutcome)
  });
  const run = await engine.publish(draft.id, certificate);
  const resumed = await engine.resume(run.id);
  assert.equal(resumed.state, "unknown");
  assert.equal(resumed.events.at(-1)?.reason, "Invalid adapter outcome");
  assert.equal(calls, 1);
});
