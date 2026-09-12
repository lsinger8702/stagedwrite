import { prepareRecovery, validateRecovery } from "./execution/recovery.js";
import { continuationReceipts, validateContinuation } from "./execution/continuation.js";
import { MemoryDraftStore } from "./storage/drafts.js";
import { SqliteDraftStore } from "./storage/sqlite.js";
import { randomUUID } from "node:crypto";
import { DefinitionRegistry } from "./registry/registry.js";
import type { DefinitionSelector } from "./registry/types.js";

import type { GraphDraft, GraphOp } from "./graph/types.js";
import { evaluateGraphEdit } from "./graph/edit.js";
import { GraphPreflight } from "./preflight/check.js";
import type { GraphRule, GraphCheck } from "./preflight/types.js";
import { assembleExecutors, executorFor, fixedPlan, type GraphExecutor, type BoundExecutor } from "./execution/graph.js";
import { definitionDigest, type Json } from "./registry/json.js";
import type { Run, Step, ExecutionBinding, Adjudication, StopRetry, RecoveryRequest, Clock } from "./types.js";

interface CommonOptions { definitions: readonly unknown[]; rules?: readonly GraphRule[] }
export interface DraftOptions extends CommonOptions { mode?: "draft"; executors?: never; storage?: { kind: "sqlite"; path: string } }
export interface ExecutableOptions extends CommonOptions { mode: "executable"; storage?: { kind: "sqlite"; path: string }; executors: readonly GraphExecutor[]; clock?: Clock }
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
  const recoveryClock = options.mode === "executable" ? options.clock : undefined;
  if (options.mode !== undefined && options.mode !== "draft" && options.mode !== "executable") throw new Error("INVALID_MODE");
  if (options.mode !== "executable" && options.executors !== undefined) throw new Error("EXECUTABLE_MODE_REQUIRED");
  const plans = new Map<string, { certificate: string; plan: Step[]; binding: ExecutionBinding; executor: BoundExecutor }>();
  const runByDraft = new Map<string, string>();
  const runExecutors = new Map<string, BoundExecutor>();
  const preflight = new GraphPreflight(registry, options.rules === undefined ? [] : options.rules);
  if (options.storage !== undefined && options.storage?.kind !== "sqlite") throw new Error("INVALID_STORAGE");
  const store = options.storage ? new SqliteDraftStore(options.storage.path, registry) : new MemoryDraftStore();
  let executors: Map<string, BoundExecutor> | undefined;
  try { executors = options.mode === "executable" ? assembleExecutors(registry, options.executors, options.clock,
    store instanceof SqliteDraftStore ? run => store.saveRun(run) : undefined) : undefined; }
  catch (error) { store.close(); throw error; }
  let closed = false;
  const assertOpen = () => { if (closed) throw new Error("STORE_CLOSED"); };
  const runIdForDraft = (id: string) => store instanceof SqliteDraftStore ? store.runForDraft(id) : runByDraft.get(id);
  const snapshotRun = (id: string): Run => {
    assertOpen();
    if (store instanceof SqliteDraftStore) return store.getRun(id);
    const executor = runExecutors.get(id); if (!executor) throw new Error("RUN_NOT_FOUND");
    return executor.runtime.getRun(id);
  };
  const boundTo = (executor: BoundExecutor, binding: ExecutionBinding | undefined) => {
    if (!executor || !binding || binding.executorId !== executor.id || binding.executorVersion !== executor.version || binding.target !== executor.target) throw new Error("EXECUTOR_BINDING_MISMATCH");
  };
  const recovering = new Set<string>();
  const runtimeForRun = (id: string): BoundExecutor => {
    assertOpen(); if (recovering.has(id)) throw new Error("RUN_BUSY"); const known = runExecutors.get(id); if (known) return known;
    const run = snapshotRun(id);
    const executor = executorFor(executors!, store.get(run.draftId)); boundTo(executor, run.binding);
    executor.runtime.restore(run); runExecutors.set(id, executor); return executor;
  };
  const checking = new Set<string>();
  const requireDraft = (id: string): GraphDraft => {
    const draft = store.get(id);
    if (registry.getDefinition(draft).digest !== draft.definitionDigest) throw new Error("DEFINITION_MISMATCH");
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
      store.create(draft);
      return structuredClone(draft);
    },
    listDraftIds(): string[] { return store.ids(); },
    close(): void { if (recovering.size) throw new Error("RUN_BUSY"); if (checking.size) throw new Error("CHECK_BUSY"); if ([...(executors?.values() ?? [])].some(e => e.runtime.isBusy())) throw new Error("RUN_BUSY"); store.close(); closed = true; },
    getDraft(id: string): GraphDraft { return structuredClone(requireDraft(id)); },
    evaluateEdit,
    preview: evaluateEdit,
    edit(id: string, expectedVersion: number, ops: readonly GraphOp[]): GraphDraft {
      if (runIdForDraft(id) !== undefined) throw new Error("DRAFT_SEALED");
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const { candidate } = evaluateEdit(id, expectedVersion, ops);
      // Conditional storage update: candidate and check invalidation commit together.
      store.edit(candidate, expectedVersion);
      plans.delete(id);
      return structuredClone(candidate);
    },
    preflight(id: string): GraphCheck {
      if (runIdForDraft(id) !== undefined) throw new Error("DRAFT_SEALED");
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const draft = requireDraft(id);
      const epoch = store.beginCheck(id, draft.version);
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
              if (draft.continuation) {
                const source = snapshotRun(draft.continuation.sourceRunId);
                if (source.binding?.executorId !== executor.id || source.binding.executorVersion !== executor.version ||
                    source.binding.target !== executor.target || source.binding.definitionDigest !== draft.definitionDigest) throw new Error("CONTINUATION_BINDING_MISMATCH");
                validateContinuation(plan, draft, source, requireDraft(source.draftId));
              }
              const binding: ExecutionBinding = { checkId: result.checkId, definitionDigest: result.definitionDigest,
                rulesDigest: result.rulesDigest, executorId: executor.id, executorVersion: executor.version,
                target: executor.target, planDigest: definitionDigest(plan as unknown as Json) };
              if (draft.continuation) binding.continuationDigest = definitionDigest(draft.continuation as unknown as Json);
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
        const fixed = plans.get(id);
        try { store.saveCheck(result, epoch, fixed ? { certificate: fixed.certificate, plan: fixed.plan, binding: fixed.binding } : undefined); }
        catch (error) { plans.delete(id); throw error; }
        return structuredClone(result);
      } finally { checking.delete(id); }
    },
    getCheck(id: string, checkId?: string): GraphCheck {
      const draft = requireDraft(id);
      const check = store.getCheck(id);
      if (!check || (checkId !== undefined && check.checkId !== checkId) || check.version !== draft.version ||
          check.definitionDigest !== draft.definitionDigest || check.rulesDigest !== preflight.rulesDigest(draft)) throw new Error("CHECK_NOT_CURRENT");
      if (requireDraft(id).version !== draft.version) throw new Error("CHECK_NOT_CURRENT");
      return structuredClone(check);
    },
    getDefinition: (selector: DefinitionSelector) => registry.getDefinition(selector),
    validateValues: (selector: DefinitionSelector, nodeType: string, values: unknown) => registry.validateValues(selector, nodeType, values)
  };
  const revisions = new Map<string, string>();
  const continuations = new Map<string, string>();
  const execution = {
    recover(runId: string, input: RecoveryRequest): Run {
      assertOpen();
      if (!(store instanceof SqliteDraftStore)) throw new Error("DURABLE_STORAGE_REQUIRED");
      if (recovering.has(runId) || runExecutors.get(runId)?.runtime.isBusy()) throw new Error("RUN_BUSY");
      recovering.add(runId);
      try {
        const command = validateRecovery(input);
        const snapshot = store.getRun(runId);
        const draft = requireDraft(snapshot.draftId);
        const executor = executorFor(executors!, draft);
        boundTo(executor, snapshot.binding);
        if (snapshot.binding?.rulesDigest !== preflight.rulesDigest(draft) || snapshot.binding.definitionDigest !== draft.definitionDigest) throw new Error("RECOVERY_BINDING_MISMATCH");
        const recovered = store.recover(runId, command, (run, prior, owner) =>
          prepareRecovery(run, store.getPlan(run.draftId), command, prior, owner, recoveryClock));
        executor.runtime.acceptRecovery(recovered);
        runExecutors.set(runId, executor);
        return structuredClone(recovered);
      } finally { recovering.delete(runId); }
    },
    listRunIds(): string[] { assertOpen(); return store instanceof SqliteDraftStore ? store.runIds() : [...runExecutors.keys()].sort(); },
    stopRetry(runId: string, command: StopRetry): Run {
      const executor = runtimeForRun(runId);
      return executor.runtime.stopRetry(runId, command);
    },
    /** Continue a terminal partial failure with mapped, immutable successful creates. */
    continueFrom(runId: string): GraphDraft {
      const run = snapshotRun(runId);
      const original = requireDraft(run.draftId);
      const receipts = continuationReceipts(run, original);
      const existing = continuations.get(runId);
      if (existing) return base.getDraft(existing);
      const draft: GraphDraft = { ...structuredClone(original), id: randomUUID(), version: 0,
        sourceRunId: runId, continuation: { sourceRunId: runId, receipts } };
      if (store instanceof SqliteDraftStore) return structuredClone(store.derive(draft, runId, "continue"));
      store.create(draft);
      continuations.set(runId, draft.id);
      return structuredClone(draft);
    },
    adjudicate(runId: string, stepId: string, command: Adjudication): Run {
      const executor = runtimeForRun(runId);
      return executor.runtime.adjudicate(runId, stepId, command);
    },
    /** Copy intent after a terminal, proven zero-effect failure; retain the sealed source. */
    revise(runId: string): GraphDraft {
      const run = snapshotRun(runId);
      if (run.state !== "failed" || !run.steps.some(s => s.status === "failed") ||
          run.steps.some(s => !["failed", "skipped"].includes(s.status))) throw new Error("ZERO_EFFECT_FAILURE_REQUIRED");
      const existing = revisions.get(runId);
      if (existing) return base.getDraft(existing);
      const draft = { ...structuredClone(requireDraft(run.draftId)), id: randomUUID(), version: 0, sourceRunId: runId };
      if (store instanceof SqliteDraftStore) return structuredClone(store.derive(draft, runId, "revise"));
      store.create(draft);
      revisions.set(runId, draft.id);
      return structuredClone(draft);
    },
    async publish(id: string, certificate: string): Promise<Run> {
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const draft = requireDraft(id);
      const saved = store instanceof SqliteDraftStore ? store.getPlan(id) : undefined;
      const checked = store instanceof SqliteDraftStore ? (saved && { ...saved, executor: executorFor(executors!, draft) }) : plans.get(id);
      if (!checked || checked.certificate !== certificate) throw new Error("PREFLIGHT_REQUIRED");
      boundTo(checked.executor, checked.binding);
      const check = base.getCheck(id, checked.binding.checkId);
      if (check.status !== "passed" || check.scope !== "execution") throw new Error("PREFLIGHT_REQUIRED");
      const previous = runIdForDraft(id);
      if (previous) return snapshotRun(previous);
      let run: Run;
      checking.add(id);
      try {
        run = checked.executor.runtime.create(id, draft.version, checked.plan, checked.binding, draft.continuation?.receipts);
        if (store instanceof SqliteDraftStore) {
          const actualId = store.publishRun(run, certificate);
          if (actualId !== run.id) return store.getRun(actualId);
        }
      } finally { checking.delete(id); }
      // Establish the discoverable run and seal before the first dispatch can occur.
      runByDraft.set(id, run.id);
      runExecutors.set(run.id, checked.executor);
      return checked.executor.runtime.resume(run.id);
    },
    getRun(id: string): Run {
      return snapshotRun(id);
    },
    async resume(id: string): Promise<Run> {
      return runtimeForRun(id).runtime.resume(id);
    }
  };
  return { base, execution };
}
