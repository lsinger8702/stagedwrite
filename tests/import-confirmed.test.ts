import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLegacyStagedWrite } from "../src/index.js";
import type { GraphDraft, GraphExecutor, ImportConfirmedRequest, Run, Step } from "../src/index.js";
const selector = { type: "imports", typeVersion: "1" };
const definition = { id: selector.type, version: "1", nodeTypes: { item: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false } } }, relationTypes: { uses: { from: ["item"], to: ["item"] } } };
function plan(d: GraphDraft): Step[] { return Object.values(d.nodes).map(n => ({ id: n.id, payload: { name: n.fields.name?.kind === "value" ? n.fields.name.value : n.id }, effect: { kind: "create", nodeId: n.id }, ...(n.id !== "project" ? { dependsOn: ["project"], inputRefs: { projectId: "project" } } : {}) })); }
function open(path?: string, overrides: Partial<GraphExecutor> = {}) {
  return createLegacyStagedWrite({ definitions: [definition], mode: "executable", ...(path ? { storage: { kind: "sqlite" as const, path } } : {}), executors: [{ ...selector, id: "mock", version: "1", target: "mock:local", plan,
    apply: async s => s.id === "uncertain" ? { kind: "unknown", reason: "lost" } : { kind: "applied", remoteRef: `remote-${s.id}` }, reconcile: { unsupported: "fixture" }, ...overrides }] });
}
const request = (run: Run, requestId = "import-1"): ImportConfirmedRequest => ({ requestId, expectedSequence: run.events.length, actor: "operator", evidence: "receipt-ledger", purpose: "Independent follow-up task", independentWork: true });
async function closed(engine: ReturnType<typeof open>) {
  const draft = engine.create(selector); engine.edit(draft.id, 0, [{ op: "node.add", id: "project", nodeType: "item" }, { op: "node.add", id: "uncertain", nodeType: "item" }, { op: "edge.add", id: "old-edge", relationType: "uses", from: "project", to: "uncertain" }]);
  const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  return engine.adjudicate(run.id, "uncertain", { requestId: "close", expectedSequence: run.events.length, actor: "operator", evidence: "search-inconclusive", note: "Stop this run", decision: { kind: "close_unresolved" } });
}
function file(t: { after(fn: () => void): void }) { const dir = mkdtempSync(join(tmpdir(), "sw-import-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "state.sqlite"); }

test("import confirmed objects from closed without copying or retrying unresolved work", async () => {
  const calls: string[] = []; const engine = open(undefined, { apply: async s => { calls.push(s.id); return s.id === "uncertain" ? { kind: "unknown", reason: "lost" } : { kind: "applied", remoteRef: `remote-${s.id}` }; } });
  const source = await closed(engine); const draft = engine.importConfirmed(source.id, request(source));
  assert.deepEqual(Object.keys(draft.nodes), ["project"]); assert.deepEqual(draft.edges, {});
  assert.deepEqual(draft.tombstones, { nodes: ["uncertain"], edges: ["old-edge"] });
  assert.equal(draft.imported?.receipts.project?.remoteRef, "remote-project");
  assert.throws(() => engine.edit(draft.id, 0, [{ op: "node.add", id: "uncertain", nodeType: "item" }]), /ID_ALREADY_USED/);
  engine.edit(draft.id, 0, [{ op: "node.add", id: "new-task", nodeType: "item" }]);
  const check = engine.preflight(draft.id); assert.ok(check.execution?.importDigest);
  const result = await engine.publish(draft.id, check.certificate!);
  assert.equal(result.state, "published"); assert.deepEqual(result.steps.map(s => s.status), ["reused", "applied"]);
  assert.equal(result.steps[1]?.resolvedPayload?.projectId, "remote-project");
  assert.deepEqual(calls, ["project", "uncertain", "new-task"]); assert.deepEqual(engine.getRun(source.id), source);
  assert.throws(() => engine.continueFrom(source.id), /PARTIAL_FAILURE_REQUIRED/); engine.close();
});

test("import commands and reused nodes cannot be edited or forged", async () => {
  const engine = open(); const source = await closed(engine), command = request(source); const draft = engine.importConfirmed(source.id, command);
  command.purpose = "mutated"; draft.imported!.receipts.project!.remoteRef = "forged";
  assert.equal(engine.getDraft(draft.id).imported?.receipts.project?.remoteRef, "remote-project");
  assert.equal(engine.getDraft(draft.id).imported?.command.purpose, "Independent follow-up task");
  for (const operation of [{ op: "set" as const, nodeId: "project", path: "/name", value: "changed" }, { op: "node.remove" as const, id: "project" }]) {
    assert.throws(() => engine.preview(draft.id, 0, [operation]), /REUSED_NODE_IMMUTABLE/);
    assert.throws(() => engine.edit(draft.id, 0, [operation]), /REUSED_NODE_IMMUTABLE/);
  } engine.close();
});

test("import idempotency survives edits and reopen, and conflicting commands fail", async t => {
  const path = file(t); const first = open(path); const source = await closed(first); const command = request(source);
  const draft = first.importConfirmed(source.id, command); first.edit(draft.id, 0, [{ op: "node.add", id: "new-task", nodeType: "item" }]); first.close();
  const next = open(path); assert.equal(next.importConfirmed(source.id, command).id, draft.id); assert.equal(next.importConfirmed(source.id, command).version, 1);
  assert.throws(() => next.importConfirmed(source.id, { ...command, evidence: "different" }), /IMPORT_CONFLICT/);
  assert.notEqual(next.importConfirmed(source.id, request(source, "separate-work")).id, draft.id); next.close();
});

test("failed import transaction leaves no orphan draft or request record", async t => {
  const path = file(t); const engine = open(path); const source = await closed(engine); const ids = engine.listDraftIds(); const db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER reject_import BEFORE INSERT ON sw_imports BEGIN SELECT RAISE(ABORT, 'import failure'); END;");
  assert.throws(() => engine.importConfirmed(source.id, request(source)), /import failure/); assert.deepEqual(engine.listDraftIds(), ids);
  db.exec("DROP TRIGGER reject_import"); assert.ok(engine.importConfirmed(source.id, request(source)).imported); db.close(); engine.close();
});

test("invalid, stale, nonterminal and zero-receipt imports are rejected", async () => {
  const engine = open(); const source = await closed(engine); const ids = engine.listDraftIds();
  for (const command of [{ ...request(source), independentWork: false }, { ...request(source), actor: " " }, { ...request(source), extra: true }]) {
    assert.throws(() => engine.importConfirmed(source.id, command as ImportConfirmedRequest), /INVALID_IMPORT_REQUEST/);
  }
  assert.throws(() => engine.importConfirmed(source.id, { ...request(source), expectedSequence: 0 }), /STALE_RUN/);
  assert.deepEqual(engine.listDraftIds(), ids); engine.close();
  for (const final of [false, true]) {
    const other = open(undefined, { apply: async () => final ? { kind: "not_applied", reason: "refused" } : { kind: "unknown", reason: "lost" } });
    const d = other.create(selector); other.edit(d.id, 0, [{ op: "node.add", id: "project", nodeType: "item" }]);
    const r = await other.publish(d.id, other.preflight(d.id).certificate!);
    assert.throws(() => other.importConfirmed(r.id, request(r)), final ? /CONFIRMED_RECEIPT_REQUIRED/ : /TERMINAL_SOURCE_REQUIRED/); other.close();
  }
});

test("changed target rejects import and changed reused intent cannot publish", async t => {
  const path = file(t); const first = open(path); const source = await closed(first); first.close();
  const changed = open(path, { target: "mock:other" }); assert.throws(() => changed.importConfirmed(source.id, request(source)), /EXECUTOR_BINDING_MISMATCH/); changed.close();
  const next = open(path, { plan: d => plan(d).map(s => ({ ...s, payload: { changed: true } })) });
  const draft = next.importConfirmed(source.id, request(source)); const check = next.preflight(draft.id); assert.equal(check.status, "incomplete"); assert.equal(check.certificate, undefined); next.close();
});

test("an imported run recovers after reopen without recreating the existing object", async t => {
  const path = file(t); const first = open(path); const source = await closed(first); const draft = first.importConfirmed(source.id, request(source));
  first.edit(draft.id, 0, [{ op: "node.add", id: "fresh", nodeType: "item" }]); first.close(); let applies = 0;
  const next = open(path, { apply: async s => { applies++; assert.equal(s.id, "fresh"); return { kind: "unknown", reason: "lost fresh receipt" }; } });
  const unknown = await next.publish(draft.id, next.preflight(draft.id).certificate!); assert.equal(unknown.steps[0]?.status, "reused"); next.close();
  const third = open(path, { apply: async () => { applies++; return { kind: "unknown", reason: "must not apply" }; }, reconcile: async s => { assert.equal(s.payload.projectId, "remote-project"); return { kind: "applied", remoteRef: "remote-fresh" }; } });
  third.recover(unknown.id, { requestId: "recover", expectedSequence: unknown.events.length, actor: "operator", reason: "reopened" });
  assert.equal((await third.resume(unknown.id)).state, "published"); assert.equal(applies, 1); third.close();
});

test("partial failure of independent work can continue with the imported receipt", async () => {
  const engine = open(undefined, { apply: async s => s.id === "uncertain" ? { kind: "unknown", reason: "lost" } : s.id === "fresh" ? { kind: "not_applied", reason: "refused" } : { kind: "applied", remoteRef: "remote-project" } });
  const source = await closed(engine); const imported = engine.importConfirmed(source.id, request(source));
  engine.edit(imported.id, 0, [{ op: "node.add", id: "fresh", nodeType: "item" }]);
  const failed = await engine.publish(imported.id, engine.preflight(imported.id).certificate!);
  const next = engine.continueFrom(failed.id); assert.equal(next.imported, undefined); assert.equal(next.continuation?.receipts.project?.sourceRunId, failed.id);
  assert.equal(engine.preflight(next.id).status, "passed"); assert.throws(() => engine.edit(next.id, 0, [{ op: "node.add", id: "uncertain", nodeType: "item" }]), /ID_ALREADY_USED/); engine.close();
});

test("a published source can be imported with all dependencies reused and no new dispatch", async () => {
  let calls = 0;
  const engine = open(undefined, { apply: async s => { calls++; return { kind: "applied", remoteRef: `remote-${s.id}` }; } });
  const original = engine.create(selector); engine.edit(original.id, 0, [{ op: "node.add", id: "project", nodeType: "item" }, { op: "node.add", id: "done-task", nodeType: "item" }, { op: "edge.add", id: "edge", relationType: "uses", from: "project", to: "done-task" }]);
  const source = await engine.publish(original.id, engine.preflight(original.id).certificate!);
  const draft = engine.importConfirmed(source.id, request(source)); assert.equal(Object.keys(draft.edges).length, 1);
  const result = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  assert.deepEqual(result.steps.map(s => s.status), ["reused", "reused"]); assert.equal(calls, 2); engine.close();
});

test("unmapped sources and planners that omit imported steps cannot bypass reuse", async () => {
  const unmapped = open(undefined, { plan: d => plan(d).map(({ effect, ...s }) => s) }); const source = await closed(unmapped);
  assert.throws(() => unmapped.importConfirmed(source.id, request(source)), /CREATE_MAPPING_REQUIRED/); unmapped.close();
  let omit = false; const engine = open(undefined, { plan: d => omit ? [{ id: "fresh", effect: { kind: "create", nodeId: "fresh" }, payload: {} }] : plan(d) });
  const other = await closed(engine); const draft = engine.importConfirmed(other.id, request(other));
  engine.edit(draft.id, 0, [{ op: "node.add", id: "fresh", nodeType: "item" }]); omit = true;
  assert.equal(engine.preflight(draft.id).status, "incomplete"); engine.close();
});
