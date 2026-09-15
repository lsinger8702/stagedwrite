# Roadmap

**遵循 [000 原则](design/000-project-principles.md)，原则冲突先讨论。当前实现见 [018](design/018-draft-lifecycle-proposal.md)。**

## 已实现：首次创建与修复闭环

- 非空初始意图、普通 Graph + fieldIntents、固定初始基线与 reset。
- currentRunId 原子认领；重复 publish 观察，同 Draft 不另开首次 Run。
- 具体诊断与 preview、异步 pending、edit 后 resume 同一 Run。
- Artifact、逐节点 Binding、原请求账本、成功节点和拓扑保护。
- 外部锁/Store 端口；内存、共享本地 SQLite、跨进程互斥和退出恢复验证。
- 单一引擎入口、当前示例与测试；旧原型及其兼容层已按用户要求删除。

## 下一步：验证接入边界

- 为当前协议接入一个真实远端 adapter，验证请求映射、幂等与查证契约。
- 提供一套跨主机共享 Store + LeaseProvider，验证失锁、重启和网络分区。
- 根据实际需要设计人工处置与证据保留；不为原型兼容移植旧接口。
- 外部试用、确认 API，再发布可安装版本。

## 后续能力：先定协议再实现

1. 固定图字段 update：保留 Draft 身份，明确成功基线、Binding 和新 Run 的切换协议。
2. 增删子树与多效果：处理部分成功、未知请求、资源所有权与删除补偿。
3. 远端读取、归一化和 drift：区分用户意图变化与远端变化。
4. Saga rollback 与显式放弃；解锁不能代替资源处置。
5. 按需求增加字段消费追踪、推导层、编辑历史。

“更新失败后一律新 Run”仍未定稿；这些方向不等于接口已经批准。
