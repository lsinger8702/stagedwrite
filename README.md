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

This **draft-only** engine creates and reads empty graphs. `validateValues` checks
filled scalar values without modifying input; it does not interpret clear/reset
intent or enforce `requiredAtPublish`. Graph edits, graph preflight, persistence and
execution integration are future milestones. There is no `publish` method here.

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

## Implemented

- M1 definition assembly, local schema references, immutable version bindings and empty graph creation via `createStagedWrite`.

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
- No compensation, durable storage, Stripe adapter or MCP server yet.
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
- [ ] Graph operations, atomic edit batches and structural validation.
- [ ] Graph-aware preflight diagnostics and repairs.
- [ ] Narrow Stripe test-mode adapter experiment to validate the adapter boundary before storage work.
- [ ] SQLite draft and execution storage with atomic transitions and restart tests.
- [ ] Core MVP example, external trial and release (see [MVP scope](docs/mvp.md)).

After the core MVP:

- [ ] Expand the Stripe experiment with real preview evidence and documented recovery behavior.
- [ ] MCP tools wrapping the same core API.

Contributions: start with a reproducible issue or a focused failing test. Run `npm test` and `npm run demo` before submitting a change. Domain rules, adapters and new state transitions should include an example explaining their behavior.

## License

Apache-2.0. This prototype was written from scratch; no production code or account logs are included.
