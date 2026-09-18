# 有限诊断修复循环

`repairDraft` 复用 A1 工具。模型只能输出 `patch / ask / stop`；三态 OP 为 set/remove/reset。流程代码负责预检、编辑、发布或同 Run resume，模型不能宣布成功，也不能填写执行身份、版本、证书或凭据。

```ts
const result = await repairDraft({
  tools, draftId, goal: "按我的标题发布，不知道该选什么时先问我",
  decide: async (context, signal) => modelDecision(context, signal),
  maxRounds: 6, maxToolCalls: 24, timeoutMs: 60_000,
});
```

宿主先通过 A1 create 提交非空初始意图并登记归属。每轮模型拿到用户目标、定义、同一个响应中的完整 preview/诊断、历史和结构化拒绝信息。模型输出运行时严格校验，候选不会自动应用。

- `published`：引擎确认当前意图成功。
- `waiting`：pending/incomplete 或 unknown/running；交回上游，不自动轮询。
- `needs_input`：展示问题，得到用户选择后补充 goal，再进入同 Draft。
- `stopped`：预算、连续拒绝、无进展、宿主故障或模型明确停止；带 message/hint/history。

返回已知 Run ID。有未决 Run，下一次必须带同 runId 进入，先 resume 查证原请求。历史成功 Run 不代表当前新意图；已成功后另一次 update 不传历史 runId。权限仍由宿主逐次授权。

编辑成功必须重新完整预检；版本冲突丢弃旧 OP 并重新检查/决策。格式拒绝与成功编辑但无进展分别计数。取消/超时停止新调用，迟到模型输出不执行；已启动的引擎调用会等它返回，不能假装取消了远端请求。适配器需自行设 I/O 超时。history 不是可盲目回放的写入脚本或持久队列，每次入口预算重新计算，跨入口额度由宿主管。

`npm run demo:repair` 打印真实库执行的输入输出：预检拒绝 → 模拟模型 OP → edit → publish 被模拟远端拒绝 → 修复 → 同 Run resume 成功。**模型和远端都是 mock，不是实测模型能力。** Messages 样例另提供 `--live`，需宿主配置 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_MODEL`，本轮未运行。

[英文完整契约](agent-repair.md) · [任务账本](../tasks/agent-repair.md)

可传 `onError(error)` 接收模型或宿主的原始异常，仅供宿主日志使用，不进入模型结果或 history。日志回调抛错/拒绝不会覆盖原始失败；正常预算或取消停止不调用该回调。
