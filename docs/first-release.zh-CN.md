# 开源与发布

**遵循 [项目原则](design/000-project-principles.md)，只维护 `createStagedWrite` 一套引擎。**

当前仓库已在 GitHub，package 为 `stagedwrite@0.0.1`，仍设置 `private: true`，尚未发布 npm。GitHub 公开源码与发布可安装包是两回事。

发布前运行：

```sh
npm ci
npm test
npm run demo:html
npm run verify:package
```

构建会清理输出；包验证检查唯一引擎出口、无已删除实现、隔离安装、SQLite 重开与公开 TypeScript 声明。CI 执行当前测试、演示和打包验证。

先让试用者按 README 跑通，再确认正式 API、发布元数据和 npm 账号/名称权限。不要把本地测试通过表述为真实远端联调或跨主机生产验证完成，也不必为了公开仓库立即发布 npm。

简历描述可以引用已实现的图式意图、三态编辑、预检诊断、单 Run 续作、SQLite 与租约故障测试；update、drift、rollback 和生产效果留到实际完成后再写。
