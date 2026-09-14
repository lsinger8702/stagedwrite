import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { definitionDigest, type Json } from "../registry/json.js";
import type { RecoveryRequest, ImportConfirmedRequest, Run } from "../types.js";
import { createRequire } from "node:module";
import type { DatabaseSync as Database } from "node:sqlite";
import type { GraphDraft } from "../graph/types.js";
import type { GraphCheck } from "../preflight/types.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import { requireSameSubmission } from "../execution/publication.js";
import type { DraftStore, StoredPlan, RunInput } from "./drafts.js";

/** SQLite snapshots and atomic publication ownership; explicit local-process ownership transfer. */
export class SqliteDraftStore implements DraftStore {
  #db: Database;
  #closed = false;
  #owner = randomUUID();
  constructor(path: string, registry: DefinitionRegistry) {
    if (typeof path !== "string" || !path.trim()) throw new Error("INVALID_STORAGE_PATH");
    let sqlite: typeof import("node:sqlite");
    try { sqlite = createRequire(import.meta.url)("node:sqlite") as typeof sqlite; }
    catch { throw new Error("SQLITE_REQUIRES_NODE_22_13_OR_NEWER"); }
    this.#db = new sqlite.DatabaseSync(path);
    try {
      this.#db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      this.transaction(() => {
        this.#db.exec("CREATE TABLE IF NOT EXISTS sw_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;");
        const version = this.#db.prepare("SELECT value FROM sw_meta WHERE key = 'schema'").get();
        if (version && !["1", "2", "3", "4", "5"].includes(version.value as string)) throw new Error("STORAGE_VERSION_UNSUPPORTED");
        // Schema 5 removes the one-Run-per-Draft constraint and snapshots each Run input.
        // Validate historical columns before rebuilding; the entire migration is atomic.
        this.#db.exec(`CREATE TABLE IF NOT EXISTS sw_definitions (
          type TEXT NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(type, version)) STRICT;
          CREATE TABLE IF NOT EXISTS sw_drafts (
          id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, check_epoch INTEGER NOT NULL DEFAULT 0, check_body TEXT) STRICT;`);
        this.#db.exec(`CREATE TABLE IF NOT EXISTS sw_plans (draft_id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS sw_runs (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, body TEXT NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS sw_derivations (source_run TEXT NOT NULL, kind TEXT NOT NULL, draft_id TEXT NOT NULL UNIQUE, PRIMARY KEY(source_run, kind)) STRICT;`);
        this.#db.exec("CREATE TABLE IF NOT EXISTS sw_imports (source_run TEXT NOT NULL, request_id TEXT NOT NULL, command TEXT NOT NULL, draft_id TEXT NOT NULL UNIQUE, PRIMARY KEY(source_run, request_id)) STRICT;");
        this.#db.exec("CREATE TABLE IF NOT EXISTS sw_sessions (owner TEXT PRIMARY KEY, pid INTEGER NOT NULL, host TEXT NOT NULL, released INTEGER NOT NULL) STRICT;");
        const requiredColumns: Record<string, string[]> = {
          sw_definitions: ["type", "version", "digest", "body"],
          sw_drafts: ["id", "version", "body", "check_epoch", "check_body"],
          sw_plans: ["draft_id", "body"], sw_runs: ["id", "draft_id", "owner", "body"],
          sw_derivations: ["source_run", "kind", "draft_id"],
          sw_sessions: ["owner", "pid", "host", "released"],
          sw_imports: ["source_run", "request_id", "command", "draft_id"]
        };
        for (const [table, required] of Object.entries(requiredColumns)) {
          const columns = new Set(this.#db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
          if (required.some(column => !columns.has(column))) throw new Error("STORAGE_SCHEMA_MISMATCH");
        }
        this.#db.exec("CREATE TABLE IF NOT EXISTS sw_run_inputs (run_id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;");
        const inputColumns = new Set(this.#db.prepare("PRAGMA table_info(sw_run_inputs)").all().map(row => row.name));
        if (!["run_id", "body"].every(c => inputColumns.has(c))) throw new Error("STORAGE_SCHEMA_MISMATCH");
        if (version?.value !== "5") {
          // Old drafts were sealed: their saved graph and plan are the original Run input.
          for (const row of this.#db.prepare("SELECT id, draft_id FROM sw_runs").all()) {
            if (this.#db.prepare("SELECT 1 FROM sw_run_inputs WHERE run_id=?").get(row.id!)) continue;
            const draft = this.get(row.draft_id as string);
            const plan = this.getPlan(row.draft_id as string);
            const run = this.getRun(row.id as string);
            if (!plan || draft.version !== run.version || definitionDigest(plan.binding as unknown as Json) !== definitionDigest(run.binding as unknown as Json)) throw new Error("STORED_RUN_INPUT_MISSING");
            this.#db.prepare("INSERT INTO sw_run_inputs VALUES (?,?)").run(row.id!, JSON.stringify({ ...plan, draft }));
          }
          this.#db.exec(`CREATE TABLE sw_runs_v5 (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, owner TEXT NOT NULL, body TEXT NOT NULL) STRICT;
            INSERT INTO sw_runs_v5 SELECT id, draft_id, owner, body FROM sw_runs;
            DROP TABLE sw_runs;
            ALTER TABLE sw_runs_v5 RENAME TO sw_runs;`);
        }
        this.#db.exec("CREATE INDEX IF NOT EXISTS sw_runs_draft ON sw_runs(draft_id);");
        this.#db.exec("CREATE INDEX IF NOT EXISTS sw_runs_owner ON sw_runs(owner);");
        this.pruneReleasedSessions();
        this.#db.prepare("INSERT INTO sw_sessions VALUES (?, ?, ?, 0)").run(this.#owner, process.pid, hostname());
        this.#db.prepare("INSERT OR REPLACE INTO sw_meta VALUES ('schema', '5')").run();
        for (const selector of registry.selectors()) {
          const { definition, digest } = registry.getDefinition(selector);
          const prior = this.#db.prepare("SELECT digest FROM sw_definitions WHERE type = ? AND version = ?").get(selector.type, selector.typeVersion);
          if (prior && prior.digest !== digest) throw new Error("STORED_DEFINITION_CONFLICT");
          this.#db.prepare("INSERT OR IGNORE INTO sw_definitions VALUES (?, ?, ?, ?)").run(selector.type, selector.typeVersion, digest, JSON.stringify(definition));
        }
      });
    } catch (error) { this.#db.close(); throw error; }
  }
  private open(): void { if (this.#closed) throw new Error("STORE_CLOSED"); }
  private transaction<T>(action: () => T): T {
    this.open(); this.#db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.#db.exec("COMMIT"); return result; }
    catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  create(draft: GraphDraft): void {
    this.open(); this.#db.prepare("INSERT INTO sw_drafts (id, version, body) VALUES (?, ?, ?)").run(draft.id, draft.version, JSON.stringify(draft));
  }
  get(id: string): GraphDraft {
    this.open(); const row = this.#db.prepare("SELECT version, body FROM sw_drafts WHERE id = ?").get(id);
    if (!row) throw new Error("DRAFT_NOT_FOUND");
    const draft = JSON.parse(row.body as string) as GraphDraft;
    if (draft.id !== id || draft.version !== row.version) throw new Error("STORED_DRAFT_CORRUPT");
    return draft;
  }
  ids(): string[] { this.open(); return this.#db.prepare("SELECT id FROM sw_drafts ORDER BY id").all().map(r => r.id as string); }
  edit(candidate: GraphDraft, expectedVersion: number, validate?: () => void): void {
    this.transaction(() => {
      if (validate) validate(); else if (this.runForDraft(candidate.id)) throw new Error("DRAFT_SEALED");
      const result = this.#db.prepare("UPDATE sw_drafts SET version = ?, body = ?, check_body = NULL WHERE id = ? AND version = ?")
        .run(candidate.version, JSON.stringify(candidate), candidate.id, expectedVersion);
      if (result.changes !== 1) throw new Error("STALE_VERSION");
      this.#db.prepare("DELETE FROM sw_plans WHERE draft_id = ?").run(candidate.id);
    });
  }
  beginCheck(id: string, expectedVersion: number): number {
    return this.transaction(() => {
      const result = this.#db.prepare("UPDATE sw_drafts SET check_epoch = check_epoch + 1, check_body = NULL WHERE id = ? AND version = ? AND check_epoch < 9007199254740991").run(id, expectedVersion);
      if (result.changes !== 1) throw new Error("STALE_VERSION_OR_CHECK_EXHAUSTED");
      return this.#db.prepare("SELECT check_epoch FROM sw_drafts WHERE id = ?").get(id)!.check_epoch as number;
    });
  }
  saveCheck(check: GraphCheck, epoch: number, plan?: StoredPlan): void {
    this.transaction(() => {
      const result = this.#db.prepare("UPDATE sw_drafts SET check_body = ? WHERE id = ? AND version = ? AND check_epoch = ?")
        .run(JSON.stringify(check), check.draftId, check.version, epoch);
      if (result.changes !== 1) throw new Error("STALE_CHECK");
      this.#db.prepare("DELETE FROM sw_plans WHERE draft_id = ?").run(check.draftId);
      if (plan) this.#db.prepare("INSERT INTO sw_plans VALUES (?, ?)").run(check.draftId, JSON.stringify(plan));
    });
  }
  getPlan(id: string): StoredPlan | undefined {
    this.open(); const row = this.#db.prepare("SELECT body FROM sw_plans WHERE draft_id = ?").get(id);
    return row ? JSON.parse(row.body as string) as StoredPlan : undefined;
  }
  runForDraft(id: string): string | undefined {
    this.open(); return this.#db.prepare("SELECT id FROM sw_runs WHERE draft_id = ?").get(id)?.id as string | undefined;
  }
  getRun(id: string): Run {
    this.open(); const row = this.#db.prepare("SELECT body FROM sw_runs WHERE id = ?").get(id);
    if (!row) throw new Error("RUN_NOT_FOUND"); return JSON.parse(row.body as string) as Run;
  }
  runIds(): string[] { this.open(); return this.#db.prepare("SELECT id FROM sw_runs ORDER BY id").all().map(r => r.id as string); }
  hasRun(id: string): boolean { this.open(); return !!this.#db.prepare("SELECT 1 FROM sw_runs WHERE id=?").get(id); }
  getRunInput(id: string): RunInput {
    this.open(); const row = this.#db.prepare("SELECT body FROM sw_run_inputs WHERE run_id=?").get(id);
    if (!row) throw new Error("RUN_NOT_FOUND");
    return JSON.parse(row.body as string) as RunInput;
  }
  /** Submission identity, current qualification, Run and fixed input commit atomically. */
  publishRun(run: Run, input: RunInput): boolean {
    return this.transaction(() => {
      if (this.hasRun(run.id)) {
        requireSameSubmission(this.getRunInput(run.id), run.draftId, input.certificate);
        return false;
      }
      const check = this.getCheck(run.draftId);
      const plan = this.getPlan(run.draftId);
      if (!check || check.formatVersion !== 2 || check.certificate !== input.certificate || check.status !== "passed" || check.scope !== "execution" ||
          !plan || definitionDigest(plan as unknown as Json) !== definitionDigest({ certificate: input.certificate, plan: input.plan, binding: input.binding } as unknown as Json) ||
          check.version !== run.version || this.get(run.draftId).version !== run.version) throw new Error("PREFLIGHT_REQUIRED");
      this.#db.prepare("INSERT INTO sw_runs VALUES (?, ?, ?, ?)").run(run.id, run.draftId, this.#owner, JSON.stringify(run));
      this.#db.prepare("INSERT INTO sw_run_inputs VALUES (?, ?)").run(run.id, JSON.stringify(input));
      return true;
    });
  }
  saveRun(run: Run): void {
    this.transaction(() => {
      const before = this.getRun(run.id);
      if ((run.repairs?.length ?? 0) !== (before.repairs?.length ?? 0)) {
        const input = run.repairInput, check = this.getCheck(run.draftId), plan = this.getPlan(run.draftId);
        if (!input || !check || !plan || check.status !== "passed" || check.certificate !== input.certificate || check.version !== run.version || this.get(run.draftId).version !== run.version ||
          definitionDigest(plan as unknown as Json) !== definitionDigest({ certificate: input.certificate, plan: input.plan, binding: input.binding } as unknown as Json)) throw new Error("STALE_CHECK");
      }
      const result = this.#db.prepare("UPDATE sw_runs SET body = ? WHERE id = ? AND owner = ?").run(JSON.stringify(run), run.id, this.#owner);
      if (result.changes !== 1) throw new Error("RUN_OWNER_MISMATCH");
    });
  }
  /** The liveness check, sequence check, state conversion and owner write are atomic. */
  recover(id: string, command: RecoveryRequest, prepare: (run: Run, previousOwner: string, owner: string) => Run): Run {
    return this.transaction(() => {
      const row = this.#db.prepare("SELECT owner FROM sw_runs WHERE id = ?").get(id);
      if (!row) throw new Error("RUN_NOT_FOUND");
      const run = this.getRun(id);
      const previous = run.events.find(e => e.recovery?.command.requestId === command.requestId)?.recovery;
      if (previous) {
        if (definitionDigest(previous.command as unknown as Json) !== definitionDigest(command as unknown as Json)) throw new Error("RECOVERY_CONFLICT");
        if (row.owner !== this.#owner || previous.owner !== this.#owner) throw new Error("RECOVERY_OWNER_MISMATCH");
        return run;
      }
      if (command.expectedSequence !== run.events.length) throw new Error("STALE_RUN");
      if ((["published", "closed"].includes(run.state) || (run.state === "failed" && (!run.steps.some(s => s.failureReason === "remote_refusal") || run.steps.some(s => s.failureReason === "retry_stopped"))))) throw new Error("RECOVERABLE_RUN_REQUIRED");
      const session = this.#db.prepare("SELECT pid, host, released FROM sw_sessions WHERE owner = ?").get(row.owner!);
      if (!session) throw new Error("OWNER_EVIDENCE_REQUIRED");
      if (session.released !== 1) {
        if (session.host !== hostname() || !Number.isSafeInteger(session.pid) || (session.pid as number) <= 0) throw new Error("OWNER_EVIDENCE_REQUIRED");
        try { process.kill(session.pid as number, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("OWNER_EVIDENCE_REQUIRED");
          return this.claim(run, row.owner as string, prepare);
        }
        throw new Error("RUN_OWNER_ACTIVE");
      }
      return this.claim(run, row.owner as string, prepare);
    });
  }
  private claim(run: Run, prior: string, prepare: (run: Run, previousOwner: string, owner: string) => Run): Run {
    const recovered = prepare(run, prior, this.#owner);
    this.#db.prepare("UPDATE sw_runs SET owner = ?, body = ? WHERE id = ? AND owner = ?")
      .run(this.#owner, JSON.stringify(recovered), run.id, prior);
    this.pruneReleasedSessions();
    return recovered;
  }
  importConfirmed(sourceRun: string, command: ImportConfirmedRequest, create: () => GraphDraft): GraphDraft {
    return this.transaction(() => {
      const prior = this.#db.prepare("SELECT command, draft_id FROM sw_imports WHERE source_run=? AND request_id=?").get(sourceRun, command.requestId);
      if (prior) {
        if (definitionDigest(JSON.parse(prior.command as string) as Json) !== definitionDigest(command as unknown as Json)) throw new Error("IMPORT_CONFLICT");
        return this.get(prior.draft_id as string);
      }
      const draft = create();
      this.create(draft);
      this.#db.prepare("INSERT INTO sw_imports VALUES (?, ?, ?, ?)").run(sourceRun, command.requestId, JSON.stringify(command), draft.id);
      return draft;
    });
  }
  derive(draft: GraphDraft, sourceRun: string, kind: "revise" | "continue"): GraphDraft {
    return this.transaction(() => {
      const existing = this.#db.prepare("SELECT draft_id FROM sw_derivations WHERE source_run = ? AND kind = ?").get(sourceRun, kind);
      if (existing) return this.get(existing.draft_id as string);
      if (this.getRun(sourceRun).state !== "failed") throw new Error("FAILED_RUN_REQUIRED");
      this.create(draft);
      this.#db.prepare("INSERT INTO sw_derivations VALUES (?, ?, ?)").run(sourceRun, kind, draft.id);
      return draft;
    });
  }
  getCheck(id: string): GraphCheck | undefined {
    this.open(); const row = this.#db.prepare("SELECT check_body FROM sw_drafts WHERE id = ?").get(id);
    if (!row) throw new Error("DRAFT_NOT_FOUND");
    return row.check_body === null ? undefined : JSON.parse(row.check_body as string) as GraphCheck;
  }
  /** Only released, unreferenced sessions are disposable; run evidence stays intact. */
  private pruneReleasedSessions(): void {
    this.#db.exec("DELETE FROM sw_sessions WHERE released = 1 AND NOT EXISTS (SELECT 1 FROM sw_runs WHERE sw_runs.owner = sw_sessions.owner)");
  }
  close(): void {
    if (this.#closed) return;
    this.transaction(() => {
      this.#db.prepare("UPDATE sw_sessions SET released = 1 WHERE owner = ?").run(this.#owner);
      this.pruneReleasedSessions();
    });
    this.#db.close();
    this.#closed = true;
  }
}
