import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite, createSqliteBackend, type ManagedExecutor, type ManagedAsyncRule, type Step, type ApplyOutcome, type GraphOp } from "../src/index.js";
import { definition, selector, rules, initial, userIntent, chosen, value } from "./fixtures/project-tasks-managed.js";
// Actual library and SQLite execution. The remote service and user choices are fictional.
const effects = new Map<string, {
    id: string;
    body: Step["payload"];
}>();
const remoteCalls: unknown[] = [], checkCalls: unknown[] = [];
const executor: ManagedExecutor = { ...selector, id: "example.project-service", version: "5", target: "mock:local",
    plan: draft => Object.values(draft.graph.nodes).map((node): Step => {
        const parent = Object.values(draft.graph.edges).find(edge => edge.to === node.id)?.from;
        return { id: node.id, effect: { kind: "create", nodeId: node.id }, payload: node.nodeType === "project"
                ? { title: value(node, "name"), capacity_hours: value(node, "capacityHours"), deadline_day: value(node, "deadlineDay") }
                : { title: value(node, "name"), estimate_hours: value(node, "estimateHours"), due_day: value(node, "dueDay"), priority: value(node, "priority"), assignee: value(node, "owner") },
            ...(parent ? { dependsOn: [parent], inputRefs: { projectId: parent } } : {}) };
    }),
    apply: async (step, key) => {
        let output: ApplyOutcome;
        if (step.id === "task-1" && step.payload.assignee === "lin")
            output = { kind: "not_applied", reason: "Owner unavailable; request rejected before creation", code: "OWNER_UNAVAILABLE", message: "负责人暂不可用，任务未创建。",
                diagnostics: [{ code: "task.owner_unavailable", path: "/nodes/task-1/fields/owner", message: "林无法接手，请选择其他负责人后续作。", candidates: [{ value: "chen", label: "陈", message: "目前可接手（虚构候选）", repairOps: [{ op: "set", nodeId: "task-1", path: "/owner", value: "chen" }] }] }] };
        else {
            let resource = effects.get(key);
            if (!resource) {
                resource = { id: `resource-${effects.size + 1}`, body: structuredClone(step.payload) };
                effects.set(key, resource);
            }
            output = step.id === "task-2" ? { kind: "unknown", reason: "Response timed out; creation outcome requires lookup", code: "TIMEOUT", message: "请求超时，先查证这次请求是否已成功。" } : { kind: "applied", remoteRef: resource.id };
        }
        remoteCalls.push({ method: "apply", input: { step, key }, output });
        return output;
    },
    reconcile: async (step, key) => {
        const resource = effects.get(key), output = resource ? { kind: "applied" as const, remoteRef: resource.id } : { kind: "unknown" as const, reason: "No conclusive receipt" };
        remoteCalls.push({ method: "reconcile", input: { step, key }, output });
        return output;
    }
};
let exportReady = false;
const asyncRules: ManagedAsyncRule[] = [{ ...selector, id: "document.export", version: "1", check: async (draft) => {
            const output = exportReady ? { status: "complete" as const, diagnostics: [] } : { status: "pending" as const, message: "文档导出仍在处理中，请稍后重新预检。", retryAfterSeconds: 2 };
            checkCalls.push({ method: "queryExport", input: { draftId: draft.id, version: draft.version }, output });
            return output;
        } }];
const directory = mkdtempSync(join(tmpdir(), "stagedwrite-walkthrough-"));
const backend = createSqliteBackend(join(directory, "runs.sqlite"));
const engine = createStagedWrite({ definitions: [definition], rules, asyncRules, executors: [executor], ...backend });
const steps: {
    method: string;
    note: string;
    input: unknown[];
    output: unknown;
    remoteCalls: unknown[];
    checkCalls: unknown[];
    effectCount: number;
}[] = [];
async function call<T>(method: string, note: string, input: unknown[], action: () => Promise<T>): Promise<T> {
    const before = remoteCalls.length, checksBefore = checkCalls.length, copied = structuredClone(input), output = await action();
    steps.push({ method, note, input: copied, output: structuredClone(output), remoteCalls: structuredClone(remoteCalls.slice(before)), checkCalls: structuredClone(checkCalls.slice(checksBefore)), effectCount: effects.size });
    return output;
}
try {
    let draft = await call("create", "创建就有初始工作意图。Graph 为普通值，fieldIntents 保存三态，initialSnapshot 固定初始基线。", [selector, initial], () => engine.create(selector, initial));
    assert.equal(draft.version, 0);
    assert.deepEqual(draft.graph, initial);
    const editName = (text: string): GraphOp[] => [{ op: "set", nodeId: "project-1", path: "/name", value: text }];
    for (const name of ["临时名称 A", "临时名称 B"]) {
        const ops = editName(name);
        draft = await call("edit", "先连续修改名称，供下一步验证 reset 的固定基线。", [draft.id, draft.version, ops], () => engine.edit(draft.id, draft.version, ops));
    }
    const reset: GraphOp[] = [{ op: "reset", nodeId: "project-1", path: "/name" }];
    draft = await call("edit", "reset 回到 create 时的“文档发布”，不会回到上一版的“临时名称 A”。", [draft.id, draft.version, reset], () => engine.edit(draft.id, draft.version, reset));
    assert.equal(draft.graph.nodes["project-1"]!.fields.name, "文档发布");
    const pending = await call("preflight", "静态规则给出 3 条具体诊断；异步检查返回 pending，无发布凭据。", [draft.id], () => engine.preflight(draft.id));
    assert.equal(pending.status, "pending");
    assert.equal(pending.diagnostics.length, 3);
    assert.equal(pending.certificate, undefined);
    exportReady = true; // Simulate external job completion; the library owns no background job.
    const blocked = await call("preflight", "外部检查完成，仍有 3 条业务问题。完整 preview、message、候选值和 repair OP 都来自实际检查。", [draft.id], () => engine.preflight(draft.id));
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.diagnostics[1]!.repairs!.length, 2);
    draft = await call("edit", "调用方依据用户意图选定 4 个 OP。规则建议不自动执行。", [draft.id, draft.version, chosen], () => engine.edit(draft.id, draft.version, chosen));
    const check = await call("preflight", "检查通过，保存不可变 Artifact。执行器的 plan 将图映射成请求参数。", [draft.id], () => engine.preflight(draft.id));
    assert.equal(check.status, "passed");
    assert.ok(check.certificate);
    const options = { runId: "demo-run-1" };
    const partial = await call("publish", "同事务建立 Run 和 currentRunId。项目创建成功，任务 1 明确拒绝，任务 2 尚未发送。Draft 仍 pending。", [draft.id, check.certificate, options], () => engine.publish(draft.id, check.certificate!, options));
    assert.equal(partial.state, "blocked");
    assert.equal(effects.size, 1);
    assert.deepEqual(partial.steps.map(s => s.status), ["applied", "ready", "ready"]);
    await call("getDraft", "失败后 currentRunId 保留；pending 不意味着远端没有资源。", [draft.id], () => engine.getDraft(draft.id));
    const repair = partial.diagnostics[0]!.candidates![0]!.repairOps!;
    draft = await call("edit", "假设用户同意改由陈接手，只修复未完成任务。成功项目不允许修改。", [draft.id, draft.version, repair], () => engine.edit(draft.id, draft.version, repair));
    const unknown = await call("resume", "沿用同一 Run，重新检查修复；项目跳过，任务 1 用新请求 key 创建，任务 2 模拟超时。", [partial.id], () => engine.resume(partial.id));
    assert.equal(unknown.state, "unknown");
    assert.equal(effects.size, 3);
    assert.notEqual(unknown.steps[1]!.key, partial.steps[1]!.key);
    const complete = await call("resume", "只查证任务 2 的原请求，确认成功后收尾；没有再次 apply。Draft 变 published，保留成功 Artifact。", [partial.id], () => engine.resume(partial.id));
    assert.equal(complete.state, "published");
    assert.equal(complete.id, partial.id);
    assert.equal(effects.size, 3);
    assert.deepEqual((steps.at(-1)!.remoteCalls as {
        method: string;
    }[]).map(c => c.method), ["reconcile"]);
    await call("getDraft", "全部成功才设置 published、publishedArtifactId 和 lastPublishedAt。currentRunId 仍保留。", [draft.id], () => engine.getDraft(draft.id));
    await call("getBindings", "每个成功节点都已绑定远端资源；这些是确认事实，不是远端实时漂移检测。", [draft.id], () => engine.getBindings(draft.id));
    await call("getRunInput", "Run 当前采用的意图与计划；旧产物仍可用 revisions 中的 artifactId 查询。", [complete.id], () => engine.getRunInput(complete.id));
    const noMoreEffects = remoteCalls.length;
    assert.equal((await engine.publish(draft.id, check.certificate!)).id, complete.id);
    assert.equal(remoteCalls.length, noMoreEffects);
    // Duplicate-publish guard is verified here, outside the main walkthrough's one-publish flow.
    const report = { recordedAt: new Date().toISOString(), runtime: process.version, environment: "Real library + temporary SQLite; simulated remote; no HTTP or LLM calls.",
        registration: { definition, rules: rules.map(({ check, ...meta }) => ({ ...meta, implementation: check.toString() })), asyncRules: asyncRules.map(({ check, ...meta }) => ({ ...meta, implementation: check.toString() })) },
        asyncScenario: "异步规则返回 pending，上游重入预检。测试驱动模拟外部任务完成，没有实际等待或启动后台任务。",
        executionRepairIntent: "首次 publish 返回负责人不可用诊断；调用方选择候选 OP 修复后 resume。同 Run 的后续超时再次 resume 查证，成功部分不重发。",
        userIntent, chosenOps: chosen, steps, effects: [...effects].map(([key, resource]) => ({ key, ...resource })), assertions: { duplicatePublishCreatedNothing: true, resetRestoredInitialIntent: true, finalEffectCount: effects.size } };
    if (process.argv.includes("--write-report")) {
        const out = join(process.cwd(), "docs/examples");
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "publish-resume-trace.json"), JSON.stringify(report, null, 2) + "\n");
        writeFileSync(join(out, "publish-resume-walkthrough.md"), `# 当前协议的真实输入输出\n\n实际执行库、SQLite 与断言；远端是 Mock，无 HTTP/LLM 调用。运行时间 ${report.recordedAt}。\n\n[交互 HTML](publish-resume.html) · [完整 JSON](publish-resume-trace.json) · [源码](../../examples/publish-resume.ts)\n\n运行 npm run demo:html 重新生成。\n\n${steps.map((s, i) => `## ${i + 1}. ${s.method}\n\n${s.note}\n\n输入：\n\n\`\`\`json\n${JSON.stringify(s.input, null, 2)}\n\`\`\`\n\n输出：\n\n\`\`\`json\n${JSON.stringify(s.output, null, 2)}\n\`\`\`\n\n远端调用：\n\n\`\`\`json\n${JSON.stringify(s.remoteCalls, null, 2)}\n\`\`\``).join("\n\n")}\n`);
        console.log(JSON.stringify({ calls: steps.length, effects: effects.size, assertions: report.assertions }));
    }
    else
        console.log(JSON.stringify(report, null, 2));
}
finally {
    await engine.close();
    rmSync(directory, { recursive: true, force: true });
}
