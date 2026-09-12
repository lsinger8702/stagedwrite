import { requireSafeStop, validateStopRetry } from "./stop-retry.js";
import { validateAdjudication } from "./adjudication.js";
import { definitionDigest, type Json } from "../registry/json.js";
import { validatePlan } from "./plan.js";
import { randomUUID } from "node:crypto";
import type { Adapter, ApplyOutcome, ReconcileOutcome, Event, Run, Step, Adjudication, ReusedReceipt, StopRetry, Clock } from "../types.js";

/** Shared execution state machine with optional durable checkpoints. */
export class ExecutionRuntime {
  private runs = new Map<string, Run>();
  private busy = new Set<string>();
  private restored = new Set<string>();
  private poisoned = new Set<string>();
  private committed = new Map<string, Run>();
  constructor(private readonly adapter: Pick<Adapter, "apply" | "reconcile">, private readonly clock: Clock = Date.now, private readonly persist?: (run: Run) => void) {
    if (typeof clock !== "function") throw new Error("INVALID_CLOCK");
  }
  create(draftId: string, version: number, plan: Step[], binding?: Run["binding"], receipts: Record<string, ReusedReceipt> = {}): Run {
    const id = randomUUID();
    const run: Run = { id, draftId, version, state: "running", events: [],
      ...(binding ? { binding: structuredClone(binding) } : {}),
      steps: validatePlan(plan).map(step => ({ ...structuredClone(step), key: `${id}:${step.id}`, status: "ready" })) };
    for (const step of run.steps) if (Object.hasOwn(receipts, step.id)) {
      const receipt = structuredClone(receipts[step.id]!);
      step.status = "reused";
      step.remoteRef = receipt.remoteRef;
      step.resolvedPayload = structuredClone(receipt.resolvedPayload);
      step.reusedFrom = receipt;
      this.record(run, step.id, "reused", { reusedFrom: structuredClone(receipt) });
    }
    this.runs.set(id, run);
    this.committed.set(id, structuredClone(run));
    return structuredClone(run);
  }
  restore(run: Run): void { if (!this.runs.has(run.id)) { this.runs.set(run.id, structuredClone(run)); this.restored.add(run.id); } }
  acceptRecovery(run: Run): void {
    if (this.poisoned.has(run.id)) throw new Error("RUN_STORAGE_FAILED");
    if (this.busy.has(run.id)) throw new Error("RUN_BUSY");
    this.runs.set(run.id, structuredClone(run));
    this.committed.set(run.id, structuredClone(run));
    this.restored.delete(run.id);
  }
  isBusy(): boolean { return this.busy.size > 0; }
  private writable(id: string): void {
    if (this.restored.has(id)) throw new Error("RECOVERY_REQUIRED");
    if (this.poisoned.has(id)) throw new Error("RUN_STORAGE_FAILED");
  }
  private checkpoint(run: Run): void {
    if (!this.persist) return;
    try { this.persist(structuredClone(run)); this.committed.set(run.id, structuredClone(run)); }
    catch (error) { this.poisoned.add(run.id); this.runs.set(run.id, structuredClone(this.committed.get(run.id)!)); throw error; }
  }
  getRun(id: string): Run { return structuredClone(this.requireRun(id)); }
  resume(id: string): Promise<Run> { return this.advance(this.requireRun(id)); }
  /** Records a trusted caller's decision without making any adapter call. */
  adjudicate(id: string, stepId: string, input: Adjudication): Run {
    const run = this.requireRun(id);
    if (this.busy.has(id)) throw new Error("RUN_BUSY");
    this.writable(id);
    this.busy.add(id);
    try {
      const command = validateAdjudication(input);
      const previous = run.events.find(e => e.adjudication?.requestId === command.requestId);
      if (previous) {
        if (previous.stepId !== stepId || definitionDigest(previous.adjudication as unknown as Json) !== definitionDigest(command as unknown as Json)) throw new Error("ADJUDICATION_CONFLICT");
        return structuredClone(run);
      }
      if (command.expectedSequence !== run.events.length) throw new Error("STALE_RUN");
      const step = run.steps.find(s => s.id === stepId);
      if (run.state !== "unknown" || step?.status !== "unknown") throw new Error("UNRESOLVED_STEP_REQUIRED");
      // The busy guard covers CAS, clock callback, event append and state transition.
      this.record(run, stepId, "adjudicated", { adjudication: command });
      const decision = command.decision;
      if (decision.kind === "applied") {
        step.status = "applied";
        step.remoteRef = decision.remoteRef;
        run.state = "blocked";
      } else if (decision.kind === "no_effect") {
        step.status = decision.next === "retry" ? "ready" : "failed";
        run.state = decision.next === "retry" ? "blocked" : "failed";
        if (decision.next === "stop") {
          step.failureReason = "manual_no_effect";
          step.failureEventSequence = run.events.length;
          this.stopRemaining(run, step.id);
        }
      } else {
        // Administrative closure is not evidence of no effects. Keep the step unknown.
        run.state = "closed";
        this.stopRemaining(run, step.id, false);
      }
      this.checkpoint(run);
      return structuredClone(run);
    } finally { this.busy.delete(id); }
  }
  stopRetry(id: string, input: StopRetry): Run {
    const run = this.requireRun(id);
    if (this.busy.has(id)) throw new Error("RUN_BUSY");
    this.writable(id);
    this.busy.add(id);
    try {
      const command = validateStopRetry(input);
      const previous = run.events.find(e => e.stopRetry?.requestId === command.requestId);
      if (previous) {
        if (definitionDigest(previous.stopRetry as unknown as Json) !== definitionDigest(command as unknown as Json)) throw new Error("STOP_RETRY_CONFLICT");
        return structuredClone(run);
      }
      if (command.expectedSequence !== run.events.length) throw new Error("STALE_RUN");
      requireSafeStop(run);
      const pending = run.steps.find(s => s.status === "ready");
      if (!pending) throw new Error("NO_PENDING_STEPS");
      this.record(run, pending.id, "retry_stopped", { stopRetry: command, reason: command.reason });
      pending.status = "failed";
      pending.failureReason = "retry_stopped";
      pending.failureEventSequence = run.events.length;
      run.state = "failed";
      this.stopRemaining(run, pending.id, false);
      this.checkpoint(run);
      return structuredClone(run);
    } finally { this.busy.delete(id); }
  }
  private async advance(run: Run): Promise<Run> {
    if (this.busy.has(run.id)) throw new Error("RUN_BUSY");
    if (run.state === "published" || run.state === "failed" || run.state === "closed") return structuredClone(run);
    this.writable(run.id);
    this.busy.add(run.id);
    run.state = "running";
    try {
      for (const step of run.steps) {
        if (step.status === "applied" || step.status === "reused" || step.status === "skipped") continue;
        if (!step.resolvedPayload) {
          const payload = structuredClone(step.payload);
          for (const dependency of step.dependsOn ?? []) {
            if (!["applied", "reused"].includes(run.steps.find(s => s.id === dependency)?.status ?? "")) throw new Error("DEPENDENCY_NOT_APPLIED");
          }
          for (const [field, dependency] of Object.entries(step.inputRefs ?? {})) {
            const parent = run.steps.find(s => s.id === dependency)!;
            if (parent.remoteRef === undefined) throw new Error("DEPENDENCY_RESULT_MISSING");
            payload[field] = parent.remoteRef;
          }
          step.resolvedPayload = payload;
        }
        if (step.status === "unknown") {
          this.record(run, step.id, "reconciling");
          this.checkpoint(run);
          const result = await this.observe("reconcile", () => this.adapter.reconcile({ ...structuredClone(step), payload: structuredClone(step.resolvedPayload!) }, step.key));
          if (result.kind === "applied") {
            step.status = "applied";
            step.remoteRef = result.remoteRef;
            this.record(run, step.id, "applied");
            this.checkpoint(run);
            continue;
          }
          if (result.kind === "unknown") {
            run.state = "unknown";
            this.record(run, step.id, "unknown", { reason: result.reason });
            this.checkpoint(run);
            return structuredClone(run);
          }
          this.record(run, step.id, "no_effect", { reason: result.reason });
          step.status = "ready";
        }
        step.status = "dispatching";
        this.record(run, step.id, "dispatching");
        this.checkpoint(run);
        const result = await this.observe("apply", () => this.adapter.apply({ ...structuredClone(step), payload: structuredClone(step.resolvedPayload!) }, step.key));
        if (result.kind === "applied") {
          step.status = "applied";
          step.remoteRef = result.remoteRef;
          this.record(run, step.id, "applied");
          this.checkpoint(run);
        } else {
          if (result.kind === "unknown") {
            step.status = "unknown";
            run.state = "unknown";
            this.record(run, step.id, "unknown", { reason: result.reason });
          } else {
            const retryable = result.retryable === true;
            step.status = retryable ? "ready" : "failed";
            run.state = retryable ? "blocked" : "failed";
            this.record(run, step.id, "not_applied", { reason: result.reason, retryable });
            if (!retryable) {
              step.failureReason = "remote_refusal";
              step.failureEventSequence = run.events.length;
              this.stopRemaining(run, step.id);
            }
          }
          this.checkpoint(run);
          return structuredClone(run);
        }
      }
      run.state = "published";
      this.checkpoint(run);
      return structuredClone(run);
    } finally { this.busy.delete(run.id); }
  }

  private observe(phase: "apply", call: () => Promise<ApplyOutcome>): Promise<ApplyOutcome>;
  private observe(phase: "reconcile", call: () => Promise<ReconcileOutcome>): Promise<ReconcileOutcome>;
  private async observe(phase: "apply" | "reconcile", call: () => Promise<ApplyOutcome | ReconcileOutcome>): Promise<ApplyOutcome | ReconcileOutcome> {
    try {
      const result = await call();
      // Copy validated primitives: adapter-owned objects never enter execution records.
      if (result?.kind === "applied" && typeof result.remoteRef === "string" && result.remoteRef.length) {
        return { kind: "applied", remoteRef: result.remoteRef };
      }
      if (result && "reason" in result && typeof result.reason === "string") {
        if (result.kind === "unknown") return { kind: "unknown", reason: result.reason };
        if (phase === "reconcile" && result.kind === "no_effect") return { kind: "no_effect", reason: result.reason };
        if (phase === "apply" && result.kind === "not_applied" &&
            (result.retryable === undefined || typeof result.retryable === "boolean")) {
          return { kind: "not_applied", reason: result.reason, retryable: result.retryable === true };
        }
      }
      return { kind: "unknown", reason: "Invalid adapter outcome" };
    } catch {
      // A thrown exception is not authoritative evidence that the remote did nothing.
      return { kind: "unknown", reason: "Adapter call did not establish an outcome" };
    }
  }

  private stopRemaining(run: Run, failedId: string, dependencyFailed = true): void {
    const unreachable = new Set(dependencyFailed ? [failedId] : []);
    for (const step of run.steps) {
      if (step.status !== "ready") continue;
      const dependency = step.dependsOn?.find(id => unreachable.has(id));
      step.status = "skipped";
      step.skipReason = dependency ? "dependency_failed" : "run_stopped";
      step.blockedBy = dependency ?? failedId;
      if (dependency) unreachable.add(step.id);
      this.record(run, step.id, "skipped", { reason: `${step.skipReason}: ${step.blockedBy}` });
    }
  }
  private record(run: Run, stepId: string, kind: Event["kind"], detail: Pick<Event, "reason" | "retryable" | "adjudication" | "reusedFrom" | "stopRetry"> = {}): void {
    // A broken diagnostic clock must not discard an adapter receipt or stop recovery.
    let recordedAt: string;
    try { const value = this.clock(); if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("INVALID_CLOCK"); recordedAt = new Date(value).toISOString(); }
    catch { recordedAt = new Date().toISOString(); }
    run.events.push({ sequence: run.events.length + 1, stepId, kind, ...detail, recordedAt });
  }
  private requireRun(id: string): Run {
    const run = this.runs.get(id);
    if (!run) throw new Error("RUN_NOT_FOUND");
    return run;
  }
}
