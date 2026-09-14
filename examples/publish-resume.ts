import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedWrite } from "../src/index.js";
import type { ApplyOutcome, AsyncGraphRule, GraphExecutor, Run, Step } from "../src/index.js";

// This script actually runs the library and SQLite. The remote service is an in-process simulation.
import { definition, selector, rules, initial, userIntent, chosen, value } from "./fixtures/project-tasks.js";
const effects = new Map<string, { id: string; body: Step["payload"] }>();
const remoteCalls: unknown[] = [];
const executor: GraphExecutor = { ...selector, id: "example.project-service", version: "4", target: "mock:local",
  plan: draft => Object.values(draft.nodes).map((node): Step => {
    const parent = Object.values(draft.edges).find(edge => edge.to === node.id)?.from;
    return { id: node.id, payload: node.nodeType === "project"
      ? { title: value(node, "name"), capacity_hours: value(node, "capacityHours"), deadline_day: value(node, "deadlineDay") }
      : { title: value(node, "name"), estimate_hours: value(node, "estimateHours"), due_day: value(node, "dueDay"), priority: value(node, "priority"), assignee: value(node, "owner") }, effect: { kind: "create" as const, nodeId: node.id },
      ...(parent ? { dependsOn: [parent], inputRefs: { projectId: parent } } : {}) };
  }),
  apply: async (step, key) => {
    // Remote business refusal with optional graph diagnostics. The response parser owns this mapping.
    if (step.id === "task-1" && step.payload.assignee === "lin") {
      const output: ApplyOutcome = { kind: "not_applied", reason: "Selected owner is no longer available", code: "OWNER_UNAVAILABLE",
        message: "林目前不可接单，任务尚未创建。请选择其他负责人后继续本次执行。",
        diagnostics: [{ code: "task.owner_unavailable", path: "/nodes/task-1/fields/owner",
          message: "远端拒绝负责人 lin：林刚被安排了其他工作。任务未创建，可改选陈后继续。",
          candidates: [{ value: "chen", label: "陈", message: "远端当前可接手人员（虚构）",
            repairOps: [{ op: "set", nodeId: "task-1", path: "/owner", value: "chen" }] }] }] };
      remoteCalls.push({ method: "apply", input: { step, key }, output });
      return output;
    }
    let resource = effects.get(key);
    if (!resource) { resource = { id: `resource-${effects.size + 1}`, body: structuredClone(step.payload) }; effects.set(key, resource); }
    const output = { kind: "applied" as const, remoteRef: resource.id };
    remoteCalls.push({ method: "apply", input: { step, key }, output });
    return output;
  },
  reconcile: async (step, key) => {
    const resource = effects.get(key);
    const output = resource ? { kind: "applied" as const, remoteRef: resource.id } : { kind: "unknown" as const, reason: "No conclusive receipt" };
    remoteCalls.push({ method: "reconcile", input: { step, key }, output });
    return output;
  }
};
// The application owns this mock external job. No library queue or background worker.
let exportReady = false;
const checkCalls: unknown[] = [];
const asyncRules: AsyncGraphRule[] = [{ ...selector, id: "document.export", version: "1",
  check: async draft => {
    const output = exportReady ? { status: "complete" as const, diagnostics: [] }
      : { status: "pending" as const, message: "文档导出仍在处理中，请稍后重新预检。", retryAfterSeconds: 2 };
    checkCalls.push({ method: "queryExport", input: { draftId: draft.id, version: draft.version }, output });
    return output;
  }
}];
const directory = mkdtempSync(join(tmpdir(), "stagedwrite-walkthrough-"));
const storage = { kind: "sqlite" as const, path: join(directory, "runs.sqlite") };
const open = () => createStagedWrite({ definitions: [definition], rules, asyncRules, mode: "executable", storage, executors: [executor] });
let engine = open();
const steps: { method: string; input: unknown[]; output: unknown; remoteCalls: unknown[]; checkCalls: unknown[]; effectCount: number }[] = [];
async function call<T>(method: string, input: unknown[], action: () => T | Promise<T>): Promise<T> {
  const before = remoteCalls.length;
  const checksBefore = checkCalls.length;
  const copied = structuredClone(input);
  const output = await action();
  steps.push({ method, input: copied, output: output === undefined ? null : structuredClone(output), remoteCalls: structuredClone(remoteCalls.slice(before)), checkCalls: structuredClone(checkCalls.slice(checksBefore)), effectCount: effects.size });
  return output;
}
try {
  let draft = await call("create", [selector, initial], () => engine.create(selector, initial));
  assert.equal(draft.version, 0);
  assert.deepEqual(draft.nodes, initial.nodes);
  assert.deepEqual(draft.edges, initial.edges);
  const pending = await call("preflight", [draft.id], () => engine.preflight(draft.id));
  assert.equal(pending.status, "pending"); assert.equal(pending.diagnostics.length, 3);
  assert.equal(pending.certificate, undefined); assert.equal(pending.pendingRules![0]!.retryAfterSeconds, 2);
  assert.deepEqual(engine.getDraft(draft.id), draft);
  exportReady = true; // Test driver advances the fake external service, not a library task.
  const blocked = await call("preflight", [draft.id], () => engine.preflight(draft.id));
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.diagnostics.map(d => d.code), ["project.capacity_exceeded", "task.after_project_deadline", "task.urgent_owner_required"]);
  assert.deepEqual(blocked.preview.nodes["task-1"]?.fields.owner, { kind: "clear" });
  assert.ok(blocked.diagnostics.every(d => d.source.kind === "rule" && !("resolution" in d)));
  assert.equal(remoteCalls.length, 0);
  assert.deepEqual(engine.getDraft(draft.id), draft);
  assert.equal(blocked.diagnostics[1]!.repairs!.length, 2);
  assert.deepEqual(blocked.diagnostics[2]!.candidates![0]!.repairOps, [{ op: "set", nodeId: "task-1", path: "/owner", value: "lin" }]);
  assert.equal(blocked.diagnostics[2]!.excludedCandidates![0]!.value, "zhou");
  // The caller selects these OPs using userIntent + preview + diagnostics. No real model is invoked.
  draft = await call("edit", [draft.id, blocked.version, chosen], () => engine.edit(draft.id, blocked.version, chosen));
  const check = await call("preflight", [draft.id], () => engine.preflight(draft.id));
  assert.equal(check.status, "passed"); assert.deepEqual(check.diagnostics, []); assert.ok(check.certificate);
  const firstOptions = { runId: "demo-run-1" };
  const partial = await call("publish", [draft.id, check.certificate, firstOptions], () => engine.publish(draft.id, check.certificate!, firstOptions));
  assert.deepEqual(partial.steps.map(s => s.status), ["applied", "failed", "skipped"]);
  assert.equal(partial.state, "failed");
  assert.equal(effects.size, 1);
  assert.equal(partial.diagnostics[0]!.code, "task.owner_unavailable");
  // Fictional follow-up intent: the user accepts assigning Chen after the remote refusal.
  const repairOps = partial.diagnostics[0]!.candidates![0]!.repairOps!;
  draft = await call("edit", [draft.id, partial.preview.version, repairOps], () => engine.edit(draft.id, partial.preview.version, repairOps));
  const complete = await call("resume", [partial.id], () => engine.resume(partial.id));
  assert.equal(complete.state, "published"); assert.equal(effects.size, 3);
  assert.equal(complete.id, partial.id);
  assert.equal(complete.steps[0]!.key, partial.steps[0]!.key);
  assert.notEqual(complete.steps[1]!.key, partial.steps[1]!.key);
  assert.equal(complete.repairs![0]!.previousSteps[1]!.key, partial.steps[1]!.key);
  assert.deepEqual((steps.at(-1)!.remoteCalls as { method: string; input: { step: Step } }[]).map(call => [call.method, call.input.step.id]), [["apply", "task-1"], ["apply", "task-2"]]);
  await call("getRunInput", [complete.id], () => engine.getRunInput(complete.id));
  const reread = await call("getRun", [complete.id], () => engine.getRun(complete.id));
  assert.deepEqual(reread, complete);
  const report = { recordedAt: new Date().toISOString(), runtime: process.version,
    environment: "Real library + temporary SQLite; in-process simulated remote; no HTTP or LLM calls. Publish and resume use the same live engine; no restart or recovery.",
    registration: { definition, asyncRules: asyncRules.map(({ check, ...metadata }) => ({ ...metadata, implementation: check.toString() })), rules: rules.map(({ check, ...metadata }) => ({ ...metadata, implementation: check.toString() })) },
    asyncScenario: "首次预检返回 pending；测试驱动随后把模拟导出服务置为 ready，再次调用 preflight。不实际等待两秒，也不创建后台任务。",
    executionRepairIntent: "收到远端负责人不可用诊断后，假设用户同意改由陈接手；调用方选择对应 repairOps，edit 后 resume 原 Run。",
    userIntent, chosenOps: chosen, steps, effects: [...effects.entries()].map(([key, resource]) => ({ key, ...resource })) };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--write-report")) {
    const out = join(process.cwd(), "docs", "examples"); mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "publish-resume-trace.json"), JSON.stringify(report, null, 2) + "\n");
    const summary = (output: unknown): unknown => {
      if (output && typeof output === "object" && "steps" in output) {
        const run = output as Run;
        return { id: run.id, draftId: run.draftId, version: run.version, state: run.state,
          steps: run.steps.map(({ id, status, key, remoteRef, resolvedPayload }) => ({ id, status, key, remoteRef, resolvedPayload })), events: run.events };
      }
      return output;
    };
    const context = `## 先看这份有问题的 Draft\n\n下方是第一次 preflight 的实际 preview；三个节点都已填写内容，两个 contains 边显式关联项目与任务。\n\n\`\`\`json\n${JSON.stringify(blocked.preview, null, 2)}\n\`\`\`\n\n## 三条注册规则实际命中的诊断\n\n\`\`\`json\n${JSON.stringify(blocked.diagnostics, null, 2)}\n\`\`\`\n\n## 假设用户意图与调用方选择的 OP\n\n${userIntent}\n\n这是虚构的用户上下文，不是规则中的固定修复，也没有真实模型调用。\n\n\`\`\`json\n${JSON.stringify(chosen, null, 2)}\n\`\`\`\n\n应用后再次预检：${check.status}，diagnostics=${JSON.stringify(check.diagnostics)}。\n\n## 注册给库的 schema 和规则\n\n组装方式：createStagedWrite({ definitions: [definition], rules, asyncRules, mode: "executable", storage, executors: [executor] })。\n\nSchema 原始值：\n\n\`\`\`json\n${JSON.stringify(definition, null, 2)}\n\`\`\`\n\n${rules.map(rule => `### ${rule.id}@${rule.version}\n\n\`\`\`ts\n${rule.check.toString()}\n\`\`\``).join("\n\n")}\n\n规则函数使用的辅助函数见 [完整 fixture](../../examples/fixtures/project-tasks.ts)。下面继续列出真实 API 输入输出及请求映射。\n\n`;
    const sections = steps.map((entry, i) => `## ${i + 1}. ${entry.method}\n\n输入（参数顺序）：\n\n\`\`\`json\n${JSON.stringify(entry.input, null, 2)}\n\`\`\`\n\n输出${entry.method === "close" ? "（void，以 null 记录）" : ""}：\n\n\`\`\`json\n${JSON.stringify(summary(entry.output), null, 2)}\n\`\`\`\n\n本步异步检查：\n\n\`\`\`json\n${JSON.stringify(entry.checkCalls, null, 2)}\n\`\`\`\n\n本步远端调用：\n\n\`\`\`json\n${JSON.stringify(entry.remoteCalls, null, 2)}\n\`\`\`\n\n模拟资源总数：${entry.effectCount}。`).join("\n\n");
    writeFileSync(join(out, "publish-resume-walkthrough.md"), `# Create → Publish → Resume 实际运行记录\n\n**遵循 [项目原则](../design/000-project-principles.md)；原则冲突先与项目所有者讨论。**\n\n运行时间：${report.recordedAt}，Node ${report.runtime}。\n\n实际执行本仓库代码和 SQLite；远端是进程内模拟，没有发送真实 HTTP，也没有调用大模型。首次 publish 返回业务诊断，调用方 edit 修复后在同一引擎 resume；没有进程故障、重启或 recover。\n\n[可运行源码](../../examples/publish-resume.ts) · [完整原始 JSON](publish-resume-trace.json)。运行 npm run demo:publish-resume；加 -- --write-report 可更新此记录。\n\n调用链中的 Draft ID、版本、凭据、Run 和事件来自程序输出。Run 的展示省略顶层 binding 与部分步骤声明，完整数据见 JSON。\n\n${context}${sections}\n`);
  }
} finally { engine.close(); rmSync(directory, { recursive: true, force: true }); }
