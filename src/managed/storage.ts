import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as Database } from "node:sqlite";
import type { DraftLockProvider, ManagedStore, ManagedState, LateFact } from "./types.js";
export const lockResource = (namespace: string, id: string) => JSON.stringify([namespace, "draft", id]);
function copy<T>(v: T): T { return structuredClone(v); }
function stateValid(id: string, s: ManagedState) {
    if (s.draft.id !== id || s.draft.formatVersion !== 3)
        throw new Error("STATE_IDENTITY_MISMATCH");
    if (Object.keys(s.runs).length > 1)
        throw new Error("INITIAL_RUN_ALREADY_EXISTS");
    if (s.draft.currentRunId && !s.runs[s.draft.currentRunId])
        throw new Error("RUN_POINTER_MISMATCH");
    for (const r of Object.values(s.runs))
        if (r.draftId !== id || !s.artifacts[r.artifactId] || !s.artifacts[r.initialArtifactId])
            throw new Error("RUN_INPUT_MISSING");
    if (s.draft.publishedArtifactId && !s.artifacts[s.draft.publishedArtifactId])
        throw new Error("PUBLISHED_INPUT_MISSING");
}
function immutable(previous: ManagedState | undefined, next: ManagedState) {
    if (!previous)
        return;
    if (JSON.stringify(previous.draft.initialSnapshot) !== JSON.stringify(next.draft.initialSnapshot))
        throw new Error("INITIAL_SNAPSHOT_IMMUTABLE");
    for (const [id, a] of Object.entries(previous.artifacts))
        if (JSON.stringify(a) !== JSON.stringify(next.artifacts[id]))
            throw new Error("ARTIFACT_IMMUTABLE");
    for (const [id, b] of Object.entries(previous.bindings))
        if (JSON.stringify(b) !== JSON.stringify(next.bindings[id]))
            throw new Error("BINDING_IMMUTABLE");
}
/** Shared in-process backend. Explicitly not a cross-host lock implementation. */
export function createMemoryBackend(): {
    storage: ManagedStore;
    locks: DraftLockProvider;
} {
    const namespace = randomUUID(), states = new Map<string, ManagedState>();
    const leases = new Map<string, {
        token: string;
        fence: number;
        until: number;
    }>();
    const locks: DraftLockProvider = { async acquire(resource, { ttlMs }) {
            const old = leases.get(resource);
            if (old && old.until > Date.now() && old.token)
                return null;
            const row: {
                token: string;
                fence: number;
                until: number;
            } = { token: randomUUID(), fence: (old?.fence ?? 0) + 1, until: Date.now() + ttlMs };
            leases.set(resource, row);
            const valid = () => leases.get(resource) === row && row.until > Date.now() && !!row.token;
            return { resource, token: row.token, fence: row.fence,
                async renew() { if (!valid())
                    return false; row.until = Date.now() + ttlMs; return true; },
                async release() { if (leases.get(resource) === row) {
                    row.token = "";
                    row.until = 0;
                } } };
        } };
    const storage: ManagedStore = { namespace,
        async read(id) { return copy(states.get(id)); },
        async findRun(runId) { return [...states].find(([, s]) => Object.hasOwn(s.runs, runId))?.[0]; },
        async transact(id, lease, fn) {
            const row = leases.get(lockResource(namespace, id));
            if (lease.resource !== lockResource(namespace, id) || !row || row.token !== lease.token || row.fence !== lease.fence || row.until <= Date.now())
                throw new Error("LEASE_LOST");
            const next = copy(fn(copy(states.get(id))));
            stateValid(id, next);
            immutable(states.get(id), next);
            for (const [other, s] of states)
                if (other !== id && Object.keys(next.runs).some(r => Object.hasOwn(s.runs, r)))
                    throw new Error("RUN_ID_CONFLICT");
            for (const [other, s] of states)
                if (other !== id)
                    for (const b of Object.values(next.bindings))
                        if (Object.values(s.bindings).some(prior => prior.targetId === b.targetId && prior.remoteId === b.remoteId))
                            throw new Error("REMOTE_BINDING_CONFLICT");
            states.set(id, next);
            return copy(next);
        },
        async appendLateFact(id, fact) { const s = states.get(id); if (!s)
            throw new Error("DRAFT_NOT_FOUND"); validateFact(s, fact); if (!s.lateFacts.some(f => JSON.stringify(f) === JSON.stringify(fact)))
            s.lateFacts.push(copy(fact)); },
        async close() { }
    };
    return { storage, locks };
}
function validateFact(s: ManagedState, f: LateFact) {
    const attempt = s.runs[f.runId]?.attempts.find(a => a.stepId === f.stepId && a.key === f.key && a.number === f.attemptNumber);
    if (!attempt)
        throw new Error("ATTEMPT_NOT_FOUND");
}
/** Atomic SQLite store + lease provider, for processes sharing a local database file.
 * This does not claim SQLite supports cross-host/NFS operation. External shared stores
 * implement ManagedStore and validate their paired provider in transact(). */
export function createSqliteBackend(path: string): {
    storage: ManagedStore;
    locks: DraftLockProvider;
} {
    if (typeof path !== "string" || !path.trim())
        throw new Error("INVALID_STORAGE_PATH");
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const db: Database = new DatabaseSync(path);
    let closed = false;
    db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
    db.exec(`CREATE TABLE IF NOT EXISTS sw_managed_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS sw_managed_drafts(id TEXT PRIMARY KEY,version INTEGER NOT NULL,status TEXT NOT NULL,current_run_id TEXT,published_artifact_id TEXT,body TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS sw_managed_runs(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS sw_managed_artifacts(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,body TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS sw_managed_bindings(draft_id TEXT NOT NULL,node_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(draft_id,node_id)) STRICT;
    CREATE TABLE IF NOT EXISTS sw_managed_leases(resource TEXT PRIMARY KEY,token TEXT,fence INTEGER NOT NULL,expires_at REAL NOT NULL) STRICT;`);
    db.prepare("INSERT OR IGNORE INTO sw_managed_meta VALUES ('schema','1')").run();
    if (db.prepare("SELECT value FROM sw_managed_meta WHERE key='schema'").get()?.value !== "1") {
        db.close();
        throw new Error("STORAGE_VERSION_UNSUPPORTED");
    }
    db.prepare("INSERT OR IGNORE INTO sw_managed_meta VALUES ('namespace',?)").run(randomUUID());
    const namespace = db.prepare("SELECT value FROM sw_managed_meta WHERE key='namespace'").get()!.value as string;
    const now = () => db.prepare("SELECT unixepoch('subsec')*1000 AS n").get()!.n as number;
    function transaction<T>(fn: () => T): T {
        if (closed)
            throw new Error("STORE_CLOSED");
        db.exec("BEGIN IMMEDIATE");
        try {
            const r = fn();
            db.exec("COMMIT");
            return r;
        }
        catch (e) {
            db.exec("ROLLBACK");
            throw e;
        }
    }
    function read(id: string): ManagedState | undefined {
        const row = db.prepare("SELECT * FROM sw_managed_drafts WHERE id=?").get(id);
        if (!row)
            return;
        const s = JSON.parse(row.body as string) as ManagedState;
        if (s.draft.version !== row.version || s.draft.status !== row.status || s.draft.currentRunId !== row.current_run_id || s.draft.publishedArtifactId !== row.published_artifact_id)
            throw new Error("STORED_DRAFT_CORRUPT");
        s.runs = Object.fromEntries(db.prepare("SELECT id,body FROM sw_managed_runs WHERE draft_id=?").all(id).map(r => [r.id, JSON.parse(r.body as string)]));
        s.artifacts = Object.fromEntries(db.prepare("SELECT id,body FROM sw_managed_artifacts WHERE draft_id=?").all(id).map(r => [r.id, JSON.parse(r.body as string)]));
        s.bindings = Object.fromEntries(db.prepare("SELECT node_id,body FROM sw_managed_bindings WHERE draft_id=?").all(id).map(r => [r.node_id, JSON.parse(r.body as string)]));
        stateValid(id, s);
        return s;
    }
    function write(id: string, s: ManagedState) {
        stateValid(id, s);
        for (const [node, b] of Object.entries(s.bindings)) {
            const prior = db.prepare("SELECT draft_id,node_id FROM sw_managed_bindings WHERE json_extract(body,'$.targetId')=? AND json_extract(body,'$.remoteId')=?").all(b.targetId, b.remoteId);
            if (prior.some(p => p.draft_id !== id || p.node_id !== node))
                throw new Error("REMOTE_BINDING_CONFLICT");
        }
        const d = s.draft;
        db.prepare("INSERT INTO sw_managed_drafts VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,status=excluded.status,current_run_id=excluded.current_run_id,published_artifact_id=excluded.published_artifact_id,body=excluded.body")
            .run(id, d.version, d.status, d.currentRunId, d.publishedArtifactId, JSON.stringify({ ...s, runs: {}, artifacts: {}, bindings: {} }));
        for (const r of Object.values(s.runs)) {
            const prior = db.prepare("SELECT draft_id FROM sw_managed_runs WHERE id=?").get(r.id);
            if (prior && prior.draft_id !== id)
                throw new Error("RUN_ID_CONFLICT");
            db.prepare("INSERT INTO sw_managed_runs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(r.id, id, JSON.stringify(r));
        }
        for (const a of Object.values(s.artifacts)) {
            const prior = db.prepare("SELECT body FROM sw_managed_artifacts WHERE id=?").get(a.id);
            if (prior && prior.body !== JSON.stringify(a))
                throw new Error("ARTIFACT_IMMUTABLE");
            db.prepare("INSERT OR IGNORE INTO sw_managed_artifacts VALUES (?,?,?)").run(a.id, id, JSON.stringify(a));
        }
        for (const [node, b] of Object.entries(s.bindings))
            db.prepare("INSERT INTO sw_managed_bindings VALUES (?,?,?) ON CONFLICT(draft_id,node_id) DO UPDATE SET body=excluded.body").run(id, node, JSON.stringify(b));
    }
    const locks: DraftLockProvider = { async acquire(resource, { ttlMs }) {
            return transaction(() => {
                const old = db.prepare("SELECT * FROM sw_managed_leases WHERE resource=?").get(resource), time = now();
                if (old && old.token && (old.expires_at as number) > time)
                    return null;
                const token = randomUUID(), fence = Number(old?.fence ?? 0) + 1;
                if (!Number.isSafeInteger(fence))
                    throw new Error("FENCE_EXHAUSTED");
                db.prepare("INSERT INTO sw_managed_leases VALUES (?,?,?,?) ON CONFLICT(resource) DO UPDATE SET token=excluded.token,fence=excluded.fence,expires_at=excluded.expires_at").run(resource, token, fence, time + ttlMs);
                return { resource, token, fence,
                    async renew() { return transaction(() => db.prepare("UPDATE sw_managed_leases SET expires_at=? WHERE resource=? AND token=? AND fence=? AND expires_at>?").run(now() + ttlMs, resource, token, fence, now()).changes === 1); },
                    async release() { transaction(() => db.prepare("UPDATE sw_managed_leases SET token=NULL,expires_at=0 WHERE resource=? AND token=? AND fence=?").run(resource, token, fence)); }
                };
            });
        } };
    const storage: ManagedStore = { namespace,
        async read(id) { return transaction(() => read(id)); },
        async findRun(runId) { return db.prepare("SELECT draft_id FROM sw_managed_runs WHERE id=?").get(runId)?.draft_id as string | undefined; },
        async transact(id, lease, fn) {
            return transaction(() => {
                const resource = lockResource(namespace, id), row = db.prepare("SELECT * FROM sw_managed_leases WHERE resource=?").get(resource);
                if (lease.resource !== resource || !row || row.token !== lease.token || row.fence !== lease.fence || Number(row.expires_at) <= now())
                    throw new Error("LEASE_LOST");
                const previous = read(id), s = fn(copy(previous));
                immutable(previous, s);
                write(id, s);
                return copy(s);
            });
        },
        async appendLateFact(id, fact) { transaction(() => { const s = read(id); if (!s)
            throw new Error("DRAFT_NOT_FOUND"); validateFact(s, fact); if (!s.lateFacts.some(f => JSON.stringify(f) === JSON.stringify(fact)))
            s.lateFacts.push(copy(fact)); write(id, s); }); },
        async close() { if (!closed) {
            db.close();
            closed = true;
        } }
    };
    return { storage, locks };
}
