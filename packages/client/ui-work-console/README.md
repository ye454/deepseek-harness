# @deepseek-ai/dsh-client-ui-work-console

Read-only browser surface for the global continuous-work console.

The package contributes one `sidebar.footer.action` entry and one frame-wide `shell.overlay`. It does not replace the exclusive Conversation slot, create a parallel application shell, or own Task/Runner/Environment business state.

## Model Experience

### Context

The Work Console is a human-facing operational surface. Opening, filtering, refreshing, or selecting a card does not add text to a model request and does not replay conversation history. Host facts remain outside model context.

### Trigger

A user opens **全局工作台** from the sidebar footer. The browser requests `workConsole.snapshot()` only while the surface is in use, with a five-second refresh cadence while open. Closing the surface stops polling.

Opening the surface does **not** auto-select P0 or load Task Detail. Detail is opt-in after the user selects a Task.

### Surface

The first version is intentionally read-only and lightweight. The homepage has three product zones rather than a Jira-style status board:

- **想法区** — passive Idea cards only; recording/displaying an Idea does not start a Runner or environment;
- **执行区** — organizing/running/blocked Tasks plus automated-validation work that is not yet ready for a human;
- **验收区** — only Tasks whose required automated validators are satisfied and whose required `user-acceptance` decision is now actionable.

A compact resource strip shows Nodes, Environments, every advertised Runner provider, and the human-ready acceptance count. Search and Priority filtering remain available without turning resource/status metadata into more homepage columns.

Completed Tasks do not occupy a homepage column; the surface reports a compact completed count and leaves detailed completed work to execution history.

Task cards expose real Stage, Runner, Node placement, Thread facts, Environment staleness, and acceptance state. No percentage progress is fabricated.

Selecting a Task opens an on-demand drawer containing ExecutionThreads, current Validation Generation results/Evidence references, and compact Environment workspace/runtime facts.

Large logs, raw artifact bodies, screenshot bytes, full command output, transcripts, secrets, and chain-of-thought are not rendered through this read model.

### Recovery

Remote read failure leaves the last authoritative snapshot visible and shows a dismissible transport error. Refresh retries the read. Environment revision mismatch is displayed as `ENV STALE`; the read-only V1 does not silently rebind or continue execution.

If a previously selected Task disappears from a refreshed snapshot, the selection is cleared. The console does not silently replace it with another Task.

## Client architecture

View state (`open`, selected Task) uses the framework Slot Store. Remote business data lives in a React-free `WorkConsoleController` and enters rendering through the slot `hooks` inject compartment. Components receive standard `useStore`, generated `useWorkConsole`, and plain callbacks; they do not import `ctx`, call Remote services directly, or manually subscribe to external stores.
