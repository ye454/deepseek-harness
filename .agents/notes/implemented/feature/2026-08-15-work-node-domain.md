# Agent Note: Durable work-node facts before remote transport

Status: implemented

## Problem

The global work console must know which execution machines are available before it can bind environments or schedule runners. Treating a machine as an incidental field on Runner would make resource availability, remote execution, and environment compatibility impossible to reason about independently. Treating transport connection state as the durable node itself would also couple WebSocket/stdin/gRPC implementation details to product state.

Existing prior art reinforces the separation. The Multica DSH runtime uses a versioned protocol and explicitly reports execution/cancel/resume/usage/tool/MCP capabilities; it validates resume against the original working directory and treats cancellation/result/usage as runtime facts rather than model claims. Those are useful capability facts, but its JSONL transport and one-process/one-execute lifecycle are not the work console's durable domain.

## Decision

Add `@deepseek-ai/dsh-work-node` as a storage-backed registry. A branded `WorkNodeId` identifies one accepted worker-node registration. Each durable record stores a compare-and-set revision, display name, explicit state (`online | degraded | offline`), accepted protocol version, normalized runner-provider names, normalized scheduler-relevant features, and last-seen/created/updated timestamps.

The node feature vocabulary is deliberately transport-neutral and small: execute, cancel, resume, usage, tool-events, environment-report, MCP stdio, and MCP streamable HTTP. It does not store model lists, workspace snapshots, credentials, process ids, socket details, or environment state.

`registerNode()` is called only after a future gateway authenticates and accepts the handshake. It creates a fresh online identity. `refreshNode()` replaces the advertised protocol/capability set and refreshes `lastSeenAt`; omitted state resolves explicitly to online, while degraded requires a nonempty reason. `markOffline()` contains no wall-clock timeout policy: the component that really observes connectivity owns that decision.

All refresh/offline mutations use `WorkNodeRef { id, revision }`, so delayed heartbeat traffic cannot overwrite a newer report. `work-node/changed` fires after durable commit and listener failures are contained. The package invariant checks each event against the durable registry projection.

## Boundaries

This package owns no transport, authentication, heartbeat timer, Remote Node process, environment snapshot, runner invocation, resource lease, scheduler, or model context. Wire protocol compatibility belongs to the gateway that parses the handshake. The registry records a protocol version only after that layer accepts it. Nothing in this change modifies `dsh-agent-loop`.

## Consequences

- Node availability is a first-class fact separate from Runner and Environment.
- The future Resource Center can list online/degraded/offline nodes without reading runner sessions.
- Protocol and runner-provider capabilities are auditable scheduler inputs rather than prompt conventions.
- Heartbeat timeout policy can change without migrating durable node records.
- Environment snapshots can later reference a stable branded Node id without making Environment own machine liveness.

## Verification

Focused tests cover registration normalization, capability refresh, degraded-state validation, stale revision rejection, offline transitions, storage failure, and post-commit observer containment. The package invariant has direct projection checks. A Loader smoke composes storage + JSON backend + storage-domain + work-node and verifies the persisted node record.

The test assets are committed but no passing runtime result is claimed until repository tests/CI actually execute.

## Known limitations and deferred work

- Authentication and a concrete wire gateway are deferred.
- Automatic heartbeat expiry/offline transition is deferred to that gateway/monitor.
- Environment snapshots and thread bindings are the next separate domain.
- Resource leasing and scheduling are deferred.
