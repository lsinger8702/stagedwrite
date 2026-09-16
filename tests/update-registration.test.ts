import assert from "node:assert/strict";
import test from "node:test";
import { createStagedWrite, defineDraftType, type ManagedCreateExecutor, type ManagedUpdateExecutor,
    type ManagedExecutor, type ConfirmedApplyOutcome, type ConfirmedReconcileOutcome } from "../src/index.js";
const definition = defineDraftType({ id: "registration.tasks", version: "1", nodeTypes: {
    task: { valueSchema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false } }
}, relationTypes: {} });
const base: ManagedCreateExecutor = {
    type: definition.id, typeVersion: "1", id: "registration", version: "1", target: "test",
    plan: () => [], apply: async () => ({ kind: "applied", remoteRef: "created" }), reconcile: { unsupported: "Read-only example" }
};
const writer: ManagedUpdateExecutor = {
    ...base, updateWrites: true, reconcile: { unsupported: "Explicitly unavailable" },
    update: { inspect: async () => ({ status: "pending", message: "Read in progress" }), plan: () => [] },
    apply: async () => ({ kind: "applied", remoteRef: "created", confirmed: { projectionDigest: "title-v1", values: { title: { kind: "value", value: "A" } } } })
};
// Compile-time regression: tsc must reject a successful write/reconcile without confirmation.
function typeContracts() {
    // @ts-expect-error update applied requires confirmed values
    const badApply: ConfirmedApplyOutcome = { kind: "applied", remoteRef: "r" };
    // @ts-expect-error reconcile applied has the same requirement
    const badReconcile: ConfirmedReconcileOutcome = { kind: "applied", remoteRef: "r" };
    // @ts-expect-error opting into update writes cannot reuse a create-only apply contract
    const badWriter: ManagedExecutor = { ...writer, apply: base.apply };
    // @ts-expect-error update writers require an update request planner
    const noPlanner: ManagedUpdateExecutor = { ...writer, update: { inspect: writer.update.inspect } };
    const notApplied: ConfirmedApplyOutcome = { kind: "not_applied", reason: "Rejected before effect" };
    const unknown: ConfirmedReconcileOutcome = { kind: "unknown", reason: "Still checking" };
    void [badApply, badReconcile, badWriter, noPlanner, notApplied, unknown];
}
void typeContracts;

test("update registration: read-only inspection does not promise update writes", async () => {
    const engine = createStagedWrite({ definitions: [definition], executors: [{ ...base, update: { inspect: writer.update.inspect } }] });
    await engine.close();
});
test("update registration: malformed write capabilities are rejected before any callback", async () => {
    let calls = 0;
    const apply = async () => { calls++; return { kind: "applied" as const, remoteRef: "r" }; };
    for (const e of [
        { ...base, apply, updateWrites: true },
        { ...base, apply, updateWrites: true, update: { inspect: writer.update.inspect } },
        { ...writer, apply, updateWrites: "true" }
    ]) assert.throws(() => createStagedWrite({ definitions: [definition], executors: [e as unknown as ManagedExecutor] }), /INVALID_UPDATE_WRITE_CAPABILITY/);
    assert.equal(calls, 0);
});
test("update registration: explicit writer uses the same engine and preserves confirmed create baseline", async () => {
    const e = createStagedWrite({ definitions: [definition], executors: [{ ...writer,
        plan: d => Object.values(d.graph.nodes).map(n => ({ id: "task", payload: { title: "A" }, effect: { kind: "create", nodeId: n.id } }))
    }] });
    try {
        const { draft } = await e.create({ type: definition.id, typeVersion: "1" }, { roots: [{ nodeType: "task", fields: { title: "A" } }] });
        const check = await e.preflight(draft.id);
        const run = await e.publish(draft.id, check.certificate!);
        assert.equal(run.state, "published");
        assert.equal(run.attempts[0]!.outcome?.kind, "applied");
        const observed = run.attempts[0]!.outcome;
        assert.ok(observed?.kind === "applied" && observed.confirmed);
        await assert.rejects(e.edit(draft.id, draft.version, { patches: [] }), /UPDATE_NOT_SUPPORTED/);
    } finally { await e.close(); }
});
