# workflow/：工作控制与编排能力家族

[English](README.md) | 中文

本家族同时承载全局工作控制状态、持久执行努力、DSH 原生 Runner Bridge、Worker Node/Environment 资源事实、认证 Remote Node 传输与运行、Evidence 驱动验收、全局 Work Console 以及动态 Agent 编排。Work Control、Work Execution、Work Node、Work Environment、Work Validation 与 Work Console 都保持模型无关；Runner/Gateway Consumer 只携带 bounded Task Context Package，不重放完整 Transcript。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`work-control/`](work-control/README.zh.md) | 保存被动想法、已推进 Task、优先级、动态阶段计划、验收策略和主看板精简验收状态 | `ctx.workControl` |
| [`work-execution/`](work-execution/README.zh.md) | 保存独立 ExecutionThread 与精简 Runner Attempt 事实 | `ctx.workExecution` |
| [`work-runner-subagent/`](work-runner-subagent/README.zh.md) | 用 bounded、可审计上下文把隔离 ExecutionThread 接到已注册 DSH Subagent Provider | `ctx.workSubagentRunner` |
| [`work-node/`](work-node/README.zh.md) | 保存 Worker Node 在线状态、协议、Runner Provider 和调度能力事实 | `ctx.workNodes` |
| [`work-environment/`](work-environment/README.zh.md) | 保存可复现环境快照、精确 Thread 绑定和调度 preflight | `ctx.workEnvironments` |
| [`work-node-gateway/`](work-node-gateway/README.zh.md) | 认证 HTTP Pull Remote 传输、Heartbeat 所有权和持久命令队列 | `ctx.workNodeGateway` |
| [`work-node-daemon/`](work-node-daemon/README.zh.md) | Remote Worker Runtime：签名轮询、Environment 上报、命令去重和本地 Runner Registry | `ctx.workNodeDaemon` |
| [`work-node-runner-codex/`](work-node-runner-codex/README.zh.md) | 把现有 Codex app-server runtime 注册为真实 one-shot Remote Runner | 注册到 `ctx.workNodeDaemon` |
| [`work-node-runner-claude-code/`](work-node-runner-claude-code/README.zh.md) | 把现有 Claude Agent SDK runtime 注册为真实 one-shot Remote Runner | 注册到 `ctx.workNodeDaemon` |
| [`work-validation/`](work-validation/README.zh.md) | 保存 Validation Generation、详细 Validator 结果和 Evidence Ref，并回写精简完成状态 | `ctx.workValidation` |
| [`work-console/`](work-console/README.md) | 投影想法/执行/人工验收/资源事实，并通过同一个 Host Remote 提供显式 Idea 推进和人工通过/退回命令；浏览器不提供 actor | `ctx.workConsole` |
| [`workflow/`](workflow/README.md) | 定义工作流执行和生命周期事件 | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | 在线程中运行工作流脚本 | 注册到 `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | 向模型公开通用工作流执行 | 注册到 `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | 公开使用全新 agent（智能体）的固定 Ralph 工作流 | 注册到 `ctx.tools` |

层级刻意分离：Task 是持久全局工作；ExecutionThread 是挂在 Task 上的一次独立执行努力；Runner Bridge 把该努力绑定到现有 DSH Provider；WorkNode 描述工作可以在哪里运行；WorkEnvironment 固定可复现的运行时与 Workspace 状态；WorkNodeGateway 负责认证远程命令传输；WorkNodeDaemon 通过真实本地 Runner Adapter 执行命令；WorkValidation 保存详细 Evidence，而 Work Control 只保留主看板摘要；WorkConsole 只投影这些权威事实并提供薄的 Host-owned 人工命令边界，不创建第二套持久业务状态。首页按「想法区｜执行区｜验收区」组织，不把 Domain Status 或 Workflow Stage 强行变成固定看板列。Workflow Run 则是更高层的一种编排机制。worker thread 将工作流执行与宿主事件循环隔离，但不构成安全边界。

参见[全局 Work Control](../../.agents/notes/implemented/feature/2026-08-15-global-work-control-domain.md)、[ExecutionThread](../../.agents/notes/implemented/feature/2026-08-15-work-execution-thread-domain.md)、[Bounded Subagent Runner](../../.agents/notes/implemented/feature/2026-08-15-work-subagent-runner-bridge.md)、[Work Environment](../../.agents/notes/implemented/feature/2026-08-16-work-environment-snapshots.md)、[Remote Node Gateway](../../.agents/notes/implemented/feature/2026-08-16-work-node-http-pull-gateway.md)、[Evidence 驱动验收](../../.agents/notes/implemented/feature/2026-08-16-evidence-backed-work-validation.md)、[全局 Work Console](../../.agents/notes/implemented/feature/2026-08-16-global-work-console-read-model.md)、[Work Console Host 命令](../../.agents/notes/implemented/feature/2026-08-18-work-console-host-commands.md)、[动态工作流](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)和 [Ralph 工具](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md)决策。动态工作流子系统参考见 [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md)。
