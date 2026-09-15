# 项目文档入口

**先读 [项目原则](design/000-project-principles.md)，原则冲突必须先与项目所有者讨论。**

当前默认 API 是长期 Draft 的管理协议：普通 Graph + fieldIntents，固定基线 reset，首次发布只认领一个 Run，诊断修复后 resume，外部租约与存储配对。成功后的远端 update 延后。

1. [当前设计与实现边界](design/018-draft-lifecycle-proposal.md)：Draft 列、注册接口、执行归属、锁和存储。
2. [实际输入输出 HTML](examples/publish-resume.html)：已注册 schema、丰富规则、初始意图、reset、publish 和 resume。
3. [预检响应](design/004-graph-preflight.md)：preview、message、候选值/repair OP 和异步 pending。
4. [Roadmap](roadmap.md)：当前交付与后续能力。
5. [旧 API](legacy-api.md)：旧数据/执行兼容；不是推荐的新项目入口。

其他编号设计保留历史阶段语境；不能用旧阶段“已完成”覆盖新协议的未实现边界。旧数据没有自动迁移，跨主机生产后端、update/diff/drift、rollback 仍未交付。
