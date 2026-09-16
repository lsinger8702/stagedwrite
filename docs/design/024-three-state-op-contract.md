# 024：三态编辑契约与实施边界

**M01 契约定稿，尚未代表运行时已迁移。所有公开编辑动作只有 set/remove/reset。实现进度见 [账本](../tasks/three-state-op-migration.md)。000 的执行保护优先于这里的本地编辑能力。**

## 输入

```ts
type FieldPatch = { ref: string; scope: "canonical"; path: string } & (
  | { op: "set"; value: JsonValue }
  | { op: "remove" | "reset"; value?: never }
);
type NodeSpec =
  | { nodeType: string; fields: JsonObject; relations?: Record<string, NodeInput[]> }
  | { cloneFromRef: string };
type NodeInput = NodeSpec | { ref: string };
type TopologyPatch =
  | { op: "set"; parentRef: string; path: string; value: NodeSpec }
  | { op: "set"; ref: string; path: string; value: NodeInput[] }
  | { op: "remove" | "reset"; ref: string };
type EditBatch = { graphPatches?: TopologyPatch[]; patches?: FieldPatch[] };
type InitialIntent = { roots: NodeSpec[] };
```

只接受严格 JSON 和上述互斥字段；未知属性拒绝。数组可以为空，但整个 EditBatch 必须至少一条操作。字段 path 非空 JSON Pointer，相对于 fields；关系 path 是单段 JSON Pointer，其解码值是注册 relationType。两通道使用不同的命名空间，不把关系存进 fields。

create 的 roots 非空，服务端分配身份；每个显式 NodeSpec 必须提供 fields 对象，不能只给类型。schema 可以允许 `{}`，但库不猜字段内容。普通初始值（包括 null）形成 set 声明，缺席是未声明；创建接口不另增 initialOps 或初始 remove。显式 remove 在创建后编辑。roots 不接受裸 ref。

edit 不增加无父根节点；新增独立根使用新的 Draft。根节点本地 remove/reset 仍可用，但最终 Draft 必须非空。此版本不提供跨 Draft/Artifact 克隆：cloneFromRef 仅请求前本 Draft 内节点，create 中明确拒绝。跨快照读取/权限问题因能力未开放而不产生隐式行为；日后单独扩展 spec，不能把远端 ID 冒充本地 ref。

## 关系注册与图

relationTypes 保留 from/to 类型约束，新增必填 `ownership: "owned" | "reference"`、`cardinality: "one" | "many"`。没有默认猜测。既有样例逐个显式标明。一个节点至多一个 owned 入边，owned 子图无环；reference 允许共享与环，不自动生成执行依赖。每个 source + relationType 构成槽位；one 槽至多一个目标，many 不允许同一目标重复。

- `set parentRef/path/value`：在父槽位追加一个新节点/克隆。one 已占用则拒绝，改用完整槽位 set。parentRef 必须来自请求前图且操作时仍存在。
- `set ref/path/value[]`：完整替换该槽位，空数组清空关系。显式内容创建新节点；裸 ref 关联请求前且候选中仍存在的节点。新建拥有关系不能让已有节点同时有两个父。
- remove ref：删除该节点及 owned 后代和它们发出的边。任何存活节点的 reference 边指入被删集合则拒绝，提示先清空这些引用。不是隐式级联删除引用者。
- 槽位替换解除 owned 子节点时，按上述删除规则立即回收旧拥有子树；reference 解关联不会删除目标，孤立节点可继续作为根。拓扑逐条处理，后续不能引用已回收节点。
- reset ref：基线存在则恢复该节点的字段声明、类型和基线 owned 父边（父须先存在），不自动复活 owned 子节点。恢复基线 reference 出边要求目标仍存在，否则拒绝并定位缺失目标。当前 owned 子节点保留。基线不存在则按 remove；两边都不存在报 ref 不存在。恢复基线 ID 是恢复身份，不是新身份；不进 createdRefs，不能绕过 Run 保护。

节点克隆复制 owned 闭包，所有节点/边身份重新分配；内部 reference 目标映射到克隆节点，外部 reference 保留原目标。克隆根不复制原父入边。只有一个 cloneFromRef 属性，不能夹带覆盖字段。来源是冻结的请求前快照；保留的外部目标在候选中已被移除则拒绝。不携带 Binding、Run、发布状态、租约或执行证据。

以上是对关系固定的参考模型的通用化：显式注册所有权，避免对任意 graph 猜树结构。远端新增/删除、孤儿远端回收均不在此契约中。

## 字段嵌套与固定基线

Schema 扩展为闭合对象、标量、数组以及本地无环 $ref；对象必须 additionalProperties=false。数组元素可按 schema 校验 JSON，但本期数组整值 set/remove/reset，不接受进入数组的索引路径。对象 nullable 时，null 与缺席、remove 分开。

字段声明按 Schema 展开为确定的树形路径集合：非空对象容器用路径上的 `set {}` 表达显式存在，内容只在子路径存储；空对象同样保留 `set {}`。标量/null/数组保持完整 set 值；remove 可作用完整子树。没有 reset 持久态，普通 Graph 仍是声明的唯一确定投影。

每次 OP 同时更新声明与投影，不能仅深合并 Graph：

1. set 对象替换整个子树，清掉该路径旧子声明，按输入展开；省略的子字段未声明，不保留旧值。set 标量/null/数组同样替换子树。
2. remove 删除当前子树声明，留下该路径 remove；不是给所有叶子发送独立远端请求。
3. 编辑子路径需要父对象：父缺席则建立显式对象容器；父为 remove 时把清空声明展开到注册的直接子字段后建立容器，保留未被修改兄弟的 remove。父是 null/标量则拒绝，hint 指导先整对象 set，不能静默覆盖用户的 null。
4. reset 目标子树只从固定基线取对应声明；缺席则删除目标声明。其父容器按第 3 条处理，未涉及的兄弟不回滚。reset 子路径不会隐式删除已经存在的父容器；恢复整个父对象用 reset 父路径。
5. 不同坐标按序，父操作会覆盖此前子操作；子操作会修改此前父操作的结果。完全相同坐标重复整批拒绝，message/hint 必填，见 023 §7。

例：基线 `profile={name:"A", note:"B"}`；remove `/profile` 后 set `/profile/name="C"`，投影是 `{profile:{name:"C"}}`，声明保留 note 的 remove。此后 reset `/profile/name` 得到 name=A，note 仍 remove；reset `/profile` 才完整恢复 A/B。祖先 object 的 set{} 仅容器存在标识，不存第二份子值；预检 preview 必须展示子字段实际三态。适配器按有效子树声明读取，不能把内部容器标识直接作为请求体。

这是实现约束，不是承诺现有 toInternal/compileUpdate 已支持嵌套；M04/M06 必须一同调整投影、预检与读取方。最终 Schema 校验前的普通标量约束允许被不同坐标后续父操作覆盖；路径结构错误立即拒绝。

## 请求前身份、回执与安全

字段和拓扑操作的已有 ref/parentRef/cloneFromRef/裸 ref 均在请求前图解析。唯一例外：拓扑 reset 可以定位固定基线中已删除的 ref。嵌套创建用 spec 表达，不允许猜测本批生成 ID。拓扑先执行，字段后执行；字段目标若已删除则整批失败。

createdRefs 为 `{path, ref}` 数组，path 对应输入 NodeSpec 位置；克隆后代另附 `sourceRef`，与同 path 的克隆根区分。真实 edit 的轻回执为 `{draftId,version,preflightRequired:true,changes,createdRefs}`，create 为 `{draft,createdRefs}`。changes 通过输入 pointer 定位，不能再只使用混合数组 opIndex。

preview 返回 `{preview:true,candidate,changes,createdRefs}`。身份分配器使用独立的临时名字空间；真实写入生成器不生成该前缀，任何后续请求的临时 ref 被拒绝。preview 不承诺和 edit 同 ID；以输入 path/sourceRef 对应预测意图。只返回最终存活的 createdRefs。reset 恢复身份通过 changes 显示，不是假新建。

租约、CAS 和 Run 成功保护不变：整个批次对候选求值，成功才单事务提交并使检查失效；失败不改版本和已保存证书。对任何未解决 Run 的拓扑变更仍拒绝；此迁移不开放已发布后的远端 update。unknown 必须拿原请求查证。

## 对 022 §7 的结案

根、父与关系槽位坐标、删除/恢复、所有权/共享/环、克隆来源与身份、预演、初始 remove 范围、对象/数组/重复字段优先级均按本文限定；未实现能力显式拒绝，不留隐式默认。参考不同点：JSON Pointer 保留已有转义协议；首次发布前 reset 保留用户批准的初始基线；数组先整值；跨快照克隆延后。实现验收对应 023 矩阵，M02 仅协议与输入校验，不能凭其完成宣称编辑引擎已迁移。
