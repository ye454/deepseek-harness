# workflow/ — work-control and orchestration capability family

English | [中文](README.zh.md)

This family owns global work-control state and dynamic agent orchestration. The work-control domain is model-agnostic; workflow consumers may later execute task stages through subagents without making the global task record itself a model session.

| Package | Role | ctx key |
|---|---|---|
| [`work-control/`](work-control/README.md) | Stores passive ideas, promoted tasks, priority, dynamic stage plans, and validation policy | `ctx.workControl` |
| [`workflow/`](workflow/README.md) | Defines workflow execution and lifecycle events | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | Runs workflow scripts in worker threads | registers on `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | Exposes general workflow execution to the model | registers on `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | Exposes the fixed fresh-agent Ralph workflow | registers on `ctx.tools` |

`work-control` remains separate from `workflow`: a Task is durable global work, while a workflow run is one execution mechanism that a later organizer may choose. Worker threads isolate workflow execution from the host event loop but are not a security boundary.

See the [global work-control](../../.agents/notes/implemented/feature/2026-08-15-global-work-control-domain.md), [dynamic-workflow](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md), and [Ralph tool](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md) decisions. The dynamic workflow subsystem reference is [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md).
