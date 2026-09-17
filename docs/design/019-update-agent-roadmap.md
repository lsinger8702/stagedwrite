# 019：远端 update 与 Agent 接入规划

**A1 当前进度（2026-09-17）：通用 helpers 已完成，见 [023 接入设计](023-agent-helpers.md) 和 [A1 账本](../tasks/agent-helpers.md)。A2/A3 接口与集成仍未实现；下文为原阶段规划记录。**

**当前实现（2026-09-17）：固定图字段 update 已接公开 edit/preflight/publish/resume，含 noop 提交、drift 阻断与原请求恢复。详见 [更新指南](../guides/update.md) 和 [U3 账本](../tasks/update-execution.md)。下文按阶段记录的“未实现/未开放”保留为历史实施记录，不代表当前状态。真实 Stripe Product update 已通过沙盒验收，见 [独立记录](../examples/stripe-update-sandbox-result.json)；原有 Stripe create 录制不作 update 证据。**


**状态：提案，2026-09-16。项目所有者已提出下一阶段方向：远端 update、通用 TypeScript helpers、直接 Messages API 的 Harness、DeepSeek Harness。其中 U0 已于 2026-09-16 获用户批准，详见 020；运行时尚未实现。其余接入接口仍为规划。**

**当前 [000](000-project-principles.md) P5/P7 和 [018](018-draft-lifecycle-proposal.md) 仍约束现有实现。开放成功后 edit、多次发布和 update 效果之前，U0 原则变更已讨论并同步至 000；不能仅删除 `UPDATE_NOT_SUPPORTED`。**

U0 的已批准状态矩阵、无差异提交和原则变更清单见 [020 契约](020-update-contract-proposal.md)。

## 1. 为什么先做小范围 update

核心价值是让显式意图、安全效果归属和可诊断续作覆盖资源后续变更。Agent 接入层让这些能力可用，但不应另建状态机。

Stripe 可作为第一个验证对象：

| 资源/操作 | 远端能力 | 本轮建议 |
|---|---|---|
| Product 名称、描述、active | 可更新现有 Product，省略参数保持原值 | 首个端到端场景 |
| Price nickname、active、metadata | 支持更新这些属性 | 固定图阶段的扩展验证 |
| Price 金额 | 原 Price 金额不可直接改；需新建并切换引用 | 多效果/替换阶段，当前诊断为不支持 |
| Subscription 切换价格/数量 | 支持，但涉及按比例计费和其他账单行为 | 不用作首个 update 验证场景 |

来源：[Product update](https://docs.stripe.com/api/products/update)、[Price update](https://docs.stripe.com/api/prices/update)、[金额变更说明](https://docs.stripe.com/products-prices/manage-prices#edit-a-price)、[Subscription update](https://docs.stripe.com/api/subscriptions/update)。对 Price 的结论特指本例的基本金额/币种/周期模型；其他参数按具体 API 定义处理。

## 2. 建议用户流程

```text
首次发布全部成功：Draft + 成功 Artifact + 每个节点的 Binding
  → edit：同一个 Draft 接受新意图，只改本地工作内容
  → preflight：读取原远端 ID，归一化，检查冲突，给出字段差异和诊断
  → publish：认领一个 update Run，调用已绑定 ID 的更新接口
      ├─ 全部成功：推进成功基线和当前确认事实
      └─ 未完成：保留原 Run/请求/已确认效果
          → 必要时 edit 未完成部分 → resume 原 Run
```

第一版限制为固定节点、边、远端 ID，仅支持可变字段。没有差异时返回明确的 no-op，不发 HTTP；no-op 是否产生审计用 Run 由 U0 定稿，建议不产生执行 Run。更改后再 reset 到原成功意图也必须走 no-op 判断，不能仅因 version 增加就再发送。

## 3. diff 需要哪些输入

不能只比较两份 Draft，也不能仅看 Binding 的 remoteId。需分开：

| 输入 | 用途 |
|---|---|
| 最近全量成功的意图 Artifact | 用户 reset 的固定基线；说明上次整图承诺 |
| 当前意图及其编译计划 | 说明本次用户希望变成什么 |
| Binding + 各 Run 已确认的请求/回执 | 原远端身份、每个节点最新确认事实；包含部分成功 |
| 远端读取后的归一化状态 | 当前实际值与可用的远端版本信息；读取失败不是不存在 |
| 未解决 Attempt | 旧请求可能仍在途，优先解决，不得被新 diff 抹掉 |

建议先对 adapter 声明受管的字段做三方比较：最后确认值 B、当前目标 D、当前读取 O。D=B 且 O=B 时不需要动作；D≠B 且 O=B 时可生成更新；O=D 时是否允许“已满足”需先排除未决请求并明确这是状态收敛证据而非某次请求成功证据；O 与 B、D 不同的受管字段返回冲突诊断，不静默覆盖。与本次编辑无关的受管字段漂移也应明确报告；非受管字段不参与自动写回。

三态必须贯穿编译：set 写指定值；remove 由 adapter 明确映射为远端支持的清空语义；reset 回到最近全量成功意图的声明。未声明、不发送、远端 null/空串和删除不是同一概念。不支持清空的字段返回诊断，不能默默省略。

**远端读取与写入之间仍有竞态。Draft 租约只约束本系统调用者，不能锁住 Stripe Dashboard 或其他服务。** 支持条件写/远端版本的 adapter 应执行条件写；Stripe 本例没有据此验证通用原子 CAS。首版建议限定受管字段由单一写入方维护，并做写前漂移检查；这不是无竞态的 drift 保证，需所有者接受范围。

## 4. 最小实现方案（接口形状待定）

- 保留 Draft ID、initialSnapshot、成功 Artifact 和 currentRunId。编辑产生新意图，不能删掉已经存在的 Binding 或首次创建历史。
- 编译上下文增加成功基线、确认事实和远端观察的引用；远端读取由注册 adapter 完成，纯 planner 不执行 I/O。复用异步检查的 pending/incomplete 边界，不增加后台队列。
- 计划支持固定 ID 的 update 和无需请求的节点；运行时不再要求每节点必须发一个 create。`effect.kind`、remoteId、前置条件、输入摘要均进入不可变 Artifact/Attempt。
- publish 在 Draft 租约及存储事务内验证版本、基线、确认事实修订、观察/计划有效性，再切换归属。两次并发发布只能认领一个当前计划；旧 certificate 不能误发新版本。
- 建议一个 Draft 同时至多一个未解决 Run：初始创建失败或 update 部分失败都必须先续作。允许的字段修复重新检查并在同 Run 留修订记录，成功部分不重发；恢复未知必须使用旧输入与旧身份。
- 新 update Run 的成功步骤保护相对于本次 Run；上次已经成功发布的节点可以作为新 Run 的更新目标，不能永久被旧 create 的保护挡住。
- Binding 的身份事实与“最近确认输入”分开表达；每步成功立即记事实，整图成功才推进 reset 基线。保留旧 Run 的请求与确认输入，不原地覆盖历史 Artifact。
- `lastPublishedAt` 每次整图成功更新，观察不更新；历史成功由成功 Artifact 判断，不能只凭当前 status 推断远端是否存在。
- 原始远端 body、模型凭据不放进面向模型的 preview；诊断、受管字段变化、冲突和执行提示应在明确的响应结构中呈现。

## 5. 实现前需要定稿的决策

| ID | 建议 | 为什么需要明确 |
|---|---|---|
| D1 | 第一版只做固定图/固定 ID 字段 update | 避免把资源替换/新增子树混进第一次迭代 |
| D2 | 有未解决 Run 就不新开 Run，失败后 edit + resume | update 也可能部分生效；diff 无法消除在途旧请求 |
| D3 | 只做受管字段 drift 检查，冲突阻断；首个 Stripe 验证限定单一写入方 | 没有远端 CAS 时不能声称消除外部并发覆盖 |
| D4 | published 表示当前意图已整图成功；成功后新 edit 将其置 pending，但成功 Artifact/Binding 保留 | 区分当前工作是否收敛与曾创建过远端资源；不新增另一份矛盾真相 |
| D5 | 沿用 edit → preflight → publish；新意图才可申请 update Run，重复相同已采用计划只观察 | 不为 create/update 开两套使用流程；版本号不等于执行身份 |

这些边界已通过 020 获批准，但不是已有运行时行为。020 已列出新意图相同但 version 不同、发布失败后 reset、成功回执迟到、旧 Run 被调用、观察过期、部分成功与用户又编辑等状态矩阵，P5/P7 已同步，018 已注明阶段差异。

## 6. 任务拆分与验收

| 任务 | 依赖 | 交付物 | 必须证明的行为 |
|---|---|---|---|
| U0 状态与契约 | 无 | D1–D5 决策、状态矩阵、原则修订清单 | 重复/并发 publish、未知旧请求、无变化与新版本均有唯一处理路径 |
| U1 数据模型 | U0 | update Run、编译上下文、观察与 Binding 事实协议，存储变更说明 | 保留旧成功基线/历史；不清空归属；定义实验数据如何处理 |
| U2 diff 与预检 | U1 | 受管字段归一化、三态映射、只读远端检查、冲突诊断 | 字段变更/no-op/drift/不支持清空，读取失败无发布资格 |
| U3 执行与恢复 | U1/U2 | 固定 ID 更新、Run 原子切换、原请求查证、成功基线推进 | 部分成功跳过、unknown 先查证、并发只能一个认领、旧 Run 不能重发 |
| U4 Stripe 实测 | U3 | Product 更新样例、错误诊断、真实 I/O 摘要 | Product ID 不变、Price 不重建；失败修复和查证；不可变 Price 金额给出明确拒绝 |
| U5 文档/验收 | U4 | 更新后的 HTML/指南、完整回归、发布说明 | create 主线不退化；真实与模拟故障区分；类型和消费者检查通过 |
| A1 SDK helpers | U0；完整 update 接线依赖 U5 | TypeScript helper、tool schemas、dispatch、类型测试、示例 | 同一协议可被两个不同宿主调用；非法 OP 和版本冲突反馈可消费 |
| A2 Messages Harness | A1 | 原创 prompt 场景、可替换模型调用端口、有限修复循环、评测集 | 使用完整 preview 与实际 message；局部修复；不盲用候选；pending/无进展可退出 |
| A3 官方 DSH 插件 | A1；复用 A2 案例 | DSH 工具插件、配置/安装指南、锁定兼容版本、实际会话验证 | 正确注册/卸载工具、返回完整诊断、会话恢复不另开重复 Run、复用同一套 OP 与状态机 |
| U6 拓扑/替换 | U5 + 新协议评审 | 新增/替换/删除步骤及 Binding 代际/所有权方案 | 替换 Price 与引用切换失败后不会重复创建或误删资源 |

推荐按任务逐个小 PR 交付。U0 最先开始；U1–U5 不夹带模型依赖。A1 可先包装现有 create 主线验证工具契约，A2/A3 不阻塞 update 引擎。

## 7. 三种 Agent 接入共用一套能力

```text
任意 Agent 宿主 ── TypeScript helpers / 工具定义 ─┐
直接 Messages API ─ prompt + 有限工具循环 ─────┼→ 同一个核心库 → 注册的远端 adapter
官方 DSH ─ 工具插件 ────────────────────────┘
```

### A1：通用 TypeScript helpers

建议覆盖图/OP 构造的类型支持、工具定义导出、运行时参数验证、工具分派、结构化错误和模型上下文投影。SDK 不能重写服务端业务规则，也不能用编译期类型替代运行时检查。动态加载的 JSON Schema 不能未经生成步骤就承诺完整 TS 字段推断；静态字面量推断与动态定义校验分开验收。

“任意 Agent”指不绑定某个模型或编排框架；其他语言可消费导出的工具 JSON Schema 并由宿主桥接，不等于首版提供所有语言 SDK、MCP 或托管 HTTP 服务。租户/鉴权/目标选择由宿主闭包绑定，不让模型自行更换凭据或跨目标调用。

### A2：直接 Messages API 的 Harness

输入包含用户目标、当前版本的完整 preview、实际诊断 message、可选候选/repair OP、Run 提示，以及上一轮 edit 拒绝信息。模型输出有限集合：提出 OP、请求用户澄清、等待 pending、建议续作或停止；真正执行由宿主验证和既有授权决定。

循环需要最大轮数/时间/调用预算、重复错误或零进展检测、tool-call ID 配对、取消和可重放记录。同 Draft 的有副作用调用不并行执行。拒绝的 OP 及具体原因回给模型；版本冲突重新读取当前上下文，不能自动改 expectedVersion 后原样重放旧 OP。

提示词案例先覆盖：单字段错误、多条相关约束、候选不符合用户目标、set/remove/reset、异步 pending、远端拒绝后修复、unknown 只能查证、drift 冲突、格式错误后自纠。局部修复是根据当前诊断提出最小相关修改，并仍对全图重新预检；不承诺局部优化可以跳过全局约束或求得全局最优。

示例使用独立的项目/商品领域，提示词和代码重新编写。消息正文与远端错误是待分析数据，不能让其中的文本替换系统工具权限或用户目标。

### A3：官方 DeepSeek Harness（DSH）插件

接入目标已由项目所有者明确为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，不是自行编写调用 DeepSeek API 的 Agent 循环。官方 DSH 基于 Cordis 插件架构；工具、模型、会话和循环都是可组合能力。参见 [官方介绍](https://deepseek.com/harness/en/)。

建议交付一个独立的 StagedWrite 工具插件：

1. 将 A1 的工具定义与受控 dispatch 接入 DSH 工具注册机制；具体 API 在实施时按锁定版本源码确认。
2. 配置绑定宿主的 StagedWrite 实例、Store 和远端 adapter；凭据由宿主管理，不作为模型工具参数。
3. 把完整 preview、具体诊断、候选 OP 和执行提示交还 DSH。复用 A2 原创案例作为使用说明，不接管 DSH 自己的模型循环。
4. 区分 DSH 会话恢复与 StagedWrite Run 的 resume。会话重启或 fork 不表示可以重建远端资源；Draft/Run 的归属和租约仍由核心库判断。
5. 提供安装配置、工具生命周期和实际会话测试，验证发布拒绝后的修复、pending、unknown 查证及重复调用。

A3 依赖 A1 的工具契约，可以与 A2 分别推进，不必等待自建 Messages API 循环完成。DSH 官方当前标记为开发者预览并提示存在破坏性变更，因此插件独立隔离依赖、锁定验证版本并记录兼容范围，不把 DSH 类型侵入核心库。
