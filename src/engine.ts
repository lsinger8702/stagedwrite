import { randomUUID } from "node:crypto";
import { edited } from "./draft.js";
import type { Adapter, Check, Draft, Event, Op, ApplyOutcome, ReconcileOutcome, Rule, Run, Step } from "./types.js";

/** In-memory, single-process prototype. No crash durability or external authorization. */
export class StagedWrite {
  private drafts = new Map<string, Draft>();
  private checks = new Map<string, { version: number; certificate: string; plan: Step[] }>();
  private runs = new Map<string, Run>();
  private runByDraft = new Map<string, string>();
  private busy = new Set<string>();
  private readonly rules: Rule[];

  constructor(private readonly adapter: Adapter, rules: Rule[]) {
    this.rules = [...rules];
  }

  create(): Draft {
    const draft: Draft = { id: randomUUID(), version: 0, fields: {} };
    this.drafts.set(draft.id, draft);
    return structuredClone(draft);
  }

  getDraft(id: string): Draft { return structuredClone(this.requireDraft(id)); }

  edit(id: string, expectedVersion: number, ops: Op[]): Draft {
    if (this.runByDraft.has(id)) throw new Error("DRAFT_SEALED");
    const next = edited(this.requireDraft(id), expectedVersion, ops);
    this.drafts.set(id, next);
    this.checks.delete(id);
    return structuredClone(next);
  }

  preflight(id: string): Check {
    if (this.runByDraft.has(id)) throw new Error("DRAFT_SEALED");
    const draft = this.requireDraft(id);
    this.checks.delete(id);
    const diagnostics = this.rules.flatMap(rule => rule(structuredClone(draft)));
    const check: Check = { draftId: id, version: draft.version, diagnostics };
    if (diagnostics.length === 0) {
      const plan = structuredClone(this.adapter.plan(structuredClone(draft)));
      if (!plan.length || plan.some(s => !s.id) || new Set(plan.map(s => s.id)).size !== plan.length) {
        throw new Error("INVALID_PLAN");
      }
      const certificate = randomUUID();
      this.checks.set(id, { version: draft.version, certificate, plan });
      check.certificate = certificate;
    }
    return structuredClone(check);
  }

  async publish(id: string, certificate: string): Promise<Run> {
    const draft = this.requireDraft(id);
    const checked = this.checks.get(id);
    if (!checked || checked.version !== draft.version || checked.certificate !== certificate) {
      throw new Error("PREFLIGHT_REQUIRED");
    }
    const existing = this.runByDraft.get(id);
    // Repeated publish only observes the existing execution; resume is explicit.
    if (existing) return this.getRun(existing);
    const runId = randomUUID();
    const run: Run = {
      id: runId, draftId: id, version: draft.version, state: "running", events: [],
      steps: checked.plan.map(step => ({ ...structuredClone(step), key: `${runId}:${step.id}`, status: "ready" }))
    };
    this.runs.set(runId, run);
    this.runByDraft.set(id, runId);
    return this.advance(run);
  }

  async resume(runId: string): Promise<Run> { return this.advance(this.requireRun(runId)); }
  getRun(id: string): Run { return structuredClone(this.requireRun(id)); }

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
  private requireDraft(id: string): Draft {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error("DRAFT_NOT_FOUND");
    return draft;
  }
  private requireRun(id: string): Run {
    const run = this.runs.get(id);
    if (!run) throw new Error("RUN_NOT_FOUND");
    return run;
  }
}
