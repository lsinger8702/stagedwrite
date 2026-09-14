# 006：Publish / Resume 语义与执行设计

**置顶原则：新一次逻辑 publish 表达新执行意图，产生独立 Run；未全部成功时继续该次执行用 resume，不以进程故障或重启为前提。resume 只继续已有 Run。相同 Draft / 内容不等于相同执行意图。Draft 不保存执行进度，旧 Run 不跟随最新 Draft 或最新预检变化。**

**原则冲突必须先与项目所有者讨论并取得明确同意，再改方案。统一原则见 [000](000-project-principles.md)。**

状态：2026-09-14，按项目所有者“先做，做完看真实输入输出”的要求，实现本轮可评阅版本。以下参数选择是本轮实现方案，不冒充此前逐项确认的长期原则。通用 Store 注册、MID、startAt、rollback、发布后 edit 仍未扩展。

## 当前修复续作方案（2026-09-15，覆盖下方历史阶段限制）

**publish/resume 返回图预览、执行步骤事实和可选诊断。接入方可在 apply/reconcile 结果附 code、message、diagnostics；消息映射由接入方完成，库不猜测远端字段路径。只有基础错误说明也可驱动 resume。**

1. 未全部成功的 Run 可以修复 Draft。成功步骤及对应节点不可改；当前最小实现保持执行步骤 ID、顺序、依赖关系和效果映射稳定，允许修改未完成节点的字段。
2. resume(runId) 检测 Draft 新版本，先查证旧 unknown 请求，不发送修复后的请求。未知仍未解决时返回原事实；确认成功则保护成功输入，确认未生效才允许替换。
3. 对修复版本重新 preflight（包含异步规则）。未通过则返回该次检查的 preview/diagnostics/check，不发送请求；通过后将新输入与计划作为同一 Run 的执行修订保存。
4. 每次修订保留上一版步骤/绑定/版本；原始提交身份仍单独保留。内容变化的已尝试请求使用新 key；未改变的请求与已成功步骤保留 key。新计划和修订历史随 Run 原子落库，再发送。
5. 明确远端拒绝造成的 failed 在修复版本后可以重新进入执行；用户显式停止、关闭和已全部成功不自动重开。不移除原有未知结果与所有权保护。
6. 不要求新增 public API；edit 仍接收原子 OP，resume 仍接收 runId。不是新 publish，也不要求创建派生 Draft。

以下为历史阶段记录；与上面冲突的永久封存及完全固定输入描述已由本次用户明确要求替代。

## 本轮接口

```ts
const draft = engine.create({ type: "example", typeVersion: "1" });
// edit + preflight
const check = engine.preflight(draft.id);
const first = await engine.publish(draft.id, check.certificate!, { runId: "intent-1" });
const observed = await engine.publish(draft.id, check.certificate!, { runId: "intent-1" });
const continued = await engine.resume(first.id);
const second = await engine.publish(draft.id, check.certificate!, { runId: "intent-2" });
const input = engine.getRunInput(first.id);
```

上例假设草稿已填写且通过执行预检。完整可执行代码与实测见 [输入输出记录](../examples/publish-resume-walkthrough.md)。

| 调用 | 行为 |
|---|---|
| publish(D, C, {runId:A})，A 不存在 | 校验当前 C，固定 Run A 的输入，提交后立即推进执行 |
| 相同 D、C、A 再次提交 | 返回 A 的当前快照，不调用 apply/reconcile；即使当前 Draft 检查已变化也可以找回原提交 |
| A 已存在，但 D 或 C 不同 | RUN_ID_CONFLICT，不静默重新绑定或新建 |
| publish(D, C, {runId:B}) | B 不存在且 C 当前有效时，新建独立 Run B；相同内容不去重 |
| publish(D, C)，省略 options | 每次生成新 UUID，表达新意图；需要提交重传时建议显式提供 runId |
| resume(A) | 根据 A 的事实继续；成功跳过，未知先查证，未决时停止 |
| getRun(A) / getRunInput(A) | 分别读取执行事实与固定输入，返回独立快照 |

runId 在同一个引擎/存储内全局唯一。显式 runId 长度 1–128，使用 ASCII 字母、数字、点、下划线、连字符，首字符为字母或数字；不允许冒号，避免与步骤关联键分隔符冲突。当前步骤 key 为 `${runId}:${stepId}`；新 Run 的请求关联空间独立。

这里以 runId 同时作为一次逻辑提交的身份，暂不增加另一层 publish requestId。此选择不定义 MID，也不把旧的 recover/adjudicate 命令 requestId 合并进来。

## 当前进度在哪里

Run 已记录 steps、原 key、状态、resolvedPayload、remoteRef 和按序事件。getRunInput 返回 `{draft, certificate, plan, binding}`，保存的是本次发布的图快照和计划，不依赖后来更新的预检缓存。

调用方选择使用当前内存实现或 SQLite 实现。库据这些事实计算下一步；没有新增外部检查点导入、startAt 或通用存储注册接口。单个 runId 没有对应记录时返回 RUN_NOT_FOUND，不凭 ID 猜进度。

同一 Run 内并发 resume 返回 RUN_BUSY。不同 Run 可以独立并发，包括来源相同的 Draft；它们表达不同的上游意图。旧 Run 的结果不会自动作为新 Run 的成功步骤，除非通过已有明确的回执复用流程声明。

## 持久化与迁移

SQLite schema 5：

- sw_runs 取消 draft_id 唯一约束，保留 id 主键，新增普通 draft_id 索引。
- sw_run_inputs 按 run_id 保存固定 Draft、计划、检查绑定和原提交凭据。
- 当前 Draft 预检仍使用 sw_plans；它是新发布的资格缓存，不能作为旧 Run 的恢复来源。
- 新 Run 与固定输入在同一 BEGIN IMMEDIATE 事务提交。事务中再次校验当前凭据/版本/计划；同 ID 竞争只承认一个提交。
- 成功持久化后才把 Run 登记为可推进，第一次远端调用之前已有可查询的执行身份。输入落库失败不会留下可运行孤儿，原 ID 可重新提交。

schema 1–4 在事务内升级到 5。旧 Run 的草稿之前封存，其 sw_plans 与草稿快照回填到 sw_run_inputs；原 Run ID、key、事件、回执、owner 均保留。不根据空搜索补造事实，不给 schema 2 的缺失 session 伪造接管证明。迁移缺必要列/输入则失败，不推进版本；旧版本二进制拒绝 schema 5。

recover 仍负责同主机接管，resume 才实际继续；已关闭旧引擎或确认旧进程退出后才可接管。恢复使用该 Run 的独立输入，因此新的预检、失败的计划生成或另一个 Run 均不能改写它。

## 保留的边界

发布后 edit 暂时仍报 DRAFT_SEALED，这是本轮延期实现的边界；preflight 可再次执行，同一份内容可独立再次发布。不得仅删除 edit 保护来假装已经实现远端编辑或 drift。

内存模式不提供进程退出后的恢复。SQLite 仍限定可信本地主机，不新增跨主机接管或自动 force。适配器负责真实请求映射、执行及查证；新 Run 并不保证业务上一定创建新资源，外部效果由请求语义决定。

旧标量 StagedWrite 是弃用兼容入口，本轮保持旧 publish 行为；这份多 Run 契约属于 createStagedWrite 图入口。rollback、MID、外部 Store 和指定恢复起点保持未决/延期，不冒充已实现。

## 验收结果

- [x] 相同 Draft / 内容独立发布，产生不同 Run 和步骤 key。
- [x] 同 ID 同提交重传无新增远端调用；同 ID 不同参数冲突。
- [x] 旧提交在新预检后仍可查询，新意图不能使用过期资格。
- [x] 同一 Run 并发推进拒绝，不同 Run 独立并发。
- [x] 两个 Run 在新预检替换/删除当前计划后，重开仍分别按原输入恢复。
- [x] Run 与输入原子保存，事务失败后同 ID 可再次提交。
- [x] schema 2/3/4 真实旧布局升级，保留原效果证据，支持同 Draft 新 Run。
- [x] Node 22 和 Node 24 下 158 项测试通过；实际运行示例输出另存 JSON/Markdown。

## 以下为旧实现与阶段验收记录

**下面保留的是历史实现资料，用于理解现有代码。其中“重复 publish 只观察同一个 Run”“永久封存”等描述不再是目标语义；“内存/持久化尚未实现”等状态仅适用于对应历史阶段。冲突时先按置顶原则识别差异，不能将历史测试当成撤销新目标的理由。**


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

当前仍内存、单进程；发布封存后不能继续编辑。failed 可能保留之前已成功效果，新建草稿重试不能自动消除这些效果。没有补偿、持久重试次数上限或崩溃恢复保证。

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

官方依据：[原始错误类型](https://docs.stripe.com/api/errors)、[限流原因头](https://docs.stripe.com/rate-limits)、[stripe-node 自身账号查询实现](https://github.com/stripe/stripe-node/blob/master/src/resources/Accounts.ts)。错误映射只用于本实验 Customer 接口，不能适用于所有 Stripe 操作的无效果证明。


## 第三轮：依赖、结果引用与零效果修订

Step 增加可选 `dependsOn: string[]` 和 `inputRefs: Record<payload字段名, stepId>`。
引用当前只读取依赖步骤的 `remoteRef`，不支持任意远端响应 JSON。所有依赖必须先出现在数组中，
拒绝缺失、自引用、前向引用、重复依赖；引用必须声明直接依赖，且不能覆盖 payload 的字面量字段。
图入口、旧入口及 runtime.create 共用 validatePlan；plan digest 包含依赖和引用声明。
业务关系不自动成为执行依赖：例如 uses 关系和循环业务图不能统一解释成创建顺序。
executor 负责明确投影。examples/dependencies.ts 展示 contains 边映射成父子创建步骤。

派发前从 applied 依赖解析结果，记录 resolvedPayload；原始 payload/inputRefs 保留。
apply/reconcile 收到的 payload 都是已解析快照；同一个 key 的重试和核对不能重新取可变外部输入。
当前仍是内存记录，持久化阶段必须在网络调用前保存 resolvedPayload 和派发意图。

终态失败采用全局停止策略：依赖下游 skipped/dependency_failed，其他未尝试步骤 skipped/run_stopped，
blockedBy 记录直接不可达依赖或停止源步骤，事件保存原因。unknown/blocked 保持可恢复，不提前跳过。

`revise(runId)` 仅接受 failed run，要求存在 failed 步骤，且所有步骤都是 failed/skipped；
不使用“缺少 remoteRef”推断零副作用。证明强度依赖 adapter 的权威 not_applied 契约。
返回新 ID、version=0、sourceRunId 的草稿，复制所有意图、边和墓碑；旧草稿永久封存、旧凭证仍只观察旧 run。
新草稿必须重新编辑/预检，新的 run/key 不复用旧失败请求。重复 revise 返回同一份副本，避免重复调用创建多个可发布分支。
已有 applied、unknown、blocked、running、published 的 run 均拒绝。快照隔离与原版本 CAS 规则不变。

部分成功派生现支持 [008 的一节点一创建步骤子集](008-partial-continuation.md)。更通用的派生仍需要定义 step 与 node 的显式映射、创建/修改效果类型、目标绑定和可复用回执，
并验证一个节点多步骤、共享引用和远端状态变化。单凭 remoteRef 不能推断线上完整草稿，不能自动跳过已执行操作。

验收：新增 5 项回归测试覆盖两个入口的坏计划、父结果恢复后供子步骤使用、子步骤限流/丢响应时输入稳定、
终态全部跳过与原因分类、零效果修订及部分成功/不确定拒绝；原有终态状态断言同步更新。
`npm run demo:dependencies` 另验收真实图关系投影、修订和两次模拟创建，无真实外部写入。


## Resume 是常规续作入口

正常存活的引擎中，publish 可以因为临时拒绝或远端结果暂不明确而未全部完成。调用方继续同一次执行时直接 resume(runId)，跳过已成功步骤并沿用原步骤身份。对于结果未知的步骤先查证，再决定是否发送。recover 只负责引擎重开后的执行归属接管，不是常规 resume 的前置步骤。

主示例现展示 project 成功、task-1 明确临时拒绝后，同引擎直接 resume 完成 task-1/task-2。重启接管仍由独立测试覆盖。当前永久拒绝的 failed 与显式终止仍按已有终态保护处理，不因本次示例修正而自动转成可重试。
