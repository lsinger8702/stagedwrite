# StagedWrite

**A graph intent library for agent tools: create meaningful work, diagnose it, repair it with explicit OPs, and resume unfinished publication without recreating successful resources.**

Early prototype, v0.0.1; no published npm package. `createStagedWrite` is the only engine entry point, using the managed Draft lifecycle. [Project principles](docs/design/000-project-principles.md) govern development; conflicting changes require the project owner's explicit agreement.

```sh
npm ci
npm test
npm run demo:html
```

Requires Node.js 22.13+ with `node:sqlite`. Open [the actual input/output walkthrough](docs/examples/publish-resume.html). It runs the library and SQLite against a fictional remote service: three real rule failures, asynchronous pending, fixed-baseline reset, partial publication, repair, and unknown-outcome reconciliation. No HTTP or LLM calls are made.

## Stripe sandbox example

A real Product → two Prices integration demonstrates a remote validation refusal, explicit Draft repair, and same-Run resume. [Run the sample](examples/stripe/README.md) · [Testing scope and recorded result](docs/testing/stripe-sandbox.md). The receipt-loss scenario is fault injection after a real creation.

`npm run test:stripe` runs offline regression tests with no credentials. Live requests require an explicit flag and a test key; state and raw traces stay local. [Contributing](CONTRIBUTING.md).

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
- `edit` returns only `{draftId, version, preflightRequired: true, changes}`. Use `getDraft` for the stored snapshot and `preflight` for the complete current preview and diagnostics. Editing an existing Run still requires `resume` to continue it.
- Bindings are saved as individual nodes succeed. `pending` may already have remote resources; only full success marks the Draft `published`.
- All managed APIs are asynchronous. Without executors, preflight is diagnostic-only. Without a registered backend, storage and locking are in-process memory only.

## Recovery boundary

**Continue unfinished work with `resume(run.id)`. Repeating `publish` only observes the existing Run; it does not retry it.** Inspect `getRun(run.id)` for the current preview, diagnostics and recorded attempts.

| Situation | Current recovery path |
|---|---|
| `blocked` by invalid input | Repair unfinished nodes with `edit`, then `resume`; the repaired version must pass preflight. Successful nodes and topology remain protected. |
| Execution interrupted before dispatch | After the underlying fault is resolved, `resume` continues unfinished steps without repeating confirmed effects. |
| `unknown` with conclusive remote evidence | `resume` reconciles the original input/key or adopts a recorded success receipt. Confirmed success is retained; confirmed `no_effect` permits continuation. |
| `unknown` without conclusive evidence | The Run remains unresolved. `resume` cannot resend that request or adopt changed input until its original outcome is resolved. |

**If reconciliation is unsupported, keeps returning `unknown`, or evidence remains conflicting, the Run may remain unresolved indefinitely. There is currently no public manual adjudication API to resolve it.** Changing the Draft does not establish whether an earlier request took effect. Do not create a replacement Draft as a retry: the unresolved request may already have created resources.

There is also no persistent stop/abandon API. The engine does not schedule retries, so callers can stop invoking `resume`, but that does not close the Run or prevent a later caller from resuming it. It does not cancel an in-flight request or reclaim resources already created. A permanently unrepairable `blocked` Run likewise has no explicit terminal closure operation in this version.

On an execution interruption, the engine attempts to record a diagnostic and mark the Run `unknown` when an attempt is unresolved, otherwise `blocked`. A store outage, process exit or lost lease can prevent that update: persisted `running` is not proof of a live worker. Preserve the Draft/Run identity, inspect recorded facts after recovery, and resume under a valid lease. The original operation may throw even when a remote effect succeeded.

Hosts control their storage and can technically modify Run records, but direct repair is outside the library contract and is not a supported recovery API. Inconsistent edits can lose outcome evidence, break bindings or create duplicate resources; storage access alone does not establish a safe recovery procedure.

## Lock and storage boundary

Mutations acquire a lease keyed by storage namespace and Draft ID. The engine renews it and releases its own token; storage atomically verifies ownership for each state transition. Remote requests are preceded by a durable attempt record. Lost ownership cannot authorize further state writes; late receipts are recorded separately for the current owner to verify and adopt.

The bundled SQLite backend supports processes sharing one local file, with cross-process contention and crash recovery tests. **Cross-host distributed deployment requires an external paired `ManagedStore` and `DraftLockProvider`; no production cross-host backend is bundled or claimed tested.** An unrelated lock callback plus an unguarded store is insufficient. See [the backend contract](docs/design/018-draft-lifecycle-proposal.md#锁与存储契约).

Remote idempotency and conclusive reconciliation are adapter responsibilities. Locks cannot cancel an already sent request. An empty search or a timeout does not prove no effect.

## Scope

There is one engine factory: `createStagedWrite`. The unused scalar and graph prototypes, their adapters, storage, migrations and compatibility exports have been removed before publication. We do not maintain a deprecated entry point or an old-data migration path. This does not delete any existing database file; use a fresh database for this experimental release.

Not implemented: remote update after full success, diff/drift, rollback, autofill, scheduling, full edit history, manual adjudication/stop/import/retention APIs, or generic nested request-body generation. [Roadmap](docs/roadmap.md).

`npm run build` cleans `dist` first, so removed implementations cannot survive in a tarball. CI runs the current regression suite, the actual walkthrough and an isolated package-consumer check.

## Walkthrough integrity

`npm run demo:html` executes the real library and SQLite against a simulated remote, then generates the JSON trace, Markdown, standalone HTML and offline ZIP together. The ZIP contains those exact HTML/JSON/Markdown bytes, with fixed archive metadata.

`npm run verify:walkthrough` runs the example again without overwriting the checked-in evidence. It compares the new trace with the committed trace after consistently renaming runtime UUIDs and ignoring only engine/report timestamps and the Node version label. Business values, diagnostics, OP order, versions, bindings and effects must match. It also rebuilds HTML/Markdown/ZIP from the committed trace and current source/template and requires byte equality. The fresh unmodified trace is saved as `dist/walkthrough-raw.json` and uploaded by CI for inspection.

The committed trace remains an actual execution record, not a fixed-clock simulation. The check establishes freshness and internal consistency for this scenario; it does not claim real Stripe access or validate all concurrency scenarios.
