# M6：同主机显式执行恢复

**设计约束：遵循 [000 项目原则](000-project-principles.md)；原则冲突须先与项目所有者讨论并取得明确同意。本文中的阶段实现记录不覆盖主线，publish/resume 目标及当前差异以 [006](006-graph-execution.md) 为准。**

状态：已实现。本文记录 schema=3 的恢复设计；当前 schema=4 增加确认回执接入，见 [015](015-existing-objects.md)。`recover(runId, { requestId, expectedSequence, actor, reason })` 同步接管，不调用执行器；调用方随后显式 `resume`、`adjudicate` 或 `stopRetry`。

## 归属转移

每个连接登记独立 sw_sessions：owner、pid、host、released。首次发布和每次 checkpoint 继续要求 sw_runs.owner 匹配。
close 仅在检查、恢复、执行都空闲时允许，先事务标记 released，再关闭连接。
BEGIN IMMEDIATE 内检查命令身份、事件序号及旧会话：正常关闭可接管；否则仅在同主机且原 PID 不存在时允许。
原进程仍存在、权限不足、主机不同或缺少会话证据均拒绝；不使用心跳过期或超时强占。

进程存在性使用 [Node process.kill(pid, 0)](https://nodejs.org/api/process.html#processkillpid-signal)，仅接受 ESRCH。
部署前提是本地 SQLite、同一可信主机、同一 PID 命名空间。hostname 是部署约束下的辅助检查，不是跨机器身份认证。
不支持网络共享文件、不同容器命名空间、跨主机故障切换；PID 重用会保守阻塞。Worker 线程退出而进程仍在也不会自动接管。
这不是远端 fencing：旧进程退出时，已发送请求仍可能在远端继续执行，因此必须核对。

归属写入、状态归一化、recovery_claimed 事件在同一事务内提交。两个竞争连接最多一个成功。
事件的 stepId 为空字符串，表示 run 级事件；保留每个步骤最后的效果证据，便于后续安全停止。
同一 owner 重交同一 requestId/内容返回当前快照；更改内容报 RECOVERY_CONFLICT。
另一 owner 不能重放旧命令取得权限；必须使用新 requestId、当前 sequence，并重新证明旧 owner 已退出。

## 状态与身份

- dispatching → unknown；原 key、resolvedPayload、回执及计划全部保留。
- unknown 保持 unknown，resume 先 reconcile；空搜索不是 no_effect。
- ready 保持 ready；其余非终态归为 blocked，等待显式 resume。
- applied/reused 保留，不重新派发。依赖输入继续使用已确认 remoteRef。
- published/failed/closed 不接管；仍可读取或按既有条件派生。

接管不重新运行 plan；验证执行器 ID/version/target、定义/规则摘要、固定计划摘要、步骤身份、原 key 与解析输入一致。
数据库仍是可信内部状态，不能用作任意 run JSON 导入接口。执行器版本与 target 的稳定性由调用方负责。
未接管的新实例不能修改未完成 run，报 RECOVERY_REQUIRED。恢复命令带 expectedSequence，以事件序号而非时间戳排序。

SQLite 保存失败时事务回滚，不装载可写 runtime。后续 checkpoint 失败仍锁住当前 runtime，须关闭重开再接管；不能靠重交恢复命令解除锁定。

## 迁移和边界

schema 1/2 自动事务升级为 3，旧二进制拒绝新格式。旧 schema 2 run 缺失 session，无法证明原执行器退出，因此拒绝接管 OWNER_EVIDENCE_REQUIRED；仍可读取及按证据派生终态失败。
不自动伪造历史 owner 证据，也不提供 force 参数。默认内存模式不支持 recover，原进程内 resume 兼容。

## 验收

故障注入包括：派发 checkpoint 前退出、模拟远端生效后回执落库前退出、核对中再次退出、两个真实进程争抢、存活 owner 拒绝、事务写失败、原 key 重试、父结果注入、人工裁决和安全停止、身份漂移、旧库迁移及错误输入拒绝。
`npm run demo:recovery` 启动真实子进程，用本地回执文件模拟远端效果；子进程直接退出，父进程接管并核对后完成依赖步骤。示例不访问外部服务。
远端准确性仍依赖 adapter 提供可持久重建的核对证据，不承诺任意 API 上的 exactly-once。
