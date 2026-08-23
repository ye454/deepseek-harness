# @deepseek-ai/dsh-work-orchestrator

Thin scheduler/coordinator for turning an already organized running Task into one or more isolated remote execution commands.

It owns no second Task database and no Runner process. Durable authority remains in:

- Work Control — Task status, priority, workflow and validation policy;
- Work Execution — ExecutionThreads and accepted Runner attempts;
- Work Environment — exact Thread→Environment revision binding and preflight;
- Work Node — current Node/provider availability;
- Work Node Gateway — durable remote execute command queue.

## `startTask()`

The caller supplies an explicit execution plan. Every placement contains:

- exact `environmentId + environmentRevision`;
- Runner provider;
- compact execution role / next step.

V1 queues `one-shot` execution only. This matches the currently shipped Codex and Claude Code remote adapters and does not fabricate native resume support.

A successful call means the remote commands were durably **queued**. It does not claim a Runner is already running. The daemon publishes the real Runner later; Gateway `ack` then records the actual ExecutionThread attempt.

## Parallelism

- P1/P2: exactly one placement.
- P0: up to three placements.
- Every parallel placement must have a distinct `(node, worktree-or-workspace-path)` isolation key.
- An existing nonterminal ExecutionThread leasing the same workspace/worktree blocks a new placement.
- One ExecutionThread still owns at most one active attempt.

Therefore P0 fan-out is real multi-agent execution without allowing two agents to concurrently write the same working directory.

A typical P0 plan can assign isolated roles such as code implementation, independent diagnosis, and validation, provided each role has its own Environment/worktree.

## Failure semantics

All placements are validated before any Thread is created. If a later cross-domain race or Gateway failure occurs:

- an unpublished newly created Thread is cancelled;
- if no earlier placement was queued, `WorkOrchestratorError` is raised;
- if earlier placements are already durably queued, `WorkOrchestratorPartialStartError` reports the exact started placements and failed index.

The service never rolls back a remote command that may already be observable by a daemon.

## Not yet automated

V1 intentionally does not guess a repository, Environment, provider, or role from Task prose. The next Work Console layer can build an explicit plan from resource facts and human/AI suggestions. Automatic selection is only safe after those scheduler facts are explicit.
