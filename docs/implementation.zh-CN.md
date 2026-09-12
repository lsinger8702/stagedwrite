# StagedWrite 实现路线

## 先理解当前版本

这是一个单包 TypeScript 项目。没有前端、服务部署和 monorepo。现在的目标是让接口和一条完整链路可以运行。

```text
examples/lifecycle.ts        使用者：调用 create/edit/preflight/publish/resume
        ↓
src/engine.ts               控制流程、预检凭据、执行状态和内存记录
   ├── src/draft.ts         草稿变更和版本检查
   ├── Rule                检查草稿，返回诊断；不自动改草稿
   └── Adapter             把草稿变成步骤、执行远端请求、查证结果
        ↓
src/adapters/mock.ts        模拟远端：可以生效后丢失响应
```

库管理流程；规则回答“为什么不能发”；adapter 回答“具体怎么发、怎么查”。MCP 将来只是调用核心 API 的外壳。

## M1 注册与空图入口

运行 `npm run demo:registry`，依次阅读 `src/registry/types.ts`、`src/registry/profile.ts`、`src/registry/registry.ts` 和 `src/graph-engine.ts`。`src/registry/json.ts` 固定纯 JSON 输入和摘要算法。

定义装配、引用校验、冻结与空图创建已实现；`validateValues` 可独立验证标量约束。M2 已在 `src/graph/` 实现原子编辑，运行 `npm run demo:graph` 查看共享引用例子。新引擎仍只有草稿能力，下面的执行原型独立运行；M3 已在 `src/preflight/` 增加草稿预检，运行 `npm run demo:preflight` 查看缺项与显式修复闭环；显式 executable 模式现已实现图发布，运行 `npm run demo:execution` 查看；两个入口共用 `src/execution/runtime.ts`。

## 执行原型代码阅读顺序

1. 先运行 `npm run demo`，对照 `examples/lifecycle.ts` 看五个调用。
2. 读 `src/types.ts`，理解 Draft、Diagnostic、Step、Run、Outcome。
3. 读 `src/draft.ts`：先复制草稿、执行整批操作，全部成功后替换原草稿。
4. 读 `src/engine.ts`：检查通过后保存计划；编辑使旧凭据失效；发布后锁定草稿。
5. 看 `advance()`：已成功就跳过，未知就先查，仍未知就停。
6. 对照测试，尤其是“远端成功但响应丢失”和“查不清就不重试”。

目前 `certificate` 是随机句柄，服务端内存中保存它对应的版本和计划。它不是密码学证明。内存 events 是执行轨迹，不是持久账本。

## 后续开发顺序（2026-09-12 更新）

按 [开发任务](roadmap.md) 推进：结构注册 → 对象图与 OP → 图上的预检 → SQLite → 持久发布 → 重启恢复 → MVP 发布。

第一项详细设计见 [001：结构注册与空图创建](design/001-registry-and-draft.md)。原先“先持久化，再 Stripe”的顺序已被上述计划替代；先稳定数据语义，再设计存储。

每项遵循：短设计 → 实现 → 验收 → 更新文档 → 提交。M1 后、SQLite 前先做范围受限的 Stripe test-mode adapter 实验；完整 Stripe 接入和 MCP 仍在核心 MVP 后推进。
