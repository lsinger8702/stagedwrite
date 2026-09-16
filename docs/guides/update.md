# 固定图字段 update 接入

本版修改已绑定资源的受管标量字段。Draft/node/远端 ID 保持稳定，不新增、删除或替换远端资源。普通编辑仍只有 set/remove/reset。

## 注册

使用 `ManagedUpdateExecutor`（或 `ManagedExecutor` 的 `updateWrites: true` 分支）：

- `update.inspect(draft, {signal, bindings})` 只读，返回 complete+projections+observations 或 pending。每个节点需覆盖同一组受管字段，提供明确的规范值、远端身份与投影版本。remove 需要 adapter 声明 clearValue；不传/null/absent 不可合并。
- `update.plan(draft, compilation)` 将 diff 映射为固定步骤。每个节点为 update 或 noop；步骤 ID、顺序、依赖和远端 ID 保持稳定。实际 HTTP body 仍由 adapter 构造。
- `apply` / `reconcile` 共用原有派发器，applied 必须含 `confirmed: {projectionDigest, values}`，包括未改变的受管字段。支持更新的创建回执也需要这些值作为基线。
- `context.update.observation` 来自原不可变请求，包含原值和可选 remoteVersion。adapter 将条件令牌用于远端 CAS；没有 CAS 的接入只能承诺单写方。Draft 租约不能锁住其他远端客户端。

只注册 inspect 而不声明 updateWrites 时，预检仅返回诊断/预览，不签发更新资格。不支持查证可显式声明 unsupported；之后出现 unknown 可能无法自动解决。

## 调用与返回

```ts
await engine.edit(draftId, version, {
  patches: [{ op: "set", ref: nodeRef, scope: "canonical", path: "/name", value: "New name" }],
});
const check = await engine.preflight(draftId);
if (check.status === "passed" && check.certificate) {
  const result = await engine.publish(draftId, check.certificate);
  if (result.kind === "noop") {
    // 已持久采用新基线；id=null，没有请求，也没有需要 resume 的 Run。
  } else if (result.kind === "not_started") {
    // 查看 preview/diagnostics，重新预检；未认领新的 Run。
  } else if (result.state !== "published") {
    // 针对诊断生成 OP、按需 edit，然后 resume(result.id)。
  }
}
```

同 Draft 有未完成 Run 时，publish 只返回该 Run，后续走 resume。重复旧 certificate 返回原采用记录；`isCurrentIntent` 为 false 时，旧 published 不代表当前意图已成功。`previewVersion` 与 `currentRunId` 指向当前状态。独立创建另一组资源仍用另一个 Draft。

resume 先查证所有未知请求，再采用修复；成功节点不能改，原请求证据不能改。明确重新 preflight 后，同版本的新证书也可以由 resume 重新检查和采用。请求体或条件改变且已有尝试时使用新 key，前提是旧请求已明确无效。回执不完整不等于没生效。

reset 恢复最近全量成功的声明。部分成功只推进节点事实，不推进全图成功基线。所有槽位成功或被观察证据满足后才推进 published 基线；全图 noop 不创建 Run。

## 可运行证据

- `npm test`：Memory/SQLite 的公开生命周期、并发、提交故障、超时/失锁、迟到回执。
- `npm run demo:update`：生成 [HTML](../examples/update.html)、[JSON](../examples/update-trace.json)、[ZIP](../examples/stagedwrite-update.zip)。真实执行库及 SQLite，远端为 Mock，固定 ID/时钟仅用于离线演示。
- `npm run verify:update`：重跑样例并逐字节检查产物，同时执行 Product adapter 离线契约测试。
- [真实沙盒驱动](../../examples/stripe-update/README.md)：需要测试凭据。离线通过不等于已经完成真实 Stripe update 验证。
