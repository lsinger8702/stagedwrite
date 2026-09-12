# 004：图预检、诊断与检查失效

状态：已实现，11 项 M3 验收测试通过。M3，2026-09-12。

## 边界

新图引擎仍只有草稿能力。`preflight(draftId)` 检查发布缺项和已装配的同步图规则，返回 `scope:"draft"`、`status:"passed"|"blocked"|"incomplete"`、诊断与 `checkId`。
`passed` 只表示当前草稿检查通过，不是发布资格、执行计划或外部授权；不产生 publish certificate，也不提供 publish。

- 空图返回 graph.empty，要求用户提供意图。
- 对每个已有节点，requiredAtPublish 要求字段存在且为 value 意图。clear 与未声明均缺失；schema 允许的 null 是显式普通值，若业务禁止它，需额外规则。
- 缺节点类型实例、关系基数、非空字符串等业务完整性由规则检查，不从类型声明推断必须创建多少对象。

## 规则装配

`createStagedWrite({definitions,rules:[{id,version,type,typeVersion,check}]})`。
规则显式绑定某个定义版本；未知定义、非法规则形状/身份、同定义上重复 rule id 在启动时拒绝。规则与其列表在装配后固定，check 函数按输入顺序运行。不同引擎相互隔离。

定义中不放函数。rulesDigest 覆盖内建检查版本及当前定义的有序规则 id/version 绑定，不哈函数源码；调用方修改实现时必须升规则版本。检查记录只在本引擎有效。

check 接收独立冻结草稿快照，必须纯同步返回 GraphDiagnostic[]。引擎不提供远端上下文，不会执行修复建议；可信接入方负责保持 callback 无副作用。抛异常、异步结果、非法诊断或不能通过图编辑校验的修复返回 rule.error，并使结果为 incomplete；不能把规则错误当成业务通过。

## 诊断与修复

诊断包含 code/path/message 与 resolution：`{kind:"ops",ops:GraphOp[]}` 或 `{kind:"blocked",reason:"human_intent"|"unsupported",message?}`。
诊断 path 是图根 JSON Pointer；修复 OP 使用 M2 的 nodeId 与单字段 path。每条修复在同一原始快照上单独经过 evaluateGraphEdit 验证，但不保证消除该诊断，也不保证多条建议可直接合并。应用后必须重新预检。

内建缺项不会猜预算、名称或节点，因此返回 human_intent。规则修复需调用者明确选择，再走普通 edit/CAS。诊断补充 source（内建检查或规则 id/version）便于定位；非法结果整条规则拒绝，不保留其部分建议。

## 检查记录与时效

check 绑定 draftId/version/definitionDigest/rulesDigest，另有随机 checkId。`getCheck(draftId,checkId)` 只读取最新、仍匹配的检查，否则抛 CHECK_NOT_CURRENT；blocked/incomplete 也可作为当前诊断读取，调用方必须检查 status。

- 再次 preflight 先作废旧检查，再替换为新结果。
- 成功 edit 作废检查，包括净无变化批次；失败编辑和 preview 不作废。
- 检查过程设置该草稿运行锁。规则重入 edit/preflight 同一草稿会被拒绝（CHECK_BUSY），避免对旧快照保存通过结论。锁始终 finally 释放。
- 传入其他草稿/引擎的 checkId 无效。无持久性和跨进程恢复保证。

## 验收结果

缺项/清空/null、完整修复闭环、规则错误/异步/非法建议、输入输出隔离、版本/规则绑定、重复检查和编辑失效、preview/失败编辑保留检查、重入与独立规则快照。


- [x] 空图/缺项、clear/reset 和 schema 允许的 null 区分。
- [x] 修复需显式编辑；原图不自动变化，重新预检后才通过。
- [x] 过期版本、重复检查及跨草稿/引擎句柄拒绝。
- [x] preview 与失败编辑保留有效检查。
- [x] 规则抛异常、异步、非法输出/修复均 incomplete，不保留部分非法输出。
- [x] 冻结输入、返回快照和规则配置隔离；规则版本变化改变 rulesDigest。
- [x] 重入拒绝、锁释放；规则绑定仅作用于指定定义版本。

实现：`src/preflight/` 与 `src/graph-engine.ts`；测试：`tests/preflight.test.ts`；演示：`npm run demo:preflight`。
