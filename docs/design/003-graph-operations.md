# 003：图操作与原子编辑

**设计约束：遵循 [000 项目原则](000-project-principles.md)；原则冲突须先与项目所有者讨论并取得明确同意。本文中的阶段实现记录不覆盖主线，publish/resume 目标及当前差异以 [006](006-graph-execution.md) 为准。**

状态：已实现，11 项 M2 验收测试通过。M2，2026-09-12。

## 接口和范围

`engine.edit(draftId, expectedVersion, ops)` 原子保存一批操作并返回 GraphDraft。
`engine.preview(draftId, expectedVersion, ops)` 与 `engine.evaluateEdit(...)` 返回同一 `{candidate,changes}`，不保存、不分配 ID、不调用远端。两者与 edit 共用纯候选计算。

操作按数组顺序执行，不拓扑重排：

- `{op:"node.add", id, nodeType}` 创建空字段节点。
- `{op:"node.remove", id}` 删除节点，不隐式删除边。
- `{op:"edge.add", id, relationType, from, to}` 建立有向关系，端点是节点 ID。
- `{op:"edge.remove", id}` 删除边。
- `{op:"set", nodeId, path:"/field", value}` 设置标量意图。
- `{op:"remove", nodeId, path:"/field"}` 明确清空。
- `{op:"reset", nodeId, path:"/field"}` 撤销作者声明，不恢复历史基线。

M2 仅支持单层字段 JSON Pointer，支持 ~0/~1 转义；嵌套路径和节点整体替换均拒绝，因此没有隐含父子覆盖规则。set/remove/reset 必须引用当时已存在的节点和已声明字段；node.add 之前 set 会失败。

GraphDraft 保留 id/version/type/typeVersion/definitionDigest，nodes 与 edges 按 ID 索引。节点保存 `{id,nodeType,fields}`，字段是 `{kind:"value",value}` 或 `{kind:"clear"}`，缺少键代表未声明。边保存 `{id,relationType,from,to}`。null 只在 schema 允许时是普通值。

## 原子性与引用

操作形状、已存在身份与字段路径逐条检查。字段值约束、关系类型和端点完整性在整批候选完成后检查：允许先移除节点、后移除关联边，也允许边先声明、端点随后创建；不会重排操作。最终仍悬空则整批拒绝。

已有边不能用相同 ID 覆盖，重连用移除旧边、新 ID 建边。允许多个节点共享同一文档节点；不隐含单父节点、无环、唯一边或关系基数约束，这些需后续显式设计/规则。

草稿保存 `tombstones:{nodes:string[],edges:string[]}`。删除后的 ID 在同草稿同身份空间内不能复用，即使在同一批里删除后再添加也拒绝。节点与边 ID 空间独立；不同草稿可使用相同 ID。失败批次和 preview 不消费 ID，恢复/导入规则后续定义。

仅当整批合法时保存一次，version 加一；空批次拒绝。非空但净效果不变的批次仍加一，表示接受了一次编辑。expectedVersion 必须是非负安全整数且等于当前版本；过期预览不能绕过 edit 的重新计算与 CAS。版本达到 MAX_SAFE_INTEGER 后拒绝进一步编辑。

`changes` 按实际操作顺序记录每条操作的 before/after，包括意图变化与无效果操作；它是该次计算事实，不是持久审计或可直接提交的凭据。返回候选与快照不共享引擎内部状态。

## 校验与错误

保留发布必填缺失；只把 value 意图交给已编译字段 schema。clear 不转换成 null，reset 不补默认值。对未知字段，clear/reset 同样拒绝。

错误使用 GraphEditError，带 `code`、可用时的 `opIndex`、`path`；最终结构错误还带 `issues`。代码包括 STALE_VERSION、EMPTY_OP_BATCH、INVALID_OP、UNSUPPORTED_PATH、NODE_NOT_FOUND、EDGE_NOT_FOUND、ID_ALREADY_USED、NODE_TYPE_NOT_FOUND、UNKNOWN_FIELD、INVALID_GRAPH、VERSION_EXHAUSTED、DEFINITION_MISMATCH。任何拒绝不改存储、版本或墓碑。

M2 验收时没有 preflight/publish；M3 现已实现草稿范围预检（见 004），仍不提供 publish，也不把候选传入旧执行原型。

## 验收结果

- [x] 单批创建、填字段和共享关系，版本仅加一。
- [x] preview/evaluateEdit/edit 候选一致，不修改输入或消费 ID。
- [x] 非法字段、关系和悬空引用整批回滚，墓碑也不泄漏。
- [x] 共享目标删除需显式移除所有引用边。
- [x] 同批及后续批不能复用已删除节点/边 ID；失败批次可重试同 ID。
- [x] 顺序执行、最终图校验、清空/null/reset 与转义路径行为一致。
- [x] 过期版本、空批、非法 OP、危险 ID、嵌套路径拒绝。
- [x] 非空净无变化批次增加版本；返回快照不能修改内部历史。

实现位置：`src/graph/types.ts`、`src/graph/edit.ts`、`src/graph-engine.ts`。
演示 `npm run demo:graph`；测试 `tests/graph.test.ts`。
