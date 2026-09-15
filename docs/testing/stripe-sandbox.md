# Stripe 沙盒验证

**这是一条明确边界的真实集成证据，不是“已生产验证”声明。** 核心入口仍是 `createStagedWrite`；没有为这个样例增加库 API、兼容层或新的设计原则。

## 复现

按 [接入指南](../../examples/stripe/README.md) 配置自己的沙盒，运行样例。普通 CI 只运行离线测试，不读取密钥、不调用 Stripe。

已实际执行公开样例，结果保存在 [stripe-sandbox-result.json](stripe-sandbox-result.json)。`recordedAt` 是运行机器的 UTC 时间；`sampleSourceDigest` 是五个运行模块的内容摘要。摘要来自真实运行的白名单导出，而非手填状态。它是某次运行的历史记录；CI 不会通过网络重新验证它，也不代表任意未来提交都已在远端测试。

| 验证项 | 证据 |
|---|---|
| Graph → 真实请求 | Product 创建后，远端 ID 注入两条 Price 请求 |
| publish 诊断 | Stripe 返回实际 currency 参数校验错误；诊断带图路径、message 和候选 repair OP |
| edit → resume | 调用方选择 HKD，同 Run 使用修复后的输入与新请求 key |
| 保留已成功资源 | 成功 Product 不重发；远端按本次实验标记查询只有一个 Product |
| unknown → 查证 | 年度 Price 创建成功后显式丢弃回执，再通过 GET 匹配原请求 |
| 持久化 | 两次关闭/重开 SQLite 后仍可继续 |
| 防重复调用 | blocked 时重复 publish、成功后 publish/resume 均未新增 HTTP |
| 最终结果 | published、1 Product、2 Prices、3 Bindings，全部为测试模式 |

对照结果：`POST products 200 → POST prices 400 → edit → POST prices 200 → POST prices 200 → GET prices 200`。后续 GET 是最终资源数量和 Binding 核查。样例会在任一步不符合断言时停止，保留原执行身份。

## 没有验证什么

- 年度回执丢失是测试驱动故障注入，不是真实 TCP 超时。
- 没有真实扣款、支付方式、Webhook、Subscription 生命周期或企业激活。
- 没有远端 update、diff/drift、rollback，也没有证明跨主机锁或并发压力下的完整生产能力。
- 没有保证所有 Stripe 错误都可恢复；空或不完整查证保持 unknown，可能需要人工调查。
- 本例假定独立的沙盒目录和可信实验元数据；不适合直接照搬成共享生产服务。

## 离线回归

`npm run test:stripe` 使用真实引擎和假的 HTTP 函数，覆盖：

1. 未显式授权远端写入即退出，live/public key 拒绝。
2. 包含引号的原 key 安全编码，不同步骤/修复身份不合并。
3. 精确的参数拒绝诊断映射，以及不确定错误保留 unknown。
4. 查证要求原 key、业务字段和唯一匹配；分页完整性、重复和空查询。
5. 完整 repair/resume 流程不重复创建成功节点。
6. 公开摘要排除原始响应和敏感字段。

最初一次性探针的传输层引用错误已在本地保留，并促成第 2 项回归测试。公开样例已用修正后的代码重新完成一轮干净沙盒运行；没有把旧探针的补救特例纳入适配器。
