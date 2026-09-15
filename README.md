# StagedWrite

**A graph intent library for agent tools: create meaningful work, diagnose it, repair it with explicit OPs, and resume unfinished publication without recreating successful resources.**

Early prototype, v0.0.1; no published npm package. The default `createStagedWrite` now uses the managed Draft lifecycle. [Project principles](docs/design/000-project-principles.md) govern development; conflicting changes require the project owner's explicit agreement.

```sh
npm ci
npm test
npm run demo:html
```

Requires Node.js 22.13+ with `node:sqlite`. Open [the actual input/output walkthrough](docs/examples/publish-resume.html). It runs the library and SQLite against a fictional remote service: three real rule failures, asynchronous pending, fixed-baseline reset, partial publication, repair, and unknown-outcome reconciliation. No HTTP or LLM calls are made.

## Current API

```ts
import { createStagedWrite, createSqliteBackend } from "stagedwrite";

const backend = createSqliteBackend("./work.sqlite");
const engine = createStagedWrite({
  definitions: [definition],
  rules,                // Pure checks; current preview and specific messages.
  asyncRules,           // I/O checks return complete or pending; caller polls.
  executors: [executor],// plan(draft), apply(step, key, context), reconcile(...).
  ...backend,           // Paired storage and authoritative lease provider.
});
const draft = await engine.create(selector, initialGraph);
const check = await engine.preflight(draft.id);
if (check.status === "passed" && check.certificate) {
  const run = await engine.publish(draft.id, check.certificate);
  // If unfinished: inspect preview/diagnostics, optionally edit, then resume(run.id).
}
await engine.close();
```

See the [complete registered schema and rules](examples/fixtures/project-tasks-managed.ts), [executor and calls](examples/publish-resume.ts), and [contract](docs/design/018-draft-lifecycle-proposal.md).

- Draft persists ordinary `graph` values, separate `fieldIntents`, immutable `initialSnapshot`, `currentRunId`, and a successful artifact reference. It retains its identity after publication.
- `set` declares a value, `remove` explicitly clears it. `reset` restores the fixed initial intent in this version, including undeclared fields; it does not undo the last edit.
- The first publish claims one Run atomically. Further publish calls only observe that Run; an explicitly different Run ID is rejected. Independent resource creation needs a new Draft.
- `resume` continues the same unfinished Run, even without a process failure. Success is preserved; unknown requests use their original input/key for reconciliation. Repair edits are limited to unfinished nodes' fields.
- Bindings are saved as individual nodes succeed. `pending` may already have remote resources; only full success marks the Draft `published`.
- All managed APIs are asynchronous. Without executors, preflight is diagnostic-only. Without a registered backend, storage and locking are in-process memory only.

## Lock and storage boundary

Mutations acquire a lease keyed by storage namespace and Draft ID. The engine renews it and releases its own token; storage atomically verifies ownership for each state transition. Remote requests are preceded by a durable attempt record. Lost ownership cannot authorize further state writes; late receipts are recorded separately for the current owner to verify and adopt.

The bundled SQLite backend supports processes sharing one local file, with cross-process contention and crash recovery tests. **Cross-host distributed deployment requires an external paired `ManagedStore` and `DraftLockProvider`; no production cross-host backend is bundled or claimed tested.** An unrelated lock callback plus an unguarded store is insufficient. See [the backend contract](docs/design/018-draft-lifecycle-proposal.md#锁与存储契约).

Remote idempotency and conclusive reconciliation are adapter responsibilities. Locks cannot cancel an already sent request. An empty search or a timeout does not prove no effect.

## Compatibility and scope

The former graph factory is exported as **`createLegacyStagedWrite`**. Its old storage and execution protocol remain available for old data and unfinished Runs. Legacy data is not automatically converted: it may lack a recoverable initial baseline or have multiple independent Runs. New format-3 Drafts use separate managed SQLite tables. Do not feed new Drafts to old planners.

Legacy examples and regression tests explicitly use the legacy factory; [legacy reference](docs/legacy-api.md). Current recommended usage is the managed walkthrough above.

Not implemented in the new protocol: remote update after full success, diff/drift, rollback, autofill, scheduling, full edit history, legacy data migration, manual adjudication/stop/import/retention ports, or generic nested request-body generation. [Roadmap](docs/roadmap.md).
