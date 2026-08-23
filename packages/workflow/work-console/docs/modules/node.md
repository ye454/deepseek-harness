# @deepseek-ai/dsh-work-node

English | [中文](README.zh.md)

Durable worker-node registry for the global work console. A Work Node is the machine/daemon identity that can host runners and later report execution environments. This package stores only authenticated node facts after a gateway accepts them; it does not own sockets, heartbeat timers, processes, credentials, or environment details.

## Node facts

Each node has a branded `WorkNodeId`, compare-and-set revision, display name, administrative state, protocol version, advertised runner providers, and explicit features:

- `execute`
- `cancel`
- `resume`
- `usage`
- `tool-events`
- `environment-report`
- `mcp-stdio`
- `mcp-streamable-http`

The vocabulary is intentionally smaller than any one runtime protocol. For example, the Multica DSH runtime exposes versioned execution, cancellation, resume, usage, tool events, and MCP transport support over JSONL; this registry records those scheduler-relevant facts without copying its transport or session model.

## Lifecycle

```text
register -> online
              | refresh online
              | refresh degraded(reason)
              v
          online/degraded
              |
              | liveness owner decides
              v
            offline
              |
              | successful refresh
              v
            online
```

`registerNode()` always creates a fresh online identity. `refreshNode()` is the acknowledged heartbeat/capability replacement operation; omitted state resolves explicitly to online, while degraded state requires a nonempty reason. `markOffline()` contains no timeout policy: the future gateway/monitor that actually observes the connection decides when offline is justified.

The registry does not reject protocol upgrades or downgrades itself. Transport compatibility belongs to the gateway that parses the handshake; after that boundary accepts a report, this package records the exact advertised version.

## Concurrency and publication

Every refresh/offline mutation uses `WorkNodeRef { id, revision }`. Stale reports fail instead of overwriting newer capability/liveness facts. `work-node/changed` is emitted only after durable commit, and observer failures are contained because they cannot roll back the committed node projection.

Runner-provider names and feature arrays are normalized and deduplicated. Node names are display labels, not identities, so duplicate display names are allowed.

## Composition

The package is opt-in and requires `ctx.storageDomain`:

```sh
dsh plugin --profile web add <path-to-work-node>
```

A later Remote Node gateway will consume this service after authenticating and parsing its wire protocol.

## Model Experience

### Work-node registry state

#### What the model sees

Nothing directly. This package registers no model tool, prompt, session message, or context injection. Resource-center or scheduling consumers may project bounded node facts later.

#### Token effect

Zero direct tokens. Node registration, heartbeat/capability refresh, and offline transitions do not enter model requests.

#### KV Cache effect

Independent. Durable node mutations do not alter model request prefixes.

## Known Limitations and Deferred Work

- **No transport/authentication yet** — WebSocket/stdin/gRPC handling, credentials, reconnect policy, and heartbeat ownership belong to a separate gateway package.
- **No automatic offline timeout** — only the component observing real connectivity may call `markOffline()`; this registry does not infer liveness from wall-clock age.
- **No Environment records yet** — workspace/Git/runtime/service/device snapshots and ExecutionThread bindings are the next separate capability.
- **No resource leases/scheduler yet** — the registry exposes availability facts but does not reserve or dispatch node capacity.
