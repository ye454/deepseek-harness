# Agent Note: authenticated HTTP-pull WorkNode gateway

Status: implemented

## Problem

A durable WorkNode record and an Environment snapshot describe where work may execute but do not provide transport, authentication, heartbeat ownership, or a safe commit point between a remote Runner process and `ExecutionThread.activeAttempt`.

The remote path must tolerate machines behind NAT/firewalls, preserve queued work across transient disconnects, avoid copying full model transcripts between runners, and never claim that a Runner is active before the remote runtime has actually published it.

## Decision

`@deepseek-ai/dsh-work-node-gateway` adds an explicitly configured Host service using the existing `ctx.webServer`. Remote daemons initiate four POST operations: `hello`, `poll`, `ack`, and `result`.

### Pull transport

The central Host persists outbound execute/resume/cancel commands. `poll` returns queued commands with at-least-once semantics until ack. The remote daemon must deduplicate by `RemoteNodeCommandId`. This avoids requiring inbound reachability to worker machines and makes a transport disconnect independent from command durability.

A future WebSocket or gRPC carrier may replace the polling mechanism. WorkNode identity, Environment identity, command lifecycle, and ExecutionThread publication semantics do not depend on polling.

### Authentication

`Config.nodes` maps a deployment `nodeKey` to a DSH `CredentialRef`. The secret is resolved per request and never appears in plugin config or request headers. Requests carry node key, timestamp, and an HMAC-SHA256 signature over method, path, timestamp, and the exact raw JSON body. Requests outside the configured clock-skew window are rejected. This is request authentication, not TLS replacement; deployments may still terminate HTTPS/tunnels in front of the Host.

### Runner publication commit point

Enqueueing and polling do not mutate the ExecutionThread into `running`. A remote daemon starts its actual Runner first, then a successful `ack` calls `ctx.workExecution.beginAttempt()`. If the command became stale between poll and ack, the central Host rejects the ack and the daemon must stop its just-published Runner.

A process crash after `beginAttempt()` but before the gateway command is marked accepted is recoverable: a repeated ack carrying the same native session can reconcile the matching already-running active attempt before finishing command persistence.

### Environment continuity

The daemon owns a stable environment key within its node identity. The gateway maps `(nodeKey, environmentKey)` to one durable `WorkEnvironmentId`. Canonically identical reports do not refresh the Environment, preventing heartbeat-only reports from invalidating exact-revision thread bindings. Material environment changes refresh the record and therefore make older bindings stale as designed.

Queued commands are revalidated before every delivery against current Task, ExecutionThread, WorkNode, Runner availability, Environment binding, and Environment revision. A stale command becomes durably rejected instead of executing under changed assumptions.

### Native resume

A continuable remote Runner must return its native session id at ack. That session id is stored on the command and later in the ExecutionThread attempt. Native resume is admitted only if a prior settled remote command proves the same native session was published by the same WorkNode currently bound to the thread. Cross-node continuation uses a new attempt plus system Handoff; it never pretends to be native resume.

### Token behavior

The gateway queues the bounded Task Context Package built by the existing work-runner bridge. `maxPromptBytes` applies before command persistence. Handoff fields contain operational conclusions and references, not transcripts or model chain-of-thought. Heartbeat/resource/control protocol traffic is model-agnostic.

## Alternatives rejected

- **Central Host connects directly to every worker** — rejected because worker inbound reachability is fragile across NAT/firewalls and complicates remote deployment.
- **In-memory WebSocket command queue** — rejected because transport disconnect/restart would become task loss.
- **Mark thread running when command is queued** — rejected because no real remote Runner exists at that point.
- **Bearer secret in each request** — rejected in favor of HMAC so the shared key itself is not transmitted.
- **Always refresh Environment on heartbeat** — rejected because it would invalidate exact-revision bindings without a real environment change.
- **Resume a native session on any compatible Node** — rejected because a native Runner session is owned by the runtime that created it; portability must be explicitly proven by a future provider contract rather than assumed.

## Deferred work

- a concrete worker-daemon package implementing polling, deduplication, local Runner adapters, ack/result, and local environment reports;
- richer streaming tool/usage events;
- resource leases and P0 scheduler policy;
- durable nonce replay history if deployments require a stricter anti-replay layer than timestamp + revision/idempotency;
- validator/evidence execution and the lightweight global Web UI.
