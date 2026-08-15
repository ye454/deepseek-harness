# workflow/ — work-control and orchestration capability family

English | [中文](README.zh.md)

This family owns global work-control state, durable execution efforts, and dynamic agent orchestration. Work-control and work-execution remain model-agnostic; later runner/workflow consumers can execute task stages without making the global task record itself a model session.

| Package | Role | ctx key |
|---|---|---|
| [`work-control/`](work-control/README.md) | Stores passive ideas, promoted tasks, priority, dynamic stage plans, and validation policy | `ctx.workControl` |
| [`work-execution/`](work-execution/README.md) | Stores independent execution threads and compact runner-attempt facts | `ctx.workExecution` |
| [`workflow/`](workflow/README.md) | Defines workflow execution and lifecycle events | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | Runs workflow scripts in worker threads | registers on `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | Exposes general workflow execution to the model | registers on `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | Exposes the fixed fresh-agent Ralph workflow | registers on `ctx.tools` |

The layers are intentionally distinct: a Task is durable global work; an ExecutionThread is one independent effort attached to it; a workflow run or subagent is one possible execution mechanism used by a later runner bridge. Worker threads isolate workflow execution from the host event loop but are not a security boundary.

See the [global work-control](../../.agents/notes/implemented/feature/2026-08-15-global-work-control-domain.md), [execution-thread](../../.agents/notes/implemented/feature/2026-08-15-work-execution-thread-domain.md), [dynamic-workflow](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md), and [Ralph tool](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md) decisions. The dynamic workflow subsystem reference is [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md).
