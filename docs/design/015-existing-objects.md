# 已确认对象接入

状态：首批接口已实现，SQLite schema=4。仅支持来自本库 run 的确认回执，不支持任意 remoteRef 导入。

## 公共接口

```ts
const source = engine.getRun(sourceRunId);
const draft = engine.importConfirmed(source.id, {
  requestId: "independent-work-1",
  expectedSequence: source.events.length,
  actor: "operator",
  evidence: "verified-receipt-reference",
  purpose: "A separate follow-up task",
  independentWork: true
});
```

只允许 published、failed 或 closed 来源，且必须至少有一个 applied/reused。
来源计划必须全部是一节点对应一步的 create 映射；不能从更新、删除或无映射计划中推断对象身份。
确认对象的依赖也必须已确认；第一版导入全部确认对象，不提供任意子集选择。
命令严格校验，expectedSequence 绑定当前事件序号；actor/evidence/purpose 不得为空。

## 明确的信任边界

independentWork 是可信调用方对新工作的声明，不是库验证出的语义事实。
库不能证明换一个 ID、名称或 payload 后仍不是同一项未知请求；不得宣称已解决跨草稿的语义去重。
调用方必须确保新工作独立于原 unknown 效果；原工作需要恢复时仍应走原请求核对，而不是此接口。
接口不查询远端，不保证历史回执对应对象今天仍存在；目标实际账户与执行器 target 一致性仍由适配器负责。

## 图与执行模型

返回新 GraphDraft，version=0，sourceRunId 指向原 run，imported 保存来源、回执和完整命令。
只复制确认节点以及两端均确认的边；其余节点、边全部不进入新图，ID 加入墓碑，并继承原墓碑。
已确认节点禁止删除或改字段。回执元数据不属于 GraphOp 输入，返回值修改不影响引擎快照。

规划仍使用完整 create 映射，但导入步骤必须与原步骤的 ID、payload、dependsOn、inputRefs、effect 完全一致。
预检验证原节点意图、依赖闭包、目标和执行器身份；不一致不能获得凭据。
执行绑定增加 importDigest；publish 将确认步骤初始化为 reused，记录 reusedFrom，永不调用它们的 apply。
新步骤照常执行，inputRefs 从确认 remoteRef 解析。已有对象的 updates/deletes 不在本接口范围内。
即使规划器试图漏掉或改写导入步骤，也会在预检被阻断。

## 幂等、存储和来源

同一 sourceRunId/requestId 与相同命令返回同一草稿的当前版本；相同身份修改命令报 IMPORT_CONFLICT。
新 requestId 表示调用方另一次独立工作，可以创建另一份草稿，不提供跨 requestId 的业务去重。
sw_imports 的命令记录与草稿创建原子提交；失败不留孤立草稿，重开和跨实例重试保持幂等。
所有旧 source run 及 unknown 证据保持不变；closed 仍不能直接 revise/continueFrom。

新工作若部分失败，可以正常 continueFrom；新 continuation 以最近失败 run 为来源，成功回执逐跳指向原接入来源。
派生时保留墓碑，移除直接 imported 标记，改为 continuation 绑定；来源草稿仍保留接入命令。
重启后的固定计划与恢复校验支持 importDigest 及 reused 回执。

## 迁移和保留

schema 1/2/3 在事务内升级为 4。新元数据会影响是否派发，旧二进制必须拒绝 schema 4，以免忽略回执再次创建。
升级不为缺少 owner 证据的旧 run 伪造接管资格。sw_imports、来源 run/草稿和命令记录按现有策略永久保留。

## 验收与后续

测试覆盖 closed 来源只复制确认节点、原 ID 禁用、字段锁定、命令快照、幂等重开、事务回滚、
错误命令与非终态拒绝、目标及意图漂移、重启核对及后续失败续跑。
`npm run demo:import` 演示 closed → 接入确认 project → 重开 → 发布独立 follow-up；原 task 保持 unknown。
任意外部对象导入、当前存在性核验、选择部分回执和跨草稿意图去重尚未实现。
