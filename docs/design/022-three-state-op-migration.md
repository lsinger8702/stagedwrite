# 022：三态 OP 迁移方案

**2026-09-16 用户明确决定：所有对外 OP 只能为 set/remove/reset；反对 node.add、node.remove、edge.add、edge.remove 等专用动作名。拓扑与字段分通道，创建/复制通过 set 的 value spec 表达。此决定替代原七动作混合数组协议。**

**公开 create/edit/preview 与候选修复已切换新协议。本文记录迁移目标和实施顺序，最终验收仍按账本逐项完成；细节未决项不得被当作已实现或已批准的额外能力。唯一进度来源是 [迁移账本](../tasks/three-state-op-migration.md)。优先完成本迁移，再恢复 update 派发开发。**

## 1. 保留与替换

| 保留 | 替换 |
|---|---|
| 长期非空 Draft、Graph 和独立 fieldIntents | 七动作混合数组 → 拓扑/字段双通道、相同三态枚举 |
| 固定基线 reset，不是 undo | 空节点创建后逐字段 set → 创建 spec 携带初始声明 |
| expectedVersion、Draft 租约、整批原子提交 | 调用方为每个新节点指定身份 → 服务端分配并返回 created refs |
| preflight 的完整 preview、具体 message、可选候选修复 | 候选 repairOps、repairs、示例、工具定义统一使用新编辑批次 |
| Run、Attempt、Binding、原请求、成功保护 | create 内部拼装旧 node.add 的实现路径 |
| 远端请求由 adapter 组织 | 新增复制源 spec；不新增 clone 操作名 |

不维护无人使用的旧协议兼容入口，不把旧动作藏到另一个 action/type 字段中冒充三态。内部函数可叫创建节点/展开子树，但 wire 的 op 和公开类型枚举只能有三种。

## 2. 目标请求骨架

以下为接口设计骨架，准确类型在 M01 定稿；字段名采用 TypeScript 风格，不复制领域实现。

```ts
type PatchOp = "set" | "remove" | "reset";

type FieldPatch = {
  ref: string;
  scope: "canonical"; // 显式空间；不提前开放未实现的 override
  path: string;        // JSON Pointer；嵌套支持与 Schema 同步实现
} & (
  | { op: "set"; value: JsonValue }
  | { op: "remove" | "reset" }
);

type EditBatch = {
  graphPatches?: TopologyPatch[];
  patches?: FieldPatch[];
};

// 拓扑目标二选一：定位已有节点的 graph-backed path，或在已有父节点下创建。
// 根节点创建的坐标、关系槽位注册方式及 reset 精确语义由 M01 完整定义。
// TopologyPatch 的 op 仍只能是 PatchOp，不能出现 node.add/clone 等值。
```

字段 set 的 value 可为受注册 Schema 约束的 JSON；不得仅把 Value 改为 any。remove 不携带 value；reset 恢复固定基线声明，包括显式 remove；未声明、null、清空仍须分开。

创建 spec 采用互斥内容来源：显式类型/初始字段/子树，或 cloneFromRef/固定快照来源；复制模式不能同时传入覆盖字段，后续修改另一个批次。字段和拓扑的身份坐标均按请求前快照判断，不允许字段 patches 引用本批新分配 ref。

JSON Pointer 的保留理由：既有转义明确、字段名可包含点或斜线、将来支持嵌套不需要整体换协议。scope 独立于 path，必须显式填写 canonical；省略、空值与未实现的 scope 均拒绝，不能忽略后写错空间。此项依据参考输入校验收紧了此前尚未定稿的可选 scope 提案。

## 3. 每批处理顺序

1. 验证版本、请求形状和注册定义；冻结请求前图、固定 reset 基线与可引用集合。
2. 在临时候选状态处理 graphPatches，展开创建 spec/复制内容；所有新身份只属于候选状态。
3. 对请求前存在、候选中仍有效的节点应用 patches。字段 patch 指向本批删除节点则整批拒绝，不能静默忽略。
4. 本阶段不做自动推导；未来引入时必须在最终校验前执行，并满足 remove 优先/同批抑制/reset 解除抑制的测试。
5. 校验候选 Schema、关系完整性、三态投影、Run 成功保护；任何失败都不写入。
6. 单事务保存候选意图、version 和检查失效；返回回执、变化与最终仍存在的 created refs。

不同坐标在同通道按数组顺序；所有者已确认同一字段坐标重复出现时整批拒绝，必须返回 message 和 hint（完整诊断契约见 023）。双通道不保留旧混合数组的任意交错能力；调用方不能依靠“先创建、再字段 set”填充新节点。拓扑初始化与字段 patch 的写入交集必须在 M01 明确禁止/报冲突，不能产生未说明的优先级。

## 4. 创建与复制

create 仍要求有非空初始工作内容。新创建请求先展开 spec，再在一次持久化提交中建立 Draft/initialSnapshot，不先保存空容器。

复制来源优先采用库内已存在节点的请求前快照或显式 Artifact 快照：来源固定、可读取、可校验定义版本。远端实体 ID 不是可直接复制的作者意图；远端导入依赖 adapter 读取和归一化，另列后续任务。

复制只复制作者意图及所选关系内容，不继承原 Draft ID、Run、Binding、发布状态、租约或执行证据。内部节点/边分配新身份并重映射；共享节点、环、外部边和选择范围由 M01 明确，不能默认把任意 graph 当树递归复制。

created refs 至少能关联输入位置与返回身份，不能只返回无法对应的 ID 列表。OP 预演不得产生可被当作已持久化 ref 的身份承诺；预演与真实 edit 的 ID 策略由 M01 定义。事务失败无可用新 ref；返回中不得存在候选内已删除的身份。

## 5. 嵌套字段和 scope

Schema、fieldIntents 的路径索引、普通值投影、preview、错误路径和候选修复必须同批支持嵌套，不能只放开 path 的斜杠。

M04 必须定义父子路径重叠：set 父对象后 set 子字段、remove 父对象后 set 子字段、reset 子字段等都要有唯一语义。数组按整值处理作为首选小范围，不默认开放下标插入/删除；具体范围在 M01 列入契约。原初始/成功基线始终不可变，不把多次 edit 变成隐式 undo。

先有 canonical 坐标，第二空间尚未实现时拒绝其值。未来 override 是另一声明空间，不能通过同名字段覆盖 canonical；本次不增加渠道业务结构或推导器。

## 6. 影响范围清单

| 位置 | 迁移内容 |
|---|---|
| src/graph/types.ts、edit.ts | 新编辑批次、三态枚举、分通道候选求值 |
| src/managed/intent.ts | 初始 spec 展开、普通图/声明投影、固定基线 reset |
| src/registry/types.ts、profile.ts、registry.ts | 嵌套 Schema、路径校验、拓扑槽位定义 |
| src/preflight/types.ts、diagnostic.ts、preview.ts | repairOps/repairs 批次、created refs 相关诊断、嵌套 preview |
| src/managed/engine.ts、types.ts、state.ts | edit/preview/create 接线、轻量回执、租约/CAS/成功保护 |
| src/managed/update-plan.ts | 嵌套坐标适配，不绕过已有漂移/unknown 保护 |
| tests、examples、scripts、package consumer | 替换旧动作，加入运行时拒绝旧协议与真实流程回归 |
| examples/stripe、docs/examples | 真实样例与生成产物迁移；受证据闸门约束，不改旧摘要消红 |

执行效果 Step.effect 的 create/update/noop 是远端执行计划类型，不是模型编辑 OP。不能为满足三态枚举而把远端效果事实改成 set/remove/reset，也不能将 Step 直接暴露为模型编辑接口。

## 7. M01 细节清单（已由 024 结案）

以下清单的准确类型与支持/拒绝范围见 [024](024-three-state-op-contract.md)。本节保留问题清单便于验收追踪，不再表示等待所有者裁决。

- 根创建、已有 ref 路径、父 ref 创建三种坐标的完整互斥类型；边/共享引用如何用拓扑路径表达。
- 拓扑 remove/reset 与固定基线、tombstone、推导抑制的关系；不默认将 reset 解释为复活已发布远端资源。
- 同批拓扑路径修改与字段路径修改冲突的错误规则；不同通道不出现两个意图来源。
- 复制范围、环/共享节点/外部引用、快照读取权限/定义匹配；不可默认复制绑定。
- createdRefs 的输入位置映射、预演身份策略、初始内容是否允许显式 remove。
- 嵌套对象/数组支持边界和父子声明优先级；scope 首版范围。

这些细节优先查阅既有参考的实际契约与测试，提炼通用行为；不将私有代码、名称、路径、提示词复制进公开仓库。只有确实与已确认原则冲突时才请所有者裁决，常规实现选择不反复请求授权。

## 8. 验收与恢复主线

所有公开工具 schema、类型与运行时接受的 op 只有三值；旧动作必须明确拒绝。创建有初始意图、字段三态、复制身份、全批原子性、请求前引用、成功节点保护、unknown 旧请求查证均有回归。

迁移完成后再恢复 update 派发工作，沿用原来的共享 Step/Run/Attempt；不丢弃已写的 diff、事实与采用记录，不建立新执行器。账本中的完成标志必须是代码/测试证据，不能只是文档已写。
