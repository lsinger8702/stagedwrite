# StagedWrite

[English](README.md) · [简体中文](README.zh-CN.md)

**Preflight complex LLM-generated writes. Diagnose specific errors. Repair with precise OPs. Resume safely.**

Generating valid JSON is only the beginning. When an agent prepares a large API request with hundreds of fields, nested objects and related resources, it can choose an invalid combination, omit a required value, or contradict the user's intent. If the API rejects one field, regenerating the entire body risks changing fields that were already correct.

For writes that affect money or other consequential resources, discovering a mistake **after sending the request** can also be too late. The request needs business checks before execution, not just a JSON Schema that accepts its shape.

StagedWrite is a TypeScript library between an agent's proposed intent and external writes. It keeps the work in a long-lived **Draft**, runs **preflight** checks, returns the full preview with **targeted diagnostics**, and lets the model repair the work through **set / remove / reset** operations. The backend applies those edits; the model does not need to regenerate the entire request. Publication and recovery then track what actually happened remotely.

## The complete write lifecycle

| Capability | What it addresses |
|---|---|
| **Preflight before execution** | Check complex JSON and business constraints before causing remote effects |
| **Targeted diagnostics** | Give the model a full preview, exact locations and messages, with optional candidates and repair OPs |
| **Three-state local repair** | Apply set/remove/reset batches atomically, reducing full-body generation and unrelated changes |
| **Idempotency and duplicate-publication protection** | Reuse keys for safe retries of the same request; keep unfinished work in its original Run |
| **Concurrency control** | Reject stale edits with version CAS; protect state transitions with Draft leases and storage fencing |
| **Unknown-outcome reconciliation** | Preserve original request evidence after timeouts or lost receipts instead of assuming no effect |
| **Partial success and recovery** | Preserve successful steps, repair unfinished work, and resume from facts retained by a persistent backend |
| **Long-lived Drafts and updates** | Keep resource bindings, check diff/drift, update existing resources and adopt no-op changes without writes |
| **Agent integration** | Use provider-neutral tools, a Messages repair loop or the official DSH adapter, with explicit integration boundaries |

## Why preflight exists

**1. Help the model correct complex request parameters.** A large request can be structurally valid and still be wrong: incompatible field combinations, missing dependencies, unsupported values or inconsistent settings across resources. Registered rules inspect the current Draft and report the problems that actually apply, at specific coordinates. The model receives the current preview, the error message and optional hints, candidate values or repair OPs, so it can propose a focused correction.

**2. Check consequential writes before they take effect.** In a billing or financial integration, an application might register checks for amount limits, currency compatibility, account eligibility or required approval evidence. Static rules check local conditions; asynchronous rules consult external services and return `pending` while unfinished. A passing execution check produces a version-bound certificate required for publication. Host authorization remains separate, and conditions that must hold at the instant of a remote write still need enforcement by that service or adapter.

The library provides the checking and diagnostic protocol; **the integration supplies its business rules**. It does not ship a financial policy engine, and a passing check is not a promise that every possible remote rejection has been predicted.

## The model gets a diagnosis, not a rulebook

The repair loop is:

```text
User intent → Draft → preflight → current preview + specific diagnostics
                          ↑                       ↓
                          └── backend applies ← model proposes OP list
```

A diagnostic identifies **where the problem is, what failed, and why**. Suggestions are optional: the model uses the user's intent to choose a correction or ask for missing information. It does not have to search a prompt or memory containing every platform rule and discover all violations itself.

Only three editing operations are needed:

- `set`: declare a value, including an explicit `null` where allowed.
- `remove`: explicitly clear a field.
- `reset`: restore the fixed baseline—initial intent before first publication, latest fully published intent afterward.

The backend validates and applies an OP batch atomically, then the repaired Draft is checked again. **The model can inspect the full preview without having to output the whole graph again.** Small, coordinate-based edits avoid unrelated changes introduced by full regeneration. The adapter maps graph intent to the real request body.

## Remote rejection joins the same repair loop

Preflight cannot predict every response. An adapter can map a real API rejection into the same diagnostic structure, with a current preview, message and optional repair suggestions. The model proposes OPs, the backend edits the Draft, and `resume` continues the unfinished Run after the necessary checks.

## Idempotency, concurrency control and recovery are core features too

**Prevent duplicate creation.** First publication atomically claims a Run. While a Draft has unfinished work, another publish observes that Run rather than starting a second creation. Safe retries of the same request reuse its idempotency key. A repaired request receives a new identity only after the previous outcome is resolved, avoiding both duplicate effects and reuse of an old rejection as the new response.

**Protect concurrent work.** Edits use expectedVersion/CAS to reject stale changes. Draft leases protect publication, recovery and edit critical sections; storage atomically validates lease tokens and fencing values before accepting transitions. A worker that lost ownership cannot continue committing state. These locks coordinate local execution ownership; they neither retract dispatched requests nor replace remote conditional writes.

**Preserve uncertainty.** The original request and key are recorded before dispatch. Adapters report applied, not_applied or unknown. A timeout or lost receipt does not prove failure. Resume reconciles the original request; a no_effect conclusion requires evidence that the request did not take effect and cannot take effect later. An empty lookup is insufficient.

**Treat partial success as normal.** Receipts and bindings are saved as nodes succeed. Those nodes remain protected within the unfinished Run while other nodes are repaired and resumed, without resending confirmed successes. With a persistent backend, saved execution facts support recovery after process exit or reopening; callers need not restart the whole batch.

These mechanisms reduce duplicate side effects, but remote idempotency and conclusive reconciliation require adapter support; there is no general exactly-once claim. Automatic rollback, background retry scheduling and a bundled production cross-host backend are outside the current scope. See the recovery and lock/storage boundaries below.

## A Draft remains useful after publication

A Draft starts with real user intent and remains bound, node by node, to the resources successfully created. Update-capable adapters can edit supported fields on the same fixed graph and remote IDs, using diff and drift checks. Full success advances the reset baseline; unfinished work continues through the same Run. Resource creation, deletion and replacement during update are outside the current scope.

## What you can run today

- **Real Stripe sandbox evidence:** Product → two Prices, actual remote refusals, repair and same-Run recovery; separate update scenarios verify existing resource IDs. Receipt loss is explicitly injected. [Stripe guide](examples/stripe/README.md) · [Update evidence](docs/testing/stripe-catalog-update.md).
- **Executable walkthrough:** actual library and SQLite calls against a mock remote, with generated HTML/ZIP checked in CI. [Input/output walkthrough](docs/examples/publish-resume.html).
- **Three integration paths:** provider-neutral TypeScript tools, a bounded Messages API repair loop, and an isolated official DSH adapter. Agent-loop tests use mock models; they do not establish real-model quality.

Early prototype, v0.0.1 · Node.js 22.13+ (`node:sqlite`) · not yet published to npm. Start with the examples and integration guides; design histories are supplementary references.

## Quickstart

```sh
npm ci
npm test
npm run demo:html
```

Requires Node.js 22.13+ with `node:sqlite`. Open [the actual input/output walkthrough](docs/examples/publish-resume.html). It runs the library and SQLite against a fictional remote service: three real rule failures, asynchronous pending, fixed-baseline reset, partial publication, repair, and unknown-outcome reconciliation. No HTTP or LLM calls are made.

## Stripe sandbox example

A real Product → two Prices integration demonstrates a remote validation refusal, explicit Draft repair, and same-Run resume. [Run the sample](examples/stripe/README.md) · [Testing scope and recorded result](docs/testing/stripe-sandbox.md). The receipt-loss scenario is fault injection after a real creation.

`npm run test:stripe` runs offline regression tests with no credentials. Live requests require an explicit flag and a test key; state and raw traces stay local. [Contributing](CONTRIBUTING.md).

A separate [real Product update recording](docs/examples/stripe-update-sandbox-result.json) verifies editing the same remote resource, injected receipt loss, SQLite reopen and same-Run resume, followed by no-op publication. [Update sample](examples/stripe-update/README.md).

The [catalog update acceptance](docs/testing/stripe-catalog-update.md) additionally verifies two unchanged Prices, local immutable-amount rejection, and an actual Stripe update refusal repaired within the same Run.

## Agent integration

| Integration | Entry point | Validation scope |
|---|---|---|
| Any agent/tool host | `createAgentTools` — [guide](docs/guides/agent-tools.md) | Seven authorized tools, input validation, previews and diagnostics |
| Direct Messages API | `repairDraft` — [guide](docs/guides/agent-repair.md) | Bounded repair loop; mock-model end-to-end tests |
| Official DeepSeek Harness | [DSH adapter and setup](integrations/dsh/README.md) | Real DSH loop/session/tools with mock model and remote; host identity binding |

Run `npm run demo:agent` for the tools or `npm run demo:repair` for the repair loop. These examples use simulated model decisions and remote effects. They are not a bundled MCP server.

## Current API

StagedWrite is a graph intent library for agent tools. `createStagedWrite` is its only engine entry point.

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
const { draft, createdRefs } = await engine.create(selector, {
  roots: [{ nodeType: "task", fields: { name: "Initial work" } }],
});
const nodeRef = createdRefs.find(r => r.path === "/roots/0").ref;
const check = await engine.preflight(draft.id);
if (check.status === "passed" && check.certificate) {
  const run = await engine.publish(draft.id, check.certificate);
  // If unfinished: inspect preview/diagnostics, optionally edit, then resume(run.id).
}
await engine.close();
```

Edit a current node using its ref from the Draft/preview:

```ts
const updated = await engine.edit(draft.id, draft.version, {
  patches: [{ op: "set", ref: nodeRef, scope: "canonical", path: "/profile/name", value: "Chosen name" }],
});
// Topology edits use graphPatches with the same set/remove/reset OP set.
// Candidate repairOps and repairs[].ops contain this same EditBatch shape.
```

Both `ownership` and `cardinality` are required on every registered relation. Repeated field coordinates in one batch are rejected atomically with `message` and `hint`. New nodes created by topology edits receive server IDs via `createdRefs`; preview IDs cannot be submitted to edit.

The package exports `initialIntentSchema` and `editBatchSchema` for host-side structural validation. See [Agent input schemas](docs/guides/agent-inputs.md) for package imports, diagnostic repair handling and the boundary between tool shapes and engine validation.

See the [complete registered schema and rules](examples/fixtures/project-tasks-managed.ts), [executor and calls](examples/publish-and-resume.ts), and [contract](docs/design/018-draft-lifecycle-proposal.md).

- Draft persists ordinary `graph` values, separate `fieldIntents`, immutable `initialSnapshot`, `currentRunId`, and a successful artifact reference. It retains its identity after publication.
- `set` declares a value, `remove` explicitly clears it. `reset` restores the latest fully published intent, or the initial intent before first success, including undeclared fields; it does not undo the last edit.
- The first publish claims one Run atomically. While a Run is unfinished, publish observes it and repairs continue with resume. After full success, a checked field update can claim a new Run on the same Draft and bindings. Independent resource creation needs a new Draft.
- `resume` continues the same unfinished Run, even without a process failure. Success is preserved; unknown requests use their original input/key for reconciliation. Repair edits are limited to unfinished nodes' fields.
- `edit` returns only `{draftId, version, preflightRequired: true, changes, createdRefs}`. Use `getDraft` for the stored snapshot and `preflight` for the complete current preview and diagnostics. Editing an existing Run still requires `resume` to continue it.
- Bindings are saved as individual nodes succeed. `pending` may already have remote resources; only full success marks the Draft `published`.
- All managed APIs are asynchronous. Without executors, preflight is diagnostic-only. Without a registered backend, storage and locking are in-process memory only.

Preflight responses use `formatVersion: 3`. Preview fields are keyed by node-relative JSON Pointers (`fields["/profile/name"]`), with reconstructed object values and explicit child states. Arrays remain whole values. Older saved checks require a fresh preflight. Public edit/preview and repair suggestions use `EditBatch`; create accepts `InitialIntent` (`{roots: [...]}`) and returns `{draft, createdRefs}`.

## Updating existing resources

After a successful publication, edit fields, run preflight, then publish its new certificate. Results have `kind: "initial_create" | "update"` with a Run ID, `kind: "noop"` with `id: null` for a durable no-write adoption, or `kind: "not_started"` with diagnostics when readback blocks adoption. Resume unfinished Runs; do not replace them. Completed nodes in the active Run remain protected. Historical completed Runs are read-only.

[Executed update HTML](docs/examples/update.html) · [Offline ZIP](docs/examples/stagedwrite-update.zip) · [Product adapter and sandbox instructions](examples/stripe-update/README.md). The HTML uses a mock remote; separate live Product and catalog recordings are linked in the sandbox instructions.

## Adapter receipt contract

`ManagedExecutor` distinguishes creation/read-only inspection from update writes:

- `updateWrites` omitted or `false`: `update.inspect` (and an optional preview planner) may be registered without promising writes. Creation may return `applied` without `confirmed`, but then it establishes no normalized baseline for future updates.
- `updateWrites: true`: use `ManagedUpdateExecutor`. Both `update.inspect` and `update.plan` are required. The same `apply` and `reconcile` callbacks must include `confirmed: { projectionDigest, values }` in every `applied` result, including creation. Non-applied results need no confirmation; unsupported reconciliation remains an explicit declaration.

TypeScript checks this promise. Registration rejects missing capability functions without invoking them; it cannot prove what a callback will return. Runtime update receipt validation still checks the original resource, projection and all managed values. Missing or contradictory confirmation leaves the request `unknown`, not safe to resend. Callbacks receive original immutable update conditions in `context.update`, including the observation's `remoteVersion` when available.

**Fixed-graph scalar-field update is enabled for explicit update-capable executors.** Node creation/deletion/replacement during update is not supported. Remote conditional writes belong to the adapter; without remote CAS, use a single writer. See the [update guide](docs/guides/update.md) and [execution ledger](docs/tasks/update-execution.md).

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

Not available through the public engine: remote topology changes/resource replacement, rollback, autofill, scheduling, full edit history, manual adjudication/stop/import/retention APIs, or generic nested request-body generation. [Roadmap](docs/roadmap.md).

`npm run build` cleans `dist` first, so removed implementations cannot survive in a tarball. CI runs the current regression suite, the actual walkthrough and an isolated package-consumer check.

## Walkthrough integrity

`npm run demo:html` executes the real library and SQLite against a simulated remote, then generates the JSON trace, Markdown, standalone HTML and offline ZIP together. The ZIP contains those exact HTML/JSON/Markdown bytes, with fixed archive metadata.

`npm run verify:walkthrough` runs the example again without overwriting the checked-in evidence. It compares the new trace with the committed trace after consistently renaming runtime UUIDs and ignoring only engine/report timestamps and the Node version label. Business values, diagnostics, OP order, versions, bindings and effects must match. It also rebuilds HTML/Markdown/ZIP from the committed trace and current source/template and requires byte equality. The fresh unmodified trace is saved as `dist/walkthrough-raw.json` and uploaded by CI for inspection.

The committed trace remains an actual execution record, not a fixed-clock simulation. The check establishes freshness and internal consistency for this scenario; it does not claim real Stripe access or validate all concurrency scenarios.

### Experimental storage format

The current SQLite backend uses storage schema 3 (durable request envelopes). Schema 1/2 experiment databases are rejected with `STORAGE_VERSION_UNSUPPORTED` before schema or journal-mode changes; they are not migrated or deleted. Keep existing databases intact and use a new database for new experiments. An unresolved Run in an old database must not be replaced by creating the same resources in a new Draft; use the matching earlier library version to inspect or resume that database.

Update keeps the original bindings and immutable request evidence. Old certificates observe their original adoption; compare `isCurrentIntent` and `previewVersion` before treating a historical success as current.

- [Bounded model repair (Messages example; mock-verified)](docs/guides/agent-repair.md)
