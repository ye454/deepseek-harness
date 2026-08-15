# @deepseek-ai/dsh-execution-thread

Durable execution attempts for global work-control tasks. The package binds one task attempt to a DSH continuable subagent provider and child Session while keeping task state, validation, Remote Nodes, and UI outside this service.

A thread persists only compact operational state: the task id, provider, parent/child Session ids, lifecycle state, and an optional handoff summary. It never copies a full conversation or private reasoning into the work-control domain.

## Lifecycle

```text
starting -> running -> paused -> running
                    -> blocked -> running
                    -> completed | failed | cancelled
```

`start()` first writes a durable `starting` record, then asks `ctx.subagents.startContinuable()` to establish the child. A successful child acceptance updates the record to `running`; startup failure records `failed` on a best-effort basis and rethrows the original error.

`pause()` uses the exact live parent Agent as authority and calls `ctx.subagents.interrupt()` without destroying the durable child Session. `continue()` sends the next turn through `ctx.subagents.followup()` and reuses the same child Session, so a provider that supports cold continuation can resume after process loss through the existing DSH subagent layer.

`setHandoff()` stores only `summary`, `nextStep`, and timestamp. Cross-runner migration will consume this compact record together with work-item and environment evidence rather than replaying complete chat history.

## Model Experience

### Execution-thread state

#### What the model sees

Nothing directly. This package registers no model tool, prompt section, or automatic context injection. A future task-board or runner consumer may render selected thread fields through its own documented surface.

#### Token effect

Zero direct tokens. Durable thread and handoff records remain outside model requests until another consumer explicitly retrieves them.

#### KV Cache effect

Independent. Creating, pausing, continuing, or updating a thread does not itself alter any model-request prefix.

## Known Limitations and Deferred Work

- **No Remote Node binding yet** — the thread binds to a DSH continuable provider and Session only; node/environment compatibility and leases are a later capability.
- **No automatic completion inference** — a continuable child can have multiple activation epochs, so this package does not interpret one `subagent/end` event as task completion. A later execution policy/validator consumer records terminal outcome.
- **Cross-service commit is not atomic** — child inbox acceptance and the thread-domain update are separate durable systems. A storage failure after child acceptance can leave a child with an older thread projection; recovery/reconciliation is deferred to the execution policy layer.
