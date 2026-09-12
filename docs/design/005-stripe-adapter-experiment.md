# 005：Stripe 测试 Customer 实验

状态：代码与 8 项离线 HTTP 契约测试完成；真实 Stripe 账号联调未运行（当前环境未配置 STRIPE_SECRET_KEY）。2026-09-12。

## 目的与范围

在 SQLite 前，用一个真实 API 形状检验 Adapter 接缝。实验接在已有 `new StagedWrite(adapter,rules)` 执行原型上，不把 M3 草稿检查冒充图发布许可。

只创建 Stripe test-mode Customer：只传合成 description 和本请求关联 metadata，不传 email、支付方式、余额、订阅或扣款参数。不属于完整 Stripe 计费/预览 adapter，也不证明图计划器已集成。

实现使用 Node fetch 发固定 HTTPS 请求，固定 Stripe-Version 为 `2026-08-26.dahlia`。只支持 sk_test_/rk_test_ 密钥；密钥只在运行时传入，不进草稿、计划、事件或错误输出。禁跟随重定向，默认超时 10 秒。transport 注入仅供可信测试代码使用。

## 派发与恢复

1. plan 只接受 description 的非空字符串 value 意图；拒绝其他字段、clear、null，不隐式转换。
2. apply 在请求前记录 key/body，向 `/v1/customers` 发一次带 Idempotency-Key 的 POST。metadata.stagedwrite_attempt 为该 key 的 SHA-256。
3. 成功响应需匹配 Customer 对象、cus_ ID、livemode:false 和完整 metadata 标记，才记录 applied。
4. 网络失败、错误 HTTP 或不匹配成功响应均 unknown。本次实验不把任何 HTTP 状态直接升级为无效果证据，不尝试处理 retryable refusal；真实 429 精确分类留后续扩展。
5. reconcile 只调用 `/v1/customers/search` 读取 metadata 对应对象。完整结果恰好一个、模式和标记匹配才 applied；空结果、多结果、has_more、错误或不匹配均 unknown。永远不返回 no_effect。
6. 同实例同 key 第二次 apply 不再 POST；成功返回已有回执，未决要求查证，body 变化拒绝推进。发请求前记录也挡住同 key 并发。

关联证据假设 metadata 标记由此实验独占、不被其他写入方复制/改写。多结果保持未知。正向匹配证明的是这次创建事实，不保证对象之后未被更改/删除。

不通过再次 POST 实现查证：Stripe 的幂等记录可能在至少 24 小时后清理，实验没有持久首次派发时间/重试窗口模型。尽管 Stripe 支持同 key 重试，本实验选择所有未决派发只读查证。内存丢失后不能恢复；不能声称拥有持久幂等性。

## 本地联调

先在自己的 Stripe 测试账号创建测试密钥，并确认有 Customer 写入和搜索读取权限。不要把密钥发到聊天、写入源码或提交仓库。

在 Bash 中从项目目录运行（read 隐藏输入，不把密钥留在命令历史）：

```sh
read -s -p 'Stripe test key: ' STRIPE_SECRET_KEY
export STRIPE_SECRET_KEY
npm run demo:stripe
# 或单独选择响应丢失实验（每次运行都是新意图，会创建新的测试 Customer）：
npm run demo:stripe -- --lose-response
unset STRIPE_SECRET_KEY
```

正常实验验证创建与回执；`--lose-response` 在真实 POST 成功响应被接收后故意丢弃它，迫使 adapter 通过搜索查证。最多 6 次、每次间隔 10 秒；仍 unknown 时退出非零，不再派发。搜索可能更晚可见，超时并不证明没创建。

脚本会保留测试 Customer 供 Dashboard 检查，不自动删除；仅输出状态、远端 ID 和请求次数。普通 npm test 与 CI 只跑注入 transport 的离线测试，绝不自动运行真实实验。

## 验收记录

- [x] 离线：请求 URL、版本、编码、幂等 key 和 metadata 关联正确。
- [x] 离线：响应丢失后空搜索维持 unknown，再见到对象后 published，POST 次数始终 1。
- [x] 离线：HTTP 错误、不完整/不匹配证据、非法密钥/参数、并发重入拒绝错误推进。
- [x] 缺少密钥时脚本明确退出，未联网。
- [ ] 真实：正常创建返回测试 Customer ID，Dashboard 可核对。
- [ ] 真实：故意丢响应后，搜索查证到相同对象，postCount=1，未重复创建。

后两项必须在真实测试账号运行后记录结果，不能由离线 fixture 打勾。没有测试账号时可以先推进 M4 设计，真实验证作为未完成项保留。

## 官方依据

- [创建 Customer](https://docs.stripe.com/api/customers/create)：返回 Customer 对象。
- [Customer 搜索](https://docs.stripe.com/api/customers/search)：存在可见性延迟，不适合依赖严格写后读一致性的流程；部分地区不支持搜索。
- [幂等请求](https://docs.stripe.com/api/idempotent_requests)：相同 key 保存结果，键可在至少 24 小时后清理。
- [错误与重试](https://docs.stripe.com/error-low-level)：网络错误结果不明确，服务端错误也可能涉及效果。
- [API 版本](https://docs.stripe.com/api/versioning)：显式请求头固定版本，避免随账户默认版本漂移。
