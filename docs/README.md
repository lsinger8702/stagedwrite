# 项目文档入口

**置顶约束：遵循 [项目原则](design/000-project-principles.md)；原则冲突必须先与项目所有者讨论并取得明确同意。publish/resume 本轮多 Run 接口已实现供评阅，长期扩展仍有未决项，详见 [006](design/006-graph-execution.md)。旧阶段完成记录不代表新目标已完成。**

StagedWrite 的主体是可嵌入业务程序的 TypeScript 库。开发者提供结构、规则和 Adapter；核心管理草稿、预检、发布和恢复。MCP 是后续可选入口。

## 阅读顺序

0. [项目原则与变更约束](design/000-project-principles.md)：开发前先读；原则冲突须先讨论。
1. [MVP 范围与验收](mvp.md)：这一版要交付什么。
2. [架构与目录](architecture.md)：模块边界、公共接口和目标目录。
3. [开发任务](roadmap.md)：每一步做什么、如何判定完成。
4. [第一项详细设计](design/001-registry-and-draft.md)：定义装配与空草稿创建。
5. [功能设计模板](design/TEMPLATE.md)：后续功能沿用这份模板。
6. [代码阅读与实现路线](implementation.zh-CN.md)：从现有原型开始。
7. [第一次发布](first-release.zh-CN.md)：本地 Git、GitHub、版本发布的区别。

## 文档状态

- 当前代码：0.0.1 探索实现，含图、OP、诊断与 preview、固定计划、SQLite 执行记录及同主机恢复。尚未发布 npm。
- 新主线：同一 Draft 的独立 publish 意图应对应不同 Run，resume 继续既有 Run；图入口已实现独立 Run 与提交身份区分；发布后 edit 继续延期。
- 006 标记已明确原则、未决接口和当前差异；不得因旧阶段测试已通过就把新行为标为完成。
- 默认 draft 模式仍只检查草稿；后续发布后 edit 和通用 rollback 延期。
- 本文档包只整理公开项目的范围与设计，不包含生产代码、原始日志、内部账号或原始评审记录。

原则冲突先与项目所有者讨论并获得明确同意，再更新 000 与相关设计；范围变化更新 mvp.md；任务进度更新 roadmap.md；具体规则更新对应设计。README 的功能声明必须与实际代码一致。

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
