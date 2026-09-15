# 018：Draft 生命周期与首次发布闭环

**状态：2026-09-15，按项目所有者批准的方向实施。原则见 [000](000-project-principles.md)；如需改变固定基线 reset、首次发布归属、图与意图分工或修复保护，必须先讨论。**

**本版不做成功后的远端 update。长期 Draft 身份、成功产物与逐节点 Binding 已保留；不承诺未来无任何数据库迁移。**

## 本轮已落实的决定

| 项目 | 当前实现 |
|---|---|
| 表达意图 | 普通 graph + 独立 fieldIntents；载入校验一致性 |
| reset | 恢复 create 的 immutable initialSnapshot；不恢复前一次编辑 |
| 发布归属 | currentRunId，与首次 Run 同事务建立；不叫 createRunId |
| 修复 | 只改未完成节点字段，成功节点和拓扑不可变 |
| pendingPatches | 不持久化；当批 changes + Run 已采用意图和当前意图对比 |
| 锁 | 注册 DraftLockProvider，与 ManagedStore 配对；租约外置，库管理调用生命周期 |
| 公开入口 | 仅 createStagedWrite；按用户最新要求删除旧引擎及兼容层，不做旧原型迁移 |

## Draft 的逻辑列

| 字段 | 初始值 | 用途 |
|---|---|---|
| formatVersion | 3 | 持久化意图协议 |
| id | 新 UUID | 长期工作/资源图身份 |
| type/typeVersion/definitionDigest | 注册定义 | 结构与版本绑定 |
| version | 0 | 每次成功编辑递增；执行进度不改它 |
| status | pending | 全量成功才 published；部分成功仍 pending |
| graph | 非空普通图 | 节点 ID/type/普通字段值与边 |
| fieldIntents | 初始值对应 set | 路径到声明；remove 表达明确清空，缺席未声明 |
| initialSnapshot | 初始 graph + fieldIntents | 首次发布前 reset 的固定基线；不可更改 |
| tombstones | 空节点/边 ID 数组 | 删除身份不复用，避免错绑 |
| currentRunId | null | 当前发布归属；失败/成功都保留，本版至多一个 |
| targetId | null | 首次发布固定的非秘密目标身份 |
| publishedArtifactId | null | 全量成功产物引用；保留成功意图与计划 |
| lastPublishedAt | null | 全量成功时写入；观察不会刷新 |
| createdAt/updatedAt | 时间 | 显示元数据，不是执行授权 |

这是逻辑模型，非每项独立 SQL 列。SQLite 的 Draft 索引列为 id/version/status/current_run_id/published_artifact_id，其余入 body。检查元数据 checkEpoch/check、resourceRevision、lateFacts 属于存储状态，不混入用户字段。Run、Artifact、Binding、Lease 使用独立表。

## 意图与 reset

```ts
// 普通投影：
graph.nodes.task1.fields = { title: "准备资料", owner: null };
// 权威声明：
fieldIntents.task1 = {
  "/title": { kind: "set", value: "准备资料" },
  "/owner": { kind: "set", value: null },
  "/note": { kind: "remove" },
};
```

set 更新声明和普通值；remove 保存 remove 并移除普通值。reset 从固定基线恢复该字段的声明和值；基线未声明则两者删除。本版 create 接收普通字段，没有 initialOps 参数；所有已有值归一为 set（包括 null）。初始未声明字段之后被 set/remove，再 reset 仍回到未声明。

例如 create title=A，edit title=B，再 edit title=C，reset 得到 A，不是 B。它不负责撤销最近操作。新节点不在基线中，其字段 reset 回未声明。

OP 继续使用 node.add/node.remove/edge.add/edge.remove/set/remove/reset，字段限注册 schema 下的顶层标量。每批按序校验、全批提交或全批拒绝。preview 返回候选，不持久化，也不等同于执行资格；实际 edit 另校验锁和修复限制。

`edit.changes` 是当批变化展示，继续沿用 GraphChange 的 before/after 三态展示格式（value/clear/null），不是持久化意图格式，也不是完整历史。修复安全不依赖它，而是比较 Run 的已采用快照。失败节点多次编辑后，净差异可能为零，version 仍推进并需重新检查。

## 编译、规则和真实请求

```text
create 的普通图 → 持久化 Graph + fieldIntents
  → 同步规则 / 异步检查 → 当前三态 preview + 具体诊断
  → 注册 executor.plan(冻结的 ManagedDraft)
  → 不可变 Artifact（意图、plan、定义/规则/执行器/target 绑定）
  → 库解析声明的 inputRefs，先存 attempt
  → executor.apply(step, key, {signal}) 构造并发送真实请求
```

规则与 plan 都接收 ManagedDraft，能看普通 graph 和 fieldIntents；不把三态包装误作普通字段值。诊断路径仍相对于 preview 的 `/nodes/<id>/fields/<field>`，不是 `/graph/...`。preflight 响应沿用 formatVersion=2 的三态展示协议，包含未声明字段。

注册规则字段：id/version/type/typeVersion/check。同步 check 返回实际 GraphDiagnostic[]；异步 check 返回 complete+diagnostics 或 pending+message（可附 diagnostics/retryAfterSeconds）。具体诊断的 code/path/message 必填，候选与修复建议全部可选，完整协议见 [004](004-graph-preflight.md)。纯静态同步回调不能被 JS 超时机制抢占；I/O 应放到异步规则中，预算耗尽时尚未启动的规则返回 pending；已启动的检查超时返回 incomplete，不能视为通过。

Artifact 保存 id、intentDigest、完整 Draft 快照、plan、binding 和 resourceRevision。digest 包含图关系及声明，不含时间戳。当前 certificate 就是 Artifact ID。每次通过检查都可以生成新 Artifact，但不产生新创建资格。Run 引用的旧 Artifact 不因当前 check 失效而删除。

每个受管理节点恰好有一个 create 步骤，并声明 effect.nodeId。步骤 ID、顺序、依赖、inputRefs 与效果映射明确。payload 当前仍限标量；复杂业务请求由 apply 组织。图边不是自动执行依赖。

**本版没有通用双向路由器，也没有已实现的字段消费声明/clear 映射证明。** 接入方负责读取意图、将 remove 转成其远端明确支持的语义，并测试请求映射。库校验结构、效果映射和成功节点的完整意图，不能证明任意发送函数没忽略某字段。字段用途/消费追踪是后续候选能力，未擅自扩展注册 API。

## Run、Attempt 与 Binding

- Run：id/draftId、kind=initial_create、已采用 version、初始/当前 artifactId、certificate、revision、steps、attempts、events、revisions。
- Run state：running、blocked、unknown、published；拒绝暂停使用 blocked。ready 是待执行/已确认未生效的步骤，feedback 解释原因；本版没有人工 stop/close 状态。
- Attempt：stepId、key、number、实际解析后的 input、pending/applied/no_effect/unknown 与 outcome。原尝试输入不可覆盖；恢复保留每次尝试。
- Binding：nodeId/targetId/remoteId、runId/stepId/key/attemptNumber 与确认 input。每个节点成功立即保存，不等整图完成。同一后端、同目标的一个远端对象不能被两个自有节点重复认领。
- revisions 保留先前的 artifactId、version、steps。成功步骤保持；已尝试请求内容改变时分配新 key，相同输入安全重试保持原 key。

不单独保存每一次 edit 历史，不把 resourceRevision 当远端实时版本。Binding 只是确认事实，unknown 请求可能已经生效但尚无 Binding。

## API 与状态变化

全部管理 API 为 async，详见 `src/managed/types.ts` 与 `src/managed/engine.ts`。

1. `create(selector, initialGraph)`：保存非空初始意图与固定基线；结构合法即可，不要求业务规则全通过。
2. `preflight(draftId)`：短锁开始检查轮次，锁外运行检查，短锁以 version/checkEpoch/resourceRevision 校验提交；过期结果 STALE_CHECK。没有执行器时 scope=draft，无发布凭据。
3. `publish(draftId, certificate, {runId}?)`：获取 Draft 锁。已有 currentRunId 则只观察；明确不同 ID 返回 RUN_ID_CONFLICT。否则验证凭据和注册身份，同事务建立 Run+归属+目标，再发送。
4. `edit(draftId, expectedVersion, ops)`：短锁与版本 CAS。认领前可改结构；认领后只允许未成功节点字段。成功节点包括 planner 未使用的字段都受保护。成功后 UPDATE_NOT_SUPPORTED。
5. `resume(runId)`：同一 Draft 锁下取原 Run。先查证未决原请求，再对新版本预检、保护成功部分、采用新产物、继续未完成步骤。版本未变则直接按已保存事实续作。成功 Run 只观察。
6. `getDraft/getCheck/getRun/getRunInput/getArtifact/getBindings`：查询。getRunInput 是当前已采用 Artifact；旧输入按 revisions 的 artifactId 读取。Run.version 与 previewVersion 明确分开。
7. `close()`：存在进行中的操作时拒绝，否则关闭该实例后端。不要在实例之间共用会被某实例关闭的 SQLite 连接；每实例独立打开相同文件即可共享协议。

resume 内部的重新预检持有执行租约，但异步检查受等待预算约束；pending 时返回并释放。外部 preflight 在锁外运行检查。执行响应始终给当前 preview 和具体诊断；格式不合规的可选诊断不会抹掉效果事实，至少返回基础错误说明。

未知请求查证结果为 applied 后，若用户已将该成功节点编辑为不同内容，先保存回执，再阻断冲突计划；需要把意图恢复为确认输入，不能把新意图冒充已经发布。查证 no_effect 必须证明旧请求不会随后生效；空搜索不够。LLM 建议重试不改变这个前提。

## 锁与存储契约

```ts
interface DraftLockProvider {
  acquire(resource: string, options: { ttlMs: number }): Promise<DraftLease | null>;
}
interface DraftLease {
  resource: string;
  token: string;
  fence: number;
  renew(): Promise<boolean>;
  release(): Promise<void>;
}
```

库构造稳定键 `[storage.namespace, "draft", draftId]`。provider 分配唯一 token、递增 fence，负责原子占用、条件续租和释放；引擎按 TTL 定期续租，失锁触发传给适配器的 AbortSignal，停止推进。获取失败返回 DRAFT_BUSY；后端异常 LOCK_UNAVAILABLE，不降级无锁。

ManagedStore 注册 read/findRun/transact/appendLateFact/close。`transact` 必须在同一个原子边界校验该 Draft 的权威有效租约，读出状态、运行无 I/O 的更新回调、校验不变量并提交。不得用先查询锁再无条件写库替代。外部实现必须保证：

- Draft ID/Run ID/Artifact ID 身份唯一；本版每 Draft 至多一个 Run，currentRunId 与 Run 同事务。
- initialSnapshot 和已保存 Artifact 不可变；Binding 不丢失或改绑；三态投影一致。
- 所有控制变更都验证有效 token/fence，包括 attempt、Run、Binding、检查提交和最终 published。
- `appendLateFact` 只能追加与已保存 attempt 身份吻合的证据，不能更改执行权；返回原事实不会直接授权发送。
- 原子失败全体回滚，读结果无脏读；共享 namespace 一致；日志/证据保留足以恢复。

内置两种配对实现：memory 是同进程共享对象；SQLite 是共享本地文件的多进程存储和租约，事务内用同源时钟验证。独立 memory 对象不共享状态，SQLite 不支持这里声称的跨主机/NFS 部署。**当前没有内置并验证跨主机生产后端；注册端口已实现，不能把它等同于该部署能力已交付。**

发布每次停下并保存事实后 finally 条件释放；失锁后的返回不能覆盖新执行者状态。晚到成功或结果提交失败会尝试追加 receipt，供下一合法执行者采纳；证据存储本身不可用时保留已有 pending attempt，后续仍需查证。锁释放异常可能让调用报错，但不会回滚已提交的效果；按 draftId/currentRunId 观察，不能开新 Draft 假装是重试。

执行推进异常时，在原租约仍有效且存储可写的前提下补记 `interruption` 诊断：存在 pending/unknown Attempt 则 Run 为 unknown，否则为 blocked。保留原始异常给调用方，原请求、成功回执和 Binding 不变；resume 继续推进时清除当前中断诊断。存储不可用、进程退出或失锁可能无法补记，因此持久化 running 不证明仍有活跃执行者，执行权始终由租约决定。

## 存储与单一入口

只保留当前 `sw_managed_*` 表（schema 1）及其内存/SQLite 实现。旧标量/图引擎、旧 SQLite 存储、派生/import/人工裁决/旧接管代码及公共类型已删除；没有 deprecated 别名或旧数据恢复入口。

项目所有者明确说明目前无外部使用者，要求不维护原型兼容。这次删除源码与打包产物，不打开或删除现有用户数据库。当前实验版本使用新数据库；旧原型资料可从 Git 历史查阅，不能再作为当前 API 文档。

## 已执行验证与仍未覆盖的范围

当前新协议测试在 `tests/managed.test.ts`：固定 reset、三态、原子编辑、详细诊断、异步 pending/过期检查、单 Run 防重、修复保护、unknown 原请求查证、SQLite 重开、结果提交失败、跨实例互斥、跨进程租约争用、进程在远端生效后退出、失锁迟到回执与旧解锁隔离。注册、图 OP、预检的有效回归已移到当前入口或仍在使用的纯校验模块；旧执行/迁移/派生专属测试已删除。公共导出与 tarball 检查确保只存在一套引擎。

真实 walkthrough 来自 `examples/publish-resume.ts` 的执行与断言；包含 3 个节点、3 条静态规则、异步 pending、两次改名后 reset、一次 publish、修复后 resume、超时后再次 resume，以及最终 Draft/Binding/Artifact。见 [HTML](../examples/publish-resume.html) 和 [完整 JSON](../examples/publish-resume-trace.json)。

仍未完成：真实跨主机后端故障验证、长期网络分区/压力验证、业务远端真实账号联调、人工处置等后续能力。测试通过不是任意远端 exactly-once 的承诺。

## 长期演进

下一阶段先验证一套实际服务适配器和共享后端，再设计固定图字段 update；随后增加/删除子树、多效果、远端读取与 drift、Saga 补偿。未来 update 使用同一 Draft 身份、成功 Artifact 与 Binding，按明确策略切换 currentRunId，并保留旧 Run；不是每次无条件生成新 Run。

旧更新失败可能有部分成功和 unknown，diff 不能单凭“最近全量成功产物”忽略它们。更新采用哪个基线、如何消费部分事实、如何解决旧未决请求，必须在开放 update 前讨论并验证。本版为此保留事实与引用，不提前作出未批准的切换策略。
