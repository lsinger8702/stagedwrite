# A3：官方 DSH 接入账本

基于官方 npm @deepseek-ai/dsh-tools 0.1.0-rc.7、Cordis 4.0.1；本机源码参考 revision 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca。

| ID | 状态 | 内容 |
|---|---|---|
| A3.1 | 完成 | 独立依赖、受限 Schema 投影、真实工具注册/卸载测试 |
| A3.2 | 待完成 | DSH agent/session 身份绑定、宿主授权与工具执行闭环 |
| A3.3 | 待完成 | 模拟模型会话拒绝修复/pending/unknown/恢复测试、安装指南 |

不接管 DSH 模型循环，不把 A2 repairDraft 嵌入 DSH 工具。会话恢复不是 Run resume。DSH 外层 schema 仅为展示/第一层约束，A1 完整校验不可省略。核心包不依赖 DSH。

## A3.1 验证 — 2026-09-17

Node 22.23.2，独立官方 npm 运行时测试 2/2，exit 0 / fail 0 / cancelled 0。真实 Cordis mount/unmount、DSH execute 到 A1/引擎；外层放宽的空批次/负版本仍被 A1 拒绝。注册失败清理及授权异常隔离另有单元测试。CI 使用独立 npm ci + test；核心 package 无 DSH 依赖。

实际安装组合：tools 0.1.0-rc.7 / cordis 4.0.1 / system-prompt 0.1.0-rc.8；完整依赖见独立 lockfile，不能称全部为 rc.7。A3.2/A3.3 仍待真实 session/agent 接线，不以注册测试冒充会话闭环。
