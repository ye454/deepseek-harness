# @deepseek-ai/dsh-work-node-daemon

Remote worker runtime for the global work console. It initiates signed HTTP-pull connections to `@deepseek-ai/dsh-work-node-gateway`, reports configured local environments, deduplicates at-least-once remote commands durably, and dispatches work through daemon-local Runner providers.

## Runner registry

Runner plugins call `ctx.workNodeDaemon.registerRunner(provider)`. A provider declares a stable name and truthful `one-shot` / `continuable` modes, then publishes a handle with cancellation, disposal, and a never-reject terminal result.

The daemon derives central Node facts from the registry:

- no Runner: only `environment-report`;
- one or more Runners: `execute + cancel` plus their provider names;
- `resume` only if at least one registered provider truthfully supports `continuable`.

Current DeepSeek Harness built-in `codex`, `claude-code`, and `dsh-sdk` subagent providers are one-shot. This daemon core does not claim native resume for them. Provider adapters are separate plugins so capability reporting stays truthful.

## Durable command journal

Gateway delivery is at-least-once while a command remains queued. The daemon writes a local `work-node-daemon` Storage Domain journal keyed by `RemoteNodeCommandId` before Runner publication. Duplicate polls consult this journal rather than starting another Runner.

Journal states are `starting`, `published`, `accepted`, `settled`, `rejected`, and `interrupted`. Terminal results carry `reportedAt` only after the central gateway confirms them.

After daemon restart, no process-local Runner handle is trusted to survive. Nonterminal journal rows are reconciled conservatively:

- central command still queued -> daemon refuses the interrupted local work;
- central command already accepted -> daemon reports terminal `unknown`;
- central command already settled/rejected -> local journal converges to that fact.

The daemon never turns an unknown post-crash outcome into success.

## Environment reports

Configured environments provide key, display name, workspace path, and optional capability/device/secret-reference labels. The built-in collector uses the DSH subprocess capability to inspect Git commit, branch, origin, and dirty state plus Node/OS/architecture. Git inspection failure degrades the environment rather than stopping heartbeats.

Only secret reference names are reported; secret values are never collected.

## Configuration

Every deployment choice is explicit. The daemon intentionally has no no-config bundle patch.

| key | meaning |
| --- | --- |
| `gatewayUrl` | central gateway origin, e.g. `https://control.example` |
| `nodeKey` | configured gateway deployment identity |
| `nodeName` | display name reported by hello |
| `credential` | DSH credential reference containing the shared HMAC key |
| `protocolVersion` | remote-node protocol version |
| `pollIntervalMs` | successful poll cadence |
| `retryDelayMs` | delay after network/protocol failures |
| `requestTimeoutMs` | per-request timeout |
| `maxConcurrentRuns` | maximum daemon-owned Runner handles |
| `gitCommand` | Git executable name/path resolved through `ctx.subprocess` |
| `environmentCommandOutputBytes` | retained stdout/stderr ceiling for each Git inspection |
| `processGraceMs` | subprocess termination grace |
| `environments` | configured workspace environments |

## Model Experience

### Remote Runner input

#### What the model sees

Indirectly, through a registered Runner provider. The daemon forwards the gateway command's already-bounded Task Context Package verbatim as the provider `prompt`; it does not append node heartbeats, command history, environment dumps, previous transcripts, or private reasoning.

#### Token effect

No additional daemon-owned prompt tokens. The prompt is already bounded centrally by the gateway's `maxPromptBytes`; provider-owned system/tool context remains the provider's responsibility.

#### KV Cache effect

Independent at the daemon layer. One-shot providers start fresh requests. A future provider may advertise `continuable` only when it actually preserves its native session semantics.

## Known Limitations and Deferred Work

- **No built-in production Runner adapters yet** — this package is the runtime/registry. Claude Code, Codex, and DSH adapters are separate follow-up provider plugins rather than fake modes in the daemon core.
- **No model output/evidence transport yet** — V1 central result carries terminal stop reason only. Structured Handoff/evidence delivery belongs to the next validation/evidence protocol layer.
- **Daemon crash loses live handles** — journal recovery reports accepted-but-unowned attempts as `unknown`; it does not attempt OS-process reattachment.
- **Git collector only** — service/device health probes can be added as environment providers later; this V1 does not run arbitrary hidden probe commands.
- **Polling, not streaming** — latency follows `pollIntervalMs`; streaming events remain a later transport extension.
