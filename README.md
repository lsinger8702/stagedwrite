# StagedWrite

An experimental TypeScript library for staged writes from agent tools to external systems.

**Status: early prototype, v0.0.1.** Graph registration, editing, preflight and execution are connected. SQLite persists drafts, fixed plans, run snapshots and receipts. Explicit same-host recovery can reclaim unfinished runs after their owner closes or exits; there is no published npm package yet. The opt-in Stripe test Customer adapter has offline contract coverage; real-account verification is still pending.

StagedWrite separates author intent, preflight diagnostics, a fixed execution plan and remote effects. An ambiguous remote outcome stops execution until the adapter can reconcile it.

## Run it

Use Node.js 22.13 or newer and npm:

```sh
npm ci
npm test
npm run demo:execution
```

The graph execution demo registers a definition, creates an incomplete graph, fills the missing intent and fixes a plan. A fake remote then commits an effect but loses its response. Resume reconciles it, finishing with **two effects and two apply calls**. This demonstrates in-process recovery against a mock, not a real billing system.

Other examples:

- `npm run demo:registry`: schema references and empty graph creation.
- `npm run demo:graph`: atomic edits and a shared document reference.
- `npm run demo:preflight`: missing values, explicit repair and stale-check rejection.
- `npm run demo`: the original scalar prototype, using the same execution state machine.

## Persist drafts and checks (M4)

```ts
const engine = createStagedWrite({
  definitions: [definition],
  rules: [],
  storage: { kind: "sqlite", path: "./drafts.sqlite" }
});
const ids = engine.listDraftIds();
// getCheck(draftId) discovers the current check after restart.
// getDraft, edit, preflight and getCheck read/write this database.
engine.close(); // Reopen with the same definitions and rule identities.
```

SQLite stores graph snapshots, versions, tombstones, definition identities and the current check. Editing uses a
conditional database update and invalidates the check atomically. Preflight first persists invalidation, then saves
its result only if both the draft version and check generation still match. Competing connections cannot overwrite
newer edits or checks. Old definition versions must still be registered; changing a stored definition under the same
ID/version is rejected. A changed rule digest makes a restored check non-current.

Run `npm run demo:storage` for reopening a SQLite draft and check. Automated tests also verify reads in a separate process.

## Persist execution facts (M5)

Executable mode now also accepts `storage: { kind: "sqlite", path }`. A passing preflight stores its exact plan
and certificate with the check. First publication atomically validates that check, inserts the run and permanently
seals the draft. Repeated publication returns the same run; a second engine cannot dispatch it or edit the sealed draft.

Before every adapter call, the engine commits the original key, resolved payload and dispatch/reconciliation intent.
It commits each observed result before moving to the next step. Manual decisions, stop requests and their resulting
states are saved together. `revise` and `continueFrom` save their draft and source relationship atomically, so repeated
derivation after reopening returns the same draft. Use `listRunIds()` and `getRun()` to inspect saved records.

**Restart recovery (M6):** reopening does not automatically dispatch. Inspect the run, explicitly claim ownership,
then choose whether to resume or record verified manual evidence:

```ts
const run = engine.getRun(runId);
const recovered = engine.recover(run.id, {
  requestId: "recovery-1", expectedSequence: run.events.length,
  actor: "operator", reason: "Previous process exited"
}); // No adapter call; interrupted dispatch becomes unknown.
const result = await engine.resume(recovered.id); // Reconcile unknown before any retry.
```

The previous owner must have closed, or its PID must be absent on the same host. Live or uncertain owners cannot
be displaced. Use a local SQLite file on one trusted host and one PID namespace; shared network storage and
cross-host/container failover are unsupported. PID reuse conservatively blocks recovery. There is no timeout takeover.
Request IDs make recovery resubmission idempotent for the current owner; sequence checks reject stale commands.
Original keys, resolved inputs and successful receipts are retained. Empty remote searches remain unknown.
Adapters must establish that a request cannot still complete before reporting `no_effect`.

Without a successful claim, a new engine returns `RECOVERY_REQUIRED` for nonterminal mutations. Terminal runs remain
readable, and failed runs can derive revisions/continuations under their usual evidence checks.
A checkpoint failure stops local advancement (`RUN_STORAGE_FAILED`); close and reopen before recovery.
`close()` refuses while a check, recovery or adapter call is active. Schema versions 1/2 upgrade transactionally to 3;
legacy runs without owner-session evidence remain read-only (`OWNER_EVIDENCE_REQUIRED`). Old binaries reject schema 3.
The database is trusted internal state, not an import format for arbitrary run JSON.

Run `npm run demo:durable` for stored plans and partial continuation, or `npm run demo:recovery` for a real child-process
exit followed by explicit recovery using a local simulated receipt ledger. See [M6 design](docs/design/012-restart-recovery.md).

## Define and edit a graph

```ts
import { createStagedWrite, defineDraftType } from "stagedwrite-prototype";

const definition = defineDraftType({
  id: "example.project", version: "1",
  nodeTypes: {
    project: {
      valueSchema: {
        type: "object",
        $defs: { quantity: { type: "number", minimum: 0 } },
        properties: { capacity: { $ref: "#/$defs/quantity" } },
        additionalProperties: false
      },
      requiredAtPublish: ["capacity"]
    }
  },
  relationTypes: {}
});
const engine = createStagedWrite({ definitions: [definition] });
const draft = engine.create({ type: definition.id, typeVersion: definition.version });
const ops = [
  { op: "node.add", id: "project-1", nodeType: "project" },
  { op: "set", nodeId: "project-1", path: "/capacity", value: 100 }
] as const;
const preview = engine.preview(draft.id, draft.version, ops);
const saved = engine.edit(draft.id, draft.version, ops);
const check = engine.preflight(saved.id);
```

The package-name import assumes a local link/build. See [local example imports](examples/registry.ts) for running from this repository.

Assembly validates ordinary JSON and helper output, compiles a restricted JSON Schema 2020-12 profile, and freezes instance-owned definitions. Each node schema has a local `$defs` namespace; missing, cyclic, external and unsupported references fail at startup. Definition identity uses the versioned `sha256:stagedwrite-json-v1` format.

Graph operations are `node.add`, `node.remove`, `edge.add`, `edge.remove` and field `set`/`remove`/`reset`. Field paths are single-segment JSON Pointers, including `~0`/`~1` escapes. Explicit clear is distinct from null and undeclared. Deleted node/edge IDs cannot be reused in the same draft.

Operations run in input order; final field constraints and edge integrity are checked at the end. Invalid batches roll back graph, version and tombstones together. Deleting referenced nodes requires explicit removal of their edges in the batch. Preview and edit share candidate calculation; only successful edit saves once and increments version. Empty batches are rejected.

## Check and execute

Default `mode: "draft"` has no publish methods and no certificate. Its `passed` result only means draft checks passed. Register graph rules separately with `{id,version,type,typeVersion,check}`. Rules return diagnostics containing repair ops or blocked reasons; fixes are never applied automatically. Exceptions, asynchronous rules and invalid repairs yield `incomplete`.

For execution, explicitly configure `mode: "executable"` and `executors: [executor]`. Each definition version requires one `GraphExecutor` with stable id/version/target, pure synchronous `plan`, `apply`, and a `reconcile` function or an explicit unsupported reason. Missing capabilities fail assembly.

```ts
const engine = createStagedWrite({
  definitions: [definition], rules: [], mode: "executable", executors: [executor]
});
// Create and edit a graph as above, then:
const check = engine.preflight(draftId);
if (check.certificate) {
  let run = await engine.publish(draftId, check.certificate);
  if (run.state === "unknown" || run.state === "blocked") {
    run = await engine.resume(run.id); // caller decides retry timing and capacity
  }
}
```

See [the complete executable graph example](examples/graph-execution.ts). A passing execution check fixes a copied plan and binds draft version, definition/rule digests, executor identity, target and plan digest. Publish executes that plan without rerunning the planner. The certificate is an internal handle, not external authorization.

Successful edits and repeated preflight invalidate old checks/plans. Preview and rejected edits preserve them. `getCheck(draftId,checkId)` rejects obsolete or foreign checks. Publishing seals the draft and establishes its run before dispatch. Repeated publish observes that run; only resume advances it. Both graph and scalar entry points share [ExecutionRuntime](src/execution/runtime.ts).

## Dependencies and failure revisions

A sequential plan may declare `dependsOn: ["parent"]` and `inputRefs: { projectId: "parent" }`.
The latter fills `payload.projectId` from the applied parent's `remoteRef`. Dependencies must occur earlier;
references require an explicit dependency and cannot overwrite literal payload fields. Both public entry points
validate this contract. Dispatch inputs are recorded and reused unchanged for retries and reconciliation.
Graph relations are mapped by the executor; the library does not infer execution dependencies from every graph edge.

Terminal failure marks all unattempted steps `skipped`, with `dependency_failed` or `run_stopped` as the reason.
For a terminal run proven to have no effects, `engine.revise(runId)` returns an editable copy with a new ID,
version 0 and `sourceRunId`. It needs a new preflight certificate. Repeated revision calls return the same copy;
the source remains sealed and its execution history remains available. Unknown, blocked, successful and partially
applied runs cannot be revised this way. For mapped create-only plans, use `continueFrom` for partial-success derivation (below).

Run `npm run demo:dependencies` for a project/task graph: zero-effect refusal → revise → parent result reference → recover a lost child response.
The legacy `StagedWrite` class is deprecated; use `createStagedWrite` for new integrations.

## Recovery contract

- `apply` returns `applied`, `unknown`, or `not_applied` with optional `retryable`.
- A proven retryable refusal pauses as `blocked`; explicit resume reuses its original key. A final refusal stops as `failed`.
- `reconcile` returns `applied`, `unknown`, or `no_effect`. The latter must prove the earlier request has no effect and cannot still complete. An empty search is insufficient.
- Earlier successes and remote receipts remain visible. **Failed does not mean no effects occurred.** No automatic rollback is provided.
- Recovery must use the original step/key and stable target configuration; a process-local cache cannot be the only evidence source. Unsupported recovery is explicit and keeps unknown runs stopped.

Callers own retry limits, backoff and scheduling. The engine cannot make a remote honor idempotency keys. No exactly-once claim.

Failed steps expose `failureReason` (`remote_refusal`, `manual_no_effect`, or `retry_stopped`) and
`failureEventSequence`, pointing to the event that explains the failure. These fields aid display and auditing;
recovery eligibility continues to depend on effect evidence.

## Stop retrying

A caller can end a paused retry sequence without sending another request:

```ts
const observed = engine.getRun(runId);
engine.stopRetry(runId, {
  requestId: "stop-limit-1",
  expectedSequence: observed.events.length,
  actor: "operator-id",
  reason: "Retry limit exhausted"
});
```

Only an idle `blocked` run with pending steps is eligible. The engine checks dispatch history and authoritative
no-effect evidence; absence of a remote reference is not proof. The next pending step becomes `failed`, remaining
pending steps become `skipped/run_stopped`, and a distinct `retry_stopped` event records the command. Existing receipts
remain intact. The old run cannot dispatch again: a zero-effect failure can use `revise`, while mapped partial success
can use `continueFrom`. Unknown runs require reconciliation or `close_unresolved`, not this operation.
Same command resubmissions are idempotent; stale event sequences and conflicting reuse of a stop request ID fail.
Run `npm run demo:stop` for repeated quota refusal → stop → new revision.

Every execution event now has an ISO `recordedAt`. Executable engines accept `clock: () => epochMilliseconds`
(and the legacy constructor accepts `{ clock }` as its third argument) for deterministic tests. Event `sequence`
remains authoritative for ordering and CAS; wall clocks can repeat or move backwards. An invalid/throwing clock falls
back to system time so it cannot discard a remote outcome. Clocks are trusted, synchronous diagnostics, not authorization.

## Manual reconciliation

When automatic recovery cannot establish an outcome, a trusted host can call:

```ts
const observed = engine.getRun(runId);
engine.adjudicate(runId, stepId, {
  requestId: "review-123",
  expectedSequence: observed.events.length,
  actor: "operator-id",
  evidence: "case-123/verified-receipt",
  note: "Verified this exact request and target",
  decision: { kind: "applied", remoteRef: "remote-object-id" }
});
await engine.resume(runId); // Separate, explicit dispatch permission from the caller.
```

`applied` records the receipt and pauses as `blocked`; resume skips that effect and resolves dependent inputs.
`no_effect` requires proof that the original request did nothing **and cannot later complete**. Choose
`next: "retry"` to pause for an explicit same-key retry, or `next: "stop"` to end as failed. Only a fully
zero-effect failure permits `revise`. An empty search alone is not proof.
`close_unresolved` ends the run as `closed`, retains the unknown step and prevents further execution or zero-effect revision.

Adjudication never calls the adapter. Only the current unknown step is eligible, and an in-flight run rejects it.
The expected event sequence rejects stale decisions. Repeating the same request ID and command returns the current run;
reusing the ID with different content fails. Independent `adjudicated` events retain the actor, evidence, note, decision and timestamp.
The host must authenticate/authorize the actor and verify evidence against the original request and executor target;
these strings are audit assertions, not authentication or automatic proof. Run snapshots expose payloads and evidence:
keep secrets out of them and enforce access control in the host. Storage is still in memory.

Run `npm run demo:manual` for an offline unsupported-recovery → manual receipt → explicit resume example.
Adjudication does not revise a failed step's business intent; mapped create-only plans can use `continueFrom` below.

## Continue a partial creation

Executors can opt into one-create-step-per-node mapping:

```ts
{ id: "create_parent", effect: { kind: "create", nodeId: "parent" }, payload: { name: "Parent" } }
```

After a terminal partial failure, `engine.continueFrom(runId)` copies the graph into a new draft with engine-owned
receipts in `draft.continuation`. Repeated calls return the same draft. Edit the failed portion, run preflight again,
and publish with the new certificate. Successful nodes cannot be changed or removed. Their original steps must
remain in the plan with identical IDs, mappings, payloads, dependencies and input references.

The new run marks these steps `reused` and records `reusedFrom` with source run/step, node, remote reference and
resolved inputs. It does not dispatch them. Dependent steps receive the original remote reference; new requests
use new keys. The original run remains unchanged. Preflight binds the executor, target, plan and continuation
receipts; planners cannot substitute a different operation for a reused create.

This path requires a complete one-to-one create mapping for the source and new graph. Unmapped operations,
updates, deletes, multiple effects per node, unknown outcomes and closed runs cannot use it. Existing remote
objects are assumed to remain valid: reuse records past creation evidence, not a fresh remote-state check.
Run `npm run demo:continuation` for parent success → child refusal → edit child → reuse parent → child recovery.
See [the continuation contract](docs/design/008-partial-continuation.md).

## Stripe test Customer experiment

`StripeTestCustomerAdapter({secretKey,accountId}).graphExecutor(selector)` connects a single customer graph to Stripe. `npm run demo:stripe` now uses the graph engine. It verifies the credential's account, creates only a test Customer with synthetic description/metadata, and does not request payments.

Set `STRIPE_SECRET_KEY` and `STRIPE_ACCOUNT_ID` locally, then choose:

```sh
npm run demo:stripe
npm run demo:stripe -- --lose-response
```

Each invocation is a new intent and can create a new test Customer. Records remain for dashboard inspection. The loss mode deliberately withholds a successful real response, then searches by request marker and context digest. These bind the original key, payload, account and executor/API version; empty, mismatched or ambiguous evidence remains unknown.

Proven Customer request refusals stop as failed. A documented limiter response can pause as blocked and actually retry under the same key. Status alone is insufficient; ambiguous errors and all 5xx stay unknown. Only proven refusals are retried; unresolved POSTs are never repeated by this adapter.

**Real-account verification is still pending.** Offline HTTP contract tests are not a substitute. The network demo is opt-in and excluded from CI. See [setup and acceptance](docs/design/005-stripe-adapter-experiment.md) and [the updated contract](docs/design/006-graph-execution.md).

## Limits and next work

- Default mode is in memory. SQLite supports explicit same-host recovery; remote outcomes still depend on adapter evidence and idempotency.
- Trusted in-process code, one engine instance. No multi-worker fencing, tenant isolation or approval enforcement.
- Scalar graph fields; no nested JSON, arrays, inheritance, restore/import or automatic topology constraints.
- Rules and plans are pure/synchronous by contract; their code is not hashed. Implementers must version changed behavior.
- No durable retry limit, compensation, production billing integration or MCP server.
- Stripe recovery now requires version-2 context metadata; old attempt-only objects are not automatically claimed.

M1 definition assembly, M2 graph edits, M3 preflight and the in-memory graph execution bridge are implemented. M4 SQLite draft/check storage is implemented. M5 plan/run persistence is implemented. M6 explicit same-host recovery is implemented. Next: external trial/release (M7). This remains an experimental 0.0.1, not a completed 0.1.0 MVP.

## Read and contribute

- [Chinese documentation index](docs/README.md)
- [MVP scope](docs/mvp.md), [roadmap](docs/roadmap.md), [architecture](docs/architecture.md)
- [M1 definitions](docs/design/001-registry-and-draft.md), [M2 operations](docs/design/003-graph-operations.md), [M3 checks](docs/design/004-graph-preflight.md)
- [Graph execution and Stripe recovery](docs/design/006-graph-execution.md)

Start with a reproducible issue or focused failing test. Keep code, examples and capability claims aligned. Run `npm test` and the relevant demos before submitting changes.

## License

Apache-2.0. Written from scratch; no production code or account logs are included.
