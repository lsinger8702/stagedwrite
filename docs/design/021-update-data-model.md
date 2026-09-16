# 021：固定图 update 数据模型与原子提交

**状态：2026-09-16，基于已批准的 [020 契约](020-update-contract-proposal.md) 的实现设计。原则已批准，U1 第一批模型/存储与第二批纯编译基础已实现，完整 update 执行链路尚未完成；各批范围见下文。**

## 1. 最小模型

Draft 保持现有业务字段：当前意图与 version、initialSnapshot、status、currentRunId、publishedArtifactId、targetId、lastPublishedAt 等。不要增加 createRunId、isUpdating 或锁状态列。

| 对象 | 决定 | 历史策略 |
|---|---|---|
| Binding | 保留现有不可变远端身份及原创建 run/step/key/input | 不覆盖、不改绑 |
| RemoteFact | 新增逐节点最新确认的受管规范值及证据来源 | 新事实追加；latest 指针可推进 |
| Observation | 远端读取规范结果、字段范围、远端版本、读取时间和 adapter 身份 | 被计划/确认采用的观察随证据保留 |
| Artifact | 新增基线引用、事实修订、观察、固定节点槽位计划 | 完整不可变 |
| Run | kind 增加 update；保留原有首次/当前 Artifact、修订与 Attempt | 保留全部 Run，只有当前未完成者可推进 |
| PublicationAdoption | certificate 被首次采用的不可变归属记录 | 执行归属或无写入成功提交，不能删除 |
| Attempt | 保存派发时完整效果身份、规范条件、请求输入和 key | 请求信封不可变，状态/结果只能受约束推进 |

这些是逻辑对象，不要求各自一张 SQL 表。不要把原始 HTTP body、授权头或密钥变成通用持久化接口。

## 2. Binding 与确认事实分离

Binding 继续使用现有 ResourceBinding。它的 runId/input 表示原创建来源，不改成“最新一次更新”。同一目标远端身份唯一归属的约束保留。

RemoteFact 的逻辑形状：

```ts
type NormalizedValue =
  | { kind: "absent" }
  | { kind: "value"; value: string | number | boolean | null };

type FactSource =
  | { kind: "attempt"; runId: string; stepId: string; attemptNumber: number }
  | { kind: "observation"; artifactId: string; observationId: string };

// 说明性类型，尚未成为公开导出。
interface RemoteFact {
  id: string;
  nodeId: string;
  targetId: string;
  remoteId: string;
  projectionDigest: string;
  values: Record<string, NormalizedValue>;
  source: FactSource;
  confirmedAt: string;
}
```

字段键是 adapter 声明的稳定受管字段标识；投影定义记录相应图路径、可写/清空能力和归一化规则版本。缺失字典项表示没有证据，不能等同 kind=absent。声明中的 remove 是动作，规范值中的 absent 是状态，两者不是同一个类型。

只有持锁者核验成功回执，或采纳合法无写入观察时，才追加 RemoteFact 并推进 latestFactByNode。普通 preflight 不推进确认事实，否则远端漂移会被新基线掩盖。事实推进增加 resourceRevision，使旧计划失效。

首次 create 成功可能尚没有完整受管规范值。新 update-capable adapter 应从有证明力的成功结果提取它；证据不足可以先完成创建但不能授予 update 资格。缺历史证据不能用现在 GET 的值冒充原成功值。首次 update 的样例须使用新建实验资源，不猜测旧数据。

## 3. Observation 与 Artifact

Observation 至少包含 observationId、nodeId/targetId/remoteId、projectionDigest、values、observedAt、可选 opaque remoteVersion。观察失败走诊断或 pending/incomplete，不伪造空对象。opaque remoteVersion 是条件写令牌，不是密钥或本地 resourceRevision。

Artifact 新增 executionKind（initial_create/update）、basePublishedArtifactId、baseRunId、所采用的 fact IDs、观察集合与稳定槽位计划。现有执行绑定仍包含定义、规则、执行器、target 与计划摘要。基线和事实引用参与执行有效性判断；intentDigest 仍只描述作者意图，不能混入 observation 时间导致意图身份变化。

外部 preflight 保存计划时验证 version/checkEpoch/resourceRevision；publish 还验证 adopted/currentRun 归属、基线与注册身份。写前再次读到同样前置条件才派发；变化则失效并返回诊断，不在旧 certificate 下偷偷更换写入范围。

## 4. Run、槽位与派发身份

每个固定节点保留稳定 step ID、顺序与依赖。槽位的 effect 分为 create、update、noop；update 必须携带已绑定 remoteId。no-op 不创建 Attempt。依赖解析可使用该节点既有 Binding，不能依赖“曾发 HTTP 才有 remoteRef”。

执行槽位建议增加 satisfied 完成态，专指无需写入且已记录证据。applied 仍表示真实派发被确认成功。两者都满足依赖和本 Run 完整节点保护。未完成 update/noop 槽位可随修复切换，不能改身份、依赖或成功节点。

Run.kind 为 initial_create/update，状态继续 running/blocked/unknown/published；不增加可逃离 unknown 的隐式 abandoned。Run 保存基线 Artifact 引用，防止把另一轮成功意图当作原计划依据。

Attempt 不只冻结 payload：必须冻结 effect.kind/nodeId/remoteId、target、实际已解析输入、适用前置条件、执行器版本绑定。reconcile 接收原信封，不能从当前槽位重建原请求。新 update Run 的 key 必须包含新 Run 身份；A→B 后再 B→A 不能复用历史 key。原请求完全相同且已证明可安全重试时沿用 key；前置条件或实际请求变化也视为新请求，必须先解决原尝试。

相同 ID 的成功响应不足以单独证明字段更新符合声明；update adapter 还需给出与原请求匹配的确认事实。回执的 remoteId 必须等于 Binding，不能接受更新接口返回另一个对象而改绑。仅 GET 到目标值不足以证明未知旧请求终结。

## 5. PublicationAdoption

按 certificate（当前为 Artifact ID）索引不可变采用记录：

```ts
type PublicationAdoption =
  | { kind: "run"; certificate: string; draftId: string;
      version: number; runId: string; adoptedAt: string }
  | { kind: "noop"; certificate: string; draftId: string;
      version: number; artifactId: string; committedAt: string };
```

run 记录的是执行归属，不复制可变 Run.state。修复后采用的新 certificate 也指向原 Run，旧 certificate 的记录保留。noop 记录仅在全图无写入且没有未决 Run 时建立，和成功基线同事务；currentRunId 保持最后执行 Run，不凭空制造新 Run。

publish 返回区分执行结果与无写入提交的结果，均带当前 preview/diagnostics。历史重复请求返回原采用记录，并额外标明当前版本/当前 Run；不能把历史 published 冒充当前意图成功。noop 没有可供 resume 的 runId。edit 的轻量回执不变。精确公开返回类型与消费者调整在实现时一并完成。

## 6. 原子边界

| 事务 | 同时提交的内容 |
|---|---|
| T1 认领执行 | 校验凭据/基线/未决 Run；新增 Run、采用记录；切 currentRunId；初次固定 target |
| T2 准备派发 | 验证租约、当前 Run、依赖及最新计划；保存完整 Attempt；槽位置 dispatching |
| T3 接收成功 | 原尝试结果、槽位 applied、RemoteFact/latest 指针、resourceRevision；create 才新增 Binding |
| T4 采用修复 | 查证后验证成功保护；保留旧修订；采用新 Artifact/槽位与 certificate 归属 |
| T5 无写入槽位完成 | 保存观察证据/新确认事实、槽位 satisfied、resourceRevision；不生成 Attempt |
| T6 全图成功 | 全槽位完成且意图版本匹配；Run published；Draft published；成功 Artifact 与时间推进 |
| T7 全图 noop | 采用记录、全部必要观察事实、成功 Artifact/status/时间一起提交，不建 Run |

所有事务校验同一 Draft 租约 token/fence；网络读取/写入不在 Store 回调中。T3 成功后 T6 失败，resume 只收尾。T7 失败不能出现只有状态变 published、却无采用记录的半提交。任何被采纳的新事实都使旧检查失效；当前执行使用自己持久化的槽位进度，不能因自己的局部成功而另开 Run。

## 7. 存储与不变量

Memory 和 SQLite 共用校验逻辑，不能仅靠 SQLite 的索引保证行为。事务必须证明：

- initial_create 至多一个；未完成 Run 至多一个，且必须等于 currentRunId。
- 历史 Run 不删除；已完成 Run 不恢复为未完成；latest 指针不能引用别的 Draft。
- currentRunId 只能在旧 Run 全量完成后原子切换，新 Run 的基线是当时最近成功 Artifact。
- initialSnapshot、Binding、Artifact、采用记录、原请求信封和已确认历史事实不可覆盖。
- latestFactByNode、publishedArtifactId、采用记录、Run 引用均存在并符合节点/目标身份。
- success/noop 提交有完整匹配证据；有 unknown 时禁止收尾或另建 Run。

SQLite：去掉 runs.draft_id 的 UNIQUE，增加 kind/state 索引字段；可增加按 draft_id 的 initial_create 与未完成 Run 部分唯一索引。新增 publications 表，以 certificate 为主键，draft_id 外键式归属由事务校验。RemoteFact 历史/latest 映射可先保存在现有状态 body，观察保存在不可变 Artifact，避免为每个概念新开表。租约表不变。

持久化格式须升级，旧 schema 不自动混读。遵循现有无人使用原型不维护兼容的要求，本次实验使用新数据库；不删除、清空或静默迁移用户旧库。新后端在执行 DDL 前识别旧 schema 并明确拒绝，避免检查版本前修改旧库。不存在为新数据补造远端事实的迁移。

## 8. 实现顺序与验证

1. 增加内部模型与统一不变量；测试多个已完成 Run、单未决 Run、身份/历史不可变、采用记录幂等。
2. Memory/SQLite 存储布局与格式门禁；测试事务失败全回滚、两后端一致、旧库拒绝且文件内容不被修改。
3. U2 接入受管字段投影/观察/diff；U3 再接执行、修复与收尾；在能力完整前保持远端 update 入口关闭。
4. 核心故障回归包括：T3/T6/T7 提交失败、旧证书重放、迟到回执、不同 Run key、相同值仍 unknown、部分成功 reset 拒绝、历史 Run resume 只读。

本阶段数据设计不意味着通用 adapter 已能可靠查证 update；Stripe adapter 的终结证据必须另行实证。不得把现有 create 样例的对象搜索逻辑直接当作 update 查证。

## 9. U1 第一批实现记录

已落地：RemoteObservation/RemoteFact/PublicationAdoption 类型和持久化容器；Run.kind 类型扩展；Memory/SQLite 共享状态与历史不变量；SQLite schema 2 移除每 Draft 单 Run 的物理约束；旧 schema 在 DDL/PRAGMA 前只读检测并拒绝。事实与采用记录当前保存在状态 body，尚未建立独立 publications 表，当前查询无需该索引。

引擎只初始化新容器，仍不产生 update Run/远端观察/确认事实/采用记录。完整 update/noop 槽位、Attempt 信封、基线编译上下文、T1–T7 接线及完整证据收尾约束仍属于下一批；不能把这一批存储结构测试理解为 update 端到端已通过。

验证：核心 61/61（新增 7 项存储测试）；Stripe 离线 9/9；walkthrough 5/5 且产物一致；隔离安装/打包/类型消费者检查通过。存储测试中的 update Run 是人工构造的状态，验证归属和持久化，不发送远端 update。没有重新运行真实 Stripe 写入。

## 10. U2 纯编译基础

`src/managed/update-plan.ts` 提供内部纯函数 compileUpdate，接收完整状态快照、adapter 的受管字段目标投影与远端观察。它不执行 I/O、不保存事实、不签发 certificate，也尚未接入公开 preflight。输出是固定节点的字段差异槽位与编译上下文，不是可直接派发的 Step：依赖/请求映射/Attempt 信封仍待执行层接线。

已实现 B/D/O 的五种相等关系、unknown 优先阻断、Binding/投影/受管字段范围校验、remove 明确清空、未声明禁止隐式写入、不可变字段拒绝、变更意图未映射诊断及输出快照隔离。drift 返回图路径、message 与 baseline/desired/observed 元数据；任意错误都不输出可执行槽位。

编译上下文保留 Draft version、resourceRevision、原成功 Artifact/currentRun、目标、投影与观察；各槽位引用确认 fact ID。普通编译不推进 latestFactByNode，避免把漂移读成新的成功基线。

新增 11 项纯编译测试，核心累计 72/72。测试通过不意味着远端 update 已开放。下批仍需接 adapter 异步读取、受预算约束的预检、写前观察验证、真实 update/noop 派发和原请求查证。

## 11. U2 异步检查接线

新增可选 `executor.update.inspect(draft, { signal, bindings })`。注册函数在引擎装配时绑定；变更实现需提升 executor.version。输入 Draft/Bindings 是冻结快照；只能读取远端，不得派发创建/更新。

返回值：

- `{status:"pending", message, retryAfterSeconds?, diagnostics?}`：由宿主管理异步任务，上游重试 preflight。
- `{status:"complete", projections, observations, diagnostics?}`：交给纯编译器输出字段差异和具体诊断。

成功过的 Draft 且注册了 inspector 时，公开 preflight 在普通规则通过后执行该检查。同步规则、异步规则和 inspector 共用本轮等待预算；已超预算不启动 inspector，已启动超时返回 incomplete 并 abort。检查提交仍验证 version/checkEpoch/resourceRevision，较早结果不能覆盖较新检查。

**当前只返回 `scope:"draft"` 的诊断检查，passed 时可附 `updatePreview.slots`；没有 certificate/执行 Artifact。** 成功后的 edit 仍拒绝，publish 仍观察原 Run。未注册 inspector 的接入与首次 create 路径保持原有行为。

本批测试走真实 create/preflight/publish 后的公开 preflight，验证 frozen 输入、pending、drift 具体值、超时迟到、非法诊断和并发检查；RemoteFact 由测试明确注入，不代表自动回执提取已实现。核心 77/77；下一批需接成功回执提取、update/noop 执行槽位与原请求信封，才可开放 edit/publish。

## 12. 回执事实与请求信封

`apply/reconcile` 的 applied 结果新增可选 `confirmed: {projectionDigest, values}`。adapter 从真实成功响应提取规范值，引擎验证形状后在同一事务保存 Attempt outcome、Binding、RemoteFact、latest 指针与 resourceRevision。不从请求目标猜测远端值；确认规范值可与创建请求字段形式不同。

无 confirmed 的旧接入仍可完成创建，但没有 update 的事实基线；非法 confirmed 保留已确认的创建成功，返回 CONFIRMED_FACT_INVALID warning，不生成事实，也不会因此重发。存储要求 attempt 来源事实的 remoteId、projectionDigest、values 与原 applied outcome 完整匹配。

每个 Attempt 在发送前持久保存 request（原 Step、解析后 payload、target、executorId/version），并校验 payload 与原 input 一致。恢复调用读取原 request，不从新计划重建。原信封不可覆盖；相同资源 ID 的迟到回执如果规范值矛盾，保持 unknown。

存储 schema 升至 3，schema 1/2 文件只读检测后拒绝，不做静默迁移。原因是旧 Attempt 缺少完整请求信封，不能靠当前计划猜测补齐。旧实验库应配合匹配的旧代码观察/恢复，不为重试另建资源。

预检测试已经使用真实 apply 返回 confirmed 自动生成事实，删除原手工注入。新增事实提交失败→采用迟到回执的测试，以及 unknown 查证后保存事实、非法确认值不抹掉效果的测试。walkthrough 已按新增的真实 Attempt 输出重新生成；仍未开放成功后 edit/update/noop 执行。

## 13. 共用 Step 与采用记录

Step.effect 已扩为 create/update/noop；update/noop 必须带原 remoteId。共用 validatePlan 按 initial_create/update 模式检查，初始计划仍只接受 create；noop 的 payload 必须为空且不得含 inputRefs。

可选 `update.plan(draft, compilation)` 将已检查 diff 映射为同一 Step 协议。预检检查节点全覆盖、动作与 diff 一致、远端 ID 不变、原步骤 ID/顺序/依赖不变；不能把有差异节点标成 noop。返回 `updatePreview.plan` 供检查，不签发 certificate，不派发请求。plan/apply 的真实业务字段映射仍由 adapter 测试负责，结构校验不能证明任意发送函数语义正确。

首次 create 认领事务现在原子保存 PublicationAdoption；resume 采用修复 Artifact 时将新 certificate 归属原 Run，旧记录保留。重放已采用 certificate 观察原 Run，不能另建资源；采用事务失败不留下 Run/currentRunId 或远端效果。无写入发布的正式提交以及 update/noop 派发仍待接入，当前不声称已完成。

核心累计 85/85，包括 noop 禁止隐式写入、动作/绑定/步骤身份拒绝、实际预检计划输出、修复凭据归属与采用提交失败回滚。没有新增独立 update 执行器。

## 14. U3 恢复：写前复核组件

2026-09-17 三态 OP 迁移结束，执行进度见 [U3 账本](../tasks/update-execution.md)。新增内部 verifyUpdateReadback：当前本地编译条件、新鲜观察/条件令牌及 adapter 请求计划必须与原检查一致。读取 ID/时间可更新，不允许暗中将原计划换成另一份写入或 noop。结果未知优先阻断；失败诊断有 message/hint。

该纯函数尚未接入 publish，没有检查凭据、租约、认领或派发权限。下一步补齐 Artifact/Attempt 执行证据、共用 update/noop 槽位及原子认领，然后按状态矩阵接线。当前远端 update 入口继续关闭。

## 15. U3.2 固定产物与原请求证据

Artifact.update 保存通过检查的 UpdateCompilation，包含基线、槽位引用的确认事实、投影、观察及远端条件令牌。update 不再另存 Artifact.observations，避免两个观察来源。Attempt.request.update 保存 artifactId/observationId，和原请求 Step、解析后 payload、执行器身份一起受历史不可变约束；原条件从引用的不可变产物读取。

存储边界检查编译上下文、注册身份、摘要、计划及请求映射的一致性。历史重编译使用该产物固定的事实视图，允许当前 Draft/最新事实已变化；它只验证历史自洽，不能替代 U3.1 的当前状态与新鲜读取复核。读路径全量校验，写路径只对新增 Artifact 重编译，旧产物由不可变约束保护。

内部 updateRequest 构建原请求信封，不执行 I/O、不保存 Attempt。五项新增测试覆盖 Memory/SQLite 的证据拒绝与固定请求，以及 SQLite 外部损坏后拒绝读取且保留原始 body。核心 149/149；公开 update 仍未开放，实际产物生成与派发属于 U3.3–U3.5。

## 16. U3.3 原条件与 noop 完成槽位

共用 apply/reconcile 上下文增加可选 update 对象，提供原 Artifact ID 与原 RemoteObservation。通过 Attempt 的不可变引用构造并深冻结；包含原规范值、观察身份和 remoteVersion。update 回执须确认同一 remoteId、projectionDigest 和所有受管值，否则保留 unknown，不能以回执不完整为理由认定未生效。

ExecutionStep.satisfied 表示以观察证据确认无需写入，satisfaction 引用 Artifact/observation/RemoteFact。它与 applied 一样满足依赖并保护完整节点，但不产生 Attempt。存储拒绝缺失、错配或被改写的满意证据。内部 satisfyNoop 在事务中追加观察事实、推进 revision 并完成槽位；幂等重入不重复追加。

当前共用恢复已能消费满意槽位以及原 update 请求条件。公开派发尚未调用 satisfyNoop，update 新请求仍未开放；持锁读取、原子认领及新派发的完整接线继续由 U3 账本跟踪。测试使用预置 update Run/证据，不能视为真实远端更新验收。
