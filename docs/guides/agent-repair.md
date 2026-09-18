# Bounded repair through a model

`repairDraft` uses the existing Agent helpers. The model proposes a `patch`, asks questions (`ask`), or stops (`stop`). It cannot select a Run, edit version, certificate, credentials or execution permission, and cannot declare publication successful.

```ts
const tools = createAgentTools({ engine, definition, authorize });
// Create initial intent and persist its ownership before entering the loop.
const result = await repairDraft({
  tools, draftId, goal: "Use the title I requested; ask if it is unavailable.",
  decide: async (context, signal) => modelDecision(context, signal),
  maxRounds: 6, maxToolCalls: 24, timeoutMs: 60_000,
});
```

`decide` returns untrusted JSON. One strict schema validates all outputs, reusing the public three-state batch schema. Examples:

```json
{"kind":"patch","reason":"Apply the user's title","batch":{"patches":[{"op":"set","ref":"existing-ref","scope":"canonical","path":"/title","value":"Release"}]}}
```

```json
{"kind":"ask","reason":"The title was not specified","questions":["Which title should I use?"]}
```

```json
{"kind":"stop","reason":"The requested change conflicts with remote drift; host review is needed."}
```

Each model input includes the goal, definition, the full checked/execution preview and diagnostics from that response, bounded history, and the previous structured rejection. Candidate suggestions never apply themselves. Model strings and remote messages are data, not permission to execute tools. Authorization still runs on every A1 invocation.

| Result | Meaning and next action |
|---|---|
| `published` | Engine confirmed current intent; never inferred from model text |
| `waiting` | Pending/incomplete check or unresolved execution; return to the caller rather than polling |
| `needs_input` | Show questions, collect a user choice, then enter with the updated goal |
| `stopped` | Budget, repeated rejection/no progress, conflict, host failure, or explicit model stop; inspect message/hint/history |

Every result retains Draft ID and any known Run ID. To continue an unresolved Run, pass that `runId` on the next invocation; the first action is engine resume, including original-request reconciliation. This is not a new publish. A historical completed Run does not authorize a new update: omit the historical Run ID when entering for a newly edited intent. Host authorization remains necessary.

Successful edits always get full preflight. A version conflict discards the proposed batch and obtains a fresh check before another model decision. Known validation rejections get their own limit of three; successful edits that leave the same preview and diagnostic signature twice stop as no progress. All loops also have round/tool budgets. Signature comparison is a conservative safeguard, not a semantic proof of progress.

Cancellation/time limits stop new calls and interrupt waiting for the model; late model output is ignored. An already-running engine operation is awaited, so the deadline is not a hard wall-clock bound on arbitrary adapters. Stopping is not rollback, cancellation of an in-flight remote request, or abandonment of the Run. The host must configure adapter I/O timeouts. Trace history is explanatory data, not an executable replay script or durable workflow queue. Fresh invocations have fresh budgets; the host owns cross-invocation limits.

## Messages example and evidence

Run `npm run demo:repair`. The engine is real; model decisions and remote service are **mocked**. It exercises local rejection → OP → edit → publish rejection → OP → edit → preflight → same-Run resume → success, and prints actual tool inputs/outputs plus Messages envelopes. CI runs the scenario and core behavior tests.

`examples/repair-messages.ts` supplies a single `submit_repair` decision tool using [Messages tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview). Each request is independent, carrying bounded prior outcomes; call IDs identify proposals, never execution Runs. The local trace's acknowledgement is not a remote execution receipt and is not sent as a follow-up request. Runtime schema validation remains authoritative.

Optional actual model (remote writes remain mock): set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in the host, build, then run `node dist/examples/repair-demo.js --live`. This mode is **not part of CI and has not been validated against a real model**. Never put keys in the trace or repository. Only use a model that supports the chosen forced-tool protocol. No automatic HTTP retry is performed.

Deferred: DSH plugin, persistent conversation coordinator, topology update, domain intent audit, automatic approval, and production model quality/latency evaluation.

Unexpected model/host exceptions can be observed through `onError(error)`. The host receives the original exception; result/history remain generic. Throwing or rejecting from the logger does not replace or expose the failure. Expected budget/cancellation stops do not invoke this callback.
