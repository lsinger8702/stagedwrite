# U3：固定图 update 执行账本

**2026-09-17：三态 OP 迁移已结项。按已批准的 [020](../design/020-update-contract-proposal.md) / [021](../design/021-update-data-model.md) 恢复 U3；本账本只记录执行阶段。U4 真实 Stripe update 与 U5 文档验收仍在后面。当前公开 edit/publish 尚未开放远端 update。**

| 任务 | 状态 | 交付与验收 |
|---|---|---|
| U3.1 写前复核组件 | 完成（内部） | 当前本地基线/Run/事实修订一致；新观察值/令牌与已检查条件一致；不静默更换计划。未接入 publish，不是执行授权 |
| U3.2 产物与原请求证据 | 完成（模型与存储边界） | Artifact 保存编译基线、投影/观察；Attempt 固定 update 目标/前置条件；读写边界验证完整证据 |
| U3.3 共用执行槽位 | 完成（已认领 Run 的执行路径） | 现有 dispatch 支持 update/noop；update 保留原 Binding，严格匹配确认值；noop 用独立满意证据，不伪造 applied Attempt |
| U3.4 认领与提交 | 待做 | certificate 采用优先、单未决 Run、update Run 原子认领；全图 noop 持久采用；历史响应区分当前意图；事务失败无半提交 |
| U3.5 edit/resume 接线 | 待做 | 成功后仅字段编辑；固定成功基线 reset；每次 update 续作重新读取；旧 unknown 原信封先查证，本 Run 成功节点保护 |
| U3.6 故障验收与开启 | 待做 | Memory/SQLite、并发/失锁/迟到回执/收尾失败、A→B→A/无差异/历史观察；能力完整后开启公开 update |

## U3.1 — 2026-09-17

- 三态 OP 收尾已推送 d6b0e77。
- 新增内部 `src/managed/update-readback.ts`，调用现有 compileUpdate / validateUpdatePlan 验证已检查输入与新鲜读取，不增加执行器或 public API。
- 先依据当前本地状态重编译并比对原检查，阻断 version、resourceRevision、成功基线、Run 归属变化及任何未决请求。再验证新观察与投影；观察 ID/时间可以更新，远端身份、值、受管范围、投影规则和 remoteVersion 不得变。
- 请求计划必须与旧计划一致，包括 payload、依赖、inputRefs 与效果身份；update 变 noop 也不能在旧凭据下自动采用。全部阻断返回具体 code/message/hint；输出与输入隔离，非法 JSON/accessor 不执行 getter。
- 测试：核心 `npm test` 144/144（含 TSC）；新增五项覆盖新鲜读取/本地变化/令牌及请求变化/noop/unknown/非法输入。`git diff --check` 通过。
- **边界：这是内部纯组件测试，未取得租约、未创建 Artifact/Attempt、未发送 update。** U3.2–U3.5 要将持锁网络读取、事务内本地身份复核、原请求保存与派发串联；本组件不能替代原子认领，也不能消除读取后远端被第三方修改的窗口。
- 未修改 Stripe 样例或真实录制，未声称跑过远端 update。本轮新增组件尚未提交或推送。

## U3.2 — 2026-09-17

- Artifact.update 保存通过检查的完整编译结果，包含固定成功基线、事实 ID、投影与观察。update 的观察只存于该上下文，禁止再写一份 Artifact.observations。
- Attempt.request.update 引用原 Artifact/observation；原 Step、解析后的 payload、执行器身份仍在同一不可变请求信封中。条件令牌与规范值通过不可变 Artifact 取得，不从当前 Draft 或最新观察重建。内部 updateRequest 只构建信封，不保存 Attempt、不派发。
- Memory/SQLite 共用边界拒绝缺失或矛盾的证据、Run/效果类型错配、原请求改写。历史 Artifact 使用自身固定事实重新验证，不拿当前最新事实覆盖历史；这证明存储一致性，不证明当前可发送。写路径只编译校验新增 Artifact，读路径完整校验。
- 新增五项核心测试：两后端的原请求固定和非法证据原子拒绝，以及 SQLite 外部损坏后的只读拒绝。Draft 从 B 改成 C，旧请求仍为 B；unknown 不因此获得重试许可。损坏 body 不被静默修复。
- 验证：核心 149/149（含 TSC）；Stripe 离线 13/13；walkthrough 6/6，真实运行对照及产物字节检查通过；隔离安装/打包/类型检查通过。没有修改真实 Stripe 录制，没有发送远端 update。
- **范围：update Artifact/Attempt 目前由存储测试构造，公开引擎尚不产生它们。** U3.3–U3.5 负责实际执行、认领与恢复接线；公开 update 继续关闭。本批代码尚未提交或推送。

## U3.3 第一批 — 2026-09-17

- U3.1/U3.2 已提交并推送 `23ad8ef`。
- 共用 dispatch 的 apply/reconcile/迟到证据结果在提交前校验 update 回执：必须确认原 remoteId、projectionDigest 及完整受管字段值（包含未改变字段）。缺失或矛盾回执转 unknown，返回 message/hint；不能冒充未生效重发。存储也拒绝直接写入不符合条件的 applied update Attempt。
- update 成功保留原创建 Binding，只追加新的确认 RemoteFact 并推进事实指针；创建路径保持原行为。
- 核心 153/153（含 TSC）。新增两后端的非法回执拒绝测试及实际 resume 回归：对测试构造的 update unknown Attempt，第一次不完整回执保持 unknown，第二次确认后复用同一请求/key完成，原 Binding 不变。
- **尚未完成：新 update Attempt 派发、条件令牌传给 adapter、noop 满意证据/槽位、完整认领及写前复核接线。测试预置 update Run 不表示公开 publish 已支持 update。** U3.3 仍进行中，不开启成功后 edit/update 入口。本批后续改动尚未推送。

## U3.3 第二批 — 2026-09-17

- 第一批回执处理已推送 `29e55af`。
- `ManagedExecutionContext.update` 向共用 apply/reconcile 回调提供原 Artifact ID 与完整原观察（含 remoteVersion）。从 Attempt 引用取值并再次核对请求映射；深冻结且复制，adapter 不能修改存储证据，也不会拿当前 Draft 重建旧条件。当前实际覆盖的是已有 update Attempt 的 reconcile。
- ExecutionStep 增加 `satisfied` 和 satisfaction 引用。共用依赖、完成判断、修复保护识别 applied/satisfied；satisfied 需要同 Run 所采用 Artifact 的 noop 槽位及 observation 来源 RemoteFact，不能伪装成 applied。已完成满意槽位不可退回 ready 或改写。
- 内部 satisfyNoop 是事务内变更组件：记录观察来源事实、推进 revision、完成槽位，不创建 Attempt。检查归属/版本/依赖/未决请求；重复完成不新增事实。调用方仍须在事务前建立新鲜读取条件；尚未从公开 dispatch 自动调用。
- 核心 158/158（含 TSC）。新增两后端的事务失败回滚、伪造完成拒绝、重复完成、SQLite 重开与混合 noop→update 恢复；原条件冻结/隔离测试通过。混合计划只有 update 的一个 Attempt，恢复正确消费原 Binding，创建绑定保持不变。
- Stripe 离线 13/13、walkthrough 原实录对照通过；未运行真实远端 update。
- **仍未开启新 update 请求派发。** 新 Attempt 构建和 noop 自动完成必须在持锁新鲜读取/认领接线后启用，不能凭旧 Artifact 自洽就派发。测试构造的 Run/满意槽位验证共用恢复流程，不代表公开 publish 已支持 update。U3.3 继续进行，本批新增改动未推送。

## U3.3 注册契约补强 — 2026-09-17

- 原条件与 noop 槽位已推送 `ae16f36`。
- review 指出的“支持 update 却可以合法返回无 confirmed 的 applied”成立。ManagedExecutor 改为创建/只读检查与更新写能力的判别联合；updateWrites=true 对应 ManagedUpdateExecutor，检查和计划函数必需，同一 apply/reconcile 的 applied 必须含 confirmed。声明支持更新的创建回执也必须提供确认值，用于建立未来更新基线。
- 只读 inspector 无须承诺写入。没有引入第二套 update 执行器或回调；运行时继续校验回执，不能用类型取代事实。注册仅验证显式能力配置，不可能提前证明函数未来返回值。
- 添加编译期负例（缺确认 apply/reconcile、创建回调冒充更新回调、缺 update planner），以及注册期无调用拒绝、独立只读检查、同引擎确认创建的回归。中英文 README 同步公开契约和当前未开放边界。
- 新写入与持锁复核仍待接线；此项不作为 U3.3/U3.4 完整验收。

- 验证：核心 161/161（含编译期负例和 TSC）；Stripe 离线 13/13；打包、隔离安装与公开类型消费者检查通过。未发真实远端请求。本批注册契约改动尚未提交/推送。

## U3.3 派发接线 — 2026-09-17

- 注册契约已推送 `d6a8e56`。
- 共用 dispatch 在每个未完成 update/noop 槽位前，持 Draft 租约调用 inspector，受检查等待预算约束；重新编译、映射，再实际调用 verifyRunUpdateReadback → verifyUpdateReadback。pending、漂移、令牌变化或请求变化均返回具体诊断，不保存 Attempt、不发送新请求。
- 本 Run 完成节点先核对当前观察与本 Run 最新确认事实；只有这些节点可在旧凭据比较中消去自身成功造成的差异。未完成节点继续要求原事实、原观察条件和原请求一致。不能借“部分成功”掩盖剩余节点变化。
- 事务内再核对版本、Run、意图和 resourceRevision；通过才保存 updateRequest 的原信封并复用同一 apply，或调用 satisfyNoop 原子保存观察事实与满意槽位。原观察条件进入 adapter 上下文，原 Binding 不改写。
- 优先定位任意 pending/unknown Attempt 并查证，避免前方 ready/noop 槽位挡住后方未知请求。确认 no_effect 后仍经过新鲜读取才能继续。
- 修复实际接线发现的诊断包装差异：检查结果的 source 包装在转换为执行反馈时去掉，保留真实 code/message/hint/metadata，避免 drift 被丢成泛化错误。
- 验证：核心 167/167（含 TSC）；两后端实际 resume 覆盖 drift/令牌变化/映射变化/pending/事务内状态变化的零写入、自动 noop，以及两节点逐次 update 后重新检查。Stripe 离线 13/13；首次创建 walkthrough 实录对照通过。
- **测试仍由存储 fixture 预置已认领 update Run；这次实际运行了读取/事务/派发/回执闭环，但没有证明公开 publish 的 update 认领已完成。** U3.4 负责公开凭据与认领、全图 noop 采用及收尾；U3.5 负责成功后 edit 和修复重新采用；U3.6 补齐故障矩阵后才开放。未调用真实远端服务。本批新改动未推送。
