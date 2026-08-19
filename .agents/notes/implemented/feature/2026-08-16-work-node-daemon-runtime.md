# Agent Note: durable remote WorkNode daemon runtime

Status: implemented

## Problem

The central WorkNode gateway can authenticate workers and persist commands, but a remote machine still needs a runtime that owns polling, command-id deduplication, local Runner handles, environment collection, cancellation, and crash recovery. Reusing the in-process DSH Subagent provider contract directly is incorrect because that contract requires a real parent Agent and some providers derive parent context/cwd from it; a remote worker should not create a fake parent merely to satisfy a type.

The gateway uses at-least-once command delivery while queued. A worker that only keeps command state in memory could launch the same Runner twice after a reconnect or forget what happened after a daemon restart.

## Decision

`@deepseek-ai/dsh-work-node-daemon` is a remote-side service with three responsibilities: signed gateway polling, a durable local command journal, and a registry of daemon-local Runner providers.

### Runner provider contract

A provider receives only the inputs it actually needs at the remote process boundary: command id, bounded prompt, cwd, cancellation signal, requested mode, and optional native resume session. It returns an owned handle with a truthful optional native session id, cancellation, disposal, and a terminal result promise.

The daemon derives advertised Node capabilities from registered providers. `resume` is never advertised merely because the protocol supports it. Current built-in Harness `codex`, `claude-code`, and `dsh-sdk` Subagent providers are one-shot; production remote adapters for them remain separate plugins and must preserve that fact unless their underlying runtime genuinely supports native continuation.

### Durable deduplication journal

Before starting a new Runner the daemon persists a journal row keyed by the central `RemoteNodeCommandId`. Duplicate poll deliveries consult the row rather than starting another Runner. The journal records publication, central acceptance, terminal stop reason, and whether the terminal result was confirmed by the gateway.

A settled local Runner can therefore retry ack/result after a transient network failure even though the central accepted command is no longer redelivered.

### Restart recovery

Process-local Runner handles are never reconstructed from persisted ids. On a new daemon activation, nonterminal journal records are reconciled with the gateway. If the central command is still queued, the daemon refuses the interrupted execution. If the central command is already accepted, the daemon sends terminal `unknown` because it no longer owns the Runner handle. If the central command is already terminal, local state converges to that result.

This favors truthful uncertainty over false success and avoids orphaned work being represented as completed.

### Environment collection

Configured environments are explicit workspace roots. The built-in collector resolves Git through the DSH subprocess capability and reports canonical workspace path, origin, branch, commit, dirty state, Node version, OS/architecture, and configured capability/device/secret-reference labels. Git inspection failure produces a degraded environment while preserving heartbeat availability.

Secret values are never collected or serialized.

### Lifecycle

The daemon can load while the central gateway is offline. Its background loop retries hello/poll and only resets node identity negotiation on explicit stale/hello-required responses. Disposal aborts polling and cancels/disposes every daemon-owned Runner handle.

## Token consequences

The daemon does not construct a second prompt. It forwards the gateway command's already-bounded Task Context Package verbatim to the selected Runner provider. Journal, heartbeat, Environment and command state remain model-agnostic.

## Alternatives rejected

- **Use `ctx.subagents.start()` with a fake parent Agent** — rejected because parent Agent identity/context is a real provider contract, not a placeholder field.
- **Store dedup state only in memory** — rejected because restart/reconnect could duplicate external side effects.
- **Assume live OS processes survive daemon restart and are resumable** — rejected because the daemon no longer owns a cancellation/result handle.
- **Advertise protocol-level resume for every provider** — rejected because current Claude Code/Codex/DSH providers are one-shot.
- **Make Git/runtime probes implicit arbitrary shell commands** — rejected; the built-in collector is narrow and all command/output/termination limits are explicit configuration.

## Deferred work

- production Runner adapter plugins for Claude Code, Codex, and DSH;
- structured Runner output, Handoff and Evidence upload;
- richer Service/Device environment probes;
- streamable tool/usage events;
- optional OS-process reattachment only if a provider/runtime can prove stable ownership semantics.
