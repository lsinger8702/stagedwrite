import test from "node:test";
import assert from "node:assert/strict";
import { createStagedWrite, createAgentTools, defineDraftType, type ManagedUpdateExecutor, type AgentToolResult, type AgentToolInputs, type AgentToolsOptions, type Step } from "../src/index.js";
import { previewView, checkView, publicationView } from "../src/agent/views.js";
import type { GraphDraftPreview } from "../src/preflight/types.js";
import { functionHost, messageHost } from "../examples/agent-hosts.js";
const definition = defineDraftType({ id: "agent-test", version: "1", nodeTypes: { task: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: definition.version };
function fixture() {
  let pending = false, calls = 0, lost = false;
  const values = new Map<string, string>();
  const executor: ManagedUpdateExecutor = { ...selector, id: "test", version: "1", target: "PRIVATE_TARGET", updateWrites: true,
    plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, payload: { name: n.fields.name as string, private: "PRIVATE_PAYLOAD" }, effect: { kind: "create", nodeId: n.id } })),
    update: { inspect: async (d, { bindings }) => ({ status: "complete", projections: Object.values(d.graph.nodes).map(n => ({ nodeId: n.id, projectionDigest: "v1", fields: { name: { path: "/name", writable: true, desired: { kind: "value", value: n.fields.name as string } } } })), observations: Object.values(d.graph.nodes).map(n => ({ id: n.id, nodeId: n.id, remoteId: bindings[n.id]!.remoteId, targetId: "PRIVATE_TARGET", projectionDigest: "v1", observedAt: new Date().toISOString(), values: { name: { kind: "value", value: values.get(n.id)! } } })) }),
      plan: (d, c) => c.slots.map((s): Step => ({ id: s.nodeId, payload: s.kind === "noop" ? {} : { name: d.graph.nodes[s.nodeId]!.fields.name as string, private: "PRIVATE_PAYLOAD" }, effect: { kind: s.kind, nodeId: s.nodeId, remoteId: s.remoteId } })) },
    apply: async step => {
      calls++;
      if (step.payload.name === "local-pass") return { kind: "not_applied", reason: "Choose approved", diagnostics: [{ code: "REMOTE_NAME", path: `/nodes/${step.effect.nodeId}/fields/name`, message: "Remote requires approved.", hint: "Set approved and resume." }] };
      values.set(step.effect.nodeId, step.payload.name as string);
      if (!lost) { lost = true; return { kind: "unknown", reason: "Receipt lost" }; }
      return { kind: "applied", remoteRef: "PRIVATE_REMOTE" + step.effect.nodeId, confirmed: { projectionDigest: "v1", values: { name: { kind: "value", value: step.payload.name as string } } } };
    },
    reconcile: async step => ({ kind: "applied", remoteRef: "PRIVATE_REMOTE" + step.effect.nodeId, confirmed: { projectionDigest: "v1", values: { name: { kind: "value", value: values.get(step.effect.nodeId)! } } } }),
  };
  const e = createStagedWrite({ definitions: [definition], executors: [executor], rules: [{ ...selector, id: "name", version: "1", check: d => Object.values(d.graph.nodes).filter(n => n.fields.name === "bad").map(n => ({ code: "NAME_BAD", path: `/nodes/${n.id}/fields/name`, message: "Name bad is not usable.", hint: "Choose a supported name consistent with intent.", candidates: [{ value: "local-pass", label: "Local candidate", repairOps: { patches: [{ op: "set", ref: n.id, scope: "canonical", path: "/name", value: "local-pass" }] } }] })) }], asyncRules: [{ ...selector, id: "ready", version: "1", check: async () => pending ? { status: "pending", message: "Remote check still running" } : { status: "complete", diagnostics: [] } }] });
  const allowed = new Set<string>();
  const agent = createAgentTools({ engine: e, definition, authorize: r => r.tool === "stagedwrite_create" || allowed.has(r.input.draftId) });
  return { e, agent, allowed, calls: () => calls, pending: (value: boolean) => { pending = value; } };
}
function data<N extends keyof AgentToolInputs>(result: AgentToolResult<N>) { assert.ok(result.ok, JSON.stringify(result)); return result.data; }
const intent = (name: string) => ({ roots: [{ nodeType: "task", fields: { name } }] });
for (const host of ["function", "message"] as const) test(`agent ${host} host: targeted repair, pending, same-Run recovery and update`, async () => {
  const f = fixture(), registry = functionHost(f.agent), messages = messageHost(f.agent);
  let sequence = 0;
  const invoke = async <N extends keyof AgentToolInputs>(name: N, args: AgentToolInputs[N]) => {
    let result: AgentToolResult<N>;
    if (host === "function") result = await registry.get(name)!.execute(args) as AgentToolResult<N>;
    else { const id = String(++sequence), response = await messages({ callId: id, name, argumentsJson: JSON.stringify(args) }); assert.equal(response.callId,id); result = JSON.parse(response.resultJson); }
    assert.ok(!JSON.stringify(result).includes("PRIVATE_"), "raw execution data must not escape the view");
    return data(result);
  };
  try {
    const created = await invoke("stagedwrite_create", { initialIntent: intent("bad") }); f.allowed.add(created.draftId);
    const draftId = created.draftId, ref = created.createdRefs[0]!.ref;
    assert.deepEqual(created.preview.nodes[ref]!.fields["/name"], {kind:"value",value:"bad"});
    const check = await invoke("stagedwrite_preflight", { draftId }); assert.equal(check.status,"blocked");
    const batch = check.diagnostics[0]!.candidates![0]!.repairOps!;
    const preview = await invoke("stagedwrite_preview", { draftId, expectedVersion: created.version, batch }); assert.equal(preview.previewOnly,true);
    assert.equal((await f.e.getDraft(draftId)).version,created.version);
    const edited = await invoke("stagedwrite_edit", { draftId, expectedVersion: created.version, batch }); assert.ok(edited.preflightRequired); assert.ok(!("preview" in edited));
    f.pending(true); const waiting = await invoke("stagedwrite_preflight", { draftId }); assert.equal(waiting.status,"pending"); assert.equal(waiting.certificate,undefined); assert.ok(waiting.pendingRules?.[0]?.message); assert.equal(f.calls(),0);
    f.pending(false); const ready = await invoke("stagedwrite_preflight", { draftId }); assert.ok(ready.certificate);
    const blocked = await invoke("stagedwrite_publish", { draftId, certificate: ready.certificate }); assert.equal(blocked.state,"blocked"); assert.ok(blocked.runId); assert.equal(blocked.diagnostics[0]!.code,"REMOTE_NAME");
    await invoke("stagedwrite_edit", { draftId, expectedVersion: edited.version, batch: { patches: [{ op: "set", ref, scope: "canonical", path: "/name", value: "approved" }] } });
    const unknown = await invoke("stagedwrite_resume", { draftId, runId: blocked.runId }); assert.equal(unknown.state,"unknown");
    const before = f.calls(), completed = await invoke("stagedwrite_resume", { draftId, runId: blocked.runId }); assert.equal(completed.state,"published"); assert.equal(f.calls(),before); assert.equal(completed.runId,blocked.runId);
    const context = await invoke("stagedwrite_context", { draftId });
    await invoke("stagedwrite_edit", { draftId, expectedVersion: context.version, batch: { patches: [{ op: "set", ref, scope: "canonical", path: "/name", value: "updated" }] } });
    const update = await invoke("stagedwrite_preflight", { draftId }); assert.equal(update.update?.[0]?.kind,"update");
    const updated = await invoke("stagedwrite_publish", { draftId, certificate: update.certificate! }); assert.equal(updated.state,"published"); assert.equal(updated.kind,"update"); assert.notEqual(updated.runId,completed.runId);
    const noCheck = await invoke("stagedwrite_preflight", { draftId });
    const noop = await invoke("stagedwrite_publish", { draftId, certificate: noCheck.certificate! }); assert.equal(noop.runId,null); assert.equal(noop.kind,"noop");
  } finally { await f.e.close(); }
});
test("agent rejects invalid input and authorization before any engine call", async () => {
  let reads = 0, authorizations = 0, accessor = false;
  const engine = new Proxy({} as AgentToolsOptions["engine"], { get() { reads++; throw Error("must not access engine"); } });
  const agent = createAgentTools({ engine, definition, authorize: () => { authorizations++; return false; } });
  for (const [tool,input] of [["unknown",{}],["stagedwrite_edit",{draftId:"a",expectedVersion:0,batch:{patches:[{op:"node.add"}]}}],["stagedwrite_context",{draftId:"a",target:"different"}],["stagedwrite_create",{initialIntent:{roots:[]}}],["stagedwrite_context",{get draftId(){accessor=true;return "a";}}]] as const) {
    const result = await agent.dispatch(tool,input); assert.equal(result.ok,false); if (!result.ok) { assert.ok(result.error.message); assert.ok(result.error.hint); }
  }
  assert.equal(accessor,false); assert.equal(reads,0); assert.equal(authorizations,0);
  assert.equal((await agent.dispatch("stagedwrite_context",{draftId:"a"})).ok,false); assert.equal(authorizations,1); assert.equal(reads,0);
});
test("agent preserves version conflict issues without replay and blocks foreign Runs", async () => {
  const f = fixture();
  try {
    const a = data(await f.agent.invoke("stagedwrite_create",{initialIntent:intent("approved")})); f.allowed.add(a.draftId);
    const b = await f.e.create(selector,intent("approved")); const c = await f.e.preflight(b.draft.id); const run = await f.e.publish(b.draft.id,c.certificate!); assert.ok(run.id);
    const before = f.calls(), forbidden = await f.agent.invoke("stagedwrite_resume",{draftId:a.draftId,runId:run.id}); assert.equal(forbidden.ok,false); if (!forbidden.ok) assert.equal(forbidden.error.code,"RUN_UNAVAILABLE"); assert.equal(f.calls(),before);
    const missing = await f.agent.invoke("stagedwrite_resume", { draftId: a.draftId, runId: "missing-run" });
    assert.deepEqual(missing, forbidden);
    assert.equal(f.calls(), before);
    const ref = a.createdRefs[0]!.ref, batch = { patches: [{op:"set" as const,ref,scope:"canonical" as const,path:"/name",value:"changed"}] };
    data(await f.agent.invoke("stagedwrite_edit",{draftId:a.draftId,expectedVersion:0,batch}));
    const stale = await f.agent.invoke("stagedwrite_edit",{draftId:a.draftId,expectedVersion:0,batch}); assert.equal(stale.ok,false);
    if (!stale.ok) { assert.match(stale.error.message,/STALE_VERSION/); assert.ok(stale.error.hint); assert.equal(stale.error.issues![0]!.path,"/expectedVersion"); }
    assert.equal((await f.e.getDraft(a.draftId)).version,1);
  } finally { await f.e.close(); }
});
test("agent keeps authorization/backend exceptions with host, even when error reporting fails", async () => {
  for (const authThrows of [true,false]) {
    let reported = 0;
    const engine = { getDraft: async () => { throw Error("PRIVATE_BACKEND"); } } as unknown as AgentToolsOptions["engine"];
    const agent = createAgentTools({engine,definition,authorize:()=>{if(authThrows)throw Error("PRIVATE_AUTH");return true;},onError:()=>{reported++;throw Error("PRIVATE_LOG");}});
    const r = await agent.dispatch("stagedwrite_context",{draftId:"a"}); assert.equal(r.ok,false); assert.equal(reported,1); assert.ok(!JSON.stringify(r).includes("PRIVATE_"));
    if(!r.ok){assert.ok(r.error.message);assert.ok(r.error.hint);}
  }
});
// Compile-time protocol checks; deliberately never execute invalid examples.
function typeChecks(agent: ReturnType<typeof createAgentTools>) {
  // @ts-expect-error three-state OP has no node.add
  agent.invoke("stagedwrite_edit",{draftId:"d",expectedVersion:0,batch:{patches:[{op:"node.add"}]}});
  // @ts-expect-error resume requires the authorized Draft identity too
  agent.invoke("stagedwrite_resume",{runId:"r"});
  // @ts-expect-error selector and credentials are host-bound, never model inputs
  agent.invoke("stagedwrite_create",{initialIntent:intent("a"),target:"other"});
}
void typeChecks;

test("agent removed node coordinates support baseline reset without exposing edge tombstones", async () => {
  const f = fixture();
  try {
    const created = data(await f.agent.invoke("stagedwrite_create", { initialIntent: { roots: [
      { nodeType: "task", fields: { name: "first" } }, { nodeType: "task", fields: { name: "second" } }
    ] } }));
    const draftId = created.draftId, ref = created.createdRefs[0]!.ref; f.allowed.add(draftId);
    const edited = data(await f.agent.invoke("stagedwrite_edit", { draftId, expectedVersion: 0, batch: { graphPatches: [{ op: "remove", ref }] } }));
    const context = data(await f.agent.invoke("stagedwrite_context", { draftId }));
    assert.deepEqual(context.preview.removedNodeRefs, [ref]);
    assert.ok(context.preview.removedNodeHint);
    assert.equal(Object.hasOwn(context.preview.nodes, ref), false);
    const check = data(await f.agent.invoke("stagedwrite_preflight", { draftId }));
    assert.deepEqual(check.preview, context.preview);
    const batch = { graphPatches: [{ op: "reset" as const, ref: context.preview.removedNodeRefs![0]! }] };
    const preview = data(await f.agent.invoke("stagedwrite_preview", { draftId, expectedVersion: edited.version, batch }));
    assert.ok(preview.candidate.preview.nodes[ref]);
    assert.equal(preview.candidate.preview.removedNodeRefs, undefined);
    data(await f.agent.invoke("stagedwrite_edit", { draftId, expectedVersion: edited.version, batch }));
    const restored = data(await f.agent.invoke("stagedwrite_context", { draftId }));
    assert.deepEqual(restored.preview.nodes, created.preview.nodes);
    for (const value of [created, context, check, preview, restored]) {
      assert.doesNotMatch(JSON.stringify(value), /"tombstones"|"edges"/);
    }
  } finally { await f.e.close(); }
});

test("agent preview keeps shared targets and escaped relation coordinates across result views", () => {
  const preview: GraphDraftPreview = { id: "d", version: 3, type: "t", typeVersion: "1", definitionDigest: "digest",
    nodes: Object.fromEntries(["a", "b", "shared"].map(id => [id, { id, nodeType: "task", fields: { "/name": { kind: "value" as const, value: id } } }])),
    edges: { hidden1: { id: "hidden1", from: "a", to: "shared", relationType: "items/~" }, hidden2: { id: "hidden2", from: "b", to: "shared", relationType: "items/~" } },
    tombstones: { nodes: [], edges: ["hidden-deleted"] } };
  const expected = previewView(preview);
  assert.deepEqual(expected.nodes.a!.relations, { "/items~1~0": ["shared"] });
  assert.deepEqual(expected.nodes.b!.relations, expected.nodes.a!.relations);
  const check = { preview, diagnostics: [] } as unknown as Parameters<typeof checkView>[0];
  const result = { preview, diagnostics: [], check } as unknown as Parameters<typeof publicationView>[0];
  assert.deepEqual(checkView(check).preview, expected);
  const publication = publicationView(result, "d");
  assert.deepEqual(publication.preview, expected);
  assert.deepEqual(publication.check!.preview, expected);
  assert.doesNotMatch(JSON.stringify(publication), /hidden|tombstones|"edges"/);
  expected.nodes.a!.relations["/items~1~0"]!.push("changed");
  assert.equal(Object.keys(preview.edges).length, 2);
});
