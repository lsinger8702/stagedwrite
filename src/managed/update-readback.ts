import { canonicalJson, jsonSnapshot, type Json } from "../registry/json.js";
import type { GraphDiagnostic } from "../preflight/types.js";
import type { Step } from "../types.js";
import type { ManagedState, RemoteObservation } from "./types.js";
import { compileUpdate, validateUpdatePlan, type UpdateCompilation, type UpdateProjection } from "./update-plan.js";

type Passed = Extract<UpdateCompilation, { status: "passed" }>;
export type UpdateReadback =
    | { status: "passed"; compilation: Passed; plan: Step[] }
    | { status: "blocked"; diagnostics: GraphDiagnostic[] };
const same = (a: unknown, b: unknown) => canonicalJson(a as Json) === canonicalJson(b as Json);
const observations = (items: readonly RemoteObservation[]) => items.map(({ id: _id, observedAt: _at, ...evidence }) => evidence).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
const projections = (items: readonly UpdateProjection[]) => [...items].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
const hint = "Run preflight again and review its preview and diagnostics; resume the owning Run if a request is unresolved.";
const blocked = (code: string, message: string): UpdateReadback => ({ status: "blocked", diagnostics: [{ code, message, hint, path: "" }] });

/** Pure pre-dispatch comparison. Inputs must come from the stored checked plan and
 * a fresh inspector/mapper result obtained under the Draft lease, outside a transaction.
 * Passing does not acquire a lease, adopt a certificate, save an Attempt or dispatch.
 * Local ownership must still be rechecked atomically when an execution is adopted.
 */
export function verifyUpdateReadback(state: ManagedState, checked: Passed, checkedPlan: readonly Step[],
    freshProjections: readonly UpdateProjection[], freshObservations: readonly RemoteObservation[], freshPlan: readonly Step[]): UpdateReadback {
    const failures: string[] = [];
    jsonSnapshot({ checked, checkedPlan, freshProjections, freshObservations, freshPlan }, (_path, message) => failures.push(message));
    if (failures.length) return blocked("update.readback_invalid", "The checked plan or fresh readback contains invalid JSON evidence.");
    try {
        // Recompile against the current local state: version, owner, baseline and
        // fact revision are part of the certificate's assumptions, not just values.
        const original = compileUpdate(state, checked.context.projections, checked.context.observations);
        if (original.status !== "passed") return { status: "blocked", diagnostics: original.diagnostics.map(d => ({ ...d, hint: d.hint ?? hint })) };
        if (!same(original, checked)) return blocked("update.check_stale", "The Draft, publication baseline, Run ownership or confirmed facts changed after this check.");
        const oldPlan = validateUpdatePlan(checkedPlan, original, state);
        const fresh = compileUpdate(state, freshProjections, freshObservations);
        if (fresh.status !== "passed") return { status: "blocked", diagnostics: fresh.diagnostics.map(d => ({ ...d, hint: d.hint ?? hint })) };
        // New read IDs/timestamps are provenance, not changed remote conditions.
        // All managed values and remoteVersion remain relevant, including noop nodes.
        if (!same(projections(original.context.projections), projections(fresh.context.projections)) ||
            !same(observations(original.context.observations), observations(fresh.context.observations)))
            return blocked("update.readback_changed", "Remote values, managed-field projection or conditional-write tokens changed after preflight; the old plan cannot be dispatched.");
        const nextPlan = validateUpdatePlan(freshPlan, fresh, state);
        if (!same(oldPlan, nextPlan)) return blocked("update.plan_changed", "The adapter produced a different request plan after preflight; review it through a new check.");
        return structuredClone({ status: "passed", compilation: fresh, plan: nextPlan });
    } catch {
        return blocked("update.readback_invalid", "The checked compilation or request plan does not match the fixed-node update contract.");
    }
}
