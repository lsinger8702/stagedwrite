# 架构与目录

**当前默认 API 已切换到 [018 生命周期协议](design/018-draft-lifecycle-proposal.md)，[000 原则](design/000-project-principles.md) 优先，原则冲突先讨论。下文保留旧原型阶段的结构与任务记录，不表示旧多 Run、reset 或恢复语义适用于新协议。**

状态：目标架构；现有文件无需一次性搬完。按功能交付逐步迁移。

## 职责

| 模块 | 负责 | 不负责 |
|---|---|---|
| Registry | 定义校验、版本索引、不可变快照 | 业务实例内容 |
| Draft | 图、OP、结构校验、版本 | 远端调用 |
| Preflight | 当前图预览、具体诊断、绑定检查版本 | 让 LLM 自行跑规则或预先决定固定修复 |
| Publish / Run | 独立发布意图、固定计划、执行事实和查证恢复 | 将同 Draft 的所有执行合并、特定平台 SDK 细节 |
| Storage | 原子本地状态变更、事件追加和读取 | 网络事务 |
| Adapter | 计划生成、执行、查证 | 绕过核心修改执行记录 |

## 固定约定

- 开发者独立导出定义，createStagedWrite 启动时显式装配并冻结；使用者通过 OP 填充实例。注册表属于实例，不是全局对象。
- 草稿绑定类型 ID、类型版本和定义身份；旧草稿不自动升级。
- 草稿图描述业务对象关系，执行计划描述远端效果，两者不等同。
- 本地节点 ID 独立于远端 ID；远端引用在执行结果中记录。
- remove 字段表示明确清空，reset 表示未声明；删除节点使用独立操作。
- 编辑先在工作副本求值，校验最终图，原子提交版本与内容。
- default 在解析阶段处理，不伪装成用户显式输入。
- 开始发布后计划固定；UNKNOWN 不当作普通失败处理。

## 目标目录

```text
src/
  index.ts                 公共导出
  engine.ts                组合模块的入口
  registry/                注册与定义校验
  draft/                   图与 OP
  preflight/               规则和诊断
  publish/                 计划、执行、恢复
  storage/                 内存、SQLite
examples/
  mock/                    假远端与业务示例
tests/
  unit/
  integration/
docs/
  mvp.md
  architecture.md
  roadmap.md
  design/
```

当前 src/draft.ts、src/engine.ts 等仍是探索代码。模块变大或承担独立功能时再拆；不提前创建空接口和空目录。

## 接口设计顺序

先确定 DraftTypeDefinition、Draft、Node、Edge、Op；再确定 Diagnostic、PreflightResult、PublishPlan、Run、Outcome。接口可以在 0.x 演进，但示例、测试、文档必须同步。

拟议入口：defineDraftType → createStagedWrite({ definitions })；运行时使用 create、edit、preflight、publish、resume、getDraft、getRun。MCP 将来只调用这些入口，不复制状态机。

## 持久化注意事项

先持久化派发意图，再发远端请求，再记录结果；网络等待不能占用 SQLite 写事务。单执行器重启时先确保旧执行器退出，再将未完成派发视为 UNKNOWN。计划、规则、Adapter 的版本一致性及不兼容恢复行为要在发布模块设计中明确。

## 复杂场景评估后的补充

结构采用 JSON Schema 2020-12 的显式受限 profile；不支持特性启动报错。定义格式与执行能力绑定分开，完整引擎装配检查两者对应关系。M1 的仅草稿模式不得产生发布资格。

evaluateEdit 作为纯计算入口，edit 与 preview 复用候选计算；提交层单独处理 CAS、版本、缓存失效。节点 ID 不因删除而释放重用。作者输入与每轮解析结果分离，不把推导值静默写入作者状态。

reset 仍为未声明，恢复发布基线将用独立 restore 语义。当前永久封存草稿只满足一次发布；目标必须分开 Draft 意图与 Run 执行，不要求引入 Git 式 revision 历史。多 Run 接口和后续 edit 分别设计，后者可以延后。详细缺口见 [复杂场景适配](design/002-complex-draft-fit.md)。

## M1 引用范围

图节点引用、schema 引用和远端引用分别建模。M1 支持每个 valueSchema 根内的 $defs / #/$defs/<name>（无环、标量、装配期解析）；不支持外部引用，不联网。图中具体节点/边引用校验由 M2 实现。详细错误和摘要契约见 001。
