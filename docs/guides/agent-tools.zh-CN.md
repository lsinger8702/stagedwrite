# Agent 接入：通用 TypeScript helpers

[English / 完整字段表](agent-tools.md) · [设计](../design/023-agent-helpers.md) · [账本](../tasks/agent-helpers.md)

`createAgentTools` 把现有引擎包装成七个工具，负责输入校验、宿主授权和面向模型的结果。它不调用大模型、不自动选修复、不自动重试。

```ts
import { createAgentTools } from "stagedwrite";

const agent = createAgentTools({
  engine,
  definition, // 与引擎注册的同一定义
  authorize: async ({ tool, input }) => {
    // userId 来自宿主认证上下文，不能是模型参数。
    if (tool === "stagedwrite_create") return canCreateDraft(userId);
    return canActOnDraft(userId, input.draftId, tool);
  },
  onError: error => logForOperator(error),
});

// 交给宿主/模型：字段与关系定义 + 工具协议。
const vocabulary = agent.draftDefinition;
const tools = agent.tools;
const result = await agent.dispatch(toolName, parsedArguments);
```

工具是 create/context/preview/edit/preflight/publish/resume，完整名称带 `stagedwrite_` 前缀。工具 schema 使用 JSON Schema 2020-12；不同模型供应商的格式转换由宿主完成，不保证所有供应商都支持原样递归 schema。静态 invoke 检查协议类型，具体节点字段仍由运行时注册 schema 验证。

调用顺序仍由上游决定：create 必须有初始内容；preflight 返回当前完整 preview 和真正命中的 message/候选建议；模型或用户提出三态 batch；edit 只返回回执；再次 preflight 或按未完成 Run 调用 resume。没有静默修复，也不会在版本冲突时替你重放旧 OP。

- `ok: true` 表示工具调用完成，不等于发布成功。继续看 data.status/data.state 中的 blocked/pending/incomplete/unknown。
- `ok: false` 带 code/message/hint；保留版本冲突、批次冲突等具体编辑问题。未知内部异常只交给宿主 onError，不能据此判断远端没生效。
- context 只读取当前版本与图，不偷偷执行预检；preview 的候选版本/ref 尚未落库，不能当已提交身份。
- publish/resume 保留诊断与当前图，只给步骤状态，不暴露 attempts、原始请求、幂等 key、远端 Binding 和历史快照。注册方仍需保证诊断 metadata/业务字段适合给模型看。
- authorize 必填，每次调用先检查用户对 Draft 和动作的权限。create 成功后宿主要持久记录新 ID 的归属；resume 同时核验 Draft/Run 对应，不能拿一个获准的 Draft ID 续作别人的 Run。模型参数里没有凭据、租户、目标或 definition 选择。

运行 `npm run demo:agent` 可看[两个宿主](../../examples/agent-hosts.ts)共用同一个 helper：对象函数工具注册与 JSON 文本消息分派。示例真实执行库和规则，远端与决策为 mock/脚本，没有大模型或网络调用；示例中的内存归属 Set 不替代生产环境的持久权限存储。

测试覆盖两个宿主的诊断修复、pending、远端拒绝、unknown 查证、update/noop、版本冲突与授权拒绝。A1 不等于 A2 Messages API 自动修复循环或 A3 官方 DSH 插件完成。

### 模型 preview 坐标

所有 helper preview 保留完整节点字段，出边统一显示为 `nodes[ref].relations["/slot"] = [targetRef]`；关系槽位采用 JSON Pointer 转义，共享目标仍是同一个 ref。不暴露内部边表或边墓碑。非空的 `removedNodeRefs` 保留删除身份以支持基线 reset，并附 hint；**它不是可恢复性承诺**，应先 preview，缺失基线端点和生命周期限制仍会拒绝。诊断保留原图坐标及候选建议。

不存在的 Run 和其他 Draft 的 Run 均返回相同的 `RUN_UNAVAILABLE`。原始原因仅交宿主错误回调；这保证响应内容不区分两者，不保证查询耗时相同。
