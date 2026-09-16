import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite, createMemoryBackend, createSqliteBackend } from "../src/index.js";
import type { ManagedDraft } from "../src/managed/types.js";

const selector = { type: "json-preview", typeVersion: "1" };
const definition = { id: selector.type, version: "1", nodeTypes: { task: { valueSchema: {
    type: "object", additionalProperties: false,
    $defs: { profile: { type: "object", properties: { name: { type: "string" }, note: { type: ["string", "null"] } }, additionalProperties: false } },
    properties: { profile: { $ref: "#/$defs/profile" }, items: { type: "array", items: { type: "string" } }, "a/b~c": { type: ["string", "null"] }, absent: { type: "string" } }
} } }, relationTypes: {} };

for (const sqlite of [false, true]) test(`${sqlite ? "sqlite" : "memory"}: managed JSON intent survives read, preflight and publication previews`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-json-preview-")), path = join(dir, "state.sqlite");
    const backend = sqlite ? createSqliteBackend(path) : createMemoryBackend();
    let ref: string, draft: ManagedDraft;
    let asyncCalls = 0;
    const engine = createStagedWrite({ definitions: [definition], ...backend,
        asyncRules: [{ ...selector, id: "inspect-json", version: "1", check: async d => {
            asyncCalls++;
            assert.deepEqual(d.graph.nodes[ref]!.fields.profile, { name: "C" });
            assert.deepEqual(d.fieldIntents[ref]!["/profile/note"], { kind: "remove" });
            return { status: "complete", diagnostics: [] };
        } }],
        executors: [{ ...selector, id: "json-adapter", version: "1", target: "mock:json",
            plan: d => [{ id: "task", payload: { body: JSON.stringify(d.graph.nodes[ref]!.fields) }, effect: { kind: "create", nodeId: ref } }],
            apply: async step => { assert.deepEqual(JSON.parse(String(step.payload.body)), draft.graph.nodes[ref]!.fields); return { kind: "applied", remoteRef: "remote-task" }; },
            reconcile: { unsupported: "Not needed by this test" }
        }]
    });
    try {
        const created = await engine.create(selector, { roots: [{ nodeType: "task", fields: { profile: { name: "A", note: null }, items: ["one", "two"], "a/b~c": null } }] });
        ref = created.createdRefs[0]!.ref;
        await engine.edit(created.draft.id, 0, { patches: [
            { op: "remove", ref, scope: "canonical", path: "/profile" },
            { op: "set", ref, scope: "canonical", path: "/profile/name", value: "C" }
        ] });
        draft = await engine.getDraft(created.draft.id);
        assert.equal(draft.version, 1);
        const check = await engine.preflight(draft.id);
        assert.equal(check.status, "passed"); assert.equal(check.formatVersion, 3); assert.equal(asyncCalls, 1);
        const fields = check.preview.nodes[ref]!.fields;
        assert.deepEqual(fields, {
            "/profile": { kind: "value", value: { name: "C" } }, "/profile/name": { kind: "value", value: "C" },
            "/profile/note": { kind: "clear" }, "/items": { kind: "value", value: ["one", "two"] },
            "/a~1b~0c": { kind: "value", value: null }, "/absent": { kind: "undeclared" }
        });
        assert.equal("/items/0" in fields, false);
        const run = await engine.publish(draft.id, check.certificate!);
        assert.equal(run.state, "published");
        assert.deepEqual(run.preview.nodes[ref]!.fields, fields);
        assert.deepEqual((await engine.getRun(run.id)).preview.nodes[ref]!.fields, fields);
        if (sqlite) {
            const reopened = createSqliteBackend(path);
            try { assert.deepEqual((await reopened.storage.read(draft.id))!.check!.preview.nodes[ref]!.fields, fields); }
            finally { await reopened.storage.close(); }
        }
        fields["/items"] = { kind: "value", value: ["tampered"] };
        assert.deepEqual((await engine.getDraft(draft.id)).graph.nodes[ref]!.fields.items, ["one", "two"]);
    } finally { await engine.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("public nested edit: targeted remote repair updates one coordinate and resumes the same Run", async () => {
    const requests: unknown[] = [];
    let ref: string;
    const engine = createStagedWrite({ definitions: [definition], executors: [{ ...selector, id: "nested-repair", version: "1", target: "mock:repair",
        plan: d => [{ id: "task", payload: { body: JSON.stringify(d.graph.nodes[ref]!.fields) }, effect: { kind: "create", nodeId: ref } }],
        apply: async step => {
            const body = JSON.parse(String(step.payload.body)); requests.push(body);
            return body.profile.name === "reserved" ? { kind: "not_applied", reason: "Reserved name", diagnostics: [{
                code: "name.reserved", path: `/nodes/${step.effect.nodeId}/fields/profile/name`, message: "Choose another profile name.",
                candidates: [{ value: "fixed", repairOps: { patches: [{ op: "set", ref, scope: "canonical", path: "/profile/name", value: "fixed" }] } }]
            }] } : { kind: "applied", remoteRef: "created-task" };
        }, reconcile: { unsupported: "This adapter provides definitive rejection in the test" }
    }] });
    try {
        const { draft, createdRefs } = await engine.create(selector, { roots: [{ nodeType: "task", fields: { profile: { name: "initial" } } }] });
        ref = createdRefs[0]!.ref;
        await engine.edit(draft.id, 0, { patches: [{ op: "set", ref, scope: "canonical", path: "/profile", value: { name: "reserved", note: "keep" } }, { op: "set", ref, scope: "canonical", path: "/items", value: ["one"] }] });
        const check = await engine.preflight(draft.id), first = await engine.publish(draft.id, check.certificate!);
        assert.equal(first.state, "blocked");
        const repair = first.diagnostics[0]!.candidates![0]!.repairOps!;
        assert.equal(repair.patches![0]!.path, "/profile/name");
        await engine.edit(draft.id, first.preview.version, repair);
        const resumed = await engine.resume(first.id);
        assert.equal(resumed.id, first.id); assert.equal(resumed.state, "published");
        assert.deepEqual(requests, [{ profile: { name: "reserved", note: "keep" }, items: ["one"] }, { profile: { name: "fixed", note: "keep" }, items: ["one"] }]);
        assert.equal(resumed.attempts.length, 2);
        assert.deepEqual(resumed.preview.nodes[ref]!.fields["/profile/note"], { kind: "value", value: "keep" });
        await assert.rejects(engine.edit(draft.id, 2, repair), /UPDATE_NOT_SUPPORTED/);
    } finally { await engine.close(); }
});
