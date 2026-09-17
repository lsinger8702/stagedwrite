# A3：官方 DSH 接入账本

基于官方 npm @deepseek-ai/dsh-tools 0.1.0-rc.7、Cordis 4.0.1；本机源码参考 revision 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca。

| ID | 状态 | 内容 |
|---|---|---|
| A3.1 | 完成 | 独立依赖、受限 Schema 投影、真实工具注册/卸载测试 |
| A3.2 | 完成（宿主绑定接口） | DSH agent/session 身份绑定、宿主授权与工具执行闭环 |
| A3.3 | 完成（mock 模型会话） | 模拟模型会话拒绝修复/pending/unknown/恢复测试、安装指南 |

不接管 DSH 模型循环，不把 A2 repairDraft 嵌入 DSH 工具。会话恢复不是 Run resume。DSH 外层 schema 仅为展示/第一层约束，A1 完整校验不可省略。核心包不依赖 DSH。

## A3.1 验证 — 2026-09-17

Node 22.23.2，独立官方 npm 运行时测试 2/2，exit 0 / fail 0 / cancelled 0。真实 Cordis mount/unmount、DSH execute 到 A1/引擎；外层放宽的空批次/负版本仍被 A1 拒绝。注册失败清理及授权异常隔离另有单元测试。CI 使用独立 npm ci + test；核心 package 无 DSH 依赖。

实际安装组合：tools 0.1.0-rc.7 / cordis 4.0.1 / system-prompt 0.1.0-rc.8；完整依赖见独立 lockfile，不能称全部为 rc.7。当时 A3.2/A3.3 仍待接线；现已完成下节所列 mock 会话验收。

## A3.2 / A3.3 验证 — 2026-09-17

- 官方 agent-loop 0.1.0-rc.7；agent/session/llm/system-prompt 0.1.0-rc.8；版本及传递依赖固定在独立 lockfile。
- createSessionBindings 将宿主主体绑定到已登记的真实 Agent 对象；不相信 session ID 字符串，不自动向新会话继承。每次工具调用核 registry 活跃对象，异步获取工具后再核撤销。
- 真 Cordis/DSH loop/session/tools + 真 StagedWrite 引擎，模型/远端为脚本 mock：pending 返回上游 → 局部诊断/OP 修复 → publish 拒绝 → 再 edit/preflight → 同 Run resume unknown → 原 Agent 销毁 → 新会话宿主重新授权 → 原 Run 查证 published。共两次 apply，查证及重复 resume 不重发。
- 不同用户/未登记会话/同 ID 伪造对象/已销毁 Agent 拒绝；注册词汇和恢复规则真实进入模型请求，未导入整个规则库。
- Node 22.23.2 独立套件 4/4，exit 0 / fail 0 / cancelled 0，CI 已覆盖。
- 此处“换会话”是同进程共享引擎，新 Agent 显式绑定相同宿主主体；不是进程重启、磁盘会话反序列化或生产持久授权证明。实际模型 API、真实远端与 DSH 合跑仍未验收；用户已指定本轮 mock。
