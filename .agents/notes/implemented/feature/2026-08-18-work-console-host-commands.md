# Work Console Host-owned mutation commands

Date: 2026-08-18

## Decision

Human actions from the global Work Console use a dedicated Host mutation service rather than letting browser code call Work Control or Work Validation directly.

The service is `@deepseek-ai/dsh-work-console-commands` / `ctx.workConsoleCommands` and initially exposes two explicit operations:

- passive Idea -> promoted `organizing` Task;
- required human acceptance -> accept or return-to-execution.

The command package owns no durable table. Work Control and Work Validation remain the mutation authorities and their revisions/generations remain the concurrency tokens.

## Why not `ctx.approval`

The existing user-approval seam is scoped to an open Agent turn. Work Console acceptance is durable out-of-turn product work and can happen while no Agent turn exists. Reusing the turn-scoped approval seam would give the UI a lifecycle it does not actually have.

## Actor boundary

The browser never sends an actor string. V1 derives one on the Host using the harness-home-scoped anonymous UUID:

`harness-home:<anonymous-user-id>`

This prevents a local browser caller from choosing arbitrary audit identity text. It is explicitly not multi-user authentication. A future authenticated identity provider may replace the Host resolver without changing the mutation request shape.

## Idea promotion

Promotion requires the exact observed Idea revision and returns a typed stale/missing/invalid-state result. It stops at `organizing`: no model, Runner, ExecutionThread, Environment, or Workflow organization is started by the promotion command itself.

This preserves the product boundary: an Idea can remain passive indefinitely; user action is what moves it into executable work.

## Human acceptance

A decision request names the exact Task revision, Validation Generation, and required `user-acceptance` policy index. Before recording the human decision, the Host verifies:

1. Task still exists at the observed revision;
2. Task status is `validation`;
3. Generation is still active;
4. selected entry is required `user-acceptance`;
5. every required non-human validator in that Generation passed.

After the human result commits, automated readiness is checked again before the service may move the Task to `done`. This contains a validator race at the completion boundary.

`accept` enters `done` only when every required validator is now passed. With multiple required human gates, the Task stays in `validation` until the last one passes.

`return` records a failed user result and moves the Task back to `running`. Work Control resets its compact validation summary on that transition; a later validation pass creates a fresh Generation, so earlier Evidence stays audit history without being reused for completion.

## Failure semantics

Missing, stale, invalid-state, invalid-validator, stale-generation, and automated-not-ready conditions are typed business failures. Unexpected storage/runtime failures still throw; the command layer does not convert infrastructure failure into a successful human decision.

## Model/token effect

None. These operations are explicit human product commands and do not add prompt messages, replay conversation history, expose audit actor identity to the model, or start model work by themselves.
