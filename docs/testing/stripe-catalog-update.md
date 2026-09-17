# Stripe catalog update acceptance

**2026-09-17: executed against a real Stripe sandbox, using the public StagedWrite API and SQLite on Node 22.23.2.** [Allowlisted recording](../examples/stripe-catalog-update-result.json) · [Run the sample](../../examples/stripe-update/README.md#product--prices-real-refusal-local-repair-and-unchanged-resources).

| Phase | Actual result | Write behavior |
|---|---|---|
| Create graph with initial intent | Product and two Prices published | One Product POST, two Price POSTs; all 200 |
| Edit monthly amount 1000 → 2000 | preflight blocked, no certificate; `STRIPE_PRICE_IMMUTABLE` and `update.immutable_field` | Reads only; no remote amount edit |
| Explicit reset amount | preflight passed; durable noop publication | No POST |
| Edit Product name to empty string | Local preflight passed; actual Stripe update returned 400 for `name` | One refused Product update POST |
| Edit Product name to B; resume | Same update Run published, repaired request uses a new key | One successful update POST; both Prices satisfied without writes |
| Read final resources | Product B; original Price IDs, amounts and Product relationship | Reads only |
| Observe completed Run | published | No HTTP |

38 HTTP calls: 33 GETs and five POSTs. All successful responses were test-mode resources. The 400 was returned by Stripe, not injected. Local rules deliberately did not include the empty-name constraint, so this proves the real-response diagnostic → explicit three-state OP → same-Run repair path. The sample uses no LLM; it does not prove a model can choose the repair.

The adapter keeps original successful responses in a local receipt journal, keyed to the exact request. It never treats present-day equality as proof that an unknown write completed. No remote CAS is established; this sample assumes one writer for managed fields. It does not implement Price replacement, Subscription changes, payments or rollback.

`catalog.test.mjs` executes the scenario offline and checks narrow error classification and mismatched receipts. `catalog-evidence.test.mjs` checks the recorded bytes and source digest without credentials. `record-stripe-catalog-update.mjs` validates the raw trace's call intervals, outcomes, unchanged resource IDs, final values and request keys before exporting selected fields. These guards detect accidental drift; they are not third-party attestation of Stripe authenticity.

The raw local trace contains complete API inputs and outputs. Credentials, account IDs, resource IDs and full HTTP responses are excluded from the committed summary. The existing deterministic HTML/ZIP remains its original mock scenario; it is not relabeled as this live catalog recording.

## Diagnostic coordinates and evidence boundaries

Public diagnostics retain `/nodes/:monthly/fields/amount` and `/nodes/:product/fields/name`. These are documentation aliases, not executable node refs. The exporter derives roles from the original created graph and first verifies each exact original JSON Pointer. Only then does it replace the generated node ref; missing paths, wrong nodes and wrong fields are rejected rather than normalized away.

The frozen record is evidence retained from that dated sandbox run; it does not establish that today's code produces the same results against today's Stripe service. CI exercises today's library against the offline mock and checks the reviewed recording/source digests. It has no Stripe credentials. A new live run is performed with `catalog-run.mjs --allow-test-writes`; `record-stripe-catalog-update.mjs` only validates/exports an existing local trace and makes no Stripe requests. Hashes and a mode label are integrity controls, not independent proof of authenticity.

2026-09-17 export refinement: added the two normalized diagnostic paths from the existing original trace. No live request was repeated, and recordedAt/sampleSourceDigest remain unchanged. The reviewed-byte digest changed only after inspecting that two-field export diff.
