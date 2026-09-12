# 001：结构注册与空图创建

状态：设计草案，未实现。对应 M1。以下接口均为拟议接口。

## 目的与范围

开发者用可信 TypeScript 代码注册一种草稿结构，调用方按类型版本创建空草稿。此任务只完成定义、注册、版本绑定、读取快照。填图、字段修改、关系变更属于 M2；必填校验属于 M3。

## 拟议使用方式

```ts
engine.registerDraftType({
  id: "example.campaign",
  version: "1",
  nodeTypes: {
    campaign: {
      fields: { name: { type: "string" }, budget: { type: "number" } },
      requiredAtPublish: ["name", "budget"],
    },
    adSet: {
      fields: { name: { type: "string" } },
      requiredAtPublish: ["name"],
    },
  },
  relationTypes: {
    contains: { from: ["campaign"], to: ["adSet"] },
  },
});

const draft = engine.create({ type: "example.campaign", typeVersion: "1" });
// { id, version: 0, type, typeVersion, definitionDigest, nodes: {}, edges: {} }
```

不承诺兼容完整 JSON Schema。M1 只支持字段 type 为 string/number/boolean，nullable 可选；不支持对象、数组、默认值和继承。语义扩展在 M2/M3 的设计中明确。

## 数据与身份

- Registry 按 type ID + version 索引不可变定义快照。
- 定义由可序列化数据组成，不接受函数；业务回调独立注册。
- registration 保存深拷贝；调用者随后修改原对象不得改变注册内容。
- definitionDigest 对规范化定义计算摘要；对象键排序，数组顺序保留。摘要用于身份检查，不是签名。
- 节点和边各自有本地稳定 ID。空图不预生成节点，不灌入默认值。
- 草稿绑定 type/version/digest；后续注册 v2 不改变 v1 草稿。恢复时缺失定义或摘要不符必须阻断，不能退回最新版本。

## 注册时检查

1. ID 和版本非空，节点类型至少一个；拒绝未知定义字段，避免拼写错误被静默接受。
2. 字段类型属于支持范围；requiredAtPublish 引用已声明字段且不重复。
3. 关系 from/to 非空，只引用已注册在本定义中的节点类型。
4. 拒绝危险对象键（如 __proto__、constructor、prototype）。Map/安全属性访问的选择在实现中统一。
5. 同 type/version 的相同定义重复注册可返回现有定义；不同摘要报冲突，不能覆盖。
6. 只有完整校验通过才加入注册表，失败不改变注册表。

## 创建时检查

要求显式 typeVersion，不使用 latest。查找成功后生成 draft ID，version=0，保存空 nodes/edges，并返回快照。缺发布必填项不妨碍创建。M1 继续使用内存存储，不宣称跨进程持久性。

## 错误

| 错误码 | 情况 | 状态变化 |
|---|---|---|
| INVALID_DEFINITION | 类型、字段、关系定义不合法 | 无 |
| DEFINITION_CONFLICT | 相同 ID/版本对应不同定义 | 无 |
| TYPE_VERSION_NOT_FOUND | 创建时找不到版本 | 不创建草稿 |
| DEFINITION_MISMATCH | 恢复时定义身份不一致 | 阻断后续操作 |

错误提供定义内部路径和说明；不返回完整环境、凭证或堆栈给调用者。

## 验收

- [ ] 注册 Campaign/AdSet 定义，创建 version=0 的空图。
- [ ] 关系指向不存在的类型、必填字段不存在、字段类型不支持均被拒绝。
- [ ] 相同定义重复注册成功；同版本不同内容被拒绝。
- [ ] 修改注册参数或返回快照不影响内部状态。
- [ ] 注册 v2 后 v1 草稿仍绑定 v1。
- [ ] 未知版本不创建草稿；缺发布必填值仍能创建。
- [ ] 对象键顺序不同但定义相同，摘要一致。

## 未决项与后续

M1 实现前确认定义校验采用手写小校验器还是现有 schema 校验依赖；保持上述公开语义一致即可。关系基数、环、根节点要求、节点移除与边引用在 M2 设计；不在 M1 猜默认行为。OP API 在 M2 设计，不通过任意 JSON 写入绕过结构校验。
