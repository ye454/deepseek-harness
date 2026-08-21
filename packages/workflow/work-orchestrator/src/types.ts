/** Client-neutral orchestration vocabulary. */
import type { WorkItemId } from '@deepseek-ai/dsh-work-control'
import type { WorkEnvironmentId } from '@deepseek-ai/dsh-work-environment'
import type { ExecutionThreadId } from '@deepseek-ai/dsh-work-execution'
import type { WorkNodeId } from '@deepseek-ai/dsh-work-node'

/** One explicitly isolated one-shot execution role. */
export interface WorkOrchestratorPlacement {
  readonly environmentId: WorkEnvironmentId
  readonly environmentRevision: number
  readonly provider: string
  /** Compact role/next-step text injected into this thread's bounded handoff. */
  readonly role: string
}

/** Explicit execution plan. P1/P2 admit one placement; P0 may safely fan out. */
export interface StartWorkTaskRequest {
  readonly taskId: WorkItemId
  readonly taskRevision: number
  readonly placements: readonly WorkOrchestratorPlacement[]
}

/** One durable remote command queued for one isolated ExecutionThread. */
export interface StartedWorkPlacement {
  readonly threadId: ExecutionThreadId
  readonly environmentId: WorkEnvironmentId
  readonly provider: string
  readonly role: string
  readonly commandId: string
}

/** Successful fan-out result. Runner publication still happens asynchronously through the node daemon. */
export interface StartWorkTaskResult {
  readonly taskId: WorkItemId
  readonly started: readonly StartedWorkPlacement[]
}

/** Scheduler-facing reason one Environment cannot currently be selected. */
export type WorkExecutionCandidateIssue =
  | 'environment-degraded'
  | 'environment-unavailable'
  | 'node-missing'
  | 'node-degraded'
  | 'node-offline'
  | 'node-execute-unsupported'
  | 'no-runner-provider'
  | 'workspace-leased'

/** Compact resource candidate for an execution-plan UI. */
export interface WorkExecutionCandidate {
  readonly environmentId: WorkEnvironmentId
  readonly environmentRevision: number
  readonly environmentName: string
  readonly nodeId: WorkNodeId
  readonly nodeName?: string
  readonly providers: readonly string[]
  readonly workspace: {
    readonly path: string
    readonly worktree?: string
    readonly repository?: string
    readonly branch?: string
    readonly dirty?: boolean
  }
  readonly leasedByThreadId?: ExecutionThreadId
  readonly available: boolean
  readonly issues: readonly WorkExecutionCandidateIssue[]
}

/** Zero-token scheduler facts; dispatch can be absent while the global console still works. */
export interface WorkExecutionCandidateSnapshot {
  readonly dispatchAvailable: boolean
  readonly candidates: readonly WorkExecutionCandidate[]
}
