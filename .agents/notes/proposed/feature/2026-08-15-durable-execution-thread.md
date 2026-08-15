# Agent Note: Durable execution threads over continuable subagents

Status: proposed

## Problem

Global work-control needs a durable execution identity after an idea is promoted and organized. A task may be handled by Claude Code, Codex, an in-process DSH child, or another provider exposed through the existing subagent registry. The work item must survive provider changes and process restarts without treating one conversation turn as the task itself.

Replaying a complete conversation into every new runner wastes input tokens and mixes operational facts with model-private reasoning. The execution layer therefore needs a compact, inspectable record that can point at the native DSH child Session and carry only the minimum handoff needed for continuation.

## Decision

Add `@deepseek-ai/dsh-execution-thread` as a separate Host package under `packages/workflow/execution-thread`. It depends on `ctx.workControl`, `ctx.subagents`, and `ctx.storageDomain`; it does not modify `dsh-agent-loop`.

One thread owns a stable `ExecutionThreadId`, task id, provider name, parent Session id, optional child Session id, lifecycle state, and compact handoff. `start()` first persists a `starting` record, then calls `ctx.subagents.startContinuable()` so the existing provider layer owns child creation, persistence, cold resume, cancellation authority, and model/tool policy. On child acceptance the record becomes `running`.

`pause()` calls the existing `ctx.subagents.interrupt()` using the exact live ancestor Agent, then records `paused` while preserving the child Session. `continue()` sends a later turn through `ctx.subagents.followup()` to the same child id. This keeps native continuation native: Claude Code/Codex/DSH providers retain their own Session/runtime behavior below the subagent seam instead of the work-control layer emulating it.

The handoff record is deliberately bounded to `summary` and `nextStep`. It stores conclusions and operational state, not chain-of-thought. Future cross-runner continuation will combine this handoff with work-item metadata, Git/environment evidence, and on-demand history reads.

## Consequences

- Work items remain global objectives while execution threads are individual attempts.
- A task can accumulate multiple threads without changing its stable id.
- Provider-specific child lifecycle stays in `dsh-subagent`; this package only coordinates and records the relation.
- Thread updates add zero direct model tokens because the package registers no prompt or tool surface.
- Remote Node/environment attachment, resource leases, evidence, and validators remain separate follow-up capabilities.

## Known limitations

- Child inbox acceptance and thread-domain writes cannot commit atomically across services. A reconciliation policy is still required for storage failure after child acceptance.
- A continuable child's `subagent/end` marks one activation settlement, not necessarily task completion, so terminal thread status is explicit rather than inferred.
- Pausing interrupts active work cooperatively; provider/Agent cancellation may take time to converge after the durable thread state changes.
