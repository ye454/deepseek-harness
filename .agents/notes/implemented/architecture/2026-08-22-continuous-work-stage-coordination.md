# Agent Note: Continuous work advances from durable execution coordinates

Status: implemented

English | [中文](2026-08-22-continuous-work-stage-coordination.zh.md)

## Problem

The global Work Console can now organize a Task and explicitly dispatch one or more isolated Runner roles, but the durable execution layer previously stopped after a remote Runner settled: `settleAttempt()` returned the ExecutionThread to `idle` and no authority could safely decide whether that completion belonged to the current Workflow Stage, an older Stage, or a Stage that had already advanced before a Host crash.

Using Runner prose as the answer is not acceptable. A Runner saying “completed” proves only that its execution attempt terminated normally; it is not test, benchmark, device, visual, runtime, or human acceptance evidence. At the same time, replaying transcripts into a coordinator would violate the bounded-context and token-efficiency goals of the global work system.

P0 adds another failure mode: several isolated Threads can complete one Stage. The system needs to wait for the fan-out, then converge without letting every later Stage blindly multiply writers. Environment reports may also advance revision after a Runner changes a workspace, so a continuation cannot reuse a stale binding.

## Decision

**Every newly published execution attempt carries the current Workflow `stageId` as a compact durable coordinate.** WorkExecution stamps it from WorkControl when the Runner is published; the browser and remote node do not supply it. The field remains optional in storage only so records written before this change remain readable. An old completed attempt without the coordinate is blocked for manual recovery rather than guessed.

**A separate `dsh-work-execution-coordinator` plugin owns progression policy, not execution state.** It keeps no duplicate Task, Thread, Environment, command, or Validation store. It observes committed WorkControl, WorkExecution, and remote-command facts, serializes reconciliation per Task, and re-reads the authoritative services before every decision.

**Stage mutation precedes continuation dispatch.** Once every relevant current-Stage Thread has settled `completed`, the coordinator commits the next `currentStageId`, then asks WorkOrchestrator to continue the primary Thread. If the Host stops in that gap, the previous Attempt `stageId` proves that the current Stage has not run yet. WorkOrchestrator treats an already-open command for that Thread as idempotent success, so restart recovery does not duplicate dispatch.

**Continuation stays inside the Orchestrator admission boundary.** The helper reuses the prior Runner/provider and same Environment identity. If the Environment has published a newer revision, it explicitly rebinds the inactive Thread to that exact latest revision, then repeats Environment, Node, Runner, and workspace-lease preflight. It never silently changes to another Environment or bypasses scheduler checks.

**P0 fan-out converges after one Stage.** All selected Threads must settle successfully for the current Stage. The oldest stable Thread is chosen as primary; inactive siblings are closed to release their workspace leases. Later Stages continue through the primary unless a future Stage-specific fan-out policy explicitly says otherwise.

**Validation remains a separate authority.** Entering a Workflow validation Stage (or reaching the end of a workflow without an explicit validation Stage) opens a fresh WorkValidation generation. Runner text is not converted into Evidence and Runner `completed` does not complete the Task. WorkValidation results and explicit human acceptance remain the gates for completion.

**Failures are blocking facts.** A failed/refused/limited/cancelled execution attempt or a durable remote command rejection moves the Task to `blocked`. The coordinator does not pretend a partial P0 dispatch rolled back atomically and does not force-kill a sibling Runner merely to make the board look consistent; its eventual settlement remains durable history while the blocked Task admits no new Stage work.

## Restart and event ordering

The coordinator subscribes after durable writes and also reconciles existing Tasks during initialization. Its own mutations trigger the same event stream, but reconciliation is serialized per Task, so those events enqueue another read rather than recursively mutating the same state inline.

The critical crash window is therefore recoverable:

1. Stage A attempt is durably `completed` with `stageId=A`.
2. WorkControl durably advances to Stage B.
3. Host may stop before a Stage B command is queued.
4. On restart the coordinator sees `currentStageId=B` plus an idle completed Attempt stamped `A` and queues/recovers exactly one B continuation.

An accepted command already has a running Thread and is simply waited on; a queued command is found and reused by command id.

## Model and token boundary

Coordinator reconciliation itself invokes no model, adds no prompt section, and stores no transcript or private chain-of-thought. The only model-visible continuation data is the existing bounded Task context plus a compact `nextStep` naming the current Workflow Stage. Token use begins only when the remote Gateway actually dispatches a Runner.

## Testing

Focused composition tests use real WorkControl, WorkExecution, WorkNode, WorkEnvironment, WorkValidation, and WorkOrchestrator services with a fake Gateway boundary. They cover P0 fan-out convergence, explicit Environment revision rebinding, sequential Stage continuation, entry into a fresh Validation generation without fabricated Validator results, failed Runner blocking, durable command rejection, and restart idempotency over an already-queued continuation.

WorkExecution coverage additionally pins that a published Attempt receives the Task-owned Stage coordinate.

## Alternatives considered

**Advance on `stopReason=completed` without storing Stage.** Rejected because a Host crash after Stage mutation makes the old completion indistinguishable from completion of the new Stage.

**Store/replay Runner output as the progression source.** Rejected because prose is not acceptance Evidence, increases tokens, and couples orchestration to provider-specific output.

**Create a new Thread for every Stage.** Rejected for the default path because it discards useful Environment/Runner continuity and makes P0 lease cleanup harder. A Task still may create new independent Threads when an explicit future policy requires it.

**Keep every P0 branch alive across every Stage.** Rejected as the default because parallel writers multiply collision risk and resource cost. Stage-specific later fan-out can be added deliberately.

## Consequences and deferred work

The system now has a deterministic execution-to-validation lifecycle without changing `dsh-agent-loop` and without adding a second work database. Old pre-coordinate Attempts require explicit recovery. Automated Validator executors remain a separate layer: the coordinator opens Validation but does not manufacture test, benchmark, screenshot, device, or runtime Evidence. A blocked-task recovery surface and richer Stage-specific fan-out policy are also deferred.
