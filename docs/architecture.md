# 架构与目录

状态：目标架构；现有文件无需一次性搬完。按功能交付逐步迁移。

## 职责

| 模块 | 负责 | 不负责 |
|---|---|---|
| Registry | 定义校验、版本索引、不可变快照 | 业务实例内容 |
| Draft | 图、OP、结构校验、版本 | 远端调用 |
| Preflight | 运行规则、诊断、绑定检查结果 | 自动批准或修改业务意图 |
| Publish | 固定计划、状态机、查证恢复 | 特定平台 SDK 细节 |
| Storage | 原子本地状态变更、事件追加和读取 | 网络事务 |
| Adapter | 计划生成、执行、查证 | 绕过核心修改执行记录 |

## 固定约定

- 开发者注册定义，使用者通过 OP 填充实例；两种写入入口分开。
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

拟议入口：registerDraftType、create、edit、preflight、publish、resume、getDraft、getRun。MCP 将来只调用这些入口，不复制状态机。

## 持久化注意事项

先持久化派发意图，再发远端请求，再记录结果；网络等待不能占用 SQLite 写事务。单执行器重启时先确保旧执行器退出，再将未完成派发视为 UNKNOWN。计划、规则、Adapter 的版本一致性及不兼容恢复行为要在发布模块设计中明确。
