# @deepseek-ai/dsh-work-control

English | [中文](README.zh.md)

Global work-control domain for the lightweight persistent work console. It deliberately separates passive ideas from executable tasks: capturing an idea stores only text and tags; only an explicit `promoteIdea()` transition moves that same stable item into `organizing`. A later organizer supplies the task type, ordered workflow, and task-specific validation policy before execution starts.

The package does not own runners, Remote Nodes, environments, detailed evidence, or model memory. Those are separate capabilities that can attach to the task after organization. This keeps the global board small and prevents idea capture from consuming model tokens or compute resources.

## Lifecycle

```text
idea
  └─ explicit promote → organizing
                         └─ organize → running
                                      ├─ blocked → running
                                      ├─ validation → running | done
                                      ├─ done
                                      └─ cancelled
```

Priorities are intentionally limited to `p0`, `p1`, and `p2`. The domain only records priority. A scheduler may interpret `p0` as an expedited request and allocate safe parallel runners, but concurrency policy is not hard-coded here.

## Durable state

The package opens the `work-control` storage domain and stores one discriminated `items` table. Promotion replaces the idea record in one durable table update while preserving its `WorkItemId`, avoiding a two-record transaction between an idea queue and a task queue. Promotion and idea deletion are serialized inside the service so the same revision cannot commit both transitions. Task mutations use `WorkItemRef { id, revision }` compare-and-set guards.

A task may carry a generated workflow and a composed validation policy. Validators include automated tests, visual-model review, runtime/log/benchmark/device/static/artifact checks, and user acceptance. Required, advisory, and optional validators can be mixed per task. Required validator counts are derived from the stored policy, and `done` is rejected until every required validator has passed. Therefore a required `user-acceptance` validator keeps an AI-validated task in the acceptance flow until the human gate is recorded.

## Composition

The package ships an optional bundle patch:

```sh
dsh plugin --profile web add <path-to-package>
```

It requires `ctx.storageDomain`. The standard Web composition mounts `storage`, the JSON backend, and `storage-domain`; base/headless compositions must mount an appropriate storage backend and `storage-domain` explicitly before enabling this bundle.

## Model Experience

### Global work-control state

#### What the model sees

Nothing directly. This package registers no model tool, prompt section, conversation node, or session message. A future organizer or runner consumer decides which bounded task fields enter a model request.

#### Token effect

Zero direct tokens. Capturing ideas, changing status, or updating board metadata does not enter model context.

#### KV Cache effect

Independent. Work-control storage mutations do not modify any model request prefix.

## Known Limitations and Deferred Work

- **No executor attachment yet** — `ExecutionThread`, Runner, Remote Node, Environment, Handoff, and evidence records are intentionally deferred to separate packages.
- **No global Web surface yet** — the intended Ideas / Execution / Acceptance board is a Client plugin layered over this service, not part of the storage domain.
- **No organization consumer yet** — promotion stops at `organizing`; a later organizer will select/generate workflow and validation policy before execution.
- **No validator executor yet** — this package enforces required-count and completion consistency, but automated checks, visual review, device tests, and human-acceptance recording are performed by later validator consumers.
