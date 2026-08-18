/**
 * Client-safe request/result vocabulary for explicit Work Console mutations.
 * Browser requests never contain an acceptance actor; the Host owns that identity boundary.
 * @module @deepseek-ai/dsh-work-console-commands/types
 */

/** Explicit promotion of one passive Idea into the execution area. */
export interface PromoteWorkConsoleIdeaRequest {
  readonly id: string
  readonly revision: number
  readonly priority?: 'p0' | 'p1' | 'p2'
}

/** Human decision for one required user-acceptance entry in the active Validation Generation. */
export interface DecideWorkConsoleAcceptanceRequest {
  readonly taskId: string
  readonly taskRevision: number
  readonly generation: number
  readonly validatorIndex: number
  readonly decision: 'accept' | 'return'
}

/** Compact mutation acknowledgement returned after promotion. */
export interface PromotedWorkConsoleTask {
  readonly id: string
  readonly revision: number
  readonly status: 'organizing'
  readonly priority: 'p0' | 'p1' | 'p2'
}

/** Compact post-decision Task state. */
export interface WorkConsoleAcceptanceDecisionValue {
  readonly taskId: string
  readonly revision: number
  /** Accept can finish the Task; return always sends it back to running. */
  readonly status: 'validation' | 'done' | 'running'
  readonly decision: 'accept' | 'return'
}

/** Addressed WorkItem does not exist. */
export interface WorkConsoleCommandNotFound {
  readonly code: 'not-found'
  readonly id: string
}

/** The browser acted on an older WorkItem revision. */
export interface WorkConsoleCommandConflict {
  readonly code: 'conflict'
  readonly id: string
  readonly expectedRevision: number
  readonly currentRevision: number
}

/** The addressed object exists but its current lifecycle state cannot admit this command. */
export interface WorkConsoleCommandInvalidState {
  readonly code: 'invalid-state'
  readonly id: string
  readonly reason: string
}

/** Validation Generation changed after the browser rendered the acceptance card. */
export interface WorkConsoleCommandStaleGeneration {
  readonly code: 'stale-generation'
  readonly taskId: string
  readonly expectedGeneration: number
  readonly currentGeneration?: number
}

/** The selected validator index is not a required human-acceptance gate. */
export interface WorkConsoleCommandInvalidValidator {
  readonly code: 'invalid-validator'
  readonly taskId: string
  readonly validatorIndex: number
}

/** Required automated validation has not reached the human decision boundary. */
export interface WorkConsoleCommandNotReady {
  readonly code: 'not-ready'
  readonly taskId: string
  readonly reason: 'automated-pending' | 'automated-failed'
}

/** Stable expected business failures from Work Console mutation commands. */
export type WorkConsoleCommandFailure =
  | WorkConsoleCommandNotFound
  | WorkConsoleCommandConflict
  | WorkConsoleCommandInvalidState
  | WorkConsoleCommandStaleGeneration
  | WorkConsoleCommandInvalidValidator
  | WorkConsoleCommandNotReady

/** Successful command result. */
export interface WorkConsoleCommandSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Expected command rejection. Infrastructure/storage failures still throw. */
export interface WorkConsoleCommandRejected<E extends WorkConsoleCommandFailure = WorkConsoleCommandFailure> {
  readonly ok: false
  readonly error: E
}

/** Result from `promoteIdea`. */
export type PromoteWorkConsoleIdeaResult =
  | WorkConsoleCommandSuccess<PromotedWorkConsoleTask>
  | WorkConsoleCommandRejected<
    WorkConsoleCommandNotFound | WorkConsoleCommandConflict | WorkConsoleCommandInvalidState
  >

/** Result from `decideAcceptance`. */
export type DecideWorkConsoleAcceptanceResult =
  | WorkConsoleCommandSuccess<WorkConsoleAcceptanceDecisionValue>
  | WorkConsoleCommandRejected<WorkConsoleCommandFailure>
