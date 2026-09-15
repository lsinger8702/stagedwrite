# 当前 MVP 范围

**原则以 [000](design/000-project-principles.md) 为准，接口契约见 [018](design/018-draft-lifecycle-proposal.md)。**

一条完整闭环：注册图 Schema、规则和执行器 → 带初始意图 create → preflight 返回具体诊断和 preview → 调用方选 OP → edit → publish → 失败修复或未知查证 → resume 同一 Run。

| 必须能力 | 当前实现 |
|---|---|
| 图建模与受限 Schema 引用 | 节点/边、显式关系、顶层标量、本地 $defs 引用、版本绑定 |
| 意图表达 | 普通 Graph + fieldIntents，初始基线不可变，reset 恢复基线 |
| 原子编辑 | OP 顺序、版本 CAS、结构/schema 校验、墓碑防身份复用 |
| 预检 | 当前 preview、具体 message、可选候选与 repair OP、异步 pending |
| 首次发布 | currentRunId 与 Run 同事务，重复 publish 不另建资源 |
| 续作 | 成功节点不改不重发，未知查原输入，未完成节点字段修复 |
| 存储与执行互斥 | 内存/SQLite、原子记录、外部锁/Store 端口、租约续租和失锁隔离 |
| 可复现交付 | 单一入口、实际 HTML/JSON、当前回归、隔离打包验证和 CI |

暂不做成功后的 update、增删远端子树、diff/drift、rollback、自动推导、队列、任意嵌套 OP、通用请求路由器。没有原型兼容或迁移承诺。真实 adapter 和跨主机后端按 [Roadmap](roadmap.md) 验证后再承诺部署能力。
