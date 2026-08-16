# Agent Note: Durable work execution threads

Status: implemented

## Problem

A global Task is too coarse to represent one concrete execution effort. One Task may need retries, a provider switch, an isolated experiment, or several safe P0 branches. Treating the Task itself as the runner session would collapse those independent efforts and make parallelism, handoff, and failure attribution ambiguous.

Runner identity also cannot imply native continuation. DeepSeek Harness already exposes a subagent provider registry, but providers differ: some can support continuable children while external Claude Code, Codex, and DSH SDK providers may be one-shot. The work console needs a durable runner-neutral record that preserves that difference rather than pretending every provider can resume the same native conversation.

## Decision

Add `@deepseek-ai/dsh-work-execution` as a separate storage-backed domain. An `ExecutionThread` belongs to one `WorkItemId` and represents one independent execution effort. A Task can own several threads; safe P0 fan-out therefore allocates multiple threads rather than placing multiple active writers into one thread.

Each thread has a compare-and-set revision and at most one active attempt. An attempt records only its sequence, provider name, factual mode (`one-shot` or `continuable`), optional DSH subagent session id, and timestamps. Settlement retains a compact runner-neutral stop reason as the most recent result. Full output, model reasoning, detailed logs, evidence, environment, and Remote Node state are intentionally not retained in the thread record.

A runner consumer must publish the real runner before calling `beginAttempt()`. This prevents a durable work record from claiming execution that never started. Likewise this domain does not call `ctx.subagents` itself; the future bridge owns provider capability detection, publication, cancellation, and result mapping.

Only Tasks currently in `running` admit a new or resumed execution thread. A Task-level blocker therefore stops new execution admission until the Task returns to running. Thread-local blocking is distinct: it records that one execution effort is waiting while the Task may still have other runnable threads.

Native continuation and system continuation remain separate. A `continuable` attempt may carry a durable child session id. A `one-shot` attempt is never upgraded by this domain; switching providers or machines later uses a compact Handoff / Task Context Package owned by the orchestration layer.

## Boundaries

The domain owns no Runner adapter, Agent loop behavior, workflow generation, task completion policy, environment, node, evidence store, transcript, or context compaction. It emits only `work-execution/changed` after durable commit. Observer failures are contained because the commit point has already passed. A package invariant checks every change event against the durable service projection.

## Consequences

- One Task can have multiple independent threads without losing a stable Task identity.
- A thread cannot report two simultaneous active runners.
- P0 parallelism has an explicit isolation unit instead of relying on prompt discipline.
- Provider capability facts stay truthful; one-shot and continuable execution are not conflated.
- Execution history can grow independently in a later append-only evidence/history capability without inflating the global task record.
- A single runner result cannot automatically complete a multi-thread Task; organizer/coordinator policy remains authoritative.

## Known limitations and deferred work

- Runner publication and settlement are not yet wired to `ctx.subagents`; that bridge is a separate consumer.
- Environment/Remote Node compatibility and leases are not part of this domain.
- Full execution history and evidence are not retained yet.
- Runtime verification assets are added with the package before merge readiness; no passing CI result is implied until the repository actually executes them.
