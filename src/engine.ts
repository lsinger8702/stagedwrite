import { randomUUID } from "node:crypto";
import { edited } from "./draft.js";
import { ExecutionRuntime } from "./execution/runtime.js";
import type { Adapter, Check, Draft, Op, Rule, Run, Step } from "./types.js";

/** In-memory, single-process prototype. No crash durability or external authorization. */
export class StagedWrite {
  private drafts = new Map<string, Draft>();
  private checks = new Map<string, { version: number; certificate: string; plan: Step[] }>();
  private runByDraft = new Map<string, string>();
  private readonly rules: Rule[];
  private readonly execution: ExecutionRuntime;

  constructor(private readonly adapter: Adapter, rules: Rule[]) {
    this.rules = [...rules];
    this.execution = new ExecutionRuntime(adapter);
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
    const run = this.execution.create(id, draft.version, checked.plan);
    this.runByDraft.set(id, run.id);
    return this.execution.resume(run.id);
  }

  async resume(runId: string): Promise<Run> { return this.execution.resume(runId); }
  getRun(id: string): Run { return this.execution.getRun(id); }

  private requireDraft(id: string): Draft {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error("DRAFT_NOT_FOUND");
    return draft;
  }
}
