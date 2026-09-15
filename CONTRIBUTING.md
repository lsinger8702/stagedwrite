# Contributing

Start with the [project principles](docs/design/000-project-principles.md) and the relevant design. Proposals that change established lifecycle or recovery semantics need discussion before implementation. Small fixes, examples and documentation improvements are welcome.

## Local checks

Use Node.js 22.13+:

```sh
npm ci
npm test
npm run test:stripe
npm run verify:walkthrough
npm run verify:package
```

The Stripe tests use a fake HTTP boundary and require no account. Live sandbox tests are optional, explicitly enabled and documented in [the example](examples/stripe/README.md). Do not put a Stripe key in a pull request or a CI configuration. Never run tests against live payment data.

## Pull requests

Explain the concrete problem, resulting behavior, and checks run. Add regression coverage when changing execution or recovery behavior. State whether an integration was tested offline or against a real sandbox; distinguish injected faults from observed remote failures.

Keep changes scoped. Samples belong under `examples/`; the library should not acquire a provider dependency just to demonstrate an integration. No proprietary code, private reviews, personal paths, credentials, raw account exports or local databases belong in a pull request.

`npm run demo:html` regenerates the fictional walkthrough and offline bundle together. `npm run verify:walkthrough` checks their consistency. A Stripe live result is a historical observation, not a deterministic CI fixture: follow its guide to regenerate an identity-free summary and review the diff before including it.
