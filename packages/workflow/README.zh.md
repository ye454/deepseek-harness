# workflow/：工作控制与编排能力家族

[English](README.md) | 中文

本家族同时承载全局工作控制状态、持久执行努力、DSH 原生 Runner Bridge、Worker Node/Environment 资源事实和动态 Agent 编排。Work Control、Work Execution、Work Node 与 Work Environment 本身都与模型无关；Runner Bridge 是第一层会主动把 bounded Task Context Package 发给 Child Model 的能力。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`work-control/`](work-control/README.zh.md) | 保存被动想法、已推进 Task、优先级、动态阶段计划和验收策略 | `ctx.workControl` |
| [`work-execution/`](work-execution/README.zh.md) | 保存独立 ExecutionThread 与精简 Runner Attempt 事实 | `ctx.workExecution` |
| [`work-runner-subagent/`](work-runner-subagent/README.zh.md) | 用 bounded、可审计上下文把隔离 ExecutionThread 接到已注册 DSH Subagent Provider | `ctx.workSubagentRunner` |
| [`work-node/`](work-node/README.zh.md) | 保存 Worker Node 在线状态、协议、Runner Provider 和调度能力事实 | `ctx.workNodes` |
| [`work-environment/`](work-environment/README.zh.md) | 保存可复现环境快照、精确 Thread 绑定和调度 preflight | `ctx.workEnvironments` |
| [`workflow/`](workflow/README.md) | 定义工作流执行和生命周期事件 | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | 在线程中运行工作流脚本 | 注册到 `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | 向模型公开通用工作流执行 | 注册到 `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | 公开使用全新 agent（智能体）的固定 Ralph 工作流 | 注册到 `ctx.tools` |

层级刻意分离：Task 是持久全局工作；ExecutionThread 是挂在 Task 上的一次独立执行努力；Runner Bridge 把该努力绑定到现有 DSH Provider；WorkNode 描述工作可以在哪里运行；WorkEnvironment 固定可复现的运行时与 Workspace 状态；Workflow Run 则是更高层的一种编排机制。worker thread 将工作流执行与宿主事件循环隔离，但不构成安全边界。

参见[全局 Work Control](../../.agents/notes/implemented/feature/2026-08-15-global-work-control-domain.md)、[ExecutionThread](../../.agents/notes/implemented/feature/2026-08-15-work-execution-thread-domain.md)、[Bounded Subagent Runner](../../.agents/notes/implemented/feature/2026-08-15-work-subagent-runner-bridge.md)、[Work Environment](../../.agents/notes/implemented/feature/2026-08-16-work-environment-snapshots.md)、[动态工作流](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)和 [Ralph 工具](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md)决策。动态工作流子系统参考见 [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md)。
