# 停止重试与事件时间

状态：已实现第五轮 B/C。A 的已有对象导入尚未实现；H3/F6 旧补丁未合入。

## stopRetry

`stopRetry(runId, {requestId, expectedSequence, actor, reason})` 为同步的本地操作，不调用 adapter。
新旧入口共用 runtime，校验命令纯 JSON、字符串非空、序号为非负安全整数。
只接受无请求在途的 blocked run，所有步骤必须为 ready/applied/reused，且至少存在一个 ready。
全 applied 的人工核对暂停需要 resume 收尾，stopRetry 返回 NO_PENDING_STEPS，不伪造失败。

对每个 ready 步骤验证历史：从未派发，或最后一次事件为可重试的权威 not_applied，或人工
no_effect/retry。不能仅凭没有 remoteRef 就推断无效果。当前状态机已经保证这些关系，停止边界再次核验。
unknown/running/closed/published/failed 不接受新的停止请求；unknown 仍需核对或显式关闭，不能变成零效果。

追加 retry_stopped 事件，保存完整命令和原因。首个 pending 步骤 failed，其余 pending 步骤
skipped/run_stopped；不追加虚构的远端 not_applied 事件。所有 applied/reused 回执原样保留。
run 变为 failed，旧 publish/resume 只观察，不再派发。零效果可 revise；完整创建映射的部分成功可
continueFrom。停下再派生不会让旧 run 与新 run 同时执行。

requestId 在同一 run 的 stopRetry 操作内去重，独立于 adjudicate 的 requestId 命名空间。
相同命令重放返回当前快照，不产生事件；不同内容返回 STOP_RETRY_CONFLICT。
expectedSequence 对新命令执行 CAS，陈旧命令返回 STALE_RUN。RUN_BUSY 排除派发、核对和命令内部时钟回调重入。
宿主负责验证 actor 身份、授权停止和保存审计记录。该操作不宣称验证远端事实，只使用此前收集的证据。

## 统一事件时间

Event.recordedAt 现在必填，dispatching/applied/unknown/not_applied/no_effect/reconciling/skipped/
adjudicated/reused/retry_stopped 全部经过同一个 record 方法。
时间来源为可注入的 Clock（同步返回 epoch 毫秒），默认 Date.now。ISO 字符串表示本机观察时间，
不是远端生效时间，也不是可信时间戳。sequence 仍是排序、并发控制的依据。

测试用固定或递增时钟保持精确断言；现有事件形状断言明确加入 recordedAt。
时钟抛错、非数值或非法日期会退回系统时间，避免诊断设施异常丢失已获得的远端回执。
因此 fallback 的时间可能跳变，不承担单调性保证。时钟必须是可信且不产生业务副作用的函数。
本轮不提供 SQLite 原子落盘或跨进程恢复保证。

## 验收

原 90 项 + 7 项回归测试 = 97 项，覆盖：零效果停止修订、部分/复用停止续跑、unknown 拒绝与人工
no_effect 衔接、CAS/非法命令/派发竞争、全 applied 暂停、各事件时间、时钟故障和重入保护。
`demo:stop` 纳入 CI；停止后原 run 不再派发，新修订使用新凭证和新请求 key。
