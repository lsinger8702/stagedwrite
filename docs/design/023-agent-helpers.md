# 023：A1 通用 Agent helpers

**遵循 000、019 和三态 OP 原则。A1 只包装现有引擎；不修改 Draft/Run/租约/编译/修复语义，不内置模型循环。**

## 接入边界

`createAgentTools({ engine, definition, authorize, onError? })` 绑定宿主的一个引擎及一个注册定义。宿主必须传入与引擎一致的定义；它通过独立 `draftDefinition` 交给模型，包含节点字段和关系定义，不包含规则目录。工具参数不能更换 definition、租户、target 或凭据。

工具为 create/context/preview/edit/preflight/publish/resume。每个独立 inputSchema 使用 JSON Schema 2020-12，复用现有 initialIntentSchema/editBatchSchema 的闭集三态协议；不同模型的 schema 子集转换由宿主负责，不宣称可原样传入所有模型供应商。

宿主 `authorize` 是必填函数：收到已验证、不可变的工具名/参数（含 Draft ID）；返回 true 才访问引擎。身份来自宿主闭包，不作为模型参数。create 成功后宿主将新 ID 持久归属到当前用户/会话；后续授权须核验归属。resume 同时要求 draftId/runId，helper 校验 Run 归属，不能用允许访问的 Draft 去续作别人的 Run。业务目标允许哪些写入仍由宿主授权，不把预检证书当授权。

`dispatch(name, unknown)` 用于不可信工具调用；`invoke(name, typedInput)` 提供 TypeScript 协议类型。两者进入同一运行时验证及分派，不静默丢字段、不强制转换类型、不填缺省值。不提供业务字段字面量的自动 TS 推断；节点的具体字段由注册 Schema 在运行时验证。

## 模型结果

统一返回 `ok/tool/data` 或 `ok/tool/error`。ok=true 只表示调用成功，preflight blocked/pending/incomplete 和 publish unknown/blocked 仍必须查看 data 的领域状态。

- create：draftId、version、完整 preview、createdRefs；初始意图不可空，不隐式 preflight。
- context：当前版本、Draft 状态、currentRunId、完整 preview；不读取或复用旧检查作为发布资格。
- preview：候选图的完整 preview、changes、createdRefs；不落库，无发布证书。候选 ref 仍不可当真实 ref 使用。
- edit：现有轻量回执，不附完整持久草稿；后续显式 preflight。
- preflight：完整 preview、具体诊断及所有候选建议、pendingRules、certificate/执行提示；update 只给字段变更，不给原始 plan payload/target。
- publish/resume：Run/noop/not_started 状态、历史/当前标记、preview、诊断和每步 ID/nodeId/status；不返回 attempts、原始请求、回执、绑定、执行 key 或历史快照。

具体业务诊断按原协议保留；注册方须保证面向模型的 message/metadata 不包含秘密。库不会尝试通过关键词自动脱敏业务数据。未知异常使用通用 message/hint，原始异常只交宿主 onError；错误不能被解释为请求未生效。版本冲突不自动重试，只提示读取新 context 并重新规划。

## 验收

非法/非 JSON 输入和未知工具零引擎调用；宿主拒绝/异常无越权；resume 归属错误不派发；create 有初始内容；拒绝带 message/hint；完整 preview 与候选不丢失；旧版本 OP 不重放；两个宿主（对象函数工具注册、JSON 文本消息分派）使用同一 helper 完成诊断修复；公开包导出/类型消费通过。

A2 的预算/停止策略/提示词/模型循环、A3 官方 DSH 集成仍独立推进；A1 不提供服务框架、自动重试或额外状态机。

## A1 review 收尾 — 2026-09-17

- Agent 侧将不存在和其他 Draft 的 Run 统一为 `RUN_UNAVAILABLE`，message/hint 相同；宿主 `onError` 仍可收到原始原因。此项消除响应内容的存在性区别，不声称全库查询具备恒定时间。
- 所有 preview 共用模型投影：保留完整节点字段/三态，节点下 `relations` 以单段 JSON Pointer 为键、目标 ref 数组为值。共享引用保持共享，不展开成树；不输出原始边 ID 表和边墓碑。
- 非空时保留 `removedNodeRefs` 和解释性 hint：这些是已删除身份，不是“可恢复清单”。基线节点 reset 可能需要先恢复端点，也受生命周期限制；基线外已删除节点不能靠 reset 复活。用 preview 验证，不从删除状态推断授权或可恢复性。
- create/context/preview/preflight/publish/resume（包括嵌套 check）使用同一投影，不额外读取当前 Draft 替换检查时的 preview。诊断及候选保持原协议、原图坐标；关系槽位显示使用编辑协议的 JSON Pointer。引擎和存储 preview 不变。
