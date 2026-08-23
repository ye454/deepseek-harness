# @deepseek-ai/dsh-work-environment

Durable execution-environment snapshots for the global work console. The package keeps Environment separate from Runner and Node: a Node reports one or more named environments, and an ExecutionThread is explicitly pinned to one exact environment revision before execution.

## Responsibilities

- store compact Workspace/Git, runtime, service, device, capability, and secret-reference facts;
- bind an inactive `ExecutionThread` to an exact `WorkEnvironment` revision;
- expose scheduler preflight for node availability, execute support, runner availability, environment state, and environment drift;
- refuse silent environment adoption when a bound environment changes;
- keep secret values, process logs, command history, model transcripts, and evidence outside this domain.

A binding intentionally becomes stale after `refreshEnvironment()`. The scheduler must rebind after reviewing the refreshed snapshot rather than treating a changed runtime as the same execution environment.

## Preflight

`preflight(threadId, runnerProvider?)` is read-only. It can report missing/stale binding, busy thread, environment degraded/unavailable, node degraded/offline, missing node execute support, or unavailable runner provider. P0 scheduling can use this result before allocating a Runner.

## Secret handling

Only opaque `secretRefs` are stored. This package has no field for environment-variable values, API keys, tokens, passwords, or credential material.

## Model Experience

### Environment state

#### What the model sees

Nothing. This package registers no tool, prompt section, or session event. A later orchestration consumer may select compact environment facts for a Task Context Package and owns that model-visible representation.

#### Token effect

Zero direct tokens. Environment snapshots and preflight results remain outside model requests until another consumer explicitly selects them.

#### KV Cache effect

Independent. Environment mutations do not alter model-request prefixes.

## Known Limitations and Deferred Work

- **No transport ownership** — authentication, heartbeat observation, RPC/WS transport, and remote command execution belong to the Remote Node gateway.
- **No automatic migration** — compatibility checks identify stale/unavailable environments but do not clone workspaces, install dependencies, or move devices.
- **Current snapshot only** — the domain retains the current environment record and exact binding revision; historical snapshots belong to execution history/evidence if later required.
