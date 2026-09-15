# M5：固定计划与执行事实持久化

**历史协议/阶段设计：当前默认 API 的 Draft、reset、发布归属与租约以 [018](018-draft-lifecycle-proposal.md) 和 [000 原则](000-project-principles.md) 为准。下文旧接口与阶段测试保留历史语境，不表示已移植到新协议。**

**设计约束：遵循 [000 项目原则](000-project-principles.md)；原则冲突须先与项目所有者讨论并取得明确同意。本文中的阶段实现记录不覆盖主线，publish/resume 目标及当前差异以 [006](006-graph-execution.md) 为准。**

状态：M5 已实现。本文记录 schema=2 时的阶段边界；当前 schema=3 和显式恢复见 [012](012-restart-recovery.md)。

## 保存边界

- 检查和 StoredPlan（certificate/plan/binding）在一个事务中写入，仍以 version/check_epoch 控制竞争。
- publishRun 在 BEGIN IMMEDIATE 中重新验证当前检查、版本和证书，再插入唯一 draft_id 的 run。
  run 的存在就是永久 seal，不另维护可能失配的布尔值；草稿模式打开同一文件也不能修改或预检已封存图。
- 每次外部派发/核对之前保存原 key、resolvedPayload、事件和当前状态。每次结果在下一步派发前保存。
- adjudicate/stopRetry 的命令事件、失败来源、剩余跳过步骤及最终状态以单个 run 快照更新原子保存。
- 派生草稿与 (source_run,kind) 唯一关系原子插入；多次打开后重复调用仍返回同一份副本。

sw_plans 存固定计划，sw_runs 存完整 run JSON（包含按 sequence 排序的完整事件），sw_derivations 存派生关系。
本轮使用完整快照替换，简单但随事件增长会增加写放大；尚未声称具备大日志性能，后续可迁移独立事件表。
原有 schema=1 在事务中建新表并升级版本，未知版本拒绝。旧 M4 二进制拒绝 schema=2，不能绕过 seal。

## 归属和恢复边界

每个 SQLite 引擎实例生成独立 owner 标识，首次写入 run 时固定，saveRun 必须匹配 owner。
第二实例不能接管未完成 run；runtime.restore 只登记只读快照，不把 dispatching 改成 ready。
getRun/listRunIds 始终读取数据库事实，重复 publish 返回同一个已持久 run，不调用 adapter。
持久的未执行计划可在重开后首次 publish，但 executor ID/version/target、定义、规则与检查身份仍必须匹配。

M5 允许读取所有已持久 run；对终态 run 的 resume 只观察。已存在非终态 run 的 resume、adjudicate、stopRetry
在新实例中拒绝 RESTART_RECOVERY_NOT_ENABLED（包括重复命令提交）；操作历史仍可直接读取。
终态 failed 的 revise/continueFrom 可创建新的 run，须满足已有的效果和映射约束。
M6 才引入显式且可验证的执行归属转移，以及 interrupted dispatch 的核对入口。owner 当前没有超时偷取机制。
这不是分布式 fencing，也不是远端幂等保证。

## 写入失败

checkpoint 位于 observe 之外。数据库错误不会被转换为 adapter unknown/not_applied，也不会吞掉后继续派发。
发生 checkpoint 错误后，当前 runtime 将该 run 标为不可继续，回退可见内存到最近已提交快照；
getRun 从数据库读事实，后续推进报 RUN_STORAGE_FAILED。若远端已成功但结果无法落库，数据库仍保留
dispatching 与原请求，不能因此视为零效果。若派发前 checkpoint 失败，则不调用外部接口。
裁决保存失败也不能让 revise 误认为已经证明零效果。

close 拒绝检查和 adapter 调用进行中的关闭；空闲时关闭连接。时钟回调处的锁覆盖保持有效。
数据库和注册回调为可信输入，不接受外部任意编辑的 run JSON。磁盘/文件系统保证仍是 SQLite 的运行前提。

## 验收

新增 10 项测试，总计 115 项：存储计划重开不重编译、跨实例封存、派生与回执重开、人工/停止原子保存、
派发前写失败、成功回执写失败、adapter 内进程退出、执行器身份变更、人工记录写失败、schema 迁移。
进程退出测试确认原请求已保存且图仍封存，不声称已经完成恢复执行。
demo:durable 纳入 CI；示例使用通用项目/任务对象和本地模拟，不进行真实远端请求。
后续 M6 必须覆盖发送前后、远端生效后本地提交前、核对过程中退出与归属竞争的故障矩阵。
