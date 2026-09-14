import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStagedWrite } from "../src/index.js";
import type { GraphExecutor, PublishOptions } from "../src/index.js";
const selector = { type: "multi", typeVersion: "1" };
const definition = { id: "multi", version: "1", nodeTypes: { item: {
  valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"]
} }, relationTypes: {} };
function executor(overrides: Partial<GraphExecutor> = {}): GraphExecutor {
  return { ...selector, id: "multi-executor", version: "1", target: "mock", plan: d => [{ id: "one", payload: { name: d.nodes.one!.fields.name!.kind === "value" ? d.nodes.one!.fields.name!.value : null } }],
    apply: async (_, key) => ({ kind: "applied", remoteRef: `remote-${key}` }), reconcile: async () => ({ kind: "unknown", reason: "fixture" }), ...overrides };
}
function ready(engine: ReturnType<typeof create>) {
  const d = engine.create(selector);
  engine.edit(d.id, 0, [{ op: "node.add", id: "one", nodeType: "item" }, { op: "set", nodeId: "one", path: "/name", value: "original" }]);
  return { id: d.id, certificate: engine.preflight(d.id).certificate! };
}
function create(path?: string, ex = executor()) {
  return createStagedWrite({ definitions: [definition], mode: "executable", executors: [ex], ...(path ? { storage: { kind: "sqlite", path } as const } : {}) });
}
for (const durable of [false, true]) test(`independent publish and idempotent submission have distinct identities (${durable ? "SQLite" : "memory"})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sw-multi-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keys: string[] = []; const e = create(durable ? join(dir, "data.sqlite") : undefined, executor({ apply: async (_, key) => { keys.push(key); return { kind: "applied", remoteRef: key }; } })); t.after(() => e.close());
  const d = ready(e);
  const a = await e.publish(d.id, d.certificate, { runId: "intent-a" });
  assert.deepEqual(await e.publish(d.id, d.certificate, { runId: "intent-a" }), a);
  const b = await e.publish(d.id, d.certificate, { runId: "intent-b" });
  assert.notEqual(a.id, b.id); assert.equal(a.draftId, b.draftId);
  assert.deepEqual(keys, ["intent-a:one", "intent-b:one"]);
  const c = await e.publish(d.id, d.certificate); const f = await e.publish(d.id, d.certificate);
  assert.notEqual(c.id, f.id); assert.equal(keys.length, 4);
  assert.deepEqual(await e.resume(a.id), a); assert.equal(keys.length, 4);
  const input = e.getRunInput(a.id); input.plan[0]!.payload.name = "mutated"; input.draft.nodes.one!.fields.name = { kind: "clear" };
  assert.equal(e.getRunInput(a.id).plan[0]!.payload.name, "original");
  const newCheck = e.preflight(d.id);
  assert.deepEqual(await e.publish(d.id, d.certificate, { runId: a.id }), a); // Old submission remains discoverable.
  await assert.rejects(e.publish(d.id, newCheck.certificate!, { runId: a.id }), /RUN_ID_CONFLICT/);
  await assert.rejects(e.publish(d.id, d.certificate, { runId: "stale-new-intent" }), /PREFLIGHT_REQUIRED/);
  const other = ready(e);
  await assert.rejects(e.publish(other.id, other.certificate, { runId: a.id }), /RUN_ID_CONFLICT/);
  for (const runId of ["", "a:b", "a/b", "x".repeat(129)]) await assert.rejects(e.publish(other.id, other.certificate, { runId }), /INVALID_PUBLISH_OPTIONS/);
  await assert.rejects(e.publish(other.id, other.certificate, { runId: "valid", extra: true } as PublishOptions), /INVALID_PUBLISH_OPTIONS/);
  assert.equal(keys.length, 4);
});

test("two persisted Runs recover from their own inputs after the latest draft plan is replaced", async t => {
  const dir = mkdtempSync(join(tmpdir(), "sw-multi-recover-")); t.after(() => rmSync(dir, { recursive: true, force: true })); const path = join(dir, "data.sqlite");
  let sends = 0;
  const first = create(path, executor({ apply: async () => { sends++; return { kind: "unknown", reason: "response lost" }; } }));
  const d = ready(first);
  const a = await first.publish(d.id, d.certificate, { runId: "a" });
  const next = first.preflight(d.id); // Overwrites the draft plan's check binding.
  const b = await first.publish(d.id, next.certificate!, { runId: "b" }); first.close();
  const second = create(path, executor({ plan: () => { throw new Error("no replanning during recovery"); },
    apply: async () => { sends++; throw new Error("already applied"); },
    reconcile: async (step, key) => { assert.equal(step.payload.name, "original"); return { kind: "applied", remoteRef: key }; }
  })); t.after(() => second.close());
  assert.equal(second.preflight(d.id).status, "incomplete"); // Removes the latest draft plan entirely.
  for (const prior of [a, b]) {
    assert.deepEqual(await second.publish(d.id, second.getRunInput(prior.id).certificate, { runId: prior.id }), prior);
    second.recover(prior.id, { requestId: `recover-${prior.id}`, expectedSequence: prior.events.length, actor: "test", reason: "previous owner closed" });
    const done = await second.resume(prior.id);
    assert.equal(done.id, prior.id); assert.equal(done.state, "published");
    assert.equal(done.steps[0]?.remoteRef, `${prior.id}:one`);
  }
  assert.equal(sends, 2);
  assert.deepEqual(second.listRunIds(), ["a", "b"]);
});

test("publication transaction failure leaves no orphan and the same runId can be submitted again", async t => {
  const dir = mkdtempSync(join(tmpdir(), "sw-multi-atomic-")); t.after(() => rmSync(dir, { recursive: true, force: true })); const path = join(dir, "data.sqlite");
  let calls = 0; const e = create(path, executor({ apply: async () => { calls++; return { kind: "applied", remoteRef: "one" }; } })); t.after(() => e.close()); const d = ready(e);
  const db = new DatabaseSync(path); t.after(() => db.close());
  db.exec("CREATE TRIGGER reject_input BEFORE INSERT ON sw_run_inputs BEGIN SELECT RAISE(ABORT, 'fixture input failure'); END;");
  await assert.rejects(e.publish(d.id, d.certificate, { runId: "retry" }), /fixture input failure/);
  assert.deepEqual(e.listRunIds(), []); assert.equal(calls, 0);
  db.exec("DROP TRIGGER reject_input");
  assert.equal((await e.publish(d.id, d.certificate, { runId: "retry" })).state, "published");
  assert.equal(calls, 1);
});


test("independent Runs on the same Draft may progress concurrently without sharing busy state", async () => {
  const finish = new Map<string, (value: { kind: "applied"; remoteRef: string }) => void>();
  const e = create(undefined, executor({ apply: (_, key) => new Promise(resolve => { finish.set(key, resolve); }) }));
  const d = ready(e);
  const a = e.publish(d.id, d.certificate, { runId: "parallel-a" });
  const b = e.publish(d.id, d.certificate, { runId: "parallel-b" });
  assert.equal(finish.size, 2);
  assert.equal((await e.publish(d.id, d.certificate, { runId: "parallel-a" })).state, "running");
  assert.throws(() => e.close(), /RUN_BUSY/);
  finish.get("parallel-a:one")!({ kind: "applied", remoteRef: "a" });
  assert.equal((await a).state, "published");
  assert.equal(e.getRun("parallel-b").state, "running");
  finish.get("parallel-b:one")!({ kind: "applied", remoteRef: "b" });
  assert.equal((await b).state, "published"); e.close();
});
