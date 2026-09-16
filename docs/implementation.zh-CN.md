# 运行与阅读代码

**先读 [000 原则](design/000-project-principles.md)。只维护当前生命周期；无原型兼容入口。**

```sh
npm ci
npm test
npm run demo:html
npm run verify:package
```

Node.js 22.13+。`build` 先清理 `dist` 再编译；测试和 tarball 不应读取已删除源码遗留的输出。

建议按这个顺序看：

1. [虚构 Schema 与规则](../examples/fixtures/project-tasks-managed.ts)：两种节点、显式关系、三条业务规则以及候选修复。
2. [完整调用](../examples/publish-and-resume.ts)：实际执行 SQLite、Mock apply/reconcile 和行为断言。
3. [类型](../src/managed/types.ts)：Draft 是意图，Artifact 是冻结的已检查输入，Run 是执行与尝试。
4. [引擎](../src/managed/engine.ts)：锁、当前 Run 归属、先记账后发送、未知查证与修复保护。
5. [存储](../src/managed/storage.ts)：所有推进事务验证有效租约，远端回执与 Binding 保存。

测试按职责拆分：registry 校验定义和引用；graph 验证关系、三态和原子编辑；preflight 验证具体诊断、状态隔离和异步超时；managed 验证发布/修复/租约/进程退出；public-api 固定唯一入口与当前方法集合。打包验证在隔离目录按包名安装、检查类型并重开 SQLite，不依赖仓库内路径导入。

测试使用 Mock 远端；不代表真实服务联调或跨主机网络分区验证已经完成。
