import test from "node:test";
import assert from "node:assert/strict";
import { createStagedWrite, createAgentTools, defineDraftType, repairDraft, type RepairContext, type RepairDecision } from "../src/index.js";
import { messagesDecider, type MessageTrace } from "../examples/repair-messages.js";
const definition = defineDraftType({ id: "repair-test", version: "1", nodeTypes: { note: { valueSchema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["title"] } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: definition.version };
async function fixture(mode = "normal") {
  let writes = 0, pending = mode === "pending", lost = false;
  const e = createStagedWrite({ definitions: [definition], rules: [{ ...selector, id: "title", version: "1", check: d => Object.values(d.graph.nodes).filter(n => n.fields.title === "bad" || mode === "stuck").map(n => ({ code: "TITLE", path: `/nodes/${n.id}/fields/title`, message: "Choose the requested title.", hint: "Use the user's choice; ask if absent.", candidates: [{ value: "local" }] })) }],
    asyncRules: [{ ...selector, id: "pending", version: "1", check: async () => pending ? { status: "pending", message: "Not ready" } : { status: "complete", diagnostics: [] } }],
    executors: [{ ...selector, id: "remote", version: "1", target: "mock", plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, payload: { title: n.fields.title as string }, effect: { kind: "create", nodeId: n.id } })),
      apply: async step => { writes++; if (step.payload.title === "local") return { kind: "not_applied", reason: "Rejected", diagnostics: [{ code: "REMOTE_TITLE", path: `/nodes/${step.id}/fields/title`, message: "Remote needs final title", hint: "Repair and resume" }] }; if (mode === "lost" && !lost) { lost = true; return { kind: "unknown", reason: "Receipt missing" }; } return { kind: "applied", remoteRef: `mock:${step.id}` }; },
      reconcile: async step => ({ kind: "applied", remoteRef: `mock:${step.id}` }) }] });
  const tools = createAgentTools({ engine: e, definition, authorize: () => true });
  const r = await tools.invoke("stagedwrite_create", { initialIntent: { roots: [{ nodeType: "note", fields: { title: "bad" } }] } }); assert.ok(r.ok);
  return { e, tools, draftId: r.data.draftId, ref: r.data.createdRefs[0]!.ref, writes: () => writes, ready: () => { pending = false; } };
}
const patch = (c: RepairContext, title: string): RepairDecision => ({ kind: "patch", reason: "Use requested title", batch: { patches: [{ op: "set", ref: Object.keys(c.current.preview.nodes)[0]!, scope: "canonical", path: "/title", value: title }] } });
test("repair Messages mock: local diagnostic, remote rejection, same Run and unknown reconciliation", async () => {
  const f = await fixture("lost"), trace: MessageTrace[] = [];
  try {
    const decide = messagesDecider("mock-model", async request => {
      const c = JSON.parse(request.messages[0]!.content) as RepairContext;
      const d = patch(c, c.current.diagnostics.some(d => d.code === "REMOTE_TITLE") ? "final" : "local");
      return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `call-${trace.length}`, name: "submit_repair", input: { decision: d } }] };
    }, trace);
    const a = await repairDraft({ ...f, goal: "Use local initially, final if remote requires it", decide });
    assert.equal(a.status, "waiting"); assert.equal(a.reason, "resume_same_run"); assert.ok(a.runId); assert.equal(f.writes(), 2);
    assert.equal(trace.length, 2); assert.equal(trace[1]!.callId, trace[1]!.result.tool_use_id);
    const b = await repairDraft({ ...f, runId: a.runId, goal: "Continue", decide: async () => { throw Error("must not ask model"); } });
    assert.equal(b.status, "published"); assert.equal(b.runId, a.runId); assert.equal(f.writes(), 2);
    assert.equal(a.history.filter(h => h.kind === "tool" && h.tool === "stagedwrite_publish").length, 1);
  } finally { await f.e.close(); }
});
test("repair separates rejected batch from no progress and feeds precise errors back", async () => {
  const f = await fixture(); let turn = 0;
  try {
    const r = await repairDraft({ ...f, goal: "final", decide: async c => {
      if (!turn++) { const d = patch(c, "final"); if (d.kind === "patch") d.batch.patches!.push(d.batch.patches![0]!); return d; }
      assert.match(JSON.stringify(c.previousError), /PATCH_SELF_CONFLICT/);
      assert.equal(c.current.preview.nodes[f.ref]!.fields["/title"]!.kind, "value");
      return patch(c, "final");
    } });
    assert.equal(r.status, "published"); assert.equal(turn, 2); assert.equal(f.writes(), 1);
  } finally { await f.e.close(); }
});
test("repair stops on invalid model decisions and semantic no-progress with separate reasons", async () => {
  for (const mode of ["normal", "stuck"]) {
    const f = await fixture(mode);
    try { const r = await repairDraft({ ...f, goal: "keep bad", decide: async c => mode === "normal" ? { kind: "done" } : patch(c, "bad") });
      assert.equal(r.reason, mode === "normal" ? "rejection_limit" : "no_progress"); assert.equal(f.writes(), 0);
    } finally { await f.e.close(); }
  }
});
test("repair yields pending and user questions without writing", async () => {
  const f = await fixture("pending");
  try {
    const pending = await repairDraft({ ...f, goal: "Choose title", decide: async () => { throw Error("must not ask"); } });
    assert.equal(pending.status, "waiting"); f.ready();
    const ask = await repairDraft({ ...f, goal: "Title not specified", decide: async () => ({ kind: "ask", reason: "Missing intent", questions: ["Which title?"] }) });
    assert.equal(ask.status, "needs_input"); assert.deepEqual(ask.questions, ["Which title?"]); assert.equal(f.writes(), 0);
  } finally { await f.e.close(); }
});
test("repair version conflict rechecks before a new model decision, without replaying the old batch", async () => {
  const f = await fixture(); let turn = 0;
  try {
    const r = await repairDraft({ ...f, goal: "final", decide: async c => {
      if (!turn++) await f.e.edit(f.draftId, 0, { patches: [{ op: "set", ref: f.ref, scope: "canonical", path: "/title", value: "bad" }] });
      else { assert.equal(c.current.preview.version, 1); assert.match(JSON.stringify(c.previousError), /expectedVersion/); }
      return patch(c, "final");
    } });
    assert.equal(r.status, "published"); assert.equal(turn, 2); assert.equal(f.writes(), 1);
  } finally { await f.e.close(); }
});
test("repair cancels a model that ignores abort and never applies a late decision", async () => {
  const f = await fixture(); let resolve!: (v: unknown) => void;
  try {
    const r = await repairDraft({ ...f, goal: "final", timeoutMs: 20, decide: async () => new Promise(r => { resolve = r; }) });
    assert.equal(r.reason, "cancelled_or_timed_out"); resolve({ kind: "stop", reason: "late" });
    await new Promise(r => setImmediate(r)); assert.equal((await f.e.getDraft(f.draftId)).version, 0);
  } finally { await f.e.close(); }
});
test("repair refuses parallel or truncated Messages tool outputs", async () => {
  const decide = messagesDecider("mock", async () => ({ stop_reason: "max_tokens", content: [] }));
  await assert.rejects(decide({} as RepairContext, new AbortController().signal), /INVALID_MESSAGES_DECISION/);
});
test("repair supports remove and fixed-baseline reset, and does not silently choose suggestions", async () => {
  const f = await fixture(); let turn = 0;
  try {
    const result = await repairDraft({ ...f, goal: "Remove title then restore the initial title, then ask me; do not choose the candidate", decide: async () => {
      const op = turn++ === 0 ? "remove" : "reset";
      if (turn > 2) return { kind: "ask", reason: "Candidate not authorized", questions: ["Choose a different title?"] };
      return { kind: "patch", reason: "Explicit user intent", batch: { patches: [{ op, ref: f.ref, scope: "canonical", path: "/title" }] } };
    } });
    // Removal exposes required-field diagnostics; reset returns to the fixed initial title.
    assert.equal(result.status, "needs_input");
    assert.equal((await f.e.getDraft(f.draftId)).graph.nodes[f.ref]!.fields.title, "bad");
    assert.equal(f.writes(), 0);
  } finally { await f.e.close(); }
});
test("repair budgets and host failures stop instead of replaying side effects", async () => {
  const f = await fixture();
  try {
    const budget = await repairDraft({ ...f, goal: "final", maxToolCalls: 1, decide: async c => patch(c, "final") });
    assert.equal(budget.reason, "tool_budget"); assert.equal(f.writes(), 0);
    const tools = { ...f.tools, invoke: async () => ({ ok: false, tool: "stagedwrite_preflight", error: { code: "TOOL_EXECUTION_FAILED", message: "Storage unavailable", hint: "Inspect original Run" } }) } as unknown as typeof f.tools;
    const failed = await repairDraft({ ...f, tools, goal: "final", decide: async () => { throw Error("must not invoke model"); } });
    assert.equal(failed.reason, "TOOL_EXECUTION_FAILED"); assert.equal(failed.history.length, 1);
  } finally { await f.e.close(); }
});
test("cancellation after an in-flight publication retains the returned Run identity", async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const tools = { ...f.tools, invoke: async (name: Parameters<typeof f.tools.dispatch>[0], input: unknown) => {
      const r = await f.tools.dispatch(name, input);
      if (name === "stagedwrite_publish") controller.abort();
      return r;
    } } as typeof f.tools;
    const r = await repairDraft({ ...f, tools, goal: "final", signal: controller.signal, decide: async c => patch(c, "final") });
    assert.equal(r.reason, "cancelled_or_timed_out");
    assert.equal(r.runId, (await f.e.getDraft(f.draftId)).currentRunId); assert.ok(r.runId);
    assert.equal((await f.e.getRun(r.runId)).state, "published"); assert.equal(f.writes(), 1);
  } finally { await f.e.close(); }
});
