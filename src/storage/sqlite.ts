import { createRequire } from "node:module";
import type { DatabaseSync as Database } from "node:sqlite";
import type { GraphDraft } from "../graph/types.js";
import type { GraphCheck } from "../preflight/types.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import type { DraftStore } from "./drafts.js";

/** M4 stores draft-mode data only. No plans, runs or publication certificates. */
export class SqliteDraftStore implements DraftStore {
  #db: Database;
  #closed = false;
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
        if (version && version.value !== "1") throw new Error("STORAGE_VERSION_UNSUPPORTED");
        this.#db.exec(`CREATE TABLE IF NOT EXISTS sw_definitions (
          type TEXT NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(type, version)) STRICT;
          CREATE TABLE IF NOT EXISTS sw_drafts (
          id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, check_epoch INTEGER NOT NULL DEFAULT 0, check_body TEXT) STRICT;`);
        this.#db.prepare("INSERT OR IGNORE INTO sw_meta VALUES ('schema', '1')").run();
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
  edit(candidate: GraphDraft, expectedVersion: number): void {
    this.open();
    const result = this.#db.prepare("UPDATE sw_drafts SET version = ?, body = ?, check_body = NULL WHERE id = ? AND version = ?")
      .run(candidate.version, JSON.stringify(candidate), candidate.id, expectedVersion);
    if (result.changes !== 1) throw new Error("STALE_VERSION");
  }
  beginCheck(id: string, expectedVersion: number): number {
    return this.transaction(() => {
      const result = this.#db.prepare("UPDATE sw_drafts SET check_epoch = check_epoch + 1, check_body = NULL WHERE id = ? AND version = ? AND check_epoch < 9007199254740991").run(id, expectedVersion);
      if (result.changes !== 1) throw new Error("STALE_VERSION_OR_CHECK_EXHAUSTED");
      return this.#db.prepare("SELECT check_epoch FROM sw_drafts WHERE id = ?").get(id)!.check_epoch as number;
    });
  }
  saveCheck(check: GraphCheck, epoch: number): void {
    this.open();
    const result = this.#db.prepare("UPDATE sw_drafts SET check_body = ? WHERE id = ? AND version = ? AND check_epoch = ?")
      .run(JSON.stringify(check), check.draftId, check.version, epoch);
    if (result.changes !== 1) throw new Error("STALE_CHECK");
  }
  getCheck(id: string): GraphCheck | undefined {
    this.open(); const row = this.#db.prepare("SELECT check_body FROM sw_drafts WHERE id = ?").get(id);
    if (!row) throw new Error("DRAFT_NOT_FOUND");
    return row.check_body === null ? undefined : JSON.parse(row.check_body as string) as GraphCheck;
  }
  close(): void { if (!this.#closed) { this.#db.close(); this.#closed = true; } }
}
