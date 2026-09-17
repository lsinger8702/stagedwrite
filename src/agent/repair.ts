import { Ajv2020 } from "ajv/dist/2020.js";
import { editBatchSchema } from "../edit/tool-schema.js";
import { deepFreeze, jsonSnapshot } from "../registry/json.js";
import type { EditBatch } from "../edit/protocol.js";
import type { createAgentTools, AgentToolOutputs, AgentToolResult } from "./tools.js";
import type { AgentToolInputs } from "./types.js";

type Tools = ReturnType<typeof createAgentTools>;
type Check = AgentToolOutputs["stagedwrite_preflight"];
type Publication = AgentToolOutputs["stagedwrite_publish"];
export type RepairDecision = { kind: "patch"; reason: string; batch: EditBatch } | { kind: "ask"; reason: string; questions: string[] } | { kind: "stop"; reason: string };
const text = { type: "string", minLength: 1, pattern: "\\S" };
const { $schema: _dialect, $defs, ...batch } = editBatchSchema;
export const repairDecisionSchema = deepFreeze({ type: "object", $defs, oneOf: [
  { type: "object", properties: { kind: { const: "patch" }, reason: text, batch }, required: ["kind", "reason", "batch"], additionalProperties: false },
  { type: "object", properties: { kind: { const: "ask" }, reason: text, questions: { type: "array", minItems: 1, items: text } }, required: ["kind", "reason", "questions"], additionalProperties: false },
  { type: "object", properties: { kind: { const: "stop" }, reason: text }, required: ["kind", "reason"], additionalProperties: false }
] });
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(repairDecisionSchema);
export interface RepairContext {
  goal: string;
  definition: Tools["draftDefinition"];
  current: Check | Publication;
  history: RepairEvent[];
  previousError?: unknown;
}
export type RepairEvent = { kind: "tool"; tool: string; input: unknown; output: AgentToolResult } | { kind: "decision"; decision: RepairDecision } | { kind: "invalid_decision"; message: string };
export interface RepairOptions {
  tools: Tools; draftId: string; goal: string; runId?: string;
  decide(context: RepairContext, signal: AbortSignal): Promise<unknown>;
  signal?: AbortSignal;
  maxRounds?: number; maxToolCalls?: number; timeoutMs?: number;
}
export interface RepairResult {
  status: "published" | "waiting" | "needs_input" | "stopped";
  reason: string; message: string; hint: string; draftId: string; runId?: string; questions?: string[];
  current?: Check | Publication; history: RepairEvent[];
}
class Halt extends Error {}
/** Finite host loop; execution truth, authorization and recovery remain in A1/the engine. */
export async function repairDraft(options: RepairOptions): Promise<RepairResult> {
  const { tools, draftId, goal } = options;
  const rounds = options.maxRounds ?? 6, calls = options.maxToolCalls ?? 24, timeout = options.timeoutMs ?? 60_000;
  if (!goal.trim() || !draftId.trim() || [rounds, calls, timeout].some(n => !Number.isSafeInteger(n) || n < 1)) throw Error("INVALID_REPAIR_OPTIONS");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  const history: RepairEvent[] = [];
  let count = 0, used = 0, rejects = 0, stalls = 0, lastSignature: string | undefined, afterEdit = false;
  let runId = options.runId, current: Check | Publication | undefined, previousError: unknown;
  const result = (status: RepairResult["status"], reason: string, questions?: string[]): RepairResult => structuredClone({ status, reason, message: status === "published" ? "The engine confirmed publication of the current intent." : `Repair loop returned ${status}: ${reason}.`, hint: status === "published" ? "Inspect the confirmed result; do not create a duplicate Draft." : status === "needs_input" ? "Obtain the requested user choice, update the goal, and continue the same Draft and Run." : "Inspect the latest response and history. Continue only through the same Draft and Run; stopping this loop does not cancel remote effects or authorize a replacement.", draftId, runId: runId ?? (current && "runId" in current ? current.runId ?? undefined : undefined), current, history, ...(questions ? { questions } : {}) });
  const guard = () => { if (controller.signal.aborted) throw new Halt("cancelled_or_timed_out"); };
  async function call<N extends keyof AgentToolInputs>(tool: N, input: AgentToolInputs[N]) {
    guard(); if (++count > calls) throw new Halt("tool_budget");
    const output = await tools.invoke(tool, input);
    history.push({ kind: "tool", tool, input: structuredClone(input), output: structuredClone(output) as AgentToolResult });
    return output;
  }
  async function check() {
    const r = await call("stagedwrite_preflight", { draftId });
    if (!r.ok) throw new Halt(r.error.code);
    current = r.data;
  }
  async function decide(): Promise<unknown> {
    guard();
    return new Promise((resolve, reject) => {
      const stop = () => reject(new Halt("cancelled_or_timed_out"));
      controller.signal.addEventListener("abort", stop, { once: true });
      Promise.resolve().then(() => options.decide(structuredClone({ goal, definition: tools.draftDefinition, current: current!, history, previousError }), controller.signal))
        .then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", stop));
    });
  }
  try {
    if (runId) {
      const r = await call("stagedwrite_resume", { draftId, runId });
      if (!r.ok) throw new Halt(r.error.code);
      current = r.data;
    } else await check();
    for (;;) {
      guard();
      if ("state" in current!) {
        const p = current as Publication;
        if (p.runId) runId = p.runId;
        if (p.state === "published" && p.isCurrentIntent) return result("published", "engine_confirmed");
        if (p.state === "unknown" || p.state === "running") return result("waiting", "resume_same_run");
        if (p.check && (p.check.status === "pending" || p.check.status === "incomplete")) return result("waiting", p.check.status);
        if (p.state === "published") return result("stopped", "historical_run_not_current");
      } else {
        const c = current as Check;
        if (c.status === "pending" || c.status === "incomplete") return result("waiting", c.status);
        if (c.status === "passed") {
          if (!c.certificate) return result("stopped", "no_execution_certificate");
          const r = runId ? await call("stagedwrite_resume", { draftId, runId }) : await call("stagedwrite_publish", { draftId, certificate: c.certificate });
          if (!r.ok) throw new Halt(r.error.code);
          current = r.data; continue;
        }
      }
      if (!current!.diagnostics.length) return result("stopped", "no_actionable_diagnostics");
      const signature = JSON.stringify({ nodes: current!.preview.nodes, diagnostics: current!.diagnostics });
      if (afterEdit) { stalls = signature === lastSignature ? stalls + 1 : 0; afterEdit = false; }
      if (stalls >= 2) return result("stopped", "no_progress");
      if (used++ >= rounds) return result("stopped", "round_budget");
      let decision: RepairDecision;
      const raw = await decide(); guard();
      const issues: unknown[] = [];
      const safe = jsonSnapshot(raw, (path, message) => issues.push({ path, message }));
      if (issues.length || !validate(safe)) {
        previousError = { code: "INVALID_MODEL_OUTPUT", message: "Return patch, ask or stop using the decision schema.", hint: "Use only set/remove/reset and do not add execution identities.", issues: issues.length ? issues : structuredClone(validate.errors) };
        history.push({ kind: "invalid_decision", message: "Decision schema rejected output" });
        if (++rejects >= 3) return result("stopped", "rejection_limit");
        continue;
      }
      decision = safe as RepairDecision;
      history.push({ kind: "decision", decision });
      if (decision.kind === "ask") return result("needs_input", decision.reason, decision.questions);
      if (decision.kind === "stop") return result("stopped", decision.reason);
      const version = current!.preview.version;
      const r = await call("stagedwrite_edit", { draftId, expectedVersion: version, batch: decision.batch });
      if (!r.ok) {
        previousError = r.error;
        if (r.error.issues?.some(i => i.path === "/expectedVersion")) { await check(); lastSignature = undefined; continue; }
        if (!["INVALID_EDIT_INPUT", "PATCH_SELF_CONFLICT", "INVALID_TOOL_INPUT"].includes(r.error.code)) return result("stopped", r.error.code);
        if (++rejects >= 3) return result("stopped", "rejection_limit");
        continue;
      }
      previousError = undefined; rejects = 0; lastSignature = signature; afterEdit = true;
      await check();
    }
  } catch (error) {
    if (error instanceof Halt) return result("stopped", error.message);
    // No raw provider/host exception is returned to a model-facing caller.
    return result("stopped", "host_or_model_error");
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
