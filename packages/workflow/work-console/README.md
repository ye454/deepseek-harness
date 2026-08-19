# @deepseek-ai/dsh-work-console

Host projection and explicit human-command boundary for the global continuous-work console.

The package owns no second task database and no polling cache. Reads are derived from the current Work Control, ExecutionThread, WorkNode, WorkEnvironment, and WorkValidation authorities. Writes delegate to Work Control / WorkValidation rather than mutating their durable records directly.

## Remote surface

`workConsole.snapshot()` returns the lightweight main-product projection:

- passive Ideas;
- active Task cards and current Stage/Runner/placement facts;
- compact validation/acceptance routing state;
- Resource Center counts;
- human-ready acceptance count.

`workConsole.task(taskId)` expands one Task on demand with its ExecutionThreads, exact Environment bindings, workspace/runtime facts, and current Validation Generation Evidence references.

Two explicit write methods share the same Host-owned namespace:

- `workConsole.promoteIdea({ id, revision, priority? })` moves one passive Idea to `organizing`. It does **not** start a model, Runner, ExecutionThread, or Environment.
- `workConsole.decideAcceptance({ taskId, taskRevision, generation, validatorIndex, decision })` records one required human acceptance/return decision after required automated validators are satisfied.

The browser never supplies an acceptance actor. V1 derives a `harness-home:<anonymous-user-id>` audit actor on the Host. This is deliberately described as a local harness-home audit identity, **not** as multi-user authentication; a future authenticated identity resolver can replace that Host policy without adding an actor field to browser requests.

Raw logs, command output, screenshot bytes, benchmark files, transcripts, secrets, and private chain-of-thought are deliberately absent. Their stable references may appear as Evidence and are fetched by dedicated detail/history surfaces when needed.

## Global semantics

The product root is the global continuous-work system, not a Project. Project classification may be added later as a Task field/filter; it must not become the root selector or constrain global P0/resource scheduling.

The Host retains stable operational Task status (`unclaimed | running | blocked | validation | done`) because execution policy depends on it, but the lightweight homepage is **not** a five-column status board. The browser groups the read model into:

`想法区 | 执行区 | 验收区`

Task-specific Workflow Stage remains separate from those product zones.

## Acceptance routing

Validation projection separates automated readiness from human acceptance:

- `automated-pending` — required automated validators are not complete;
- `automated-failed` — a required automated validator failed;
- `human-ready` — required automated validators have passed and at least one required `user-acceptance` entry remains;
- `passed` — all required validation has passed.

Only `human-ready` Tasks contribute to `pendingUserAcceptance`. A human approval requirement is not actionable while automated validation is pending or failed.

Human decisions use Task revision + Validation Generation + validator index as concurrency fences. `accept` reaches `done` only when every required gate is passed; if another required human gate remains, the Task stays in `validation`. `return` records the failed human decision and moves the Task back to `running`, where Work Control invalidates the compact prior validation summary so later completion requires a fresh validation generation.

Expected stale/missing/not-ready conditions return typed business failures. Storage/runtime faults still throw; the UI must not turn infrastructure uncertainty into a successful decision.

## Resource and token projection

Runner availability is derived from WorkNodes that actually advertise each provider. Environment state is derived from WorkEnvironment. Native-resume capability is not inferred from a provider name; WorkNode capability facts remain authoritative.

P0 is sorted ahead of P1/P2. No percentage progress is fabricated. Opening, filtering, promoting an Idea, or recording a human acceptance decision adds zero direct model tokens. Model tokens begin only when a later execution/orchestration action actually invokes a Runner.
