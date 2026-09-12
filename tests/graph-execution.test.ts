import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType, StagedWrite } from "../src/index.js";
import type { GraphExecutor, Step, ApplyOutcome } from "../src/index.js";
const definition = defineDraftType({ id: "example.executable", version: "1", nodeTypes: {
  item: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] }
}, relationTypes: {} });
const selector = { type: definition.id, typeVersion: "1" };
function binding(overrides: Partial<GraphExecutor> = {}): GraphExecutor {
  return { ...selector, id: "example.executor", version: "1", target: "mock:test", plan: d => Object.values(d.nodes).map(n => ({ id: n.id, payload: { name: n.fields.name?.kind === "value" ? n.fields.name.value : null } })),
    apply: async () => ({ kind: "applied", remoteRef: "remote" }), reconcile: async () => ({ kind: "unknown", reason: "no evidence" }), ...overrides };
}
function setup(executor = binding()) {
  const engine = createStagedWrite({ definitions: [definition], mode: "executable", executors: [executor] });
  let draft = engine.create(selector);
  draft = engine.edit(draft.id, 0, [{ op: "node.add", id: "one", nodeType: "item" }, { op: "set", nodeId: "one", path: "/name", value: "first" }]);
  return { engine, draft };
}

test("graph preflight fixes a plan and binds execution identity before dispatch", async () => {
  const plan: Step[] = [{ id: "one", payload: { name: "original" } }];
  let planning = 0, seen = "";
  const { engine, draft } = setup(binding({ plan: () => { planning++; return plan; }, apply: async s => { seen = String(s.payload.name); return { kind: "applied", remoteRef: "remote" }; } }));
  const check = engine.preflight(draft.id);
  assert.equal(check.scope, "execution"); assert.equal(check.status, "passed"); assert.ok(check.certificate);
  assert.equal(check.execution?.target, "mock:test");
  plan[0]!.payload.name = "mutated";
  const run = await engine.publish(draft.id, check.certificate!);
  assert.equal(run.state, "published"); assert.equal(seen, "original"); assert.equal(planning, 1);
  assert.deepEqual(run.binding, check.execution);
  assert.throws(() => engine.edit(draft.id, 1, [{ op: "reset", nodeId: "one", path: "/name" }]), /DRAFT_SEALED/);
  assert.throws(() => engine.preflight(draft.id), /DRAFT_SEALED/);
  assert.deepEqual(await engine.publish(draft.id, check.certificate!), run);
});

test("graph unknown recovery skips earlier effects and reuses the shared state machine", async () => {
  let calls = 0, reconciles = 0;
  const { engine, draft } = setup(binding({ plan: () => [{ id: "a", payload: {} }, { id: "b", payload: {} }],
    apply: async step => { calls++; if (step.id === "b") throw new Error("response lost"); return { kind: "applied", remoteRef: "a" }; },
    reconcile: async () => { reconciles++; return { kind: "applied", remoteRef: "b" }; }
  }));
  const check = engine.preflight(draft.id);
  const run = await engine.publish(draft.id, check.certificate!);
  assert.equal(run.state, "unknown");
  assert.equal((await engine.publish(draft.id, check.certificate!)).state, "unknown");
  const completed = await engine.resume(run.id);
  assert.equal(completed.state, "published"); assert.equal(calls, 2); assert.equal(reconciles, 1);
  assert.deepEqual(completed.steps.map(s => s.remoteRef), ["a", "b"]);
});

test("draft-only mode has no publish and executable assembly rejects missing capabilities", () => {
  const draftOnly = createStagedWrite({ definitions: [definition] });
  assert.equal("publish" in draftOnly, false);
  assert.throws(() => createStagedWrite({ definitions: [definition], mode: "executable", executors: [] }), /EXECUTOR_REQUIRED/);
  assert.throws(() => setup(binding({ reconcile: undefined })), /RECOVERY_CAPABILITY_REQUIRED/);
  assert.throws(() => createStagedWrite({ definitions: [definition], mode: "executable", executors: [binding(), binding()] }), /EXECUTOR_CONFLICT/);
  assert.throws(() => setup(binding({ typeVersion: "missing" })), /TYPE_VERSION_NOT_FOUND/);
  assert.throws(() => setup(binding({ apply: undefined })), /INVALID_EXECUTOR/);
});

test("blocked checks, old certificates and malformed plans cannot dispatch", async () => {
  let calls = 0;
  const { engine, draft } = setup(binding({ apply: async () => { calls++; return { kind: "applied", remoteRef: "one" }; } }));
  const old = engine.preflight(draft.id);
  engine.edit(draft.id, 1, [{ op: "reset", nodeId: "one", path: "/name" }]);
  await assert.rejects(engine.publish(draft.id, old.certificate!), /PREFLIGHT_REQUIRED/);
  assert.equal(engine.preflight(draft.id).certificate, undefined);
  await assert.rejects(engine.publish(draft.id, "fake"), /PREFLIGHT_REQUIRED/);
  assert.equal(calls, 0);
  for (const plan of [[], [{ id: "a", payload: {} }, { id: "a", payload: {} }], [{ id: "a", payload: { nested: [] } }]]) {
    const bad = setup(binding({ plan: () => plan as Step[] }));
    const check = bad.engine.preflight(bad.draft.id);
    assert.equal(check.status, "incomplete"); assert.equal(check.certificate, undefined);
  }
});

test("concurrent graph publish discovers the same run; concurrent resume is rejected", async () => {
  let finish!: (outcome: ApplyOutcome) => void;
  const { engine, draft } = setup(binding({ apply: () => new Promise(resolve => { finish = resolve; }) }));
  const check = engine.preflight(draft.id);
  const pending = engine.publish(draft.id, check.certificate!);
  const observing = await engine.publish(draft.id, check.certificate!);
  assert.equal(observing.state, "running");
  await assert.rejects(engine.resume(observing.id), /RUN_BUSY/);
  finish({ kind: "applied", remoteRef: "one" });
  assert.equal((await pending).id, observing.id);
});

test("explicitly unsupported recovery blocks while preserving the partial run", async () => {
  const { engine, draft } = setup(binding({ apply: async () => ({ kind: "unknown", reason: "lost" }), reconcile: { unsupported: "This API has no lookup" } }));
  const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  const resumed = await engine.resume(run.id);
  assert.equal(resumed.state, "unknown"); assert.ok(resumed.events.at(-1)?.reason?.includes("no lookup"));
});

test("planner reentry cannot edit a graph or leave a usable certificate", () => {
  let engine!: ReturnType<typeof setup>["engine"], draftId = "";
  ({ engine } = setup(binding({ plan: d => { engine.edit(draftId, d.version, [{ op: "reset", nodeId: "one", path: "/name" }]); return []; } })));
  const draft = engine.create(selector); draftId = draft.id;
  engine.edit(draftId, 0, [{ op: "node.add", id: "one", nodeType: "item" }, { op: "set", nodeId: "one", path: "/name", value: "value" }]);
  const check = engine.preflight(draftId);
  assert.equal(check.status, "incomplete"); assert.equal(check.certificate, undefined);
  assert.equal(engine.getDraft(draftId).version, 1);
});


test("both public entries reject invalid dependencies and result references before dispatch", () => {
  const root: Step = { id: "parent", payload: {} };
  const invalid: unknown[] = [
    [{ id: "child", payload: {}, dependsOn: ["parent"] }, root],
    [root, { id: "child", payload: {}, dependsOn: ["missing"] }],
    [{ ...root, dependsOn: ["parent"] }],
    [root, { id: "child", payload: {}, dependsOn: ["parent", "parent"] }],
    [root, { id: "child", payload: {}, inputRefs: { parentId: "parent" } }],
    [root, { id: "child", payload: { parentId: "literal" }, dependsOn: ["parent"], inputRefs: { parentId: "parent" } }],
    [{ ...root, dependsOn: null }], [{ ...root, inputRefs: [] }],
    [{ ...root, payload: { bad: Infinity } }]
  ];
  for (const plan of invalid) {
    const { engine, draft } = setup(binding({ plan: () => plan as Step[] }));
    assert.equal(engine.preflight(draft.id).certificate, undefined);
    const old = new StagedWrite({ plan: () => plan as Step[], apply: async () => { throw new Error("must not dispatch"); }, reconcile: async () => ({ kind: "unknown", reason: "test" }) }, []);
    assert.throws(() => old.preflight(old.create().id), /INVALID_PLAN/);
  }
});

const dependentPlan: Step[] = [
  { id: "parent", payload: { name: "campaign" } },
  { id: "child", payload: { name: "adset" }, dependsOn: ["parent"], inputRefs: { campaignId: "parent" } }
];
test("recovered parent result feeds child and frozen child inputs survive retries and reconciliation", async () => {
  const calls: { id: string; key: string; payload: Step["payload"] }[] = [];
  let childCalls = 0;
  const { engine, draft } = setup(binding({ plan: () => dependentPlan,
    apply: async (s, key) => {
      calls.push({ id: s.id, key, payload: structuredClone(s.payload) });
      if (s.id === "parent") return { kind: "unknown", reason: "lost parent response" };
      assert.equal(s.payload.campaignId, "remote_campaign");
      s.payload.campaignId = "adapter mutation";
      return ++childCalls === 1 ? { kind: "not_applied", retryable: true, reason: "limited" } : { kind: "unknown", reason: "lost child response" };
    },
    reconcile: async s => {
      if (s.id === "child") assert.equal(s.payload.campaignId, "remote_campaign");
      return { kind: "applied", remoteRef: s.id === "parent" ? "remote_campaign" : "remote_adset" };
    }
  }));
  const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  assert.equal(run.state, "unknown"); assert.equal(calls.length, 1);
  assert.equal((await engine.resume(run.id)).state, "blocked");
  assert.equal((await engine.resume(run.id)).state, "unknown");
  const finished = await engine.resume(run.id);
  assert.equal(finished.state, "published");
  assert.deepEqual(calls.map(c => c.id), ["parent", "child", "child"]);
  assert.deepEqual(calls[1], calls[2]);
  assert.deepEqual(finished.steps[1]?.payload, { name: "adset" });
  assert.equal(finished.steps[1]?.resolvedPayload?.campaignId, "remote_campaign");
});

test("terminal failure marks all remaining steps skipped with distinct reasons", async () => {
  const { engine, draft } = setup(binding({ plan: () => [...dependentPlan,
    { id: "grandchild", payload: {}, dependsOn: ["child"] }, { id: "independent", payload: {} }],
    apply: async () => ({ kind: "not_applied", reason: "invalid name", retryable: false }) }));
  const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  assert.deepEqual(run.steps.map(s => s.status), ["failed", "skipped", "skipped", "skipped"]);
  assert.deepEqual(run.steps.slice(1).map(s => s.skipReason), ["dependency_failed", "dependency_failed", "run_stopped"]);
  assert.deepEqual(run.steps.slice(1).map(s => s.blockedBy), ["parent", "child", "parent"]);
  assert.equal(run.events.filter(e => e.kind === "skipped").length, 3);
  assert.deepEqual(await engine.resume(run.id), run);
});

test("zero-effect revision keeps source sealed, preserves history and requires a new certificate", async () => {
  let refused = true;
  const { engine, draft } = setup(binding({ apply: async () => refused ? { kind: "not_applied", reason: "name rejected" } : { kind: "applied", remoteRef: "created" } }));
  const check = engine.preflight(draft.id);
  const run = await engine.publish(draft.id, check.certificate!);
  const revised = engine.revise(run.id);
  assert.notEqual(revised.id, draft.id); assert.equal(revised.version, 0); assert.equal(revised.sourceRunId, run.id);
  assert.deepEqual(revised.nodes, draft.nodes);
  assert.equal(engine.revise(run.id).id, revised.id);
  assert.throws(() => engine.edit(draft.id, draft.version, []), /DRAFT_SEALED/);
  await assert.rejects(engine.publish(revised.id, check.certificate!), /PREFLIGHT_REQUIRED/);
  engine.edit(revised.id, 0, [{ op: "set", nodeId: "one", path: "/name", value: "fixed" }]);
  refused = false;
  const next = await engine.publish(revised.id, engine.preflight(revised.id).certificate!);
  assert.equal(next.state, "published"); assert.notEqual(next.steps[0]?.key, run.steps[0]?.key);
  assert.deepEqual(engine.getRun(run.id), run);
  assert.deepEqual(await engine.publish(draft.id, check.certificate!), run);
  assert.equal(engine.getDraft(draft.id).nodes.one?.fields.name?.kind, "value");
});

test("revision rejects uncertain, retryable, successful and partially applied runs", async () => {
  for (const outcome of [
    { kind: "unknown", reason: "lost" }, { kind: "not_applied", reason: "limited", retryable: true }, { kind: "applied", remoteRef: "exists" }
  ] as ApplyOutcome[]) {
    const { engine, draft } = setup(binding({ apply: async () => outcome }));
    const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
    assert.throws(() => engine.revise(run.id), /ZERO_EFFECT_FAILURE_REQUIRED/);
  }
  const { engine, draft } = setup(binding({ plan: () => dependentPlan, apply: async s => s.id === "parent" ?
    { kind: "applied", remoteRef: "exists" } : { kind: "not_applied", reason: "bad child" } }));
  const partial = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  assert.equal(partial.state, "failed");
  assert.throws(() => engine.revise(partial.id), /ZERO_EFFECT_FAILURE_REQUIRED/);
});
