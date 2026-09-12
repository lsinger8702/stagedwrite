import type { Step, ExecutionBinding } from "../types.js";
import type { GraphDraft } from "../graph/types.js";
import type { GraphCheck } from "../preflight/types.js";
export interface StoredPlan { certificate: string; plan: Step[]; binding: ExecutionBinding }
export interface DraftStore {
  create(draft: GraphDraft): void;
  get(id: string): GraphDraft;
  ids(): string[];
  edit(candidate: GraphDraft, expectedVersion: number): void;
  beginCheck(id: string, expectedVersion: number): number;
  saveCheck(check: GraphCheck, epoch: number, plan?: StoredPlan): void;
  getCheck(id: string): GraphCheck | undefined;
  close(): void;
}
export class MemoryDraftStore implements DraftStore {
  private drafts = new Map<string, GraphDraft>();
  private checks = new Map<string, GraphCheck>();
  private epochs = new Map<string, number>();
  private closed = false;
  private open(): void { if (this.closed) throw new Error("STORE_CLOSED"); }
  create(draft: GraphDraft): void { this.open(); if (this.drafts.has(draft.id)) throw new Error("DRAFT_EXISTS"); this.drafts.set(draft.id, structuredClone(draft)); this.epochs.set(draft.id, 0); }
  get(id: string): GraphDraft { this.open(); const d = this.drafts.get(id); if (!d) throw new Error("DRAFT_NOT_FOUND"); return structuredClone(d); }
  ids(): string[] { this.open(); return [...this.drafts.keys()].sort(); }
  edit(candidate: GraphDraft, expectedVersion: number): void {
    if (this.get(candidate.id).version !== expectedVersion) throw new Error("STALE_VERSION");
    this.drafts.set(candidate.id, structuredClone(candidate)); this.checks.delete(candidate.id);
  }
  beginCheck(id: string, expectedVersion: number): number {
    if (this.get(id).version !== expectedVersion) throw new Error("STALE_VERSION");
    const epoch = this.epochs.get(id)! + 1;
    this.epochs.set(id, epoch); this.checks.delete(id); return epoch;
  }
  saveCheck(check: GraphCheck, epoch: number, plan?: StoredPlan): void {
    if (this.get(check.draftId).version !== check.version || this.epochs.get(check.draftId) !== epoch) throw new Error("STALE_CHECK");
    this.checks.set(check.draftId, structuredClone(check));
  }
  getCheck(id: string): GraphCheck | undefined { this.get(id); const c = this.checks.get(id); return c && structuredClone(c); }
  close(): void { this.closed = true; }
}
