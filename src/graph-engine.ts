import { validateRepair } from "./execution/repair.js";
import { validDiagnostic } from "./preflight/diagnostic.js";
import { previewDraft } from "./preflight/preview.js";
import { pointer } from "./registry/json.js";
import { performance } from "node:perf_hooks";
import { AsyncPreflight } from "./preflight/async.js";
import { confirmedDraft, validateImportConfirmed } from "./execution/import-confirmed.js";
import { prepareRecovery, validateRecovery } from "./execution/recovery.js";
import { continuationReceipts, validateContinuation } from "./execution/continuation.js";
import { publicationId, requireSameSubmission, type PublishOptions } from "./execution/publication.js";
import type { RunInput } from "./storage/drafts.js";
import { MemoryDraftStore } from "./storage/drafts.js";
import { SqliteDraftStore } from "./storage/sqlite.js";
import { randomUUID } from "node:crypto";
import { DefinitionRegistry } from "./registry/registry.js";
import type { DefinitionSelector } from "./registry/types.js";

import { initializeGraph } from "./graph/initial.js";
import type { GraphDraft, GraphOp, GraphInitialIntent } from "./graph/types.js";
import { evaluateGraphEdit } from "./graph/edit.js";
import { GraphPreflight } from "./preflight/check.js";
import type { GraphExecutionResult, GraphDiagnostic, AsyncGraphRule, GraphRule, GraphCheck } from "./preflight/types.js";
import { assembleExecutors, executorFor, fixedPlan, type GraphExecutor, type BoundExecutor } from "./execution/graph.js";
import { definitionDigest, type Json } from "./registry/json.js";
import type { Run, Step, ExecutionBinding, Adjudication, StopRetry, RecoveryRequest, ImportConfirmedRequest, Clock } from "./types.js";

interface CommonOptions { definitions: readonly unknown[]; rules?: readonly GraphRule[] }
export interface DraftOptions extends CommonOptions { mode?: "draft"; executors?: never; storage?: { kind: "sqlite"; path: string } }
export interface ExecutableOptions extends CommonOptions { mode: "executable"; storage?: { kind: "sqlite"; path: string }; executors: readonly GraphExecutor[]; clock?: Clock }
export type DraftEngine = ReturnType<typeof assembleGraphEngine>["base"];
export type ExecutableGraphEngine = DraftEngine & ReturnType<typeof assembleGraphEngine>["execution"];
interface AsyncOptions { asyncRules: readonly AsyncGraphRule[]; preflightTimeoutMs?: number }
export type AsyncDraftOptions = DraftOptions & AsyncOptions;
export type AsyncExecutableOptions = ExecutableOptions & AsyncOptions;
export type AsyncDraftEngine = Omit<DraftEngine, "preflight"> & { preflight(id: string): Promise<GraphCheck> };
export type AsyncExecutableGraphEngine = Omit<ExecutableGraphEngine, "preflight"> & { preflight(id: string): Promise<GraphCheck> };
export function createStagedWrite(options: AsyncExecutableOptions): AsyncExecutableGraphEngine;
export function createStagedWrite(options: AsyncDraftOptions): AsyncDraftEngine;
export function createStagedWrite(options: DraftOptions): DraftEngine;
export function createStagedWrite(options: ExecutableOptions): ExecutableGraphEngine;
export function createStagedWrite(options: (DraftOptions | ExecutableOptions) & Partial<AsyncOptions>): DraftEngine | ExecutableGraphEngine | AsyncDraftEngine | AsyncExecutableGraphEngine {
  const assembled = assembleGraphEngine(options);
  const base = options.asyncRules === undefined ? assembled.base : { ...assembled.base, preflight: assembled.asyncPreflight };
  return Object.freeze(options.mode === "executable" ? { ...base, ...assembled.execution } : base);
}

/** Graph engine with explicit draft-only or executable assembly. Both entries share ExecutionRuntime. */
function assembleGraphEngine(options: (DraftOptions | ExecutableOptions) & Partial<AsyncOptions>) {
  const registry = new DefinitionRegistry(options?.definitions);
  const recoveryClock = options.mode === "executable" ? options.clock : undefined;
  if (options.mode !== undefined && options.mode !== "draft" && options.mode !== "executable") throw new Error("INVALID_MODE");
  if (options.mode !== "executable" && options.executors !== undefined) throw new Error("EXECUTABLE_MODE_REQUIRED");
  const plans = new Map<string, { certificate: string; plan: Step[]; binding: ExecutionBinding; executor: BoundExecutor }>();
  const runInputs = new Map<string, RunInput>();
  const publishing = new Set<string>();
  const runExecutors = new Map<string, BoundExecutor>();
  const preflight = new GraphPreflight(registry, options.rules === undefined ? [] : options.rules);
  const asyncChecks = options.asyncRules === undefined ? undefined : new AsyncPreflight(registry, options.rules ?? [], options.asyncRules, options.preflightTimeoutMs ?? 5000);
  const rulesDigest = (draft: GraphDraft) => asyncChecks?.digest(draft, preflight.rulesDigest(draft)) ?? preflight.rulesDigest(draft);
  if (options.storage !== undefined && options.storage?.kind !== "sqlite") throw new Error("INVALID_STORAGE");
  const store = options.storage ? new SqliteDraftStore(options.storage.path, registry) : new MemoryDraftStore();
  let executors: Map<string, BoundExecutor> | undefined;
  try { executors = options.mode === "executable" ? assembleExecutors(registry, options.executors, options.clock,
    store instanceof SqliteDraftStore ? run => store.saveRun(run) : undefined) : undefined; }
  catch (error) { store.close(); throw error; }
  let closed = false;
  const assertOpen = () => { if (closed) throw new Error("STORE_CLOSED"); };
  const snapshotRun = (id: string): Run => {
    assertOpen();
    if (store instanceof SqliteDraftStore) return store.getRun(id);
    const executor = runExecutors.get(id); if (!executor) throw new Error("RUN_NOT_FOUND");
    return executor.runtime.getRun(id);
  };
  const originalInputForRun = (id: string): RunInput => {
    assertOpen();
    const input = store instanceof SqliteDraftStore ? store.getRunInput(id) : runInputs.get(id);
    if (!input) throw new Error("RUN_NOT_FOUND");
    return structuredClone(input);
  };
  const inputForRun = (id: string): RunInput => snapshotRun(id).repairInput ?? originalInputForRun(id);
  const response = (run: Run, check?: GraphCheck): GraphExecutionResult => {
    const draft = inputForRun(run.id).draft;
    const diagnostics: GraphDiagnostic[] = [];
    for (const step of run.steps) if (step.feedback) {
      const accepted = step.feedback.diagnostics?.filter(d => validDiagnostic(d as unknown as Json, registry, draft)) ?? [];
      diagnostics.push(...structuredClone(accepted));
      if (!["applied", "reused", "skipped"].includes(step.status) && !accepted.length && (step.feedback.message || step.feedback.reason || step.feedback.code)) diagnostics.push({
        code: step.feedback.code ?? `execution.${step.status}`, path: step.effect ? `/nodes/${pointer(step.effect.nodeId)}` : "",
        message: step.feedback.message ?? step.feedback.reason ?? step.feedback.code!
      });
    }
    return { ...structuredClone(run), preview: check?.preview ?? previewDraft(draft, registry.getDefinition(draft).definition), diagnostics: check?.diagnostics ?? diagnostics, ...(check ? { check } : {}) };
  };
  const resuming = new Set<string>();
  const runsForDraft = (id: string) => (store instanceof SqliteDraftStore ? store.runIds() : [...runInputs.keys()]).map(snapshotRun).filter(run => run.draftId === id);
  const validateDraftRepair = (candidate: GraphDraft) => {
    for (const run of runsForDraft(candidate.id)) {
      if (!executors) throw new Error("DRAFT_SEALED");
      if (resuming.has(run.id) || runExecutors.get(run.id)?.runtime.isBusy()) throw new Error("RUN_BUSY");
      validateRepair(run, inputForRun(run.id).draft, candidate, fixedPlan(executorFor(executors!, candidate), candidate));
    }
  };
  const boundTo = (executor: BoundExecutor, binding: ExecutionBinding | undefined) => {
    if (!executor || !binding || binding.executorId !== executor.id || binding.executorVersion !== executor.version || binding.target !== executor.target) throw new Error("EXECUTOR_BINDING_MISMATCH");
  };
  const recovering = new Set<string>();
  const runtimeForRun = (id: string): BoundExecutor => {
    assertOpen(); if (recovering.has(id)) throw new Error("RUN_BUSY"); const known = runExecutors.get(id); if (known) return known;
    const run = snapshotRun(id);
    const executor = executorFor(executors!, inputForRun(id).draft); boundTo(executor, run.binding);
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
  const performPreflight = (id: string, asynchronous: boolean): GraphCheck | Promise<GraphCheck> => {
    if (checking.has(id)) throw new Error("CHECK_BUSY");
    const draft = requireDraft(id);
    const epoch = store.beginCheck(id, draft.version);
    plans.delete(id);
    checking.add(id);
    const finish = (result: GraphCheck): GraphCheck => {
        if (executors) {
          result.scope = "execution";
          if (result.status === "passed") {
            const executor = executorFor(executors, draft);
            try {
              const plan = fixedPlan(executor, draft);
              const reuse = draft.continuation ?? draft.imported;
              if (reuse) {
                const source = snapshotRun(reuse.sourceRunId);
                if (source.binding?.executorId !== executor.id || source.binding.executorVersion !== executor.version ||
                    source.binding.target !== executor.target || source.binding.definitionDigest !== draft.definitionDigest) throw new Error("CONTINUATION_BINDING_MISMATCH");
                validateContinuation(plan, draft, source, inputForRun(source.id).draft);
              }
              const binding: ExecutionBinding = { checkId: result.checkId, definitionDigest: result.definitionDigest,
                rulesDigest: result.rulesDigest, executorId: executor.id, executorVersion: executor.version,
                target: executor.target, planDigest: definitionDigest(plan as unknown as Json) };
              if (draft.imported) binding.importDigest = definitionDigest(draft.imported as unknown as Json);
              if (draft.continuation) binding.continuationDigest = definitionDigest(draft.continuation as unknown as Json);
              result.certificate = randomUUID();
              result.execution = binding;
              plans.set(id, { certificate: result.certificate, plan, binding, executor });
            } catch {
              result.status = "incomplete";
              result.diagnostics.push({ code: "plan.error", path: "", message: "Executor did not produce a valid synchronous plan.",
                severity: "error", source: { kind: "executor", id: executor.id, version: executor.version } });
            }
          }
        }
        const fixed = plans.get(id);
        try { store.saveCheck(result, epoch, fixed ? { certificate: fixed.certificate, plan: fixed.plan, binding: fixed.binding } : undefined); }
        catch (error) { plans.delete(id); throw error; }
        return structuredClone(result);
    };
    try {
      const deadline = performance.now() + (asyncChecks?.timeoutMs ?? 5000);
      const result = preflight.run(draft);
      result.rulesDigest = rulesDigest(draft);
      if (asynchronous && asyncChecks) return asyncChecks.run(draft, result, deadline).then(finish).finally(() => checking.delete(id));
      const saved = finish(result);
      checking.delete(id);
      return saved;
    } catch (error) { checking.delete(id); throw error; }
  };
  const base = {
    /** Supply initial work content. Omission is retained only for legacy empty-draft callers. */
    create(selector: DefinitionSelector, initial?: GraphInitialIntent): GraphDraft {
      assertOpen();
      const { digest } = registry.getDefinition(selector);
      const draft: GraphDraft = {
        id: randomUUID(), version: 0, type: selector.type, typeVersion: selector.typeVersion,
        definitionDigest: digest, nodes: {}, edges: {}, tombstones: { nodes: [], edges: [] }
      };
      const created = initial === undefined ? draft : initializeGraph(registry, draft, initial);
      store.create(created);
      return structuredClone(created);
    },
    listDraftIds(): string[] { return store.ids(); },
    close(): void { if (recovering.size) throw new Error("RUN_BUSY"); if (checking.size) throw new Error("CHECK_BUSY"); if (resuming.size) throw new Error("RUN_BUSY"); if ([...(executors?.values() ?? [])].some(e => e.runtime.isBusy())) throw new Error("RUN_BUSY"); store.close(); closed = true; },
    getDraft(id: string): GraphDraft { return structuredClone(requireDraft(id)); },
    evaluateEdit,
    preview: evaluateEdit,
    edit(id: string, expectedVersion: number, ops: readonly GraphOp[]): GraphDraft {
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const { candidate } = evaluateEdit(id, expectedVersion, ops);
      // Conditional storage update: candidate and check invalidation commit together.
      checking.add(id);
      try { store.edit(candidate, expectedVersion, () => validateDraftRepair(candidate)); }
      finally { checking.delete(id); }
      plans.delete(id);
      return structuredClone(candidate);
    },
    preflight(id: string): GraphCheck { return performPreflight(id, false) as GraphCheck; },
    getCheck(id: string, checkId?: string): GraphCheck {
      const draft = requireDraft(id);
      const check = store.getCheck(id);
      if (!check || check.formatVersion !== 2 || (checkId !== undefined && check.checkId !== checkId) || check.version !== draft.version ||
          check.definitionDigest !== draft.definitionDigest || check.rulesDigest !== rulesDigest(draft)) throw new Error("CHECK_NOT_CURRENT");
      if (requireDraft(id).version !== draft.version) throw new Error("CHECK_NOT_CURRENT");
      return structuredClone(check);
    },
    getDefinition: (selector: DefinitionSelector) => registry.getDefinition(selector),
    validateValues: (selector: DefinitionSelector, nodeType: string, values: unknown) => registry.validateValues(selector, nodeType, values)
  };
  const revisions = new Map<string, string>();
  const continuations = new Map<string, string>();
  const imports = new Map<string, { command: ImportConfirmedRequest; draftId: string }>();
  const execution = {
    importConfirmed(runId: string, input: ImportConfirmedRequest): GraphDraft {
      assertOpen();
      const command = validateImportConfirmed(input);
      const source = snapshotRun(runId);
      const original = inputForRun(source.id).draft;
      const executor = executorFor(executors!, original);
      boundTo(executor, source.binding);
      const key = JSON.stringify([runId, command.requestId]);
      const prior = imports.get(key);
      if (prior) {
        if (definitionDigest(prior.command as unknown as Json) !== definitionDigest(command as unknown as Json)) throw new Error("IMPORT_CONFLICT");
        return base.getDraft(prior.draftId);
      }
      const create = () => confirmedDraft(source, original, command);
      if (store instanceof SqliteDraftStore) return store.importConfirmed(runId, command, create);
      const draft = create(); store.create(draft);
      imports.set(key, { command, draftId: draft.id });
      return structuredClone(draft);
    },
    recover(runId: string, input: RecoveryRequest): GraphExecutionResult {
      assertOpen();
      if (!(store instanceof SqliteDraftStore)) throw new Error("DURABLE_STORAGE_REQUIRED");
      if (recovering.has(runId) || runExecutors.get(runId)?.runtime.isBusy()) throw new Error("RUN_BUSY");
      recovering.add(runId);
      try {
        const command = validateRecovery(input);
        const snapshot = store.getRun(runId);
        const draft = inputForRun(runId).draft;
        const executor = executorFor(executors!, draft);
        boundTo(executor, snapshot.binding);
        if (snapshot.binding?.rulesDigest !== rulesDigest(draft) || snapshot.binding.definitionDigest !== draft.definitionDigest) throw new Error("RECOVERY_BINDING_MISMATCH");
        const recovered = store.recover(runId, command, (run, prior, owner) =>
          prepareRecovery(run, run.repairInput ?? store.getRunInput(run.id), command, prior, owner, recoveryClock));
        executor.runtime.acceptRecovery(recovered);
        runExecutors.set(runId, executor);
        return response(recovered);
      } finally { recovering.delete(runId); }
    },
    listRunIds(): string[] { assertOpen(); return store instanceof SqliteDraftStore ? store.runIds() : [...runExecutors.keys()].sort(); },
    stopRetry(runId: string, command: StopRetry): GraphExecutionResult {
      const executor = runtimeForRun(runId);
      return response(executor.runtime.stopRetry(runId, command));
    },
    /** Continue a terminal partial failure with mapped, immutable successful creates. */
    continueFrom(runId: string): GraphDraft {
      const run = snapshotRun(runId);
      const original = inputForRun(runId).draft;
      const receipts = continuationReceipts(run, original);
      const existing = continuations.get(runId);
      if (existing) return base.getDraft(existing);
      const { imported: _imported, ...continued } = structuredClone(original);
      const draft: GraphDraft = { ...continued, id: randomUUID(), version: 0,
        sourceRunId: runId, continuation: { sourceRunId: runId, receipts } };
      if (store instanceof SqliteDraftStore) return structuredClone(store.derive(draft, runId, "continue"));
      store.create(draft);
      continuations.set(runId, draft.id);
      return structuredClone(draft);
    },
    adjudicate(runId: string, stepId: string, command: Adjudication): GraphExecutionResult {
      const executor = runtimeForRun(runId);
      return response(executor.runtime.adjudicate(runId, stepId, command));
    },
    /** Copy intent after a terminal, proven zero-effect failure; retain the sealed source. */
    revise(runId: string): GraphDraft {
      const run = snapshotRun(runId);
      if (run.state !== "failed" || !run.steps.some(s => s.status === "failed") ||
          run.steps.some(s => !["failed", "skipped"].includes(s.status))) throw new Error("ZERO_EFFECT_FAILURE_REQUIRED");
      const existing = revisions.get(runId);
      if (existing) return base.getDraft(existing);
      const draft = { ...inputForRun(runId).draft, id: randomUUID(), version: 0, sourceRunId: runId };
      if (store instanceof SqliteDraftStore) return structuredClone(store.derive(draft, runId, "revise"));
      store.create(draft);
      revisions.set(runId, draft.id);
      return structuredClone(draft);
    },
    /** Omit options for a fresh intent; reuse an explicit runId only for the same submission. */
    async publish(id: string, certificate: string, options?: PublishOptions): Promise<GraphExecutionResult> {
      assertOpen();
      const runId = publicationId(options);
      const prior = store instanceof SqliteDraftStore ? store.hasRun(runId) : runInputs.has(runId);
      if (prior) {
        requireSameSubmission(originalInputForRun(runId), id, certificate);
        return response(snapshotRun(runId));
      }
      if (publishing.has(runId)) throw new Error("RUN_BUSY");
      if (checking.has(id)) throw new Error("CHECK_BUSY");
      const draft = requireDraft(id);
      const saved = store instanceof SqliteDraftStore ? store.getPlan(id) : undefined;
      const checked = store instanceof SqliteDraftStore ? (saved && { ...saved, executor: executorFor(executors!, draft) }) : plans.get(id);
      if (!checked || checked.certificate !== certificate) throw new Error("PREFLIGHT_REQUIRED");
      boundTo(checked.executor, checked.binding);
      const check = base.getCheck(id, checked.binding.checkId);
      if (check.status !== "passed" || check.scope !== "execution") throw new Error("PREFLIGHT_REQUIRED");
      const input: RunInput = { draft: structuredClone(draft), certificate, plan: structuredClone(checked.plan), binding: structuredClone(checked.binding) };
      let run: Run;
      checking.add(id); publishing.add(runId);
      try {
        run = checked.executor.runtime.prepare(id, draft.version, checked.plan, checked.binding, draft.continuation?.receipts ?? draft.imported?.receipts, runId);
        if (store instanceof SqliteDraftStore && !store.publishRun(run, input)) return response(store.getRun(runId));
        checked.executor.runtime.register(run);
        runInputs.set(runId, structuredClone(input));
        runExecutors.set(runId, checked.executor);
      } finally { checking.delete(id); publishing.delete(runId); }
      // The Run and its immutable input are discoverable before the first remote dispatch.
      return response(await checked.executor.runtime.resume(runId));
    },
    getRunInput(id: string): RunInput { return inputForRun(id); },
    getRun(id: string): GraphExecutionResult {
      return response(snapshotRun(id));
    },
    async resume(id: string): Promise<GraphExecutionResult> {
      if (resuming.has(id)) throw new Error("RUN_BUSY");
      const executor = runtimeForRun(id);
      resuming.add(id);
      try {
        let run = snapshotRun(id);
        const draft = requireDraft(run.draftId);
        if (draft.version !== run.version && !["published", "closed"].includes(run.state)) {
          if (run.steps.some(s => s.status === "unknown")) {
            run = await executor.runtime.reconcileForRepair(id);
            if (run.steps.some(s => s.status === "unknown")) return response(run);
          }
          validateRepair(run, inputForRun(id).draft, draft, fixedPlan(executor, draft));
          const check = await performPreflight(draft.id, asyncChecks !== undefined);
          if (check.status !== "passed") return response(run, check);
          const fixed = store instanceof SqliteDraftStore ? store.getPlan(draft.id) : plans.get(draft.id);
          if (!fixed || fixed.certificate !== check.certificate || requireDraft(draft.id).version !== check.version) throw new Error("STALE_CHECK");
          const input: RunInput = { draft: requireDraft(draft.id), certificate: fixed.certificate, plan: fixed.plan, binding: fixed.binding };
          boundTo(executor, input.binding);
          executor.runtime.repair(id, inputForRun(id), input);
        }
        return response(await executor.runtime.resume(id));
      } finally { resuming.delete(id); }
    }
  };
  return { base, execution, asyncPreflight: async (id: string): Promise<GraphCheck> => performPreflight(id, true) };
}
