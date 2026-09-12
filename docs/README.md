# 项目文档入口

StagedWrite 的主体是可嵌入业务程序的 TypeScript 库。开发者提供结构、规则和 Adapter；核心管理草稿、预检、发布和恢复。MCP 是后续可选入口。

## 阅读顺序

1. [MVP 范围与验收](mvp.md)：这一版要交付什么。
2. [架构与目录](architecture.md)：模块边界、公共接口和目标目录。
3. [开发任务](roadmap.md)：每一步做什么、如何判定完成。
4. [第一项详细设计](design/001-registry-and-draft.md)：定义装配与空草稿创建。
5. [功能设计模板](design/TEMPLATE.md)：后续功能沿用这份模板。
6. [代码阅读与实现路线](implementation.zh-CN.md)：从现有原型开始。
7. [第一次发布](first-release.zh-CN.md)：本地 Git、GitHub、版本发布的区别。

## 文档状态

- 当前代码：0.0.1 内存执行原型，以及已完成的 M1/M2/M3 定义注册、图编辑与草稿预检引擎。显式 executable 模式现已连接内存发布/恢复，默认 draft 模式仍只检查草稿。
- 下一版目标：0.1.0 核心 MVP，见 mvp.md；这是计划，尚未完成。
- design/001、003、004 的 M1/M2/M3 接口已实现；其他设计与明确标注的后续能力仍属计划。
- 本文档包只整理公开项目的范围与设计，不包含生产代码、原始日志、内部账号或原始评审记录。

范围变化先更新 mvp.md；任务进度更新 roadmap.md；具体规则更新对应设计。README 的功能声明必须与实际代码一致。

## 最新评估

[复杂场景适配矩阵](design/002-complex-draft-fit.md) 区分核心已规划能力、行为不兼容和后续扩展。M1/M2 已支持定义注册、空图和标量图 OP；复杂字段和基线恢复尚未实现。

当前图操作契约：[003：图操作与原子编辑](design/003-graph-operations.md)。

图预检契约：[004：图预检与检查失效](design/004-graph-preflight.md)。

Stripe 实验：[005：测试 Customer 与恢复验证](design/005-stripe-adapter-experiment.md)，代码/离线契约完成，真实账号联调待验证。

图执行桥：[006：固定计划、发布与恢复](design/006-graph-execution.md)，已实现进程内闭环。

- [人工核对与不确定执行的关闭](design/007-manual-reconciliation.md)
- [部分创建成功后的派生](design/008-partial-continuation.md)
- [停止重试与事件时间](design/009-stop-retry-and-event-time.md)
- [M4：SQLite 草稿与预检持久化](design/010-draft-storage.md)
- [M5：固定计划与执行事实持久化](design/011-execution-storage.md)
