import assert from "node:assert/strict";
import { createStagedWrite, createAgentTools, defineDraftType, type AgentToolName, type AgentToolResult } from "../src/index.js";
import { functionHost, messageHost } from "./agent-hosts.js";
const definition = defineDraftType({ id: "release-note", version: "1", nodeTypes: { note: { valueSchema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["title"] } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: definition.version };
const engine = createStagedWrite({ definitions: [definition], rules: [{ ...selector, id: "title", version: "1", check: d => Object.values(d.graph.nodes).filter(n => n.fields.title === "draft").map(n => ({ code: "TITLE_PLACEHOLDER", path: `/nodes/${n.id}/fields/title`, message: "Replace the placeholder title before publishing.", hint: "Choose the title from the user's requested release." })) }], executors: [{ ...selector, id: "demo", version: "1", target: "mock:notes", plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, effect: { kind: "create", nodeId: n.id }, payload: { title: n.fields.title as string } })), apply: async step => ({ kind: "applied", remoteRef: `mock:${step.id}` }), reconcile: { unsupported: "This offline success-only demonstration has no recovery lookup." } }] });
const owned = new Set<string>(); // Replace with the host's durable user/Draft ownership store.
const agent = createAgentTools({ engine, definition, authorize: request => request.tool === "stagedwrite_create" || owned.has(request.input.draftId) });
const functions = functionHost(agent), messages = messageHost(agent), trace: unknown[] = [];
const call = async (host: "function" | "message", name: AgentToolName, args: unknown): Promise<AgentToolResult> => {
  const result = host === "function" ? await functions.get(name)!.execute(args) : JSON.parse((await messages({ callId: String(trace.length), name, argumentsJson: JSON.stringify(args) })).resultJson) as AgentToolResult;
  trace.push({ host, name, input: args, output: result }); return result;
};
try {
  const created = await call("function", "stagedwrite_create", { initialIntent: { roots: [{ nodeType: "note", fields: { title: "draft" } }] } });
  assert.ok(created.ok && created.tool === "stagedwrite_create");
  const { draftId, version, createdRefs } = created.data; owned.add(draftId);
  const check = await call("message", "stagedwrite_preflight", { draftId }); assert.ok(check.ok && check.tool === "stagedwrite_preflight"); assert.equal(check.data.status,"blocked");
  // A scripted host decision based on a fixed user goal. No LLM call is claimed.
  const edit = await call("function", "stagedwrite_edit", { draftId, expectedVersion: version, batch: { patches: [{ op: "set", ref: createdRefs[0]!.ref, scope: "canonical", path: "/title", value: "September release notes" }] } }); assert.ok(edit.ok);
  const ready = await call("message", "stagedwrite_preflight", { draftId }); assert.ok(ready.ok && ready.tool === "stagedwrite_preflight"); assert.equal(ready.data.status,"passed");
  const result = await call("function", "stagedwrite_publish", { draftId, certificate: ready.data.certificate }); assert.ok(result.ok && result.tool === "stagedwrite_publish"); assert.equal(result.data.state,"published");
  console.log(JSON.stringify({ scope: "Actual engine and two host transports; mock remote and scripted decisions; no LLM", trace },null,2));
} finally { await engine.close(); }
