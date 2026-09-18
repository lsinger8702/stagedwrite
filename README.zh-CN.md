# StagedWrite

[English](README.md) · [简体中文](README.zh-CN.md)

**为大模型生成的复杂写入请求做预检，给出针对性诊断，用精确 OP 修复，再安全发布和续作。**

大模型能生成合法 JSON，不代表它能写对一个复杂请求。当请求包含几百个字段、嵌套对象和互相关联的资源时，模型可能选错字段组合、漏掉必填项，或者偏离用户意图。API 只拒绝其中一个字段，却让模型重新生成整个 body，又会给原本正确的字段带来新的不确定性。

对于计费、金融等涉及资金或其他重要资源的写入，**发出去之后才发现错误，也可能已经太晚**。请求不仅需要结构合法，还需要在产生真实副作用前检查业务条件。

StagedWrite 是放在 Agent 意图与外部写入之间的 TypeScript 库：用长期 **Draft** 承接工作，通过 **preflight** 预检，返回完整 preview 和**针对性诊断**，让模型只输出 **set / remove / reset** 操作列表，由后端精确修改图，不必重新生成整份请求。之后再由发布和恢复机制记录远端实际发生了什么。

## preflight 解决两类问题

**第一，让大模型能修对复杂、大体量的请求参数。** JSON 的结构通过校验，仍可能存在字段组合冲突、缺少依赖、取值不可用或多个资源配置不一致。注册的规则检查当前 Draft，把真正命中的问题定位到具体坐标。模型拿到当前 preview、错误 message，以及可选的 hint、候选值或修复 OP，就能针对问题提出局部修改。

**第二，让重要写入在执行前经过业务预检。** 例如计费或金融接入可以注册金额限额、币种匹配、账户资格、必要审批依据等检查。静态规则检查本地条件，异步规则查询外部服务，尚未完成时返回 `pending`。执行预检通过后才签发绑定当前版本的发布凭据。宿主权限授权仍单独执行；必须在远端写入瞬间成立的条件，仍需由远端服务或适配器保证。

库提供检查与诊断协议，**具体业务规则由接入方注册**。它没有内置一套金融政策引擎；预检通过也不意味着能提前预测所有远端拒绝。

## 给模型具体诊断，而不是让它自己翻规则书

```text
用户意图 → Draft → preflight → 当前完整 preview + 实际命中的诊断
                     ↑                         ↓
                     └──── 后端应用 ← 模型输出 OP 列表
```

诊断要告诉模型：**哪里有问题、违反了什么、为什么错。** 修复建议可以有，也可以没有；模型结合用户意图选择修改方案，缺信息时向用户提问。它不必从塞满平台规则的 prompt 或 memory 中自行检索，再猜当前请求到底违反了哪一条。

编辑只需要三种操作：

- `set`：声明一个值，包括 Schema 允许的显式 `null`。
- `remove`：显式清空字段。
- `reset`：恢复固定基线；首次发布前是初始意图，之后是最近一次全量成功发布的意图。

后端校验并原子应用整个 OP 批次，再对修复后的 Draft 重新预检。**模型可以看完整 preview，但只需输出精确到坐标的改动，不用重吐整份图。** 这样可以避免完整重生成给无关字段带来的变化。图意图到真实请求体的映射由适配器负责。

## 真实 API 报错，也进入同一个修复闭环

预检无法穷尽所有远端条件。适配器可以把真实 API 的拒绝映射成相同结构的诊断，附上当前 preview、message 和可选修复建议。模型给出 OP，后端编辑 Draft，再通过 `resume` 完成必要检查，从同一个未完成 Run 继续。

执行安全为这个闭环提供基础：适配器报告 `applied`、`not_applied` 或 `unknown`；成功部分保留，未知请求先使用原请求身份查证，再决定后续动作。超时不能被当作“没成功”，模型说可以重试也不能证明资源没有创建。远端幂等与可靠查证需要适配器支持，库不承诺通用 exactly-once。

## Draft 在发布后仍然存在

Draft 创建时就有用户工作意图，节点成功后逐个绑定远端资源。支持 update 的适配器可以在同一个 Draft、固定图和原远端 ID 上修改受支持字段，并做 diff/drift 检查。全量成功推进 reset 基线，未完成工作仍通过同 Run 续作。更新时新增、删除或替换远端资源尚不在当前范围内。

## 现在可以运行什么

- **真实 Stripe 沙盒证据**：Product → 两条 Price，真实远端拒绝、修复和同 Run 恢复；独立 update 场景验证更新原资源 ID。回执丢失明确标注为故障注入。[Stripe 指南](examples/stripe/README.md) · [Update 验收](docs/testing/stripe-catalog-update.md)。
- **可执行 walkthrough**：真实库和 SQLite 调用、模拟远端，HTML/ZIP 生成物由 CI 校验。[输入输出实录](docs/examples/publish-resume.html)。
- **三种接入方式**：通用 TypeScript 工具、有限 Messages API 修复循环、独立的官方 DSH 适配。Agent 循环使用 mock 模型验收，不代表真实模型质量已经验证。

早期原型 v0.0.1 · Node.js 22.13+（`node:sqlite`）· 尚未发布 npm 包。从示例和接入指南开始即可，设计决策历史作为补充参考。

## 快速开始

```sh
npm ci
npm test
npm run demo:html
```

打开[真实输入输出 walkthrough](docs/examples/publish-resume.html)。示例使用库、SQLite 与虚构远端，包含三条规则报错、异步 pending、固定基线 reset、部分发布、修复和未知结果查证；不调用 HTTP 或 LLM。

`npm run test:stripe` 运行无需凭证的离线回归。真实沙盒请求需要显式开关和测试密钥；运行状态与原始日志仅保留在本地。参见[贡献说明](CONTRIBUTING.md)。

组合 update 已完成[真实验收](docs/testing/stripe-catalog-update.md)：Product 更新不重建关联 Price；金额修改被本地预检拒绝；真实 Stripe update 报错后 edit + resume 同 Run 修复。

## Agent 接入

| 接入方式 | 入口 | 已验证范围 |
|---|---|---|
| 任意 Agent/工具宿主 | `createAgentTools` — [指南](docs/guides/agent-tools.zh-CN.md) | 七个授权工具、输入校验、preview 和诊断 |
| 直接 Messages API | `repairDraft` — [指南](docs/guides/agent-repair.zh-CN.md) | 有限修复循环，mock 模型端到端测试 |
| 官方 DeepSeek Harness | [DSH 适配与安装](integrations/dsh/README.md) | 真实 DSH loop/session/tools，模拟模型与远端，宿主身份绑定 |

运行 `npm run demo:agent` 查看工具调用，或 `npm run demo:repair` 查看修复循环。示例中的模型决定和远端效果均为模拟；目前不附带 MCP server。

## 当前 API

StagedWrite 是面向 Agent 工具的图式意图库，唯一引擎入口是 `createStagedWrite`。

```ts
import { createStagedWrite, createSqliteBackend } from "stagedwrite";

const backend = createSqliteBackend("./work.sqlite");
const engine = createStagedWrite({
  definitions: [definition],
  rules,                // Pure checks; current preview and specific messages.
  asyncRules,           // I/O checks return complete or pending; caller polls.
  executors: [executor],// plan(draft), apply(step, key, context), reconcile(...).
  ...backend,           // Paired storage and authoritative lease provider.
});
const { draft, createdRefs } = await engine.create(selector, {
  roots: [{ nodeType: "task", fields: { name: "初始工作" } }],
});
const nodeRef = createdRefs.find(r => r.path === "/roots/0").ref;
const check = await engine.preflight(draft.id);
if (check.status === "passed" && check.certificate) {
  const run = await engine.publish(draft.id, check.certificate);
  // If unfinished: inspect preview/diagnostics, optionally edit, then resume(run.id).
}
await engine.close();
```

参见[注册 Schema 和规则](examples/fixtures/project-tasks-managed.ts)、[执行器与完整调用](examples/publish-and-resume.ts)、[当前契约](docs/design/018-draft-lifecycle-proposal.md)。

- Draft 保存普通 graph、独立 fieldIntents、不可变 initialSnapshot、currentRunId 和成功产物引用，发布后仍保留身份。
- 字段 reset 恢复最近全量成功发布的意图，首次成功前恢复初始意图，不是撤销上一次 edit；显式清空、null 与未声明不同。
- 首次 publish 原子认领一个 Run；未完成期间再次 publish 只观察，明确指定不同 Run ID 会被拒绝。全量成功后，新检查的更新可在同一 Draft 认领新 Run；独立创建另一组资源仍需新 Draft。
- 未完成工作使用 resume，不以进程崩溃为前提。当前修复只允许改未完成节点的字段，成功节点和拓扑受保护。
- 当前 edit 只返回 `{draftId, version, preflightRequired: true, changes, createdRefs}`。完整存储快照用 getDraft，当前 preview 和诊断用 preflight；已有 Run 编辑后仍通过 resume 继续。
- 节点成功立即保存 Binding；pending 可能已经有部分远端资源，全量成功才标 published。
- 所有管理 API 都是异步。未注册执行器时预检只诊断；未注册后端时，存储和锁仅在进程内。

预检响应使用 `formatVersion: 3`。preview 的字段键是节点内的 JSON Pointer（如 `fields["/profile/name"]`），展示重建后的对象值与子字段三态；数组仍为整值。旧检查需要重新预检。公开 edit/preview 和候选修复使用 EditBatch；create 接收 `InitialIntent`（`{roots: [...]}`），返回 `{draft, createdRefs}`。

编辑现有节点时，使用 Draft/preview 返回的 ref：

```ts
const updated = await engine.edit(draft.id, draft.version, {
  patches: [{ op: "set", ref: nodeRef, scope: "canonical", path: "/profile/name", value: "选定的名称" }],
});
```

拓扑放在 `graphPatches`，OP 同样只有 set/remove/reset。候选 `repairOps` 和 `repairs[].ops` 使用同一 EditBatch 结构。关系注册必填 ownership/cardinality；重复字段坐标整批拒绝并返回 message/hint。拓扑新增节点由服务端分配 ID，通过 createdRefs 返回；preview 的临时 ID 不能提交编辑。

包内提供 `initialIntentSchema` 与 `editBatchSchema`，供宿主校验输入结构。参见 [Agent 输入接入指南](docs/guides/agent-inputs.md)：包级导入、诊断修复批次，以及工具 schema 与引擎校验的边界。通用 helper、Messages 修复循环和 DSH 适配见上方 Agent 接入。

## 更新已有资源

首次成功后可 edit 字段，再 preflight、publish 新凭据。返回 kind 为 initial_create/update 时有 Run ID；noop 表示已持久采用但无需写入，id 为 null；not_started 表示写前复核阻断，附具体诊断。未完成 Run 仍走 resume，不能换一个 Run 重来。本 Run 已完成节点保持保护；历史完成 Run 只观察。

reset 以最近全量发布成功的意图为固定基线，首次成功前才使用 initialSnapshot。历史凭据返回原采用结果；用 isCurrentIntent 和 previewVersion 区分它与当前意图。

[实际执行的 update HTML](docs/examples/update.html) · [离线 ZIP](docs/examples/stagedwrite-update.zip) · [Product adapter 与沙盒指南](examples/stripe-update/README.md)。HTML 使用 Mock 远端；另有[真实 Stripe update 验收记录](docs/examples/stripe-update-sandbox-result.json)，覆盖原 ID 更新、回执丢失恢复及 noop。

## Adapter 回执契约

`ManagedExecutor` 区分创建/只读检查与更新写入能力：

- 不传 `updateWrites` 或设为 `false`：可以独立注册 `update.inspect` 和可选的预览计划函数，不承诺更新写入。创建可返回不含 `confirmed` 的 applied，但这样没有用于后续 update 的规范值基线。
- `updateWrites: true`：使用 `ManagedUpdateExecutor`，必须提供 `update.inspect` 和 `update.plan`。仍复用同一组 apply/reconcile；每个 applied（包括创建）在类型上必须包含 `confirmed: { projectionDigest, values }`。非成功结果不要求 confirmed；不支持查证仍须显式声明。

TypeScript 检查这个承诺；注册期会拒绝缺少能力函数的配置，不会调用函数来试探返回值，也无法证明未来回执正确。运行时仍检查原资源身份、投影和全部受管值。确认缺失或矛盾时请求保持 unknown，不能据此重发。回调通过 `context.update` 获得原请求的不可变观察条件，包括可用的 remoteVersion。

**已为显式声明 update 写能力的 executor 开放固定图、固定远端 ID 的标量字段更新。** 更新不支持新增、删除或替换节点；远端条件写由 adapter 负责，没有远端 CAS 时限定单一写方。见 [更新接入指南](docs/guides/update.md) 和 [执行账本](docs/tasks/update-execution.md)。

## 恢复边界

**未完成工作调用 `resume(run.id)`；重复 publish 只观察已有 Run。** `getRun(run.id)` 可查看当前 preview、诊断和请求尝试记录。

| 情形 | 当前恢复路径 |
|---|---|
| 输入不合法导致 blocked | edit 修复未完成节点，再 resume；新版本必须重新预检 |
| 派发前执行中断 | 故障恢复后 resume，已确认效果不重复发送 |
| unknown 且有确定证据 | 用原请求/key 查证或采纳已记录回执；确认成功则保留，确认 no_effect 后才可继续 |
| unknown 且证据不足 | 保持未解决，不能重发该请求或采用修改后的输入 |

查证不受支持、持续 unknown 或证据矛盾时，Run 可能一直无法解决。当前没有公开人工裁决 API。改 Draft 不能证明旧请求是否生效；**不要新建替代 Draft 来重试**，旧请求可能已经创建资源。

当前也没有持久的 stop/abandon API。不再调用 resume 不等于关闭 Run，不能阻止以后续作，也不取消在途请求或回收资源。永久无法修复的 blocked Run 同样没有显式关闭操作。

执行中断时，引擎尽力记录诊断：若有未决尝试则标 unknown，否则标 blocked。存储故障、进程退出或失锁可能让补记失败，所以持久化的 running 不证明仍有活跃 worker。恢复后保留 Draft/Run 身份、检查事实并持有效租约续作；操作抛错时远端也可能已经成功。

宿主拥有存储，但直接修改 Run 记录不属于受支持的恢复契约。错误修改可能丢失证据、破坏绑定或重复创建资源；能改表不等于能安全恢复。

## 锁与存储边界

修改操作使用存储 namespace 与 Draft ID 定位租约。引擎续租并按 token 释放，存储原子检查执行权；远端请求发送前先持久记录尝试。失锁不能继续写状态，晚到回执单独保留，供新执行者查证采用。

内置 SQLite 后端支持共享同一本地文件的多进程，已有跨进程争用与崩溃恢复测试。**跨主机部署需要外部配对的 ManagedStore 与 DraftLockProvider；没有内置或声称已验证的跨主机生产后端。** 独立锁回调加无保护写库不足以提供该保证。[后端契约](docs/design/018-draft-lifecycle-proposal.md#锁与存储契约)。

远端幂等与确定性查证由适配器提供。锁不能取消已经发送的请求，超时或空搜索结果不能证明没有副作用。

## 当前范围

仅维护 createStagedWrite。无人使用的旧原型、专属存储和兼容导出已移除，不提供旧数据迁移；不会删除既有数据库。本实验版本应使用新数据库。

公开引擎尚未提供远端拓扑变更、资源替换、rollback、自动填充、调度、完整编辑历史、人工裁决/停止/导入/保留策略或通用嵌套请求体生成。[Roadmap](docs/roadmap.md)。

build 会先清理 dist，避免旧模块残留在打包产物。CI 包含回归、walkthrough 和隔离的包消费验证。

## Walkthrough 完整性

`npm run demo:html` 真实执行库、SQLite 和模拟远端，并一起生成 JSON、Markdown、独立 HTML 与离线 ZIP。ZIP 包含对应的原始文件字节，元数据固定。

`npm run verify:walkthrough` 重跑示例但不覆盖已有证据。比较时只一致地重命名运行时 UUID，并忽略引擎/报告时间及 Node 版本；业务值、诊断、OP 顺序、版本、绑定和效果必须一致。它还用已保存记录和当前模板/源码重建产物，要求字节相同。新原始记录保存在 `dist/walkthrough-raw.json`，CI 会将其作为产物上传。

已保存记录来自真实执行，不是固定时钟的模拟记录。检查证明该场景的产物新鲜度与内部一致性，不证明真实 Stripe 连通或任意并发场景安全。

### 实验性存储格式

当前 SQLite 使用 schema 3（持久请求信封）。schema 1/2 数据库在 DDL 或 journal-mode 修改前报 `STORAGE_VERSION_UNSUPPORTED`，不迁移或删除。保留旧数据库；旧版本中尚未解决的 Run 不能通过新数据库中的替代 Draft 重试，应使用匹配版本检查或续作。

update 保留原 Binding 和不可变请求证据。旧凭据只观察原采用结果；通过 isCurrentIntent 和 previewVersion 区分历史成功与当前意图。

- [有限模型修复循环（Messages 样例，已通过 mock 验证）](docs/guides/agent-repair.zh-CN.md)
