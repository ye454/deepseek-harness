# Work Orchestrator V1

## Decision

Add a thin stateless orchestration layer over the existing durable Work Control / Execution / Environment / Node / Gateway authorities.

The first version does not guess execution resources from Task prose. A caller provides explicit placements with exact Environment revision, provider and role. Current remote adapters are treated as `one-shot`; native continuation remains a separate later capability.

## Safe fan-out

P1/P2 admit one placement. P0 may fan out to at most three independent ExecutionThreads.

Parallel placements must use distinct node/worktree-or-workspace isolation keys. Existing nonterminal Thread leases are checked globally before fan-out, so two agents are not intentionally scheduled to write the same working directory.

Each role is transferred only as compact Handoff `nextStep`; no transcript or chain-of-thought is replayed.

## Truthful start state

`startTask()` queues durable remote commands. It does not mark Threads running itself. The real Runner is recorded only after the remote daemon publishes it and Gateway accepts the ack.

## Failure boundary

All placements are validated before writes. If a later race/failure occurs, unpublished Threads are cancelled. If an earlier command is already durably queued, the service raises a partial-start error carrying the already-started placements instead of pretending atomic rollback.

## Follow-up

Expose execution-plan construction through the Work Console using current resource facts. Suggestions may be automated later, but Environment/provider selection must stay explicit or demonstrably unambiguous before automatic execution is enabled.
