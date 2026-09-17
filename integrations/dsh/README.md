# Official DSH registration adapter (A3.1)

This is an isolated integration example, not part of the core npm package. Tested with official npm packages `@deepseek-ai/dsh-tools@0.1.0-rc.7`, `@deepseek-ai/cordis@4.0.1`, and `@deepseek-ai/dsh-system-prompt@0.1.0-rc.8`; transitive versions are pinned in package-lock.json. Reference source revision: `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` of https://github.com/deepseek-ai/deepseek-harness. Do not infer support for other preview releases.

From the repository root:

```sh
npm run build
npm ci --prefix integrations/dsh --ignore-scripts
npm test --prefix integrations/dsh
```

Mount `plugin.mjs` in a Cordis context with the official `tools` service:

```js
const fiber = ctx.plugin(stagedwritePlugin, {
  toolset, // host-bound A1 definition and schemas
  forExecution: async execution => {
    // Resolve authenticated ownership from trusted host/agent context, NOT model args.
    return authorizedAgentToolsFor(execution);
  },
  onError: error => hostLogger(error),
});
await fiber;
// Later: await fiber.dispose();  // unmount tools; does not abandon Runs
```

Every selected toolset must use the same definition as the registered vocabulary. The callback must return an A1 helper with actual per-user authorization; never blindly share an allow-all helper in a multi-tenant host. The test's allow-all helper is for its isolated single-user fixture only. No fallback to environment tenant/session IDs is provided.

DSH receives its supported schema subset: references are expanded, generic JSON and relation maps remain open at this boundary, and unsupported range/pattern/array-length/anyOf constraints remain enforced by A1 before engine access. The adapter does **not** promise equivalent schema validation in DSH; it promises every invocation still enters the original validator. All OP discriminants remain set/remove/reset. Results preserve the A1 envelope as canonical JSON and render it as text; `ok: true` is not a publication-success claim.

Cancellation before dispatch prevents work. Started engine operations are awaited rather than abandoned. No timeout declaration or concurrency-safe opt-in is supplied; engine leases/CAS remain authoritative. Registration failure removes earlier registrations; normal unmount follows Cordis ownership. The host owns engine shutdown and must wait for active operations.

What is verified: real Cordis mount/unmount; seven real DSH registrations; DSH execute → A1 → actual engine create/context; A1 rejects constraints relaxed by the outer schema. A separate unit test checks registration rollback and private authorization-error handling.

**Not yet verified:** an actual DSH agent/session, session fork/restart authorization, model-directed repair, or a DSH execution lifecycle spanning publish/unknown/resume. See ../../docs/tasks/dsh.md. Do not embed the A2 repair loop in these tools: DSH owns its model loop.
