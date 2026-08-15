# Agent Note: Global work-control domain

Status: implemented

## Problem

A long-lived work console needs a global place to capture ideas without starting model work, then explicitly promote mature ideas into execution. Treating every idea as a session or Goal would spend context and couple passive planning to one agent. Treating project/workspace as the root entity would also prevent urgent tasks from competing for resources across projects.

The work console therefore needs one durable global record that survives UI reloads and later attaches to execution without owning the execution environment itself.

## Decision

Add `@deepseek-ai/dsh-work-control` under `packages/workflow/work-control`. It owns one storage-domain table of discriminated `idea` and `task` records. Promotion atomically replaces the idea record with a task while retaining the same branded `WorkItemId`; no second table or cross-record transaction is required.

Ideas are inert. The service registers no model-facing tool and `promoteIdea()` is an explicit service transition intended for the human-controlled board. Promotion enters `organizing`, not `running`. A later organizer must supply a task type, ordered WorkflowPlan, and task-specific ValidationPolicy before the service admits the task to its first running stage.

Priorities are `p0`, `p1`, and `p2`. This package records priority but does not decide concurrency. The later scheduler may use P0 to request safe fan-out, preferably through dependency-aware workflow/subagent primitives, without allowing several writers to collide in one workspace.

Validation is compositional rather than a single fixed acceptance step. The policy can mix automated tests, visual-model checks, runtime/log/benchmark/device/static/artifact checks, and user acceptance, each marked required, advisory, or optional. The domain stores only a compact validation summary; detailed evidence stays outside this package.

All mutations use `WorkItemRef { id, revision }` compare-and-set guards. A package-owned `work-control/changed` event fires after durable commit. The invariant companion checks that each event agrees with the authoritative service projection.

## Boundaries

The domain deliberately does not own Runner, native AI session ids, Remote Node, Environment, Handoff, evidence payloads, memory recall, token budgeting, or UI. Those capabilities will consume this service through documented extension points. Nothing in this change modifies `dsh-agent-loop`.

## Consequences

- Capturing ideas has zero direct model-token cost and allocates no runner.
- The global board can remain project-agnostic; project/workspace becomes task metadata or an execution-environment attachment later.
- Promotion is a single durable mutation, so a card cannot exist half in the idea queue and half in the execution queue.
- Dynamic workflow and validation policy remain task-specific instead of hard-coding one development process for bug fixes, UI work, deployments, research, and robot validation.
- Execution and context optimization can evolve independently: DSH Workflow/AgentTeams-style orchestration, Remote Node runtimes, bounded Task Context Packages, MCP schema reduction, and shared long-term memory do not enlarge this domain.

## Known limitations and deferred work

- The Web board, Remote Node runtime, Runner adapters, organizer, validators, and evidence store are separate follow-up packages.
- This first package is not mounted into the shipped Web bundle by default; it ships its own bundle patch for explicit opt-in while the product surface is under construction.
