# StagedWrite

An experimental TypeScript library for staged writes from agent tools to external systems.

**Status: early prototype, v0.0.1.** Graph registration, editing, preflight and in-memory execution are connected. There is no durable storage or process-restart recovery, and no published npm package yet. The opt-in Stripe test Customer adapter has offline contract coverage; real-account verification is still pending.

StagedWrite separates author intent, preflight diagnostics, a fixed execution plan and remote effects. An ambiguous remote outcome stops execution until the adapter can reconcile it.

## Run it

Use Node.js 22 and npm:

```sh
npm ci
npm test
npm run demo:execution
```

The graph execution demo registers a definition, creates an incomplete graph, fills the missing intent and fixes a plan. A fake remote then commits an effect but loses its response. Resume reconciles it, finishing with **two effects and two apply calls**. This demonstrates in-process recovery against a mock, not a real billing system.

Other examples:

- `npm run demo:registry`: schema references and empty graph creation.
- `npm run demo:graph`: atomic edits and a shared asset reference.
- `npm run demo:preflight`: missing values, explicit repair and stale-check rejection.
- `npm run demo`: the original scalar prototype, using the same execution state machine.

## Define and edit a graph

```ts
import { createStagedWrite, defineDraftType } from "stagedwrite-prototype";

const definition = defineDraftType({
  id: "example.campaign", version: "1",
  nodeTypes: {
    campaign: {
      valueSchema: {
        type: "object",
        $defs: { money: { type: "number", minimum: 0 } },
        properties: { budget: { $ref: "#/$defs/money" } },
        additionalProperties: false
      },
      requiredAtPublish: ["budget"]
    }
  },
  relationTypes: {}
});
const engine = createStagedWrite({ definitions: [definition] });
const draft = engine.create({ type: definition.id, typeVersion: definition.version });
const ops = [
  { op: "node.add", id: "campaign-1", nodeType: "campaign" },
  { op: "set", nodeId: "campaign-1", path: "/budget", value: 100 }
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
    run = await engine.resume(run.id); // caller decides retry timing and budget
  }
}
```

See [the complete executable graph example](examples/graph-execution.ts). A passing execution check fixes a copied plan and binds draft version, definition/rule digests, executor identity, target and plan digest. Publish executes that plan without rerunning the planner. The certificate is an internal handle, not external authorization.

Successful edits and repeated preflight invalidate old checks/plans. Preview and rejected edits preserve them. `getCheck(draftId,checkId)` rejects obsolete or foreign checks. Publishing seals the draft and establishes its run before dispatch. Repeated publish observes that run; only resume advances it. Both graph and scalar entry points share [ExecutionRuntime](src/execution/runtime.ts).

## Dependencies and failure revisions

A sequential plan may declare `dependsOn: ["parent"]` and `inputRefs: { campaignId: "parent" }`.
The latter fills `payload.campaignId` from the applied parent's `remoteRef`. Dependencies must occur earlier;
references require an explicit dependency and cannot overwrite literal payload fields. Both public entry points
validate this contract. Dispatch inputs are recorded and reused unchanged for retries and reconciliation.
Graph relations are mapped by the executor; the library does not infer execution dependencies from every graph edge.

Terminal failure marks all unattempted steps `skipped`, with `dependency_failed` or `run_stopped` as the reason.
For a terminal run proven to have no effects, `engine.revise(runId)` returns an editable copy with a new ID,
version 0 and `sourceRunId`. It needs a new preflight certificate. Repeated revision calls return the same copy;
the source remains sealed and its execution history remains available. Unknown, blocked, successful and partially
applied runs cannot be revised this way. Partial-success derivation needs an explicit node/result mapping and is pending.

Run `npm run demo:dependencies` for a campaign/adset graph: zero-effect refusal → revise → parent result reference → recover a lost child response.
The legacy `StagedWrite` class is deprecated; use `createStagedWrite` for new integrations.

## Recovery contract

- `apply` returns `applied`, `unknown`, or `not_applied` with optional `retryable`.
- A proven retryable refusal pauses as `blocked`; explicit resume reuses its original key. A final refusal stops as `failed`.
- `reconcile` returns `applied`, `unknown`, or `no_effect`. The latter must prove the earlier request has no effect and cannot still complete. An empty search is insufficient.
- Earlier successes and remote receipts remain visible. **Failed does not mean no effects occurred.** No automatic rollback is provided.
- Recovery must use the original step/key and stable target configuration; a process-local cache cannot be the only evidence source. Unsupported recovery is explicit and keeps unknown runs stopped.

Callers own retry budgets, backoff and scheduling. The engine cannot make a remote honor idempotency keys. No exactly-once claim.

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
Partial-success draft derivation remains pending; adjudication does not revise a failed step's business intent.

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

- In-memory only: process loss loses graphs, plans, run records and keys. No crash recovery guarantee.
- Trusted in-process code, one engine instance. No multi-worker fencing, tenant isolation or approval enforcement.
- Scalar graph fields; no nested JSON, arrays, inheritance, restore/import or automatic topology constraints.
- Rules and plans are pure/synchronous by contract; their code is not hashed. Implementers must version changed behavior.
- No durable retry budget, compensation, production billing integration or MCP server.
- Stripe recovery now requires version-2 context metadata; old attempt-only objects are not automatically claimed.

M1 definition assembly, M2 graph edits, M3 preflight and the in-memory graph execution bridge are implemented. Next: SQLite draft/check storage (M4), durable plans/runs (M5), restart recovery (M6), and external trial/release (M7). This remains an experimental 0.0.1, not a completed 0.1.0 MVP.

## Read and contribute

- [Chinese documentation index](docs/README.md)
- [MVP scope](docs/mvp.md), [roadmap](docs/roadmap.md), [architecture](docs/architecture.md)
- [M1 definitions](docs/design/001-registry-and-draft.md), [M2 operations](docs/design/003-graph-operations.md), [M3 checks](docs/design/004-graph-preflight.md)
- [Graph execution and Stripe recovery](docs/design/006-graph-execution.md)

Start with a reproducible issue or focused failing test. Keep code, examples and capability claims aligned. Run `npm test` and the relevant demos before submitting changes.

## License

Apache-2.0. Written from scratch; no production code or account logs are included.
