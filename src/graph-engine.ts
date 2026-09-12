import { randomUUID } from "node:crypto";
import { DefinitionRegistry } from "./registry/registry.js";
import type { DefinitionSelector } from "./registry/types.js";

import type { GraphDraft, GraphOp } from "./graph/types.js";
import { evaluateGraphEdit } from "./graph/edit.js";
import { GraphPreflight } from "./preflight/check.js";
import type { GraphRule, GraphCheck } from "./preflight/types.js";
import { assembleExecutors, executorFor, fixedPlan, type GraphExecutor, type BoundExecutor } from "./execution/graph.js";
import { definitionDigest, type Json } from "./registry/json.js";
import type { Run, Step, ExecutionBinding } from "./types.js";

interface CommonOptions { definitions: readonly unknown[]; rules?: readonly GraphRule[] }
export interface DraftOptions extends CommonOptions { mode?: "draft"; executors?: never }
export interface ExecutableOptions extends CommonOptions { mode: "executable"; executors: readonly GraphExecutor[] }
export type DraftEngine = ReturnType<typeof assembleGraphEngine>["base"];
export type ExecutableGraphEngine = DraftEngine & ReturnType<typeof assembleGraphEngine>["execution"];
export function createStagedWrite(options: DraftOptions): DraftEngine;
export function createStagedWrite(options: ExecutableOptions): ExecutableGraphEngine;
export function createStagedWrite(options: DraftOptions | ExecutableOptions): DraftEngine | ExecutableGraphEngine {
  const assembled = assembleGraphEngine(options);
  return Object.freeze(options.mode === "executable" ? { ...assembled.base, ...assembled.execution } : assembled.base);
}

/** Graph engine with explicit draft-only or executable assembly. Both entries share ExecutionRuntime. */
function assembleGraphEngine(options: DraftOptions | ExecutableOptions) {
  const registry = new DefinitionRegistry(options?.definitions);
  if (options.mode !== undefined && options.mode !== "draft" && options.mode !== "executable") throw new Error("INVALID_MODE");
  if (options.mode !== "executable" && options.executors !== undefined) throw new Error("EXECUTABLE_MODE_REQUIRED");
  const executors = options.mode === "executable" ? assembleExecutors(registry, options.executors) : undefined;
  const plans = new Map<string, { certificate: string; plan: Step[]; binding: ExecutionBinding; executor: BoundExecutor }>();
  const runByDraft = new Map<string, string>();
  const runExecutors = new Map<string, BoundExecutor>();
  const drafts = new Map<string, GraphDraft>();
  const preflight = new GraphPreflight(registry, options.rules === undefined ? [] : options.rules);
  const checks = new Map<string, GraphCheck>();
  const checking = new Set<string>();
  const requireDraft = (id: string): GraphDraft => {
    const draft = drafts.get(id);
    if (!draft) throw new Error("DRAFT_NOT_FOUND");
    return draft;
  };
  const evaluateEdit = (id: string, expectedVersion: number, ops: readonly GraphOp[]) =>
    evaluateGraphEdit(registry, requireDraft(id), expectedVersion, ops);
  const base = {
    create(selector: DefinitionSelector): GraphDraft {
      const { digest } = registry.getDefinition(selector);
      const draft: GraphDraft = {
        id: randomUUID(), version: 0, type: selector.type, typeVersion: selector.typeVersion,
        definitionDigest: digest, nodes: {}, edges: {}, tombstones: { nodes: [], edges: [] }
      };
      drafts.set(draft.id, draft);
      return structuredClone(draft);
    },
    getDraft(id: string): GraphDraft { return structuredClone(requireDraft(id)); },
    evaluateEdit,
    preview: evaluateEdit,
    edit(id: string, expectedVersion: number, ops: readonly GraphOp[]): GraphDraft {
      if (runByDraft.has(id)) throw new Error("DRAFT_SEALED");
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const { candidate } = evaluateEdit(id, expectedVersion, ops);
      // Synchronous in-memory CAS: no await or callback between evaluation and save.
      drafts.set(id, candidate);
      checks.delete(id);
      plans.delete(id);
      return structuredClone(candidate);
    },
    preflight(id: string): GraphCheck {
      if (runByDraft.has(id)) throw new Error("DRAFT_SEALED");
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const draft = requireDraft(id);
      checks.delete(id);
      plans.delete(id);
      checking.add(id);
      try {
        const result = preflight.run(draft);
        if (executors) {
          result.scope = "execution";
          if (result.status === "passed") {
            const executor = executorFor(executors, draft);
            try {
              const plan = fixedPlan(executor, draft);
              const binding: ExecutionBinding = { checkId: result.checkId, definitionDigest: result.definitionDigest,
                rulesDigest: result.rulesDigest, executorId: executor.id, executorVersion: executor.version,
                target: executor.target, planDigest: definitionDigest(plan as unknown as Json) };
              result.certificate = randomUUID();
              result.execution = binding;
              plans.set(id, { certificate: result.certificate, plan, binding, executor });
            } catch {
              result.status = "incomplete";
              result.diagnostics.push({ code: "plan.error", path: "", message: "Executor did not produce a valid synchronous plan.",
                resolution: { kind: "blocked", reason: "unsupported" }, source: { kind: "executor", id: executor.id, version: executor.version } });
            }
          }
        }
        checks.set(id, result);
        return structuredClone(result);
      } finally { checking.delete(id); }
    },
    getCheck(id: string, checkId: string): GraphCheck {
      const draft = requireDraft(id);
      const check = checks.get(id);
      if (!check || check.checkId !== checkId || check.version !== draft.version ||
          check.definitionDigest !== draft.definitionDigest || check.rulesDigest !== preflight.rulesDigest(draft)) throw new Error("CHECK_NOT_CURRENT");
      return structuredClone(check);
    },
    getDefinition: (selector: DefinitionSelector) => registry.getDefinition(selector),
    validateValues: (selector: DefinitionSelector, nodeType: string, values: unknown) => registry.validateValues(selector, nodeType, values)
  };
  const revisions = new Map<string, string>();
  const execution = {
    /** Copy intent after a terminal, proven zero-effect failure; retain the sealed source. */
    revise(runId: string): GraphDraft {
      const executor = runExecutors.get(runId);
      if (!executor) throw new Error("RUN_NOT_FOUND");
      const run = executor.runtime.getRun(runId);
      if (run.state !== "failed" || !run.steps.some(s => s.status === "failed") ||
          run.steps.some(s => !["failed", "skipped"].includes(s.status))) throw new Error("ZERO_EFFECT_FAILURE_REQUIRED");
      const existing = revisions.get(runId);
      if (existing) return base.getDraft(existing);
      const draft = { ...structuredClone(requireDraft(run.draftId)), id: randomUUID(), version: 0, sourceRunId: runId };
      drafts.set(draft.id, draft);
      revisions.set(runId, draft.id);
      return structuredClone(draft);
    },
    async publish(id: string, certificate: string): Promise<Run> {
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const draft = requireDraft(id);
      const checked = plans.get(id);
      if (!checked || checked.certificate !== certificate) throw new Error("PREFLIGHT_REQUIRED");
      const check = base.getCheck(id, checked.binding.checkId);
      if (check.status !== "passed" || check.scope !== "execution") throw new Error("PREFLIGHT_REQUIRED");
      const previous = runByDraft.get(id);
      if (previous) return checked.executor.runtime.getRun(previous);
      const run = checked.executor.runtime.create(id, draft.version, checked.plan, checked.binding);
      // Establish the discoverable run and seal before the first dispatch can occur.
      runByDraft.set(id, run.id);
      runExecutors.set(run.id, checked.executor);
      return checked.executor.runtime.resume(run.id);
    },
    getRun(id: string): Run {
      const executor = runExecutors.get(id);
      if (!executor) throw new Error("RUN_NOT_FOUND");
      return executor.runtime.getRun(id);
    },
    async resume(id: string): Promise<Run> {
      const executor = runExecutors.get(id);
      if (!executor) throw new Error("RUN_NOT_FOUND");
      return executor.runtime.resume(id);
    }
  };
  return { base, execution };
}
