# 005：Stripe 测试 Customer 实验

**历史协议/阶段设计：当前默认 API 的 Draft、reset、发布归属与租约以 [018](018-draft-lifecycle-proposal.md) 和 [000 原则](000-project-principles.md) 为准。下文旧接口与阶段测试保留历史语境，不表示已移植到新协议。**

**设计约束：遵循 [000 项目原则](000-project-principles.md)；原则冲突须先与项目所有者讨论并取得明确同意。本文中的阶段实现记录不覆盖主线，publish/resume 目标及当前差异以 [006](006-graph-execution.md) 为准。**

状态：版本 2 已接图执行入口，12 项离线 HTTP 契约测试完成；真实 Stripe 账号联调未运行（当前环境未配置 STRIPE_SECRET_KEY）。2026-09-12。

## 目的与范围

在 SQLite 前，用一个真实 API 形状检验 Adapter 接缝。实验现通过 `graphExecutor(selector)` 接入显式 executable 图引擎；详见 [006](006-graph-execution.md)。

只创建 Stripe test-mode Customer：只传合成 description 和本请求关联 metadata，不传 email、支付方式、余额、订阅或扣款参数。不属于完整 Stripe 计费/预览 adapter，也不证明图计划器已集成。

实现使用 Node fetch 发固定 HTTPS 请求，固定 Stripe-Version 为 `2026-08-26.dahlia`。只支持 sk_test_/rk_test_ 密钥；密钥只在运行时传入，不进草稿、计划、事件或错误输出。禁跟随重定向，默认超时 10 秒。transport 注入仅供可信测试代码使用。

## 派发与恢复（版本 2）

先验证密钥所属 accountId，再派发固定 Customer 计划。metadata 保存请求 key 标记及账号/执行器/API 版本/原始步骤内容的 context 摘要；新 adapter 实例可以按原始上下文重建搜索，不依赖内存记录。

400/401/403 的特定 invalid_request_error 为终态拒绝；429 必须具备官方限流原因头和匹配错误体才为可重试拒绝。重试使用原 key，清楚区分已拒绝与未决 attempt。409/5xx/幂等冲突或其他不足证据保持 unknown。完整判定和例外见 006，不通过 SDK 类名推断 HTTP 错误。

搜索只读，只有完整单结果、test mode 和两个标记匹配才 applied。空结果不是 no_effect。旧版本缺 context 的对象不自动恢复。账号验证和元数据约定不是跨进程 run 恢复，后者仍待持久化实现。

## 本地联调

先在自己的 Stripe 测试账号创建测试密钥，并确认有自身 Account 读取、Customer 写入和搜索读取权限。不要把密钥发到聊天、写入源码或提交仓库。

在 Bash 中从项目目录运行（read 隐藏输入，不把密钥留在命令历史）：

```sh
read -s -p 'Stripe test key: ' STRIPE_SECRET_KEY
export STRIPE_SECRET_KEY
export STRIPE_ACCOUNT_ID=acct_your_test_account
npm run demo:stripe
# 或单独选择响应丢失实验（每次运行都是新意图，会创建新的测试 Customer）：
npm run demo:stripe -- --lose-response
unset STRIPE_SECRET_KEY STRIPE_ACCOUNT_ID
```

正常实验验证创建与回执；`--lose-response` 在真实 POST 成功响应被接收后故意丢弃它，迫使 adapter 通过搜索查证。最多 6 次、每次间隔 10 秒；unknown 只查证，blocked 重试已证明的拒绝，仍未完成时退出非零。搜索可能更晚可见，超时并不证明没创建。

脚本会保留测试 Customer 供 Dashboard 检查，不自动删除；仅输出状态、远端 ID 和请求次数。普通 npm test 与 CI 只跑注入 transport 的离线测试，绝不自动运行真实实验。

## 验收记录

- [x] 离线：请求 URL、版本、编码、幂等 key 和 metadata 关联正确。
- [x] 离线：响应丢失后空搜索维持 unknown，再见到对象后 published，POST 次数始终 1。
- [x] 离线：HTTP 错误、不完整/不匹配证据、非法密钥/参数、账号不匹配、并发重入拒绝错误推进。
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

- [Stripe 限流证据头](https://docs.stripe.com/rate-limits)
