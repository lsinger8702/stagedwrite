# 项目文档入口

**先读 [项目原则](design/000-project-principles.md)，原则冲突必须先与项目所有者讨论。只维护 `createStagedWrite` 一套引擎，不保留无人使用的原型兼容层。**

1. [当前设计](design/018-draft-lifecycle-proposal.md)：长期 Draft、固定基线 reset、发布归属、锁和存储。
2. [真实输入输出 HTML](examples/publish-resume.html)：Schema、规则、初始意图、reset、publish、修复和 resume。
3. [预检响应](design/004-graph-preflight.md)：preview、message、候选值/repair OP 和异步 pending。
4. [架构与目录](architecture.md)：当前模块分工。
5. [当前范围](mvp.md) · [Roadmap](roadmap.md) · [运行与阅读代码](implementation.zh-CN.md)。

旧原型的源码与设计可从 Git 历史查阅；当前目录只保留当前实现相关文档。跨主机生产后端、update/diff/drift、rollback 尚未交付。
