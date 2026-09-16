# 004：图预检、诊断与当前草稿预览

**设计约束：遵循 [000 项目原则](000-project-principles.md)；原则冲突须先与项目所有者讨论并取得明确同意。本文中的阶段实现记录不覆盖主线，publish/resume 目标及当前差异以 [018](018-draft-lifecycle-proposal.md) 为准。**

状态：已实现；诊断与 preview 契约为 formatVersion=3（fields 键为 canonical JSON Pointer）。持久化 Draft 为 formatVersion=3，规则输入是 ManagedDraft，字段为普通值并另附 fieldIntents；编译与发布见 [018](018-draft-lifecycle-proposal.md)。

## 目的与边界

Preflight 检查当前图，向调用方返回具体问题和足够的当前状态。LLM 结合用户意图生成 OP，库通过普通 edit 校验并应用，之后再次 preflight。LLM 无需接收整套规则再自行寻找错误，规则也不替用户决定唯一修复方案。

未注册 executors 时的 passed 只表示当前检查通过。注册 executors 后的执行检查在 [018](018-draft-lifecycle-proposal.md) 中定义固定计划与发布。这里的 preview 是当前 Draft 意图，不是远端请求体、执行后的预测状态或 drift 检测结果。

## 规则注册与返回

`createStagedWrite({definitions,rules:[{id,version,type,typeVersion,check}]})`。

规则绑定定义版本，纯同步接收独立冻结的 ManagedDraft（普通 graph + fieldIntents），返回实际命中的 GraphDiagnostic[]；没有问题返回 []。注册身份、绑定版本和重复 ID 在启动时校验。函数和注册元数据在装配后固定；实现变化须升规则版本，rulesDigest 不哈函数源码。

| 字段 | 契约 |
|---|---|
| code | 必填，稳定的机器可识别分类 |
| path | 必填，图根 JSON Pointer；空字符串表示整个图 |
| message | 必填，说明当前哪里不符合什么条件；尽量写清当前值和相关事实 |
| severity | 可选 error 或 warning，缺省 error；响应中始终补齐 |
| hint | 可选提示，可解释方向、约束和选择条件，不代替用户作决定 |
| candidates | 可选 `{value,label?,message?,metadata?,repairOps?}[]`；value 为标量（含 null），metadata 为 JSON 对象，repairOps 为选择该候选时可考虑的一整批 GraphOp |
| excludedCandidates | 可选 `{value,label?,message?,metadata?}[]`，仅解释被排除的值，不包含 repairOps，不作为可选项 |
| repairs | 可选 `{id?,message,ops:GraphOp[]}[]`，每项为独立候选修复方案；数组不是必须全部执行的步骤列表 |
| constraintIds | 可选字符串数组，规则作者声明本次采用的约束身份；库不自动解析或执行这些约束 |
| stage | 可选来源阶段标签，不是内建执行阶段枚举 |
| retryable / retryAfterSeconds | 可选预检重试建议；间隔为非负安全整数秒且要求 retryable=true，不调度重试、不授权 publish/resume |
| metadata | 可选 JSON 对象，携带当前问题的结构化事实、单位或其他补充上下文 |
| related | 可选图根 JSON Pointer 数组，定位与问题有关的其他节点或字段 |

引擎补充 source（builtin/rule/executor 身份与版本）。path 和 related 使用 JSON Pointer 转义，例如节点 a/b 的字段 name 对应 `/nodes/a~1b/fields/name`。编辑 OP 使用 `{nodeId:"a/b",path:"/name"}`，两者分别针对图根和节点字段。

**候选值和候选 OP 都是可选辅助信息。只返回 code/path/message 的规则仍然合法；不是每个问题都必须能给出修复方案。**

候选项的 repairOps 与 repairs 中每组 ops 都是一批独立 GraphOp。库用现有纯 OP 预演验证其在被检查图上的结构合法性，不写草稿，不运行这些候选的业务预检，不保证能消除所有问题或符合用户意图。非法候选 OP 使该规则整批输出成为 rule.error/incomplete，不能悄悄丢弃错误提示。候选值不带 OP 时仍只是辅助数据，不保证 schema 或业务适用性。

调用方/LLM 可以选择一组、组合其中部分、修改或另写方案；最终批次必须走普通 edit 的版本、schema、图完整性检查，然后重新 preflight。不能把互斥方案全部连接执行。预检不自动应用 OP，也不把候选当授权。

先前“规则不能再返回 resolution/ops”的表述是过度限制，已依据 2026-09-15 用户明确指示纠正。旧 resolution 字段仍不作为新的协议入口，使用上述有明确建议语义的可选字段。

引擎验证消息非空、字段形状、路径语法及 JSON 数据，不声称能自动判断消息在业务上是否充分或候选值是否符合业务意图。规则作者应测试触发条件、定位、原因与必要提示，避免只返回 “validation failed”。

## 当前图预览

GraphCheck 始终包含 preview: GraphDraftPreview，包括 passed、blocked、pending、incomplete 四种结果及计划生成失败。它与 diagnostics 使用同一个被检查的 Draft 版本，而非额外读取的最新草稿。

预览保留 Draft 身份、定义绑定、节点 ID/类型、全部边、tombstones 和现有来源元数据。每个已有节点按解析后 Schema 列出全部注册字段路径：fields["/profile/name"] 对应该节点的 /profile/name。对象父路径的 value 是重建后的业务对象，子路径分别展示三态；父 remove 向子字段展示 clear。数组整值展示，不列索引路径。包括本地 $ref 展开和 JSON Pointer 转义。

字段状态：

- `{kind:"value",value:...}`：显式值，包括 schema 允许的 null。
- `{kind:"clear"}`：显式清空（remove）。
- `{kind:"undeclared"}`：未声明状态；reset 恢复的基线缺席时才是此状态，仅在 preview 中补齐。

未声明项只是预览投影，不写回草稿；规则仍接收ManagedDraft（普通 graph + fieldIntents）。preview 不可以作为完整替换草稿提交，修改通过 OP 进行。缺节点由业务规则诊断，不凭 schema 自动创建实例。引擎不会为 preview 自动补默认值、解析远端资源或调用 LLM。

```ts
const check = await engine.preflight(draftId);
// Application supplies check + user intent to its LLM and receives chosen GraphOp[].
// Use the version from that response, never silently replace it with a later version.
const updated = await engine.edit(check.draftId, check.version, chosenOps);
const next = await engine.preflight(updated.draftId);
```

`engine.preview(id,version,ops)` 是已有的 OP 预演接口；返回候选和变更，不保存。它与 `check.preview`（本次检查的当前图）用途不同。

## 状态与完整性

空图返回 graph.empty。requiredAtPublish 要求 value 意图，clear/undeclared 均阻塞；允许的 null 属于显式值。缺节点实例、关系基数及跨节点约束由业务规则检查。

有 error 时 blocked，只有 warning 或无诊断时 passed。同步规则误返回 Promise、规则异常或非法输出导致 incomplete，仍附完整预览。该规则输出整批舍弃，不保留其部分诊断；其他规则正常运行。诊断不会自动改变图。规则错误消息指向实现问题，不能要求 LLM 通过修改用户草稿掩盖故障。

## 缓存边界

**每次 preflight 重新调用适用规则，不因 Draft 版本未变而跳过。库不提供缓存接口或缓存存储；规则函数可自行读取缓存，由使用方确定依赖参数、key、有效期与失效策略。缓存读取涉及 I/O 时使用 asyncRules。**

规则返回仍遵循 complete/pending 与诊断协议，缓存不能把未完成检查变成 passed。预算耗尽时未启动的规则仍返回 pending。开始新检查即使旧 check 失效；新结果保存失败需要重新 preflight，不回退旧凭据。本版不新增历史 check 查询，Run 引用的 Artifact 继续保留。

## 时效、存储与升级

check 绑定 draftId/version/definitionDigest/rulesDigest 和随机 checkId。返回值及 getCheck 都是独立快照，修改它们不影响草稿或已保存检查。SQLite 持久化同一份预览和诊断，重开后仍保持一致。

- 重复 preflight 先使旧检查失效。成功 edit 也使旧检查失效，包括净无变化批次。
- 失败编辑和 OP 预演保留有效检查。LLM 返回的旧版本 OP 被 CAS 拒绝。
- 同草稿回调重入编辑/预检被 CHECK_BUSY 拒绝。跨连接编辑或较新检查通过版本/epoch 校验阻止旧结果落库。
- getCheck 只返回最新匹配结果。blocked/incomplete 也可读取，但调用方必须检查 status。
- 当前 formatVersion: 3 标识诊断与 preview 响应契约。fields 键由字段名改为 JSON Pointer，列出嵌套对象路径及全部已注册子路径；旧格式检查必须重新 preflight，不能经 getCheck 或首次 publish 使用。格式版本独立于执行绑定的 rulesDigest，已采用 Run 仍按原执行身份恢复。
- 旧规则中的 resolution 需移除并升规则版本。改变实际规则身份仍受现有恢复绑定约束；不要为恢复旧 run 悄悄替换其规则。

## 验证

覆盖 message-only 规则、可选提示与候选、跨节点关系、warning/error、三态与 null、空图和规则/计划错误时的预览、未声明可选字段、转义字段、返回快照隔离、CAS、SQLite 重开、旧格式检查失效和执行模式。

实现：`src/managed/engine.ts` 与 `src/preflight/`；测试：`tests/managed.test.ts`、`tests/preflight.test.ts`；真实示例：`npm run demo:html`，仅用 Mock 服务与明确的调用方 OP，不含真实模型调用。


## 最小异步规则（2026-09-15）

**同步规则用于耗时可控的纯计算；I/O 或长耗时检查通过 asyncRules 注册。异步规则一次启动或查询后返回 pending，上游重新调用 preflight。任务、去重和进度由接入方管理，库不新增任务表、队列或后台轮询。**

```ts
const engine = createStagedWrite({
  definitions: [definition],
  rules, // ManagedRule[]: pure, synchronous checks
  asyncRules: [{
    type: definition.id, typeVersion: definition.version,
    id: "document.export", version: "1",
    check: async (draft, { signal }) => {
      const status = await application.checkExport(draft, { signal });
      if (status === "processing") return {
        status: "pending", message: "Document export is processing.", retryAfterSeconds: 2
      };
      return { status: "complete", diagnostics: [] };
    }
  }],
  preflightTimeoutMs: 5000
});
const check = await engine.preflight(draft.id);
```

- 管理协议所有 preflight 调用都返回 Promise；是否注册 asyncRules 不改变返回类型。
- `complete` 必须携带 diagnostics；`pending` 必须携带 message，可带 retryAfterSeconds 与已经得到的 diagnostics。失败业务检查返回 complete + 错误诊断，不返回 pending。
- 响应保留当前 preview 与所有已获得诊断，额外给出 pendingRules（ruleId/ruleVersion/message/retryAfterSeconds?）。有检查故障时 incomplete 优先，其次 pending，全部完成后才按诊断得出 blocked/passed。pending 不签发发布凭据。
- 规则以注册顺序逐条执行，默认整轮等待预算 5000ms，可配置正整数毫秒。预算耗尽时后续规则不启动，列入 pendingRules；超时规则标记 rule.timeout/incomplete，并传入 AbortSignal 通知接入方取消 I/O。迟到结果不再合并或落库。预算是等待上限机制，不是 CPU 沙箱，无法抢占阻塞事件循环的同步代码，也不保证底层远端操作被取消；接入方必须配置 I/O 超时并支持 signal。
- 下一次 preflight 重新调用规则，库不保存业务任务句柄，也不提供 exactly-once。规则应通过接入方持久化的业务身份或查询接口复用工作；尤其不能每次查询都无条件重复启动远端任务。耗时永远超预算的规则应改为启动/单次查询后立即返回 pending，避免后续规则持续得不到执行。
- pending 是明确知道“仍未完成”；网络超时是检查结果未知，两者分别返回 pending 和 incomplete，不混用。
- 管理协议以快照、epoch、version 和 resourceRevision 校验。外部 preflight 的 await 期间允许其他 edit 或新检查，但旧结果以 STALE_CHECK 拒绝；close 在检查进行中拒绝。resume 内部的检查持有执行租约，pending 返回后释放。
- 异步规则 ID 与同步规则共用冲突检查；版本及同步/异步类别进入执行规则身份。无匹配异步规则时保持原摘要兼容，恢复已有 Run 仍核对原始绑定。检查与执行使用当前存储协议。
- 本实验版本在 formatVersion: 2 增加 pending 状态及可选 pendingRules；消费者需要补充 pending 分支，不能把未知状态当 passed。此处尚未对外发布稳定版本。


## 与执行诊断共享协议

publish/resume 的接入方可在明确的执行结果中附带可选 code、message、diagnostics。管理协议执行响应返回 ManagedRun 执行事实、对应 preview 与 GraphDiagnostic[]。诊断结构与本节相同，但不会将诊断当成远端未生效证据。

resume 接受修复后的 Draft 时会重新执行本节预检；未通过则响应额外携带 check，preview/diagnostics 属于该修复版本，Run.version 仍为上次获准执行版本。下一次 edit 使用 preview.version。详见 018 的修复续作方案。

## 迁移接线记录（2026-09-16）

预检内部直接读取 ManagedDraft，与规则公开输入保持一致，不再先转成标量包装图再用回调闭包转换回来。候选修复校验使用当前 Draft 的固定基线，与真实 edit 的 reset 一致；基线由引擎从 initialSnapshot 或 publishedArtifactId 对应 Artifact 选取，规则不能另行指定。

本项不改变公开编辑输入：双通道 EditBatch 尚待迁移；嵌套 preview 已在后续 JSON 读链路中接通，准确状态见 [任务账本](../tasks/three-state-op-migration.md)。规则注册复用不代表检查结果缓存；每次 preflight 仍执行适用规则。

当前 ManagedDraft 的 graph.fields 与 set 声明值使用 Json，Step.payload 与远端归一化事实仍保持独立类型。公开旧 create/edit 的输入尚待下一步迁移；JSON 存储/预检贯通不能当作新编辑入口已开放。
