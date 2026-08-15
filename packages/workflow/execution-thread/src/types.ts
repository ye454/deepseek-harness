/**
 * Durable execution-thread vocabulary. This module contains types only.
 * @module @deepseek-ai/dsh-execution-thread/src/types
 */

import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkItemId, WorkItemRef } from '@deepseek-ai/dsh-work-control'

/** Stable identity of one execution attempt attached to a task. */
export type ExecutionThreadId = Branded<'ExecutionThreadId'>

/** Compare-and-set reference to one exact execution-thread revision. */
export interface ExecutionThreadRef {
  readonly id: ExecutionThreadId
  readonly revision: number
}

/** Durable lifecycle independent from one child Agent activation epoch. */
export type ExecutionThreadState =
  | 'starting'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Compact operational handoff. It stores conclusions and next actions, never private reasoning. */
export interface ExecutionHandoff {
  readonly summary: string
  readonly nextStep: string
  readonly updatedAt: string
}

/** One durable task execution bound to a DSH continuable subagent session. */
export interface ExecutionThread extends ExecutionThreadRef {
  readonly workItemId: WorkItemId
  readonly provider: string
  readonly label: string
  readonly parentSessionId: SessionId
  readonly childSessionId?: SessionId
  readonly state: ExecutionThreadState
  readonly handoff?: ExecutionHandoff
  readonly createdAt: string
  readonly updatedAt: string
}

/** Start one thread only after the referenced work item is an organized executable task. */
export interface StartExecutionThreadRequest {
  readonly workItem: WorkItemRef
  readonly provider: string
  readonly label: string
  readonly prompt: readonly ContentBlock[]
  readonly agentOptions?: AgentOptions
}

/** Resume or continue one parked thread by delivering one new turn. */
export interface ContinueExecutionThreadRequest {
  readonly content: readonly ContentBlock[]
}

/** Durable thread mutation notification. */
export interface ExecutionThreadChanged {
  readonly operation: 'create' | 'update'
  readonly thread: ExecutionThread
}
