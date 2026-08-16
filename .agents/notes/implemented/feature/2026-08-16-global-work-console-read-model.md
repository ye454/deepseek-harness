# Global Work Console read model and browser surface

Date: 2026-08-16

## Decision

The first product surface is a project-independent, read-only global Work Console. It derives current facts from Work Control, ExecutionThread, WorkNode, WorkEnvironment, and WorkValidation instead of introducing another task database or dashboard cache.

The Host surface is `@deepseek-ai/dsh-work-console`, exported to the browser through the existing Typert Remote assembly. The browser surface is `@deepseek-ai/dsh-client-ui-work-console`.

## Global rather than project-rooted

The root context is the continuous-work system itself. Project is not a root selector and is not inferred from tags. The stable board statuses are:

`unclaimed | running | blocked | validation | done`

Task-specific workflow Stage remains a separate chip/fact on each card.

## Read-model budget

`snapshot()` is intentionally compact: active Task cards, Resource Center counts, and Pending Center counts. It contains no raw logs, command output, screenshot bytes, benchmark files, transcripts, secrets, or full Evidence bodies.

`task(id)` is on-demand and expands ExecutionThreads, exact Environment placement/workspace/runtime facts, and current Validation Generation Evidence references. Large referenced artifacts remain in their owning systems and are read only when a dedicated detail/history surface needs them.

No Work Console read enters model context by default. Opening or filtering the dashboard therefore costs zero direct model tokens.

## UI composition

The existing `conversation` slot remains exclusive. V1 adds:

- `sidebar.footer.action`: one global Work Console trigger;
- `shell.overlay`: one frame-wide dashboard surface.

The package follows the client slot storage contract:

- view state (`open`, selected Task) uses one framework-declared Store Handle shared by both root registrations;
- Remote business data lives in a React-free observable controller;
- the controller enters rendering through the `hooks` inject compartment;
- `.tsx` receives `useStore`, generated `useWorkConsole`, and plain callbacks rather than importing `ctx` or manually subscribing.

## Surface

The first surface contains:

- global title and no project-root switcher;
- Resource Center strip for Nodes, Environments, and actually advertised Runner providers;
- Pending Center counts;
- search and Priority / Runner / Node filters;
- five operational columns;
- P0 emphasis;
- cards showing only real Stage, Runner, Node/Environment, Thread counts, validation counts, and Environment stale state;
- on-demand Task detail showing Thread attempts, current-generation Validator/Evidence refs, and compact Environment workspace/runtime facts.

No fabricated percentage progress is displayed.

## Deployment boundary

The config-free Work Control/Execution/Node/Environment/Validation/Console services may be part of the Web profile. Remote Gateway/Daemon and product Runner adapters remain deployment-specific because they require real node credentials, environment declarations, and installed runtimes; the default Web profile must not invent these settings.

V1 remains read-only. Mutating actions (continue, pause, switch Runner, user acceptance, rebind Environment) should be added only after their scheduler/approval semantics are exposed as explicit Host commands rather than by letting the browser mutate domain tables directly.
