# @deepseek-ai/dsh-work-node-gateway

Authenticated HTTP-pull transport and durable command queue for the global work console. Remote worker daemons initiate every connection, so the central Harness does not require inbound reachability to worker machines and queued work survives transient disconnects.

## Protocol

The Host registers four exact POST routes on `ctx.webServer`:

- `/work-node/v1/hello` — establish/recover the configured `nodeKey` → durable `WorkNodeId` identity;
- `/work-node/v1/poll` — heartbeat, capability/environment report, and queued-command delivery;
- `/work-node/v1/ack` — report that a real Runner was published or refused the command;
- `/work-node/v1/result` — settle an accepted execute/resume command.

Requests use HMAC-SHA256 instead of sending the shared secret. The daemon sends `x-dsh-node-key`, `x-dsh-timestamp`, and `x-dsh-signature`; the signature covers `METHOD + path + timestamp + exact raw body`. The shared key is resolved through `ctx.credentials` on every request. Requests outside `maxClockSkewMs` are rejected.

`nodeKey` is a deployment identity and is not the durable WorkNode id. A reconnecting daemon reuses the same WorkNode record. The gateway owns heartbeat age and may mark that WorkNode offline after `heartbeatTimeoutMs`.

## Command lifecycle

Execute/resume commands are durable and use at-least-once delivery while `queued`. A daemon **must deduplicate by command id**. Polling does not mark an ExecutionThread running. The daemon starts the real Runner first and then calls `ack`; only successful ack admission calls `ctx.workExecution.beginAttempt()`.

If an accepted Runner cannot be recorded because the task/thread/environment changed after poll, ack returns a conflict and the daemon must stop the just-published Runner. A retry after a crash between `beginAttempt()` and command-state persistence can reconcile the already-running matching attempt.

`cancel` is a control command. Its ack records delivery only; the original execute/resume command still settles through `result`, normally with a cancelled/interrupted stop reason.

Queued execution commands are revalidated before every delivery. Changes to task status, thread revision, Node status/capabilities, Runner availability, environment binding, or environment revision reject the stale command instead of running it under changed assumptions.

## Native continuation versus system handoff

Native resume is allowed only for a previous remote continuable attempt whose published native session is recorded on the **same WorkNode** that is currently bound to the thread. Moving to a different node cannot pretend to resume that native session; the caller must create a new attempt using the bounded system Handoff/Task Context Package.

## Environment reports

A poll may report named node-local environments. The gateway keeps a stable `(nodeKey, environmentKey)` → `WorkEnvironmentId` mapping. Canonically identical heartbeat reports are ignored so they do not increment environment revisions. Material workspace/runtime/service/device changes refresh the Environment and intentionally make older thread bindings stale.

## Configuration

Every deployment-varying choice is explicit; this package intentionally has no installable no-config bundle patch.

| key | meaning |
| --- | --- |
| `nodes` | configured `nodeKey` → DSH credential reference |
| `maxRequestBodyBytes` | complete JSON body ceiling |
| `maxPromptBytes` | complete bounded Task Context prompt ceiling for remote execute/resume |
| `maxCommandsPerPoll` | maximum queued commands returned in one poll |
| `maxClockSkewMs` | HMAC timestamp acceptance window |
| `heartbeatTimeoutMs` | age after which a known online/degraded node may be marked offline |
| `sweepIntervalMs` | heartbeat-age sweep cadence |

The credential reference resolves to the shared HMAC key. Do not put the key itself in `cordis.yml`.

## Model Experience

### Remote Task Context Package

#### What the model sees

Indirectly, through the remote Runner selected by a queued execute/resume command. The command carries the same bounded Task Context Package produced by `@deepseek-ai/dsh-work-runner-subagent`; it contains task/stage/required acceptance plus optional operational Handoff conclusions, not transcript history or chain-of-thought. The remote Runner owns the final model-request/session logging required by its runtime.

#### Token effect

Bounded by the required `maxPromptBytes` configuration for each queued execute/resume command. Heartbeats, node facts, environment reports, command ids, acknowledgements, and results add no model tokens by themselves.

#### KV Cache effect

Independent at the central gateway. Provider-side cache behavior belongs to the remote Runner runtime; cross-runner Handoff deliberately does not replay the previous model transcript.

## Known Limitations and Deferred Work

- **HTTP pull, not streaming transport** — command/event latency follows the daemon poll cadence. A future WebSocket/gRPC carrier can replace transport without changing WorkNode/Environment/ExecutionThread ownership.
- **At-least-once delivery requires daemon deduplication** — `queued` commands can be returned by repeated polls until ack; daemon idempotency is part of the protocol.
- **Accepted command loss needs operator/runtime recovery** — if a node disappears after ack, the gateway marks the Node offline but does not invent a terminal Runner result.
- **HMAC replay window** — timestamp validation limits replay duration; protocol operations additionally use revisions/idempotent command ids, but this V1 does not persist nonce history.
- **No resource lease scheduler yet** — P0 fan-out/reservation is a later scheduler consumer over WorkNode/Environment facts.
