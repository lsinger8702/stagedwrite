import type { ManagedState } from "./types.js";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function requireState(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

/** Shared by every built-in backend; storage validity is not an engine shortcut. */
export function validateState(id: string, s: ManagedState) {
    requireState(s.draft.id === id && s.draft.formatVersion === 3, "STATE_IDENTITY_MISMATCH");
    requireState(s.remoteFacts && s.latestFactByNode && s.publications, "STATE_FORMAT_UNSUPPORTED");
    const runs = Object.values(s.runs), active = runs.filter(r => r.state !== "published");
    requireState(runs.filter(r => r.kind === "initial_create").length <= 1, "INITIAL_RUN_ALREADY_EXISTS");
    requireState(active.length <= 1, "UNRESOLVED_RUN_ALREADY_EXISTS");
    requireState(!active.length || active[0]!.id === s.draft.currentRunId, "RUN_POINTER_MISMATCH");
    requireState(!s.draft.currentRunId || s.runs[s.draft.currentRunId], "RUN_POINTER_MISMATCH");
    for (const [rid, r] of Object.entries(s.runs)) {
        requireState(r.id === rid && r.draftId === id && ["initial_create", "update"].includes(r.kind), "RUN_IDENTITY_MISMATCH");
        requireState(s.artifacts[r.artifactId] && s.artifacts[r.initialArtifactId], "RUN_INPUT_MISSING");
        for (const a of r.attempts) requireState(a.request && a.request.step.id === a.stepId && same(a.request.step.payload, a.input) && a.request.target === s.artifacts[r.initialArtifactId]!.binding.target, "ATTEMPT_REQUEST_MISMATCH");
        requireState(r.revisions.every(v => s.artifacts[v.artifactId]), "RUN_INPUT_MISSING");
        requireState(r.state !== "published" || !r.attempts.some(a => a.status === "pending" || a.status === "unknown"), "UNRESOLVED_PUBLICATION");
    }
    for (const [aid, a] of Object.entries(s.artifacts))
        requireState(a.id === aid && a.draft.id === id, "ARTIFACT_IDENTITY_MISMATCH");
    requireState(!s.draft.publishedArtifactId || s.artifacts[s.draft.publishedArtifactId], "PUBLISHED_INPUT_MISSING");
    const remotes = new Set<string>();
    for (const [node, b] of Object.entries(s.bindings)) {
        requireState(node === b.nodeId && s.draft.graph.nodes[node] && b.targetId === s.draft.targetId, "BINDING_IDENTITY_MISMATCH");
        const key = JSON.stringify([b.targetId, b.remoteId]);
        requireState(!remotes.has(key), "REMOTE_BINDING_CONFLICT"); remotes.add(key);
    }
    for (const [fid, f] of Object.entries(s.remoteFacts)) {
        const b = s.bindings[f.nodeId];
        requireState(fid === f.id && b && b.remoteId === f.remoteId && b.targetId === f.targetId, "FACT_IDENTITY_MISMATCH");
        if (f.source.kind === "attempt") {
            const source = f.source, r = s.runs[source.runId];
            const a = r?.attempts.find(x => x.stepId === source.stepId && x.number === source.attemptNumber);
            requireState(a?.status === "applied" && a.outcome?.kind === "applied" && a.outcome.remoteRef === f.remoteId &&
                a.outcome.confirmed?.projectionDigest === f.projectionDigest && same(a.outcome.confirmed.values, f.values) &&
                a.request.step.effect.nodeId === f.nodeId, "FACT_EVIDENCE_MISSING");
        } else {
            const source = f.source;
            const o = s.artifacts[source.artifactId]?.observations?.find(o => o.id === source.observationId);
            requireState(o && o.nodeId === f.nodeId && o.remoteId === f.remoteId && o.targetId === f.targetId && o.projectionDigest === f.projectionDigest && same(o.values, f.values), "FACT_EVIDENCE_MISSING");
        }
    }
    for (const [node, fid] of Object.entries(s.latestFactByNode))
        requireState(s.remoteFacts[fid]?.nodeId === node, "LATEST_FACT_MISMATCH");
    for (const [certificate, p] of Object.entries(s.publications)) {
        const a = s.artifacts[certificate];
        requireState(p.certificate === certificate && p.draftId === id && a?.draft.version === p.version, "PUBLICATION_IDENTITY_MISMATCH");
        if (p.kind === "run") {
            const r = s.runs[p.runId];
            requireState(r && [r.initialArtifactId, r.artifactId, ...r.revisions.map(v => v.artifactId)].includes(certificate), "PUBLICATION_RUN_MISMATCH");
        } else requireState(p.artifactId === certificate, "PUBLICATION_ARTIFACT_MISMATCH");
    }
}

export function validateTransition(previous: ManagedState | undefined, next: ManagedState) {
    if (!previous) return;
    requireState(same(previous.draft.initialSnapshot, next.draft.initialSnapshot), "INITIAL_SNAPSHOT_IMMUTABLE");
    for (const [before, after, error] of [
        [previous.artifacts, next.artifacts, "ARTIFACT_IMMUTABLE"],
        [previous.bindings, next.bindings, "BINDING_IMMUTABLE"],
        [previous.remoteFacts, next.remoteFacts, "FACT_IMMUTABLE"],
        [previous.publications, next.publications, "PUBLICATION_IMMUTABLE"],
    ] as const) for (const [id, value] of Object.entries(before)) requireState(same(value, after[id]), error);
    for (const [id, old] of Object.entries(previous.runs)) {
        const r = next.runs[id];
        requireState(r && r.kind === old.kind && r.draftId === old.draftId && r.initialArtifactId === old.initialArtifactId, "RUN_HISTORY_IMMUTABLE");
        requireState(old.state !== "published" || same(old, r), "COMPLETED_RUN_IMMUTABLE");
        requireState(r.attempts.length >= old.attempts.length, "ATTEMPT_IMMUTABLE");
        old.attempts.forEach((a, i) => {
            const b = r.attempts[i]!;
            requireState(same({ stepId: a.stepId, key: a.key, number: a.number, input: a.input, request: a.request }, { stepId: b.stepId, key: b.key, number: b.number, input: b.input, request: b.request }), "ATTEMPT_IMMUTABLE");
            if (a.status === "applied" || a.status === "no_effect") requireState(same(a, b), "ATTEMPT_IMMUTABLE");
        });
    }
    for (const [id, r] of Object.entries(next.runs)) {
        if (!previous.runs[id] && r.kind === "update")
            requireState(previous.draft.publishedArtifactId && previous.draft.currentRunId && previous.runs[previous.draft.currentRunId]?.state === "published", "UPDATE_BASELINE_REQUIRED");
    }
    requireState(next.resourceRevision >= previous.resourceRevision, "RESOURCE_REVISION_REGRESSION");
    const oldId = previous.draft.currentRunId;
    if (oldId && oldId !== next.draft.currentRunId)
        requireState(previous.runs[oldId]?.state === "published" && next.draft.currentRunId && !previous.runs[next.draft.currentRunId], "RUN_POINTER_TRANSITION_INVALID");
    for (const [node, fid] of Object.entries(previous.latestFactByNode)) {
        const nextId = next.latestFactByNode[node];
        requireState(nextId && (nextId === fid || !previous.remoteFacts[nextId]), "FACT_POINTER_REGRESSION");
    }
    if (!same(previous.latestFactByNode, next.latestFactByNode))
        requireState(next.resourceRevision > previous.resourceRevision, "FACT_REVISION_REQUIRED");
}
