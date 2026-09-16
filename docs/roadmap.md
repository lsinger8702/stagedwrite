# Roadmap

**当前最高优先级：按所有者新决定完成 [三态 OP 迁移](design/022-three-state-op-migration.md)。执行进度只维护在 [任务账本](tasks/three-state-op-migration.md)。下方 update/Agent 路线保留，update 派发待迁移后恢复。**

**当前实现以 [000 原则](design/000-project-principles.md) 和 [018 契约](design/018-draft-lifecycle-proposal.md) 为准。2026-09-16：项目所有者要求将远端 update 与三种 Agent 接入方式纳入下一阶段。本页确定规划方向；具体接口、状态迁移和原则变更见 [019 提案](design/019-update-agent-roadmap.md)，U0 契约已获批准并同步原则，尚未据此开放运行时能力。**

## 已实现：首次创建与修复闭环

- 非空初始意图、普通 Graph + fieldIntents、固定基线 reset。
- currentRunId 原子认领；重复 publish 观察；edit 后 resume 同一 Run。
- 具体诊断、完整 preview、异步 pending；Artifact、逐节点 Binding、原请求账本。
- 外部锁/Store 端口，内存和共享本地 SQLite；成功节点及拓扑保护。
- 单一引擎入口；可运行 walkthrough、HTML/ZIP 完整性校验、隔离打包验证。
- [真实 Stripe 沙盒样例](../examples/stripe/README.md)：Product → 两条 Price，远端拒绝 → 修复 → 续作，回执丢失注入后的只读查证；离线回归进入 CI。不是完整生产 provider。

## 优先级与交付顺序

| 优先级 | 工作包 | 目标 | 完成标志 |
|---|---|---|---|
| P0 | U0：update 契约定稿 | 固定成功基线、Run 切换、Binding、diff 和 drift 的职责 | [状态矩阵已批准](design/020-update-contract-proposal.md)，原则已同步 |
| P0 | U1–U5：固定图字段 update | 已发布 Draft 承接新意图，更新原远端 ID，失败仍可修复/续作 | Stripe Product 更新闭环、故障回归、真实 I/O 样例 |
| P1 | A1：通用 TypeScript SDK helpers | 任意 Agent 宿主可接入类型/工具定义/调用分派 | 非模型专属 SDK；类型和运行时输入检查；示例宿主 |
| P1 | A2：直接 Messages API 的 Harness | 教模型用 preview + message 诊断产生局部 OP | 可运行有限修复循环、原创 prompt 案例及离线评测 |
| P2 | A3：DeepSeek Harness 集成 | 接入官方 deepseek-ai/deepseek-harness（dsh） | DSH 工具插件、安装指南与实际会话验证 |
| P3 | U6：新增、替换、删除资源 | 覆盖新增子树及不可原地修改的资源 | 多效果计划、Binding 历史、部分成功与未知归属先定协议 |
| P3 | 运维与分发 | 外部试用、安装包、跨主机后端、人工处置 | 按实际需求逐项验收，不把本地锁验证等同跨主机能力 |

建议主线：**U0 → U1–U5 → A1 → A2 / A3 → U6**。A1 的工具输入输出梳理可在 U0 后利用现有 create 能力先做；不要把三种接入做成三套业务引擎。跨主机 Store、Saga rollback、调度、推导层、完整编辑历史不阻塞本轮。

## 本轮 update 的建议边界

先更新固定图中已绑定资源的可变字段，例如 Stripe Product 的名称/描述/active，以及后续可选的 Price nickname/active。**不把修改 Price 金额伪装成原地 update**：需要新建 Price 并切换引用，应放在 U6。

edit 只修改 Draft 意图；preflight 读取/归一化所需远端事实、诊断并形成计划；publish 执行；未完成 Run 用 resume。已批准“一个 Draft 同时至多一个未解决 Run”，细则见 020。每次 update 都无条件新建 Run、用 diff 自动消除所有重复创建风险，均不是已批准结论。

## 三种接入方式

1. **TypeScript SDK helpers**：Schema/Graph/OP 类型支持、工具 schema、受控 dispatch、结构化错误和模型上下文投影；不内置某家模型，不代替运行时校验，不默认自动重试或自动修复。
2. **Messages API Harness**：直接发送 prompt、工具定义和响应，演示“当前 preview + 具体诊断 + 用户目标 → 少量 OP → edit → preflight/resume”；包括 pending、版本冲突、拒绝反馈和无进展停止。不只交付几段 prompt。
3. **DeepSeek Harness（官方 DSH）**：以 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 为接入目标，提供工具插件，复用 A1 的工具与分派、A2 的诊断案例。会话和模型循环由 DSH 承担，Draft/Run/Binding 仍由 StagedWrite 管理；不另写 DeepSeek API 循环替代这项集成。A3 依赖 A1，可与 A2 分别推进。

后续是否提供 MCP、HTTP 服务或其他语言绑定，根据真实使用者决定，当前不为“任意 Agent”额外引入服务框架。

2026-09-16：U0 已获批准；[U1 数据模型设计](design/021-update-data-model.md)第一批模型/存储基础已实现；完整执行模型和 update 链路尚未接通。

2026-09-16：U2 纯编译基础已实现，含三方 diff、具体 drift 诊断及 unknown 阻断；尚未接入公开 preflight/远端执行。

2026-09-16：可选 update.inspect 已接公开 preflight，支持预算、pending 和只读 updatePreview；不授予更新执行资格，自动 RemoteFact 提取仍待完成。

2026-09-16：创建/查证成功回执的 confirmed 值已自动保存为 RemoteFact，Attempt 持久原请求信封（schema 3）；剩余 update/noop 槽位执行与发布分派。

2026-09-16：共用 Step 已支持 update/noop 的结构校验与预检映射；首次/修复发布采用记录已接入。update/noop 实际执行和无写入提交仍未开放。
