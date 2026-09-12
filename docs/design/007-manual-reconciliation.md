# 人工核对与不确定执行的关闭

状态：已实现，内存原型。对应第四轮 H1。H2 部分成功派生另行设计；H3/F6 补丁未合入。

## 接口与边界

图入口和旧入口共用 `adjudicate(runId, stepId, command)`。command 包含 requestId、expectedSequence、
actor、evidence、note、decision。expectedSequence 是最后观察到的事件序号，不是草稿 version。
所有字段进行非空/JSON/结构校验，证据副本进入事件；只有当前 unknown run 的 unknown 步骤接受新裁决。
RUN_BUSY 拒绝与派发/自动恢复交错；同步完成 CAS、事件和状态变更，无网络副作用。

宿主负责身份认证、授权，以及对原 key、已解析输入、目标账号和实际效果的证据核验。
本库无法证明 actor 字符串的身份或 evidence 的真实性，不能将此入口直接开放给未授权的客户端或代理。
证据建议用外部存档的引用，避免密钥和不必要的敏感原文；run/getRun 包含请求输入和裁决资料。
事件记录 recordedAt（宿主进程时间，非可信时间戳），以及完整命令，明确区分人工证据和 adapter 返回值。

## 状态转换

| 裁决 | 步骤 | run | 后续 |
|---|---|---|---|
| applied + remoteRef | applied | blocked | 显式 resume 跳过此效果，继续依赖步骤；末步也需要 resume 收尾 |
| no_effect + retry | ready | blocked | 显式 resume 沿用原 key/resolvedPayload 重试 |
| no_effect + stop | failed | failed | 剩余步骤 skipped；全部无效果时允许 revise |
| close_unresolved | 保持 unknown | closed | 剩余步骤 skipped/run_stopped；resume 只观察，不允许 revise |

no_effect 意味着原请求没有生效且不可能稍后完成。后台当前查不到、操作者想放弃，都不满足此条件。
关闭是行政决定，不抹去不确定性。当前版本关闭不可撤销；若希望之后补证，保持 unknown 而不关闭。
这里不自动进行 rollback 或修改原始计划，已 applied 的步骤仍保留远端回执。

## 重复、竞争与历史

同 run 内 requestId 唯一。相同命令重复提交返回当前 run（不保证是首次裁决时的旧快照），不追加事件，
不重复触发后续动作；同 ID 不同内容/stepId 返回 ADJUDICATION_CONFLICT。进行中的执行优先返回 RUN_BUSY。
新 requestId 必须匹配当前事件序号；即使自动恢复仍返回 unknown，其新事件也使旧裁决失效。
旧凭证重复 publish 仍只观察同一 run。裁决不解除原草稿封存，不重新生成计划。

## 验收

7 项回归测试：人工 applied 传递父结果；no_effect 显式同键重试；stop 与关闭区别；幂等/冲突/CAS；
非法证据和错误步骤无修改；派发与核对进行中竞争；旧入口一致性。demo:manual 纳入 CI。
现有 75 项加新增 7 项，总计 82 项。

## 后续 H2：部分成功派生

人工核对解决证据缺失，部分成功派生解决已知效果和新意图的衔接，两者不能混为一谈。
后续设计需明确：步骤与图节点的多对多映射、创建/更新效果类型、远端目标和可复用结果绑定、
派生草稿怎样表达“已有对象”、旧 run 历史保留，以及修改意图后哪些步骤必须重新执行。
验收场景：父创建成功、子失败，修改子意图后仅创建子，并引用原父 ID。不能通过伪造父步骤成功或
复制原计划换新 key 来实现；也不能从一个 remoteRef 推导完整线上节点状态。
SQLite 持久化时必须原子保存裁决事件和状态，再允许 resume；当前不提供跨进程恢复保证。
