/**
 * Durable execution-thread vocabulary. This file contains types only.
 * @module @deepseek-ai/dsh-work-execution/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkItemId } from '@deepseek-ai/dsh-work-control'

/** Stable identity of one execution effort attached to a task. */
export type ExecutionThreadId = Branded<'ExecutionThreadId'>

/** Compare-and-set identity for one exact thread revision. */
export interface ExecutionThreadRef {
  readonly id: ExecutionThreadId
  readonly revision: number
}

/** Thread lifecycle. Task board status remains owned by work-control. */
export type ExecutionThreadState = 'idle' | 'running' | 'blocked' | 'closed' | 'cancelled'

/** Whether the runner attempt is disposable one-shot work or has a durable resumable child session. */
export type RunnerMode = 'one-shot' | 'continuable'

/** Runner-neutral terminal classification stored by the execution domain. */
export type ExecutionStopReason = 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'refused' | 'limit' | 'unknown'

/** One active runner attempt. Detailed output and logs belong to execution history/evidence. */
export interface ActiveExecutionAttempt {
  readonly seq: number
  readonly provider: string
  readonly mode: RunnerMode
  readonly subagentSessionId?: SessionId
  /** Workflow stage current when the runner was durably published. Optional for pre-coordinate records. */
  readonly stageId?: string
  readonly startedAt: string
}

/** Compact terminal projection of the most recently settled attempt. */
export interface SettledExecutionAttempt extends ActiveExecutionAttempt {
  readonly finishedAt: string
  readonly stopReason: ExecutionStopReason
}

/** Durable thread record. It deliberately retains no transcript or model reasoning. */
export interface ExecutionThread extends ExecutionThreadRef {
  readonly taskId: WorkItemId
  readonly state: ExecutionThreadState
  readonly attemptSeq: number
  readonly activeAttempt?: ActiveExecutionAttempt
  readonly lastAttempt?: SettledExecutionAttempt
  readonly blocker?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly closedAt?: string
}

/** Create one independent execution effort for an already organized non-terminal task. */
export interface CreateExecutionThreadRequest {
  readonly taskId: WorkItemId
}

/** Record a runner only after that runner has successfully published. */
export interface BeginExecutionAttemptRequest {
  readonly provider: string
  readonly mode: RunnerMode
  readonly subagentSessionId?: SessionId
}

/** Settle the currently active attempt. */
export interface SettleExecutionAttemptRequest {
  readonly stopReason: ExecutionStopReason
}

/** Post-commit change notification. */
export interface ExecutionThreadChanged {
  readonly operation: 'create' | 'update'
  readonly thread: ExecutionThread
  readonly ref: ExecutionThreadRef
}
