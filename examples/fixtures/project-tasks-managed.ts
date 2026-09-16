import { defineDraftType } from "../../src/index.js";
import type { ManagedInitialIntent, ManagedDraft, GraphDiagnostic, EditBatch, ManagedRule, Value } from "../../src/index.js";
/** Entirely fictional project/task schema and business policies for the walkthrough. */
export const definition = defineDraftType({ id: "example.project-tasks", version: "2", nodeTypes: {
        project: { valueSchema: { type: "object", properties: {
                    name: { type: "string", minLength: 1, description: "项目名称" },
                    capacityHours: { type: "integer", minimum: 1, description: "本期可用总工时" },
                    deadlineDay: { type: "integer", minimum: 1, maximum: 30, description: "本期截止日，1–30" }
                }, additionalProperties: false }, requiredAtPublish: ["name", "capacityHours", "deadlineDay"] },
        task: { valueSchema: { type: "object", properties: {
                    name: { type: "string", minLength: 1 },
                    estimateHours: { type: "integer", minimum: 1 },
                    dueDay: { type: "integer", minimum: 1, maximum: 30 },
                    priority: { type: "string", enum: ["normal", "urgent"] },
                    owner: { type: ["string", "null"], description: "负责人；紧急任务必须明确指定" }
                }, additionalProperties: false }, requiredAtPublish: ["name", "estimateHours", "dueDay", "priority"] }
    }, relationTypes: { contains: { from: ["project"], to: ["task"], ownership: "owned", cardinality: "many" } } });
export const selector = { type: definition.id, typeVersion: definition.version };
export const value = (node: ManagedDraft["graph"]["nodes"][string], field: string): Value => {
  const v = node.fields[field] ?? null;
  if (v !== null && typeof v === "object") throw new Error(`Expected scalar field ${field}`);
  return v;
};
const at = (id: string, field: string) => `/nodes/${id.replaceAll("~", "~0").replaceAll("/", "~1")}/fields/${field}`;
const tasksFor = (draft: ManagedDraft, project: ManagedDraft["graph"]["nodes"][string]) => Object.values(draft.graph.edges)
    .filter(edge => edge.relationType === "contains" && edge.from === project.id).map(edge => draft.graph.nodes[edge.to]!);
export const rules: ManagedRule[] = [
    { ...selector, id: "project.capacity", version: "2", check: draft => {
            const issues: GraphDiagnostic[] = [];
            for (const project of Object.values(draft.graph.nodes).filter(n => n.nodeType === "project")) {
                const tasks = tasksFor(draft, project), capacity = value(project, "capacityHours");
                const hours = tasks.map(task => value(task, "estimateHours"));
                if (typeof capacity !== "number" || hours.some(h => typeof h !== "number"))
                    continue;
                const total = (hours as number[]).reduce((a, b) => a + b, 0);
                if (total > capacity)
                    issues.push({ code: "project.capacity_exceeded", path: at(project.id, "capacityHours"),
                        message: `项目“${value(project, "name")}”容量为 ${capacity} 小时，但 ${tasks.map(task => `“${value(task, "name")}”${value(task, "estimateHours")} 小时`).join("、")}，合计 ${total} 小时，超出 ${total - capacity} 小时。`,
                        hint: "可以缩减任务范围、将部分工作移到下一期，或在用户允许时增加容量；请根据用户意图选择。",
                        related: tasks.map(task => at(task.id, "estimateHours")),
                        stage: "work-planning", metadata: { capacityHours: capacity, totalHours: total, excessHours: total - capacity, unit: "hours" },
                        repairs: [{ id: "expand-capacity", message: "若用户允许追加容量，可提高到当前任务总工时；这不会解决日期或负责人问题。",
                                ops: { patches: [{ op: "set", ref: project.id, scope: "canonical", path: "/capacityHours", value: total }] } }] });
            }
            return issues;
        } },
    { ...selector, id: "task.deadline", version: "2", check: draft => {
            const issues: GraphDiagnostic[] = [];
            for (const project of Object.values(draft.graph.nodes).filter(n => n.nodeType === "project"))
                for (const task of tasksFor(draft, project)) {
                    const deadline = value(project, "deadlineDay"), due = value(task, "dueDay");
                    if (typeof deadline === "number" && typeof due === "number" && due > deadline)
                        issues.push({
                            code: "task.after_project_deadline", path: at(task.id, "dueDay"),
                            message: `任务“${value(task, "name")}”安排在第 ${due} 天完成，晚于所属项目的第 ${deadline} 天截止日。`,
                            hint: "可以提前该任务、调整项目截止日，或将任务移到下一期；不要自行假设用户同意延期。",
                            related: [at(project.id, "deadlineDay")],
                            repairs: [
                                { id: "earlier-task", message: "若任务可以提前，将它安排到项目截止日。", ops: { patches: [{ op: "set", ref: task.id, scope: "canonical", path: "/dueDay", value: deadline }] } },
                                { id: "later-project", message: "若用户接受整个项目延期，将项目截止日延到该任务完成日。", ops: { patches: [{ op: "set", ref: project.id, scope: "canonical", path: "/deadlineDay", value: due }] } }
                            ]
                        });
                }
            return issues;
        } },
    { ...selector, id: "task.urgent-owner", version: "2", check: draft => {
            const issues: GraphDiagnostic[] = [];
            for (const task of Object.values(draft.graph.nodes).filter(n => n.nodeType === "task")) {
                const owner = value(task, "owner");
                if (value(task, "priority") === "urgent" && (typeof owner !== "string" || !owner.trim()))
                    issues.push({
                        code: "task.urgent_owner_required", path: at(task.id, "owner"),
                        message: `任务“${value(task, "name")}”优先级为 urgent，但负责人${draft.fieldIntents[task.id]?.["/owner"]?.kind === "remove" ? "被明确清空" : "没有有效值"}；紧急任务必须有负责人。`,
                        hint: "指定能接手的负责人，或在用户允许时降低优先级；候选人仅供选择，不代表已获授权分配。",
                        candidates: [
                            { value: "lin", label: "林", message: "本期可以承接文档任务（虚构候选）", metadata: { availableHours: 8, skills: ["documentation"] },
                                repairOps: { patches: [{ op: "set", ref: task.id, scope: "canonical", path: "/owner", value: "lin" }] } },
                            { value: "chen", label: "陈", message: "本期可以承接评审任务（虚构候选）", metadata: { availableHours: 4, skills: ["review"] },
                                repairOps: { patches: [{ op: "set", ref: task.id, scope: "canonical", path: "/owner", value: "chen" }] } }
                        ],
                        excludedCandidates: [{ value: "zhou", label: "周", message: "本期不可参与（虚构约束）", metadata: { available: false } }],
                        constraintIds: ["demo-current-period-availability"],
                        repairs: [{ id: "lower-priority", message: "只有用户同意降低优先级时，才考虑保留负责人清空状态并改为普通任务。",
                                ops: { patches: [{ op: "set", ref: task.id, scope: "canonical", path: "/priority", value: "normal" }] } }],
                        related: [at(task.id, "priority")]
                    });
            }
            return issues;
        } }
];
export const initial: ManagedInitialIntent = {
    nodes: {
        "project-1": { id: "project-1", nodeType: "project", fields: {
                name: "文档发布", capacityHours: 16, deadlineDay: 20
            } },
        "task-1": { id: "task-1", nodeType: "task", fields: {
                name: "编写快速入门", estimateHours: 12,
                dueDay: 22, priority: "urgent", owner: null
            } },
        "task-2": { id: "task-2", nodeType: "task", fields: {
                name: "评审使用示例", estimateHours: 10,
                dueDay: 18, priority: "normal", owner: "chen"
            } }
    },
    edges: {
        "contains-1": { id: "contains-1", relationType: "contains", from: "project-1", to: "task-1" },
        "contains-2": { id: "contains-2", relationType: "contains", from: "project-1", to: "task-2" }
    }
};
// Fictional user context for choosing edits. This does not come from the registered rules.
export const userIntent = "项目容量保持 16 小时，截止日保持第 20 天；两个任务本期各交付 8 小时范围的最小版本；快速入门仍为紧急任务，由林负责并在第 20 天完成。";
export const chosen: EditBatch = { patches: [
    { op: "set", ref: "task-1", scope: "canonical", path: "/estimateHours", value: 8 },
    { op: "set", ref: "task-2", scope: "canonical", path: "/estimateHours", value: 8 },
    { op: "set", ref: "task-1", scope: "canonical", path: "/dueDay", value: 20 },
    { op: "set", ref: "task-1", scope: "canonical", path: "/owner", value: "lin" }
] };
