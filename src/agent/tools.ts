import { Ajv2020 } from "ajv/dist/2020.js";
import { agentToolDefinitions, type AgentToolName } from "./schema.js";
import { DefinitionRegistry } from "../registry/registry.js";
import { jsonSnapshot, deepFreeze } from "../registry/json.js";
import { EditInputError, type CreatedRef } from "../edit/protocol.js";
import { contextView, checkView, publicationView } from "./views.js";
import type { AgentToolsOptions, AgentToolInputs, AgentAuthorizationRequest, AgentToolError, AgentEngine } from "./types.js";
export interface AgentToolOutputs {
  stagedwrite_create: ReturnType<typeof contextView> & { createdRefs: CreatedRef[] };
  stagedwrite_context: ReturnType<typeof contextView>;
  stagedwrite_preview: { previewOnly: true; candidate: ReturnType<typeof contextView>; changes: Awaited<ReturnType<AgentEngine["edit"]>>["changes"]; createdRefs: CreatedRef[] };
  stagedwrite_edit: Awaited<ReturnType<AgentEngine["edit"]>>;
  stagedwrite_preflight: ReturnType<typeof checkView>;
  stagedwrite_publish: ReturnType<typeof publicationView>;
  stagedwrite_resume: ReturnType<typeof publicationView>;
}
export type AgentToolResult<N extends AgentToolName = AgentToolName> =
  { [K in N]: { ok: true; tool: K; data: AgentToolOutputs[K] } }[N] |
  { ok: false; tool: string; error: AgentToolError };
const hints: Record<string, [string, string]> = {
  DRAFT_BUSY: ["Another operation currently holds the Draft lease.", "Wait for it to finish, then inspect the same Draft before deciding the next call."],
  LEASE_LOST: ["The operation lost its Draft lease.", "A remote effect may exist. Inspect the same Draft and resume its Run; do not create a replacement."],
  DRAFT_NOT_FOUND: ["The requested Draft is unavailable.", "Use a Draft ID returned by an authorized create call."],
  RUN_NOT_FOUND: ["The requested Run is unavailable.", "Read the authorized Draft context and use its Run identity."],
  RUN_DRAFT_MISMATCH: ["This Run does not belong to the requested Draft.", "Use a Run belonging to the authorized Draft."],
  DEFINITION_MISMATCH: ["This Draft does not match the toolset's definition.", "Ask the host to select the matching toolset; do not change model-side credentials or targets."],
  UPDATE_NOT_SUPPORTED: ["This executor cannot update published resources.", "Ask the host for an update-capable adapter; do not create a replacement to bypass this restriction."],
  APPLIED_STEP_IMMUTABLE: ["The edit conflicts with a completed node in this Run.", "Keep successful nodes unchanged and repair only unfinished work in the same Run."],
  CHECK_NOT_CURRENT: ["The preflight certificate is not current.", "Run preflight again and inspect its result before publishing."],
  STALE_CHECK: ["The provided check no longer matches this Draft.", "Run preflight again and inspect the fresh preview and diagnostics."],
  STALE_UPDATE_READBACK: ["State changed while remote conditions were checked.", "Inspect this Draft and its current Run, then recheck before deciding how to continue."],
  UNRESOLVED_EXECUTION: ["A prior request in this Run is unresolved.", "Resume the original Run to reconcile it; do not publish a replacement request."],
  REPAIR_TOPOLOGY_CHANGED: ["This edit changes topology protected by the active Run.", "Keep node identities and relations unchanged; repair only unfinished fields."],
  LOCK_UNAVAILABLE: ["The host could not acquire the Draft lease.", "Ask the host to restore the lock backend, then inspect this Draft before continuing."],
  STORE_CLOSED: ["The host's StagedWrite instance is closed.", "Ask the host to reopen the same backing store; do not replace unresolved Drafts."],
  PREFLIGHT_REQUIRED: ["A current passing preflight is required.", "Run preflight and use the returned certificate only if it passes."],
};
/** Provider-neutral tools. Host authorization precedes every engine read or write. */
export function createAgentTools(options: AgentToolsOptions) {
  if (typeof options.authorize !== "function") throw Error("AGENT_AUTHORIZATION_REQUIRED");
  const registry = new DefinitionRegistry([options.definition]), selector = registry.selectors()[0]!;
  const registered = registry.getDefinition(selector), engine = options.engine;
  const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
  const validators = new Map(agentToolDefinitions.map(t => [t.name, ajv.compile(t.inputSchema)]));
  const fail = (tool: string, error: AgentToolError): AgentToolResult => ({ ok: false, tool, error });
  const report = async (error: unknown) => { try { await options.onError?.(error); } catch { /* Host logging cannot replace the original result. */ } };
  const success = <N extends AgentToolName>(tool: N, data: AgentToolOutputs[N]): AgentToolResult<N> => ({ ok: true, tool, data }) as AgentToolResult<N>;
  async function dispatch(tool: string, raw: unknown): Promise<AgentToolResult> {
    const validate = validators.get(tool as AgentToolName);
    if (!validate) return fail(tool, { code: "UNKNOWN_TOOL", message: "This tool is not registered.", hint: "Choose a name from this toolset's definitions." });
    const issues: { path: string; message: string }[] = [];
    let input;
    try { input = jsonSnapshot(raw, (path, message) => issues.push({ path, message })); }
    catch { issues.push({ path: "", message: "Expected plain finite JSON input." }); }
    if (!issues.length && !validate(input)) issues.push(...(validate.errors ?? []).map(e => ({ path: e.instancePath, message: e.message ?? "Invalid input" })));
    if (issues.length) return fail(tool, { code: "INVALID_TOOL_INPUT", message: "Tool arguments do not match the registered schema.", hint: "Correct the reported coordinates and use only the documented fields and set/remove/reset operations.", issues });
    const request = deepFreeze({ tool, input }) as AgentAuthorizationRequest;
    try {
      if (await options.authorize(request) !== true) return fail(tool, { code: "TOOL_NOT_AUTHORIZED", message: "The host did not authorize this call.", hint: "Ask the host to resolve access or action permission; do not substitute another Draft or Run ID." });
    } catch (error) { await report(error); return fail(tool, { code: "TOOL_NOT_AUTHORIZED", message: "Host authorization could not be established.", hint: "Ask the host to restore authorization; no engine call was made." }); }
    try {
      if (request.tool !== "stagedwrite_create") {
        const draft = await engine.getDraft(request.input.draftId);
        if (draft.type !== selector.type || draft.typeVersion !== selector.typeVersion || draft.definitionDigest !== registered.digest) throw Error("DEFINITION_MISMATCH");
      }
      switch (request.tool) {
        case "stagedwrite_create": {
          const result = await engine.create(selector, request.input.initialIntent);
          return success(request.tool, { ...contextView(result.draft, registry), createdRefs: result.createdRefs });
        }
        case "stagedwrite_context": return success(request.tool, contextView(await engine.getDraft(request.input.draftId), registry));
        case "stagedwrite_preview": {
          const p = request.input, result = await engine.preview(p.draftId, p.expectedVersion, p.batch);
          return success(request.tool, { previewOnly: true, candidate: contextView(result.candidate, registry), changes: result.changes, createdRefs: result.createdRefs });
        }
        case "stagedwrite_edit": { const p = request.input; return success(request.tool, await engine.edit(p.draftId, p.expectedVersion, p.batch)); }
        case "stagedwrite_preflight": return success(request.tool, checkView(await engine.preflight(request.input.draftId)));
        case "stagedwrite_publish": { const p = request.input; return success(request.tool, publicationView(await engine.publish(p.draftId, p.certificate), p.draftId)); }
        case "stagedwrite_resume": {
          const p = request.input, run = await engine.getRun(p.runId);
          if (run.draftId !== p.draftId) throw Error("RUN_DRAFT_MISMATCH");
          return success(request.tool, publicationView(await engine.resume(p.runId), p.draftId));
        }
      }
    } catch (error) {
      await report(error);
      if (error instanceof EditInputError) return fail(tool, error.toJSON());
      const code = error instanceof Error ? error.message : "", known = Object.hasOwn(hints, code) ? hints[code] : undefined;
      if (known) return fail(tool, { code, message: known[0], hint: known[1] });
      return fail(tool, { code: "TOOL_EXECUTION_FAILED", message: "The tool could not complete; the host has the original error.", hint: "A write may already have taken effect. Inspect the same Draft and Run with the host before continuing; do not recreate resources." });
    }
  }
  return { tools: agentToolDefinitions, draftDefinition: deepFreeze(registered.definition), dispatch,
    invoke: <N extends AgentToolName>(tool: N, input: AgentToolInputs[N]): Promise<AgentToolResult<N>> => dispatch(tool, input) as Promise<AgentToolResult<N>> };
}
