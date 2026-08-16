# Agent Note: durable execution-environment snapshots

Status: implemented

## Problem

Long-lived work can move between agents, processes, and machines. A Runner name or Node identity does not prove that the executable workspace, Git state, runtime versions, services, or attached devices still match the state in which an ExecutionThread was prepared. Silently adopting a later environment report can make a resumed task appear continuous while actually changing its execution conditions.

The global work console also needs a compact resource preflight without copying complete shell history, process tables, secrets, or model transcripts into every task context.

## Decision

`@deepseek-ai/dsh-work-environment` owns durable current environment snapshots and explicit ExecutionThread bindings.

A `WorkEnvironment` belongs to one `WorkNode` and stores a compact snapshot: workspace/Git facts, OS/architecture/runtime versions, named service status, device identifiers, scheduler capabilities, and opaque secret references. Secret values are not representable in the durable type.

An ExecutionThread binding pins `environmentId + environmentRevision + nodeId`. Refreshing an environment increments its revision and intentionally makes existing bindings stale. The scheduler or user must explicitly rebind before execution continues under the new snapshot.

The package exposes read-only `preflight(threadId, runnerProvider?)`. Preflight checks thread idleness, binding presence, exact environment revision, environment state, node state, node `execute` support, and optional runner availability. It does not reserve resources or start work.

Environment reporting requires a known non-offline WorkNode that advertises `environment-report`. Authentication and transport remain outside this package; the future Remote Node gateway owns the decision that an incoming report is authorized to update a node.

## DSH integration

The capability is a plugin/service layered on existing extension points. It does not change `dsh-agent-loop`, does not create Agents, and does not register model-visible tools or prompt sections. Storage uses `storage-domain`, while thread and node facts are read from `ctx.workExecution` and `ctx.workNodes`.

## Token and continuity consequences

Environment state adds zero direct model tokens. A later orchestration consumer may include only task-relevant environment facts in the bounded Task Context Package. Cross-runner continuity therefore remains conclusions + references + current operational state rather than transcript replay.

## Alternatives rejected

- **Store Environment inside Runner** — rejected because the same workspace/runtime can serve several Runner providers and survives Runner replacement.
- **Store Environment inside Node** — rejected because one node may host multiple workspaces/containers/runtime combinations.
- **Always use the latest environment revision** — rejected because it hides environment drift during resume/migration.
- **Persist raw environment variables/process tables** — rejected because they increase secret exposure and durable noise without serving the scheduler's current contract.

## Deferred work

- authenticated Remote Node gateway and heartbeat ownership;
- resource leases/reservations for P0 scheduling;
- historical environment/evidence timeline;
- automatic compatibility and migration actions beyond the current preflight facts.
