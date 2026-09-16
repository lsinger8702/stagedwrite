import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType, type GraphDiagnostic } from "../src/index.js";
import { DefinitionRegistry } from "../src/registry/registry.js";
import { GraphPreflight } from "../src/preflight/check.js";
import { AsyncPreflight } from "../src/preflight/async.js";
import { performance } from "node:perf_hooks";

// Observe the actual candidate checked against the schema: a reset suggestion
// must mean exactly what the user's edit/preview means, not clear-to-undeclared.
test("preflight: candidate reset validation uses the fixed baseline in both rule channels", async () => {
    const definition = defineDraftType({ id: "reset-check", version: "1", nodeTypes: { item: {
        valueSchema: { type: "object", properties: { name: { type: "string" }, note: { type: ["string", "null"] } }, additionalProperties: false }
    } }, relationTypes: {} });
    const selector = { type: definition.id, typeVersion: definition.version };
    const engine = createStagedWrite({ definitions: [definition] });
    try {
        const created = await engine.create(selector, { nodes: { a: { id: "a", nodeType: "item", fields: { name: "original", note: null } } }, edges: {} });
        await engine.edit(created.id, 0, { patches: [{ op: "set", ref: "a", scope: "canonical" as const, path: "/name", value: "edited" }, { op: "remove", ref: "a", scope: "canonical" as const, path: "/note" }] });
        const draft = await engine.getDraft(created.id);
        const ops = { patches: [{ op: "reset" as const, ref: "a", scope: "canonical" as const, path: "/name" }, { op: "reset" as const, ref: "a", scope: "canonical" as const, path: "/note" }] };
        const expected = (await engine.preview(draft.id, draft.version, ops)).candidate.graph.nodes.a!.fields;
        const diagnostic: GraphDiagnostic = { code: "example.restore", path: "/nodes/a", message: "Consider restoring the original intent.", repairs: [{ message: "Restore initial values.", ops }] };
        const registry = new DefinitionRegistry([definition]);
        const observed: unknown[] = [];
        const validate = registry.validateValues.bind(registry);
        registry.validateValues = (...args) => { observed.push(structuredClone(args[2])); return validate(...args); };
        const sync = new GraphPreflight(registry, [{ ...selector, id: "sync", version: "1", check: () => [diagnostic] }]);
        const result = sync.run(draft, draft.initialSnapshot);
        assert.deepEqual(observed.at(-1), expected);
        observed.length = 0;
        const asyncCheck = new AsyncPreflight(registry, [], [{ ...selector, id: "async", version: "1", check: async () => ({ status: "complete", diagnostics: [diagnostic] }) }], 5000);
        await asyncCheck.run(draft, result, performance.now() + 5000, draft.initialSnapshot);
        assert.equal(result.status, "blocked");
        assert.equal(result.diagnostics.length, 2);
        assert.deepEqual(observed.at(-1), expected);
        assert.deepEqual(expected, { name: "original", note: null });
        assert.deepEqual(await engine.getDraft(draft.id), draft);
    } finally { await engine.close(); }
});
