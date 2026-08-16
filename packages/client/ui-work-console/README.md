# @deepseek-ai/dsh-client-ui-work-console

Read-only browser surface for the global continuous-work console.

The package contributes one `sidebar.footer.action` entry and one frame-wide `shell.overlay`. It does not replace the exclusive Conversation slot, does not create a parallel application shell, and does not own Task/Runner/Environment business state.

## Model Experience

### Context

The Work Console is a human-facing operational surface. Opening, filtering, refreshing, or selecting a card does not add text to a model request and does not replay conversation history. The Host read model remains outside model context.

### Trigger

A user opens **全局工作台** from the sidebar footer. The browser requests `workConsole.snapshot()` only while the surface is in use, with a five-second refresh cadence while open. Closing the surface stops that polling.

### Surface

The first version is intentionally read-only:

- global title with no project-root selector;
- Resource Center summary for Nodes, Environments, and actually advertised Runner providers;
- Pending Center counts;
- search plus Priority / Runner / Node filters;
- stable operational columns `待认领 | 进行中 | 阻塞 | 待确认 | 完成`;
- P0 visual emphasis without fabricated progress percentages;
- Task cards showing real dynamic Stage, current Runner, Node/Environment placement, Thread counts, validation counts, and stale Environment warnings;
- on-demand right-side Task Detail for ExecutionThreads, current Validation Generation Evidence references, and compact Environment workspace/runtime facts.

Large logs, raw artifact bodies, screenshot bytes, full command output, transcripts, secrets, and chain-of-thought are not rendered through this read model.

### Recovery

Remote read failure leaves the last authoritative snapshot visible and shows a dismissible transport error. Refresh retries the read. Environment revision mismatch is displayed as `ENV STALE`; the read-only V1 does not silently rebind or continue execution. When no selected Task survives a refresh, selection falls back to P0, then a running Task, then the first Task.

## Client architecture

View state (`open`, selected Task) uses the framework Slot Store. Remote business data lives in a React-free `WorkConsoleController` and enters rendering through the slot `hooks` inject compartment. Components receive standard `useStore`, generated `useWorkConsole`, and plain callbacks; they do not import `ctx`, call Remote services directly, or manually subscribe to external stores.
