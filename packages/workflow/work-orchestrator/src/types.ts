/** Client-neutral orchestration vocabulary. */
import type { WorkItemId } from '@deepseek-ai/dsh-work-control'
import type { WorkEnvironmentId } from '@deepseek-ai/dsh-work-environment'
import type { ExecutionThreadId } from '@deepseek-ai/dsh-work-execution'

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
