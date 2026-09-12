# 006：图预检到执行的连接

状态：已实现，内存执行；持久化与跨进程 run 恢复仍待 M4–M6。2026-09-12。

## 两种显式模式

- `createStagedWrite({definitions,rules})` 或 mode:"draft"：保留草稿模式，没有 publish/resume/getRun。预检 scope 为 draft，无 certificate。
- `createStagedWrite({definitions,rules,mode:"executable",executors})`：每个已注册定义版本必须有唯一 GraphExecutor，提供 id/version/target、纯同步 plan、apply 和 reconcile。未知绑定、重复绑定、缺失能力在装配时拒绝。

reconcile 可以是函数，或明确的 `{unsupported:"原因"}`。明确不支持时，未知结果永久等待外部处理；不能伪装成 no_effect。target 是稳定非秘密目的地标识，不能放密钥。不能把动态运行能力塞进 JSON 定义。

## 检查与固定计划

先运行 M3 缺项和规则检查；仅 passed 才调用计划器。计划器接收独立冻结图快照，不允许通过重入修改当前草稿。异步、异常、空计划、重复/空步骤 ID、非标量 payload 均使检查 incomplete，没有 certificate。

合法计划复制后固定在引擎中；返回的检查带 scope:"execution"、certificate，以及 execution 绑定：checkId、definitionDigest、rulesDigest、executorId、executorVersion、target、planDigest。摘要覆盖按顺序排列的完整步骤。计划器返回对象被修改不会改变固定计划，publish 不再运行计划器。

certificate 是本实例内的随机查找句柄，不是外部授权或签名。passed + certificate 说明当前计划已准备好交给执行器；不保证远端状态或账户权限。执行前的真实账号核对由相应 adapter 完成。

成功编辑、重复预检使旧计划与检查失效；失败编辑和 preview 保留。规则/计划器重入被 CHECK_BUSY 拒绝。

## 发布与恢复

publish 验证当前凭据，创建包含 binding 的 Run，在第一次 apply 之前建立 draft→run 索引并封存草稿。重复 publish 只观察同一个 run；只有 resume 推进。getRun 返回独立快照。

新图入口与旧 StagedWrite 均调用 `src/execution/runtime.ts` 的同一执行状态机，不存在第二份状态转换实现。成功步骤跳过；unknown 先 reconcile；有充分无效果证据才允许重新派发；可重试拒绝 blocked，明确终态拒绝 failed。并发 resume 拒绝 RUN_BUSY。

当前仍内存、单进程；发布封存后不能继续编辑。failed 可能保留之前已成功效果，新建草稿重试不能自动消除这些效果。没有补偿、持久重试预算或崩溃恢复保证。

## Stripe 接入和恢复上下文

`StripeTestCustomerAdapter({secretKey,accountId}).graphExecutor(selector)` 提供版本 2 的图执行器，target=`stripe:test:<accountId>`。仅接受单个 customer 节点与 description 字段、无边；超范围计划拒绝，不静默跳过其他图内容。演示 demo:stripe 已使用这个入口。

在发送 Customer 请求/搜索前，用 `/v1/account` 核对凭据所属账号与 accountId 一致。此实验不支持跨 Connect 账号代理；密钥需要读取自身账号的权限。核对失败发生在创建之前，apply 返回可重试拒绝，reconcile 保持 unknown。

远端 metadata 同时保存：

- stagedwrite_attempt = SHA-256(key)，关联执行请求；
- stagedwrite_context = SHA-256(JSON([accountId,executorVersion,apiVersion,step.id,description]))，绑定目标和请求语义。

新 adapter 可以仅凭原始 step/key 和相同账号配置恢复查证。空搜索仍 unknown；只有单个、完整、test-mode 且两个标记都匹配的结果才 applied。标记是关联证据，不是密码学归属证明；需要独占、不被复制改写的 metadata 约定。旧版本只含 attempt 标记的对象不自动认领。

F2 分类限定为此 Customer 接口：

- 400/401/403 + 原始 type=invalid_request_error（排除 idempotency_key_in_use）→ final not_applied。
- 429 + type=invalid_request_error + 官方 Stripe-Rate-Limited-Reason 已知值（排除 lock_timeout）→ retryable not_applied。
- 409、5xx、idempotency_error、缺少证据的错误保持 unknown；不使用 SDK 类名作为 HTTP error.type。

本地 attempt 明确记录拒绝。可重试拒绝允许下一次 apply 沿用原 key 真正派发；终态拒绝缓存；未决派发仍不重发。新实例恢复不能仅靠缓存，必须验证远端上下文。进程重启后的整个 run 重建尚未实现，不能把 adapter 无缓存查证等同于完整重启恢复。

## 验收

70 项总测试中，新增 7 项图执行测试和 4 项 Stripe 修复测试，覆盖固定计划、旧凭据、能力装配、部分成功与 UNKNOWN、并发、重入、429 完整恢复、终态拒绝、无缓存查证和账号/内容不匹配。

运行 `npm run demo:execution`：图缺项阻塞 → 填图 → 固定计划 → 生效后丢响应 → resume，两个效果、两次 apply。这个远端仍是 mock。
真实 Stripe 联调仍未执行，必须配置测试密钥和账号后另行记录结果。

## 后续

M4–M6 应持久化完整图身份、检查绑定、计划、run 与首次派发意图，再实现跨进程恢复。墓碑容量策略、基准性能和内部异常恢复另列任务；本轮不宣称解决 F4/F5/S6。重新检查使旧检查失效的契约保留（F6），不在定义不匹配后继续认可旧凭据。

官方依据：[原始错误类型](https://docs.stripe.com/api/errors)、[限流原因头](https://docs.stripe.com/rate-limits)、[stripe-node 自身账号查询实现](https://github.com/stripe/stripe-node/blob/master/src/resources/Accounts.ts)。错误映射只用于本实验 Customer 接口，不能推广为所有 Stripe 操作的无效果证明。
