# StagedWrite

An experimental TypeScript library for staged writes from agent tools to external systems.

**Status: early prototype, v0.0.1.** The runnable example uses an in-memory fake remote. It does not call Stripe, charge money, or survive a process restart. No published npm package is available from this repository yet.

StagedWrite separates draft editing, preflight diagnostics, and execution. When a remote call has an ambiguous outcome, the execution stops and asks the adapter to reconcile before proceeding.

## Run it

Use Node.js 22 (see `.nvmrc`) and npm:

```sh
npm ci
npm run demo
npm test
```

The demo creates a mock subscription change, blocks an immediate amount above a configured limit, and applies a suggested deferral after an explicit simulated user choice. It then loses a response **after the fake remote has committed**. Resume confirms that effect and completes with two remote effects and two apply calls, without redispatching either step.

Prices, policies and effects are teaching fixtures, not Stripe billing behavior. Recovery happens in the same process.

## M1: register a definition and create an empty graph

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
const selector = { type: "example.campaign", typeVersion: "1" };
const draft = engine.create(selector); // version 0, empty nodes/edges, bound definition digest
engine.getDraft(draft.id);
engine.validateValues(selector, "campaign", { budget: -1 }); // valid: false
```

The package-name import above assumes a local link/build; this package is not on npm.
Run `npm run demo:registry` for the [complete local example](examples/registry.ts).

Assembly validates ordinary JSON as well as helper output, collects definition
errors in `DefinitionAssemblyError.issues`, and freezes instance-owned snapshots.
Each node's schema has its own local `$defs` namespace. Missing/cyclic references,
external references and unsupported schema features fail before compilation.
`getDefinition(selector)` returns a copy and its digest. Digests use the versioned
`sha256:stagedwrite-json-v1` format described in [the M1 design](docs/design/001-registry-and-draft.md).

This **draft-only** engine creates, reads, previews and edits graphs.
`validateValues` checks filled scalar values without modifying input; it does not
interpret clear/reset intent or enforce `requiredAtPublish`. M3 adds draft-scoped graph preflight; persistence and execution integration remain future milestones.

## M2: fill and preview a graph

Using the engine and draft above:

```ts
const ops = [
  { op: "node.add", id: "campaign-1", nodeType: "campaign" },
  { op: "set", nodeId: "campaign-1", path: "/budget", value: 100 }
] as const;
const { candidate, changes } = engine.preview(draft.id, draft.version, ops);
const saved = engine.edit(draft.id, draft.version, ops);
```

`preview` and `evaluateEdit` use the same pure candidate calculation as `edit`.
They do not save state or consume IDs; edit recomputes against the expected version.
A valid nonempty batch increments the version once, even if its net effect is empty.
Any rejected batch leaves the graph, version and ID history unchanged.

- `node.add` / `node.remove`: create an empty node or explicitly remove it.
- `edge.add` / `edge.remove`: create or remove a named directed relation between node IDs.
- `set` / `remove` / `reset`: set a scalar value, explicitly clear, or return a field to undeclared.

Field paths are single-segment JSON Pointers such as `/budget` (`~0` and `~1`
escapes supported). Operations run in input order. Final value constraints and
edge endpoints are checked after the batch; a set before its node is added still
fails. Deleting a referenced node requires explicit edge removal in the same batch.
No cascade deletion, implicit reordering or topology constraints are added.
Multiple edges may share a target node.

`GraphDraft` includes nodes, edges and node/edge tombstones. Deleted IDs cannot be
reused in the same draft and identity namespace. `GraphEditError` carries a code,
operation index/path when available, and final graph issues. Missing publish fields
remain acceptable; invalid filled values do not. There is still no graph `publish`.

Run `npm run demo:graph` for a [shared-asset graph example](examples/graph.ts).
See [the M2 contract](docs/design/003-graph-operations.md) for operation shapes and errors.

## M3: diagnose a graph and recheck explicit repairs

Register versioned synchronous rules separately from serializable definitions:

```ts
const engine = createStagedWrite({
  definitions: [definition],
  rules: [{
    id: "example.policy", version: "1",
    type: definition.id, typeVersion: definition.version,
    check: draft => [] // return GraphDiagnostic[] with repair ops or a blocked reason
  }]
});
const draft = engine.create({ type: definition.id, typeVersion: definition.version });
const check = engine.preflight(draft.id);
engine.getCheck(draft.id, check.checkId); // only the latest current check is accepted
```

Preflight blocks empty graphs and missing `requiredAtPublish` values. Explicit
clear and undeclared are missing; a schema-allowed null is an explicit value.
Business rules inspect independent frozen snapshots. They return diagnostics with
`resolution: {kind: "ops", ops}` or `{kind: "blocked", reason}`. Repair batches
are validated against the current graph, but applying them always requires an
explicit `edit` followed by a new preflight. Suggestions are checked individually;
combining them or applying them does not guarantee that all diagnostics disappear.

Results have `scope: "draft"` and status `passed`, `blocked` or `incomplete`.
Throwing/async rules, malformed diagnostics and invalid repairs yield `incomplete`.
**Passed means draft checks passed; it is not publication readiness or authorization.**
There is no graph publish certificate, adapter plan or publish method yet.

Checks bind the draft version, definition digest and ordered rule identities/versions.
Successful edits and repeated preflight invalidate older checks; preview and rejected
edits retain them. `getCheck` throws `CHECK_NOT_CURRENT` for an obsolete or foreign
check ID. Function implementations are not hashed: version your rules when changing
behavior. Rules are trusted synchronous code and must not perform side effects.

Run `npm run demo:preflight` for the [missing-value → explicit repair → recheck example](examples/preflight.ts).
The [M3 design](docs/design/004-graph-preflight.md) specifies binding and failure behavior.

## Existing execution prototype API

```ts
const engine = new StagedWrite(adapter, rules);
let draft = engine.create();
draft = engine.edit(draft.id, draft.version, ops);
const check = engine.preflight(draft.id);
// If blocked, inspect diagnostics and explicitly choose a repair or supply intent.
if (check.certificate) {
  const run = await engine.publish(draft.id, check.certificate);
  if (run.state === "unknown") await engine.resume(run.id);
}
```

See [the complete example](examples/lifecycle.ts) for imports and a runnable lifecycle.

## Stripe test-mode experiment (real-account verification pending)

A narrow `StripeTestCustomerAdapter` is implemented for the **existing execution
prototype**, creating a test Customer with a synthetic description. It is separate
from the graph engine and is not a billing or graph-publication adapter.

The default transport calls Stripe HTTPS with a pinned API version and per-step
idempotency key. Lost responses are reconciled by reading a unique metadata marker;
empty, ambiguous or incomplete search evidence stays `unknown`. This experiment
never repeats an unresolved POST, never returns `no_effect`, and conservatively
leaves all HTTP errors unknown. It has no crash recovery.

**Only offline transport-contract tests have passed so far. No real Stripe account
run has been verified.** See [setup and acceptance criteria](docs/design/005-stripe-adapter-experiment.md).
After configuring `STRIPE_SECRET_KEY` locally with a test key, run
`npm run demo:stripe` or `npm run demo:stripe -- --lose-response`.
Each run creates a new test Customer; records are retained for dashboard inspection.
The opt-in live-network script is excluded from ordinary tests and CI.

## Implemented

- M1 definition assembly, local schema references, immutable version bindings and empty graph creation via `createStagedWrite`.
- M2 graph operations, pure preview, atomic edits, structural validation and deleted-ID tombstones.
- M3 draft-scoped preflight, versioned graph rules, validated repair suggestions and stale-check rejection.

The separate `new StagedWrite(adapter, rules)` execution prototype provides:

- Incomplete drafts; `set`, `remove` (explicit clear), and `reset` (undeclared).
- Atomic in-memory edit batches with expected-version checking; empty batches are rejected.
- Registered synchronous rules returning repair ops or a blocked reason.
- An opaque preflight handle bound server-side to a draft version and frozen plan.
- Sequential execution, per-step keys, remote references and append-only in-memory events.
- Unknown-outcome blocking, reconciliation and explicit resume.
- Adapter-declared retryable refusals pause as `blocked`, preserving the original key and earlier receipts. Refusal reasons are recorded in events.
- Single-engine concurrency guard and repeat-publish observation.
- Failure-focused tests and a GitHub Actions workflow.

All diagnostics block publication in this prototype. A repair suggestion is never applied automatically by the engine. Publication seals the draft; create a new draft for a new intent. Repeated `publish` observes the existing run; only `resume` advances it.

## Limits

- Memory only: losing the process loses drafts, execution records and keys. **No crash recovery guarantee.**
- One engine instance, trusted in-process adapters and rules. No multi-worker fencing, authentication, tenants or approval enforcement.
- Simple top-level scalar fields only; no nested paths, arrays, inheritance or general schema validation.
- Preflight does not probe remote state, enforce evidence TTLs or bind authorization. Its certificate is an internal lookup handle, not a signed attestation.
- Adapter results are trusted. `apply` returns `not_applied` only for a proven refusal with no possible later effect. `reconcile` returns `no_effect` only when the earlier request is proven to have no effect and cannot still complete; an empty search result is insufficient. HTTP status alone is not proof.
- A refusal with `retryable: true` pauses the run as `blocked`; explicit `resume` retries that step under its original key. An omitted or false `retryable` makes the refusal terminal (`failed`). Earlier applied steps remain visible and are not rolled back. Neither label means there were no effects.
- Callers own retry limits, backoff and scheduling, including redispatch after `no_effect` reconciliation. Each `resume` may dispatch each remaining step once; there is no internal retry loop or durable retry budget.
- No compensation, durable storage, production Stripe integration or MCP server yet. The narrow test Customer experiment is described above.
- Idempotency keys are supplied to adapters; the library cannot make a remote system honor them. No exactly-once claim.

## Adapter recovery contract

`apply` returns `ApplyOutcome`; `reconcile` returns `ReconcileOutcome`.
`Outcome` remains an alias for `ApplyOutcome`. Adapters previously returning
`not_applied` from reconciliation must migrate to `no_effect` **only when they have
conclusive evidence**. An old or invalid result is treated as `unknown`, never as
permission to redispatch. The reconciliation event also uses `no_effect`.

For `blocked`, inspect the latest `not_applied` event's `reason` and `retryable`
fields, then schedule `resume(run.id)` within your own retry budget. Repeated
`publish` only observes the run and does not retry. The draft remains sealed.

[Recovery fixtures](tests/recovery.test.ts) cover transient refusals, terminal
refusals, delayed search visibility and an intentionally incorrect adapter that
creates duplicate effects. In the delayed-visibility fixture, a dedicated remote
contains only this intent; production adapters also need reliable object identity
and correlation. A visible arbitrary object is not proof that this step succeeded.

## Read and extend

1. [Types and adapter contract](src/types.ts)
2. [Draft operations](src/draft.ts)
3. [Execution engine](src/engine.ts)
4. [Fake remote and example rule](src/adapters/mock.ts)
5. [Failure tests](tests/engine.test.ts)

Chinese implementation and first-release guides:

- [文档入口：从这里开始](docs/README.md)
- [MVP 范围与验收](docs/mvp.md)
- [架构与目录](docs/architecture.md)
- [开发任务与进度](docs/roadmap.md)
- [第一项设计：结构注册与空图创建](docs/design/001-registry-and-draft.md)
- [实现路线：每一块怎么做](docs/implementation.zh-CN.md)
- [第一次开源：从本地文件到 GitHub](docs/first-release.zh-CN.md)

## Next milestones

- [x] Versioned draft-type registry and empty graph creation (M1).
- [x] Graph operations, atomic edit batches and structural validation (M2).
- [x] Graph-aware preflight diagnostics and repairs (M3; draft checks only).
- [ ] Narrow Stripe test-mode adapter experiment: code and offline contracts complete; real-account validation pending.
- [ ] SQLite draft and execution storage with atomic transitions and restart tests.
- [ ] Core MVP example, external trial and release (see [MVP scope](docs/mvp.md)).

After the core MVP:

- [ ] Expand the Stripe experiment with real preview evidence and documented recovery behavior.
- [ ] MCP tools wrapping the same core API.

Contributions: start with a reproducible issue or a focused failing test. Run `npm test` and `npm run demo` before submitting a change. Domain rules, adapters and new state transitions should include an example explaining their behavior.

## License

Apache-2.0. This prototype was written from scratch; no production code or account logs are included.
