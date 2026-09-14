import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite } from "../src/index.js";
import type { GraphDraft, GraphExecutor, Step, ApplyOutcome } from "../src/index.js";
const selector = { type: "continue", typeVersion: "1" };
const definition = { id: "continue", version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] } }, relationTypes: {} };
const plan = (d: GraphDraft): Step[] => Object.values(d.nodes).map(n => ({ id: n.id, effect: { kind: "create", nodeId: n.id },
  payload: { name: n.fields.name?.kind === "value" ? n.fields.name.value : null },
  ...(n.id === "child" ? { dependsOn: ["parent"], inputRefs: { parentId: "parent" } } : {}) }));
function setup(overrides: Partial<GraphExecutor> = {}) {
  const calls: { id: string; key: string }[] = [];
  const engine = createStagedWrite({ definitions: [definition], mode: "executable", executors: [{ ...selector,
    id: "create", version: "1", target: "mock", plan,
    apply: async (s, key): Promise<ApplyOutcome> => { calls.push({ id: s.id, key });
      if (s.id === "child") { assert.equal(s.payload.parentId, "remote-parent"); if (s.payload.name === "bad") return { kind: "not_applied", reason: "bad child" }; }
      return { kind: "applied", remoteRef: `remote-${s.id}` };
    }, reconcile: { unsupported: "none" }, ...overrides }] });
  const draft = engine.create(selector);
  engine.edit(draft.id, 0, [ { op: "node.add", id: "parent", nodeType: "item" }, { op: "set", nodeId: "parent", path: "/name", value: "parent" },
    { op: "node.add", id: "child", nodeType: "item" }, { op: "set", nodeId: "child", path: "/name", value: "bad" } ]);
  const check = engine.preflight(draft.id);
  return { engine, draft, calls, check, publish: () => engine.publish(draft.id, check.certificate!, { runId: "fixture-submission" }) };
}
test("partial failure continues only the changed child and retains source receipts and keys", async () => {
  const { engine, calls, publish, check, draft } = setup(); const source = await publish();
  const next = engine.continueFrom(source.id);
  assert.equal(next.version, 0); assert.notEqual(next.id, draft.id);
  assert.equal(engine.continueFrom(source.id).id, next.id);
  next.continuation!.receipts.parent!.remoteRef = "forged";
  assert.equal(engine.getDraft(next.id).continuation?.receipts.parent?.remoteRef, "remote-parent");
  await assert.rejects(engine.publish(next.id, check.certificate!), /PREFLIGHT_REQUIRED/);
  engine.edit(next.id, 0, [{ op: "set", nodeId: "child", path: "/name", value: "fixed" }]);
  const checked = engine.preflight(next.id); assert.ok(checked.execution?.continuationDigest);
  const finished = await engine.publish(next.id, checked.certificate!);
  assert.equal(finished.state, "published");
  assert.deepEqual(finished.steps.map(s => s.status), ["reused", "applied"]);
  assert.deepEqual(calls.map(c => c.id), ["parent", "child", "child"]);
  assert.notEqual(calls[1]?.key, calls[2]?.key);
  assert.equal(finished.events[0]?.kind, "reused");
  assert.equal(finished.steps[0]?.reusedFrom?.sourceRunId, source.id);
  assert.deepEqual(engine.getRun(source.id), source);
  assert.deepEqual(await engine.publish(draft.id, check.certificate!, { runId: source.id }), source);
});
test("successful node edits and deletion are rejected by both preview and edit", async () => {
  const { engine, publish } = setup(); const source = await publish(); const next = engine.continueFrom(source.id);
  for (const ops of [[{ op: "set" as const, nodeId: "parent", path: "/name", value: "changed" }], [{ op: "node.remove" as const, id: "parent" }]]) {
    assert.throws(() => engine.preview(next.id, 0, ops), /REUSED_NODE_IMMUTABLE/);
    assert.throws(() => engine.edit(next.id, 0, ops), /REUSED_NODE_IMMUTABLE/);
  }
  assert.deepEqual(engine.getDraft(next.id), next);
});
test("changed or omitted reused plan intent cannot obtain a certificate", async () => {
  for (const mode of ["payload", "id", "mapping", "omit"]) {
    let changed = false;
    const { engine, publish } = setup({ plan: d => { const steps = plan(d); if (changed) {
      if (mode === "payload") steps[0]!.payload.name = "different";
      if (mode === "id") { steps[0]!.id = "renamed"; steps[1]!.dependsOn = ["renamed"]; steps[1]!.inputRefs = { parentId: "renamed" }; }
      if (mode === "mapping") delete steps[0]!.effect;
      if (mode === "omit") return [{ id: "child", payload: {}, effect: { kind: "create", nodeId: "child" } }];
    } return steps; } });
    const source = await publish(); const next = engine.continueFrom(source.id); changed = true;
    assert.equal(engine.preflight(next.id).certificate, undefined);
  }
});
test("only mapped terminal partial failures can continue", async () => {
  for (const outcome of [{ kind: "unknown", reason: "lost" }, { kind: "not_applied", reason: "no", retryable: true },
    { kind: "not_applied", reason: "no" }, { kind: "applied", remoteRef: "ok" }] as ApplyOutcome[]) {
    const { engine, publish } = setup({ apply: async () => outcome }); const run = await publish();
    assert.throws(() => engine.continueFrom(run.id), /PARTIAL_FAILURE_REQUIRED/);
  }
  const { engine, publish } = setup({ plan: d => plan(d).map(({ effect, ...s }) => s) }); const run = await publish();
  assert.throws(() => engine.continueFrom(run.id), /CREATE_MAPPING_REQUIRED/);
});
test("continuations can be repeated after another child refusal without replaying the parent", async () => {
  const { engine, publish, calls } = setup(); const first = await publish(); const secondDraft = engine.continueFrom(first.id);
  const second = await engine.publish(secondDraft.id, engine.preflight(secondDraft.id).certificate!);
  assert.equal(second.state, "failed"); assert.equal(second.steps[0]?.status, "reused");
  assert.throws(() => engine.revise(second.id), /ZERO_EFFECT_FAILURE_REQUIRED/);
  const third = engine.continueFrom(second.id);
  engine.edit(third.id, 0, [{ op: "set", nodeId: "child", path: "/name", value: "fixed" }]);
  const finished = await engine.publish(third.id, engine.preflight(third.id).certificate!);
  assert.equal(finished.state, "published"); assert.equal(calls.filter(c => c.id === "parent").length, 1);
  assert.equal(finished.steps[0]?.reusedFrom?.sourceRunId, second.id);
});
test("mapped plans reject nonexistent and multiply mapped nodes", () => {
  for (const nodeId of ["parent", "missing"]) {
    const { check } = setup({ plan: d => { const steps = plan(d); steps[1]!.effect = { kind: "create", nodeId }; return steps; } });
    assert.equal(check.certificate, undefined);
  }
});

test("manually verified parent receipts can continue after a final child refusal", async () => {
  const { engine, publish } = setup({ apply: async s => s.id === "parent" ? { kind: "unknown", reason: "lost" } : { kind: "not_applied", reason: "bad child" } });
  const unknown = await publish();
  engine.adjudicate(unknown.id, "parent", { requestId: "verified-parent", expectedSequence: unknown.events.length,
    actor: "operator", evidence: "receipt:parent", note: "Verified exact creation", decision: { kind: "applied", remoteRef: "verified-parent" } });
  const failed = await engine.resume(unknown.id);
  const next = engine.continueFrom(failed.id);
  const continued = await engine.publish(next.id, engine.preflight(next.id).certificate!);
  assert.equal(continued.steps[0]?.status, "reused");
  assert.equal(continued.steps[1]?.resolvedPayload?.parentId, "verified-parent");
  assert.equal(engine.getRun(failed.id).events.filter(e => e.kind === "adjudicated").length, 1);
});

test("new unknown child recovery reuses the original parent receipt and never recreates it", async () => {
  let childCalls = 0, parentCalls = 0;
  const { engine, publish } = setup({ apply: async s => {
    if (s.id === "parent") { parentCalls++; return { kind: "applied", remoteRef: "remote-parent" }; }
    assert.equal(s.payload.parentId, "remote-parent");
    return ++childCalls === 1 ? { kind: "not_applied", reason: "bad" } : { kind: "unknown", reason: "lost child response" };
  }, reconcile: async s => { assert.equal(s.payload.parentId, "remote-parent"); return { kind: "applied", remoteRef: "remote-child" }; } });
  const first = await publish(); const next = engine.continueFrom(first.id);
  const unknown = await engine.publish(next.id, engine.preflight(next.id).certificate!);
  assert.equal(unknown.state, "unknown");
  assert.throws(() => engine.continueFrom(unknown.id), /PARTIAL_FAILURE_REQUIRED/);
  const finished = await engine.resume(unknown.id);
  assert.equal(finished.state, "published"); assert.equal(parentCalls, 1); assert.equal(childCalls, 2);
});
