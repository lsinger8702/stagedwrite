# A2：有限诊断修复循环

**当前总状态（2026-09-17）：A1 已完成；A2 有限修复循环与 A3 官方 DSH 接入均已完成 mock 验收。真实模型、DSH 进程重启/磁盘会话恢复和生产持久授权未验收。详见 [DSH 账本](dsh.md)；下文早期“未实施/待接线”是历史记录，不代表当前状态。**

2026-09-17 所有者批准：由代码推进，模型只建议 patch / ask / stop；复用 A1 和现有引擎。

| ID | 状态 | 验收 |
|---|---|---|
| A2.1 | 完成 | 严格决策契约，目标/完整同版本 preview/诊断/历史/编辑拒绝 |
| A2.2 | 完成 | 有限循环，独立拒绝/无进展计数，版本冲突重检，pending/unknown 停止 |
| A2.3 | 完成 | Messages API 样例、原创 prompt、调用记录与取消 |
| A2.4 | 完成（mock） | 实际引擎闭环、异常边界、CI/包验证；真实模型单列 |
| A2.live | 未运行（用户选择 mock） | 实际模型 + mock 远端；不得把脚本决定称为模型验收 |

A3 官方 DSH 未实施。会话记录不是执行恢复凭据，继续远端效果必须使用引擎 Draft/Run。

## 2026-09-17 验收

- Node 22.23.2：核心 214/214（A2 新增 10 条行为测试），fail 0 / cancelled 0 / exit 0。
- 既有 agent demo、新 repair demo 通过；后者真实引擎，模拟模型/远端，打印完整 Messages 和工具 IO。一次 publish 拒绝后 edit/preflight/resume 同 Run 成功。
- 旧 Stripe 离线 13/13，update/录制 10/10，walkthrough 6/6、字节检查及隔离安装/公开类型通过；零失败/取消，命令 exit 0。
- 包根新增 repairDraft/repairDecisionSchema，不新增引擎。CI 跑核心行为及 repair demo；真实 Messages HTTP transport 提供样例，尚未联网验证。
- 拒绝/无进展分别计数；版本冲突重新模型决策；pending/unknown 不忙轮询；模型超时的迟到结果不执行；在途写入返回后取消仍保留 Run 身份。
- 用户明确无模型凭据、本轮使用模拟。真实模型质量/供应商兼容性、DSH 和持久会话协调均未验收，不能标完成。

## Review 收尾 — 2026-09-18

新增宿主 onError 回调，原始异常不进模型结果/history；同步和异步日志失败均隔离。Node 22.23.2 核心 215/215，exit 0 / fail 0 / cancelled 0。
