# A1：通用 TypeScript SDK helpers 账本

**范围见 [023](../design/023-agent-helpers.md)。下一主线已由所有者要求继续；复用已批准的 019，不改变核心原则。**

| ID | 状态 | 交付和验收 |
|---|---|---|
| A1.0 | 完成 | 绑定单定义、宿主授权、七个工具、模型结果投影与错误语义；023 |
| A1.1 | 完成 | 独立 inputSchema、静态协议类型、不可信输入校验、受控 dispatch/invoke |
| A1.2 | 完成 | preview/诊断投影、原始执行证据不外传、授权/跨 Run/版本冲突回归 |
| A1.3 | 完成 | 对象工具宿主 + JSON 文本消息宿主，调用同一 helper 的实际闭环 |
| A1.4 | 完成 | 中英文指南、包导出/类型消费、Node 22 完整验收 |

不把 A1 当 A2/A3 完成；不将模型没有实际参与的 mock 演示称为 LLM 验收。

- 第一批验证：Node 22 下 A1 测试 5/5、TSC 通过。两个宿主均实际走预检诊断/候选、非落库 preview、edit、pending、远端拒绝、unknown 同 Run 查证、update 与 noop；版本冲突保持原版本，外部 Run 不派发，拒绝授权无引擎调用，PRIVATE 哨兵未出现在模型结果。

## A1 结项 — 2026-09-17

- `createAgentTools` 已由包根导出：固定定义/授权闭包，七个独立 schema，dispatch/invoke 同一路径。输出为显式模型视图；原引擎入口及生命周期不变。
- 对象函数宿主与 JSON 消息宿主实际闭环通过；独立 demo 输出真实工具输入/输出，模型决策与远端为脚本/mock，未声称真实 LLM 验证。
- Node 22.23.2：核心 202/202，旧 Stripe 13/13，update/证据 9/9，walkthrough 6/6，均 exit 0 / fail 0 / cancelled 0。demo、TSC、隔离安装后的 helper 调用和公开类型检查、HTML/ZIP 字节校验通过。
- 中英文指南已交付。宿主仍需适配模型供应商的 schema 子集、持久保存用户/Draft 权限；本版无动态字段 TS 推断、自动修复循环或 DSH 插件。
- 下一项：A2 有限 Messages API Harness；A3 官方 DSH 可在同一工具协议上独立接入，均未实施。

## A1 review 收尾 — 2026-09-17

| ID | 状态 | 内容 |
|---|---|---|
| A1.R1 | 完成 | Run 不存在/跨 Draft 的模型错误统一，原始错误留宿主；响应相等且不派发回归 |
| A1.R2 | 完成 | 全工具共用关系槽位 preview，保留完整字段、共享 ref；删除身份最小提示保留 reset 能力 |
| A1.R3 | 完成 | Node 22.23.2：核心 204/204、agent demo、update 证据 10/10、包导出及类型消费均 exit 0；测试 fail 0 / cancelled 0 |

A2/A3 尚未实施；本轮不改变引擎生命周期或三态 OP。

A2 当前状态：有限修复循环及 mock Messages 闭环已实现，见 [A2 账本](agent-repair.md)。真实模型未验收，A3 未实施。
