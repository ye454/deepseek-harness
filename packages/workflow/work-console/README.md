# @deepseek-ai/dsh-work-console

Host projection and explicit human-command boundary for the global continuous-work console.

The package owns no second task database and no polling cache. Reads are derived from the current Work Control, ExecutionThread, WorkNode, WorkEnvironment, WorkValidation, and optional WorkOrchestrator authorities. Writes delegate to those owning services rather than mutating their durable records directly.

## Remote surface

`workConsole.snapshot()` returns the lightweight main-product projection:

- passive Ideas;
- active Task cards and current Stage/Runner/placement facts;
- compact validation/acceptance routing state;
- Resource Center counts;
- human-ready acceptance count.

`workConsole.task(taskId)` expands one Task on demand with its ExecutionThreads, exact Environment bindings, workspace/runtime facts, and current Validation Generation Evidence references.

`workConsole.executionPlan(taskId)` is also on demand. It returns current zero-token scheduler candidates only for an organized `running` Task that owns no nonterminal ExecutionThread. Each candidate carries its exact Environment revision, Node, advertised Runner providers, workspace/worktree facts, lease state, and compact availability issues. It never starts a Runner.

Explicit writes share the same Host-owned namespace:

- `workConsole.createIdea(...)` records one passive Idea only;
- `workConsole.promoteIdea({ id, revision, priority? })` moves one passive Idea to `organizing`;
- `workConsole.organizeTask(...)` commits a human-selected deterministic Workflow/Validation template;
- `workConsole.startExecution(...)` submits an explicit Environment revision + Runner provider + role plan to WorkOrchestrator;
- `workConsole.decideAcceptance(...)` records one required human acceptance/return decision after required automated validators are satisfied.

Idea capture, promotion and organization do **not** start a model, Runner, ExecutionThread, or Environment. Execution begins only after an explicit `startExecution` request is accepted by the Orchestrator.

WorkOrchestrator is an optional capability from the Work Console package's perspective. Without it, the original Idea/Task/Acceptance console remains usable and execution-plan reads report no dispatch capability. In the default Web bundle, the config-free Orchestrator resource projection is mounted; remote Gateway transport is still deployment-optional.

The browser never supplies an acceptance actor. V1 derives a `harness-home:<anonymous-user-id>` audit actor on the Host. This is deliberately described as a local harness-home audit identity, **not** as multi-user authentication; a future authenticated identity resolver can replace that Host policy without adding an actor field to browser requests.

Raw logs, command output, screenshot bytes, benchmark files, transcripts, secrets, and private chain-of-thought are deliberately absent. Their stable references may appear as Evidence and are fetched by dedicated detail/history surfaces when needed.

## Global semantics

The product root is the global continuous-work system, not a Project. Project classification may be added later as a Task field/filter; it must not become the root selector or constrain global P0/resource scheduling.

The Host retains stable operational Task status (`unclaimed | running | blocked | validation | done`) because execution policy depends on it, but the lightweight homepage is **not** a five-column status board. The browser groups the read model into:

`想法区 | 执行区 | 验收区`

Task-specific Workflow Stage remains separate from those product zones. Runner/Environment execution-plan controls stay inside Task Detail rather than expanding the homepage into a resource cockpit.

## Execution routing

Execution plans are explicit rather than inferred from Task prose.

- P1/P2 submit exactly one Environment/Runner/role placement.
- P0 may submit up to three independent placements.
- Every placement pins an exact current Environment revision.
- Parallel roles must pass the Orchestrator's workspace/worktree isolation and lease checks.
- Candidate discovery and execution submission are separate operations; the Orchestrator revalidates all facts at dispatch time.
- Successful submission means durable remote commands were queued. A Runner is not shown as running until the node daemon actually publishes/acknowledges the attempt.
- A partial fan-out is reported truthfully with the already-queued placements and failed index; it is not presented as an atomic rollback.

Closed/cancelled historical ExecutionThreads do not permanently block a Task from a later fresh dispatch. Nonterminal threads do.

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

P0 is sorted ahead of P1/P2. No percentage progress is fabricated. Opening, filtering, capturing/promoting/organizing an Idea, reading execution candidates, or recording a human acceptance decision adds zero direct model tokens. Model tokens begin only when an execution action reaches a real Runner.
