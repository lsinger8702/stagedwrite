# 001：定义、装配与空图创建

状态：M1 已实现并通过验收。2026-09-12 更新。本文保留 M1 验收时的接口范围；编辑现已在 [M2/003](003-graph-operations.md) 实现，发布和恢复仍待后续。

## 目的与范围

开发者独立导出可序列化定义，创建引擎时显式装配，成功后冻结注册表。M1 只交付定义校验、装配、版本绑定与空图；规则执行、填图、远端调用仍属后续任务。

## 使用方式

```ts
export const projectDefinition = defineDraftType({
  id: "example.project",
  version: "1",
  nodeTypes: {
    project: {
      valueSchema: {
        type: "object",
        $defs: { quantity: { type: "number", minimum: 0 } },
        properties: {
          name: { type: "string" },
          capacity: { $ref: "#/$defs/quantity" },
          capacityLimit: { $ref: "#/$defs/quantity" },
        },
        additionalProperties: false,
      },
      requiredAtPublish: ["name", "capacity"],
    },
    task: {
      valueSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
      requiredAtPublish: ["name"],
    },
  },
  relationTypes: {
    contains: { from: ["project"], to: ["task"] },
  },
});

const engine = createStagedWrite({ definitions: [projectDefinition] });
const draft = engine.create({ type: "example.project", typeVersion: "1" });
// { id, version: 0, type, typeVersion, definitionDigest, nodes: {}, edges: {} }
```

该最小引擎只能创建和读取空草稿；M1 不提供可工作的 publish。完整引擎后续必须显式装配执行能力；不能因为没有 Adapter 就悄悄跳过发布校验。

## 三个阶段

1. defineDraftType：类型提示与纯定义构造，不修改全局状态。JSON 文件解析后可作为同一种输入；此 helper 不是可信校验边界。
2. createStagedWrite：统一检查原始输入、复制定义、解析本地依赖、用 Ajv 8 的 2020-12 实现编译校验器，建立实例专属注册表。任何问题导致整个装配失败，不返回半装配引擎。
3. engine.create：只选择已装配的明确版本。启动后没有 register/unregister 热修改入口。升级时重建引擎，可同时装入 v1、v2。

## 字段 schema 的明确范围

采用 JSON Schema 2020-12 的受限 profile，不自建 nullable 语法，不承诺完整 JSON Schema 支持。

M1：根必须为 object，允许 $schema、$defs、type、properties、additionalProperties:false、title、description；属性也可通过下述本地 $ref 引用标量定义。属性为 string/number/integer/boolean，允许对应标量类型与 null 的 type 联合，允许 enum、数值 minimum/maximum、字符串 minLength/maxLength。不支持的关键字和组合启动即报错，不能静默忽略。元数据和数值约束也必须做定义级校验。

requiredAtPublish 是草稿领域元数据，只引用顶层已声明属性。valueSchema 校验已填写值；发布完整性由后续预检检查。它不直接校验 {kind:"clear"} 等意图信封：明确清空和未声明由意图层解释，null 仅在 schema 允许时为普通值。

禁止隐式转换类型、删除未知字段或补默认值。不能通过删掉任意业务 schema 的 required 自动生成草稿 schema。

## 引用的三种含义

| 引用 | 指向什么 | M1 边界 |
|---|---|---|
| 图节点 ref / nodeId | 草稿内的具体业务对象 | 定义身份与关系类型；M2 实现节点、边及引用校验 |
| Schema $ref | 可复用的字段结构定义 | 支持本 valueSchema 文档内的 $defs 引用 |
| 远端引用 | 外部平台已存在的资源 | 后续 Adapter/执行结果负责，不用 schema 引用代替 |

M1 创建空图不代表取消图引用；多个对象共享一个文档属于 M2 的图关系能力。Schema 定义引用不建立业务对象之间的边。

## M1 本地 schema 引用契约

- 每个节点类型的 valueSchema 是独立的 schema 文档根；`#/$defs/quantity` 相对此根解析，绝不相对整个 DraftTypeDefinition 或另一个节点类型解析。
- $defs 只允许放在该根；首版引用形式限定为 `#/$defs/<name>`，指向一个已定义的完整 schema。支持 JSON Pointer 的 `~0` / `~1` 转义；其他片段、anchor、非片段 URI 及非该形状引用均报错，不猜测。
- 属性与 $defs 条目可为标量 schema，或仅包含 $ref 的引用 schema；允许无环的引用链。不支持 $ref 旁附加校验关键字，避免把标准支持的组合误实现为静默忽略。当前受限 profile 对这些输入明确拒绝。
- 同一 valueSchema 多字段可复用同一 $defs 条目。不同节点类型可在 TypeScript 编写时复用一个定义对象，但装配后是各自文档快照；跨节点文档 $ref 不在 M1 范围。
- 启动时检查全部 $defs 条目及引用（包括未使用条目），悬空引用、直接/间接循环均阻止整个引擎创建。重复使用同一定义不是循环；按当前访问栈检测循环。
- 对引用目标应用同一标量 profile 校验；不能通过 $ref 引入对象、数组或不支持的关键字。引用复用不扩大值类型范围。
- 不支持跨文件、跨文档、远程 URL、$id 重定向、$anchor、$dynamicRef；绝不触发网络读取。
- definitionDigest 覆盖完整定义快照，包含所有 valueSchema 的 $defs 和 $ref 原文；不只哈引用字符串，也不需要先无限展开引用。目标内容变化必须改变摘要；未使用定义变化也保守改变摘要。内联与引用等价不要求摘要相同。

嵌套对象、数组和命名空间仍是复杂业务适配的必要扩展，尚未实现；不能声称本地 schema 引用已经覆盖任意复杂对象图。


## 身份、版本与冻结

- Registry 按 type ID + version 索引不可变定义快照，按精确字符串匹配；不在不同模块各自改变大小写。
- 定义只包含 JSON 数据，不包含函数、凭证、客户端或环境配置。
- 装配深拷贝并冻结定义；不冻结接入方的 SDK 客户端内部状态。
- 同身份相同定义可去重；同身份不同定义报 DEFINITION_CONFLICT。
- definitionDigest 按固定规范化 JSON 规则计算，标明算法；对象键排序、数组顺序保留。它证明定义身份，不证明代码身份或授权。规则见下方“已固定的实现决定”。
- 草稿绑定 type/version/digest。恢复缺定义或摘要不符时阻断；不回退到 latest。
- 结构摘要不能覆盖业务函数。规则与 Adapter 后续独立声明 ID/版本，并绑定到预检及执行计划。不能用函数 toString 充当代码版本。

## 装配错误

| 错误码 | 情况 |
|---|---|
| INVALID_DEFINITION | 定义形状、字段或关系不合法 |
| UNSUPPORTED_SCHEMA_FEATURE | 使用当前 profile 不支持的 schema 能力 |
| SCHEMA_REF_NOT_FOUND | 合法本地引用找不到对应 $defs 条目 |
| SCHEMA_REF_CYCLE | 本地引用链存在直接或间接循环 |
| DEFINITION_CONFLICT | 相同 ID/版本对应不同定义 |
| TYPE_VERSION_NOT_FOUND | 创建时找不到指定版本 |
| DEFINITION_MISMATCH | 恢复时定义身份不一致 |

不支持的引用形式或关键字使用 UNSUPPORTED_SCHEMA_FEATURE；语法无效的引用使用 INVALID_DEFINITION。引用错误带源 schema 路径、目标和可用时的引用链。

批量收集定义问题，按 definition ID、版本、路径排序。关系 from/to 非空且引用已声明节点类型；拒绝危险对象键；失败不保存草稿或半成品注册表。

## 执行能力装配：后续必须遵守

结构定义和运行能力分离，但不能各自注册后无人检查它们是否对应。完整引擎装配时验证定义与规则/计划器/执行器的关联。

必需能力缺失直接失败；对于恢复等语义关键能力，区分已接入、明确不支持（附原因）、漏配置。声明和实际实现必须一致。可选能力的数量保持小，不复制某个业务系统的全部阶段槽。

允许显式的仅草稿模式；这种模式不得产生“可发布”的检查结果。可执行模式必须在启动时校验必需依赖，远端暂时不可用则在调用时返回检查未完成，不能伪装成字段错误。

## 验收

- [x] helper 定义与同内容普通 JSON 输入得到相同定义身份。
- [x] 两个引擎的定义互不污染；修改输入和返回快照不改变内部内容。
- [x] 错误关系、未知字段、无效 schema、重复冲突定义在启动时一次报告。
- [x] 同时加载 v1/v2，可创建分别绑定各自版本的空图。
- [x] 两个字段引用同一 $defs 标量定义，装配成功并获得相同校验约束。
- [x] 无环引用链、转义名称正确解析；同名 $defs 在不同 valueSchema 内隔离。
- [x] 悬空引用、直接/间接循环（含未使用条目）在装配期拒绝。
- [x] 跨文件/远程引用、不支持的片段、$ref 校验兄弟关键字明确报错，且无网络调用。
- [x] 引用对象/数组定义仍被标量 profile 拒绝，不退化为无校验。
- [x] 仅修改 $defs 目标值就改变定义摘要；旧草稿继续绑定旧定义身份。
- [x] 缺发布必填字段仍可创建；没有隐式默认值。
- [x] 定义对象键顺序变化不影响摘要，语义值变化会影响摘要。
- [x] M1 不暴露可发布结论。

后续完整装配仍需增加缺执行器/恢复能力声明的反例，不计入 M1 完成项。

## 已固定的实现决定

- Schema：先校验本项目受限 profile、解析所有本地引用，再交给 Ajv 8 的 `Ajv2020` 同步编译。严格模式、完整错误报告；关闭 coerceTypes/useDefaults/removeAdditional，启用 ownProperties。没有 loadSchema 或网络解析入口。原始 $defs/$ref 保留在定义快照与摘要中，编译副本解析为标量约束。
- profile 补充：enum 必须非空、无重复且每项匹配声明类型；约束必须用于对应类型；minimum 不大于 maximum，minLength 不大于 maxLength；长度为非负安全整数。`requiredAtPublish`、关系端点不得重复，节点类型至少一个，关系类型可为空。
- 输入仅接受普通 JSON 对象/数组与有限标量。拒绝函数、undefined、非有限数、Date、getter、symbol、循环、稀疏数组和危险对象键。JSON 嵌套最多 128 层；不调用输入的 getter 或 toJSON。接入代码与定义仍属于可信进程内输入，不承诺恶意 Proxy 的隔离。
- 引用支持字面名称与 JSON Pointer ~0/~1 转义；合法 URI 百分号编码暂不支持，畸形百分号转义报 INVALID_DEFINITION。每个 valueSchema 独立解析，未使用定义同样检查。
- 摘要格式：`sha256:stagedwrite-json-v1:<小写十六进制>`。对完整定义按 UTF-16 码元顺序递归排序对象键（包括数字形式键），数组保留顺序，原始值按 ECMAScript JSON 编码，再对 UTF-8 编码结果做 SHA-256。只允许有限 IEEE-754 数字，-0 规范为 0；不做 Unicode 归一化。不是 RFC 8785 的兼容声明。缺省字段与显式空值/空数组的摘要不要求相同。
- 新入口在 `src/graph-engine.ts`；定义模块在 `src/registry/`。旧 `StagedWrite` 仍是独立的顶层字段执行原型，两者尚未连接，不能把新空图交给旧发布引擎。
- `getDefinition({type,typeVersion})` 返回 `{definition,digest}` 的独立快照；`validateValues(selector,nodeType,values)` 是纯字段值校验，返回 `{valid,issues}`，供集成方验证约束。它不填图、不校验意图信封、不检查发布完整性。未知节点类型报 NODE_TYPE_NOT_FOUND。
- M1 最初草稿为 `EmptyGraphDraft`，当前已由 M2 扩展为 `GraphDraft`（含墓碑），旧类型只保留为 deprecated 导出。getDraft 未命中报 DRAFT_NOT_FOUND；没有导入、恢复或 register 热修改方法。DEFINITION_MISMATCH 保留给后续持久化恢复，不是当前可触发接口。

M2 前必须补对象图和路径设计；复杂字段、基线恢复、命名空间参见 002，不能由 adapter 私自改核心 OP 含义。

## 参考

- [Fastify schema 装配与校验](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [JSON Schema 定义与引用](https://json-schema.org/understanding-json-schema/structuring)
- [Zod JSON Schema 转换边界](https://zod.dev/json-schema)

- [Ajv JSON Schema 版本](https://ajv.js.org/json-schema.html)
- [Ajv 校验选项](https://ajv.js.org/options.html)
