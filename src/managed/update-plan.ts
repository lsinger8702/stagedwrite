import { validatePlan } from "../execution/plan.js";
import { canonicalJson, jsonSnapshot, pointer, type Json } from "../registry/json.js";
import type { GraphDiagnostic } from "../preflight/types.js";
import type { ManagedState, NormalizedValue, RemoteObservation } from "./types.js";

/** Adapter output, not a generic mapping from graph values to HTTP bodies. */
export interface UpdateProjection {
    nodeId: string;
    projectionDigest: string;
    fields: Record<string, {
        /** Top-level field pointer within the node. */
        path: string;
        writable: boolean;
        /** Required for set/remove; absent for undeclared intent. */
        desired?: NormalizedValue;
        /** Explicit remote representation of remove, if supported. */
        clearValue?: NormalizedValue;
    }>;
}
export interface UpdateSlot {
    nodeId: string;
    remoteId: string;
    kind: "update" | "noop";
    changes: { field: string; path: string; before: NormalizedValue; after: NormalizedValue }[];
    observationId: string;
    factId: string;
}
export interface UpdateCompileContext {
    draftId: string;
    version: number;
    resourceRevision: number;
    basePublishedArtifactId: string;
    baseRunId: string | null;
    targetId: string;
    observations: readonly RemoteObservation[];
    projections: readonly UpdateProjection[];
}
export type UpdateCompilation =
    | { status: "blocked"; diagnostics: GraphDiagnostic[] }
    | { status: "passed"; diagnostics: GraphDiagnostic[]; context: UpdateCompileContext; slots: UpdateSlot[] };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function normalized(v: unknown): v is NormalizedValue {
    if (!record(v)) return false;
    if (v.kind === "absent") return Object.keys(v).length === 1;
    return v.kind === "value" && Object.keys(v).length === 2 && Object.hasOwn(v, "value") &&
        (v.value === null || typeof v.value === "string" || typeof v.value === "boolean" || typeof v.value === "number" && Number.isFinite(v.value));
}
const equalValue = (a: NormalizedValue, b: NormalizedValue) => a.kind === b.kind && (a.kind === "absent" || b.kind === "value" && a.value === b.value);
const same = (a: unknown, b: unknown) => canonicalJson(a as Json) === canonicalJson(b as Json);
const nodePath = (id: string) => `/nodes/${pointer(id)}`;

/** Pure internal compiler. No I/O, certificates, stored facts, or permission to dispatch. */
export function compileUpdate(state: ManagedState, projections: readonly UpdateProjection[], observations: readonly RemoteObservation[]): UpdateCompilation {
    const diagnostics: GraphDiagnostic[] = [];
    const issue = (code: string, path: string, message: string) => diagnostics.push({ code: `update.${code}`, path, message });
    const blocked = (): UpdateCompilation => structuredClone({ status: "blocked", diagnostics });
    // Validate callback data before inspecting fields (no getters, non-finite values or prototypes).
    jsonSnapshot({ projections, observations }, (_path, message) => issue("invalid_input", "", message));
    if (diagnostics.length) return blocked();
    if (!Array.isArray(projections) || !Array.isArray(observations)) { issue("invalid_input", "", "Projections and observations must be arrays."); return blocked(); }
    const d = state.draft, baseline = d.publishedArtifactId ? state.artifacts[d.publishedArtifactId] : undefined;
    if (!baseline || !d.targetId) { issue("baseline_missing", "", "A fully published baseline and a bound target are required for update."); return blocked(); }
    const original = baseline.draft;
    if (!same(Object.keys(d.graph.nodes).sort(), Object.keys(original.graph.nodes).sort()) || !same(d.graph.edges, original.graph.edges) ||
        Object.keys(d.graph.nodes).some(id => d.graph.nodes[id]!.nodeType !== original.graph.nodes[id]?.nodeType)) {
        issue("topology_changed", "", "This update supports field changes only; keep the published nodes, types and edges."); return blocked();
    }
    // Inspect all history, not just the pointer: a corrupt pointer cannot hide an unresolved request.
    if (Object.values(state.runs).some(r => r.attempts.some(a => a.status === "pending" || a.status === "unknown"))) {
        issue("unresolved_request", "", "Resume the owning Run to resolve its original request before compiling new writes. Matching remote values do not prove that request has finished."); return blocked();
    }
    const byNode = new Map<string, UpdateProjection>(), observed = new Map<string, RemoteObservation>();
    for (const p of projections as readonly UpdateProjection[]) {
        if (!record(p) || typeof p.nodeId !== "string" || !d.graph.nodes[p.nodeId] || byNode.has(p.nodeId) || !record(p.fields) || typeof p.projectionDigest !== "string" || !p.projectionDigest) {
            issue("projection_invalid", "", "Supply exactly one valid projection per existing node."); continue;
        }
        byNode.set(p.nodeId, p);
    }
    const observationIds = new Set<string>();
    for (const o of observations as readonly RemoteObservation[]) {
        if (!record(o) || typeof o.nodeId !== "string" || !d.graph.nodes[o.nodeId] || observed.has(o.nodeId) || typeof o.id !== "string" || !o.id || observationIds.has(o.id) || !record(o.values) || (o.remoteVersion !== undefined && typeof o.remoteVersion !== "string") || typeof o.observedAt !== "string" || !Number.isFinite(Date.parse(o.observedAt))) {
            issue("observation_invalid", "", "Supply one uniquely identified, dated remote observation per existing node."); continue;
        }
        observationIds.add(o.id); observed.set(o.nodeId, o);
    }
    const slots: UpdateSlot[] = [];
    for (const id of Object.keys(d.graph.nodes).sort()) {
        const path = nodePath(id), p = byNode.get(id), o = observed.get(id), b = state.bindings[id];
        const factId = state.latestFactByNode[id], fact = factId ? state.remoteFacts[factId] : undefined;
        if (!p || !o || !b || !fact) { issue("evidence_missing", path, "Update requires a projection, an existing resource binding, a confirmed baseline fact and a fresh observation for this node."); continue; }
        if (b.nodeId !== id || b.targetId !== d.targetId || o.remoteId !== b.remoteId || o.targetId !== b.targetId || fact.nodeId !== id || fact.remoteId !== b.remoteId || fact.targetId !== b.targetId) {
            issue("identity_mismatch", path, "The observation and confirmed fact must refer to this node's original bound remote resource."); continue;
        }
        if (p.projectionDigest !== fact.projectionDigest || p.projectionDigest !== o.projectionDigest) {
            issue("projection_mismatch", path, "The desired, confirmed and observed values use different projection definitions; they cannot be compared safely."); continue;
        }
        const fields = Object.keys(p.fields).sort();
        if (!same(fields, Object.keys(fact.values).sort()) || !same(fields, Object.keys(o.values).sort())) {
            issue("field_scope_mismatch", path, "Managed field coverage changed or evidence is missing. Missing evidence is not an absent remote value."); continue;
        }
        const mappedPaths = new Set(Object.values(p.fields).filter(record).map(f => f.path));
        const currentIntents = d.fieldIntents[id] ?? {}, oldIntents = original.fieldIntents[id] ?? {};
        for (const path of new Set([...Object.keys(currentIntents), ...Object.keys(oldIntents)])) {
            if (!same(currentIntents[path] ?? null, oldIntents[path] ?? null) && !mappedPaths.has(path))
                issue("unmapped_intent", `${nodePath(id)}/fields${path}`, "Changed author intent is not covered by the adapter's managed field projection.");
        }
        const changes: UpdateSlot["changes"] = [];
        for (const field of fields) {
            const f = p.fields[field]!;
            if (!record(f) || typeof f.path !== "string" || !/^\/(?:[^~/]|~0|~1)+$/.test(f.path) || typeof f.writable !== "boolean") {
                issue("field_mapping_invalid", path, "Each managed field needs a top-level graph field pointer and an explicit writable flag."); continue;
            }
            const at = `${path}/fields${f.path}`, intent = d.fieldIntents[id]?.[f.path];
            const B = fact.values[field], O = o.values[field];
            if (!normalized(B) || !normalized(O) || f.desired !== undefined && !normalized(f.desired) || f.clearValue !== undefined && !normalized(f.clearValue)) {
                issue("value_invalid", at, "Expected a finite scalar value or an explicit absent state; null and absent are different."); continue;
            }
            let D: NormalizedValue;
            if (!intent) {
                if (f.desired !== undefined) { issue("undeclared_write", at, "This field has no author declaration; the adapter must not supply an implicit write target."); continue; }
                D = B;
            } else {
                if (!f.desired) { issue("target_missing", at, "The declared intent has no normalized remote target."); continue; }
                D = f.desired;
                if (intent.kind === "remove" && (!f.clearValue || !equalValue(D, f.clearValue))) {
                    issue("clear_unsupported", at, "Explicit remove requires the adapter's supported clear representation; it cannot be omitted."); continue;
                }
            }
            if (equalValue(D, O)) continue;
            if (!equalValue(B, O)) {
                diagnostics.push({ code: "update.drift", path: at,
                    message: `Remote field ${field} differs from both the confirmed baseline and the desired state. Recheck the external change before publishing.`,
                    metadata: { baseline: B as unknown as Json, desired: D as unknown as Json, observed: O as unknown as Json },
                }); continue;
            }
            if (!f.writable) { issue("immutable_field", at, `Remote field ${field} cannot be updated in place; resource replacement is outside this release.`); continue; }
            changes.push({ field, path: at, before: O, after: D });
        }
        slots.push({ nodeId: id, remoteId: b.remoteId, kind: changes.length ? "update" : "noop", changes, observationId: o.id, factId: factId! });
    }
    if (diagnostics.length) return blocked();
    return structuredClone({ status: "passed", diagnostics, context: {
        draftId: d.id, version: d.version, resourceRevision: state.resourceRevision, basePublishedArtifactId: d.publishedArtifactId!,
        baseRunId: d.currentRunId, targetId: d.targetId, observations, projections,
    }, slots });
}

/** Validate adapter request mapping without constructing or executing remote requests. */
export function validateUpdatePlan(output: unknown, compilation: Extract<UpdateCompilation, { status: "passed" }>, state: ManagedState): import("../types.js").Step[] {
    const steps = validatePlan(output, "update");
    const baseline = state.artifacts[compilation.context.basePublishedArtifactId];
    if (!baseline || steps.length !== compilation.slots.length || baseline.plan.length !== steps.length) throw new Error("UPDATE_PLAN_TOPOLOGY");
    const slots = new Map(compilation.slots.map(slot => [slot.nodeId, slot]));
    const seen = new Set<string>();
    for (const [index, step] of steps.entries()) {
        const slot = slots.get(step.effect.nodeId), prior = baseline.plan[index]!;
        if (!slot || seen.has(slot.nodeId) || step.effect.kind !== slot.kind || step.effect.remoteId !== slot.remoteId)
            throw new Error("UPDATE_EFFECT_MISMATCH");
        if (step.id !== prior.id || step.effect.nodeId !== prior.effect.nodeId || !same(step.dependsOn ?? [], prior.dependsOn ?? []))
            throw new Error("UPDATE_PLAN_TOPOLOGY");
        seen.add(slot.nodeId);
    }
    return steps;
}
