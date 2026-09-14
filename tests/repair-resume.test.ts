import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite } from "../src/index.js";
import type { ApplyOutcome, GraphExecutor, GraphOp, ReconcileOutcome } from "../src/index.js";
import { definition, selector, initial, chosen, rules, value } from "../examples/fixtures/project-tasks.js";
const fix: GraphOp[] = [{ op: "set", nodeId: "task-1", path: "/owner", value: "chen" }];
const diagnostic = { code: "owner.unavailable", path: "/nodes/task-1/fields/owner", message: "Lin is unavailable; choose another owner.", candidates: [{ value: "chen", repairOps: fix }] };
const plan: GraphExecutor["plan"] = draft => Object.values(draft.nodes).map(node => ({ id: node.id, payload: { name: value(node, "name"), owner: value(node, "owner") },
  effect: { kind: "create", nodeId: node.id }, ...(node.nodeType === "task" ? { dependsOn: ["project-1"], inputRefs: { projectId: "project-1" } } : {}) }));

for (const durable of [false, true]) test(`publish diagnostics -> edit -> resume same Run with history (${durable})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), "stagedwrite-repair-"));
  const storage = durable ? { kind: "sqlite" as const, path: join(dir, "runs.sqlite") } : undefined;
  const sent: { id: string; key: string; owner: unknown }[] = [];
  const executor: GraphExecutor = { ...selector, id: "mock", version: "1", target: "test", plan,
    apply: async (step, key): Promise<ApplyOutcome> => {
      sent.push({ id: step.id, key, owner: step.payload.owner });
      return step.id === "task-1" && step.payload.owner === "lin"
        ? { kind: "not_applied", reason: "Owner unavailable", code: "OWNER_UNAVAILABLE", diagnostics: [diagnostic] }
        : { kind: "applied", remoteRef: `remote-${step.id}` };
    }, reconcile: async () => ({ kind: "unknown", reason: "No evidence" }) };
  const open = () => createStagedWrite({ definitions: [definition], rules, storage, mode: "executable", executors: [executor] });
  let engine = open(); t.after(() => { engine.close(); rmSync(dir, { recursive: true, force: true }); });
  let draft = engine.create(selector, initial); draft = engine.edit(draft.id, 0, chosen);
  const check = engine.preflight(draft.id); const first = await engine.publish(draft.id, check.certificate!);
  assert.equal(first.state, "failed"); assert.deepEqual(first.diagnostics, [diagnostic]);
  assert.equal(first.preview.nodes["task-1"]!.fields.owner!.kind, "value");
  assert.equal(first.steps[1]!.feedback!.code, "OWNER_UNAVAILABLE");
  if (durable) { engine.close(); engine = open(); engine.recover(first.id, { requestId: "claim", expectedSequence: first.events.length, actor: "test", reason: "previous engine closed" }); }
  assert.throws(() => engine.edit(draft.id, draft.version, [{ op: "set", nodeId: "project-1", path: "/name", value: "changed" }]), /APPLIED_STEP_IMMUTABLE/);
  const edited = engine.edit(draft.id, draft.version, first.diagnostics[0]!.candidates![0]!.repairOps!);
  const final = await engine.resume(first.id);
  assert.equal(final.state, "published"); assert.equal(final.id, first.id); assert.equal(final.version, edited.version);
  assert.equal(sent.filter(s => s.id === "project-1").length, 1);
  assert.notEqual(final.steps[1]!.key, first.steps[1]!.key); assert.equal(final.steps[0]!.key, first.steps[0]!.key);
  assert.equal(final.steps[2]!.resolvedPayload!.projectId, "remote-project-1");
  assert.equal(final.repairs![0]!.previousSteps[1]!.key, first.steps[1]!.key);
  assert.equal(engine.getRunInput(first.id).draft.version, edited.version);
  assert.deepEqual(final.diagnostics, []);
  assert.deepEqual(await engine.publish(draft.id, check.certificate!, { runId: first.id }), final);
  if (durable) { engine.close(); engine = open(); assert.deepEqual(engine.getRun(first.id), final); }
});

for (const evidence of ["unknown", "no_effect", "applied"] as const) test(`edited unknown request is reconciled with ORIGINAL input (${evidence})`, async () => {
  const queried: unknown[] = [], sent: unknown[] = [];
  const executor: GraphExecutor = { ...selector, id: "mock", version: "1", target: "test", plan,
    apply: async (step, key) => { sent.push([step.id, key, step.payload.owner]); return step.id === "task-1" && step.payload.owner === "lin" ? { kind: "unknown", reason: "Timed out", code: "TIMEOUT" } : { kind: "applied", remoteRef: step.id }; },
    reconcile: async (step, key): Promise<ReconcileOutcome> => { queried.push([step.payload.owner, key]); return evidence === "applied" ? { kind: "applied", remoteRef: "old-task" } : { kind: evidence, reason: "Evidence" }; } };
  const engine = createStagedWrite({ definitions: [definition], rules, mode: "executable", executors: [executor] });
  try {
    let draft = engine.create(selector, initial); draft = engine.edit(draft.id, 0, chosen);
    const first = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
    assert.equal(first.diagnostics[0]!.code, "TIMEOUT");
    engine.edit(draft.id, draft.version, fix);
    if (evidence === "applied") {
      await assert.rejects(engine.resume(first.id), /APPLIED_STEP_IMMUTABLE/);
      assert.equal(engine.getRun(first.id).steps[1]!.remoteRef, "old-task");
      assert.equal(sent.length, 2);
    } else {
      const resumed = await engine.resume(first.id);
      assert.equal(resumed.state, evidence === "unknown" ? "unknown" : "published");
      assert.equal(sent.length, evidence === "unknown" ? 2 : 4);
    }
    assert.deepEqual(queried, [["lin", first.steps[1]!.key]]);
  } finally { engine.close(); }
});

test("repair preflight can block and return preview without sending; later edit succeeds", async () => {
  let calls = 0;
  const executor: GraphExecutor = { ...selector, id: "mock", version: "1", target: "test", plan,
    apply: async step => { calls++; return step.id === "task-1" && step.payload.owner === "lin" ? { kind: "not_applied", reason: "Owner unavailable", diagnostics: [diagnostic] } : { kind: "applied", remoteRef: step.id }; },
    reconcile: async () => ({ kind: "unknown", reason: "unknown" }) };
  const engine = createStagedWrite({ definitions: [definition], rules, mode: "executable", executors: [executor] });
  try {
    let draft = engine.create(selector, initial); draft = engine.edit(draft.id, 0, chosen);
    const first = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
    const bad = engine.edit(draft.id, draft.version, [{ op: "remove", nodeId: "task-1", path: "/owner" }]);
    const blocked = await engine.resume(first.id); assert.equal(blocked.check!.status, "blocked"); assert.equal(calls, 2);
    assert.deepEqual(blocked.preview.nodes["task-1"]!.fields.owner, { kind: "clear" });
    engine.edit(draft.id, bad.version, fix); assert.equal((await engine.resume(first.id)).state, "published");
  } finally { engine.close(); }
});


test("a repaired request with a new key remains recoverable after response loss", async t => {
  const dir = mkdtempSync(join(tmpdir(), "stagedwrite-repaired-recovery-"));
  const storage = { kind: "sqlite" as const, path: join(dir, "runs.sqlite") };
  let keys: string[] = [];
  const executor: GraphExecutor = { ...selector, id: "mock", version: "1", target: "test", plan,
    apply: async (step, key) => {
      keys.push(key);
      if (step.id !== "task-1") return { kind: "applied", remoteRef: step.id };
      return step.payload.owner === "lin" ? { kind: "not_applied", reason: "Owner unavailable" } : { kind: "unknown", reason: "Lost repaired request response" };
    },
    reconcile: async (step, key) => { assert.equal(step.payload.owner, "chen"); assert.equal(key, keys.at(-1)); return { kind: "applied", remoteRef: "task-1" }; } };
  const open = () => createStagedWrite({ definitions: [definition], rules, storage, mode: "executable", executors: [executor] });
  let engine = open(); t.after(() => { engine.close(); rmSync(dir, { recursive: true, force: true }); });
  let draft = engine.create(selector, initial); draft = engine.edit(draft.id, 0, chosen);
  const failed = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  engine.edit(draft.id, draft.version, fix); const unknown = await engine.resume(failed.id);
  assert.equal(unknown.state, "unknown"); assert.equal(unknown.steps[1]!.requestRevision, 1);
  engine.close(); engine = open();
  engine.recover(unknown.id, { requestId: "claim-repaired", expectedSequence: unknown.events.length, actor: "test", reason: "reopened" });
  assert.equal((await engine.resume(unknown.id)).state, "published");
  assert.equal(keys.length, 4);
});

test("malformed optional diagnostics never discard a confirmed remote receipt", async () => {
  const executor: GraphExecutor = { ...selector, id: "mock", version: "1", target: "test", plan,
    apply: async step => ({ kind: "applied", remoteRef: step.id, get diagnostics(): never { throw new Error("bad optional accessor"); } }),
    reconcile: async () => ({ kind: "unknown", reason: "unknown" }) };
  const engine = createStagedWrite({ definitions: [definition], rules, mode: "executable", executors: [executor] });
  try { let draft = engine.create(selector, initial); draft = engine.edit(draft.id, 0, chosen);
    assert.equal((await engine.publish(draft.id, engine.preflight(draft.id).certificate!)).state, "published");
  } finally { engine.close(); }
});


test("repair planner reentry cannot mutate the draft being validated", async () => {
  let engine: ReturnType<typeof createStagedWrite>;
  let repairing = false;
  const executor: GraphExecutor = { ...selector, id: "mock", version: "1", target: "test",
    plan: draft => {
      if (repairing) assert.throws(() => engine.edit(draft.id, draft.version - 1, fix), /CHECK_BUSY/);
      return plan(draft);
    }, apply: async () => ({ kind: "not_applied", reason: "requires edit" }),
    reconcile: async () => ({ kind: "unknown", reason: "unknown" }) };
  engine = createStagedWrite({ definitions: [definition], rules, mode: "executable", executors: [executor] });
  try { let draft = engine.create(selector, initial); draft = engine.edit(draft.id, 0, chosen);
    await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
    repairing = true;
    assert.equal(engine.edit(draft.id, draft.version, fix).version, draft.version + 1);
  } finally { engine.close(); }
});
