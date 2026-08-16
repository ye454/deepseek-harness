# Agent Note: Global work-control domain

Status: implemented

## Problem

A long-lived work console needs a global place to capture ideas without starting model work, then explicitly promote mature ideas into execution. Treating every idea as a session or Goal would spend context and couple passive planning to one agent. Treating project/workspace as the root entity would also prevent urgent tasks from competing for resources across projects.

The work console therefore needs one durable global record that survives UI reloads and later attaches to execution without owning the execution environment itself.

## Decision

Add `@deepseek-ai/dsh-work-control` under `packages/workflow/work-control`. It owns one storage-domain table of discriminated `idea` and `task` records. Promotion atomically replaces the idea record with a task while retaining the same branded `WorkItemId`; no second table or cross-record transaction is required. Promotion and passive-idea deletion share one service-owned transition queue, so one idea revision cannot commit both transitions even though the storage table exposes atomic update and idempotent delete as separate primitives.

Ideas are inert. The service registers no model-facing tool and `promoteIdea()` is an explicit service transition intended for the human-controlled board. Promotion enters `organizing`, not `running`. A later organizer must supply a task type, ordered WorkflowPlan, and task-specific ValidationPolicy before the service admits the task to its first running stage.

Priorities are `p0`, `p1`, and `p2`. This package records priority but does not decide concurrency. The later scheduler may use P0 to request safe fan-out, preferably through dependency-aware workflow/subagent primitives, without allowing several writers to collide in one workspace.

Validation is compositional rather than a single fixed acceptance step. The policy can mix automated tests, visual-model checks, runtime/log/benchmark/device/static/artifact checks, and user acceptance, each marked required, advisory, or optional. The stored policy is authoritative for the required count: a validation summary cannot reduce that count or report `passed` early, and a task cannot enter `done` while any required validator remains outstanding. Marking `user-acceptance` required therefore implements the intended AI-validation-then-human-acceptance gate without hard-coding human review into every task.

Task mutations use `WorkItemRef { id, revision }` compare-and-set guards. A package-owned `work-control/changed` event fires only after durable commit. Observer failures are contained and logged because they occur after the commit point and cannot retroactively reject the mutation. The invariant companion checks that each event agrees with the authoritative service projection.

## Boundaries

The domain deliberately does not own Runner, native AI session ids, Remote Node, Environment, Handoff, evidence payloads, memory recall, token budgeting, or UI. Those capabilities will consume this service through documented extension points. Nothing in this change modifies `dsh-agent-loop`.

## Verification

Focused package tests cover passive capture, explicit promotion, stale revision rejection, serialized delete/promote competition, dynamic workflow stages, task lifecycle transitions, required human acceptance, forged validation summaries, storage-write failure, and post-commit listener containment. The package invariant has direct positive and negative tests. A separate Loader smoke boots `storage`, the JSON backend, `storage-domain`, `work-control`, and the invariant from a real `cordis.yml`, promotes one idea, and checks the persisted `work-control.json` record. These tests are committed as acceptance assets; this development environment cannot execute the repository locally, and the fork currently reports no GitHub Actions run, so no passing runtime result is claimed yet.

## Consequences

- Capturing ideas has zero direct model-token cost and allocates no runner.
- The global board can remain project-agnostic; project/workspace becomes task metadata or an execution-environment attachment later.
- Promotion is a single durable record update, and the service transition queue prevents delete/promotion races around that record.
- Dynamic workflow and validation policy remain task-specific instead of hard-coding one development process for bug fixes, UI work, deployments, research, and robot validation.
- Human acceptance is optional by policy but authoritative when marked required.
- Execution and context optimization can evolve independently: DSH Workflow/AgentTeams-style orchestration, Remote Node runtimes, bounded Task Context Packages, MCP schema reduction, and shared long-term memory do not enlarge this domain.

## Known limitations and deferred work

- The Web board, Remote Node runtime, Runner adapters, organizer, validator executors, and evidence store are separate follow-up packages.
- This first package is not mounted into the shipped Web bundle by default; it ships its own bundle patch for explicit opt-in while the product surface is under construction.
- The committed tests still require an actual repository test/CI run before this draft PR can be considered merge-ready.
