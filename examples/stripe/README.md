# Stripe 沙盒接入样例

这个样例展示 **StagedWrite 的图式意图 → 真实 API → 诊断 → edit → resume**。它是三节点教学集成，不是完整的 Stripe SDK 或生产级 provider。

```text
Product
  ├─ monthly Price：先被真实币种校验拒绝，修复后创建
  └─ annual Price：真实创建后故意丢弃回执，再查询确认
```

## 准备

- Node.js 22.13+、npm、PATH 中的 `curl`；需要 `node:sqlite`。
- 一个 Stripe 沙盒，以及该沙盒的测试密钥。建议创建受限密钥，仅给 **Products / Prices 写权限**（包含读取）。不用提供银行卡，不会创建付款或订阅。
- 从 Dashboard 复制对应沙盒的 `acct_...` ID。它是本例的目标身份标签；必须和密钥所属沙盒一致。本例不申请额外账户读取权限来验证标签。

在仓库根目录运行：

```sh
npm ci
npm run build
cp examples/stripe/.env.example .env.stripe
```

在本地编辑 `.env.stripe`，填入 `STRIPE_SECRET_KEY` 和 `STRIPE_SANDBOX_ACCOUNT`。不要把密钥放进命令行、截图或 Git；`.env.stripe` 已被忽略。本例拒绝 live key 和只能用于前端的 publishable key。

## 运行

```sh
node --env-file=.env.stripe examples/stripe/run.mjs \
  --allow-test-writes --state-dir=.stripe-example/first
```

**该命令会在远端沙盒创建 1 个 Product 和 2 个 Price。一个全新的目录代表独立的一次创建；不要用换目录的方式重试失败请求。** 不传 `--allow-test-writes` 只输出帮助并退出，不访问远端。

正常输出依次包含：

| 操作 | 预期结果 |
|---|---|
| create | 有初始 Product/Price 意图，pending |
| preflight | passed；本例故意只检查币种形状，具体支持范围由远端校验 |
| publish | Product 成功；月度 Price 的 `zzz` 币种被 Stripe 真实拒绝；blocked |
| publish-observe | 返回同一个 Run，不发 HTTP |
| edit | 调用方选定 `hkd`，修改未完成节点；version 递增 |
| resume | 跳过 Product；创建两个 Price；故意丢弃年度 Price 的成功回执，unknown |
| resume | GET 查询原请求的匹配资源；不再 POST，最终 published |
| 查询与重复调用 | 三条 Binding；远端只有一个 Product、两个 Price；成功后 publish/resume 不发请求 |

两次 resume 前都会关闭并重新打开 SQLite 后端。**年度回执丢失是显式故障注入，不是本次真实遇到了网络超时。币种拒绝和所有资源创建、查证均为真实 Stripe 请求。** 没有调用大模型；`run.mjs` 作为调用方明确选择文档描述的 HKD 修复，规则不会自动替用户决定。

修复输入使用同一双通道协议：

```js
await engine.edit(draft.id, draft.version, {
  patches: [{ op: 'set', ref: catalogRefs(draft).monthly, scope: 'canonical', path: '/currency', value: 'hkd' }],
});
```

`create(selector, initialIntent(experiment))` 接收一个 Product root 和两个嵌套 Price spec，返回 `{draft, createdRefs}`。例如 `/roots/0/relations/pricedBy/0` 对应月付节点的服务端 ref。`catalogRefs` 从当前图的类型、关系和本例唯一的周期字段找回业务角色；它不是硬编码节点 ID。

步骤 ID `product/monthly/annual` 属于 adapter 的计划身份，`Step.effect.nodeId` 则使用真实节点 ref。远端报错和候选 repairOps 定位后者；重开 SQLite 后也不依赖某次进程内保存的别名表。关系注册显式声明 ownership/cardinality。

## 中断后继续

保留原目录、配置和样例版本：

```sh
node --env-file=.env.stripe examples/stripe/run.mjs \
  --allow-test-writes --state-dir=.stripe-example/first --resume
```

同一个目录只运行一个测试驱动。它包含 `manifest.json`（Draft 身份和配置指纹）、`state.sqlite`（权威执行事实）和 `trace.json`（实际输入输出及 HTTP 记录）。再次启动会使用原 Draft/Run；已经完成时只检查结果，不再创建资源。密钥轮换、修改样例源码或丢失 manifest 后，此教学驱动会停止，需要人工检查，不能靠创建新目录“恢复”。驱动报告不是事务日志，若进程恰好在报告保存前退出，执行事实仍以 SQLite 为准，最终演示断言可能需要人工核查。

空查询、查证失败、矛盾回执均返回 unknown，不授权再次创建。这个样例没有通用人工解锁或删除远端资源的恢复入口。测试资源保留供 Dashboard 核查；结束后可在**沙盒**手动归档 Product/Prices，保留记录有助于审计。不要删除仍未解决 Run 的状态文件。

## 读代码：接入方负责什么

| 文件 | 责任 |
|---|---|
| [schema.mjs](schema.mjs) | 注册节点和关系、构造非空初始意图 |
| [adapter.mjs](adapter.mjs) | plan、请求体映射、错误诊断、正向证据查证 |
| [transport.mjs](transport.mjs) | 测试 key 防误用、HTTP、分页、幂等键编码 |
| [run.mjs](run.mjs) | 用户/LLM 所在的调用方流程、明确选择 repair、故障注入、断言 |
| [adapter.test.mjs](adapter.test.mjs) | 无账号、无网络的可回归测试 |
| [report.mjs](report.mjs) | 从实际记录导出不含身份和原始响应的摘要 |

`plan` 给每个节点一个 create 步骤，并将 Price 的 `product` 注册为 `inputRefs`。库注入 Product 的远端 ID；`apply` 再把 `amount` 映射为 `unit_amount`、`interval` 映射为 `recurring[interval]`。普通 Graph 与独立 fieldIntents 不会被整体塞进请求体。

发送方把库的请求 key 做 SHA-256 编码后放入 Stripe 的 `Idempotency-Key`。这个转换保持稳定，不能因“重试”随机换 key。修复后的请求由库分配新身份，成功节点不重发。最初本地探针曾因 curl 配置中的引号截断 key；公开样例使用安全编码并有回归测试，没有保留一次性补救代码。

查证按 experiment、node、原请求 key 摘要，以及资源类型、所有业务字段、`livemode=false` 匹配，分页完整结束且只有一条匹配事实才返回 applied。元数据不是防篡改凭证：本例假定没有其他使用者修改或伪造这些测试标记。没有匹配不证明未创建。本例不会在 reconcile 中重放 POST，也不承诺永久幂等：Stripe 可在至少 24 小时后清理幂等记录。[官方幂等说明](https://docs.stripe.com/api/idempotent_requests)

只有本例验证过的 `400 + invalid_request_error + param=currency` 被解释为发送前参数校验拒绝。其他错误保持 unknown。生产接入还需要按具体接口补齐错误契约、分页规模、限流、元数据可信性和恢复策略。[Stripe 错误处理](https://docs.stripe.com/error-low-level)

## 测试和证据

```sh
npm run test:stripe     # 离线 adapter + 录制证据闸门；CI 会跑；不需要 .env
npm test               # 核心库回归
```

真实沙盒不在默认 CI 执行，不要求外部贡献者提供密钥。真实运行可额外添加 `--summary=docs/testing/stripe-sandbox-result.json` 生成公开摘要；只在成功后生成，自动排除完整输入输出、账号/资源 ID、错误原文与 Dashboard 私有链接。完整 `trace.json` 留在被 Git 忽略的本地目录。发布前仍应审查 diff；审阅新录制后更新相邻的 `.sha256` 字节摘要，再跑离线校验。样例源码变化时必须刷新真实录制，不能手改旧的 sampleSourceDigest。详见下方测试文档的证据闸门说明。

[本次实测与范围](../../docs/testing/stripe-sandbox.md) · [实际结果摘要](../../docs/testing/stripe-sandbox-result.json)

本例从源码 checkout 导入 `dist/src/index.js`；项目目前没有已发布的 npm 包。未来包发布后，应用可改成从 `stagedwrite` 导入。我们只借鉴官方样例的“环境模板 + 运行步骤 + 验证”的组织方式，没有引入整套订阅服务器或新的框架依赖。[Stripe Samples](https://github.com/stripe-samples/subscription-use-cases) · [Stripe Node SDK](https://github.com/stripe/stripe-node)
