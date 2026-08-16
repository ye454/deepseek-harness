# @deepseek-ai/dsh-work-console

Read-only Host projection for the global continuous-work console.

The package owns no second task database and no polling cache. Every response is derived from the current Work Control, ExecutionThread, WorkNode, WorkEnvironment, and WorkValidation authorities.

## Remote surface

`workConsole.snapshot()` returns only the lightweight main-board projection: active Tasks, current Stage/Runner/placement facts, compact validation summary, Resource Center counts, and Pending Center counts.

`workConsole.task(taskId)` expands one Task on demand with its ExecutionThreads, exact Environment bindings, workspace/runtime facts, and current Validation Generation Evidence references.

Raw logs, command output, screenshot bytes, benchmark files, transcripts, secrets, and private chain-of-thought are deliberately absent. Their stable references may appear as Evidence and are fetched by dedicated detail/history surfaces when needed.

## Global semantics

The board is not rooted in a Project. Tasks from every project/domain share the same operational columns:

`待认领 | 进行中 | 阻塞 | 待确认 | 完成`

Project classification may be added later as a Task field/filter. It must not become the root selector or constrain global P0/resource scheduling.

P0 is sorted before P1/P2. No percentage progress is fabricated: the read model exposes only real workflow Stage, Thread/Attempt facts, exact Node/Environment placement, validation counts, and stale binding state.

## Resource projection

Runner availability is derived from WorkNodes that actually advertise each provider. Environment state is derived from WorkEnvironment. Native-resume capability is not inferred from a provider name; the current WorkNode capability facts remain authoritative.
