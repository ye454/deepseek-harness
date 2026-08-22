# @deepseek-ai/dsh-work-execution-coordinator

Event-driven workflow progression for durable global work.

This package is deliberately thin. It owns no second Task, Thread, Environment, command, or Validation store. It observes committed WorkControl / WorkExecution / WorkNodeGateway facts and coordinates the existing authorities.

## Lifecycle contract

The coordinator never treats a Runner's prose as proof that work is correct.

A published execution attempt is stamped by WorkExecution with the Task's current `stageId`. That compact coordinate lets restart recovery distinguish:

- a completed attempt for the current Stage;
- an older completed attempt that must be continued into the current Stage;
- an old record without a Stage coordinate, which is blocked rather than guessed.

For a running Task:

1. A live Runner means `waiting`.
2. Any failed/refused/limited/cancelled current execution blocks the Task.
3. P0 fan-out waits for the current Stage's selected Threads to settle successfully.
4. After the first successful P0 Stage, the oldest deterministic Thread becomes the primary continuation Thread and the other inactive fan-out Threads are closed.
5. Advancing to a non-validation Stage reuses that primary Thread through the WorkOrchestrator continuation boundary.
6. Advancing to a `validation` Stage, or completing the final workflow Stage, calls WorkValidation to open a fresh Validation Generation.
7. Validator results and human acceptance remain owned by WorkValidation / WorkConsole. Runner completion alone never completes a Task.

## Restart safety

The service reconciles existing durable Threads during initialization and after every relevant WorkControl / WorkExecution change.

The Stage is mutated before the next remote command is queued. If the Host stops in that gap, the retained Attempt `stageId` proves that the primary Thread completed the prior Stage and still needs dispatch for the current one.

The Orchestrator continuation helper is idempotent over an already-open remote command, preventing duplicate queueing after restart.

## Environment continuation

A previous Stage may change the workspace, causing the same WorkEnvironment to publish a newer revision. Continuation never runs against the stale binding. The Orchestrator explicitly rebinds the inactive Thread to the current revision of the same Environment, then re-runs Environment/Node/Runner/workspace-lease preflight before queueing work.

A degraded/unavailable Environment, unavailable Runner, foreign workspace lease, or missing remote Gateway blocks continuation rather than silently changing resources.

## Model Experience

### What the model sees

Nothing directly. This plugin registers no model tool and injects no prompt section. Only an actual remote execution command can start a Runner. Its handoff is a compact current-Stage `nextStep`, not transcript replay or private chain-of-thought.

### Token effect

Zero while reconciling Task/Thread state. Model tokens begin only after WorkOrchestrator successfully queues real Runner work.

### KV cache effect

The coordinator itself does not alter model request prefixes. Cross-Stage work uses bounded task context assembled by the existing WorkNodeGateway/runner handoff path.

## Failure semantics

Remote command rejection is a durable blocking fact. An idle rejected Thread is marked blocked and the Task moves to `blocked`; sibling queued commands subsequently fail their normal Task-state admission instead of pretending the fan-out remained healthy.

Completed sibling Threads are closed when safe to release workspace leases. A live sibling Runner is not force-killed by this package; its eventual settlement remains durable history, while the blocked Task prevents new Stage progression.

## Known limitations

- Automated Validator executors are a separate layer; entering Validation opens the generation but does not fabricate test/visual/benchmark results.
- Recovery UI for a blocked Task/Thread is still separate work.
- Pre-coordinate historical Attempts (`stageId` absent) require manual recovery instead of automatic Stage advancement.
- P0 fan-out currently converges to one deterministic primary Thread after the first Stage; later Stage-specific fan-out policy is deferred.
