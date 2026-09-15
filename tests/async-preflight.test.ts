import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLegacyStagedWrite } from "../src/index.js";
import type { AsyncGraphRule, AsyncRuleResult, GraphExecutor } from "../src/index.js";
import { definition, selector, initial, rules, chosen } from "../examples/fixtures/project-tasks.js";
const asyncRule = (check: AsyncGraphRule["check"], id = "external.status"): AsyncGraphRule => ({ ...selector, id, version: "1", check });

for (const durable of [false, true]) test(`async pending recheck, publish, recovery and resume (${durable})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), "stagedwrite-async-"));
  const storage = durable ? { kind: "sqlite" as const, path: join(dir, "state.sqlite") } : undefined;
  let ready = false, checks = 0, calls = 0;
  const checker = asyncRule(async () => { checks++; return ready ? { status: "complete", diagnostics: [] } : { status: "pending", message: "Document export is processing.", retryAfterSeconds: 2 }; });
  const executor: GraphExecutor = { ...selector, id: "test", version: "1", target: "mock",
    plan: () => [{ id: "s1", payload: {} }], apply: async () => { calls++; return { kind: "unknown", reason: "receipt pending" }; },
    reconcile: async () => ({ kind: "applied", remoteRef: "r1" }) };
  const open = () => createLegacyStagedWrite({ definitions: [definition], rules, asyncRules: [checker], storage, mode: "executable", executors: [executor] });
  let engine = open(); t.after(() => { engine.close(); rmSync(dir, { recursive: true, force: true }); });
  const draft = engine.create(selector, initial);
  const pending = await engine.preflight(draft.id);
  assert.equal(pending.status, "pending"); assert.equal(pending.diagnostics.length, 3);
  assert.equal(pending.pendingRules![0]!.retryAfterSeconds, 2); assert.equal(pending.certificate, undefined);
  assert.deepEqual(engine.getDraft(draft.id), draft);
  await assert.rejects(engine.publish(draft.id, "no-certificate")); assert.equal(calls, 0);
  if (durable) { engine.close(); engine = open(); assert.deepEqual(engine.getCheck(draft.id), pending); }
  ready = true;
  const blocked = await engine.preflight(draft.id); assert.equal(blocked.status, "blocked"); assert.equal(checks, 2);
  engine.edit(draft.id, draft.version, chosen);
  const passed = await engine.preflight(draft.id); assert.equal(passed.status, "passed"); assert.ok(passed.certificate);
  const run = await engine.publish(draft.id, passed.certificate); assert.equal(run.state, "unknown");
  if (durable) { engine.close(); engine = open(); await engine.recover(run.id, { requestId: "r", expectedSequence: run.events.length, actor: "test", reason: "reopened" }); }
  assert.equal((await engine.resume(run.id)).state, "published"); assert.equal(calls, 1);
});

test("timeouts abort cooperatively, skip remaining rules, release lock and ignore late results", async () => {
  let resolve!: (v: AsyncRuleResult) => void;
  let signal!: AbortSignal; let secondCalls = 0;
  const engine = createLegacyStagedWrite({ definitions: [definition], preflightTimeoutMs: 20,
    asyncRules: [asyncRule(async (_, context) => { signal = context.signal; return new Promise(r => { resolve = r; }); }), asyncRule(async () => { secondCalls++; return { status: "complete", diagnostics: [] }; }, "second")] });
  try {
    const draft = engine.create(selector, initial);
    const result = await engine.preflight(draft.id);
    assert.equal(result.status, "incomplete"); assert.equal(result.diagnostics[0]!.code, "rule.timeout");
    assert.equal(signal.aborted, true); assert.equal(secondCalls, 0); assert.equal(result.pendingRules![0]!.ruleId, "second");
    resolve({ status: "complete", diagnostics: [] }); await new Promise(r => setImmediate(r));
    assert.deepEqual(engine.getCheck(draft.id), result);
    assert.equal(engine.edit(draft.id, draft.version, chosen).version, 1);
  } finally { engine.close(); }
});

test("while awaiting, same-engine edits are blocked; cross-connection edits invalidate the result", async t => {
  const dir = mkdtempSync(join(tmpdir(), "stagedwrite-async-cas-"));
  const storage = { kind: "sqlite" as const, path: join(dir, "state.sqlite") };
  let resolve!: (v: AsyncRuleResult) => void; let started!: () => void;
  const entered = new Promise<void>(r => { started = r; });
  const checker = asyncRule(async () => { started(); return new Promise(r => { resolve = r; }); });
  const first = createLegacyStagedWrite({ definitions: [definition], asyncRules: [checker], storage });
  const second = createLegacyStagedWrite({ definitions: [definition], asyncRules: [checker], storage });
  t.after(() => { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); });
  const draft = first.create(selector, initial); const result = first.preflight(draft.id); await entered;
  assert.throws(() => first.edit(draft.id, 0, chosen), /CHECK_BUSY/);
  assert.throws(() => first.close(), /CHECK_BUSY/);
  await assert.rejects(first.preflight(draft.id), /CHECK_BUSY/);
  second.edit(draft.id, 0, chosen);
  resolve({ status: "complete", diagnostics: [] }); await assert.rejects(result, /STALE_CHECK/);
  assert.throws(() => first.getCheck(draft.id), /CHECK_NOT_CURRENT/);
});

test("async bindings are frozen and versioned; malformed results are incomplete", async () => {
  for (const output of [null, { status: "complete" }, { status: "pending", message: "" }, { status: "pending", message: "wait", retryAfterSeconds: -1 }, { status: "pending", message: "wait", diagnostics: [{ code: "invalid" }] }]) {
    const engine = createLegacyStagedWrite({ definitions: [definition], asyncRules: [asyncRule(async () => output as AsyncRuleResult)] });
    try { assert.equal((await engine.preflight(engine.create(selector, initial).id)).status, "incomplete"); } finally { engine.close(); }
  }
  const checker = asyncRule(async () => ({ status: "complete", diagnostics: [] }));
  const engine = createLegacyStagedWrite({ definitions: [definition], asyncRules: [checker] });
  try {
    const draft = engine.create(selector, initial); const before = await engine.preflight(draft.id);
    checker.version = "changed"; checker.check = async () => { throw new Error("changed"); };
    assert.equal((await engine.preflight(draft.id)).rulesDigest, before.rulesDigest);
    assert.equal((await engine.preflight(draft.id)).status, "passed");
    const other = createLegacyStagedWrite({ definitions: [definition], asyncRules: [checker] });
    try { assert.notEqual((await other.preflight(other.create(selector, initial).id)).rulesDigest, before.rulesDigest); } finally { other.close(); }
  } finally { engine.close(); }
  assert.throws(() => createLegacyStagedWrite({ definitions: [definition], asyncRules: [checker], preflightTimeoutMs: 0 }), /INVALID_PREFLIGHT_TIMEOUT/);
  assert.throws(() => createLegacyStagedWrite({ definitions: [definition], rules: [{ ...checker, check: () => [] }], asyncRules: [checker] }), /RULE_CONFLICT/);
});
