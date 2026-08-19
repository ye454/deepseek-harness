# @deepseek-ai/dsh-work-console

Read-only Host projection for the global continuous-work console.

The package owns no second task database and no polling cache. Every response is derived from the current Work Control, ExecutionThread, WorkNode, WorkEnvironment, and WorkValidation authorities.

## Remote surface

`workConsole.snapshot()` returns the lightweight main-product projection:

- passive Ideas;
- active Task cards and current Stage/Runner/placement facts;
- compact validation/acceptance routing state;
- Resource Center counts;
- human-ready acceptance count.

`workConsole.task(taskId)` expands one Task on demand with its ExecutionThreads, exact Environment bindings, workspace/runtime facts, and current Validation Generation Evidence references.

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

Only `human-ready` tasks contribute to `pendingUserAcceptance`. A human approval requirement is not shown as actionable while automated validation is pending or failed.

This read model never records the human decision itself. Write-side approval/identity semantics remain a separate Host command boundary.

## Resource and token projection

Runner availability is derived from WorkNodes that actually advertise each provider. Environment state is derived from WorkEnvironment. Native-resume capability is not inferred from a provider name; WorkNode capability facts remain authoritative.

P0 is sorted ahead of P1/P2. No percentage progress is fabricated. Opening or filtering the Work Console adds zero direct model tokens.
