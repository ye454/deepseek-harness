/**
 * Runner-bridge request and result vocabulary. This file contains types only.
 * @module @deepseek-ai/dsh-work-runner-subagent/src/types
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ExecutionStopReason, ExecutionThread, ExecutionThreadRef } from '@deepseek-ai/dsh-work-execution'

/** Operational conclusions that can cross runner/session boundaries without replaying a transcript. */
export interface WorkHandoff {
  readonly completed?: readonly string[]
  readonly facts?: readonly string[]
  readonly decisions?: readonly string[]
  readonly constraints?: readonly string[]
  readonly references?: readonly string[]
  readonly nextStep?: string
}

/** Discoverable DSH subagent provider facts relevant to the work console. */
export interface WorkRunnerDescriptor {
  readonly provider: string
  readonly oneShot: true
  readonly continuable: boolean
  readonly inheritsParentContext: boolean
  readonly capabilities: {
    readonly outputSchema: boolean
    readonly depthLimit: boolean
    readonly toolFilter: boolean
    readonly persona: boolean
  }
}

/** Start one one-shot DSH subagent attempt for an existing execution thread. */
export interface RunOneShotRequest {
  readonly thread: ExecutionThreadRef
  readonly parent: Agent
  readonly provider: string
  readonly signal: AbortSignal
  /** Hard UTF-8 byte ceiling applied to the complete child prompt after all wrappers are assembled. */
  readonly maxPromptBytes: number
  readonly handoff?: WorkHandoff
}

/** Result returned after the published one-shot run has settled and the execution thread is updated. */
export interface RunOneShotResult {
  readonly provider: string
  readonly childId: SessionId
  readonly output: readonly ContentBlock[]
  readonly stopReason: ExecutionStopReason
  readonly thread: ExecutionThread
}

/** Durable parent-session record of the exact child prompt sent by this bridge. */
export interface WorkRunnerSubagentRequestEvent {
  readonly kind: 'work-runner/subagent-request'
  readonly version: 1
  readonly taskId: string
  readonly threadId: string
  readonly threadRevision: number
  readonly provider: string
  readonly mode: 'one-shot'
  readonly maxPromptBytes: number
  readonly prompt: string
}
