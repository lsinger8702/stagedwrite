# Agent tools: provider-neutral TypeScript helpers

[中文](agent-tools.zh-CN.md) · [Design](../design/023-agent-helpers.md) · [Ledger](../tasks/agent-helpers.md)

`createAgentTools` wraps the existing engine with seven tool schemas, runtime validation, host authorization and model-facing results. It does not run an LLM, choose repairs, retry, or create another execution engine.

```ts
import { createAgentTools } from "stagedwrite";

// engine and definition are the same instances/configuration used for your application.
// userId is authenticated by your host, never supplied as a model tool argument.
const agent = createAgentTools({
  engine,
  definition,
  authorize: async ({ tool, input }) => {
    if (tool === "stagedwrite_create") return canCreateDraft(userId);
    return canActOnDraft(userId, input.draftId, tool);
  },
  onError: error => logForOperator(error),
});

// Give the host/model both: field/relationship vocabulary and callable protocols.
const vocabulary = agent.draftDefinition;
const tools = agent.tools; // { name, description, inputSchema }[]; deeply frozen
const result = await agent.dispatch(toolName, parsedToolArguments);
// For a typed application call:
const context = await agent.invoke("stagedwrite_context", { draftId });
```

These are standalone JSON Schema 2020-12 definitions. Map them to your provider's supported tool format; this is not a claim that every provider accepts recursive schema unchanged. `draftDefinition` supplies the registered node fields and relationships, not an unfiltered business-rule catalog. Concrete rule violations arrive in preflight/publish results.

| Tool | Arguments | Returned data |
|---|---|---|
| `stagedwrite_create` | `initialIntent` with nonempty roots | Draft ID/version/full preview and createdRefs |
| `stagedwrite_context` | `draftId` | Current intent preview/version/status/currentRunId; no fresh check |
| `stagedwrite_preview` | `draftId`, `expectedVersion`, `batch` | Candidate preview, changes, proposed refs; no mutation or certificate |
| `stagedwrite_edit` | `draftId`, `expectedVersion`, `batch` | Lightweight edit receipt; explicit preflight remains necessary |
| `stagedwrite_preflight` | `draftId` | Full preview, actual diagnostics and optional suggestions, pending rules, certificate when issued, update field changes |
| `stagedwrite_publish` | `draftId`, `certificate` | Run/noop/not_started state, current/historical markers, preview, diagnostics and step statuses |
| `stagedwrite_resume` | `draftId`, `runId` | Same model-facing execution view; the Run must belong to that Draft |

Every edit still uses `set` / `remove` / `reset` and the existing field/topology channels. Runtime validation checks shapes before authorization or engine access; the engine checks registered fields, coordinate conflicts, expected version, certificates and execution guards. `invoke` checks protocol types at compile time; it does not infer arbitrary business fields from a dynamic schema. `dispatch` accepts unknown arguments and performs the same runtime validation.

## Authorization and outcomes

`authorize` is required and must return exactly true. Bind it to authenticated host context and check both resource ownership and allowed action on every call. After a successful create, persist the returned Draft ID's ownership before enabling later calls. The example's in-memory Set is only a demonstration, not a durable permission store. Models cannot choose a definition, target, credentials or tenant through tool parameters.

An envelope with `ok: true` means the call completed, **not** that publication succeeded. Always inspect `data.status` or `data.state`: blocked, pending, incomplete and unknown retain their engine meanings. A preflight certificate does not replace host authorization. There is no automatic create/preflight/publish chain and no helper-side retry.

For `ok: false`, `error` includes code/message/hint, and structured edit issues when available. On version conflict, read current context and decide a new batch; do not increment expectedVersion and blindly replay. Unclassified backend/adapter exceptions are not echoed to the model; the optional host `onError` sees the original error. An error cannot prove that a remote write had no effect: inspect the same Draft/Run instead of creating a replacement.

Model views exclude raw requests, attempts, keys, remote bindings and stored history. They retain full intent previews and diagnosis suggestions. Your registered rules/adapters remain responsible for what they place in model-visible message/metadata/value fields; arbitrary business text is not automatically secret-redacted. Treat those texts as data, not instructions to change tool permissions.

## Two host examples, one engine

```sh
npm run demo:agent
```

[Host adapters](../../examples/agent-hosts.ts) show an object-based function registry and a JSON-text tool-message transport that preserves call IDs. [The demo](../../examples/agent-demo.ts) alternates between both while creating a populated Draft, receiving a real local rule diagnostic, explicitly editing, checking and publishing to a mock remote. It emits the actual input/output trace, with scripted decisions and no LLM/network call.

[Tests](../../tests/agent-tools.test.ts) run both transports through pending, local suggestions, remote refusal, same-Run repair, unknown reconciliation, subsequent update and no-op. They also verify version conflicts, cross-Draft Run rejection, authorization, input accessors, output filtering and public TypeScript types. CI executes the demo and package-consumer checks too.

A2 will add the bounded Messages API repair loop. A3 will register the same tools in official DSH. Neither is part of this helper's completion claim.
