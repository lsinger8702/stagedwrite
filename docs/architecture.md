# 架构与目录

**遵循 [000 原则](design/000-project-principles.md)；完整生命周期契约见 [018](design/018-draft-lifecycle-proposal.md)。**

只有一个公开引擎入口 `src/index.ts → createStagedWrite`。`defineDraftType` 是定义辅助函数，`createMemoryBackend` / `createSqliteBackend` 是存储与锁的配对工厂，均不是另一套引擎。

| 模块 | 职责 |
|---|---|
| src/managed/engine.ts | create/edit/preflight/publish/resume、单 Run 归属与成功保护 |
| src/managed/intent.ts | 普通 Graph 与三态意图的转换、一致性检查、固定基线 reset |
| src/managed/storage.ts | 当前内存/SQLite 存储、原子事务、租约与迟到事实 |
| src/managed/types.ts | Draft、Artifact、Run、Attempt、Binding、规则/执行器/存储注册接口 |
| src/registry/ | Schema 装配、受限本地引用、摘要、值约束 |
| src/graph/ | 图 OP 纯求值、最终结构校验、ID 墓碑；内部使用三态投影 |
| src/preflight/ | 具体诊断、完整 preview、同步/异步规则与等待预算 |
| src/execution/plan.ts | 步骤、依赖、inputRefs 与 create 效果的计划校验 |
| src/execution/publication.ts | 调用方首次 Run ID 校验与默认生成 |
| src/types.ts | 当前执行与诊断的基础类型 |

普通业务图与执行依赖图分开：由注册 plan 明确映射，库不猜真实 RPC。Schema 默认值不写入意图；规则不自动应用修复。内部三态投影服务于 OP 与 preview，不构成另一套公开 Draft 引擎。

SQLite 与内存共用同一个生命周期实现。跨主机使用者需提供权威租约和 Store 的原子配对实现，目前没有完成验证的内置跨主机后端。
