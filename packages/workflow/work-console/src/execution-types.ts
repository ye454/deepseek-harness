/** Client-safe execution-plan vocabulary for the Work Console. */

export interface WorkConsoleExecutionCandidate {
  readonly environmentId: string
  readonly environmentRevision: number
  readonly environmentName: string
  readonly nodeId: string
  readonly nodeName?: string
  readonly providers: readonly string[]
  readonly workspace: {
    readonly path: string
    readonly worktree?: string
    readonly repository?: string
    readonly branch?: string
    readonly dirty?: boolean
  }
  readonly leasedByThreadId?: string
  readonly available: boolean
  readonly issues: readonly string[]
}

export interface WorkConsoleExecutionPlanSnapshot {
  readonly dispatchAvailable: boolean
  readonly candidates: readonly WorkConsoleExecutionCandidate[]
}

export interface WorkConsoleExecutionPlacementRequest {
  readonly environmentId: string
  readonly environmentRevision: number
  readonly provider: string
  readonly role: string
}

export interface StartWorkConsoleExecutionRequest {
  readonly taskId: string
  readonly taskRevision: number
  readonly placements: readonly WorkConsoleExecutionPlacementRequest[]
}

export interface StartedWorkConsoleExecutionPlacement {
  readonly threadId: string
  readonly environmentId: string
  readonly provider: string
  readonly role: string
  readonly commandId: string
}

export interface StartedWorkConsoleExecution {
  readonly taskId: string
  readonly started: readonly StartedWorkConsoleExecutionPlacement[]
}

export type WorkConsoleExecutionStartFailure =
  | {
      readonly code: 'execution-unavailable'
      readonly reason: string
    }
  | {
      readonly code: 'invalid-plan'
      readonly reason: string
    }
  | {
      readonly code: 'partial-start'
      readonly reason: string
      readonly failedIndex: number
      readonly started: readonly StartedWorkConsoleExecutionPlacement[]
    }

export type StartWorkConsoleExecutionResult =
  | { readonly ok: true; readonly value: StartedWorkConsoleExecution }
  | { readonly ok: false; readonly error: WorkConsoleExecutionStartFailure }
