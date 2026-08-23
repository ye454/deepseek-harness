# @deepseek-ai/dsh-work-execution

English | [中文](README.zh.md)

Durable execution-thread domain for the global work console. A Task remains the long-lived objective in `@deepseek-ai/dsh-work-control`; an `ExecutionThread` is one independent execution effort attached to that task. A task may own several threads, which gives later P0 scheduling a safe fan-out unit without making several runners mutate one thread concurrently.

This package records execution facts only. It does not start Claude Code, Codex, DSH, or any other runner itself; a runner consumer publishes the real runner first, then records that attempt here. It also does not store transcripts, chain-of-thought, detailed logs, evidence payloads, environments, or Remote Node state.

## Thread lifecycle

```text
idle ── begin published attempt ──> running
  │                                  │
  ├─ block ──> blocked ── resume ────┘
  │                                  │
  ├─ close ──> closed                └─ settle ──> idle
  └─ cancel ─> cancelled
```

A thread admits at most one active attempt. Multiple parallel efforts use multiple threads. New or resumed execution is admitted only while the owning Task is `running`; a globally blocked, validating, completed, cancelled, organizing, or still-passive work item cannot start more execution work.

## Runner continuity

Each attempt records `mode: one-shot | continuable` and an optional DSH subagent session id. The value is descriptive evidence supplied after a real runner publishes; this package never upgrades a one-shot provider into a resumable session.

That distinction matters for the current DSH ecosystem: a later runner bridge can map providers truthfully and use a compact Handoff/Task Context Package when switching between providers that do not share native continuation. Native resume and system-level continuation remain separate concepts.

## Storage

The package opens the `work-execution` storage domain with one `threads` table. Records keep only current execution state, the active attempt, and the most recently settled attempt. Full attempt history belongs to a later execution-history/evidence capability so the global work record stays bounded.

Every mutation uses `ExecutionThreadRef { id, revision }` compare-and-set protection. `work-execution/changed` is emitted after durability; observer failures are contained because they cannot roll back an already committed thread mutation.

## Composition

The package ships an opt-in bundle patch and requires both `ctx.storageDomain` and `ctx.workControl`:

```sh
dsh plugin --profile web add <path-to-work-control>
dsh plugin --profile web add <path-to-work-execution>
```

The storage backend/domain must already be mounted by the selected DSH composition.

## Model Experience

### Execution-thread state

#### What the model sees

Nothing directly. This package registers no model tool, prompt section, conversation message, or runner. A later organizer/runner consumer chooses a bounded Task Context Package and records runner publication separately.

#### Token effect

Zero direct tokens. Thread state, provider names, attempt counters, and settlement metadata remain outside model requests unless another consumer explicitly selects them.

#### KV Cache effect

Independent. Durable execution-thread mutations do not alter any model request prefix.

## Known Limitations and Deferred Work

- **No runner bridge yet** — this domain does not call `ctx.subagents`; provider capability detection, real runner publication, cancellation, and settlement mapping belong to a separate consumer.
- **No Environment or Remote Node attachment yet** — execution location and runtime compatibility are separate capabilities.
- **No full history/evidence store yet** — only the active and most recently settled attempt are retained here; complete event history is intentionally deferred.
- **No automatic Task status mutation** — one runner result cannot by itself decide whether a multi-thread Task is blocked, ready for validation, or complete; an organizer/coordinator owns that policy.
