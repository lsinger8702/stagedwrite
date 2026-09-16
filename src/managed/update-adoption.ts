import { canonicalJson, type Json } from "../registry/json.js";
import { publicationId } from "../execution/publication.js";
import { validateUpdateArtifact } from "./update-evidence.js";
import type { ManagedState, PublicationAdoption } from "./types.js";
const same = (a: unknown, b: unknown) => canonicalJson(a as Json) === canonicalJson(b as Json);
export const noopFactId = (certificate: string, nodeId: string) => JSON.stringify(["noop-publication", certificate, nodeId]);

/** Pure transaction mutation. The caller must hold the Draft lease, perform fresh
 * readback before this transaction, and recheck that readback's local revision here.
 * This does not perform I/O or grant dispatch authority. */
export function adoptUpdate(state: ManagedState, certificate: string, now: string, runId?: string): PublicationAdoption {
    const prior = state.publications[certificate];
    if (prior) {
        if (prior.kind === "noop" && runId !== undefined) throw Error("NOOP_RUN_ID_NOT_ALLOWED");
        if (prior.kind === "run" && runId !== undefined && runId !== prior.runId) throw Error(`RUN_ID_CONFLICT: ${prior.runId}`);
        return structuredClone(prior);
    }
    const a = state.artifacts[certificate], c = state.check, previous = state.draft.currentRunId && state.runs[state.draft.currentRunId];
    if (Object.values(state.runs).some(r => r.state !== "published" || r.attempts.some(a => a.status === "pending" || a.status === "unknown"))) throw Error("UNRESOLVED_RUN_ALREADY_EXISTS");
    if (!a?.update || !previous || !state.draft.publishedArtifactId ||
        a.update.context.basePublishedArtifactId !== state.draft.publishedArtifactId || a.update.context.baseRunId !== state.draft.currentRunId)
        throw Error("UPDATE_BASELINE_REQUIRED");
    if (!c || c.status !== "passed" || c.scope !== "execution" || c.certificate !== certificate ||
        c.version !== state.draft.version || a.draft.version !== state.draft.version || a.resourceRevision !== state.resourceRevision ||
        !same({ graph: a.draft.graph, fieldIntents: a.draft.fieldIntents }, { graph: state.draft.graph, fieldIntents: state.draft.fieldIntents })) throw Error("PREFLIGHT_REQUIRED");
    validateUpdateArtifact(state, a);
    const noop = a.update.slots.every(slot => slot.kind === "noop");
    if (noop) {
        if (runId !== undefined) throw Error("NOOP_RUN_ID_NOT_ALLOWED");
        for (const o of a.update.context.observations) {
            const id = noopFactId(certificate, o.nodeId);
            if (state.remoteFacts[id]) throw Error("FACT_IMMUTABLE");
            state.remoteFacts[id] = { id, nodeId: o.nodeId, targetId: o.targetId, remoteId: o.remoteId,
                projectionDigest: o.projectionDigest, values: structuredClone(o.values),
                source: { kind: "observation", artifactId: certificate, observationId: o.id }, confirmedAt: now };
            state.latestFactByNode[o.nodeId] = id;
        }
        state.resourceRevision++;
        state.publications[certificate] = { kind: "noop", certificate, draftId: state.draft.id, version: state.draft.version, artifactId: certificate, committedAt: now };
        state.draft.status = "published";
        state.draft.publishedArtifactId = certificate;
        state.draft.lastPublishedAt = now; state.draft.updatedAt = now;
    } else {
        if (runId === undefined) throw Error("UPDATE_RUN_ID_REQUIRED");
        publicationId({ runId });
        if (state.runs[runId]) throw Error("RUN_ID_CONFLICT");
        state.runs[runId] = { id: runId, draftId: state.draft.id, kind: "update", version: state.draft.version,
            state: "running", initialArtifactId: certificate, artifactId: certificate, certificate,
            revision: 0, revisions: [], attempts: [], events: [],
            steps: a.plan.map(step => ({ ...structuredClone(step), key: JSON.stringify([runId, step.id, 0]), status: "ready" })) };
        state.publications[certificate] = { kind: "run", certificate, draftId: state.draft.id, version: state.draft.version, runId, adoptedAt: now };
        state.draft.currentRunId = runId; state.draft.status = "pending";
    }
    return structuredClone(state.publications[certificate]!);
}
