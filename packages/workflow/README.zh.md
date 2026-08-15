# workflow/：工作控制与编排能力家族

[English](README.md) | 中文

本家族同时承载全局工作控制状态与动态 Agent 编排。Work Control 领域本身与模型无关；后续 Workflow Consumer 可以通过 subagent 执行 Task 阶段，而不需要把全局 Task 记录本身变成模型 Session。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`work-control/`](work-control/README.zh.md) | 保存被动想法、已推进 Task、优先级、动态阶段计划和验收策略 | `ctx.workControl` |
| [`workflow/`](workflow/README.md) | 定义工作流执行和生命周期事件 | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | 在线程中运行工作流脚本 | 注册到 `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | 向模型公开通用工作流执行 | 注册到 `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | 公开使用全新 agent（智能体）的固定 Ralph 工作流 | 注册到 `ctx.tools` |

`work-control` 与 `workflow` 保持分离：Task 是持久的全局工作目标，Workflow Run 只是后续 Organizer 可以选择的一种执行机制。worker thread 将工作流执行与宿主事件循环隔离，但不构成安全边界。

参见[全局 Work Control](../../.agents/notes/implemented/feature/2026-08-15-global-work-control-domain.md)、[动态工作流](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)和 [Ralph 工具](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md)决策。动态工作流子系统参考见 [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md)。
