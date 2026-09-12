# StagedWrite

An experimental TypeScript library for staged writes from agent tools to external systems.

**Status: local prototype, v0.0.1.** The runnable example uses an in-memory fake remote. It does not call Stripe, charge money, or survive a process restart. No published npm package is available from this repository yet.

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

## Core API

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

- Incomplete drafts; `set`, `remove` (explicit clear), and `reset` (undeclared).
- Atomic in-memory edit batches with expected-version checking.
- Registered synchronous rules returning repair ops or a blocked reason.
- An opaque preflight handle bound server-side to a draft version and frozen plan.
- Sequential execution, per-step keys, remote references and append-only in-memory events.
- Unknown-outcome blocking, reconciliation and explicit resume.
- Single-engine concurrency guard and repeat-publish observation.
- Failure-focused tests and a GitHub Actions workflow.

All diagnostics block publication in this prototype. A repair suggestion is never applied automatically by the engine. Publication seals the draft; create a new draft for a new intent. Repeated `publish` observes the existing run; only `resume` advances it.

## Limits

- Memory only: losing the process loses drafts, execution records and keys. **No crash recovery guarantee.**
- One engine instance, trusted in-process adapters and rules. No multi-worker fencing, authentication, tenants or approval enforcement.
- Simple top-level scalar fields only; no nested paths, arrays, inheritance or general schema validation.
- Preflight does not probe remote state, enforce evidence TTLs or bind authorization. Its certificate is an internal lookup handle, not a signed attestation.
- Adapter results are trusted. `not_applied` must prove the original request cannot still take effect; an empty search result is insufficient.
- A definitive apply rejection stops the run as `failed`; earlier applied steps remain visible and are not rolled back. This label does not mean there were no effects.
- No automatic retry budget, compensation, durable storage, Stripe adapter or MCP server yet.
- Idempotency keys are supplied to adapters; the library cannot make a remote system honor them. No exactly-once claim.

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

- [ ] Versioned draft-type registry and empty graph creation.
- [ ] Graph operations, atomic edit batches and structural validation.
- [ ] Graph-aware preflight diagnostics and repairs.
- [ ] SQLite draft and execution storage with atomic transitions and restart tests.
- [ ] Core MVP example, external trial and release (see [MVP scope](docs/mvp.md)).

After the core MVP:

- [ ] Stripe test-mode adapter using real preview evidence and documented recovery behavior.
- [ ] MCP tools wrapping the same core API.

Contributions: start with a reproducible issue or a focused failing test. Run `npm test` and `npm run demo` before submitting a change. Domain rules, adapters and new state transitions should include an example explaining their behavior.

## License

Apache-2.0. This prototype was written from scratch; no production code or account logs are included.
