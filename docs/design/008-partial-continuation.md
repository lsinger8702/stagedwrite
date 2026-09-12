# 部分创建成功后的派生

状态：已实现 H2 的 create-only 子集；多操作节点与已有对象更新不在此契约内。

## 映射与派生

Step.effect 可声明 `{ kind: "create", nodeId }`。图预检校验节点存在、映射不重复；普通计划仍可省略。
continueFrom 要求源 run 为 failed，既有 applied/reused 又有 failed，其余只能 skipped，且所有步骤
与图节点构成完整一对一 create 映射。为回执字典保留 __proto__/constructor/prototype，不接受这些步骤 ID。
不支持运行中、unknown、blocked、closed、published 或零效果 run；零效果仍使用 revise。

新草稿复制原图意图、边与墓碑，生成新 ID、version=0、sourceRunId；continuation 保存立即来源 run 和
已成功步骤的 nodeId/sourceRunId/sourceStepId/remoteRef/resolvedPayload。这些字段只能由引擎产生，
OP 不可修改，返回值与内部状态隔离。相同源 run 只派生一个新草稿；再次失败可从新 run 继续派生。
这是一份带已完成创建证据的意图副本，不是从远端下载的最新完整状态。

## 复用约束

已成功节点的内容与身份固定，编辑、preview、规则建议共用 evaluateGraphEdit 拒绝改变/删除这些节点。
失败节点可编辑、删除或新增，但新计划仍须完整映射新图。边仍可编辑；如果边变化改变了已复用步骤的
操作语义，executor 必须把它反映到 payload/dependsOn/inputRefs，预检随后拒绝该变动。

每个复用步骤要求相同 step ID、effect、payload、dependsOn、inputRefs；依赖也必须来自复用集合。
预检核对源 executor ID/version、target、definitionDigest，并在新的 ExecutionBinding 加 continuationDigest。
新的 planDigest 仍覆盖完整计划；重复 publish 只观察原 run。executor 是可信且必须版本化的代码，
不能把操作语义藏在不随 payload/version 变化的外部可变状态中。

publish 创建 run 时，从受保护的回执初始化 reused 步骤并追加独立 reused 事件；不伪造新 applied 事件。
reusedFrom 指向立即来源 run/step，连续派生可以沿此链追溯最初的 applied 或人工 adjudicated 证据。
runtime 将 reused 视为已满足的依赖，跳过派发，供新步骤解析 remoteRef。所有新派发使用新 run 的 key。
原计划和原 run 记录不变。含 reused 的失败仍不是零效果失败，不能通过 revise 丢掉已存在对象。

复用证明的是过去已创建。外部删除/修改对象、远端目标迁移需要接入方单独核验和处理；本轮不提供
自动刷新、补偿、更新或跨账号迁移，不保证已有远端状态未变化。

## 验收

8 项新增测试：仅重试修改后的子节点；复用节点 preview/edit 保护；计划替换与省略拒绝；不合资格
run/未映射拒绝；连续派生只创建父一次；重复/不存在节点映射拒绝。另覆盖人工证据衔接与新子步骤的 unknown 恢复。共 90 项测试。
`demo:continuation` 使用真实图 contains 边，父成功、子拒绝、编辑子、复用父、子丢响应核对，纳入 CI。
仍为内存原型，SQLite 阶段必须原子持久化派生关系、回执、检查绑定、复用事件和派发意图。
