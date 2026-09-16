# 三态 OP 迁移账本

**唯一进度账本。2026-09-16 用户要求：先方案、任务拆分，再逐项完成并及时更新。方案见 [022](../design/022-three-state-op-migration.md)。**

**已确认：所有编辑 OP 只允许 set/remove/reset；移除 node/edge 专用动作；双通道；新建携带内容/复制来源；固定基线 reset 与执行保护保留。公开 create 已切换非空 roots/spec 与 createdRefs；edit/preview 与候选修复已切换双通道。2026-09-17 M00–M09 已按下方证据结项；远端 update 派发仍未实现，下一步恢复原 update 计划。**

## 记账规则

- 状态仅：待做 / 进行中 / 待外部条件 / 完成。一次推进一个主要任务，依赖未完成不越过。
- 开始时记录状态/范围；完成时记录改动文件、验证命令及结果、剩余限制、提交（若有）。
- 子项没做完不能把父项标完成；测试失败、未接线、仅类型定义不算能力交付。
- 发生新发现立即补账，不在最终回复中临时编造完成情况。中断保留下一步与阻塞原因。
- 私有评审目录不进入提交；真实证据不可通过改历史摘要伪造刷新。

## 顺序与任务

| ID | 状态 | 依赖 | 交付物 | 验收/完成证据 |
|---|---|---|---|---|
| M00 | 完成 | 无 | 决策记录、022 迁移方案、影响范围、此账本 | 已读 GraphOp/evaluateGraphEdit/initialize/editIntent/Schema 与已有路线，确认旧协议七动作、顺序求值、顶层标量；文档链接与差异检查 |
| M01 | 完成 | M00 | 完整请求/响应契约与状态用例表，关闭 022 §7 的细节 | 每种 set/remove/reset 在两通道均有定义/拒绝规则；根/边/复制/同批冲突/嵌套/预演无歧义；对照参考真实契约，不凭空推断 |
| M02 | 完成 | M01 | 新 PatchOp、EditBatch、TopologySpec、回执和工具 schema | 静态/运行时只接受三种 op，互斥字段验证；不保留旧公开别名 |
| M03 | 完成 | M02 | 拓扑通道求值、初始内容展开、服务端身份及 createdRefs | 引用按请求前图；全批失败不写；无幽灵 refs；图的关系/共享引用正确 |
| M04 | 完成 | M03 | 嵌套 Schema/三态字段求值/显式 scope | 父子路径优先级、null/remove/未声明、固定基线 reset、非法 scope 测试通过 |
| M05 | 完成 | M04 | create 与 edit/preview 单入口接线、复制 spec | 非空初始意图；复制只带意图、不带 Binding/Run；输入位置映射；CAS/租约/成功保护保持 |
| M06 | 完成 | M05 | 诊断候选修复、preview、SDK/示例调用全部迁移 | message-only 仍可用；候选批次可预演；模型不需要 node.op 或真实远端 payload |
| M07 | 完成 | M06 | 核心/存储/恢复回归、隔离包验证及文档清理 | 旧动作只出现在迁移说明与拒绝测试；合法批次/失败原子性/unknown/成功保护测试通过 |
| M08 | 完成 | M07 | walkthrough HTML/ZIP、Stripe 样例与证据刷新 | walkthrough 闸门、Stripe 离线闸门通过；样例源码变化后需真实重录，不能仅改 digest。缺凭证标待外部条件 |
| M09 | 完成 | M08 | 迁移总结、账本结项、恢复 update 派发 | 明确已实现/限制，检查无兼容残留；恢复 U3 前确认 OP 新入口稳定 |

## 本次记录

### M00 — 完成

- 用户明确否定 node.op，批准三态为封闭集合；已写入 000 与开发约束。
- 新增 022 方案和本账本，优先级调整为 OP 迁移先于 update 派发。
- 本次只落方案，不更改编辑运行时，不将 M01–M09 标为完成。
- 进入本任务时：main 已推送到 c3a9036；共用 Step 与发布采用记录的上一批改动仍在工作区，核心 85/85 的历史验证不等于新 OP 测试。
- 下一项：M01。先对照参考接口/测试，给出完整互斥类型和边界矩阵，关闭方案 §7 的未决细节。
- 本任务未提交/推送；提交号在实际提交后补记。

## 延后且不遗忘

- R1：存储式 preflight 规则与规则 Schema——所有者要求先记 TODO；见 [Roadmap](../roadmap.md#todo存储式预检规则与规则-schema)。不属于本次 OP 迁移，也不是检查结果缓存。

- U3：update/noop 实际派发与正式无写入提交——等待本迁移完成；已做代码保留。
- override 实际覆盖空间、自动推导/抑制——不在本阶段偷偷开放；若实现推导，既定五条边界必须一起验收。
- 远端实体导入复制、资源拓扑 update、多效果补偿——单独规划，不等同本地意图复制。

### M01 — 进行中（参考行为核对）

- 已对照参考的输入校验、双通道执行器、节点 reset 与混合批次测试；提炼记录见 [023](../design/023-three-state-op-boundaries.md)。不复制私有实现与领域模型。
- 已确认：字段 ref 按请求前图校验；拓扑先于字段；同批删除的节点不能接收字段修改；reset 始终读取固定基线；创建返回输入位置到新身份的映射。
- 重复坐标冲突已裁决：所有者确认整批拒绝，且响应必须有 message/hint。已更新 000 P2、022 与 023；尚未修改运行时。
- 022 的省略 scope 默认 canonical 只是未定接口提案；按参考收紧为显式 canonical，其他空间暂不开放。
- 未完成：通用关系槽位/复制共享边的准确类型；嵌套声明正规化与 reset 恢复矩阵。M01 不标完成，M02 不抢跑。
- 当前没有新增运行时代码，既有测试通过记录不能作为本项实现证据。

### M01 增量 — 重复坐标裁决落档

- 用户确认“拒绝”，额外要求 message/hint；已写为必填诊断，而非可选建议字段。
- 023 §7 增加具体响应示例、输入索引、同值重复/三次重复/多个冲突组/preview 一致性验收项。
- 变更范围：000、022、023、本账本；文档差异检查通过。未宣称完成 M01，未提交或推送。

### M01 — 契约完成

- 024 明确两通道互斥形状、显式关系所有权、引用/克隆范围、固定基线恢复、嵌套声明正规化及预演身份。
- 022 §7 / 023 待定点以 024 的明确范围结案；跨快照克隆、数组索引等未开放能力明确拒绝。
- 这是设计交付，不是运行时能力；后续按 023 用例落测试。

### M02 — 进行中

- 先建立严格 JSON 输入形状与重复坐标诊断的内部协议模块；后续接线后才更换公开导出，避免导出不可用协议。
- 完成类型/纯校验不等于完成引擎迁移；本项剩余回执、工具 schema 与公开替换以实际进度记账。

### M02 增量 — 输入协议与诊断已验证

- 新增 `src/edit/protocol.ts`：严格 JSON 快照、三态/双通道互斥类型、NodeSpec、CreatedRef、输入校验；所有拒绝携带非空 message/hint，重复坐标聚合全部冲突位置。
- 新增 `src/edit/tool-schema.ts`：递归 NodeSpec 与两通道 JSON Schema；文档明确结构 schema 不能代替重复坐标/图/执行保护校验。
- 新增 `tests/edit-protocol.test.ts`，含类型拒绝、同值重复/不同 OP/多个冲突组/转义路径/克隆互斥/旧协议拒绝/输入隔离/恶意 JSON 及实际 Ajv 编译。
- `npm test`：91/91 通过（含新增 6 项）；`git diff --check` 通过。首轮失败来自测试辅助函数默认参数吞掉 undefined，已修正真实输入并重跑全部测试。
- 仍未完成 M02：新的 changes/回执类型；公开替换需随 M05 接线一次切换，不能提前导出第二套可调用引擎。当前模块未接入 managed，不把纯校验测试记成 edit 原子性集成验证。
- 未修改 Stripe 样例或历史证据；未提交/推送，私有评审目录未纳入改动。

### M02 — 协议组件完成；公开切换归 M05

- `src/edit/results.ts` 补齐轻回执、createdRefs、双通道输入 pointer 的变化记录和显式预演类型；无完整图混入 edit 回执。
- 协议类型/严格输入校验/工具 schema/回执类型已齐。包公开入口替换明确在 M05 接线一次完成；本条完成仅指协议组件，不宣称 managed 已迁移，不导出兼容别名。
- 回执类型的 preflightRequired 只能 true；旧动作不能出现在 changes 中；类型负例经 tsc 验证。

### M03 — 进行中

- 已实现候选级身份分配：真实和 preview 名字空间隔离，保留当前/墓碑身份，碰撞重试有上限；所有已有 ref 位置拒绝 preview 身份并提供 message/hint。
- `npm test` 94/94 通过；新增三项身份行为测试。
- 下一步：关系所有权/基数/环/共享删除约束，再实现完整拓扑求值和 spec 展开。尚未接入 managed。
- 推送请求被自动审批两次拒绝，补充了公开目标与差异检查仍要求用户明确确认完整公开范围；确认已发出，未提交/推送，不绕过审批。

### M03 增量 — 拓扑安全约束

- `src/edit/topology.ts`：显式关系基数、单父拥有、拥有环检测（迭代遍历）；reference 可共享/成环，不当成拥有关系。
- 删除集合仅沿 owned 闭包计算，存活节点的 reference 指入集合时拒绝，message/hint 定位引用者与关系；不隐式删除共享目标或引用者。
- `tests/edit-topology.test.ts` 验证上述规则与纯函数不修改输入；核心 `npm test` 97/97 通过。
- 仍未完成 M03：注册端口接线、完整拓扑 set/remove/reset 求值、初始 spec 展开与克隆。当前是安全组件，不是已完成拓扑编辑接口。
- `git diff --check` 通过。远端推送仍待用户对自动审批所要求范围的确认；本轮没有提交。

### 推送授权确认

- 用户再次明确允许将本轮库代码、测试、设计文档和账本提交到既有公开仓库；排除私有评审目录与凭证。此前审批阻塞已解除。
- 本次提交包含 M00/M01 文档、M02 协议组件、M03 已测试的身份/拓扑约束组件，以及迁移前保留的 update 计划校验和采用记录改动。M03 与公开引擎迁移仍未完成。

### M03 增量 — 初始展开与拓扑候选求值

- 新增 `src/edit/evaluate-topology.ts`：严格初始 roots/spec 校验、嵌套初始声明展开、服务端身份与输入位置映射；set 追加/替换关系、owned 子树删除、固定基线节点 reset、请求前快照克隆。
- 克隆重映射子树内部引用、保留外部共享目标并复制 remove 声明；reset 恢复原身份与基线字段，不自动恢复普通子节点；新节点 reset-as-remove。
- 字段 ref 在拓扑前后均检查；失败只丢弃候选，不改变原图/基线；createdRefs 过滤本批已经回收的节点。
- 修复替换多个 owned 子节点时删除集合应取并集的问题：集合内互相引用不算外部阻挡，存活节点指入仍拒绝。
- 新增 8 项求值测试；`npm test` 105/105，通过 TypeScript 编译；`git diff --check` 通过。
- M03 仍进行中：注册端口接线/定义校验尚待完成；普通字段 schema 校验、字段编辑属于 M04，统一生命周期接线属于 M05。本次纯求值通过不代表公开引擎已迁移，也没有远端 I/O。
- 上一批已推送提交：9bd3820。本段后续代码仍在本地，未提交或推送。

### M03 — 注册与拓扑组件完成

- 上一批纯拓扑求值已按用户请求推送：`b468f08`。
- 复用现有 DefinitionRegistry：登记 ownership/cardinality，枚举值必须是真正字符串，数组/null/未知值拒绝；内容参与原定义 digest，无独立可变策略表。
- 新增 `src/edit/registered-topology.ts`，将同一注册定义、初始展开、候选拓扑与字段 schema 校验串联。三态入口缺少关系元数据直接拒绝，不推断默认值；evaluate 验证原 definitionDigest。
- `tests/edit-registration.test.ts` 验证元数据、冻结注册/摘要变动、缺失声明、非法字段失败原子性与实际子树展开。
- 验证：核心 `npm test` 108/108；Stripe 离线 13/13（包含原证据闸门，未修改样例或历史摘要）；`npm run verify:package` 通过；`git diff --check` 通过。
- M03 完成指内部拓扑/注册组件交付。当前公开 managed 仍未切换；M04 完成嵌套字段后，由 M05 一次接线。新结果不是发布凭据。
- **M05 必须移除过渡宽度**：共享 DraftTypeDefinition 的关系属性暂为可选，仅为当前旧公开入口仍在使用；新 registeredTopology 始终强制两项必填。公开切换时改为必填，并更新所有定义/样例，不能留下默认或兼容模式。Stripe 样例源码变化仍按 M08 真实重录闸门执行。
- 下一项 M04：递归 Schema 与字段三态正规化/路径求值，含父子覆盖和固定基线 reset。
- 本段注册代码仍在本地，未再次提交/推送；私有评审目录未纳入。

### M04 — 进行中

- 开始递归闭合对象/数组/本地 ref Schema 与字段三态路径求值；先内部接线，公开 managed 仍等待 M05。

### M04 — 递归 Schema 与字段求值组件完成

- `registry/types.ts` / `profile.ts` 支持闭合对象、数组、nullable 容器与递归本地 $ref；保留缺失引用/循环拒绝，数组 items 强制 schema 校验。`getValueSchema` 返回独立的解析后 schema 副本供路径解释。
- 新增 `src/edit/fields.ts`：按序应用嵌套 set/remove/reset，对象存在标识与子声明分离；父 remove 后改子字段保留兄弟 clear；显式 null 父不被静默覆盖；数组只能整值编辑。
- reset 从固定基线读取，支持祖先 remove 的有效清空语义；不将本批拓扑 reset 或前一次 edit 当新基线。图/声明不一致拒绝。
- `registered-topology.ts` 已串联拓扑段 → 字段段 → 最终 schema 校验，失败不写原输入；字段变更使用各通道输入 pointer。
- 内部 `previewFields` 展示注册路径的实际三态和重建后的对象值，不把 set {} 容器标识当作真实对象内容；公开 preflight 响应迁移仍归 M06。
- 新增 7 项字段/Schema/混合批次测试；核心 `npm test` 115/115，Stripe 离线 13/13，`git diff --check` 通过。
- M04 完成指内部组件。当前公开 managed 仍使用旧编辑路径；M05 必须一次切换 create/edit/preview、持久化投影及成功保护，不可把内部测试当成已迁移公开 API。
- 本轮未提交/推送；下一项 M05。此前本地注册改动仍一起保留。

### M05 — 进行中

- M03/M04 与存储式规则 TODO 已推送：3a2db6b。
- 先核对公开 preview/edit 的安全一致性，以及新候选求值在修改前对当前/基线快照的完整性校验；再切换公开协议。

### M05 增量 — 预演保护与修改前快照校验

- 公开 managed preview 原先只求值、不执行 edit 的成功节点/拓扑/发布状态保护；已与 edit 对齐，发布成功后仍 UPDATE_NOT_SUPPORTED。预演不写入，不消费检查凭据。
- 新字段模块增加 validateIntentSnapshot，并在拓扑求值前检查当前与固定基线：图/声明一致、声明路径已注册、无孤儿声明、值匹配 schema。防止 topology reset 先覆盖损坏输入而绕过检查。
- 新增公开 API 保护一致性及损坏快照拒绝测试。核心 117/117；walkthrough 5/5；Stripe 离线 13/13；git diff --check 通过。
- M05 仍进行中：尚未切换公开 create/edit/preview 协议、存储格式和所有调用方；当前改动不能记为迁移完成。本段本地未推送。

### M05 增量 — 共用受管编辑边界

- 新增 edit-guards.ts，公开引擎 protect 已复用其图/成功节点保护；新候选准备使用同一逻辑，不保留两套 Run 修复语义。执行计划保护仍由引擎处理。
- 新增内部 prepare-edit.ts：版本 CAS 前置、版本溢出拒绝、三态批次求值、成功保护、轻回执及显式预演；保持 currentRunId 与固定基线等元数据。它是纯候选准备，不是新公开引擎或持久化入口。
- 新增 3 项边界测试：preview/提交候选的安全一致性、planner 未使用字段保护、unknown 未完成节点修复、published 拒绝、回执/候选隔离与基线不变。核心 npm test 120/120；git diff --check 通过。
- **公开切换未完成**：create roots/createdRefs 返回、managed 快照与预检投影、候选 repairOps、现有调用方必须一起迁移；不能仅改公开方法签名宣称完成。M05 保持进行中。
- 本轮未提交/推送；没有修改真实 Stripe 样例与历史证据。

### M05 增量 — 存储快照约束

- 上一批共用受管编辑保护已按要求推送：948dba2。
- 新增 managed/snapshot.ts，并接入所有后端共用 validateState：校验当前 Draft、initialSnapshot 和每个 Artifact 的意图快照，拒绝不一致投影、孤儿声明、非法持久声明形态、悬空边和非 JSON 输入。
- 校验不依赖新编辑入口是否已启用，不能通过直接 Store 事务绕开。SQLite 重开读取同样执行，坏数据拒绝后原记录保留，不静默修复。
- 新增 5 项测试，覆盖嵌套 null/空对象/数组/清空投影、内存与 SQLite 失败原子性、外部损坏 SQLite 后重开拒绝。
- 核心 npm test 125/125；walkthrough 5/5；Stripe 离线 13/13；git diff --check 通过。
- M05 仍进行中。本次完成存储层前置约束，未切换公开 create/edit/preview 及 repairOps；没有将低层校验通过记作公开协议完成。公开切换与调用方迁移仍是下一步。
- 本段代码本地未提交/推送，私有评审目录仍未纳入。

### M05 增量 — 预检直接读取受管意图

- 存储快照约束已按要求推送：40c4b88。
- 预检主路径、异步规则和执行响应预览改为直接接收 ManagedDraft；移除独立 GraphRule/AsyncGraphRule 定义及每轮转换回调。规则注册只装配一次，检查结果仍每次重算，不引入结果缓存。
- preview 直接从 graph 与 fieldIntents 生成，保持现有响应字节和三态含义；不泄露 initialSnapshot/currentRunId 等存储元数据。此处尚未开放嵌套公开响应。
- 候选修复校验改用与真实 edit 相同的固定基线语义；同步/异步预检、执行反馈、preview/edit 共用初始或已发布基线选择，不再把候选 reset 当作简单删除声明。
- 新增两项回归：同步/异步规则拿到隔离冻结的真实作者快照；候选 reset 实际送进 Schema 的值与公开 preview 相同（恢复原值及 null，而非未声明）。
- 验证：核心 127/127；walkthrough 5/5（原产物字节一致）；Stripe 离线 13/13；git diff --check 通过。真实 Stripe 源码和历史录制均未修改。
- **M05 未完成，公开 create/edit 仍是旧输入协议。** 本轮完成实际预检链路的模型依赖拆除，不是新 API 交付。后续必须一起完成：ManagedDraft 的 JSON 类型与嵌套 preview → create roots/createdRefs 与 prepareEdit 接入现有事务 → repairOps 双通道与全部调用方迁移 → 删除旧 GraphOp 求值器并完成证据重录。不能留下两套公开协议或兼容别名。
- 本段新增改动尚未提交/推送；私有评审目录未纳入。

### M05 review — 存储校验成本、错误优先级与字段边界

- 上一批受管预检接线已推送：1b282ae。
- 确认三项 review：历史 Artifact 的投影重复计算、不可变性错误被内容错误遮蔽、节点/边未知键未拒绝，均已处理。
- 内部 validateWrite 要求可信 previous：先查历史不可变，再校验当前 Draft/initialSnapshot 和新 Artifact 的投影、状态关联，最后查状态迁移。旧 Artifact 必须先通过逐项不可变比较才能跳过投影。没有暴露可让调用方关闭校验的公开开关。
- SQLite read 仍全查磁盘内容；事务写移除 persistence-only write 中的第三次全量校验。appendLateFact 同样经过已验证旧状态和新状态写边界；重复事实直接返回。
- 这只消除冗余投影，不声称存储开销不再随历史增长：历史比较、磁盘读取与序列化仍存在。
- 修改/删除已有 Artifact 明确报 ARTIFACT_IMMUTABLE，修改初始快照报 INITIAL_SNAPSHOT_IMMUTABLE；新坏 Artifact 仍报 STATE_INTENT_INVALID。节点和边使用精确字段集，remoteRef 等不得混进作者图。
- 回归覆盖两种后端的失败原子性/错误优先级/新坏 Artifact，以及 SQLite 历史 Artifact 和其初始快照外部损坏时 read/transact 拒绝、事务回调不运行、原始 body 不变。
- 核心 npm test 129/129（含 TSC）。M05 公开协议切换仍未完成；未把这次 review 修复记为迁移完成。
- 物化 Graph 与读取时派生的取舍已记 Roadmap R2，待公开协议/读路径收敛后讨论；当前保持批准模型。本轮新增改动尚未推送。
- 补充验证：walkthrough 5/5、Stripe 离线 13/13、打包消费测试及 git diff --check 均通过；生成产物和 Stripe 历史证据保持原字节。

### M05 增量 — 受管 JSON 类型与预检投影贯通

- 存储 review 修复已按要求推送：fe52854。
- ManagedDraft 的普通字段和 set 声明值改为 Json，公开导出 Json 类型；Step.payload 和 NormalizedValue 不随之放宽，适配器仍负责映射。样例的标量读取器显式校验类型，测试中的标量 schema 在 planner 处收窄类型。
- 存储读取/getDraft 不再经过旧标量 toInternal，改用注册 Schema/声明投影校验。旧桥仅暂存于尚未切换的编辑路径；不添加另一工厂或兼容 API。
- preflight / publish / getRun 的 preview 共用嵌套字段投影：fields 键是 canonical JSON Pointer，含解析后 $ref 的对象子路径、继承 clear、未声明、显式 null、数组整值。对象父值从声明重建，不是内部 set {} 标识。每个节点只重建一次投影供所有路径读取。
- 检查响应升级 formatVersion=3；旧格式 getCheck/首次 publish 拒绝，须重新预检。已采用 Run 的执行身份与原凭据不被响应格式更改覆盖。
- 内存/SQLite 集成测试以新求值器生成的 JSON 意图，通过实际存储契约落库，验证 getDraft → preflight → Mock publish → getRun 和 SQLite 重开。**测试没有伪称公开 create/edit 已迁移：本轮嵌套初始数据由测试通过存储写入。**
- 更新中英文 README、004 预检设计、样例读取方和 HTML renderer；重新执行生成 JSON/Markdown/HTML/离线 ZIP。新增页面运行检查，覆盖字段标题、嵌套对象值及转义节点的诊断定位。
- 验证：核心 132/132（含 TSC）；walkthrough 6/6；Stripe 离线 13/13；打包消费检查与 git diff --check 通过。Stripe 只改离线测试对 preview 字段键的读取，五个运行时样例模块及历史录制未改。
- **M05 仍进行中。已完成受管 JSON 类型及读/预检链路；待完成公开 roots/createdRefs、prepareEdit 的事务接入、候选 repairOps 双通道、调用方身份迁移及旧编辑器删除。** ManagedInitialIntent 暂保留当前标量 create 输入约束，不表示新 roots 协议已经上线。
- 本轮新增修改尚未提交/推送；私有评审目录未纳入。


### M05 增量 — 公开 edit/preview 与候选修复切换

- 上一批 JSON 预检接线已推送：919ae7a。
- 唯一 createStagedWrite 的 edit/preview 现在只收 EditBatch（graphPatches / patches），直接调用 prepareEdit，并在原租约/事务内提交；旧数组入口运行时和类型层都拒绝，没有兼容分支或第二工厂。
- edit 返回轻回执 + createdRefs，preview 返回显式 preview 标记及临时身份；成功节点/拓扑保护仍在提交前执行，unknown 原请求查证机制未改。
- 移除旧 editIntent 函数及公开 GraphOp/GraphChange 导出。旧 GraphEditError/内部七动作求值器当前仅为旧 create 初始化保留，必须随下一项 roots/spec 迁移删除；不能标 M05/M07 完成。
- 关系 ownership/cardinality 已在共享注册层及公开类型强制必填。现有定义逐项声明 owned/reference/many；不猜默认语义。
- preflight 与执行诊断候选 repairOps、repairs[].ops 统一改成 EditBatch，使用同一注册求值器按固定基线纯预演；建议不自动执行、不授予 Run 修复权限。message-only 规则仍有效。
- 迁移原有标量编辑/执行/恢复/预检用例与包消费者；旧图测试按批准语义重写，保留共享引用、失败原子性、身份隔离、墓碑/基线恢复、三态、版本等覆盖。旧“同坐标连续覆盖”用例改成整批拒绝 + message/hint，不能再以旧测试覆盖原则。
- 新增公开嵌套闭环：create 初始工作 → edit 写入对象/数组 → preflight → 远端具体拒绝 → 取响应中的单坐标 repairOps → edit → resume 同一 Run；未改兄弟字段与数组，最终 published。
- Stripe 三个运行时样例模块因接入新协议变更，已真实重跑 sandbox，并核对新公开录制后更新文件和 checksum：publish blocked → edit → resume unknown → resume published；1 Product、2 Prices、3 Bindings、同一 Run；unknown 查证阶段无 POST。没有通过改历史摘要冒充重跑。
- 新文档与 walkthrough 正在同步；M06/M08 的调用方适配/重录属于本次接口切换的必要验证，最终总验收仍需等 create 迁移完成，未提前勾完成。
- **下一项明确：公开 create roots/createdRefs、服务端初始节点 ID、调用方初始身份迁移，然后删除剩余旧初始化器。** 当前 create 仍使用已有初始 graph 参数，这一限制已写 README。
- 本轮新增修改尚未提交/推送；私有评审目录未纳入。

- 最终验证：核心 133/133（TSC 干净）；walkthrough 6/6；Stripe 离线 13/13（含新真实录制的源码摘要、字节和场景闸门）；隔离安装/TypeScript 包消费通过；git diff --check 通过。HTML/JSON/Markdown/ZIP 已由实际执行生成并复验。


### M05 — 公开 create 接线完成

- 上一批 edit/preview 与候选诊断已推送：3d63fa1。
- create 现在只接收非空 roots/spec（InitialIntent），在保存前展开并校验完整初始图/声明，一次租约事务保存 Draft 和固定 initialSnapshot；返回 `{draft, createdRefs}`，服务端节点 ref 对应输入路径。拒绝旧 nodes/edges、调用方 ID、空 roots、创建时 clone/ref 及非法后代；错误有 message/hint，失败不保存半个 Draft。
- 删除 src/graph/edit.ts、GraphOp/GraphChange/GraphEditError 和旧 initialize/toInternal/fromInternal；没有旧入口或协议转换兼容层。
- 公开嵌套 create → edit → preflight → publish → repair → resume，以及公开 clone spec 已通过真实引擎回归；固定基线、原请求 unknown 查证、成功节点保护、SQLite 重开和并发租约测试继续通过。
- 测试通过 create 回执记录实际 ref，仅将输入位置与测试业务别名对应，不改真实节点身份或转换请求。纯 diff 的转义节点 fixture 是脱离存储的人工测试快照，未写回引擎。
- Walkthrough 和 Stripe 改用 roots/spec。adapter 的稳定步骤 ID 与实际节点 ref 分开；Stripe 的错误坐标来自 Step.effect.nodeId，重开后从当前图找回本例唯一角色。
- 独立 Mock 演示启动器固定 UUID 序列，便于节点身份、图摘要、计划和引用的重跑比较；不进入 npm 包，也不被真实 Stripe 使用。HTML 展示启动器源码。时间仍来自真实运行，只在语义复验中归一；字节闸门继续检查生成文件，反例覆盖 createdRefs/边目标篡改。
- 新真实 Stripe 录制：2026-09-16T12:09:59.475Z，blocked → unknown → published，1 Product / 2 Prices / 3 Bindings，单 Run，两次 SQLite 重开，unknown 恢复无 POST。审阅白名单摘要后更新公开 JSON 与 SHA-256，未改旧摘要冒充新运行。
- 验证：核心 136/136（含 TSC）；walkthrough 6/6；Stripe 离线 13/13；隔离包安装/TypeScript 消费通过；git diff --check 通过。
- 中英文 README、018/004、Stripe 接入指南及 HTML/JSON/Markdown/ZIP 已同步。update 派发仍未开启。

### M06 — 收尾清单

- 诊断候选与实际示例调用方已经迁移；继续核对工具 schema 的包级接入、类型消费和所有面对 Agent 的说明，不能把内部 editBatchSchema 测试当作公开 SDK 已交付。
- 随后 M07 做全仓旧协议残留和最终回归验收，M08 复核生成产物/真实证据，M09 结账后才恢复 update 派发。以上阶段尚未勾完成。


### 2026-09-17 M06 — 包级输入 schema 与调用方接入完成

- 从唯一包入口公开 editBatchSchema 和 initialIntentSchema，均为独立 JSON Schema 2020-12 文档且深度冻结。create 的递归 schema 不提供 ref/clone，edit 保留三态双通道；不新增引擎、自动执行或 provider 专属入口。
- 新增 tests/public-tool-schema.test.ts：包级导入后编译 schema，JSON 初始内容进入真实 create；诊断候选批次经 preview/edit/preflight 修复；重复坐标和业务类型即使结构通过仍被引擎拒绝；错误 message/hint 保留，拒绝不破坏原检查。
- 隔离 npm tarball 消费验证同时编译两份 schema，并检查类型导入、冻结导出和现有 SQLite 生命周期。新增 docs/guides/agent-inputs.md，中英 README 引用；明确 $defs 的文档根、宿主权限/版本、结构校验与执行资格的区别。
- 本项交付的是现有公开协议和调用方/schema 迁移。Roadmap A1 的通用受控 dispatch、完整 Agent helpers 和模型 Harness 仍独立待做，不因本项完成而宣称已实现。

### 2026-09-17 M07 — 回归及残留核对完成

- 核心 139/139（含 TypeScript 编译），隔离包消费通过；src/scripts/examples 运行代码扫描无旧七动作名、GraphOp/GraphEditError、toInternal/fromInternal 或迁移桥。
- 旧动作仅保留在设计迁移说明和拒绝测试。修正 018 中遗漏的七动作、顶层标量、旧 changes 和 preflight v2 描述；023 明示历史核对与 024 已收敛契约的关系。
- 原子失败、三态/嵌套/固定基线、创建/克隆身份、preview 安全、单 Run、unknown 原请求、SQLite 重开和租约/中断等既有回归全部通过。git diff --check 通过。

### 2026-09-17 M08 — 证据复验完成

- walkthrough 重新执行并与已提交记录比较，HTML/JSON/Markdown/ZIP 字节及页面检查 6/6；生成产物没有漂移。
- Stripe 离线 13/13：五个运行模块源码摘要、已审阅录制字节与场景闸门通过。本轮没有改 Stripe 运行模块或历史证据，没有调用远端；真实验证仍是 M05 记录的 2026-09-16 那次沙盒实验。

### 2026-09-17 M09 — 迁移结项

- 唯一 createStagedWrite 已完成 create roots/spec、edit/preview 双通道、诊断候选、包级工具 schema 与全部现有调用方迁移，无旧协议兼容入口。
- 保留限制：数组整值、无跨 Draft 克隆、无新增无父根编辑；未完成 Run 的拓扑与成功节点受保护；unknown 先查证原请求。模型不直接提交真实请求体或执行 Step。
- OP 迁移阻塞解除；下一阶段按 020/021 和原 update 任务计划继续，共用 Run/Attempt，不另造执行器。当前 UPDATE_NOT_SUPPORTED 未解除，不能对外宣称远端 update 已可用。
- 本轮代码/文档尚未提交或推送，私有评审目录未纳入。

### 推送及后续归属

2026-09-17 用户要求推送并继续，M06–M09 收尾已推送 `d6b0e77`。后续实现进度转到 [U3 执行账本](update-execution.md)，不在已结项的 OP 账本内混记新执行能力。
