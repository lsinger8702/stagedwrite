# Agent input schemas

`stagedwrite` exports `initialIntentSchema` and `editBatchSchema` as standalone JSON Schema 2020-12 documents. They describe the payloads of the existing engine methods. They are not model-specific tool envelopes, an Agent loop, or a second engine.

| Export | Engine argument | Shape |
|---|---|---|
| `initialIntentSchema` | Second argument of `create(selector, initial)` | Nonempty `roots`; nested specs with initial `fields`; no existing refs or clones |
| `editBatchSchema` | Third argument of `edit(draftId, version, batch)` or `preview(...)` | `graphPatches` / `patches`; only `set`, `remove`, `reset` |

The host selects the definition, authorizes access to the Draft and supplies its current version. Node refs come from `createdRefs` or the current preview; they are not remote IDs. An accepted edit invalidates the old check. An unfinished publication continues through `resume` on the existing Run.

## Validate model output, then call the engine

This example uses Ajv 2020. The application supplies the configured engine and current Draft identity/version. `raw` is the parsed JSON chosen by the caller or model, not an automatically applied rule suggestion.

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  editBatchSchema, initialIntentSchema, EditInputError,
  type EditBatch, type InitialIntent,
} from "stagedwrite";

const ajv = new Ajv2020({ strict: false });
const isInitial = ajv.compile<InitialIntent>(initialIntentSchema);
const isBatch = ajv.compile<EditBatch>(editBatchSchema);

// In the application's existing authorized handlers:
async function createFromJson(raw: unknown) {
  if (!isInitial(raw)) return {
    code: "INVALID_INITIAL_INPUT", message: "Initial intent has an invalid shape.",
    hint: "Supply nonempty roots with nodeType and initial fields; do not supply node IDs.",
    issues: structuredClone(isInitial.errors),
  };
  return engine.create(selector, raw); // {draft, createdRefs}
}

async function editFromJson(raw: unknown, draftId: string, expectedVersion: number) {
  if (!isBatch(raw)) return {
    code: "INVALID_EDIT_INPUT", message: "The edit batch has an invalid shape.",
    hint: "Use graphPatches/patches with set, remove or reset; field patches require canonical scope.",
    issues: structuredClone(isBatch.errors),
  };
  try {
    return await engine.edit(draftId, expectedVersion, raw);
  } catch (error) {
    if (error instanceof EditInputError) return error.toJSON();
    throw error; // Other host/engine failures go through the application's error handler.
  }
}
```

A host can also validate `diagnostics[].candidates[].repairOps` and `diagnostics[].repairs[].ops` with `editBatchSchema`. Suggestions remain optional: choose a batch using the current preview and user intent. An earlier suggestion may be stale or blocked by Run protection by the time it is submitted.

## What structural validation does not prove

The schema does not know the registered business schema, existing refs, owned/reference relations, the fixed reset baseline, the current version or execution facts. For example, two `set` entries for the same `(ref, scope, path)` can pass JSON Schema but the engine rejects the entire batch with `PATCH_SELF_CONFLICT`, `message` and `hint`. A value with the wrong business type can pass the generic JSON shape and still be rejected by the registered node schema.

Only the engine decides whether an edit is valid. A structural pass, a successful preview, or a repair suggestion is not a publication certificate. `unknown` cannot be resolved by changing the Draft or by having the model recommend a retry.

The exported objects are deeply frozen. Use `structuredClone` for provider-specific transformations. Each document contains local `#/$defs/...` references: validate it as a document. Simply nesting it under a tool's `properties.batch` changes the reference root and can break those references; a host composing envelopes must preserve or rewrite the reference scope. These documents are not a promise that every model provider accepts the full JSON Schema dialect.

## Executed examples

[Public schema integration tests](../../tests/public-tool-schema.test.ts) exercise JSON input through the actual create/edit/preflight methods, optional diagnostic repair batches, duplicate-coordinate rejection and immutable exports. [Package consumer checks](../../scripts/package-smoke.mjs) compile both schemas from an isolated installed tarball, including TypeScript imports.

The [walkthrough](../../examples/publish-and-resume.ts) shows the complete publish/repair/resume lifecycle. Generic controlled dispatch helpers and model-specific harnesses remain separate roadmap work; these schema exports do not implement them.
