# M4：SQLite 草稿与预检持久化

**设计约束：遵循 [000 项目原则](000-project-principles.md)；原则冲突须先与项目所有者讨论并取得明确同意。本文中的阶段实现记录不覆盖主线，publish/resume 目标及当前差异以 [006](006-graph-execution.md) 为准。**

状态：已实现。本文记录 M4 阶段边界；M5 已在 [011](011-execution-storage.md) 扩展执行模式存储并升级 schema=2。运行环境 Node.js >=22.13，使用内置 node:sqlite，不增加原生第三方依赖。

## 范围与接口

createStagedWrite({definitions,rules,storage:{kind:"sqlite",path}}) 只支持 draft 模式。
类型层和运行时拒绝 executable + storage，防止恢复了草稿却丢失 run/seal 后重复发布。
listDraftIds 用于重新发现持久草稿；getCheck(id) 可读当前检查，无需在进程外另存 checkId，
提供 checkId 时仍要求精确匹配。getDraft/edit/preflight 沿用既有接口。
close 关闭草稿存储，可重复调用；检查回调中拒绝关闭，执行模式的关闭尚未支持。
不配置 storage 时保持内存行为，旧执行入口未接持久化。

## 存储与身份

sw_meta 记录 schema=1，未知版本拒绝打开。sw_definitions 保存定义原文与 digest，(type,version)
唯一；同版本不同摘要拒绝。宿主重启时仍需注册所需定义和规则，不从数据库执行代码或自动升级定义。
sw_drafts 存 id/version/body/check_epoch/check_body；body 包含节点、边、字段意图和墓碑。
历史检查不累积，只保留当前检查；SQLite 文件是可信内部数据，不是公开的 arbitrary JSON 导入入口。
定义缺失/摘要不匹配拒绝使用对应草稿；规则摘要变化后旧检查不再 current，需要重新检查。

SQLite 使用 WAL、synchronous=FULL、busy_timeout=5000。只用参数绑定写数据。
create 为原子 INSERT；edit 用 WHERE id/version 的条件 UPDATE，一次写入完整图并清空旧检查。
纯 OP 校验失败不写数据库，失败批次不消耗版本和墓碑。读取不使用跨连接过期内存缓存。

## 检查竞争与异常

beginCheck 在短 BEGIN IMMEDIATE 事务中检查草稿版本、递增 check_epoch 并清空旧检查，然后释放事务。
规则计算不持数据库写锁。saveCheck 只有在 version 与 check_epoch 均一致时才能落库，否则 STALE_CHECK。
这同时处理其他连接编辑和同版本的更新一轮检查。规则回调不能让旧计算覆盖新结果。
预检中途进程退出时，旧检查仍失效、草稿保持最后已提交版本；下一实例需重新预检。
getCheck 继续校验版本、definitionDigest 和 rulesDigest。检查只是草稿诊断，不包含执行凭证。

此处数据库 CAS 允许多个草稿连接竞争，并不意味着支持多执行器、分布式 fencing 或远端事务。
SQLite 持久性仍依赖底层文件系统/硬件；本轮只验证已提交草稿、检查和退出中的预检失效。

## 失败来源说明

ExecutionStep 新增 failureReason 与 failureEventSequence，分别区分远端明确拒绝、人工 no_effect/stop、
停止重试，并指向不可变事件。仅用于展示与追溯，不替代 revise/continueFrom 的效果证据判断。

## 验收与后续

8 项新增测试：7 项 SQLite（跨进程读图/边/墓碑/检查、双连接 CAS、编辑与预检竞争、检查轮次竞争、
定义冲突/规则变更、预检进程退出、执行模式拒绝），1 项三类失败来源。总计 105 项。
demo:storage 展示关闭后重开、继续编辑、再次读取检查，纳入 CI。测试使用临时数据库并清理。
M5 才保存固定计划、run、事件、封存、裁决命令和派生关系；M6 才验证派发前后退出与 UNKNOWN 跨进程核对。
不能把 M4 的草稿恢复描述成执行恢复。已有对象导入、墓碑容量/归档和性能基准仍待后续。

依据：[Node.js SQLite API](https://nodejs.org/api/sqlite.html)。内置模块在 Node 22 中仍带实验性提示。
