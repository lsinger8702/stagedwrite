import assert from "node:assert/strict";
import { createStagedWrite, createAgentTools, defineDraftType, repairDraft, type RepairContext } from "../src/index.js";
import { messagesDecider, anthropicMessages, type MessageTrace } from "./repair-messages.js";
const live = process.argv.includes("--live");
if (live && (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL)) throw Error("Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL for --live");
const definition = defineDraftType({ id: "document", version: "1", nodeTypes: { document: { valueSchema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false } } }, relationTypes: {} });
const selector = { type: definition.id, typeVersion: definition.version };
let writes = 0;
const engine = createStagedWrite({ definitions: [definition], rules: [{ ...selector, id: "title", version: "1", check: d => Object.values(d.graph.nodes).filter(n => n.fields.title === "placeholder").map(n => ({ code: "PLACEHOLDER", path: `/nodes/${n.id}/fields/title`, message: "The title is still a placeholder.", hint: "Use the title specified by the user." })) }], executors: [{ ...selector, id: "demo", version: "1", target: "mock:documents", plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, payload: { title: n.fields.title as string }, effect: { kind: "create", nodeId: n.id } })),
  apply: async step => { writes++; return step.payload.title === "Release" ? { kind: "not_applied", reason: "Title is reserved", diagnostics: [{ code: "RESERVED", path: `/nodes/${step.id}/fields/title`, message: "Release is reserved remotely.", hint: "Choose another title permitted by the user's goal." }] } : { kind: "applied", remoteRef: `mock:${step.id}` }; }, reconcile: { unsupported: "Mock example has no receipt lookup" } }] });
const owned = new Set<string>(); // Demo only: real hosts persist ownership.
const tools = createAgentTools({ engine, definition, authorize: r => r.tool === "stagedwrite_create" || owned.has(r.input.draftId) });
const messages: MessageTrace[] = [];
let call = 0;
const decide = messagesDecider(live ? process.env.ANTHROPIC_MODEL! : "mock-model", live ? anthropicMessages(process.env.ANTHROPIC_API_KEY!) : async request => {
  const c = JSON.parse(request.messages[0]!.content) as RepairContext;
  const title = c.current.diagnostics.some(d => d.code === "RESERVED") ? "September Release" : "Release";
  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `mock-call-${++call}`, name: "submit_repair", input: { decision: { kind: "patch", reason: "Use a title explicitly allowed by the user", batch: { patches: [{ op: "set", ref: Object.keys(c.current.preview.nodes)[0]!, scope: "canonical", path: "/title", value: title }] } } } }] };
}, messages);
try {
  const create = await tools.invoke("stagedwrite_create", { initialIntent: { roots: [{ nodeType: "document", fields: { title: "placeholder" } }] } }); assert.ok(create.ok); owned.add(create.data.draftId);
  const result = await repairDraft({ tools, draftId: create.data.draftId, goal: "Use Release as the title. If the service reserves it, use September Release instead. Publish when valid.", decide });
  assert.equal(result.status, "published");
  if (!live) { assert.equal(writes, 2); assert.equal(messages.length, 2); assert.equal(result.history.filter(h => h.kind === "tool" && h.tool === "stagedwrite_publish").length, 1); assert.equal(result.history.filter(h => h.kind === "tool" && h.tool === "stagedwrite_resume").length, 1); }
  console.log(JSON.stringify({ mode: live ? "Live model, MOCK remote" : "MOCK model and remote, actual engine", create, messages, result, writes }, null, 2));
} finally { await engine.close(); }
