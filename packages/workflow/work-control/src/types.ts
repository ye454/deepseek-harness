/**
 * Durable work-control vocabulary. This file intentionally contains types only.
 * @module @deepseek-ai/dsh-work-control/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by an idea before promotion and the task after promotion. */
export type WorkItemId = Branded<'WorkItemId'>

/** Compare-and-set identity for one exact work-item revision. */
export interface WorkItemRef {
  readonly id: WorkItemId
  readonly revision: number
}

/** Coarse priority; only P0 is expected to trigger expedited multi-runner scheduling. */
export type TaskPriority = 'p0' | 'p1' | 'p2'

/** Task execution state after an idea is explicitly promoted. */
export type TaskStatus = 'organizing' | 'running' | 'blocked' | 'validation' | 'done' | 'cancelled'

/** Broad task classification used to select or generate a workflow. */
export type TaskType =
  | 'bug-fix'
  | 'ui-fix'
  | 'feature'
  | 'performance'
  | 'deployment'
  | 'research'
  | 'custom'

/** Semantic stage role; display labels remain task-specific. */
export type WorkflowStageKind =
  | 'diagnosis'
  | 'research'
  | 'experiment'
  | 'design'
  | 'implementation'
  | 'deployment'
  | 'validation'
  | 'conclusion'
  | 'custom'

/** One ordered workflow stage. */
export interface WorkflowStage {
  readonly id: string
  readonly title: string
  readonly kind: WorkflowStageKind
  readonly description?: string
}

/** Versioned task workflow chosen or generated during organization. */
export interface WorkflowPlan {
  readonly version: 1
  readonly stages: readonly WorkflowStage[]
}

/** Built-in validation mechanisms; consumers may combine several per task. */
export type ValidatorKind =
  | 'automated-test'
  | 'visual-model'
  | 'runtime-check'
  | 'log-check'
  | 'benchmark'
  | 'device-test'
  | 'static-check'
  | 'artifact-check'
  | 'user-acceptance'

/** Whether one validator gates completion or only contributes evidence. */
export type ValidatorRequirement = 'required' | 'advisory' | 'optional'

/** One validator entry in a task-specific acceptance policy. */
export interface ValidatorSpec {
  readonly kind: ValidatorKind
  readonly requirement: ValidatorRequirement
  readonly label: string
}

/** Versioned validation policy. An empty list is valid for work that has no separate acceptance step. */
export interface ValidationPolicy {
  readonly version: 1
  readonly validators: readonly ValidatorSpec[]
}

/** Compact validation projection for the global board; detailed evidence belongs to the execution layer. */
export interface ValidationSummary {
  readonly state: 'pending' | 'passed' | 'failed'
  readonly checkedAt?: string
  readonly requiredPassed: number
  readonly requiredTotal: number
}

/** Passive idea card. It never owns an execution session, runner, or environment. */
export interface IdeaWorkItem extends WorkItemRef {
  readonly kind: 'idea'
  readonly title: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Executable task created only by explicit idea promotion. */
export interface TaskWorkItem extends WorkItemRef {
  readonly kind: 'task'
  readonly title: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly priority: TaskPriority
  readonly status: TaskStatus
  readonly taskType?: TaskType
  readonly workflow?: WorkflowPlan
  readonly currentStageId?: string
  readonly validationPolicy?: ValidationPolicy
  readonly validation?: ValidationSummary
  readonly createdAt: string
  readonly promotedAt: string
  readonly updatedAt: string
}

/** One global work-control record. */
export type WorkItem = IdeaWorkItem | TaskWorkItem

/** Input for passive idea capture. */
export interface CreateIdeaRequest {
  readonly title: string
  readonly summary?: string
  readonly tags?: readonly string[]
}

/** Explicit human-side promotion request; organization happens after this transition. */
export interface PromoteIdeaRequest {
  readonly priority?: TaskPriority
}

/** Organization result produced before task execution begins. */
export interface OrganizeTaskRequest {
  readonly taskType: TaskType
  readonly workflow: WorkflowPlan
  readonly validationPolicy: ValidationPolicy
}

/** Change notification emitted after durable state is committed. */
export interface WorkItemChanged {
  readonly operation: 'create' | 'update' | 'promote' | 'delete'
  readonly item?: WorkItem
  readonly ref: WorkItemRef
}
