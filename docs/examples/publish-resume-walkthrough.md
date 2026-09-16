# 当前协议的真实输入输出

实际执行库、SQLite 与断言；远端是 Mock，无 HTTP/LLM 调用。运行时间 2026-09-16T12:09:17.226Z。

[交互 HTML](publish-resume.html) · [完整 JSON](publish-resume-trace.json) · [源码](../../examples/publish-and-resume.ts)

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
    "roots": [
      {
        "nodeType": "project",
        "fields": {
          "name": "文档发布",
          "capacityHours": 16,
          "deadlineDay": 20
        },
        "relations": {
          "contains": [
            {
              "nodeType": "task",
              "fields": {
                "name": "编写快速入门",
                "estimateHours": 12,
                "dueDay": 22,
                "priority": "urgent",
                "owner": null
              }
            },
            {
              "nodeType": "task",
              "fields": {
                "name": "评审使用示例",
                "estimateHours": 10,
                "dueDay": 18,
                "priority": "normal",
                "owner": "chen"
              }
            }
          ]
        }
      }
    ]
  }
]
```

输出：

```json
{
  "draft": {
    "graph": {
      "nodes": {
        "node_00000000-0000-4000-8000-000000000003": {
          "id": "node_00000000-0000-4000-8000-000000000003",
          "nodeType": "project",
          "fields": {
            "name": "文档发布",
            "capacityHours": 16,
            "deadlineDay": 20
          }
        },
        "node_00000000-0000-4000-8000-000000000004": {
          "id": "node_00000000-0000-4000-8000-000000000004",
          "nodeType": "task",
          "fields": {
            "name": "编写快速入门",
            "estimateHours": 12,
            "dueDay": 22,
            "priority": "urgent",
            "owner": null
          }
        },
        "node_00000000-0000-4000-8000-000000000006": {
          "id": "node_00000000-0000-4000-8000-000000000006",
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
        "edge_00000000-0000-4000-8000-000000000005": {
          "id": "edge_00000000-0000-4000-8000-000000000005",
          "from": "node_00000000-0000-4000-8000-000000000003",
          "to": "node_00000000-0000-4000-8000-000000000004",
          "relationType": "contains"
        },
        "edge_00000000-0000-4000-8000-000000000007": {
          "id": "edge_00000000-0000-4000-8000-000000000007",
          "from": "node_00000000-0000-4000-8000-000000000003",
          "to": "node_00000000-0000-4000-8000-000000000006",
          "relationType": "contains"
        }
      }
    },
    "fieldIntents": {
      "node_00000000-0000-4000-8000-000000000003": {
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
      "node_00000000-0000-4000-8000-000000000004": {
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
      "node_00000000-0000-4000-8000-000000000006": {
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
    "tombstones": {
      "nodes": [],
      "edges": []
    },
    "formatVersion": 3,
    "id": "00000000-0000-4000-8000-000000000002",
    "version": 0,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "status": "pending",
    "currentRunId": null,
    "targetId": null,
    "initialSnapshot": {
      "graph": {
        "nodes": {
          "node_00000000-0000-4000-8000-000000000003": {
            "id": "node_00000000-0000-4000-8000-000000000003",
            "nodeType": "project",
            "fields": {
              "name": "文档发布",
              "capacityHours": 16,
              "deadlineDay": 20
            }
          },
          "node_00000000-0000-4000-8000-000000000004": {
            "id": "node_00000000-0000-4000-8000-000000000004",
            "nodeType": "task",
            "fields": {
              "name": "编写快速入门",
              "estimateHours": 12,
              "dueDay": 22,
              "priority": "urgent",
              "owner": null
            }
          },
          "node_00000000-0000-4000-8000-000000000006": {
            "id": "node_00000000-0000-4000-8000-000000000006",
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
          "edge_00000000-0000-4000-8000-000000000005": {
            "id": "edge_00000000-0000-4000-8000-000000000005",
            "from": "node_00000000-0000-4000-8000-000000000003",
            "to": "node_00000000-0000-4000-8000-000000000004",
            "relationType": "contains"
          },
          "edge_00000000-0000-4000-8000-000000000007": {
            "id": "edge_00000000-0000-4000-8000-000000000007",
            "from": "node_00000000-0000-4000-8000-000000000003",
            "to": "node_00000000-0000-4000-8000-000000000006",
            "relationType": "contains"
          }
        }
      },
      "fieldIntents": {
        "node_00000000-0000-4000-8000-000000000003": {
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
        "node_00000000-0000-4000-8000-000000000004": {
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
        "node_00000000-0000-4000-8000-000000000006": {
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
    "createdAt": "2026-09-16T12:09:17.186Z",
    "updatedAt": "2026-09-16T12:09:17.186Z"
  },
  "createdRefs": [
    {
      "path": "/roots/0",
      "ref": "node_00000000-0000-4000-8000-000000000003"
    },
    {
      "path": "/roots/0/relations/contains/0",
      "ref": "node_00000000-0000-4000-8000-000000000004"
    },
    {
      "path": "/roots/0/relations/contains/1",
      "ref": "node_00000000-0000-4000-8000-000000000006"
    }
  ]
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
  "00000000-0000-4000-8000-000000000002",
  0,
  {
    "patches": [
      {
        "op": "set",
        "ref": "node_00000000-0000-4000-8000-000000000003",
        "scope": "canonical",
        "path": "/name",
        "value": "临时名称 A"
      }
    ]
  }
]
```

输出：

```json
{
  "draftId": "00000000-0000-4000-8000-000000000002",
  "version": 1,
  "preflightRequired": true,
  "changes": [
    {
      "inputPath": "/patches/0",
      "op": "set",
      "ref": "node_00000000-0000-4000-8000-000000000003",
      "scope": "canonical",
      "target": "field",
      "path": "/name",
      "before": {
        "kind": "set",
        "value": "文档发布"
      },
      "after": {
        "kind": "set",
        "value": "临时名称 A"
      }
    }
  ],
  "createdRefs": []
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
  "00000000-0000-4000-8000-000000000002",
  1,
  {
    "patches": [
      {
        "op": "set",
        "ref": "node_00000000-0000-4000-8000-000000000003",
        "scope": "canonical",
        "path": "/name",
        "value": "临时名称 B"
      }
    ]
  }
]
```

输出：

```json
{
  "draftId": "00000000-0000-4000-8000-000000000002",
  "version": 2,
  "preflightRequired": true,
  "changes": [
    {
      "inputPath": "/patches/0",
      "op": "set",
      "ref": "node_00000000-0000-4000-8000-000000000003",
      "scope": "canonical",
      "target": "field",
      "path": "/name",
      "before": {
        "kind": "set",
        "value": "临时名称 A"
      },
      "after": {
        "kind": "set",
        "value": "临时名称 B"
      }
    }
  ],
  "createdRefs": []
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
  "00000000-0000-4000-8000-000000000002",
  2,
  {
    "patches": [
      {
        "op": "reset",
        "ref": "node_00000000-0000-4000-8000-000000000003",
        "scope": "canonical",
        "path": "/name"
      }
    ]
  }
]
```

输出：

```json
{
  "draftId": "00000000-0000-4000-8000-000000000002",
  "version": 3,
  "preflightRequired": true,
  "changes": [
    {
      "inputPath": "/patches/0",
      "op": "reset",
      "ref": "node_00000000-0000-4000-8000-000000000003",
      "scope": "canonical",
      "target": "field",
      "path": "/name",
      "before": {
        "kind": "set",
        "value": "临时名称 B"
      },
      "after": {
        "kind": "set",
        "value": "文档发布"
      }
    }
  ],
  "createdRefs": []
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
  "00000000-0000-4000-8000-000000000002"
]
```

输出：

```json
{
  "formatVersion": 3,
  "scope": "execution",
  "checkId": "00000000-0000-4000-8000-00000000000d",
  "draftId": "00000000-0000-4000-8000-000000000002",
  "version": 3,
  "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
  "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
  "preview": {
    "id": "00000000-0000-4000-8000-000000000002",
    "version": 3,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "nodes": {
      "node_00000000-0000-4000-8000-000000000003": {
        "id": "node_00000000-0000-4000-8000-000000000003",
        "nodeType": "project",
        "fields": {
          "/capacityHours": {
            "kind": "value",
            "value": 16
          },
          "/deadlineDay": {
            "kind": "value",
            "value": 20
          },
          "/name": {
            "kind": "value",
            "value": "文档发布"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "id": "node_00000000-0000-4000-8000-000000000004",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 22
          },
          "/estimateHours": {
            "kind": "value",
            "value": 12
          },
          "/name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "/owner": {
            "kind": "value",
            "value": null
          },
          "/priority": {
            "kind": "value",
            "value": "urgent"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "id": "node_00000000-0000-4000-8000-000000000006",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 18
          },
          "/estimateHours": {
            "kind": "value",
            "value": 10
          },
          "/name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "/owner": {
            "kind": "value",
            "value": "chen"
          },
          "/priority": {
            "kind": "value",
            "value": "normal"
          }
        }
      }
    },
    "edges": {
      "edge_00000000-0000-4000-8000-000000000005": {
        "id": "edge_00000000-0000-4000-8000-000000000005",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000004",
        "relationType": "contains"
      },
      "edge_00000000-0000-4000-8000-000000000007": {
        "id": "edge_00000000-0000-4000-8000-000000000007",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000006",
        "relationType": "contains"
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
      "path": "/nodes/node_00000000-0000-4000-8000-000000000003/fields/capacityHours",
      "message": "项目“文档发布”容量为 16 小时，但 “编写快速入门”12 小时、“评审使用示例”10 小时，合计 22 小时，超出 6 小时。",
      "hint": "可以缩减任务范围、将部分工作移到下一期，或在用户允许时增加容量；请根据用户意图选择。",
      "related": [
        "/nodes/node_00000000-0000-4000-8000-000000000004/fields/estimateHours",
        "/nodes/node_00000000-0000-4000-8000-000000000006/fields/estimateHours"
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
          "ops": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000003",
                "scope": "canonical",
                "path": "/capacityHours",
                "value": 22
              }
            ]
          }
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
      "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/dueDay",
      "message": "任务“编写快速入门”安排在第 22 天完成，晚于所属项目的第 20 天截止日。",
      "hint": "可以提前该任务、调整项目截止日，或将任务移到下一期；不要自行假设用户同意延期。",
      "related": [
        "/nodes/node_00000000-0000-4000-8000-000000000003/fields/deadlineDay"
      ],
      "repairs": [
        {
          "id": "earlier-task",
          "message": "若任务可以提前，将它安排到项目截止日。",
          "ops": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/dueDay",
                "value": 20
              }
            ]
          }
        },
        {
          "id": "later-project",
          "message": "若用户接受整个项目延期，将项目截止日延到该任务完成日。",
          "ops": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000003",
                "scope": "canonical",
                "path": "/deadlineDay",
                "value": 22
              }
            ]
          }
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
      "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
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
          "repairOps": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/owner",
                "value": "lin"
              }
            ]
          }
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
          "repairOps": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/owner",
                "value": "chen"
              }
            ]
          }
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
          "ops": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/priority",
                "value": "normal"
              }
            ]
          }
        }
      ],
      "related": [
        "/nodes/node_00000000-0000-4000-8000-000000000004/fields/priority"
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
  "00000000-0000-4000-8000-000000000002"
]
```

输出：

```json
{
  "formatVersion": 3,
  "scope": "execution",
  "checkId": "00000000-0000-4000-8000-000000000010",
  "draftId": "00000000-0000-4000-8000-000000000002",
  "version": 3,
  "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
  "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
  "preview": {
    "id": "00000000-0000-4000-8000-000000000002",
    "version": 3,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "nodes": {
      "node_00000000-0000-4000-8000-000000000003": {
        "id": "node_00000000-0000-4000-8000-000000000003",
        "nodeType": "project",
        "fields": {
          "/capacityHours": {
            "kind": "value",
            "value": 16
          },
          "/deadlineDay": {
            "kind": "value",
            "value": 20
          },
          "/name": {
            "kind": "value",
            "value": "文档发布"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "id": "node_00000000-0000-4000-8000-000000000004",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 22
          },
          "/estimateHours": {
            "kind": "value",
            "value": 12
          },
          "/name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "/owner": {
            "kind": "value",
            "value": null
          },
          "/priority": {
            "kind": "value",
            "value": "urgent"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "id": "node_00000000-0000-4000-8000-000000000006",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 18
          },
          "/estimateHours": {
            "kind": "value",
            "value": 10
          },
          "/name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "/owner": {
            "kind": "value",
            "value": "chen"
          },
          "/priority": {
            "kind": "value",
            "value": "normal"
          }
        }
      }
    },
    "edges": {
      "edge_00000000-0000-4000-8000-000000000005": {
        "id": "edge_00000000-0000-4000-8000-000000000005",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000004",
        "relationType": "contains"
      },
      "edge_00000000-0000-4000-8000-000000000007": {
        "id": "edge_00000000-0000-4000-8000-000000000007",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000006",
        "relationType": "contains"
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
      "path": "/nodes/node_00000000-0000-4000-8000-000000000003/fields/capacityHours",
      "message": "项目“文档发布”容量为 16 小时，但 “编写快速入门”12 小时、“评审使用示例”10 小时，合计 22 小时，超出 6 小时。",
      "hint": "可以缩减任务范围、将部分工作移到下一期，或在用户允许时增加容量；请根据用户意图选择。",
      "related": [
        "/nodes/node_00000000-0000-4000-8000-000000000004/fields/estimateHours",
        "/nodes/node_00000000-0000-4000-8000-000000000006/fields/estimateHours"
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
          "ops": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000003",
                "scope": "canonical",
                "path": "/capacityHours",
                "value": 22
              }
            ]
          }
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
      "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/dueDay",
      "message": "任务“编写快速入门”安排在第 22 天完成，晚于所属项目的第 20 天截止日。",
      "hint": "可以提前该任务、调整项目截止日，或将任务移到下一期；不要自行假设用户同意延期。",
      "related": [
        "/nodes/node_00000000-0000-4000-8000-000000000003/fields/deadlineDay"
      ],
      "repairs": [
        {
          "id": "earlier-task",
          "message": "若任务可以提前，将它安排到项目截止日。",
          "ops": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/dueDay",
                "value": 20
              }
            ]
          }
        },
        {
          "id": "later-project",
          "message": "若用户接受整个项目延期，将项目截止日延到该任务完成日。",
          "ops": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000003",
                "scope": "canonical",
                "path": "/deadlineDay",
                "value": 22
              }
            ]
          }
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
      "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
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
          "repairOps": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/owner",
                "value": "lin"
              }
            ]
          }
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
          "repairOps": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/owner",
                "value": "chen"
              }
            ]
          }
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
          "ops": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/priority",
                "value": "normal"
              }
            ]
          }
        }
      ],
      "related": [
        "/nodes/node_00000000-0000-4000-8000-000000000004/fields/priority"
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
  "00000000-0000-4000-8000-000000000002",
  3,
  {
    "patches": [
      {
        "op": "set",
        "ref": "node_00000000-0000-4000-8000-000000000004",
        "scope": "canonical",
        "path": "/estimateHours",
        "value": 8
      },
      {
        "op": "set",
        "ref": "node_00000000-0000-4000-8000-000000000006",
        "scope": "canonical",
        "path": "/estimateHours",
        "value": 8
      },
      {
        "op": "set",
        "ref": "node_00000000-0000-4000-8000-000000000004",
        "scope": "canonical",
        "path": "/dueDay",
        "value": 20
      },
      {
        "op": "set",
        "ref": "node_00000000-0000-4000-8000-000000000004",
        "scope": "canonical",
        "path": "/owner",
        "value": "lin"
      }
    ]
  }
]
```

输出：

```json
{
  "draftId": "00000000-0000-4000-8000-000000000002",
  "version": 4,
  "preflightRequired": true,
  "changes": [
    {
      "inputPath": "/patches/0",
      "op": "set",
      "ref": "node_00000000-0000-4000-8000-000000000004",
      "scope": "canonical",
      "target": "field",
      "path": "/estimateHours",
      "before": {
        "kind": "set",
        "value": 12
      },
      "after": {
        "kind": "set",
        "value": 8
      }
    },
    {
      "inputPath": "/patches/1",
      "op": "set",
      "ref": "node_00000000-0000-4000-8000-000000000006",
      "scope": "canonical",
      "target": "field",
      "path": "/estimateHours",
      "before": {
        "kind": "set",
        "value": 10
      },
      "after": {
        "kind": "set",
        "value": 8
      }
    },
    {
      "inputPath": "/patches/2",
      "op": "set",
      "ref": "node_00000000-0000-4000-8000-000000000004",
      "scope": "canonical",
      "target": "field",
      "path": "/dueDay",
      "before": {
        "kind": "set",
        "value": 22
      },
      "after": {
        "kind": "set",
        "value": 20
      }
    },
    {
      "inputPath": "/patches/3",
      "op": "set",
      "ref": "node_00000000-0000-4000-8000-000000000004",
      "scope": "canonical",
      "target": "field",
      "path": "/owner",
      "before": {
        "kind": "set",
        "value": null
      },
      "after": {
        "kind": "set",
        "value": "lin"
      }
    }
  ],
  "createdRefs": []
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
  "00000000-0000-4000-8000-000000000002"
]
```

输出：

```json
{
  "formatVersion": 3,
  "scope": "execution",
  "checkId": "00000000-0000-4000-8000-000000000014",
  "draftId": "00000000-0000-4000-8000-000000000002",
  "version": 4,
  "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
  "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
  "preview": {
    "id": "00000000-0000-4000-8000-000000000002",
    "version": 4,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "nodes": {
      "node_00000000-0000-4000-8000-000000000003": {
        "id": "node_00000000-0000-4000-8000-000000000003",
        "nodeType": "project",
        "fields": {
          "/capacityHours": {
            "kind": "value",
            "value": 16
          },
          "/deadlineDay": {
            "kind": "value",
            "value": 20
          },
          "/name": {
            "kind": "value",
            "value": "文档发布"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "id": "node_00000000-0000-4000-8000-000000000004",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 20
          },
          "/estimateHours": {
            "kind": "value",
            "value": 8
          },
          "/name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "/owner": {
            "kind": "value",
            "value": "lin"
          },
          "/priority": {
            "kind": "value",
            "value": "urgent"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "id": "node_00000000-0000-4000-8000-000000000006",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 18
          },
          "/estimateHours": {
            "kind": "value",
            "value": 8
          },
          "/name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "/owner": {
            "kind": "value",
            "value": "chen"
          },
          "/priority": {
            "kind": "value",
            "value": "normal"
          }
        }
      }
    },
    "edges": {
      "edge_00000000-0000-4000-8000-000000000005": {
        "id": "edge_00000000-0000-4000-8000-000000000005",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000004",
        "relationType": "contains"
      },
      "edge_00000000-0000-4000-8000-000000000007": {
        "id": "edge_00000000-0000-4000-8000-000000000007",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000006",
        "relationType": "contains"
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
  "certificate": "00000000-0000-4000-8000-000000000015",
  "artifactId": "00000000-0000-4000-8000-000000000015",
  "execution": {
    "checkId": "00000000-0000-4000-8000-000000000014",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
    "executorId": "example.project-service",
    "executorVersion": "5",
    "target": "mock:local",
    "planDigest": "sha256:stagedwrite-json-v1:e503c52d3c159fbfb77b9f3610aefe6258b49c70e315b36d1691fe9324f94ba6"
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
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000015",
  {
    "runId": "demo-run-1"
  }
]
```

输出：

```json
{
  "id": "demo-run-1",
  "draftId": "00000000-0000-4000-8000-000000000002",
  "kind": "initial_create",
  "version": 4,
  "state": "blocked",
  "artifactId": "00000000-0000-4000-8000-000000000015",
  "initialArtifactId": "00000000-0000-4000-8000-000000000015",
  "certificate": "00000000-0000-4000-8000-000000000015",
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
            "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
            "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
            "message": "林无法接手，请选择其他负责人后续作。",
            "candidates": [
              {
                "value": "chen",
                "label": "陈",
                "message": "目前可接手（虚构候选）",
                "repairOps": {
                  "patches": [
                    {
                      "op": "set",
                      "ref": "node_00000000-0000-4000-8000-000000000004",
                      "scope": "canonical",
                      "path": "/owner",
                      "value": "chen"
                    }
                  ]
                }
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
      "recordedAt": "2026-09-16T12:09:17.205Z"
    },
    {
      "sequence": 2,
      "stepId": "project-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T12:09:17.206Z"
    },
    {
      "sequence": 3,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T12:09:17.207Z"
    },
    {
      "sequence": 4,
      "stepId": "task-1",
      "kind": "not_applied",
      "recordedAt": "2026-09-16T12:09:17.208Z",
      "reason": "Owner unavailable; request rejected before creation"
    }
  ],
  "steps": [
    {
      "id": "project-1",
      "effect": {
        "kind": "create",
        "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
        "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
            "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
            "message": "林无法接手，请选择其他负责人后续作。",
            "candidates": [
              {
                "value": "chen",
                "label": "陈",
                "message": "目前可接手（虚构候选）",
                "repairOps": {
                  "patches": [
                    {
                      "op": "set",
                      "ref": "node_00000000-0000-4000-8000-000000000004",
                      "scope": "canonical",
                      "path": "/owner",
                      "value": "chen"
                    }
                  ]
                }
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
        "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
    "id": "00000000-0000-4000-8000-000000000002",
    "version": 4,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "nodes": {
      "node_00000000-0000-4000-8000-000000000003": {
        "id": "node_00000000-0000-4000-8000-000000000003",
        "nodeType": "project",
        "fields": {
          "/capacityHours": {
            "kind": "value",
            "value": 16
          },
          "/deadlineDay": {
            "kind": "value",
            "value": 20
          },
          "/name": {
            "kind": "value",
            "value": "文档发布"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "id": "node_00000000-0000-4000-8000-000000000004",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 20
          },
          "/estimateHours": {
            "kind": "value",
            "value": 8
          },
          "/name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "/owner": {
            "kind": "value",
            "value": "lin"
          },
          "/priority": {
            "kind": "value",
            "value": "urgent"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "id": "node_00000000-0000-4000-8000-000000000006",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 18
          },
          "/estimateHours": {
            "kind": "value",
            "value": 8
          },
          "/name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "/owner": {
            "kind": "value",
            "value": "chen"
          },
          "/priority": {
            "kind": "value",
            "value": "normal"
          }
        }
      }
    },
    "edges": {
      "edge_00000000-0000-4000-8000-000000000005": {
        "id": "edge_00000000-0000-4000-8000-000000000005",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000004",
        "relationType": "contains"
      },
      "edge_00000000-0000-4000-8000-000000000007": {
        "id": "edge_00000000-0000-4000-8000-000000000007",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000006",
        "relationType": "contains"
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
      "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
      "message": "林无法接手，请选择其他负责人后续作。",
      "candidates": [
        {
          "value": "chen",
          "label": "陈",
          "message": "目前可接手（虚构候选）",
          "repairOps": {
            "patches": [
              {
                "op": "set",
                "ref": "node_00000000-0000-4000-8000-000000000004",
                "scope": "canonical",
                "path": "/owner",
                "value": "chen"
              }
            ]
          }
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
          "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
          "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
          "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
          "message": "林无法接手，请选择其他负责人后续作。",
          "candidates": [
            {
              "value": "chen",
              "label": "陈",
              "message": "目前可接手（虚构候选）",
              "repairOps": {
                "patches": [
                  {
                    "op": "set",
                    "ref": "node_00000000-0000-4000-8000-000000000004",
                    "scope": "canonical",
                    "path": "/owner",
                    "value": "chen"
                  }
                ]
              }
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
  "00000000-0000-4000-8000-000000000002"
]
```

输出：

```json
{
  "graph": {
    "nodes": {
      "node_00000000-0000-4000-8000-000000000003": {
        "id": "node_00000000-0000-4000-8000-000000000003",
        "nodeType": "project",
        "fields": {
          "capacityHours": 16,
          "deadlineDay": 20,
          "name": "文档发布"
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "id": "node_00000000-0000-4000-8000-000000000004",
        "nodeType": "task",
        "fields": {
          "name": "编写快速入门",
          "priority": "urgent",
          "estimateHours": 8,
          "dueDay": 20,
          "owner": "lin"
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "id": "node_00000000-0000-4000-8000-000000000006",
        "nodeType": "task",
        "fields": {
          "name": "评审使用示例",
          "dueDay": 18,
          "priority": "normal",
          "owner": "chen",
          "estimateHours": 8
        }
      }
    },
    "edges": {
      "edge_00000000-0000-4000-8000-000000000005": {
        "id": "edge_00000000-0000-4000-8000-000000000005",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000004",
        "relationType": "contains"
      },
      "edge_00000000-0000-4000-8000-000000000007": {
        "id": "edge_00000000-0000-4000-8000-000000000007",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000006",
        "relationType": "contains"
      }
    }
  },
  "fieldIntents": {
    "node_00000000-0000-4000-8000-000000000003": {
      "/capacityHours": {
        "kind": "set",
        "value": 16
      },
      "/deadlineDay": {
        "kind": "set",
        "value": 20
      },
      "/name": {
        "kind": "set",
        "value": "文档发布"
      }
    },
    "node_00000000-0000-4000-8000-000000000004": {
      "/name": {
        "kind": "set",
        "value": "编写快速入门"
      },
      "/priority": {
        "kind": "set",
        "value": "urgent"
      },
      "/estimateHours": {
        "kind": "set",
        "value": 8
      },
      "/dueDay": {
        "kind": "set",
        "value": 20
      },
      "/owner": {
        "kind": "set",
        "value": "lin"
      }
    },
    "node_00000000-0000-4000-8000-000000000006": {
      "/name": {
        "kind": "set",
        "value": "评审使用示例"
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
      },
      "/estimateHours": {
        "kind": "set",
        "value": 8
      }
    }
  },
  "tombstones": {
    "nodes": [],
    "edges": []
  },
  "formatVersion": 3,
  "id": "00000000-0000-4000-8000-000000000002",
  "version": 4,
  "type": "example.project-tasks",
  "typeVersion": "2",
  "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
  "status": "pending",
  "currentRunId": "demo-run-1",
  "targetId": "mock:local",
  "initialSnapshot": {
    "graph": {
      "nodes": {
        "node_00000000-0000-4000-8000-000000000003": {
          "id": "node_00000000-0000-4000-8000-000000000003",
          "nodeType": "project",
          "fields": {
            "name": "文档发布",
            "capacityHours": 16,
            "deadlineDay": 20
          }
        },
        "node_00000000-0000-4000-8000-000000000004": {
          "id": "node_00000000-0000-4000-8000-000000000004",
          "nodeType": "task",
          "fields": {
            "name": "编写快速入门",
            "estimateHours": 12,
            "dueDay": 22,
            "priority": "urgent",
            "owner": null
          }
        },
        "node_00000000-0000-4000-8000-000000000006": {
          "id": "node_00000000-0000-4000-8000-000000000006",
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
        "edge_00000000-0000-4000-8000-000000000005": {
          "id": "edge_00000000-0000-4000-8000-000000000005",
          "from": "node_00000000-0000-4000-8000-000000000003",
          "to": "node_00000000-0000-4000-8000-000000000004",
          "relationType": "contains"
        },
        "edge_00000000-0000-4000-8000-000000000007": {
          "id": "edge_00000000-0000-4000-8000-000000000007",
          "from": "node_00000000-0000-4000-8000-000000000003",
          "to": "node_00000000-0000-4000-8000-000000000006",
          "relationType": "contains"
        }
      }
    },
    "fieldIntents": {
      "node_00000000-0000-4000-8000-000000000003": {
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
      "node_00000000-0000-4000-8000-000000000004": {
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
      "node_00000000-0000-4000-8000-000000000006": {
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
  "createdAt": "2026-09-16T12:09:17.186Z",
  "updatedAt": "2026-09-16T12:09:17.200Z"
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
  "00000000-0000-4000-8000-000000000002",
  4,
  {
    "patches": [
      {
        "op": "set",
        "ref": "node_00000000-0000-4000-8000-000000000004",
        "scope": "canonical",
        "path": "/owner",
        "value": "chen"
      }
    ]
  }
]
```

输出：

```json
{
  "draftId": "00000000-0000-4000-8000-000000000002",
  "version": 5,
  "preflightRequired": true,
  "changes": [
    {
      "inputPath": "/patches/0",
      "op": "set",
      "ref": "node_00000000-0000-4000-8000-000000000004",
      "scope": "canonical",
      "target": "field",
      "path": "/owner",
      "before": {
        "kind": "set",
        "value": "lin"
      },
      "after": {
        "kind": "set",
        "value": "chen"
      }
    }
  ],
  "createdRefs": []
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
  "draftId": "00000000-0000-4000-8000-000000000002",
  "kind": "initial_create",
  "version": 5,
  "state": "unknown",
  "artifactId": "00000000-0000-4000-8000-00000000001b",
  "initialArtifactId": "00000000-0000-4000-8000-000000000015",
  "certificate": "00000000-0000-4000-8000-00000000001b",
  "revision": 1,
  "revisions": [
    {
      "artifactId": "00000000-0000-4000-8000-000000000015",
      "version": 4,
      "steps": [
        {
          "id": "project-1",
          "effect": {
            "kind": "create",
            "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
                "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
                "message": "林无法接手，请选择其他负责人后续作。",
                "candidates": [
                  {
                    "value": "chen",
                    "label": "陈",
                    "message": "目前可接手（虚构候选）",
                    "repairOps": {
                      "patches": [
                        {
                          "op": "set",
                          "ref": "node_00000000-0000-4000-8000-000000000004",
                          "scope": "canonical",
                          "path": "/owner",
                          "value": "chen"
                        }
                      ]
                    }
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
            "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
            "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
            "message": "林无法接手，请选择其他负责人后续作。",
            "candidates": [
              {
                "value": "chen",
                "label": "陈",
                "message": "目前可接手（虚构候选）",
                "repairOps": {
                  "patches": [
                    {
                      "op": "set",
                      "ref": "node_00000000-0000-4000-8000-000000000004",
                      "scope": "canonical",
                      "path": "/owner",
                      "value": "chen"
                    }
                  ]
                }
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
            "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
      "recordedAt": "2026-09-16T12:09:17.205Z"
    },
    {
      "sequence": 2,
      "stepId": "project-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T12:09:17.206Z"
    },
    {
      "sequence": 3,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T12:09:17.207Z"
    },
    {
      "sequence": 4,
      "stepId": "task-1",
      "kind": "not_applied",
      "recordedAt": "2026-09-16T12:09:17.208Z",
      "reason": "Owner unavailable; request rejected before creation"
    },
    {
      "sequence": 5,
      "stepId": "",
      "kind": "plan_repaired",
      "recordedAt": "2026-09-16T12:09:17.214Z"
    },
    {
      "sequence": 6,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T12:09:17.215Z"
    },
    {
      "sequence": 7,
      "stepId": "task-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T12:09:17.216Z"
    },
    {
      "sequence": 8,
      "stepId": "task-2",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T12:09:17.218Z"
    },
    {
      "sequence": 9,
      "stepId": "task-2",
      "kind": "unknown",
      "recordedAt": "2026-09-16T12:09:17.218Z",
      "reason": "Response timed out; creation outcome requires lookup"
    }
  ],
  "steps": [
    {
      "id": "project-1",
      "effect": {
        "kind": "create",
        "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
        "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
        "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
    "id": "00000000-0000-4000-8000-000000000002",
    "version": 5,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "nodes": {
      "node_00000000-0000-4000-8000-000000000003": {
        "id": "node_00000000-0000-4000-8000-000000000003",
        "nodeType": "project",
        "fields": {
          "/capacityHours": {
            "kind": "value",
            "value": 16
          },
          "/deadlineDay": {
            "kind": "value",
            "value": 20
          },
          "/name": {
            "kind": "value",
            "value": "文档发布"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "id": "node_00000000-0000-4000-8000-000000000004",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 20
          },
          "/estimateHours": {
            "kind": "value",
            "value": 8
          },
          "/name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "/owner": {
            "kind": "value",
            "value": "chen"
          },
          "/priority": {
            "kind": "value",
            "value": "urgent"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "id": "node_00000000-0000-4000-8000-000000000006",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 18
          },
          "/estimateHours": {
            "kind": "value",
            "value": 8
          },
          "/name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "/owner": {
            "kind": "value",
            "value": "chen"
          },
          "/priority": {
            "kind": "value",
            "value": "normal"
          }
        }
      }
    },
    "edges": {
      "edge_00000000-0000-4000-8000-000000000005": {
        "id": "edge_00000000-0000-4000-8000-000000000005",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000004",
        "relationType": "contains"
      },
      "edge_00000000-0000-4000-8000-000000000007": {
        "id": "edge_00000000-0000-4000-8000-000000000007",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000006",
        "relationType": "contains"
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
      "path": "/nodes/node_00000000-0000-4000-8000-000000000006",
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
          "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
          "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
  "draftId": "00000000-0000-4000-8000-000000000002",
  "kind": "initial_create",
  "version": 5,
  "state": "published",
  "artifactId": "00000000-0000-4000-8000-00000000001b",
  "initialArtifactId": "00000000-0000-4000-8000-000000000015",
  "certificate": "00000000-0000-4000-8000-00000000001b",
  "revision": 1,
  "revisions": [
    {
      "artifactId": "00000000-0000-4000-8000-000000000015",
      "version": 4,
      "steps": [
        {
          "id": "project-1",
          "effect": {
            "kind": "create",
            "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
                "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
                "message": "林无法接手，请选择其他负责人后续作。",
                "candidates": [
                  {
                    "value": "chen",
                    "label": "陈",
                    "message": "目前可接手（虚构候选）",
                    "repairOps": {
                      "patches": [
                        {
                          "op": "set",
                          "ref": "node_00000000-0000-4000-8000-000000000004",
                          "scope": "canonical",
                          "path": "/owner",
                          "value": "chen"
                        }
                      ]
                    }
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
            "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
            "path": "/nodes/node_00000000-0000-4000-8000-000000000004/fields/owner",
            "message": "林无法接手，请选择其他负责人后续作。",
            "candidates": [
              {
                "value": "chen",
                "label": "陈",
                "message": "目前可接手（虚构候选）",
                "repairOps": {
                  "patches": [
                    {
                      "op": "set",
                      "ref": "node_00000000-0000-4000-8000-000000000004",
                      "scope": "canonical",
                      "path": "/owner",
                      "value": "chen"
                    }
                  ]
                }
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
            "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
            "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
      "recordedAt": "2026-09-16T12:09:17.205Z"
    },
    {
      "sequence": 2,
      "stepId": "project-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T12:09:17.206Z"
    },
    {
      "sequence": 3,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T12:09:17.207Z"
    },
    {
      "sequence": 4,
      "stepId": "task-1",
      "kind": "not_applied",
      "recordedAt": "2026-09-16T12:09:17.208Z",
      "reason": "Owner unavailable; request rejected before creation"
    },
    {
      "sequence": 5,
      "stepId": "",
      "kind": "plan_repaired",
      "recordedAt": "2026-09-16T12:09:17.214Z"
    },
    {
      "sequence": 6,
      "stepId": "task-1",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T12:09:17.215Z"
    },
    {
      "sequence": 7,
      "stepId": "task-1",
      "kind": "applied",
      "recordedAt": "2026-09-16T12:09:17.216Z"
    },
    {
      "sequence": 8,
      "stepId": "task-2",
      "kind": "dispatching",
      "recordedAt": "2026-09-16T12:09:17.218Z"
    },
    {
      "sequence": 9,
      "stepId": "task-2",
      "kind": "unknown",
      "recordedAt": "2026-09-16T12:09:17.218Z",
      "reason": "Response timed out; creation outcome requires lookup"
    },
    {
      "sequence": 10,
      "stepId": "task-2",
      "kind": "reconciling",
      "recordedAt": "2026-09-16T12:09:17.221Z"
    },
    {
      "sequence": 11,
      "stepId": "task-2",
      "kind": "applied",
      "recordedAt": "2026-09-16T12:09:17.222Z"
    }
  ],
  "steps": [
    {
      "id": "project-1",
      "effect": {
        "kind": "create",
        "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
        "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
        "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
    "id": "00000000-0000-4000-8000-000000000002",
    "version": 5,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "nodes": {
      "node_00000000-0000-4000-8000-000000000003": {
        "id": "node_00000000-0000-4000-8000-000000000003",
        "nodeType": "project",
        "fields": {
          "/capacityHours": {
            "kind": "value",
            "value": 16
          },
          "/deadlineDay": {
            "kind": "value",
            "value": 20
          },
          "/name": {
            "kind": "value",
            "value": "文档发布"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "id": "node_00000000-0000-4000-8000-000000000004",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 20
          },
          "/estimateHours": {
            "kind": "value",
            "value": 8
          },
          "/name": {
            "kind": "value",
            "value": "编写快速入门"
          },
          "/owner": {
            "kind": "value",
            "value": "chen"
          },
          "/priority": {
            "kind": "value",
            "value": "urgent"
          }
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "id": "node_00000000-0000-4000-8000-000000000006",
        "nodeType": "task",
        "fields": {
          "/dueDay": {
            "kind": "value",
            "value": 18
          },
          "/estimateHours": {
            "kind": "value",
            "value": 8
          },
          "/name": {
            "kind": "value",
            "value": "评审使用示例"
          },
          "/owner": {
            "kind": "value",
            "value": "chen"
          },
          "/priority": {
            "kind": "value",
            "value": "normal"
          }
        }
      }
    },
    "edges": {
      "edge_00000000-0000-4000-8000-000000000005": {
        "id": "edge_00000000-0000-4000-8000-000000000005",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000004",
        "relationType": "contains"
      },
      "edge_00000000-0000-4000-8000-000000000007": {
        "id": "edge_00000000-0000-4000-8000-000000000007",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000006",
        "relationType": "contains"
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
          "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
  "00000000-0000-4000-8000-000000000002"
]
```

输出：

```json
{
  "graph": {
    "nodes": {
      "node_00000000-0000-4000-8000-000000000003": {
        "id": "node_00000000-0000-4000-8000-000000000003",
        "nodeType": "project",
        "fields": {
          "capacityHours": 16,
          "deadlineDay": 20,
          "name": "文档发布"
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "id": "node_00000000-0000-4000-8000-000000000004",
        "nodeType": "task",
        "fields": {
          "name": "编写快速入门",
          "priority": "urgent",
          "estimateHours": 8,
          "dueDay": 20,
          "owner": "chen"
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "id": "node_00000000-0000-4000-8000-000000000006",
        "nodeType": "task",
        "fields": {
          "name": "评审使用示例",
          "dueDay": 18,
          "priority": "normal",
          "owner": "chen",
          "estimateHours": 8
        }
      }
    },
    "edges": {
      "edge_00000000-0000-4000-8000-000000000005": {
        "id": "edge_00000000-0000-4000-8000-000000000005",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000004",
        "relationType": "contains"
      },
      "edge_00000000-0000-4000-8000-000000000007": {
        "id": "edge_00000000-0000-4000-8000-000000000007",
        "from": "node_00000000-0000-4000-8000-000000000003",
        "to": "node_00000000-0000-4000-8000-000000000006",
        "relationType": "contains"
      }
    }
  },
  "fieldIntents": {
    "node_00000000-0000-4000-8000-000000000003": {
      "/capacityHours": {
        "kind": "set",
        "value": 16
      },
      "/deadlineDay": {
        "kind": "set",
        "value": 20
      },
      "/name": {
        "kind": "set",
        "value": "文档发布"
      }
    },
    "node_00000000-0000-4000-8000-000000000004": {
      "/name": {
        "kind": "set",
        "value": "编写快速入门"
      },
      "/priority": {
        "kind": "set",
        "value": "urgent"
      },
      "/estimateHours": {
        "kind": "set",
        "value": 8
      },
      "/dueDay": {
        "kind": "set",
        "value": 20
      },
      "/owner": {
        "kind": "set",
        "value": "chen"
      }
    },
    "node_00000000-0000-4000-8000-000000000006": {
      "/name": {
        "kind": "set",
        "value": "评审使用示例"
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
      },
      "/estimateHours": {
        "kind": "set",
        "value": 8
      }
    }
  },
  "tombstones": {
    "nodes": [],
    "edges": []
  },
  "formatVersion": 3,
  "id": "00000000-0000-4000-8000-000000000002",
  "version": 5,
  "type": "example.project-tasks",
  "typeVersion": "2",
  "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
  "status": "published",
  "currentRunId": "demo-run-1",
  "targetId": "mock:local",
  "initialSnapshot": {
    "graph": {
      "nodes": {
        "node_00000000-0000-4000-8000-000000000003": {
          "id": "node_00000000-0000-4000-8000-000000000003",
          "nodeType": "project",
          "fields": {
            "name": "文档发布",
            "capacityHours": 16,
            "deadlineDay": 20
          }
        },
        "node_00000000-0000-4000-8000-000000000004": {
          "id": "node_00000000-0000-4000-8000-000000000004",
          "nodeType": "task",
          "fields": {
            "name": "编写快速入门",
            "estimateHours": 12,
            "dueDay": 22,
            "priority": "urgent",
            "owner": null
          }
        },
        "node_00000000-0000-4000-8000-000000000006": {
          "id": "node_00000000-0000-4000-8000-000000000006",
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
        "edge_00000000-0000-4000-8000-000000000005": {
          "id": "edge_00000000-0000-4000-8000-000000000005",
          "from": "node_00000000-0000-4000-8000-000000000003",
          "to": "node_00000000-0000-4000-8000-000000000004",
          "relationType": "contains"
        },
        "edge_00000000-0000-4000-8000-000000000007": {
          "id": "edge_00000000-0000-4000-8000-000000000007",
          "from": "node_00000000-0000-4000-8000-000000000003",
          "to": "node_00000000-0000-4000-8000-000000000006",
          "relationType": "contains"
        }
      }
    },
    "fieldIntents": {
      "node_00000000-0000-4000-8000-000000000003": {
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
      "node_00000000-0000-4000-8000-000000000004": {
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
      "node_00000000-0000-4000-8000-000000000006": {
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
  "publishedArtifactId": "00000000-0000-4000-8000-00000000001b",
  "lastPublishedAt": "2026-09-16T12:09:17.224Z",
  "createdAt": "2026-09-16T12:09:17.186Z",
  "updatedAt": "2026-09-16T12:09:17.224Z"
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
  "00000000-0000-4000-8000-000000000002"
]
```

输出：

```json
{
  "node_00000000-0000-4000-8000-000000000003": {
    "nodeId": "node_00000000-0000-4000-8000-000000000003",
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
  "node_00000000-0000-4000-8000-000000000004": {
    "nodeId": "node_00000000-0000-4000-8000-000000000004",
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
  "node_00000000-0000-4000-8000-000000000006": {
    "nodeId": "node_00000000-0000-4000-8000-000000000006",
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
  "id": "00000000-0000-4000-8000-00000000001b",
  "intentDigest": "sha256:stagedwrite-json-v1:5a58d81df765af6b2dc753f622bae5d928313b5b21589bb4f769b2cc84056edb",
  "draft": {
    "graph": {
      "nodes": {
        "node_00000000-0000-4000-8000-000000000003": {
          "id": "node_00000000-0000-4000-8000-000000000003",
          "nodeType": "project",
          "fields": {
            "capacityHours": 16,
            "deadlineDay": 20,
            "name": "文档发布"
          }
        },
        "node_00000000-0000-4000-8000-000000000004": {
          "id": "node_00000000-0000-4000-8000-000000000004",
          "nodeType": "task",
          "fields": {
            "name": "编写快速入门",
            "priority": "urgent",
            "estimateHours": 8,
            "dueDay": 20,
            "owner": "chen"
          }
        },
        "node_00000000-0000-4000-8000-000000000006": {
          "id": "node_00000000-0000-4000-8000-000000000006",
          "nodeType": "task",
          "fields": {
            "name": "评审使用示例",
            "dueDay": 18,
            "priority": "normal",
            "owner": "chen",
            "estimateHours": 8
          }
        }
      },
      "edges": {
        "edge_00000000-0000-4000-8000-000000000005": {
          "id": "edge_00000000-0000-4000-8000-000000000005",
          "from": "node_00000000-0000-4000-8000-000000000003",
          "to": "node_00000000-0000-4000-8000-000000000004",
          "relationType": "contains"
        },
        "edge_00000000-0000-4000-8000-000000000007": {
          "id": "edge_00000000-0000-4000-8000-000000000007",
          "from": "node_00000000-0000-4000-8000-000000000003",
          "to": "node_00000000-0000-4000-8000-000000000006",
          "relationType": "contains"
        }
      }
    },
    "fieldIntents": {
      "node_00000000-0000-4000-8000-000000000003": {
        "/capacityHours": {
          "kind": "set",
          "value": 16
        },
        "/deadlineDay": {
          "kind": "set",
          "value": 20
        },
        "/name": {
          "kind": "set",
          "value": "文档发布"
        }
      },
      "node_00000000-0000-4000-8000-000000000004": {
        "/name": {
          "kind": "set",
          "value": "编写快速入门"
        },
        "/priority": {
          "kind": "set",
          "value": "urgent"
        },
        "/estimateHours": {
          "kind": "set",
          "value": 8
        },
        "/dueDay": {
          "kind": "set",
          "value": 20
        },
        "/owner": {
          "kind": "set",
          "value": "chen"
        }
      },
      "node_00000000-0000-4000-8000-000000000006": {
        "/name": {
          "kind": "set",
          "value": "评审使用示例"
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
        },
        "/estimateHours": {
          "kind": "set",
          "value": 8
        }
      }
    },
    "tombstones": {
      "nodes": [],
      "edges": []
    },
    "formatVersion": 3,
    "id": "00000000-0000-4000-8000-000000000002",
    "version": 5,
    "type": "example.project-tasks",
    "typeVersion": "2",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "status": "pending",
    "currentRunId": "demo-run-1",
    "targetId": "mock:local",
    "initialSnapshot": {
      "graph": {
        "nodes": {
          "node_00000000-0000-4000-8000-000000000003": {
            "id": "node_00000000-0000-4000-8000-000000000003",
            "nodeType": "project",
            "fields": {
              "name": "文档发布",
              "capacityHours": 16,
              "deadlineDay": 20
            }
          },
          "node_00000000-0000-4000-8000-000000000004": {
            "id": "node_00000000-0000-4000-8000-000000000004",
            "nodeType": "task",
            "fields": {
              "name": "编写快速入门",
              "estimateHours": 12,
              "dueDay": 22,
              "priority": "urgent",
              "owner": null
            }
          },
          "node_00000000-0000-4000-8000-000000000006": {
            "id": "node_00000000-0000-4000-8000-000000000006",
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
          "edge_00000000-0000-4000-8000-000000000005": {
            "id": "edge_00000000-0000-4000-8000-000000000005",
            "from": "node_00000000-0000-4000-8000-000000000003",
            "to": "node_00000000-0000-4000-8000-000000000004",
            "relationType": "contains"
          },
          "edge_00000000-0000-4000-8000-000000000007": {
            "id": "edge_00000000-0000-4000-8000-000000000007",
            "from": "node_00000000-0000-4000-8000-000000000003",
            "to": "node_00000000-0000-4000-8000-000000000006",
            "relationType": "contains"
          }
        }
      },
      "fieldIntents": {
        "node_00000000-0000-4000-8000-000000000003": {
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
        "node_00000000-0000-4000-8000-000000000004": {
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
        "node_00000000-0000-4000-8000-000000000006": {
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
    "createdAt": "2026-09-16T12:09:17.186Z",
    "updatedAt": "2026-09-16T12:09:17.209Z"
  },
  "plan": [
    {
      "id": "project-1",
      "effect": {
        "kind": "create",
        "nodeId": "node_00000000-0000-4000-8000-000000000003"
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
        "nodeId": "node_00000000-0000-4000-8000-000000000004"
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
        "nodeId": "node_00000000-0000-4000-8000-000000000006"
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
    "checkId": "00000000-0000-4000-8000-00000000001a",
    "definitionDigest": "sha256:stagedwrite-json-v1:d838c4c0fac1f3d696df44356a3bbc7b10f3f443f0c02cee349eeb4805d0d984",
    "rulesDigest": "sha256:stagedwrite-json-v1:e537952d66ea39a287c827339c85fd61811965985b88673d51e23a6905a11f10",
    "executorId": "example.project-service",
    "executorVersion": "5",
    "target": "mock:local",
    "planDigest": "sha256:stagedwrite-json-v1:33e7ce27a6f2603cda290489a533ebc6dc5b670b484886294bb5adbfc4d11083"
  },
  "resourceRevision": 1
}
```

远端调用：

```json
[]
```
