import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType } from "../src/index.js";
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
