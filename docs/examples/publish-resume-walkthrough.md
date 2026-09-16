# 当前协议的真实输入输出

实际执行库、SQLite 与断言；远端是 Mock，无 HTTP/LLM 调用。运行时间 2026-09-16T07:00:33.383Z。

[交互 HTML](publish-resume.html) · [完整 JSON](publish-resume-trace.json) · [源码](../../examples/publish-resume.ts)

运行 npm run demo:html 重新生成。

## 1. create

创建就有初始工作意图。Graph 为普通值，fieldIntents 保存三态，initialSnapshot 固定初始基线。

输入：

```json
[
  {
    "type": "example.project-tasks",
    "typeVersion": "2"
  },
  {
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": "文档发布",
          "capacityHours": 16,
          "deadlineDay": 20
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": "编写快速入门",
          "estimateHours": 12,
          "dueDay": 22,
          "priority": "urgent",
          "owner": null
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": "评审使用示例",
          "estimateHours": 10,
          "dueDay": 18,
          "priority": "normal",
          "owner": "chen"
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    }
  }
]
```

输出：

```json
{
  "graph": {
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": "文档发布",
          "capacityHours": 16,
          "deadlineDay": 20
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": "编写快速入门",
          "estimateHours": 12,
          "dueDay": 22,
          "priority": "urgent",
          "owner": null
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": "评审使用示例",
          "estimateHours": 10,
          "dueDay": 18,
          "priority": "normal",
          "owner": "chen"
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    }
  },
  "fieldIntents": {
    "project-1": {
      "/name": {
        "kind": "set",
        "value": "文档发布"
      },
      "/capacityHours": {
        "kind": "set",
        "value": 16
      },
      "/deadlineDay": {
        "kind": "set",
        "value": 20
      }
    },
    "task-1": {
      "/name": {
        "kind": "set",
        "value": "编写快速入门"
      },
      "/estimateHours": {
        "kind": "set",
        "value": 12
      },
      "/dueDay": {
        "kind": "set",
        "value": 22
      },
      "/priority": {
        "kind": "set",
        "value": "urgent"
      },
      "/owner": {
        "kind": "set",
        "value": null
      }
    },
    "task-2": {
      "/name": {
        "kind": "set",
        "value": "评审使用示例"
      },
      "/estimateHours": {
        "kind": "set",
        "value": 10
      },
      "/dueDay": {
        "kind": "set",
        "value": 18
      },
      "/priority": {
        "kind": "set",
        "value": "normal"
      },
      "/owner": {
        "kind": "set",
        "value": "chen"
      }
    }
  },
  "formatVersion": 3,
  "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 0,
  "type": "example.project-tasks",
  "typeVersion": "2",
  "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
  "status": "pending",
  "currentRunId": null,
  "targetId": null,
  "initialSnapshot": {
    "graph": {
      "nodes": {
        "project-1": {
          "id": "project-1",
          "nodeType": "project",
          "fields": {
            "name": "文档发布",
            "capacityHours": 16,
            "deadlineDay": 20
          }
        },
        "task-1": {
          "id": "task-1",
          "nodeType": "task",
          "fields": {
            "name": "编写快速入门",
            "estimateHours": 12,
            "dueDay": 22,
            "priority": "urgent",
            "owner": null
          }
        },
        "task-2": {
          "id": "task-2",
          "nodeType": "task",
          "fields": {
            "name": "评审使用示例",
            "estimateHours": 10,
            "dueDay": 18,
            "priority": "normal",
            "owner": "chen"
          }
        }
      },
      "edges": {
        "contains-1": {
          "id": "contains-1",
          "relationType": "contains",
          "from": "project-1",
          "to": "task-1"
        },
        "contains-2": {
          "id": "contains-2",
          "relationType": "contains",
          "from": "project-1",
          "to": "task-2"
        }
      }
    },
    "fieldIntents": {
      "project-1": {
        "/name": {
          "kind": "set",
          "value": "文档发布"
        },
        "/capacityHours": {
          "kind": "set",
          "value": 16
        },
        "/deadlineDay": {
          "kind": "set",
          "value": 20
        }
      },
      "task-1": {
        "/name": {
          "kind": "set",
          "value": "编写快速入门"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 12
        },
        "/dueDay": {
          "kind": "set",
          "value": 22
        },
        "/priority": {
          "kind": "set",
          "value": "urgent"
        },
        "/owner": {
          "kind": "set",
          "value": null
        }
      },
      "task-2": {
        "/name": {
          "kind": "set",
          "value": "评审使用示例"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 10
        },
        "/dueDay": {
          "kind": "set",
          "value": 18
        },
        "/priority": {
          "kind": "set",
          "value": "normal"
        },
        "/owner": {
          "kind": "set",
          "value": "chen"
        }
      }
    }
  },
  "publishedArtifactId": null,
  "lastPublishedAt": null,
  "tombstones": {
    "nodes": [],
    "edges": []
  },
  "createdAt": "2026-09-16T07:00:33.359Z",
  "updatedAt": "2026-09-16T07:00:33.359Z"
}
```

远端调用：

```json
[]
```

## 2. edit

先连续修改名称，供下一步验证 reset 的固定基线。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69",
  0,
  [
    {
      "op": "set",
      "nodeId": "project-1",
      "path": "/name",
      "value": "临时名称 A"
    }
  ]
]
```

输出：

```json
{
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 1,
  "preflightRequired": true,
  "changes": [
    {
      "opIndex": 0,
      "target": "field",
      "id": "project-1",
      "path": "/name",
      "before": {
        "kind": "value",
        "value": "文档发布"
      },
      "after": {
        "kind": "value",
        "value": "临时名称 A"
      }
    }
  ]
}
```

远端调用：

```json
[]
```

## 3. edit

先连续修改名称，供下一步验证 reset 的固定基线。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69",
  1,
  [
    {
      "op": "set",
      "nodeId": "project-1",
      "path": "/name",
      "value": "临时名称 B"
    }
  ]
]
```

输出：

```json
{
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 2,
  "preflightRequired": true,
  "changes": [
    {
      "opIndex": 0,
      "target": "field",
      "id": "project-1",
      "path": "/name",
      "before": {
        "kind": "value",
        "value": "临时名称 A"
      },
      "after": {
        "kind": "value",
        "value": "临时名称 B"
      }
    }
  ]
}
```

远端调用：

```json
[]
```

## 4. edit

reset 回到 create 时的“文档发布”，不会回到上一版的“临时名称 A”。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69",
  2,
  [
    {
      "op": "reset",
      "nodeId": "project-1",
      "path": "/name"
    }
  ]
]
```

输出：

```json
{
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 3,
  "preflightRequired": true,
  "changes": [
    {
      "opIndex": 0,
      "target": "field",
      "id": "project-1",
      "path": "/name",
      "before": {
        "kind": "value",
        "value": "临时名称 B"
      },
      "after": {
        "kind": "value",
        "value": "文档发布"
      }
    }
  ]
}
```

远端调用：

```json
[]
```

## 5. preflight

静态规则给出 3 条具体诊断；异步检查返回 pending，无发布凭据。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69"
]
```

输出：

```json
{
  "formatVersion": 2,
  "scope": "execution",
  "checkId": "b49077a6-d0bf-43d0-82e5-f4674180a516",
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 3,
  "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
  "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
  "preview": {
    "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
    "version": 3,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": {
            "kind": "value",
            "value": "文档发布"
          },
          "capacityHours": {
            "kind": "value",
            "value": 16
          },
          "deadlineDay": {
            "kind": "value",
            "value": 20
          }
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "estimateHours": {
            "kind": "value",
            "value": 12
          },
          "dueDay": {
            "kind": "value",
            "value": 22
          },
          "priority": {
            "kind": "value",
            "value": "urgent"
          },
          "owner": {
            "kind": "value",
            "value": null
          }
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "estimateHours": {
            "kind": "value",
            "value": 10
          },
          "dueDay": {
            "kind": "value",
            "value": 18
          },
          "priority": {
            "kind": "value",
            "value": "normal"
          },
          "owner": {
            "kind": "value",
            "value": "chen"
          }
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    },
    "tombstones": {
      "nodes": [],
      "edges": []
    }
  },
  "status": "pending",
  "diagnostics": [
    {
      "code": "project.capacity_exceeded",
      "path": "/nodes/project-1/fields/capacityHours",
      "message": "项目“文档发布”容量为 16 小时，但 “编写快速入门”12 小时、“评审使用示例”10 小时，合计 22 小时，超出 6 小时。",
      "hint": "可以缩减任务范围、将部分工作移到下一期，或在用户允许时增加容量；请根据用户意图选择。",
      "related": [
        "/nodes/task-1/fields/estimateHours",
        "/nodes/task-2/fields/estimateHours"
      ],
      "stage": "work-planning",
      "metadata": {
        "capacityHours": 16,
        "totalHours": 22,
        "excessHours": 6,
        "unit": "hours"
      },
      "repairs": [
        {
          "id": "expand-capacity",
          "message": "若用户允许追加容量，可提高到当前任务总工时；这不会解决日期或负责人问题。",
          "ops": [
            {
              "op": "set",
              "nodeId": "project-1",
              "path": "/capacityHours",
              "value": 22
            }
          ]
        }
      ],
      "severity": "error",
      "source": {
        "kind": "rule",
        "id": "project.capacity",
        "version": "2"
      }
    },
    {
      "code": "task.after_project_deadline",
      "path": "/nodes/task-1/fields/dueDay",
      "message": "任务“编写快速入门”安排在第 22 天完成，晚于所属项目的第 20 天截止日。",
      "hint": "可以提前该任务、调整项目截止日，或将任务移到下一期；不要自行假设用户同意延期。",
      "related": [
        "/nodes/project-1/fields/deadlineDay"
      ],
      "repairs": [
        {
          "id": "earlier-task",
          "message": "若任务可以提前，将它安排到项目截止日。",
          "ops": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/dueDay",
              "value": 20
            }
          ]
        },
        {
          "id": "later-project",
          "message": "若用户接受整个项目延期，将项目截止日延到该任务完成日。",
          "ops": [
            {
              "op": "set",
              "nodeId": "project-1",
              "path": "/deadlineDay",
              "value": 22
            }
          ]
        }
      ],
      "severity": "error",
      "source": {
        "kind": "rule",
        "id": "task.deadline",
        "version": "2"
      }
    },
    {
      "code": "task.urgent_owner_required",
      "path": "/nodes/task-1/fields/owner",
      "message": "任务“编写快速入门”优先级为 urgent，但负责人没有有效值；紧急任务必须有负责人。",
      "hint": "指定能接手的负责人，或在用户允许时降低优先级；候选人仅供选择，不代表已获授权分配。",
      "candidates": [
        {
          "value": "lin",
          "label": "林",
          "message": "本期可以承接文档任务（虚构候选）",
          "metadata": {
            "availableHours": 8,
            "skills": [
              "documentation"
            ]
          },
          "repairOps": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/owner",
              "value": "lin"
            }
          ]
        },
        {
          "value": "chen",
          "label": "陈",
          "message": "本期可以承接评审任务（虚构候选）",
          "metadata": {
            "availableHours": 4,
            "skills": [
              "review"
            ]
          },
          "repairOps": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/owner",
              "value": "chen"
            }
          ]
        }
      ],
      "excludedCandidates": [
        {
          "value": "zhou",
          "label": "周",
          "message": "本期不可参与（虚构约束）",
          "metadata": {
            "available": false
          }
        }
      ],
      "constraintIds": [
        "demo-current-period-availability"
      ],
      "repairs": [
        {
          "id": "lower-priority",
          "message": "只有用户同意降低优先级时，才考虑保留负责人清空状态并改为普通任务。",
          "ops": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/priority",
              "value": "normal"
            }
          ]
        }
      ],
      "related": [
        "/nodes/task-1/fields/priority"
      ],
      "severity": "error",
      "source": {
        "kind": "rule",
        "id": "task.urgent-owner",
        "version": "2"
      }
    }
  ],
  "pendingRules": [
    {
      "ruleId": "document.export",
      "ruleVersion": "1",
      "message": "文档导出仍在处理中，请稍后重新预检。",
      "retryAfterSeconds": 2
    }
  ]
}
```

远端调用：

```json
[]
```

## 6. preflight

外部检查完成，仍有 3 条业务问题。完整 preview、message、候选值和 repair OP 都来自实际检查。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69"
]
```

输出：

```json
{
  "formatVersion": 2,
  "scope": "execution",
  "checkId": "202963c5-046c-42a1-89a8-e1fc84198522",
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 3,
  "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
  "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
  "preview": {
    "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
    "version": 3,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": {
            "kind": "value",
            "value": "文档发布"
          },
          "capacityHours": {
            "kind": "value",
            "value": 16
          },
          "deadlineDay": {
            "kind": "value",
            "value": 20
          }
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "estimateHours": {
            "kind": "value",
            "value": 12
          },
          "dueDay": {
            "kind": "value",
            "value": 22
          },
          "priority": {
            "kind": "value",
            "value": "urgent"
          },
          "owner": {
            "kind": "value",
            "value": null
          }
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "estimateHours": {
            "kind": "value",
            "value": 10
          },
          "dueDay": {
            "kind": "value",
            "value": 18
          },
          "priority": {
            "kind": "value",
            "value": "normal"
          },
          "owner": {
            "kind": "value",
            "value": "chen"
          }
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    },
    "tombstones": {
      "nodes": [],
      "edges": []
    }
  },
  "status": "blocked",
  "diagnostics": [
    {
      "code": "project.capacity_exceeded",
      "path": "/nodes/project-1/fields/capacityHours",
      "message": "项目“文档发布”容量为 16 小时，但 “编写快速入门”12 小时、“评审使用示例”10 小时，合计 22 小时，超出 6 小时。",
      "hint": "可以缩减任务范围、将部分工作移到下一期，或在用户允许时增加容量；请根据用户意图选择。",
      "related": [
        "/nodes/task-1/fields/estimateHours",
        "/nodes/task-2/fields/estimateHours"
      ],
      "stage": "work-planning",
      "metadata": {
        "capacityHours": 16,
        "totalHours": 22,
        "excessHours": 6,
        "unit": "hours"
      },
      "repairs": [
        {
          "id": "expand-capacity",
          "message": "若用户允许追加容量，可提高到当前任务总工时；这不会解决日期或负责人问题。",
          "ops": [
            {
              "op": "set",
              "nodeId": "project-1",
              "path": "/capacityHours",
              "value": 22
            }
          ]
        }
      ],
      "severity": "error",
      "source": {
        "kind": "rule",
        "id": "project.capacity",
        "version": "2"
      }
    },
    {
      "code": "task.after_project_deadline",
      "path": "/nodes/task-1/fields/dueDay",
      "message": "任务“编写快速入门”安排在第 22 天完成，晚于所属项目的第 20 天截止日。",
      "hint": "可以提前该任务、调整项目截止日，或将任务移到下一期；不要自行假设用户同意延期。",
      "related": [
        "/nodes/project-1/fields/deadlineDay"
      ],
      "repairs": [
        {
          "id": "earlier-task",
          "message": "若任务可以提前，将它安排到项目截止日。",
          "ops": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/dueDay",
              "value": 20
            }
          ]
        },
        {
          "id": "later-project",
          "message": "若用户接受整个项目延期，将项目截止日延到该任务完成日。",
          "ops": [
            {
              "op": "set",
              "nodeId": "project-1",
              "path": "/deadlineDay",
              "value": 22
            }
          ]
        }
      ],
      "severity": "error",
      "source": {
        "kind": "rule",
        "id": "task.deadline",
        "version": "2"
      }
    },
    {
      "code": "task.urgent_owner_required",
      "path": "/nodes/task-1/fields/owner",
      "message": "任务“编写快速入门”优先级为 urgent，但负责人没有有效值；紧急任务必须有负责人。",
      "hint": "指定能接手的负责人，或在用户允许时降低优先级；候选人仅供选择，不代表已获授权分配。",
      "candidates": [
        {
          "value": "lin",
          "label": "林",
          "message": "本期可以承接文档任务（虚构候选）",
          "metadata": {
            "availableHours": 8,
            "skills": [
              "documentation"
            ]
          },
          "repairOps": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/owner",
              "value": "lin"
            }
          ]
        },
        {
          "value": "chen",
          "label": "陈",
          "message": "本期可以承接评审任务（虚构候选）",
          "metadata": {
            "availableHours": 4,
            "skills": [
              "review"
            ]
          },
          "repairOps": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/owner",
              "value": "chen"
            }
          ]
        }
      ],
      "excludedCandidates": [
        {
          "value": "zhou",
          "label": "周",
          "message": "本期不可参与（虚构约束）",
          "metadata": {
            "available": false
          }
        }
      ],
      "constraintIds": [
        "demo-current-period-availability"
      ],
      "repairs": [
        {
          "id": "lower-priority",
          "message": "只有用户同意降低优先级时，才考虑保留负责人清空状态并改为普通任务。",
          "ops": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/priority",
              "value": "normal"
            }
          ]
        }
      ],
      "related": [
        "/nodes/task-1/fields/priority"
      ],
      "severity": "error",
      "source": {
        "kind": "rule",
        "id": "task.urgent-owner",
        "version": "2"
      }
    }
  ],
  "pendingRules": []
}
```

远端调用：

```json
[]
```

## 7. edit

调用方依据用户意图选定 4 个 OP。规则建议不自动执行。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69",
  3,
  [
    {
      "op": "set",
      "nodeId": "task-1",
      "path": "/estimateHours",
      "value": 8
    },
    {
      "op": "set",
      "nodeId": "task-2",
      "path": "/estimateHours",
      "value": 8
    },
    {
      "op": "set",
      "nodeId": "task-1",
      "path": "/dueDay",
      "value": 20
    },
    {
      "op": "set",
      "nodeId": "task-1",
      "path": "/owner",
      "value": "lin"
    }
  ]
]
```

输出：

```json
{
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 4,
  "preflightRequired": true,
  "changes": [
    {
      "opIndex": 0,
      "target": "field",
      "id": "task-1",
      "path": "/estimateHours",
      "before": {
        "kind": "value",
        "value": 12
      },
      "after": {
        "kind": "value",
        "value": 8
      }
    },
    {
      "opIndex": 1,
      "target": "field",
      "id": "task-2",
      "path": "/estimateHours",
      "before": {
        "kind": "value",
        "value": 10
      },
      "after": {
        "kind": "value",
        "value": 8
      }
    },
    {
      "opIndex": 2,
      "target": "field",
      "id": "task-1",
      "path": "/dueDay",
      "before": {
        "kind": "value",
        "value": 22
      },
      "after": {
        "kind": "value",
        "value": 20
      }
    },
    {
      "opIndex": 3,
      "target": "field",
      "id": "task-1",
      "path": "/owner",
      "before": {
        "kind": "value",
        "value": null
      },
      "after": {
        "kind": "value",
        "value": "lin"
      }
    }
  ]
}
```

远端调用：

```json
[]
```

## 8. preflight

检查通过，保存不可变 Artifact。执行器的 plan 将图映射成请求参数。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69"
]
```

输出：

```json
{
  "formatVersion": 2,
  "scope": "execution",
  "checkId": "963d8d91-2b0b-47b9-b878-0fa8c5c7cf64",
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 4,
  "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
  "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
  "preview": {
    "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
    "version": 4,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": {
            "kind": "value",
            "value": "文档发布"
          },
          "capacityHours": {
            "kind": "value",
            "value": 16
          },
          "deadlineDay": {
            "kind": "value",
            "value": 20
          }
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "estimateHours": {
            "kind": "value",
            "value": 8
          },
          "dueDay": {
            "kind": "value",
            "value": 20
          },
          "priority": {
            "kind": "value",
            "value": "urgent"
          },
          "owner": {
            "kind": "value",
            "value": "lin"
          }
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "estimateHours": {
            "kind": "value",
            "value": 8
          },
          "dueDay": {
            "kind": "value",
            "value": 18
          },
          "priority": {
            "kind": "value",
            "value": "normal"
          },
          "owner": {
            "kind": "value",
            "value": "chen"
          }
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    },
    "tombstones": {
      "nodes": [],
      "edges": []
    }
  },
  "status": "passed",
  "diagnostics": [],
  "pendingRules": [],
  "certificate": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
  "artifactId": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
  "execution": {
    "checkId": "963d8d91-2b0b-47b9-b878-0fa8c5c7cf64",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
    "executorId": "example.project-service",
    "executorVersion": "5",
    "target": "mock:local",
    "planDigest": "sha256:stagedwrite-json-v1:373748b3f14990c44e6121773348f5d260d064927ae3f872a720272d9ef816af"
  }
}
```

远端调用：

```json
[]
```

## 9. publish

同事务建立 Run 和 currentRunId。项目创建成功，任务 1 明确拒绝，任务 2 尚未发送。Draft 仍 pending。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69",
  "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
  {
    "runId": "demo-run-1"
  }
]
```

输出：

```json
{
  "id": "demo-run-1",
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "kind": "initial_create",
  "version": 4,
  "state": "blocked",
  "artifactId": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
  "initialArtifactId": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
  "certificate": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
  "revision": 0,
  "revisions": [],
  "attempts": [
    {
      "stepId": "project-1",
      "key": "[\"demo-run-1\",\"project-1\",0]",
      "number": 1,
      "input": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "request": {
        "step": {
          "id": "project-1",
          "payload": {
            "title": "文档发布",
            "capacity_hours": 16,
            "deadline_day": 20
          },
          "effect": {
            "kind": "create",
            "nodeId": "project-1"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "applied",
      "outcome": {
        "kind": "applied",
        "remoteRef": "resource-1"
      }
    },
    {
      "stepId": "task-1",
      "key": "[\"demo-run-1\",\"task-1\",0]",
      "number": 2,
      "input": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "lin",
        "projectId": "resource-1"
      },
      "request": {
        "step": {
          "id": "task-1",
          "payload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "lin",
            "projectId": "resource-1"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "effect": {
            "kind": "create",
            "nodeId": "task-1"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "no_effect",
      "outcome": {
        "kind": "not_applied",
        "reason": "Owner unavailable; request rejected before creation",
        "retryable": false,
        "code": "OWNER_UNAVAILABLE",
        "message": "负责人暂不可用，任务未创建。",
        "diagnostics": [
          {
            "code": "task.owner_unavailable",
            "path": "/nodes/task-1/fields/owner",
            "message": "林无法接手，请选择其他负责人后续作。",
            "candidates": [
              {
                "value": "chen",
                "label": "陈",
                "message": "目前可接手（虚构候选）",
                "repairOps": [
                  {
                    "op": "set",
                    "nodeId": "task-1",
                    "path": "/owner",
                    "value": "chen"
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  ],
  "events": [
    {
      "sequence": 1,
      "stepId": "project-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.370Z"
    },
    {
      "sequence": 2,
      "stepId": "project-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T07:00:33.371Z"
    },
    {
      "sequence": 3,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.372Z"
    },
    {
      "sequence": 4,
      "stepId": "task-1",
      "kind": "not_applied",
      "recordedAt": "2026-09-16T07:00:33.372Z",
      "reason": "Owner unavailable; request rejected before creation"
    }
  ],
  "steps": [
    {
      "id": "project-1",
      "effect": {
        "kind": "create",
        "nodeId": "project-1"
      },
      "payload": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "key": "[\"demo-run-1\",\"project-1\",0]",
      "status": "applied",
      "resolvedPayload": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "feedback": {},
      "remoteRef": "resource-1"
    },
    {
      "id": "task-1",
      "effect": {
        "kind": "create",
        "nodeId": "task-1"
      },
      "payload": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "lin"
      },
      "dependsOn": [
        "project-1"
      ],
      "inputRefs": {
        "projectId": "project-1"
      },
      "key": "[\"demo-run-1\",\"task-1\",0]",
      "status": "ready",
      "resolvedPayload": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "lin",
        "projectId": "resource-1"
      },
      "feedback": {
        "code": "OWNER_UNAVAILABLE",
        "message": "负责人暂不可用，任务未创建。",
        "diagnostics": [
          {
            "code": "task.owner_unavailable",
            "path": "/nodes/task-1/fields/owner",
            "message": "林无法接手，请选择其他负责人后续作。",
            "candidates": [
              {
                "value": "chen",
                "label": "陈",
                "message": "目前可接手（虚构候选）",
                "repairOps": [
                  {
                    "op": "set",
                    "nodeId": "task-1",
                    "path": "/owner",
                    "value": "chen"
                  }
                ]
              }
            ]
          }
        ],
        "reason": "Owner unavailable; request rejected before creation"
      }
    },
    {
      "id": "task-2",
      "effect": {
        "kind": "create",
        "nodeId": "task-2"
      },
      "payload": {
        "title": "评审使用示例",
        "estimate_hours": 8,
        "due_day": 18,
        "priority": "normal",
        "assignee": "chen"
      },
      "dependsOn": [
        "project-1"
      ],
      "inputRefs": {
        "projectId": "project-1"
      },
      "key": "[\"demo-run-1\",\"task-2\",0]",
      "status": "ready"
    }
  ],
  "previewVersion": 4,
  "preview": {
    "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
    "version": 4,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": {
            "kind": "value",
            "value": "文档发布"
          },
          "capacityHours": {
            "kind": "value",
            "value": 16
          },
          "deadlineDay": {
            "kind": "value",
            "value": 20
          }
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "estimateHours": {
            "kind": "value",
            "value": 8
          },
          "dueDay": {
            "kind": "value",
            "value": 20
          },
          "priority": {
            "kind": "value",
            "value": "urgent"
          },
          "owner": {
            "kind": "value",
            "value": "lin"
          }
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "estimateHours": {
            "kind": "value",
            "value": 8
          },
          "dueDay": {
            "kind": "value",
            "value": 18
          },
          "priority": {
            "kind": "value",
            "value": "normal"
          },
          "owner": {
            "kind": "value",
            "value": "chen"
          }
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    },
    "tombstones": {
      "nodes": [],
      "edges": []
    }
  },
  "diagnostics": [
    {
      "code": "task.owner_unavailable",
      "path": "/nodes/task-1/fields/owner",
      "message": "林无法接手，请选择其他负责人后续作。",
      "candidates": [
        {
          "value": "chen",
          "label": "陈",
          "message": "目前可接手（虚构候选）",
          "repairOps": [
            {
              "op": "set",
              "nodeId": "task-1",
              "path": "/owner",
              "value": "chen"
            }
          ]
        }
      ]
    }
  ]
}
```

远端调用：

```json
[
  {
    "method": "apply",
    "input": {
      "step": {
        "id": "project-1",
        "payload": {
          "title": "文档发布",
          "capacity_hours": 16,
          "deadline_day": 20
        },
        "effect": {
          "kind": "create",
          "nodeId": "project-1"
        }
      },
      "key": "[\"demo-run-1\",\"project-1\",0]"
    },
    "output": {
      "kind": "applied",
      "remoteRef": "resource-1"
    }
  },
  {
    "method": "apply",
    "input": {
      "step": {
        "id": "task-1",
        "payload": {
          "title": "编写快速入门",
          "estimate_hours": 8,
          "due_day": 20,
          "priority": "urgent",
          "assignee": "lin",
          "projectId": "resource-1"
        },
        "dependsOn": [
          "project-1"
        ],
        "inputRefs": {
          "projectId": "project-1"
        },
        "effect": {
          "kind": "create",
          "nodeId": "task-1"
        }
      },
      "key": "[\"demo-run-1\",\"task-1\",0]"
    },
    "output": {
      "kind": "not_applied",
      "reason": "Owner unavailable; request rejected before creation",
      "code": "OWNER_UNAVAILABLE",
      "message": "负责人暂不可用，任务未创建。",
      "diagnostics": [
        {
          "code": "task.owner_unavailable",
          "path": "/nodes/task-1/fields/owner",
          "message": "林无法接手，请选择其他负责人后续作。",
          "candidates": [
            {
              "value": "chen",
              "label": "陈",
              "message": "目前可接手（虚构候选）",
              "repairOps": [
                {
                  "op": "set",
                  "nodeId": "task-1",
                  "path": "/owner",
                  "value": "chen"
                }
              ]
            }
          ]
        }
      ]
    }
  }
]
```

## 10. getDraft

失败后 currentRunId 保留；pending 不意味着远端没有资源。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69"
]
```

输出：

```json
{
  "graph": {
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": "文档发布",
          "capacityHours": 16,
          "deadlineDay": 20
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": "编写快速入门",
          "estimateHours": 8,
          "dueDay": 20,
          "priority": "urgent",
          "owner": "lin"
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": "评审使用示例",
          "estimateHours": 8,
          "dueDay": 18,
          "priority": "normal",
          "owner": "chen"
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    }
  },
  "fieldIntents": {
    "project-1": {
      "/name": {
        "kind": "set",
        "value": "文档发布"
      },
      "/capacityHours": {
        "kind": "set",
        "value": 16
      },
      "/deadlineDay": {
        "kind": "set",
        "value": 20
      }
    },
    "task-1": {
      "/name": {
        "kind": "set",
        "value": "编写快速入门"
      },
      "/estimateHours": {
        "kind": "set",
        "value": 8
      },
      "/dueDay": {
        "kind": "set",
        "value": 20
      },
      "/priority": {
        "kind": "set",
        "value": "urgent"
      },
      "/owner": {
        "kind": "set",
        "value": "lin"
      }
    },
    "task-2": {
      "/name": {
        "kind": "set",
        "value": "评审使用示例"
      },
      "/estimateHours": {
        "kind": "set",
        "value": 8
      },
      "/dueDay": {
        "kind": "set",
        "value": 18
      },
      "/priority": {
        "kind": "set",
        "value": "normal"
      },
      "/owner": {
        "kind": "set",
        "value": "chen"
      }
    }
  },
  "formatVersion": 3,
  "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 4,
  "type": "example.project-tasks",
  "typeVersion": "2",
  "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
  "status": "pending",
  "currentRunId": "demo-run-1",
  "targetId": "mock:local",
  "initialSnapshot": {
    "graph": {
      "nodes": {
        "project-1": {
          "id": "project-1",
          "nodeType": "project",
          "fields": {
            "name": "文档发布",
            "capacityHours": 16,
            "deadlineDay": 20
          }
        },
        "task-1": {
          "id": "task-1",
          "nodeType": "task",
          "fields": {
            "name": "编写快速入门",
            "estimateHours": 12,
            "dueDay": 22,
            "priority": "urgent",
            "owner": null
          }
        },
        "task-2": {
          "id": "task-2",
          "nodeType": "task",
          "fields": {
            "name": "评审使用示例",
            "estimateHours": 10,
            "dueDay": 18,
            "priority": "normal",
            "owner": "chen"
          }
        }
      },
      "edges": {
        "contains-1": {
          "id": "contains-1",
          "relationType": "contains",
          "from": "project-1",
          "to": "task-1"
        },
        "contains-2": {
          "id": "contains-2",
          "relationType": "contains",
          "from": "project-1",
          "to": "task-2"
        }
      }
    },
    "fieldIntents": {
      "project-1": {
        "/name": {
          "kind": "set",
          "value": "文档发布"
        },
        "/capacityHours": {
          "kind": "set",
          "value": 16
        },
        "/deadlineDay": {
          "kind": "set",
          "value": 20
        }
      },
      "task-1": {
        "/name": {
          "kind": "set",
          "value": "编写快速入门"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 12
        },
        "/dueDay": {
          "kind": "set",
          "value": 22
        },
        "/priority": {
          "kind": "set",
          "value": "urgent"
        },
        "/owner": {
          "kind": "set",
          "value": null
        }
      },
      "task-2": {
        "/name": {
          "kind": "set",
          "value": "评审使用示例"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 10
        },
        "/dueDay": {
          "kind": "set",
          "value": 18
        },
        "/priority": {
          "kind": "set",
          "value": "normal"
        },
        "/owner": {
          "kind": "set",
          "value": "chen"
        }
      }
    }
  },
  "publishedArtifactId": null,
  "lastPublishedAt": null,
  "tombstones": {
    "nodes": [],
    "edges": []
  },
  "createdAt": "2026-09-16T07:00:33.359Z",
  "updatedAt": "2026-09-16T07:00:33.367Z"
}
```

远端调用：

```json
[]
```

## 11. edit

假设用户同意改由陈接手，只修复未完成任务。成功项目不允许修改。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69",
  4,
  [
    {
      "op": "set",
      "nodeId": "task-1",
      "path": "/owner",
      "value": "chen"
    }
  ]
]
```

输出：

```json
{
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 5,
  "preflightRequired": true,
  "changes": [
    {
      "opIndex": 0,
      "target": "field",
      "id": "task-1",
      "path": "/owner",
      "before": {
        "kind": "value",
        "value": "lin"
      },
      "after": {
        "kind": "value",
        "value": "chen"
      }
    }
  ]
}
```

远端调用：

```json
[]
```

## 12. resume

沿用同一 Run，重新检查修复；项目跳过，任务 1 用新请求 key 创建，任务 2 模拟超时。

输入：

```json
[
  "demo-run-1"
]
```

输出：

```json
{
  "id": "demo-run-1",
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "kind": "initial_create",
  "version": 5,
  "state": "unknown",
  "artifactId": "62fcb5f5-f4a6-48c1-8b4d-1ccfd475dabb",
  "initialArtifactId": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
  "certificate": "62fcb5f5-f4a6-48c1-8b4d-1ccfd475dabb",
  "revision": 1,
  "revisions": [
    {
      "artifactId": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
      "version": 4,
      "steps": [
        {
          "id": "project-1",
          "effect": {
            "kind": "create",
            "nodeId": "project-1"
          },
          "payload": {
            "title": "文档发布",
            "capacity_hours": 16,
            "deadline_day": 20
          },
          "key": "[\"demo-run-1\",\"project-1\",0]",
          "status": "applied",
          "resolvedPayload": {
            "title": "文档发布",
            "capacity_hours": 16,
            "deadline_day": 20
          },
          "feedback": {},
          "remoteRef": "resource-1"
        },
        {
          "id": "task-1",
          "effect": {
            "kind": "create",
            "nodeId": "task-1"
          },
          "payload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "lin"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "key": "[\"demo-run-1\",\"task-1\",0]",
          "status": "ready",
          "resolvedPayload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "lin",
            "projectId": "resource-1"
          },
          "feedback": {
            "code": "OWNER_UNAVAILABLE",
            "message": "负责人暂不可用，任务未创建。",
            "diagnostics": [
              {
                "code": "task.owner_unavailable",
                "path": "/nodes/task-1/fields/owner",
                "message": "林无法接手，请选择其他负责人后续作。",
                "candidates": [
                  {
                    "value": "chen",
                    "label": "陈",
                    "message": "目前可接手（虚构候选）",
                    "repairOps": [
                      {
                        "op": "set",
                        "nodeId": "task-1",
                        "path": "/owner",
                        "value": "chen"
                      }
                    ]
                  }
                ]
              }
            ],
            "reason": "Owner unavailable; request rejected before creation"
          }
        },
        {
          "id": "task-2",
          "effect": {
            "kind": "create",
            "nodeId": "task-2"
          },
          "payload": {
            "title": "评审使用示例",
            "estimate_hours": 8,
            "due_day": 18,
            "priority": "normal",
            "assignee": "chen"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "key": "[\"demo-run-1\",\"task-2\",0]",
          "status": "ready"
        }
      ]
    }
  ],
  "attempts": [
    {
      "stepId": "project-1",
      "key": "[\"demo-run-1\",\"project-1\",0]",
      "number": 1,
      "input": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "request": {
        "step": {
          "id": "project-1",
          "payload": {
            "title": "文档发布",
            "capacity_hours": 16,
            "deadline_day": 20
          },
          "effect": {
            "kind": "create",
            "nodeId": "project-1"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "applied",
      "outcome": {
        "kind": "applied",
        "remoteRef": "resource-1"
      }
    },
    {
      "stepId": "task-1",
      "key": "[\"demo-run-1\",\"task-1\",0]",
      "number": 2,
      "input": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "lin",
        "projectId": "resource-1"
      },
      "request": {
        "step": {
          "id": "task-1",
          "payload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "lin",
            "projectId": "resource-1"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "effect": {
            "kind": "create",
            "nodeId": "task-1"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "no_effect",
      "outcome": {
        "kind": "not_applied",
        "reason": "Owner unavailable; request rejected before creation",
        "retryable": false,
        "code": "OWNER_UNAVAILABLE",
        "message": "负责人暂不可用，任务未创建。",
        "diagnostics": [
          {
            "code": "task.owner_unavailable",
            "path": "/nodes/task-1/fields/owner",
            "message": "林无法接手，请选择其他负责人后续作。",
            "candidates": [
              {
                "value": "chen",
                "label": "陈",
                "message": "目前可接手（虚构候选）",
                "repairOps": [
                  {
                    "op": "set",
                    "nodeId": "task-1",
                    "path": "/owner",
                    "value": "chen"
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      "stepId": "task-1",
      "key": "[\"demo-run-1\",\"task-1\",1]",
      "number": 3,
      "input": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "chen",
        "projectId": "resource-1"
      },
      "request": {
        "step": {
          "id": "task-1",
          "payload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "chen",
            "projectId": "resource-1"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "effect": {
            "kind": "create",
            "nodeId": "task-1"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "applied",
      "outcome": {
        "kind": "applied",
        "remoteRef": "resource-2"
      }
    },
    {
      "stepId": "task-2",
      "key": "[\"demo-run-1\",\"task-2\",0]",
      "number": 4,
      "input": {
        "title": "评审使用示例",
        "estimate_hours": 8,
        "due_day": 18,
        "priority": "normal",
        "assignee": "chen",
        "projectId": "resource-1"
      },
      "request": {
        "step": {
          "id": "task-2",
          "payload": {
            "title": "评审使用示例",
            "estimate_hours": 8,
            "due_day": 18,
            "priority": "normal",
            "assignee": "chen",
            "projectId": "resource-1"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "effect": {
            "kind": "create",
            "nodeId": "task-2"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "unknown",
      "outcome": {
        "kind": "unknown",
        "reason": "Response timed out; creation outcome requires lookup",
        "code": "TIMEOUT",
        "message": "请求超时，先查证这次请求是否已成功。"
      }
    }
  ],
  "events": [
    {
      "sequence": 1,
      "stepId": "project-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.370Z"
    },
    {
      "sequence": 2,
      "stepId": "project-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T07:00:33.371Z"
    },
    {
      "sequence": 3,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.372Z"
    },
    {
      "sequence": 4,
      "stepId": "task-1",
      "kind": "not_applied",
      "recordedAt": "2026-09-16T07:00:33.372Z",
      "reason": "Owner unavailable; request rejected before creation"
    },
    {
      "sequence": 5,
      "stepId": "",
      "kind": "plan_repaired",
      "recordedAt": "2026-09-16T07:00:33.376Z"
    },
    {
      "sequence": 6,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.377Z"
    },
    {
      "sequence": 7,
      "stepId": "task-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T07:00:33.377Z"
    },
    {
      "sequence": 8,
      "stepId": "task-2",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.378Z"
    },
    {
      "sequence": 9,
      "stepId": "task-2",
      "kind": "unknown",
      "recordedAt": "2026-09-16T07:00:33.378Z",
      "reason": "Response timed out; creation outcome requires lookup"
    }
  ],
  "steps": [
    {
      "id": "project-1",
      "effect": {
        "kind": "create",
        "nodeId": "project-1"
      },
      "payload": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "key": "[\"demo-run-1\",\"project-1\",0]",
      "status": "applied",
      "resolvedPayload": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "feedback": {},
      "remoteRef": "resource-1"
    },
    {
      "id": "task-1",
      "effect": {
        "kind": "create",
        "nodeId": "task-1"
      },
      "payload": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "chen"
      },
      "dependsOn": [
        "project-1"
      ],
      "inputRefs": {
        "projectId": "project-1"
      },
      "key": "[\"demo-run-1\",\"task-1\",1]",
      "status": "applied",
      "requestRevision": 1,
      "resolvedPayload": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "chen",
        "projectId": "resource-1"
      },
      "feedback": {},
      "remoteRef": "resource-2"
    },
    {
      "id": "task-2",
      "effect": {
        "kind": "create",
        "nodeId": "task-2"
      },
      "payload": {
        "title": "评审使用示例",
        "estimate_hours": 8,
        "due_day": 18,
        "priority": "normal",
        "assignee": "chen"
      },
      "dependsOn": [
        "project-1"
      ],
      "inputRefs": {
        "projectId": "project-1"
      },
      "key": "[\"demo-run-1\",\"task-2\",0]",
      "status": "unknown",
      "resolvedPayload": {
        "title": "评审使用示例",
        "estimate_hours": 8,
        "due_day": 18,
        "priority": "normal",
        "assignee": "chen",
        "projectId": "resource-1"
      },
      "feedback": {
        "code": "TIMEOUT",
        "message": "请求超时，先查证这次请求是否已成功。",
        "reason": "Response timed out; creation outcome requires lookup"
      }
    }
  ],
  "previewVersion": 5,
  "preview": {
    "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
    "version": 5,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": {
            "kind": "value",
            "value": "文档发布"
          },
          "capacityHours": {
            "kind": "value",
            "value": 16
          },
          "deadlineDay": {
            "kind": "value",
            "value": 20
          }
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "estimateHours": {
            "kind": "value",
            "value": 8
          },
          "dueDay": {
            "kind": "value",
            "value": 20
          },
          "priority": {
            "kind": "value",
            "value": "urgent"
          },
          "owner": {
            "kind": "value",
            "value": "chen"
          }
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "estimateHours": {
            "kind": "value",
            "value": 8
          },
          "dueDay": {
            "kind": "value",
            "value": 18
          },
          "priority": {
            "kind": "value",
            "value": "normal"
          },
          "owner": {
            "kind": "value",
            "value": "chen"
          }
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    },
    "tombstones": {
      "nodes": [],
      "edges": []
    }
  },
  "diagnostics": [
    {
      "code": "TIMEOUT",
      "path": "/nodes/task-2",
      "message": "请求超时，先查证这次请求是否已成功。"
    }
  ]
}
```

远端调用：

```json
[
  {
    "method": "apply",
    "input": {
      "step": {
        "id": "task-1",
        "payload": {
          "title": "编写快速入门",
          "estimate_hours": 8,
          "due_day": 20,
          "priority": "urgent",
          "assignee": "chen",
          "projectId": "resource-1"
        },
        "dependsOn": [
          "project-1"
        ],
        "inputRefs": {
          "projectId": "project-1"
        },
        "effect": {
          "kind": "create",
          "nodeId": "task-1"
        }
      },
      "key": "[\"demo-run-1\",\"task-1\",1]"
    },
    "output": {
      "kind": "applied",
      "remoteRef": "resource-2"
    }
  },
  {
    "method": "apply",
    "input": {
      "step": {
        "id": "task-2",
        "payload": {
          "title": "评审使用示例",
          "estimate_hours": 8,
          "due_day": 18,
          "priority": "normal",
          "assignee": "chen",
          "projectId": "resource-1"
        },
        "dependsOn": [
          "project-1"
        ],
        "inputRefs": {
          "projectId": "project-1"
        },
        "effect": {
          "kind": "create",
          "nodeId": "task-2"
        }
      },
      "key": "[\"demo-run-1\",\"task-2\",0]"
    },
    "output": {
      "kind": "unknown",
      "reason": "Response timed out; creation outcome requires lookup",
      "code": "TIMEOUT",
      "message": "请求超时，先查证这次请求是否已成功。"
    }
  }
]
```

## 13. resume

只查证任务 2 的原请求，确认成功后收尾；没有再次 apply。Draft 变 published，保留成功 Artifact。

输入：

```json
[
  "demo-run-1"
]
```

输出：

```json
{
  "id": "demo-run-1",
  "draftId": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "kind": "initial_create",
  "version": 5,
  "state": "published",
  "artifactId": "62fcb5f5-f4a6-48c1-8b4d-1ccfd475dabb",
  "initialArtifactId": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
  "certificate": "62fcb5f5-f4a6-48c1-8b4d-1ccfd475dabb",
  "revision": 1,
  "revisions": [
    {
      "artifactId": "0ea1e10a-01fa-4f5a-acd3-245dd4022f4b",
      "version": 4,
      "steps": [
        {
          "id": "project-1",
          "effect": {
            "kind": "create",
            "nodeId": "project-1"
          },
          "payload": {
            "title": "文档发布",
            "capacity_hours": 16,
            "deadline_day": 20
          },
          "key": "[\"demo-run-1\",\"project-1\",0]",
          "status": "applied",
          "resolvedPayload": {
            "title": "文档发布",
            "capacity_hours": 16,
            "deadline_day": 20
          },
          "feedback": {},
          "remoteRef": "resource-1"
        },
        {
          "id": "task-1",
          "effect": {
            "kind": "create",
            "nodeId": "task-1"
          },
          "payload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "lin"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "key": "[\"demo-run-1\",\"task-1\",0]",
          "status": "ready",
          "resolvedPayload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "lin",
            "projectId": "resource-1"
          },
          "feedback": {
            "code": "OWNER_UNAVAILABLE",
            "message": "负责人暂不可用，任务未创建。",
            "diagnostics": [
              {
                "code": "task.owner_unavailable",
                "path": "/nodes/task-1/fields/owner",
                "message": "林无法接手，请选择其他负责人后续作。",
                "candidates": [
                  {
                    "value": "chen",
                    "label": "陈",
                    "message": "目前可接手（虚构候选）",
                    "repairOps": [
                      {
                        "op": "set",
                        "nodeId": "task-1",
                        "path": "/owner",
                        "value": "chen"
                      }
                    ]
                  }
                ]
              }
            ],
            "reason": "Owner unavailable; request rejected before creation"
          }
        },
        {
          "id": "task-2",
          "effect": {
            "kind": "create",
            "nodeId": "task-2"
          },
          "payload": {
            "title": "评审使用示例",
            "estimate_hours": 8,
            "due_day": 18,
            "priority": "normal",
            "assignee": "chen"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "key": "[\"demo-run-1\",\"task-2\",0]",
          "status": "ready"
        }
      ]
    }
  ],
  "attempts": [
    {
      "stepId": "project-1",
      "key": "[\"demo-run-1\",\"project-1\",0]",
      "number": 1,
      "input": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "request": {
        "step": {
          "id": "project-1",
          "payload": {
            "title": "文档发布",
            "capacity_hours": 16,
            "deadline_day": 20
          },
          "effect": {
            "kind": "create",
            "nodeId": "project-1"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "applied",
      "outcome": {
        "kind": "applied",
        "remoteRef": "resource-1"
      }
    },
    {
      "stepId": "task-1",
      "key": "[\"demo-run-1\",\"task-1\",0]",
      "number": 2,
      "input": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "lin",
        "projectId": "resource-1"
      },
      "request": {
        "step": {
          "id": "task-1",
          "payload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "lin",
            "projectId": "resource-1"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "effect": {
            "kind": "create",
            "nodeId": "task-1"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "no_effect",
      "outcome": {
        "kind": "not_applied",
        "reason": "Owner unavailable; request rejected before creation",
        "retryable": false,
        "code": "OWNER_UNAVAILABLE",
        "message": "负责人暂不可用，任务未创建。",
        "diagnostics": [
          {
            "code": "task.owner_unavailable",
            "path": "/nodes/task-1/fields/owner",
            "message": "林无法接手，请选择其他负责人后续作。",
            "candidates": [
              {
                "value": "chen",
                "label": "陈",
                "message": "目前可接手（虚构候选）",
                "repairOps": [
                  {
                    "op": "set",
                    "nodeId": "task-1",
                    "path": "/owner",
                    "value": "chen"
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      "stepId": "task-1",
      "key": "[\"demo-run-1\",\"task-1\",1]",
      "number": 3,
      "input": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "chen",
        "projectId": "resource-1"
      },
      "request": {
        "step": {
          "id": "task-1",
          "payload": {
            "title": "编写快速入门",
            "estimate_hours": 8,
            "due_day": 20,
            "priority": "urgent",
            "assignee": "chen",
            "projectId": "resource-1"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "effect": {
            "kind": "create",
            "nodeId": "task-1"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "applied",
      "outcome": {
        "kind": "applied",
        "remoteRef": "resource-2"
      }
    },
    {
      "stepId": "task-2",
      "key": "[\"demo-run-1\",\"task-2\",0]",
      "number": 4,
      "input": {
        "title": "评审使用示例",
        "estimate_hours": 8,
        "due_day": 18,
        "priority": "normal",
        "assignee": "chen",
        "projectId": "resource-1"
      },
      "request": {
        "step": {
          "id": "task-2",
          "payload": {
            "title": "评审使用示例",
            "estimate_hours": 8,
            "due_day": 18,
            "priority": "normal",
            "assignee": "chen",
            "projectId": "resource-1"
          },
          "dependsOn": [
            "project-1"
          ],
          "inputRefs": {
            "projectId": "project-1"
          },
          "effect": {
            "kind": "create",
            "nodeId": "task-2"
          }
        },
        "target": "mock:local",
        "executorId": "example.project-service",
        "executorVersion": "5"
      },
      "status": "applied",
      "outcome": {
        "kind": "applied",
        "remoteRef": "resource-3"
      }
    }
  ],
  "events": [
    {
      "sequence": 1,
      "stepId": "project-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.370Z"
    },
    {
      "sequence": 2,
      "stepId": "project-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T07:00:33.371Z"
    },
    {
      "sequence": 3,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.372Z"
    },
    {
      "sequence": 4,
      "stepId": "task-1",
      "kind": "not_applied",
      "recordedAt": "2026-09-16T07:00:33.372Z",
      "reason": "Owner unavailable; request rejected before creation"
    },
    {
      "sequence": 5,
      "stepId": "",
      "kind": "plan_repaired",
      "recordedAt": "2026-09-16T07:00:33.376Z"
    },
    {
      "sequence": 6,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.377Z"
    },
    {
      "sequence": 7,
      "stepId": "task-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T07:00:33.377Z"
    },
    {
      "sequence": 8,
      "stepId": "task-2",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T07:00:33.378Z"
    },
    {
      "sequence": 9,
      "stepId": "task-2",
      "kind": "unknown",
      "recordedAt": "2026-09-16T07:00:33.378Z",
      "reason": "Response timed out; creation outcome requires lookup"
    },
    {
      "sequence": 10,
      "stepId": "task-2",
      "kind": "reconciling",
      "recordedAt": "2026-09-16T07:00:33.380Z"
    },
    {
      "sequence": 11,
      "stepId": "task-2",
      "kind": "applied",
      "recordedAt": "2026-09-16T07:00:33.381Z"
    }
  ],
  "steps": [
    {
      "id": "project-1",
      "effect": {
        "kind": "create",
        "nodeId": "project-1"
      },
      "payload": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "key": "[\"demo-run-1\",\"project-1\",0]",
      "status": "applied",
      "resolvedPayload": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      },
      "feedback": {},
      "remoteRef": "resource-1"
    },
    {
      "id": "task-1",
      "effect": {
        "kind": "create",
        "nodeId": "task-1"
      },
      "payload": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "chen"
      },
      "dependsOn": [
        "project-1"
      ],
      "inputRefs": {
        "projectId": "project-1"
      },
      "key": "[\"demo-run-1\",\"task-1\",1]",
      "status": "applied",
      "requestRevision": 1,
      "resolvedPayload": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "chen",
        "projectId": "resource-1"
      },
      "feedback": {},
      "remoteRef": "resource-2"
    },
    {
      "id": "task-2",
      "effect": {
        "kind": "create",
        "nodeId": "task-2"
      },
      "payload": {
        "title": "评审使用示例",
        "estimate_hours": 8,
        "due_day": 18,
        "priority": "normal",
        "assignee": "chen"
      },
      "dependsOn": [
        "project-1"
      ],
      "inputRefs": {
        "projectId": "project-1"
      },
      "key": "[\"demo-run-1\",\"task-2\",0]",
      "status": "applied",
      "resolvedPayload": {
        "title": "评审使用示例",
        "estimate_hours": 8,
        "due_day": 18,
        "priority": "normal",
        "assignee": "chen",
        "projectId": "resource-1"
      },
      "feedback": {},
      "remoteRef": "resource-3"
    }
  ],
  "previewVersion": 5,
  "preview": {
    "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
    "version": 5,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": {
            "kind": "value",
            "value": "文档发布"
          },
          "capacityHours": {
            "kind": "value",
            "value": 16
          },
          "deadlineDay": {
            "kind": "value",
            "value": 20
          }
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "estimateHours": {
            "kind": "value",
            "value": 8
          },
          "dueDay": {
            "kind": "value",
            "value": 20
          },
          "priority": {
            "kind": "value",
            "value": "urgent"
          },
          "owner": {
            "kind": "value",
            "value": "chen"
          }
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "estimateHours": {
            "kind": "value",
            "value": 8
          },
          "dueDay": {
            "kind": "value",
            "value": 18
          },
          "priority": {
            "kind": "value",
            "value": "normal"
          },
          "owner": {
            "kind": "value",
            "value": "chen"
          }
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    },
    "tombstones": {
      "nodes": [],
      "edges": []
    }
  },
  "diagnostics": []
}
```

远端调用：

```json
[
  {
    "method": "reconcile",
    "input": {
      "step": {
        "id": "task-2",
        "payload": {
          "title": "评审使用示例",
          "estimate_hours": 8,
          "due_day": 18,
          "priority": "normal",
          "assignee": "chen",
          "projectId": "resource-1"
        },
        "dependsOn": [
          "project-1"
        ],
        "inputRefs": {
          "projectId": "project-1"
        },
        "effect": {
          "kind": "create",
          "nodeId": "task-2"
        }
      },
      "key": "[\"demo-run-1\",\"task-2\",0]"
    },
    "output": {
      "kind": "applied",
      "remoteRef": "resource-3"
    }
  }
]
```

## 14. getDraft

全部成功才设置 published、publishedArtifactId 和 lastPublishedAt。currentRunId 仍保留。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69"
]
```

输出：

```json
{
  "graph": {
    "nodes": {
      "project-1": {
        "id": "project-1",
        "nodeType": "project",
        "fields": {
          "name": "文档发布",
          "capacityHours": 16,
          "deadlineDay": 20
        }
      },
      "task-1": {
        "id": "task-1",
        "nodeType": "task",
        "fields": {
          "name": "编写快速入门",
          "estimateHours": 8,
          "dueDay": 20,
          "priority": "urgent",
          "owner": "chen"
        }
      },
      "task-2": {
        "id": "task-2",
        "nodeType": "task",
        "fields": {
          "name": "评审使用示例",
          "estimateHours": 8,
          "dueDay": 18,
          "priority": "normal",
          "owner": "chen"
        }
      }
    },
    "edges": {
      "contains-1": {
        "id": "contains-1",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-1"
      },
      "contains-2": {
        "id": "contains-2",
        "relationType": "contains",
        "from": "project-1",
        "to": "task-2"
      }
    }
  },
  "fieldIntents": {
    "project-1": {
      "/name": {
        "kind": "set",
        "value": "文档发布"
      },
      "/capacityHours": {
        "kind": "set",
        "value": 16
      },
      "/deadlineDay": {
        "kind": "set",
        "value": 20
      }
    },
    "task-1": {
      "/name": {
        "kind": "set",
        "value": "编写快速入门"
      },
      "/estimateHours": {
        "kind": "set",
        "value": 8
      },
      "/dueDay": {
        "kind": "set",
        "value": 20
      },
      "/priority": {
        "kind": "set",
        "value": "urgent"
      },
      "/owner": {
        "kind": "set",
        "value": "chen"
      }
    },
    "task-2": {
      "/name": {
        "kind": "set",
        "value": "评审使用示例"
      },
      "/estimateHours": {
        "kind": "set",
        "value": 8
      },
      "/dueDay": {
        "kind": "set",
        "value": 18
      },
      "/priority": {
        "kind": "set",
        "value": "normal"
      },
      "/owner": {
        "kind": "set",
        "value": "chen"
      }
    }
  },
  "formatVersion": 3,
  "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
  "version": 5,
  "type": "example.project-tasks",
  "typeVersion": "2",
  "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
  "status": "published",
  "currentRunId": "demo-run-1",
  "targetId": "mock:local",
  "initialSnapshot": {
    "graph": {
      "nodes": {
        "project-1": {
          "id": "project-1",
          "nodeType": "project",
          "fields": {
            "name": "文档发布",
            "capacityHours": 16,
            "deadlineDay": 20
          }
        },
        "task-1": {
          "id": "task-1",
          "nodeType": "task",
          "fields": {
            "name": "编写快速入门",
            "estimateHours": 12,
            "dueDay": 22,
            "priority": "urgent",
            "owner": null
          }
        },
        "task-2": {
          "id": "task-2",
          "nodeType": "task",
          "fields": {
            "name": "评审使用示例",
            "estimateHours": 10,
            "dueDay": 18,
            "priority": "normal",
            "owner": "chen"
          }
        }
      },
      "edges": {
        "contains-1": {
          "id": "contains-1",
          "relationType": "contains",
          "from": "project-1",
          "to": "task-1"
        },
        "contains-2": {
          "id": "contains-2",
          "relationType": "contains",
          "from": "project-1",
          "to": "task-2"
        }
      }
    },
    "fieldIntents": {
      "project-1": {
        "/name": {
          "kind": "set",
          "value": "文档发布"
        },
        "/capacityHours": {
          "kind": "set",
          "value": 16
        },
        "/deadlineDay": {
          "kind": "set",
          "value": 20
        }
      },
      "task-1": {
        "/name": {
          "kind": "set",
          "value": "编写快速入门"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 12
        },
        "/dueDay": {
          "kind": "set",
          "value": 22
        },
        "/priority": {
          "kind": "set",
          "value": "urgent"
        },
        "/owner": {
          "kind": "set",
          "value": null
        }
      },
      "task-2": {
        "/name": {
          "kind": "set",
          "value": "评审使用示例"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 10
        },
        "/dueDay": {
          "kind": "set",
          "value": 18
        },
        "/priority": {
          "kind": "set",
          "value": "normal"
        },
        "/owner": {
          "kind": "set",
          "value": "chen"
        }
      }
    }
  },
  "publishedArtifactId": "62fcb5f5-f4a6-48c1-8b4d-1ccfd475dabb",
  "lastPublishedAt": "2026-09-16T07:00:33.382Z",
  "tombstones": {
    "nodes": [],
    "edges": []
  },
  "createdAt": "2026-09-16T07:00:33.359Z",
  "updatedAt": "2026-09-16T07:00:33.382Z"
}
```

远端调用：

```json
[]
```

## 15. getBindings

每个成功节点都已绑定远端资源；这些是确认事实，不是远端实时漂移检测。

输入：

```json
[
  "70a102a9-1007-4159-8aeb-80d03f797a69"
]
```

输出：

```json
{
  "project-1": {
    "nodeId": "project-1",
    "targetId": "mock:local",
    "remoteId": "resource-1",
    "runId": "demo-run-1",
    "stepId": "project-1",
    "key": "[\"demo-run-1\",\"project-1\",0]",
    "attemptNumber": 1,
    "input": {
      "title": "文档发布",
      "capacity_hours": 16,
      "deadline_day": 20
    }
  },
  "task-1": {
    "nodeId": "task-1",
    "targetId": "mock:local",
    "remoteId": "resource-2",
    "runId": "demo-run-1",
    "stepId": "task-1",
    "key": "[\"demo-run-1\",\"task-1\",1]",
    "attemptNumber": 3,
    "input": {
      "title": "编写快速入门",
      "estimate_hours": 8,
      "due_day": 20,
      "priority": "urgent",
      "assignee": "chen",
      "projectId": "resource-1"
    }
  },
  "task-2": {
    "nodeId": "task-2",
    "targetId": "mock:local",
    "remoteId": "resource-3",
    "runId": "demo-run-1",
    "stepId": "task-2",
    "key": "[\"demo-run-1\",\"task-2\",0]",
    "attemptNumber": 4,
    "input": {
      "title": "评审使用示例",
      "estimate_hours": 8,
      "due_day": 18,
      "priority": "normal",
      "assignee": "chen",
      "projectId": "resource-1"
    }
  }
}
```

远端调用：

```json
[]
```

## 16. getRunInput

Run 当前采用的意图与计划；旧产物仍可用 revisions 中的 artifactId 查询。

输入：

```json
[
  "demo-run-1"
]
```

输出：

```json
{
  "id": "62fcb5f5-f4a6-48c1-8b4d-1ccfd475dabb",
  "intentDigest": "sha256:stagedwrite-json-v1:733962fd9cbccc460c1183cc4a07667ccdcb077d314378610d91408a5756706f",
  "draft": {
    "graph": {
      "nodes": {
        "project-1": {
          "id": "project-1",
          "nodeType": "project",
          "fields": {
            "name": "文档发布",
            "capacityHours": 16,
            "deadlineDay": 20
          }
        },
        "task-1": {
          "id": "task-1",
          "nodeType": "task",
          "fields": {
            "name": "编写快速入门",
            "estimateHours": 8,
            "dueDay": 20,
            "priority": "urgent",
            "owner": "chen"
          }
        },
        "task-2": {
          "id": "task-2",
          "nodeType": "task",
          "fields": {
            "name": "评审使用示例",
            "estimateHours": 8,
            "dueDay": 18,
            "priority": "normal",
            "owner": "chen"
          }
        }
      },
      "edges": {
        "contains-1": {
          "id": "contains-1",
          "relationType": "contains",
          "from": "project-1",
          "to": "task-1"
        },
        "contains-2": {
          "id": "contains-2",
          "relationType": "contains",
          "from": "project-1",
          "to": "task-2"
        }
      }
    },
    "fieldIntents": {
      "project-1": {
        "/name": {
          "kind": "set",
          "value": "文档发布"
        },
        "/capacityHours": {
          "kind": "set",
          "value": 16
        },
        "/deadlineDay": {
          "kind": "set",
          "value": 20
        }
      },
      "task-1": {
        "/name": {
          "kind": "set",
          "value": "编写快速入门"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 8
        },
        "/dueDay": {
          "kind": "set",
          "value": 20
        },
        "/priority": {
          "kind": "set",
          "value": "urgent"
        },
        "/owner": {
          "kind": "set",
          "value": "chen"
        }
      },
      "task-2": {
        "/name": {
          "kind": "set",
          "value": "评审使用示例"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 8
        },
        "/dueDay": {
          "kind": "set",
          "value": 18
        },
        "/priority": {
          "kind": "set",
          "value": "normal"
        },
        "/owner": {
          "kind": "set",
          "value": "chen"
        }
      }
    },
    "formatVersion": 3,
    "id": "70a102a9-1007-4159-8aeb-80d03f797a69",
    "version": 5,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "status": "pending",
    "currentRunId": "demo-run-1",
    "targetId": "mock:local",
    "initialSnapshot": {
      "graph": {
        "nodes": {
          "project-1": {
            "id": "project-1",
            "nodeType": "project",
            "fields": {
              "name": "文档发布",
              "capacityHours": 16,
              "deadlineDay": 20
            }
          },
          "task-1": {
            "id": "task-1",
            "nodeType": "task",
            "fields": {
              "name": "编写快速入门",
              "estimateHours": 12,
              "dueDay": 22,
              "priority": "urgent",
              "owner": null
            }
          },
          "task-2": {
            "id": "task-2",
            "nodeType": "task",
            "fields": {
              "name": "评审使用示例",
              "estimateHours": 10,
              "dueDay": 18,
              "priority": "normal",
              "owner": "chen"
            }
          }
        },
        "edges": {
          "contains-1": {
            "id": "contains-1",
            "relationType": "contains",
            "from": "project-1",
            "to": "task-1"
          },
          "contains-2": {
            "id": "contains-2",
            "relationType": "contains",
            "from": "project-1",
            "to": "task-2"
          }
        }
      },
      "fieldIntents": {
        "project-1": {
          "/name": {
            "kind": "set",
            "value": "文档发布"
          },
          "/capacityHours": {
            "kind": "set",
            "value": 16
          },
          "/deadlineDay": {
            "kind": "set",
            "value": 20
          }
        },
        "task-1": {
          "/name": {
            "kind": "set",
            "value": "编写快速入门"
          },
          "/estimateHours": {
            "kind": "set",
            "value": 12
          },
          "/dueDay": {
            "kind": "set",
            "value": 22
          },
          "/priority": {
            "kind": "set",
            "value": "urgent"
          },
          "/owner": {
            "kind": "set",
            "value": null
          }
        },
        "task-2": {
          "/name": {
            "kind": "set",
            "value": "评审使用示例"
          },
          "/estimateHours": {
            "kind": "set",
            "value": 10
          },
          "/dueDay": {
            "kind": "set",
            "value": 18
          },
          "/priority": {
            "kind": "set",
            "value": "normal"
          },
          "/owner": {
            "kind": "set",
            "value": "chen"
          }
        }
      }
    },
    "publishedArtifactId": null,
    "lastPublishedAt": null,
    "tombstones": {
      "nodes": [],
      "edges": []
    },
    "createdAt": "2026-09-16T07:00:33.359Z",
    "updatedAt": "2026-09-16T07:00:33.373Z"
  },
  "plan": [
    {
      "id": "project-1",
      "effect": {
        "kind": "create",
        "nodeId": "project-1"
      },
      "payload": {
        "title": "文档发布",
        "capacity_hours": 16,
        "deadline_day": 20
      }
    },
    {
      "id": "task-1",
      "effect": {
        "kind": "create",
        "nodeId": "task-1"
      },
      "payload": {
        "title": "编写快速入门",
        "estimate_hours": 8,
        "due_day": 20,
        "priority": "urgent",
        "assignee": "chen"
      },
      "dependsOn": [
        "project-1"
      ],
      "inputRefs": {
        "projectId": "project-1"
      }
    },
    {
      "id": "task-2",
      "effect": {
        "kind": "create",
        "nodeId": "task-2"
      },
      "payload": {
        "title": "评审使用示例",
        "estimate_hours": 8,
        "due_day": 18,
        "priority": "normal",
        "assignee": "chen"
      },
      "dependsOn": [
        "project-1"
      ],
      "inputRefs": {
        "projectId": "project-1"
      }
    }
  ],
  "binding": {
    "checkId": "356757b3-5e72-4ff2-8cc8-e6b2f1634e20",
    "definitionDigest": "sha256:stagedwrite-json-v1:e35b00c507a2094ac016898c6eece10559c0daf1358fab06349f32798749a6b7",
    "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
    "executorId": "example.project-service",
    "executorVersion": "5",
    "target": "mock:local",
    "planDigest": "sha256:stagedwrite-json-v1:8f4ddca9b6810fc7cd58cfd5e9a14b6a1e619e96ed89fca6254dbeae2889c45f"
  },
  "resourceRevision": 1
}
```

远端调用：

```json
[]
```
