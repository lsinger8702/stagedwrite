# U3：固定图 update 执行账本

**2026-09-17：三态 OP 迁移已结项。按已批准的 [020](../design/020-update-contract-proposal.md) / [021](../design/021-update-data-model.md) 恢复 U3；本账本只记录执行阶段。U4 真实 Stripe update 与 U5 文档验收仍在后面。当前公开 edit/publish 尚未开放远端 update。**

| 任务 | 状态 | 交付与验收 |
|---|---|---|
| U3.1 写前复核组件 | 完成（内部） | 当前本地基线/Run/事实修订一致；新观察值/令牌与已检查条件一致；不静默更换计划。未接入 publish，不是执行授权 |
| U3.2 产物与原请求证据 | 完成（模型与存储边界） | Artifact 保存编译基线、投影/观察；Attempt 固定 update 目标/前置条件；读写边界验证完整证据 |
| U3.3 共用执行槽位 | 进行中（回执路径已接入） | 现有 dispatch 支持 update/noop；update 保留原 Binding，严格匹配确认值；noop 用独立满意证据，不伪造 applied Attempt |
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
