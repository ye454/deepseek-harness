# @deepseek-ai/dsh-client-ui-work-console

Lightweight browser surface for the global continuous-work console.

The package contributes one `sidebar.footer.action` entry and one frame-wide `shell.overlay`. It does not replace the exclusive Conversation slot, create a parallel application shell, or own Task/Runner/Environment business state.

## Model Experience

### Context

The Work Console is a human-facing operational surface. Opening, filtering, refreshing, selecting a card, explicitly promoting an Idea, or recording a human acceptance decision does not itself add text to a model request or replay conversation history. Host facts remain outside model context.

### Trigger

A user opens **全局工作台** from the sidebar footer. The browser requests `workConsole.snapshot()` only while the surface is in use, with a five-second refresh cadence while open. Closing the surface stops polling.

Opening the surface does **not** auto-select P0 or load Task Detail. Detail is opt-in after the user selects a Task.

### Surface

The homepage has three product zones rather than a Jira-style status board:

- **想法区** — passive Idea cards. A mature Idea can be explicitly promoted by button or drag into the Execution area; the command stops at `organizing` and does not start a Runner/model/environment.
- **执行区** — organizing/running/blocked Tasks plus automated-validation work that is not yet ready for a human.
- **验收区** — only Tasks whose required automated validators are satisfied and whose required `user-acceptance` decision is actually actionable.

A compact resource strip shows Nodes, Environments, every advertised Runner provider, and the human-ready acceptance count. Search and Priority filtering remain available without turning resource/status metadata into more homepage columns.

Completed Tasks do not occupy a homepage column; the surface reports a compact completed count and leaves detailed completed work to execution history.

Task cards expose real Stage, Runner, Node placement, Thread facts, Environment staleness, and acceptance state. No percentage progress is fabricated.

Selecting a Task opens an on-demand drawer containing ExecutionThreads, current Validation Generation results/Evidence references, and compact Environment workspace/runtime facts. Human **通过 / 退回执行** controls appear only in this Evidence-first detail surface when the Task is `human-ready`; the homepage never provides a blind approval button.

Large logs, raw artifact bodies, screenshot bytes, full command output, transcripts, secrets, and chain-of-thought are not rendered through this read model.

### Recovery

Remote failure leaves the last authoritative snapshot visible and shows a dismissible error. A successful mutation refreshes the authoritative snapshot. Business conflicts such as stale WorkItem revision, stale Validation Generation, invalid validator, or automated validation not ready are rendered as explicit failures rather than optimistic success.

Environment revision mismatch is displayed as `ENV STALE`; this layer does not silently rebind or continue execution.

If a previously selected Task disappears from a refreshed snapshot, the selection is cleared. The console does not silently replace it with another Task.

The browser never sends an acceptance actor. Identity is resolved on the Host; V1 uses a harness-home-scoped audit identity and does not claim multi-user authentication.

## Client architecture

View state (`open`, selected Task) uses the framework Slot Store. Remote business data and commands live in a React-free `WorkConsoleController` and enter rendering through the slot `hooks` inject compartment. Components receive standard `useStore`, generated `useWorkConsole`, and plain callbacks; they do not import `ctx`, call Remote services directly, or manually subscribe to external stores.

Reads and explicit mutations share the generated `workConsole` Remote namespace. The UI never imports WorkControl/WorkValidation Host services or mutates durable records directly.
