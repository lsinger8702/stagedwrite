import { protectIntentRepair } from "./edit-guards.js";
import { compileUpdate, validateUpdatePlan, type UpdateProjection } from "./update-plan.js";
import type { RemoteObservation } from "./types.js";
import { randomUUID } from "node:crypto";
import { DefinitionRegistry } from "../registry/registry.js";
import { deepFreeze, definitionDigest, jsonSnapshot, isObject, type Json } from "../registry/json.js";
import { GraphPreflight } from "../preflight/check.js";
import { AsyncPreflight } from "../preflight/async.js";
import { previewDraft } from "../preflight/preview.js";
import { validDiagnostic } from "../preflight/diagnostic.js";
import { validatePlan } from "../execution/plan.js";
import { publicationId } from "../execution/publication.js";
import { performance } from "node:perf_hooks";
import type { DefinitionSelector } from "../registry/types.js";
import type { GraphOp } from "../graph/types.js";
import type { Step, ApplyOutcome, ReconcileOutcome, Event } from "../types.js";
import type { GraphDiagnostic } from "../preflight/types.js";
import { createMemoryBackend, lockResource } from "./storage.js";
import { initialize, editIntent, toInternal, snapshot, same } from "./intent.js";
import type { ManagedOptions, ManagedEditResult, ManagedDraft, ManagedInitialIntent, ManagedState, ManagedRun, ManagedExecutor, ManagedCheck, Artifact, DraftLease, Attempt } from "./types.js";
const key = (s: DefinitionSelector) => JSON.stringify([s.type, s.typeVersion]);
const copy = <T>(v: T): T => structuredClone(v);
const declaration = (s: Step): Step => ({ id: s.id, payload: s.payload, ...(s.dependsOn ? { dependsOn: s.dependsOn } : {}), ...(s.inputRefs ? { inputRefs: s.inputRefs } : {}), effect: s.effect });
const event = (r: ManagedRun, stepId: string, kind: Event["kind"], reason?: string) => r.events.push({ sequence: r.events.length + 1, stepId, kind, recordedAt: new Date().toISOString(), ...(reason ? { reason } : {}) });
/** Managed protocol: long-lived intent, one initial create, explicit repair/resume. All I/O APIs are async. */
export function createStagedWrite(options: ManagedOptions) {
    const registry = new DefinitionRegistry(options.definitions);
    if (!!options.storage !== !!options.locks)
        throw new Error("STORAGE_LOCK_PAIR_REQUIRED");
    const backend = options.storage ? { storage: options.storage, locks: options.locks! } : createMemoryBackend();
    const { storage, locks } = backend;
    if (!storage.namespace || typeof locks.acquire !== "function")
        throw new Error("INVALID_BACKEND");
    const ttl = options.leaseTtlMs ?? 30000;
    if (!Number.isSafeInteger(ttl) || ttl < 30)
        throw new Error("INVALID_LEASE_TTL");
    const timeout = options.preflightTimeoutMs ?? 5000;
    const rules = (options.rules ?? []).map(r => ({ ...r })), asyncRules = (options.asyncRules ?? []).map(r => ({ ...r }));
    // Reuse the existing rule registration validation, not a second diagnostic protocol.
    new GraphPreflight(registry, rules.map(r => ({ ...r, check: () => [] })));
    new AsyncPreflight(registry, rules.map(r => ({ ...r, check: () => [] })), asyncRules.map(r => ({ ...r, check: async () => ({ status: "complete", diagnostics: [] }) })), timeout);
    const executors = new Map<string, ManagedExecutor>();
    for (const e of options.executors ?? []) {
        registry.getDefinition(e);
        if (executors.has(key(e)) || ![e.id, e.version, e.target].every(v => typeof v === "string" && v.trim()) || typeof e.plan !== "function" || typeof e.apply !== "function" || !(typeof e.reconcile === "function" || typeof e.reconcile?.unsupported === "string" && e.reconcile.unsupported.trim()))
            throw new Error("INVALID_EXECUTOR");
        if (e.update !== undefined && (!e.update || typeof e.update.inspect !== "function" || e.update.plan !== undefined && typeof e.update.plan !== "function"))
            throw new Error("INVALID_UPDATE_INSPECTOR");
        executors.set(key(e), { ...e, ...(e.update ? { update: { inspect: e.update.inspect.bind(e.update), ...(e.update.plan ? { plan: e.update.plan.bind(e.update) } : {}) } } : {}), plan: e.plan.bind(e), apply: e.apply.bind(e), reconcile: typeof e.reconcile === "function" ? e.reconcile.bind(e) : { ...e.reconcile } });
    }
    if (executors.size)
        for (const s of registry.selectors())
            if (!executors.has(key(s)))
                throw new Error("EXECUTOR_REQUIRED");
    let closed = false, active = 0;
    const open = () => { if (closed)
        throw new Error("STORE_CLOSED"); };
    const need = async (id: string) => { open(); const s = await storage.read(id); if (!s)
        throw new Error("DRAFT_NOT_FOUND"); toInternal(s.draft); if (registry.getDefinition(s.draft).digest !== s.draft.definitionDigest)
        throw new Error("DEFINITION_MISMATCH"); return s; };
    async function withLease<T>(id: string, work: (lease: DraftLease, signal: AbortSignal) => Promise<T>): Promise<T> {
        open();
        active++;
        let lease: DraftLease | null = null, timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined;
        const controller = new AbortController();
        try {
            try {
                lease = await locks.acquire(lockResource(storage.namespace, id), { ttlMs: ttl });
            }
            catch (error) {
                throw new Error("LOCK_UNAVAILABLE", { cause: error });
            }
            if (!lease)
                throw new Error("DRAFT_BUSY");
            if (lease.resource !== lockResource(storage.namespace, id) || !lease.token || !Number.isSafeInteger(lease.fence) || lease.fence < 1)
                throw new Error("INVALID_LEASE");
            const held = lease;
            timer = setInterval(() => { if (pending || controller.signal.aborted)
                return; pending = Promise.resolve().then(() => held.renew()).then(ok => { if (!ok)
                controller.abort(); }, () => controller.abort()).finally(() => { pending = undefined; }); }, Math.max(5, Math.floor(ttl / 3)));
            timer.unref?.();
            return await work(lease, controller.signal);
        }
        finally {
            if (timer)
                clearInterval(timer);
            if (pending)
                await pending;
            try {
                if (lease)
                    await lease.release();
            }
            finally {
                active--;
            }
        }
    }
    const tx = (id: string, l: DraftLease, fn: (s: ManagedState) => void) => storage.transact(id, l, s => { if (!s)
        throw new Error("DRAFT_NOT_FOUND"); fn(s); return s; });
    const executor = (s: ManagedState) => { const e = executors.get(key(s.draft)); if (!e)
        throw new Error("EXECUTABLE_MODE_REQUIRED"); return e; };
    function plan(d: ManagedDraft, e: ManagedExecutor): Step[] {
        const steps = validatePlan(e.plan(deepFreeze(copy(d))));
        const nodes = new Set<string>();
        for (const s of steps) {
            if (!s.effect || !d.graph.nodes[s.effect.nodeId] || nodes.has(s.effect.nodeId))
                throw new Error("EFFECT_MAPPING_REQUIRED");
            nodes.add(s.effect.nodeId);
        }
        if (nodes.size !== Object.keys(d.graph.nodes).length)
            throw new Error("EFFECT_MAPPING_REQUIRED");
        return steps;
    }
    function protect(s: ManagedState, d: ManagedDraft, nextPlan?: Step[]) {
        const r = s.draft.currentRunId ? s.runs[s.draft.currentRunId] : undefined;
        if (!r)
            return;
        const old = s.artifacts[r.artifactId]!.draft;
        protectIntentRepair(d, { state: r.state, adopted: old,
            successfulNodes: r.steps.filter(step => step.status === "applied").map(step => step.effect!.nodeId) });
        if (nextPlan) {
            if (nextPlan.length !== r.steps.length)
                throw new Error("REPAIR_TOPOLOGY_CHANGED");
            for (let i = 0; i < nextPlan.length; i++) {
                const prev = r.steps[i]!, next = nextPlan[i]!;
                if (!same({ ...declaration(prev), payload: {} }, { ...declaration(next), payload: {} }))
                    throw new Error("REPAIR_TOPOLOGY_CHANGED");
                if (["applied"].includes(prev.status) && !same(declaration(prev), declaration(next)))
                    throw new Error("APPLIED_STEP_IMMUTABLE");
            }
        }
    }
    function response(s: ManagedState, r: ManagedRun, check?: ManagedCheck) {
        const diagnostics: GraphDiagnostic[] = r.interruption ? [copy(r.interruption)] : [];
        const d = toInternal(s.draft);
        for (const step of r.steps)
            if ((step.status !== "applied" || step.feedback?.code === "CONFIRMED_FACT_INVALID") && step.feedback) {
                const f = step.feedback, accepted = (f.diagnostics ?? []).filter(x => validDiagnostic(x as unknown as Json, registry, d));
                diagnostics.push(...copy(accepted));
                if (!accepted.length)
                    diagnostics.push({ code: f.code ?? `execution.${step.status}`, path: `/nodes/${step.effect!.nodeId.replaceAll("~", "~0").replaceAll("/", "~1")}`, message: f.message ?? f.reason ?? "Execution needs attention", ...(step.status === "applied" ? { severity: "warning" as const } : {}) });
            }
        return { ...copy(r), previewVersion: s.draft.version, preview: check?.preview ?? previewDraft(d, registry.getDefinition(s.draft).definition), diagnostics: check?.diagnostics ?? diagnostics, ...(check ? { check } : {}) };
    }
    function rulesDigest(d: ManagedDraft) {
        const mapped = rules.map(r => ({ ...r, check: () => [] }));
        const sync = new GraphPreflight(registry, mapped);
        const asyncCheck = new AsyncPreflight(registry, mapped, asyncRules.map(r => ({ ...r, check: async () => ({ status: "complete" as const, diagnostics: [] }) })), timeout);
        const internal = toInternal(d);
        return asyncCheck.digest(internal, sync.rulesDigest(internal));
    }
    function validateBinding(s: ManagedState, r: ManagedRun, e: ManagedExecutor) {
        const b = s.artifacts[r.artifactId]!.binding;
        if (b.definitionDigest !== s.draft.definitionDigest || b.rulesDigest !== rulesDigest(s.draft))
            throw new Error("REGISTRATION_BINDING_MISMATCH");
        if (b.executorId !== e.id || b.executorVersion !== e.version || b.target !== e.target)
            throw new Error("EXECUTOR_BINDING_MISMATCH");
    }
    async function checks(s: ManagedState): Promise<{
        check: ManagedCheck;
        artifact?: Artifact;
    }> {
        const deadline = performance.now() + timeout;
        const draft = copy(s.draft), internal = toInternal(draft), frozen = deepFreeze(copy(draft));
        const mapped = rules.map(r => ({ ...r, check: () => r.check(frozen) }));
        const preflight = new GraphPreflight(registry, mapped);
        const asyncCheck = new AsyncPreflight(registry, mapped, asyncRules.map(r => ({ ...r, check: (_d: unknown, c: {
                signal: AbortSignal;
            }) => r.check(frozen, c) })), timeout);
        let check: ManagedCheck = preflight.run(internal);
        check.rulesDigest = asyncCheck.digest(internal, preflight.rulesDigest(internal));
        if (asyncRules.length)
            check = await asyncCheck.run(internal, check, deadline);
        if (draft.currentRunId)
            check.executionHint = { runId: draft.currentRunId, nextAction: s.runs[draft.currentRunId]?.state === "published" ? "observe" : "resume" };
        const e = executors.get(key(draft));
        if (!e)
            return { check };
        if (e.update && draft.publishedArtifactId) {
            // Inspection is public and read-only; no create-shaped certificate for an update.
            check.scope = "draft";
            if (check.status !== "passed") return { check };
            let slots: ManagedCheck["updatePreview"];
            const inspector = e.update;
            const reader = new AsyncPreflight(registry, [], [{
                ...{ type: e.type, typeVersion: e.typeVersion }, id: `${e.id}.update.inspect`, version: e.version,
                check: async (_draft, context) => {
                    const raw = await inspector.inspect(frozen, { signal: context.signal, bindings: deepFreeze(copy(s.bindings)) });
                    const failures: string[] = [];
                    const data = jsonSnapshot(raw, (_path, message) => failures.push(message));
                    if (failures.length || !isObject(data)) throw new Error("INVALID_UPDATE_OBSERVATION");
                    if (data.status === "pending") return data as unknown as { status: "pending"; message: string };
                    if (data.status !== "complete" || !Array.isArray(data.projections) || !Array.isArray(data.observations) ||
                        Object.keys(data).some(k => !["status", "projections", "observations", "diagnostics"].includes(k)) ||
                        data.diagnostics !== undefined && !Array.isArray(data.diagnostics)) throw new Error("INVALID_UPDATE_OBSERVATION");
                    const compiled = compileUpdate(s, data.projections as unknown as UpdateProjection[], data.observations as unknown as RemoteObservation[]);
                    if (compiled.status === "passed") {
                        slots = { slots: compiled.slots };
                        if (inspector.plan) slots.plan = validateUpdatePlan(inspector.plan(frozen, deepFreeze(copy(compiled))), compiled, s);
                    }
                    return { status: "complete" as const, diagnostics: [...(data.diagnostics ?? []) as unknown as GraphDiagnostic[], ...compiled.diagnostics] };
                },
            }], timeout);
            check = await reader.run(internal, check, deadline);
            if (check.status === "passed" && slots) check.updatePreview = copy(slots);
            return { check };
        }
        check.scope = "execution";
        if (check.status !== "passed")
            return { check };
        try {
            const steps = plan(draft, e);
            if (draft.status !== "published")
                protect(s, draft, steps);
            const binding = { checkId: check.checkId, definitionDigest: check.definitionDigest, rulesDigest: check.rulesDigest, executorId: e.id, executorVersion: e.version, target: e.target, planDigest: definitionDigest(steps as unknown as Json) };
            const artifact: Artifact = { id: randomUUID(), intentDigest: definitionDigest(snapshot(draft) as unknown as Json), draft, plan: steps, binding, resourceRevision: s.resourceRevision };
            check.certificate = artifact.id;
            check.artifactId = artifact.id;
            check.execution = binding;
            return { check, artifact };
        }
        catch (error) {
            check.status = "blocked";
            check.diagnostics.push({ code: "plan.invalid", message: error instanceof Error ? error.message : "Invalid plan", path: "", severity: "error", source: { kind: "executor", id: e.id, version: e.version } });
            return { check };
        }
    }
    async function runCheck(id: string, lease?: DraftLease) {
        const start = async (l: DraftLease) => tx(id, l, s => { s.checkEpoch++; s.check = null; });
        const s = lease ? await start(lease) : await withLease(id, l => start(l));
        const result = await checks(s);
        const finish = (l: DraftLease) => tx(id, l, current => {
            if (current.draft.version !== s.draft.version || current.checkEpoch !== s.checkEpoch || current.resourceRevision !== s.resourceRevision)
                throw new Error("STALE_CHECK");
            current.check = result.check;
            if (result.artifact)
                current.artifacts[result.artifact.id] = result.artifact;
        });
        if (lease)
            await finish(lease);
        else
            await withLease(id, finish);
        return result.check;
    }
    function outcome(raw: unknown, phase: "apply" | "reconcile"): ApplyOutcome | ReconcileOutcome {
        const obj = raw as {
            kind?: string;
            remoteRef?: string;
            reason?: string;
            retryable?: boolean;
            code?: string;
            message?: string;
            diagnostics?: GraphDiagnostic[];
            confirmed?: unknown;
        };
        let base: ApplyOutcome | ReconcileOutcome = { kind: "unknown", reason: "No conclusive adapter outcome" };
        if (obj && obj.kind === "applied" && typeof obj.remoteRef === "string" && obj.remoteRef.trim())
            base = { kind: "applied", remoteRef: obj.remoteRef };
        else if (obj && typeof obj.reason === "string") {
            if (obj.kind === "unknown")
                base = { kind: "unknown", reason: obj.reason };
            else if (phase === "reconcile" && obj.kind === "no_effect")
                base = { kind: "no_effect", reason: obj.reason };
            else if (phase === "apply" && obj.kind === "not_applied")
                base = { kind: "not_applied", reason: obj.reason, retryable: obj.retryable === true };
        }
        try {
            if (typeof obj?.code === "string")
                base.code = obj.code;
            if (typeof obj?.message === "string")
                base.message = obj.message;
            if (Array.isArray(obj?.diagnostics))
                base.diagnostics = JSON.parse(JSON.stringify(obj.diagnostics));
        }
        catch { /* optional feedback cannot erase an effect */ }
        if (base.kind === "applied" && obj?.confirmed !== undefined) {
            try {
                const failures: string[] = [];
                const confirmed = jsonSnapshot(obj.confirmed, (_p, message) => failures.push(message));
                if (failures.length || !isObject(confirmed) || Object.keys(confirmed).some(k => !["projectionDigest", "values"].includes(k)) ||
                    typeof confirmed.projectionDigest !== "string" || !confirmed.projectionDigest.trim() || !isObject(confirmed.values) ||
                    !Object.values(confirmed.values).every(v => isObject(v) && (v.kind === "absent" && Object.keys(v).length === 1 || v.kind === "value" && Object.keys(v).length === 2 && Object.hasOwn(v, "value") && (v.value === null || ["string", "number", "boolean"].includes(typeof v.value)))))
                    throw new Error("INVALID_CONFIRMED_FACT");
                base.confirmed = confirmed as unknown as NonNullable<Extract<ApplyOutcome, { kind: "applied" }>["confirmed"]>;
            } catch {
                // Preserve the conclusive creation receipt; malformed optional facts cannot justify another create.
                base.code = "CONFIRMED_FACT_INVALID";
                base.message = "Remote effect was applied, but normalized confirmation values were invalid; update requires valid evidence.";
            }
        }
        return base;
    }
    async function dispatch(id: string, runId: string, l: DraftLease, signal: AbortSignal, reconcileOnly = false) {
        try {
            return await dispatchSteps(id, runId, l, signal, reconcileOnly);
        }
        catch (error) {
            // Best effort only: the same fenced transaction must still authorize us.
            // Never turn an unresolved dispatch into proof of no remote effect.
            try {
                await tx(id, l, current => {
                    const run = current.runs[runId]!;
                    if (run.state === "published") return;
                    const unresolved = run.attempts.some(a => a.status === "pending" || a.status === "unknown");
                    run.state = unresolved ? "unknown" : "blocked";
                    run.interruption = {
                        code: "execution.interrupted", path: "",
                        message: unresolved
                            ? "Execution was interrupted with an unresolved request. Resume this run to reconcile its original input before sending again."
                            : "Execution was interrupted. Resume this run to continue unfinished steps; confirmed effects are retained."
                    };
                });
            }
            catch { /* Store outage or lost lease: preserve the original error and durable attempts. */ }
            throw error;
        }
    }
    async function dispatchSteps(id: string, runId: string, l: DraftLease, signal: AbortSignal, reconcileOnly = false) {
        let s = await need(id);
        const e = executor(s);
        validateBinding(s, s.runs[runId]!, e);
        for (;;) {
            if (signal.aborted)
                throw new Error("LEASE_LOST");
            s = await need(id);
            const r = s.runs[runId]!;
            const step = r.steps.find(x => !["applied"].includes(x.status));
            if (!step) {
                if (!reconcileOnly)
                    s = await tx(id, l, current => { const run = current.runs[runId]!; if (current.draft.version !== run.version)
                        throw new Error("STALE_RUN_INPUT"); delete run.interruption; run.state = "published"; current.draft.status = "published"; current.draft.publishedArtifactId = run.artifactId; current.draft.lastPublishedAt ??= new Date().toISOString(); current.draft.updatedAt = new Date().toISOString(); });
                return s;
            }
            const pending = [...r.attempts].reverse().find(a => a.stepId === step.id && ["pending", "unknown"].includes(a.status));
            if (reconcileOnly && !pending)
                return s;
            let attempt: Attempt;
            if (pending) {
                attempt = pending;
                await tx(id, l, current => { delete current.runs[runId]!.interruption; event(current.runs[runId]!, step.id, "reconciling"); });
            }
            else {
                const result = await tx(id, l, current => {
                    const run = current.runs[runId]!, st = run.steps.find(x => x.id === step.id)!;
                    if (run.attempts.some(a => a.stepId === st.id && ["pending", "unknown"].includes(a.status)))
                        throw new Error("UNRESOLVED_EXECUTION");
                    const input = copy(st.payload);
                    for (const dep of st.dependsOn ?? [])
                        if (!["applied"].includes(run.steps.find(x => x.id === dep)?.status ?? ""))
                            throw new Error("DEPENDENCY_NOT_APPLIED");
                    for (const [field, dep] of Object.entries(st.inputRefs ?? {}))
                        input[field] = run.steps.find(x => x.id === dep)!.remoteRef!;
                    delete run.interruption;
                    st.resolvedPayload = copy(input);
                    st.status = "dispatching";
                    run.state = "running";
                    run.attempts.push({ stepId: st.id, key: st.key, number: run.attempts.length + 1, input, request: { step: { ...copy(declaration(st)), payload: copy(input) }, target: e.target, executorId: e.id, executorVersion: e.version }, status: "pending" });
                    event(run, st.id, "dispatching");
                });
                attempt = result.runs[runId]!.attempts.at(-1)!;
            }
            let observed: ApplyOutcome | ReconcileOutcome;
            const late = s.lateFacts.filter(f => f.runId === runId && f.stepId === step.id && f.key === attempt.key && f.attemptNumber === attempt.number && f.outcome.kind === "applied");
            if (pending && new Set(late.flatMap(f => f.outcome.kind === "applied" && f.outcome.confirmed ? [definitionDigest(f.outcome.confirmed as unknown as Json)] : [])).size > 1)
                observed = { kind: "unknown", reason: "Conflicting normalized receipts require investigation" };
            else if (pending && new Set(late.map(f => f.outcome.kind === "applied" ? f.outcome.remoteRef : "")).size > 1)
                observed = { kind: "unknown", reason: "Conflicting remote receipts require investigation" };
            else if (pending && late.length && new Set(late.map(f => f.outcome.kind === "applied" ? f.outcome.remoteRef : "")).size === 1)
                observed = (late.find(f => f.outcome.kind === "applied" && f.outcome.confirmed) ?? late[0]!).outcome;
            else {
                try {
                    if (signal.aborted)
                        throw new Error("LEASE_LOST");
                    if (!attempt.request || attempt.request.target !== e.target || attempt.request.executorId !== e.id || attempt.request.executorVersion !== e.version)
                        throw new Error("REQUEST_BINDING_MISMATCH");
                    const input = copy(attempt.request.step);
                    const raw = pending ? typeof e.reconcile === "function" ? await e.reconcile(input, attempt.key, { signal }) : { kind: "unknown", reason: e.reconcile.unsupported } : await e.apply(input, attempt.key, { signal });
                    observed = outcome(raw, pending ? "reconcile" : "apply");
                }
                catch {
                    observed = { kind: "unknown", reason: "Adapter call did not establish an outcome" };
                }
            }
            try {
                s = await tx(id, l, current => {
                    const run = current.runs[runId]!, st = run.steps.find(x => x.id === step.id)!, a = run.attempts.find(x => x.number === attempt.number)!;
                    if (!a || a.key !== attempt.key || !["pending", "unknown"].includes(a.status))
                        throw new Error("ATTEMPT_CONFLICT");
                    a.outcome = copy(observed);
                    st.feedback = { ...(observed.code ? { code: observed.code } : {}), ...(observed.message ? { message: observed.message } : {}), ...(observed.diagnostics ? { diagnostics: copy(observed.diagnostics) } : {}), ...("reason" in observed ? { reason: observed.reason } : {}) };
                    if (observed.kind === "applied") {
                        const node = st.effect!.nodeId;
                        if (Object.entries(current.bindings).some(([n, b]) => n !== node && b.targetId === e.target && b.remoteId === (observed as {
                            remoteRef: string;
                        }).remoteRef))
                            throw new Error("REMOTE_BINDING_CONFLICT");
                        const prior = current.bindings[node];
                        if (prior && prior.remoteId !== observed.remoteRef)
                            throw new Error("REMOTE_BINDING_CONFLICT");
                        current.bindings[node] = { nodeId: node, targetId: e.target, remoteId: observed.remoteRef, runId, stepId: st.id, key: a.key, attemptNumber: a.number, input: copy(a.input) };
                        st.remoteRef = observed.remoteRef;
                        st.status = "applied";
                        a.status = "applied";
                        run.state = "running";
                        event(run, st.id, "applied");
                        if (observed.confirmed) {
                            const factId = JSON.stringify([runId, st.id, a.number]);
                            current.remoteFacts[factId] = { id: factId, nodeId: node, targetId: e.target, remoteId: observed.remoteRef,
                                projectionDigest: observed.confirmed.projectionDigest, values: copy(observed.confirmed.values),
                                source: { kind: "attempt", runId, stepId: st.id, attemptNumber: a.number }, confirmedAt: new Date().toISOString() };
                            current.latestFactByNode[node] = factId;
                        }
                        current.resourceRevision++;
                    }
                    else if (observed.kind === "unknown") {
                        st.status = "unknown";
                        a.status = "unknown";
                        run.state = "unknown";
                        event(run, st.id, "unknown", observed.reason);
                    }
                    else {
                        a.status = "no_effect";
                        st.status = "ready";
                        run.state = "blocked";
                        event(run, st.id, observed.kind === "no_effect" ? "no_effect" : "not_applied", observed.reason);
                    }
                });
            }
            catch (error) {
                try {
                    await storage.appendLateFact(id, { runId, stepId: step.id, key: attempt.key, attemptNumber: attempt.number, outcome: observed });
                }
                catch { /* Keep the original commit error; the durable attempt still requires reconciliation. */ }
                throw error;
            }
            if (observed.kind === "unknown" || observed.kind === "not_applied")
                return s;
            if (reconcileOnly && observed.kind === "no_effect")
                return s;
        }
    }
    const api = {
        async create(selector: DefinitionSelector, initial: ManagedInitialIntent): Promise<ManagedDraft> {
            const id = randomUUID(), time = new Date().toISOString(), empty = { graph: { nodes: {}, edges: {} }, fieldIntents: {} };
            const draft = initialize(registry, { ...copy(empty), formatVersion: 3, id, version: 0, ...selector, definitionDigest: registry.getDefinition(selector).digest, status: "pending", currentRunId: null, targetId: null, initialSnapshot: copy(empty), publishedArtifactId: null, lastPublishedAt: null, tombstones: { nodes: [], edges: [] }, createdAt: time, updatedAt: time }, initial);
            await withLease(id, l => storage.transact(id, l, prior => { if (prior)
                throw new Error("DRAFT_EXISTS"); return { draft, checkEpoch: 0, check: null, artifacts: {}, runs: {}, bindings: {}, resourceRevision: 0, lateFacts: [], remoteFacts: {}, latestFactByNode: {}, publications: {} }; }));
            return copy(draft);
        },
        async getDraft(id: string) { return copy((await need(id)).draft); },
        async getBindings(id: string) { return copy((await need(id)).bindings); },
        async getArtifact(id: string, artifactId: string) { const artifacts = (await need(id)).artifacts; const a = Object.hasOwn(artifacts, artifactId) ? artifacts[artifactId] : undefined; if (!a)
            throw new Error("ARTIFACT_NOT_FOUND"); return copy(a); },
        async preview(id: string, version: number, ops: readonly GraphOp[]) {
            const s = await need(id);
            if (s.draft.status === "published") throw new Error("UPDATE_NOT_SUPPORTED");
            const baseline = s.draft.publishedArtifactId ? s.artifacts[s.draft.publishedArtifactId]!.draft : s.draft.initialSnapshot;
            const out = editIntent(registry, s.draft, baseline, version, ops);
            protect(s, out.candidate);
            return out;
        },
        async edit(id: string, version: number, ops: readonly GraphOp[]): Promise<ManagedEditResult> {
            return withLease(id, async (l) => {
                let changes: ReturnType<typeof editIntent>["changes"] = [];
                const s = await tx(id, l, current => {
                    if (current.draft.status === "published")
                        throw new Error("UPDATE_NOT_SUPPORTED");
                    const baseline = current.draft.publishedArtifactId ? current.artifacts[current.draft.publishedArtifactId]!.draft : current.draft.initialSnapshot;
                    const out = editIntent(registry, current.draft, baseline, version, ops);
                    protect(current, out.candidate);
                    changes = out.changes;
                    current.draft = out.candidate;
                    current.check = null;
                });
                return { draftId: s.draft.id, version: s.draft.version, preflightRequired: true, changes: copy(changes) };
            });
        },
        async preflight(id: string) { open(); active++; try {
            return await runCheck(id);
        }
        finally {
            active--;
        } },
        async getCheck(id: string) { const s = await need(id); if (!s.check || s.check.version !== s.draft.version || s.check.rulesDigest !== rulesDigest(s.draft))
            throw new Error("CHECK_NOT_CURRENT"); return copy(s.check); },
        async getRun(runId: string) { const id = await storage.findRun(runId); if (!id)
            throw new Error("RUN_NOT_FOUND"); const s = await need(id); return response(s, s.runs[runId]!); },
        async getRunInput(runId: string) { const id = await storage.findRun(runId); if (!id)
            throw new Error("RUN_NOT_FOUND"); const s = await need(id); return copy(s.artifacts[s.runs[runId]!.artifactId]!); },
        async publish(id: string, certificate: string, publishOptions?: {
            runId: string;
        }) {
            return withLease(id, async (l, signal) => {
                if (publishOptions !== undefined)
                    publicationId(publishOptions);
                let s = await need(id);
                const adopted = s.publications[certificate];
                if (adopted?.kind === "run") {
                    if (publishOptions?.runId && publishOptions.runId !== adopted.runId) throw new Error(`RUN_ID_CONFLICT: ${adopted.runId}`);
                    return response(s, s.runs[adopted.runId]!);
                }
                if (s.draft.currentRunId) {
                    if (publishOptions?.runId && publishOptions.runId !== s.draft.currentRunId)
                        throw new Error(`RUN_ID_CONFLICT: ${s.draft.currentRunId}`);
                    return response(s, s.runs[s.draft.currentRunId]!);
                }
                const runId = publicationId(publishOptions), e = executor(s);
                if (await storage.findRun(runId))
                    throw new Error("RUN_ID_CONFLICT");
                s = await tx(id, l, current => {
                    if (current.draft.currentRunId)
                        throw new Error("INITIAL_RUN_ALREADY_EXISTS");
                    const check = current.check, a = current.artifacts[certificate];
                    if (!check || check.status !== "passed" || check.certificate !== certificate || !a || a.draft.version !== current.draft.version || a.resourceRevision !== current.resourceRevision || !same(snapshot(a.draft), snapshot(current.draft)))
                        throw new Error("PREFLIGHT_REQUIRED");
                    if (a.binding.definitionDigest !== current.draft.definitionDigest || a.binding.rulesDigest !== rulesDigest(current.draft))
                        throw new Error("REGISTRATION_BINDING_MISMATCH");
                    if (a.binding.executorId !== e.id || a.binding.executorVersion !== e.version || a.binding.target !== e.target)
                        throw new Error("EXECUTOR_BINDING_MISMATCH");
                    current.runs[runId] = { id: runId, draftId: id, kind: "initial_create", version: current.draft.version, state: "running", artifactId: a.id, initialArtifactId: a.id, certificate, revision: 0, revisions: [], attempts: [], events: [], steps: a.plan.map(st => ({ ...copy(st), key: JSON.stringify([runId, st.id, 0]), status: "ready" })) };
                    current.publications[certificate] = { kind: "run", certificate, draftId: id, version: a.draft.version, runId, adoptedAt: new Date().toISOString() };
                    current.draft.currentRunId = runId;
                    current.draft.targetId = e.target;
                });
                s = await dispatch(id, runId, l, signal);
                return response(s, s.runs[runId]!);
            });
        },
        async resume(runId: string) {
            const id = await storage.findRun(runId);
            if (!id)
                throw new Error("RUN_NOT_FOUND");
            return withLease(id, async (l, signal) => {
                let s = await need(id), r = s.runs[runId]!;
                if (s.draft.currentRunId !== runId)
                    throw new Error("RUN_POINTER_MISMATCH");
                if (r.state === "published")
                    return response(s, r);
                validateBinding(s, r, executor(s));
                if (r.attempts.some(a => ["pending", "unknown"].includes(a.status))) {
                    s = await dispatch(id, runId, l, signal, true);
                    r = s.runs[runId]!;
                    if (r.attempts.some(a => ["pending", "unknown"].includes(a.status)))
                        return response(s, r);
                }
                if (s.draft.version !== r.version) {
                    const check = await runCheck(id, l);
                    s = await need(id);
                    r = s.runs[runId]!;
                    if (check.status !== "passed") {
                        s = await tx(id, l, current => { current.runs[runId]!.state = "blocked"; });
                        return response(s, s.runs[runId]!, check);
                    }
                    s = await tx(id, l, current => {
                        const run = current.runs[runId]!, a = current.artifacts[check.artifactId!]!;
                        if (current.check?.certificate !== check.certificate || a.resourceRevision !== current.resourceRevision || a.draft.version !== current.draft.version)
                            throw new Error("STALE_CHECK");
                        protect(current, current.draft, a.plan);
                        run.revisions.push({ artifactId: run.artifactId, version: run.version, steps: copy(run.steps) });
                        run.revision++;
                        run.steps = a.plan.map((st, i) => {
                            const old = run.steps[i]!;
                            if (["applied"].includes(old.status))
                                return old;
                            const changed = !same(declaration(old), declaration(st));
                            const attempted = run.attempts.some(a => a.stepId === st.id);
                            return { ...copy(st), key: changed && attempted ? JSON.stringify([runId, st.id, run.revision]) : old.key, status: "ready", ...(changed && attempted ? { requestRevision: run.revision } : {}) };
                        });
                        current.publications[a.id] = { kind: "run", certificate: a.id, draftId: id, version: a.draft.version, runId, adoptedAt: new Date().toISOString() };
                        run.artifactId = a.id;
                        run.certificate = a.id;
                        run.version = a.draft.version;
                        run.state = "blocked";
                        event(run, "", "plan_repaired");
                    });
                }
                s = await dispatch(id, runId, l, signal);
                return response(s, s.runs[runId]!);
            });
        },
        async close() { if (active)
            throw new Error("DRAFT_BUSY"); if (!closed) {
            await storage.close();
            closed = true;
        } }
    };
    return Object.freeze(api);
}
