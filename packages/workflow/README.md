# workflow/ — work-control and orchestration capability family

English | [中文](README.zh.md)

This family owns global work-control state, durable execution efforts, DSH-native runner bridging, worker-node/environment resource facts, authenticated remote-node transport/runtime, evidence-backed validation, and dynamic agent orchestration. Work-control, work-execution, work-node, work-environment, and work-validation remain model-agnostic; runner/gateway consumers deliberately carry a bounded Task Context Package rather than replaying complete transcripts.

| Package | Role | ctx key |
|---|---|---|
| [`work-control/`](work-control/README.md) | Stores passive ideas, promoted tasks, priority, dynamic stage plans, validation policy, and compact validation summary | `ctx.workControl` |
| [`work-execution/`](work-execution/README.md) | Stores independent execution threads and compact runner-attempt facts | `ctx.workExecution` |
| [`work-runner-subagent/`](work-runner-subagent/README.md) | Bridges isolated execution threads into registered DSH subagent providers with bounded logged context | `ctx.workSubagentRunner` |
| [`work-node/`](work-node/README.md) | Stores worker-node availability, protocol, Runner providers, and scheduler capability facts | `ctx.workNodes` |
| [`work-environment/`](work-environment/README.md) | Stores reproducible environment snapshots, exact thread bindings, and scheduler preflight | `ctx.workEnvironments` |
| [`work-node-gateway/`](work-node-gateway/README.md) | Authenticated HTTP-pull remote transport, heartbeat ownership, and durable command queue | `ctx.workNodeGateway` |
| [`work-node-daemon/`](work-node-daemon/README.md) | Remote worker runtime with signed polling, Environment reporting, command deduplication, and local Runner registry | `ctx.workNodeDaemon` |
| [`work-node-runner-codex/`](work-node-runner-codex/README.md) | Registers the existing Codex app-server runtime as a truthful remote one-shot Runner | registers on `ctx.workNodeDaemon` |
| [`work-node-runner-claude-code/`](work-node-runner-claude-code/README.md) | Registers the existing Claude Agent SDK runtime as a truthful remote one-shot Runner | registers on `ctx.workNodeDaemon` |
| [`work-validation/`](work-validation/README.md) | Stores validation generations, detailed Validator outcomes and Evidence refs, then projects compact completion state | `ctx.workValidation` |
| [`workflow/`](workflow/README.md) | Defines workflow execution and lifecycle events | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | Runs workflow scripts in worker threads | registers on `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | Exposes general workflow execution to the model | registers on `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | Exposes the fixed fresh-agent Ralph workflow | registers on `ctx.tools` |

The layers are intentionally distinct: a Task is durable global work; an ExecutionThread is one independent effort attached to it; the runner bridge binds that effort to an existing DSH provider; WorkNode describes where work may run; WorkEnvironment pins the reproducible runtime/workspace state; WorkNodeGateway transports authenticated durable remote commands without owning Runner internals; WorkNodeDaemon executes those commands through truthful local Runner adapters; WorkValidation owns detailed evidence while Work Control keeps only the board summary; a workflow run is one higher-level orchestration mechanism. Worker threads isolate workflow execution from the host event loop but are not a security boundary.

See the [global work-control](../../.agents/notes/implemented/feature/2026-08-15-global-work-control-domain.md), [execution-thread](../../.agents/notes/implemented/feature/2026-08-15-work-execution-thread-domain.md), [bounded subagent runner](../../.agents/notes/implemented/feature/2026-08-15-work-subagent-runner-bridge.md), [work-environment](../../.agents/notes/implemented/feature/2026-08-16-work-environment-snapshots.md), [remote node gateway](../../.agents/notes/implemented/feature/2026-08-16-work-node-http-pull-gateway.md), [evidence-backed validation](../../.agents/notes/implemented/feature/2026-08-16-evidence-backed-work-validation.md), [dynamic-workflow](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md), and [Ralph tool](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md) decisions. The dynamic workflow subsystem reference is [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md).
