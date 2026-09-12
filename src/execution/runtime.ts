import { randomUUID } from "node:crypto";
import type { Adapter, ApplyOutcome, ReconcileOutcome, Event, Run, Step } from "../types.js";

/** Shared in-memory execution state machine for legacy and graph entry points. */
export class ExecutionRuntime {
  private runs = new Map<string, Run>();
  private busy = new Set<string>();
  constructor(private readonly adapter: Pick<Adapter, "apply" | "reconcile">) {}
  create(draftId: string, version: number, plan: Step[], binding?: Run["binding"]): Run {
    const id = randomUUID();
    const run: Run = { id, draftId, version, state: "running", events: [],
      ...(binding ? { binding: structuredClone(binding) } : {}),
      steps: plan.map(step => ({ ...structuredClone(step), key: `${id}:${step.id}`, status: "ready" })) };
    this.runs.set(id, run);
    return structuredClone(run);
  }
  getRun(id: string): Run { return structuredClone(this.requireRun(id)); }
  resume(id: string): Promise<Run> { return this.advance(this.requireRun(id)); }
  private async advance(run: Run): Promise<Run> {
    if (this.busy.has(run.id)) throw new Error("RUN_BUSY");
    if (run.state === "published" || run.state === "failed") return structuredClone(run);
    this.busy.add(run.id);
    run.state = "running";
    try {
      for (const step of run.steps) {
        if (step.status === "applied") continue;
        if (step.status === "unknown") {
          this.record(run, step.id, "reconciling");
          const result = await this.observe("reconcile", () => this.adapter.reconcile(structuredClone(step), step.key));
          if (result.kind === "applied") {
            step.status = "applied";
            step.remoteRef = result.remoteRef;
            this.record(run, step.id, "applied");
            continue;
          }
          if (result.kind === "unknown") {
            run.state = "unknown";
            this.record(run, step.id, "unknown", { reason: result.reason });
            return structuredClone(run);
          }
          this.record(run, step.id, "no_effect", { reason: result.reason });
          step.status = "ready";
        }
        step.status = "dispatching";
        this.record(run, step.id, "dispatching");
        const result = await this.observe("apply", () => this.adapter.apply(structuredClone(step), step.key));
        if (result.kind === "applied") {
          step.status = "applied";
          step.remoteRef = result.remoteRef;
          this.record(run, step.id, "applied");
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
          }
          return structuredClone(run);
        }
      }
      run.state = "published";
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

  private record(run: Run, stepId: string, kind: Event["kind"], detail: Pick<Event, "reason" | "retryable"> = {}): void {
    run.events.push({ sequence: run.events.length + 1, stepId, kind, ...detail });
  }
  private requireRun(id: string): Run {
    const run = this.runs.get(id);
    if (!run) throw new Error("RUN_NOT_FOUND");
    return run;
  }
}
