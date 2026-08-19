# Global Work Console read model and browser surface

Date: 2026-08-16

## Decision

The first product surface is a project-independent, read-only global Work Console. It derives current facts from Work Control, ExecutionThread, WorkNode, WorkEnvironment, and WorkValidation instead of introducing another task database or dashboard cache.

The Host surface is `@deepseek-ai/dsh-work-console`, exported to the browser through the existing Typert Remote assembly. The browser surface is `@deepseek-ai/dsh-client-ui-work-console`.

## Global rather than project-rooted

The root context is the continuous-work system itself. Project is not a root selector and is not inferred from tags.

Operational Task status remains durable domain vocabulary, but the product homepage deliberately does not mirror those statuses as five permanent Kanban columns. The human-facing root has three zones:

`想法区 | 执行区 | 验收区`

Task-specific Workflow Stage remains a separate fact on each Task.

## Idea boundary

Ideas are passive Work Control records. `snapshot()` projects them independently from Tasks. Rendering or refreshing the Idea area does not promote the Idea, create an ExecutionThread, choose a Runner, start an Environment, or invoke a model.

Promotion remains an explicit user-side decision outside the read-only V1.

## Acceptance boundary

The read model derives a compact acceptance state from the current validation generation:

- `automated-pending`: required automated validation is incomplete;
- `automated-failed`: required automated validation failed;
- `human-ready`: all required automated validators passed and required user acceptance remains;
- `passed`: all required validation passed.

Only `human-ready` contributes to the human acceptance count and the browser Acceptance zone. This prevents a Task whose automated validation is still pending/failed from asking the user to approve it prematurely.

The read model does not record user decisions. A future write-side surface must use an explicit Host-owned approval/identity command instead of letting the browser mutate WorkValidation directly or supply an arbitrary actor string.

## Read-model budget

`snapshot()` is intentionally compact: Idea cards, active Task cards, Resource Center facts, and actionable acceptance counts. It contains no raw logs, command output, screenshot bytes, benchmark files, transcripts, secrets, or full Evidence bodies.

`task(id)` is on-demand and expands ExecutionThreads, exact Environment placement/workspace/runtime facts, and current Validation Generation Evidence references. Large referenced artifacts remain in their owning systems and are read only when a dedicated detail/history surface needs them.

No Work Console read enters model context by default. Opening or filtering the dashboard therefore costs zero direct model tokens.

## UI composition

The existing `conversation` slot remains exclusive. V1 adds:

- `sidebar.footer.action`: one global Work Console trigger;
- `shell.overlay`: one frame-wide product surface.

The package follows the client slot storage contract:

- view state (`open`, selected Task) uses one framework-declared Store Handle shared by both root registrations;
- Remote business data lives in a React-free observable controller;
- the controller enters rendering through the `hooks` inject compartment;
- `.tsx` receives `useStore`, generated `useWorkConsole`, and plain callbacks rather than importing `ctx` or manually subscribing.

Opening the Work Console refreshes the global snapshot but does not auto-select P0 or load Task Detail. Task Detail is opt-in and appears as a drawer after explicit selection. If the selected Task disappears on refresh, selection clears instead of silently jumping to another Task.

## Surface

The lightweight surface contains:

- compact global title and no project-root switcher;
- Resource strip for Nodes, Environments, every actually advertised Runner provider, and human-ready acceptance count;
- search and Priority filtering;
- passive Idea cards;
- Execution zone for organizing/running/blocked/automated-validation work;
- Acceptance zone only for `human-ready` Tasks;
- P0 emphasis;
- cards showing only real Stage, Runner, Node/Environment, Thread facts, and Environment stale state;
- on-demand Task drawer showing Thread attempts, current-generation Validator/Evidence refs, and compact Environment workspace/runtime facts.

Completed Tasks do not consume a homepage column; only a compact count remains, with detailed history delegated to the execution-history surface.

No fabricated percentage progress is displayed.

## Deployment boundary

The config-free Work Control/Execution/Node/Environment/Validation/Console services may be part of the Web profile. Remote Gateway/Daemon and product Runner adapters remain deployment-specific because they require real node credentials, environment declarations, and installed runtimes; the default Web profile must not invent these settings.

V1 remains read-only. Mutating actions (promote Idea, continue, pause, switch Runner, user acceptance, rebind Environment) should be added only after their scheduler/approval semantics are exposed as explicit Host commands rather than by letting the browser mutate domain tables directly.
