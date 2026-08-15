/**
 * Durable execution-thread service. It records runner publication and settlement without owning transcripts,
 * evidence payloads, environments, or runner-specific process/session internals.
 * @module @deepseek-ai/dsh-work-execution
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkItemId } from '@deepseek-ai/dsh-work-control'
import { workExecutionDomainSpec } from './spec.ts'
import type { ExecutionThreadRecord } from './spec.ts'
import type {
  BeginExecutionAttemptRequest,
  CreateExecutionThreadRequest,
  ExecutionThread,
  ExecutionThreadChanged,
  ExecutionThreadId as ExecutionThreadIdBrand,
  ExecutionThreadRef,
  SettleExecutionAttemptRequest,
} from './types.ts'

export type {
  ActiveExecutionAttempt,
  BeginExecutionAttemptRequest,
  CreateExecutionThreadRequest,
  ExecutionStopReason,
  ExecutionThread,
  ExecutionThreadChanged,
  ExecutionThreadRef,
  ExecutionThreadState,
  RunnerMode,
  SettleExecutionAttemptRequest,
  SettledExecutionAttempt,
} from './types.ts'
export { executionThreadRecord, workExecutionDomainSpec } from './spec.ts'

/** Stable identity of one execution effort. */
export type ExecutionThreadId = ExecutionThreadIdBrand

/**
 * Brand a raw string as an execution-thread id.
 * @param id - Raw persisted identifier.
 * @returns the same string with the execution-thread brand.
 */
export function ExecutionThreadId(id: string): ExecutionThreadId {
  return id as ExecutionThreadId
}

/** A request named no durable execution thread. */
export class ExecutionThreadNotFoundError extends Error {
  /** @param id - Missing thread id. */
  constructor(readonly id: ExecutionThreadId) {
    super(`unknown execution thread '${id}'`)
    this.name = 'ExecutionThreadNotFoundError'
  }
}

/** A compare-and-set mutation used a stale execution-thread revision. */
export class ExecutionThreadConflictError extends Error {
  /**
   * @param expected - Caller-owned revision.
   * @param actualRevision - Current durable revision.
   */
  constructor(readonly expected: ExecutionThreadRef, readonly actualRevision: number) {
    super(`stale execution thread '${expected.id}' revision ${expected.revision}; current revision is ${actualRevision}`)
    this.name = 'ExecutionThreadConflictError'
  }
}

/** A lifecycle operation is invalid for the current thread state. */
export class ExecutionThreadTransitionError extends Error {
  /** @param message - Concrete rejected transition reason. */
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionThreadTransitionError'
  }
}

/** A task cannot currently admit a new execution thread. */
export class ExecutionTaskUnavailableError extends Error {
  /**
   * @param taskId - Task that cannot admit execution.
   * @param reason - Current task-state reason.
   */
  constructor(readonly taskId: WorkItemId, reason: string) {
    super(`task '${taskId}' cannot create an execution thread: ${reason}`)
    this.name = 'ExecutionTaskUnavailableError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workExecution: WorkExecutionService
  }

  interface Events {
    /**
     * One execution-thread mutation committed durably.
     * @param change - Exact committed thread projection.
     * @mode emit
     */
    'work-execution/changed'(change: ExecutionThreadChanged): void
  }
}

/** Durable execution-thread registry layered over global tasks. */
export class WorkExecutionService extends Service {
  static inject = ['storageDomain', 'workControl']

  private table?: KvTable<ExecutionThreadId, ExecutionThreadRecord>

  constructor(ctx: Context) {
    super(ctx, 'workExecution')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workExecutionDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workExecution.domainClose')
    this.table = domain.table('threads')
  }

  /**
   * Create one independent execution effort for an already organized, non-terminal task.
   * Multiple threads may reference the same task; this is the safe fan-out unit for later P0 scheduling.
   * @param request - Task identity to attach.
   * @returns the durable idle thread.
   */
  async createThread(request: CreateExecutionThreadRequest): Promise<ExecutionThread> {
    this.assertTaskAdmitsExecution(request.taskId)
    const now = new Date().toISOString()
    const id = ExecutionThreadId(randomUUID())
    const thread: ExecutionThread = {
      id,
      revision: 1,
      taskId: request.taskId,
      state: 'idle',
      attemptSeq: 0,
      createdAt: now,
      updatedAt: now,
    }
    await this.requireTable().put(id, thread)
    this.emitChanged({ operation: 'create', thread, ref: refOf(thread) })
    return thread
  }

  /**
   * Read one thread.
   * @param id - Thread identity.
   * @returns the current record or undefined.
   */
  get(id: ExecutionThreadId): ExecutionThread | undefined {
    return this.requireTable().get(id)
  }

  /**
   * List threads newest-first, optionally limited to one task.
   * @param taskId - Optional task filter.
   * @returns a fresh ordered array.
   */
  list(taskId?: WorkItemId): ExecutionThread[] {
    return [...this.requireTable().entries()]
      .map(([, thread]) => thread)
      .filter(thread => taskId === undefined || thread.taskId === taskId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || String(left.id).localeCompare(String(right.id)))
  }

  /**
   * Record an attempt only after the runner has successfully published. One thread owns at most one active attempt.
   * @param expected - Exact idle thread revision.
   * @param request - Runner provider/mode plus optional DSH subagent session identity.
   * @returns the running thread with a new attempt sequence.
   */
  async beginAttempt(
    expected: ExecutionThreadRef,
    request: BeginExecutionAttemptRequest,
  ): Promise<ExecutionThread> {
    const provider = requireText(request.provider, 'runner provider')
    return await this.updateThread(expected, current => {
      if (current.state !== 'idle' || current.activeAttempt !== undefined) {
        throw new ExecutionThreadTransitionError(`thread '${expected.id}' is not idle`)
      }
      this.assertTaskAdmitsExecution(current.taskId)
      const seq = current.attemptSeq + 1
      return {
        ...current,
        state: 'running',
        attemptSeq: seq,
        activeAttempt: {
          seq,
          provider,
          mode: request.mode,
          ...request.subagentSessionId === undefined ? {} : { subagentSessionId: request.subagentSessionId },
          startedAt: new Date().toISOString(),
        },
        blocker: undefined,
      }
    })
  }

  /**
   * Settle the active attempt. Settlement returns the thread to idle; task policy decides whether to continue,
   * block, validate, or close the effort. Runner-specific output stays outside this record.
   * @param expected - Exact running thread revision.
   * @param request - Runner-neutral terminal classification.
   * @returns the idle thread with the compact last-attempt projection.
   */
  async settleAttempt(
    expected: ExecutionThreadRef,
    request: SettleExecutionAttemptRequest,
  ): Promise<ExecutionThread> {
    return await this.updateThread(expected, current => {
      if (current.state !== 'running' || current.activeAttempt === undefined) {
        throw new ExecutionThreadTransitionError(`thread '${expected.id}' has no active attempt`)
      }
      const finishedAt = new Date().toISOString()
      return {
        ...current,
        state: 'idle',
        activeAttempt: undefined,
        lastAttempt: {
          ...current.activeAttempt,
          finishedAt,
          stopReason: request.stopReason,
        },
      }
    })
  }

  /**
   * Mark an idle thread blocked without cancelling a live runner.
   * @param expected - Exact idle thread revision.
   * @param reason - Human/automation-readable blocker.
   * @returns the blocked thread.
   */
  async blockThread(expected: ExecutionThreadRef, reason: string): Promise<ExecutionThread> {
    const blocker = requireText(reason, 'blocker')
    return await this.updateThread(expected, current => {
      if (current.state !== 'idle') {
        throw new ExecutionThreadTransitionError(`thread '${expected.id}' must be idle before blocking`)
      }
      return { ...current, state: 'blocked', blocker }
    })
  }

  /**
   * Return a blocked thread to idle.
   * @param expected - Exact blocked thread revision.
   * @returns the idle thread.
   */
  async resumeThread(expected: ExecutionThreadRef): Promise<ExecutionThread> {
    return await this.updateThread(expected, current => {
      if (current.state !== 'blocked') {
        throw new ExecutionThreadTransitionError(`thread '${expected.id}' is not blocked`)
      }
      this.assertTaskAdmitsExecution(current.taskId)
      return { ...current, state: 'idle', blocker: undefined }
    })
  }

  /**
   * Close an inactive thread after its execution effort is concluded.
   * @param expected - Exact idle/blocked thread revision.
   * @returns the closed thread.
   */
  async closeThread(expected: ExecutionThreadRef): Promise<ExecutionThread> {
    return await this.finishThread(expected, 'closed')
  }

  /**
   * Cancel an inactive thread that should no longer continue.
   * @param expected - Exact idle/blocked thread revision.
   * @returns the cancelled thread.
   */
  async cancelThread(expected: ExecutionThreadRef): Promise<ExecutionThread> {
    return await this.finishThread(expected, 'cancelled')
  }

  private async finishThread(
    expected: ExecutionThreadRef,
    state: 'closed' | 'cancelled',
  ): Promise<ExecutionThread> {
    return await this.updateThread(expected, current => {
      if (current.state !== 'idle' && current.state !== 'blocked') {
        throw new ExecutionThreadTransitionError(
          `thread '${expected.id}' must be inactive before ${state === 'closed' ? 'closing' : 'cancelling'}`,
        )
      }
      const now = new Date().toISOString()
      return { ...current, state, blocker: undefined, closedAt: now }
    })
  }

  private async updateThread(
    expected: ExecutionThreadRef,
    mutate: (current: ExecutionThread) => Omit<ExecutionThread, 'revision' | 'updatedAt'>
      & Partial<Pick<ExecutionThread, 'revision' | 'updatedAt'>>,
  ): Promise<ExecutionThread> {
    const next = await this.requireTable().update(expected.id, current => {
      assertRef(current, expected)
      const candidate = mutate(current)
      return {
        ...candidate,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      }
    })
    const thread = next as ExecutionThread
    this.emitChanged({ operation: 'update', thread, ref: refOf(thread) })
    return thread
  }

  private assertTaskAdmitsExecution(taskId: WorkItemId): void {
    const item = this.ctx.workControl.get(taskId)
    if (item === undefined) {
      throw new ExecutionTaskUnavailableError(taskId, 'work item does not exist')
    }
    if (item.kind !== 'task') {
      throw new ExecutionTaskUnavailableError(taskId, 'work item is still an idea')
    }
    if (item.status !== 'running' && item.status !== 'blocked') {
      throw new ExecutionTaskUnavailableError(taskId, `task status is ${item.status}`)
    }
  }

  private requireTable(): KvTable<ExecutionThreadId, ExecutionThreadRecord> {
    if (this.table === undefined) throw new Error('work-execution domain is not initialized')
    return this.table
  }

  private emitChanged(change: ExecutionThreadChanged): void {
    try {
      this.ctx.emit('work-execution/changed', change)
    } catch (error) {
      // The durable mutation already committed; notification observers cannot roll it back.
      this.ctx.logger.warn(`work-execution: work-execution/changed listener failed: ${String(error)}`)
    }
  }
}

function refOf(thread: ExecutionThread): ExecutionThreadRef {
  return { id: thread.id, revision: thread.revision }
}

function assertRef(current: ExecutionThread, expected: ExecutionThreadRef): void {
  if (current.revision !== expected.revision) {
    throw new ExecutionThreadConflictError(expected, current.revision)
  }
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new ExecutionThreadTransitionError(`${field} must not be empty`)
  return normalized
}

export default WorkExecutionService
