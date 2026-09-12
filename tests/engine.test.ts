import assert from "node:assert/strict";
import test from "node:test";
import { StagedWrite } from "../src/index.js";
import type { Adapter, Outcome } from "../src/index.js";
import { MockAdapter, subscriptionRule } from "../src/adapters/mock.js";

function ready(adapter: Adapter = new MockAdapter()) {
  const engine = new StagedWrite(adapter, [subscriptionRule]);
  let draft = engine.create();
  draft = engine.edit(draft.id, 0, [
    { op: "set", path: "/seats", value: 2 },
    { op: "set", path: "/timing", value: "next_cycle" }
  ]);
  const certificate = engine.preflight(draft.id).certificate!;
  return { engine, draft, certificate };
}

test("incomplete draft is valid; preflight blocks until intent is supplied", () => {
  const engine = new StagedWrite(new MockAdapter(), [subscriptionRule]);
  const draft = engine.create();
  assert.deepEqual(draft.fields, {});
  assert.equal(engine.preflight(draft.id).certificate, undefined);
});

test("stale and malformed edit batches leave draft untouched", () => {
  const { engine, draft } = ready();
  assert.throws(() => engine.edit(draft.id, 0, [{ op: "set", path: "/seats", value: 20 }]), /STALE_VERSION/);
  assert.throws(() => engine.edit(draft.id, draft.version, [
    { op: "set", path: "/seats", value: 20 }, { op: "remove", path: "/nested/field" }
  ]), /UNSUPPORTED_PATH/);
  assert.deepEqual(engine.getDraft(draft.id), draft);
});

test("null, explicit clear and undeclared remain distinct", () => {
  const { engine, draft } = ready();
  let next = engine.edit(draft.id, draft.version, [{ op: "set", path: "/note", value: null }]);
  assert.deepEqual(next.fields.note, { kind: "value", value: null });
  next = engine.edit(draft.id, next.version, [{ op: "remove", path: "/note" }]);
  assert.deepEqual(next.fields.note, { kind: "clear" });
  next = engine.edit(draft.id, next.version, [{ op: "reset", path: "/note" }]);
  assert.equal(Object.hasOwn(next.fields, "note"), false);
});

test("edits invalidate certificates before any remote call", async () => {
  const remote = new MockAdapter();
  const { engine, draft, certificate } = ready(remote);
  engine.edit(draft.id, draft.version, [{ op: "set", path: "/seats", value: 3 }]);
  await assert.rejects(engine.publish(draft.id, certificate), /PREFLIGHT_REQUIRED/);
  assert.equal(remote.applyCalls, 0);
});

test("commit then timeout reconciles without redispatching either step", async () => {
  const remote = new MockAdapter();
  const { engine, draft, certificate } = ready(remote);
  const partial = await engine.publish(draft.id, certificate);
  assert.equal(partial.state, "unknown");
  assert.deepEqual(partial.steps.map(s => s.status), ["applied", "unknown"]);
  assert.equal(remote.effectCount, 2);
  assert.throws(() => engine.edit(draft.id, draft.version, []), /DRAFT_SEALED/);
  assert.equal((await engine.publish(draft.id, certificate)).state, "unknown");
  const complete = await engine.resume(partial.id);
  assert.equal(complete.state, "published");
  await engine.resume(partial.id);
  assert.equal(remote.applyCalls, 2);
  assert.equal(remote.effectCount, 2);
});

test("inconclusive reconciliation blocks later effects and repeated retries", async () => {
  const remote = new MockAdapter("unresolved");
  const { engine, draft, certificate } = ready(remote);
  const run = await engine.publish(draft.id, certificate);
  await engine.resume(run.id);
  const stillUnknown = await engine.resume(run.id);
  assert.equal(stillUnknown.state, "unknown");
  assert.equal(stillUnknown.steps[1]?.status, "ready");
  assert.equal(remote.applyCalls, 1);
});

test("authoritative no-effect reconciliation permits a same-key retry", async () => {
  const keys: string[] = [];
  const adapter: Adapter = {
    plan: () => [{ id: "one", payload: {} }],
    apply: async (_step, key) => {
      keys.push(key);
      return keys.length === 1 ? { kind: "unknown", reason: "response lost" } : { kind: "applied", remoteRef: "one" };
    },
    reconcile: async () => ({ kind: "not_applied", reason: "Authoritative terminal no-effect receipt" })
  };
  const { engine, draft, certificate } = ready(adapter);
  const run = await engine.publish(draft.id, certificate);
  assert.equal((await engine.resume(run.id)).state, "published");
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("one local run cannot be advanced by concurrent callers", async () => {
  let finish!: (outcome: Outcome) => void;
  let calls = 0;
  const adapter: Adapter = {
    plan: () => [{ id: "one", payload: {} }],
    apply: async () => { calls++; return new Promise<Outcome>(resolve => { finish = resolve; }); },
    reconcile: async () => ({ kind: "unknown", reason: "in flight" })
  };
  const { engine, draft, certificate } = ready(adapter);
  const pending = engine.publish(draft.id, certificate);
  const snapshot = await engine.publish(draft.id, certificate);
  await assert.rejects(engine.resume(snapshot.id), /RUN_BUSY/);
  finish({ kind: "applied", remoteRef: "one" });
  assert.equal((await pending).state, "published");
  assert.equal(calls, 1);
});

test("a rejected second step preserves the first receipt and stops execution", async () => {
  let calls = 0;
  const adapter: Adapter = {
    plan: () => ["one", "two", "three"].map(id => ({ id, payload: {} })),
    apply: async () => ++calls === 1 ? { kind: "applied", remoteRef: "one" } : { kind: "not_applied", reason: "Rejected" },
    reconcile: async () => ({ kind: "unknown", reason: "not used" })
  };
  const { engine, draft, certificate } = ready(adapter);
  const run = await engine.publish(draft.id, certificate);
  assert.equal(run.state, "failed");
  assert.deepEqual(run.steps.map(s => s.status), ["applied", "failed", "ready"]);
  assert.equal(run.steps[0]?.remoteRef, "one");
  await engine.resume(run.id);
  assert.equal(calls, 2);
});

test("returned snapshots cannot mutate internal state", async () => {
  const { engine, draft, certificate } = ready(new MockAdapter("normal"));
  draft.fields.seats = { kind: "value", value: 99999 };
  assert.deepEqual(engine.getDraft(draft.id).fields.seats, { kind: "value", value: 2 });
  const run = await engine.publish(draft.id, certificate);
  run.events.length = 0;
  run.steps[0]!.status = "ready";
  assert.ok(engine.getRun(run.id).events.length);
  assert.equal(engine.getRun(run.id).steps[0]?.status, "applied");
});
