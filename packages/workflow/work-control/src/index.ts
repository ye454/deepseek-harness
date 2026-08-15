/**
 * Global work-control service: passive ideas become durable executable tasks only after explicit promotion.
 * The service owns organization metadata, priority, workflow stage, and compact validation state; runner,
 * environment, evidence, and remote-node lifecycles remain separate capabilities.
 * @module @deepseek-ai/dsh-work-control
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { workControlDomainSpec } from './spec.ts'
import type { WorkItemRecord } from './spec.ts'
import type {
  CreateIdeaRequest,
  IdeaWorkItem,
  OrganizeTaskRequest,
  PromoteIdeaRequest,
  TaskPriority,
  TaskStatus,
  TaskWorkItem,
  ValidationSummary,
  ValidatorSpec,
  WorkItem,
  WorkItemChanged,
  WorkItemId as WorkItemIdBrand,
  WorkItemRef,
} from './types.ts'

export type {
  CreateIdeaRequest,
  IdeaWorkItem,
  OrganizeTaskRequest,
  PromoteIdeaRequest,
  TaskPriority,
  TaskStatus,
  TaskType,
  TaskWorkItem,
  ValidationPolicy,
  ValidationSummary,
  ValidatorKind,
  ValidatorRequirement,
  ValidatorSpec,
  WorkflowPlan,
  WorkflowStage,
  WorkflowStageKind,
  WorkItem,
  WorkItemChanged,
  WorkItemRef,
} from './types.ts'
export { workControlDomainSpec } from './spec.ts'

/** Stable work-item id. */
export type WorkItemId = WorkItemIdBrand

/**
 * Brand a raw string as a work-item id.
 * @param id - Raw persisted identifier.
 * @returns the same string with the work-item brand.
 */
export function WorkItemId(id: string): WorkItemId {
  return id as WorkItemId
}

/** A request named an item absent from durable work-control state. */
export class WorkItemNotFoundError extends Error {
  /** @param id - Missing work-item id. */
  constructor(readonly id: WorkItemId) {
    super(`unknown work item '${id}'`)
    this.name = 'WorkItemNotFoundError'
  }
}

/** A compare-and-set mutation used a stale revision. */
export class WorkItemConflictError extends Error {
  /**
   * @param expected - Caller-owned work-item revision.
   * @param actualRevision - Current durable revision.
   */
  constructor(readonly expected: WorkItemRef, readonly actualRevision: number) {
    super(`stale work item '${expected.id}' revision ${expected.revision}; current revision is ${actualRevision}`)
    this.name = 'WorkItemConflictError'
  }
}

/** A lifecycle mutation is invalid for the item's current kind or task state. */
export class WorkItemTransitionError extends Error {
  /** @param message - Concrete rejected transition reason. */
  constructor(message: string) {
    super(message)
    this.name = 'WorkItemTransitionError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workControl: WorkControlService
  }

  interface Events {
    /**
     * One work-control mutation committed durably.
     * @param change - Exact committed item projection or delete tombstone.
     * @mode emit
     */
    'work-control/changed'(change: WorkItemChanged): void
  }
}

const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  organizing: ['running', 'cancelled'],
  running: ['blocked', 'validation', 'done', 'cancelled'],
  blocked: ['running', 'cancelled'],
  validation: ['running', 'done', 'cancelled'],
  done: [],
  cancelled: [],
}

/**
 * Check one explicit task-status transition.
 * @param from - Current status.
 * @param to - Requested next status.
 * @returns Whether the transition is admitted by the domain lifecycle.
 */
export function isTaskStatusTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to)
}

/** Durable global idea/task registry. No model tool is registered by this package. */
export class WorkControlService extends Service {
  static inject = ['storageDomain']

  private table?: KvTable<WorkItemId, WorkItemRecord>
  private ideaTransitionTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'workControl')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workControlDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workControl.domainClose')
    this.table = domain.table('items')
  }

  /**
   * Capture a passive idea without creating an Agent, Goal, workflow run, or environment.
   * @param request - Idea title plus optional summary and tags.
   * @returns the durable idea record.
   */
  async createIdea(request: CreateIdeaRequest): Promise<IdeaWorkItem> {
    const now = new Date().toISOString()
    const id = WorkItemId(randomUUID())
    const item: IdeaWorkItem = {
      kind: 'idea',
      id,
      revision: 1,
      title: requireText(request.title, 'idea title'),
      summary: request.summary?.trim() ?? '',
      tags: normalizeTags(request.tags ?? []),
      createdAt: now,
      updatedAt: now,
    }
    await this.requireTable().put(id, item)
    this.emitChanged({ operation: 'create', item, ref: refOf(item) })
    return item
  }

  /**
   * List passive ideas ordered by latest update first.
   * @returns a fresh ordered array.
   */
  listIdeas(): IdeaWorkItem[] {
    return this.list().filter((item): item is IdeaWorkItem => item.kind === 'idea')
  }

  /**
   * List executable tasks ordered by latest update first.
   * @returns a fresh ordered array.
   */
  listTasks(): TaskWorkItem[] {
    return this.list().filter((item): item is TaskWorkItem => item.kind === 'task')
  }

  /**
   * Read one work item.
   * @param id - Stable id shared across idea promotion.
   * @returns the current durable record or undefined.
   */
  get(id: WorkItemId): WorkItem | undefined {
    const record = this.requireTable().get(id)
    return record === undefined ? undefined : asWorkItem(record)
  }

  /**
   * Explicitly promote an idea into the execution area. Promotion and idea deletion are serialized so
   * one idea cannot be both deleted and promoted under the same revision.
   * @param expected - Exact idea revision.
   * @param request - Optional priority; omitted resolves to normal P2.
   * @returns the promoted task using the same stable id.
   */
  promoteIdea(expected: WorkItemRef, request: PromoteIdeaRequest = {}): Promise<TaskWorkItem> {
    return this.enqueueIdeaTransition(async () => {
      const next = await this.requireTable().update(expected.id, record => {
        const current = asWorkItem(record)
        assertRef(current, expected)
        if (current.kind !== 'idea') {
          throw new WorkItemTransitionError(`work item '${expected.id}' is already a task`)
        }
        const now = new Date().toISOString()
        return {
          kind: 'task',
          id: current.id,
          revision: current.revision + 1,
          title: current.title,
          summary: current.summary,
          tags: current.tags,
          priority: request.priority ?? 'p2',
          status: 'organizing',
          createdAt: current.createdAt,
          promotedAt: now,
          updatedAt: now,
        }
      })
      const task = asWorkItem(next) as TaskWorkItem
      this.emitChanged({ operation: 'promote', item: task, ref: refOf(task) })
      return task
    })
  }

  /**
   * Commit the task-specific workflow and validator composition, then admit the first execution stage.
   * @param expected - Exact organizing-task revision.
   * @param request - Classified task type, ordered workflow, and validation policy.
   * @returns the running task at its first stage.
   */
  async organizeTask(expected: WorkItemRef, request: OrganizeTaskRequest): Promise<TaskWorkItem> {
    validateWorkflow(request.workflow)
    validateValidators(request.validationPolicy.validators)
    const next = await this.requireTable().update(expected.id, record => {
      const current = asWorkItem(record)
      assertRef(current, expected)
      if (current.kind !== 'task' || current.status !== 'organizing') {
        throw new WorkItemTransitionError(`work item '${expected.id}' is not awaiting organization`)
      }
      const now = new Date().toISOString()
      return {
        ...current,
        revision: current.revision + 1,
        status: 'running',
        taskType: request.taskType,
        workflow: request.workflow,
        currentStageId: request.workflow.stages[0]!.id,
        validationPolicy: request.validationPolicy,
        validation: initialValidation(request.validationPolicy.validators),
        updatedAt: now,
      }
    })
    const task = asWorkItem(next) as TaskWorkItem
    this.emitChanged({ operation: 'update', item: task, ref: refOf(task) })
    return task
  }

  /**
   * Move a task to another existing workflow stage.
   * @param expected - Exact task revision.
   * @param stageId - Existing stage id from the task workflow.
   * @returns the updated task.
   */
  async setStage(expected: WorkItemRef, stageId: string): Promise<TaskWorkItem> {
    return await this.updateTask(expected, current => {
      if (current.workflow === undefined) {
        throw new WorkItemTransitionError(`task '${expected.id}' has not been organized`)
      }
      if (!current.workflow.stages.some(stage => stage.id === stageId)) {
        throw new WorkItemTransitionError(`task '${expected.id}' workflow has no stage '${stageId}'`)
      }
      return { ...current, currentStageId: stageId }
    })
  }

  /**
   * Change execution status. Entering `done` is refused until every required validator has passed.
   * @param expected - Exact task revision.
   * @param status - Requested next status.
   * @returns the updated task.
   */
  async setStatus(expected: WorkItemRef, status: TaskStatus): Promise<TaskWorkItem> {
    return await this.updateTask(expected, current => {
      if (!isTaskStatusTransitionAllowed(current.status, status)) {
        throw new WorkItemTransitionError(`task '${expected.id}' cannot move from ${current.status} to ${status}`)
      }
      if (status === 'done') assertRequiredValidationPassed(current)
      return { ...current, status }
    })
  }

  /**
   * Change priority; terminal tasks keep their recorded priority immutable.
   * @param expected - Exact task revision.
   * @param priority - P0 urgent, P1 high, or P2 normal.
   * @returns the updated task.
   */
  async setPriority(expected: WorkItemRef, priority: TaskPriority): Promise<TaskWorkItem> {
    return await this.updateTask(expected, current => {
      if (current.status === 'done' || current.status === 'cancelled') {
        throw new WorkItemTransitionError(`terminal task '${expected.id}' cannot change priority`)
      }
      return { ...current, priority }
    })
  }

  /**
   * Publish compact validator progress for the board. Required counts are derived from the immutable task
   * policy so a validator consumer cannot silently drop a required human or automated gate.
   * @param expected - Exact task revision.
   * @param summary - Aggregated validator result.
   * @returns the updated task.
   */
  async setValidationSummary(expected: WorkItemRef, summary: ValidationSummary): Promise<TaskWorkItem> {
    return await this.updateTask(expected, current => {
      const validators = current.validationPolicy?.validators
      if (validators === undefined) {
        throw new WorkItemTransitionError(`task '${expected.id}' has no validation policy`)
      }
      const requiredTotal = countRequired(validators)
      if (!Number.isInteger(summary.requiredPassed) || summary.requiredPassed < 0) {
        throw new WorkItemTransitionError('requiredPassed must be a non-negative integer')
      }
      if (summary.requiredTotal !== requiredTotal) {
        throw new WorkItemTransitionError(
          `requiredTotal ${summary.requiredTotal} does not match task policy required count ${requiredTotal}`,
        )
      }
      if (summary.requiredPassed > requiredTotal) {
        throw new WorkItemTransitionError('requiredPassed cannot exceed requiredTotal')
      }
      if (summary.state === 'passed' && summary.requiredPassed !== requiredTotal) {
        throw new WorkItemTransitionError('validation cannot pass before every required validator passes')
      }
      return { ...current, validation: summary }
    })
  }

  /**
   * Delete a passive idea. Promotion and deletion are serialized before either commit point.
   * @param expected - Exact idea revision.
   * @returns whether the idea was removed.
   */
  deleteIdea(expected: WorkItemRef): Promise<boolean> {
    return this.enqueueIdeaTransition(async () => {
      const current = this.requireItem(expected.id)
      assertRef(current, expected)
      if (current.kind !== 'idea') {
        throw new WorkItemTransitionError(`task '${expected.id}' cannot be deleted through deleteIdea`)
      }
      const deleted = await this.requireTable().delete(expected.id)
      if (deleted) {
        this.emitChanged({ operation: 'delete', ref: { id: expected.id, revision: expected.revision + 1 } })
      }
      return deleted
    })
  }

  private list(): WorkItem[] {
    return [...this.requireTable().entries()]
      .map(([, item]) => asWorkItem(item))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || String(left.id).localeCompare(String(right.id)))
  }

  private async updateTask(
    expected: WorkItemRef,
    mutate: (current: TaskWorkItem) => Omit<TaskWorkItem, 'revision' | 'updatedAt'>
      & Partial<Pick<TaskWorkItem, 'revision' | 'updatedAt'>>,
  ): Promise<TaskWorkItem> {
    const next = await this.requireTable().update(expected.id, record => {
      const current = asWorkItem(record)
      assertRef(current, expected)
      if (current.kind !== 'task') {
        throw new WorkItemTransitionError(`work item '${expected.id}' is still an idea`)
      }
      const candidate = mutate(current)
      return {
        ...candidate,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      }
    })
    const task = asWorkItem(next) as TaskWorkItem
    this.emitChanged({ operation: 'update', item: task, ref: refOf(task) })
    return task
  }

  private enqueueIdeaTransition<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.ideaTransitionTail.then(operation)
    this.ideaTransitionTail = result.then(() => undefined, () => undefined)
    return result
  }

  private requireItem(id: WorkItemId): WorkItem {
    const item = this.get(id)
    if (item === undefined) throw new WorkItemNotFoundError(id)
    return item
  }

  private requireTable(): KvTable<WorkItemId, WorkItemRecord> {
    if (this.table === undefined) throw new Error('work-control domain is not initialized')
    return this.table
  }

  private emitChanged(change: WorkItemChanged): void {
    try {
      this.ctx.emit('work-control/changed', change)
    } catch (error) {
      // The domain write already committed; an observer cannot retroactively reject it.
      this.ctx.logger.warn(`work-control: work-control/changed listener failed: ${String(error)}`)
    }
  }
}

/** The storage domain has already validated the record; this narrows Zod's optional-field output to the domain interface. */
function asWorkItem(record: WorkItemRecord): WorkItem {
  return record as WorkItem
}

function refOf(item: WorkItem): WorkItemRef {
  return { id: item.id, revision: item.revision }
}

function assertRef(current: WorkItem, expected: WorkItemRef): void {
  if (current.revision !== expected.revision) {
    throw new WorkItemConflictError(expected, current.revision)
  }
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${field} must not be empty`)
  return normalized
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))]
}

function validateWorkflow(workflow: OrganizeTaskRequest['workflow']): void {
  if (workflow.stages.length === 0) throw new WorkItemTransitionError('workflow must contain at least one stage')
  const ids = new Set<string>()
  for (const stage of workflow.stages) {
    if (stage.id.trim().length === 0 || stage.title.trim().length === 0) {
      throw new WorkItemTransitionError('workflow stage id and title must not be empty')
    }
    if (ids.has(stage.id)) throw new WorkItemTransitionError(`duplicate workflow stage '${stage.id}'`)
    ids.add(stage.id)
  }
}

function validateValidators(validators: readonly ValidatorSpec[]): void {
  for (const validator of validators) {
    if (validator.label.trim().length === 0) {
      throw new WorkItemTransitionError('validator label must not be empty')
    }
  }
}

function countRequired(validators: readonly ValidatorSpec[]): number {
  return validators.filter(validator => validator.requirement === 'required').length
}

function initialValidation(validators: readonly ValidatorSpec[]): ValidationSummary {
  return { state: 'pending', requiredPassed: 0, requiredTotal: countRequired(validators) }
}

function assertRequiredValidationPassed(task: TaskWorkItem): void {
  const requiredTotal = countRequired(task.validationPolicy?.validators ?? [])
  if (requiredTotal === 0) return
  const validation = task.validation
  if (validation?.state !== 'passed' || validation.requiredPassed !== requiredTotal) {
    throw new WorkItemTransitionError(
      `task '${task.id}' cannot complete before all ${requiredTotal} required validators pass`,
    )
  }
}

export default WorkControlService
