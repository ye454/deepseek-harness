# @deepseek-ai/dsh-work-console-commands

Host-owned mutation boundary for the global Work Console.

This package deliberately owns no second task/approval database. It validates browser-observed revisions/generations and delegates durable writes to Work Control and Work Validation.

## Commands

### `promoteIdea(request)`

Explicitly promotes one passive Idea into the execution area. The command stops at Work Control status `organizing`; it does **not** create an ExecutionThread, choose a Runner, start an Environment, or call a model.

The request contains the Idea id/revision and optional P0/P1/P2 priority. Compare-and-set conflicts return a business failure rather than silently promoting a newer record.

### `decideAcceptance(request)`

Records one required `user-acceptance` decision for the active Validation Generation.

The browser supplies:

- Task id and observed revision;
- Validation Generation;
- required user-acceptance validator index;
- `accept` or `return`.

The browser does **not** supply `actor`.

Before recording a human decision the Host requires:

- the WorkItem is still the exact observed Task revision;
- the Task is in `validation`;
- the requested Generation is still active;
- the selected validator is a required `user-acceptance` entry;
- every required non-human validator in that Generation has passed.

`accept` records a passed user decision. If every required gate is now passed, the Task enters `done`; otherwise it stays in `validation` for remaining human gates.

`return` records a failed user decision and then moves the Task back to `running`. Work Control resets the compact validation summary on `validation -> running`; the next validation pass opens a new Generation, so previous Evidence remains audit history but cannot satisfy the new cycle.

## Actor boundary

V1 derives the audit actor Host-side as:

`harness-home:<anonymous-user-id>`

using `@deepseek-ai/dsh-anonymous-user-id`. That id is random and scoped to the Harness home; it is not derived from hostname/network/git metadata.

This is **not multi-user authentication**. It is the correct current local/single-user boundary because browser code cannot forge an arbitrary actor string. A future authenticated identity provider can replace the Host actor resolver without changing the Work Console browser command shape.

The existing `ctx.approval` seam is intentionally not reused: its contract is bound to an open Agent turn, while Work Console acceptance is an out-of-turn durable human workflow.

## Model Experience

None. These are explicit human UI commands. Promotion and acceptance decisions do not insert text into model context, replay transcripts, or expose the Host actor to the model.

## Failure semantics

Expected stale/missing/invalid/not-ready states are returned as typed business failures. Storage/service failures still throw. A human decision is never converted into a successful completion unless current automated readiness is rechecked after the validation write.
