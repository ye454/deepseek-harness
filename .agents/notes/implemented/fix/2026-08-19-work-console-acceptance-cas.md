# Work Console acceptance CAS hardening

## Problem

`workConsole.decideAcceptance()` originally validated `taskRevision` before entering `WorkValidation.recordUserAcceptance()`. Two same-task browser commands could both pass that preflight before either mutation committed. Work Validation serializes its own writes, but the second command did not re-check the caller's original WorkItem revision after waiting for that lock, so a later `return` could overwrite an earlier `accept` result in the same Validation Generation.

## Decision

The Host-owned Work Console command boundary now serializes human acceptance commands per Cordis Context and per Task for the full command lifecycle:

`revision/generation preflight -> record user result -> refresh summary -> done/return transition`

The next command for the same Task starts only after the previous command has completed. It therefore re-runs the normal WorkItem revision and Validation Generation checks against the newly committed state. A request built from the old Task card becomes a normal `conflict` instead of overwriting a prior human decision.

The tail registry is a `WeakMap<Context, Map<TaskId, Promise<void>>>`. Separate Cordis Contexts do not block each other, and disposing a Context does not leave a module-global strong reference behind.

This lock is intentionally scoped to Work Console human commands. It does not change `dsh-agent-loop`, Runner execution, automated validators, or model context. Work Control and Work Validation remain the only durable state authorities.

## Regression

`acceptance-concurrency.spec.ts` submits `accept` and `return` concurrently with the same Task revision/generation. The first command completes the Task; the queued stale command is rejected with `conflict`, and the current generation retains one user result rather than a last-writer-wins overwrite.

## Remaining boundary

The V1 Harness is a single Host process over its local Storage Domain. If the Work Console is later deployed as multiple concurrent Host processes sharing one durable backend, this Context-local command serialization must be replaced or reinforced by a storage-backed command lease / compare-and-set at the validation result boundary.
