/** Client-safe intake and organization vocabulary for Work Console V1. */
import type {
  WorkConsoleCommandConflict,
  WorkConsoleCommandInvalidState,
  WorkConsoleCommandNotFound,
  WorkConsoleCommandRejected,
  WorkConsoleCommandSuccess,
} from './types.ts'

/** User-selected deterministic organization template. */
export type WorkConsoleTaskType =
  | 'bug-fix'
  | 'ui-fix'
  | 'feature'
  | 'performance'
  | 'deployment'
  | 'research'
  | 'custom'

/** Capture a passive Idea. No Task/Runner/environment is created. */
export interface CreateWorkConsoleIdeaRequest {
  readonly title: string
  readonly summary?: string
  readonly tags?: readonly string[]
}

/** Compact acknowledgement for a newly captured passive Idea. */
export interface CreatedWorkConsoleIdea {
  readonly id: string
  readonly revision: number
  readonly title: string
}

/** Organize one promoted Task through a deterministic built-in template. */
export interface OrganizeWorkConsoleTaskRequest {
  readonly taskId: string
  readonly taskRevision: number
  readonly taskType: WorkConsoleTaskType
}

/** Compact acknowledgement after organization admits the first execution stage. */
export interface OrganizedWorkConsoleTask {
  readonly taskId: string
  readonly revision: number
  readonly status: 'running'
  readonly taskType: WorkConsoleTaskType
  readonly stageId: string
}

/** Expected create rejection. */
export interface WorkConsoleCommandInvalidInput {
  readonly code: 'invalid-input'
  readonly field: 'title' | 'summary' | 'tags'
  readonly reason: string
}

export type CreateWorkConsoleIdeaResult =
  | WorkConsoleCommandSuccess<CreatedWorkConsoleIdea>
  | WorkConsoleCommandRejected<WorkConsoleCommandInvalidInput>

export type OrganizeWorkConsoleTaskResult =
  | WorkConsoleCommandSuccess<OrganizedWorkConsoleTask>
  | WorkConsoleCommandRejected<WorkConsoleCommandNotFound | WorkConsoleCommandConflict | WorkConsoleCommandInvalidState>
