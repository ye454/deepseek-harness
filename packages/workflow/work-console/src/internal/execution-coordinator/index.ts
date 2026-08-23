/**
 * Event-driven continuous-work coordinator.
 *
 * It advances only from durable execution facts: published attempts are stamped with workflow Stage,
 * every required execution thread must settle, failures block, and the validation service owns acceptance.
 * Runner text is never treated as Validator Evidence.
 * @module @deepseek-ai/dsh-work-execution-coordinator
 */
import { Context, Service } from '@deepseek-ai/cordis'
import {
  WorkItemConflictError,
  type TaskWorkItem,
  type WorkflowStage,
  type WorkItemId,
} from '@deepseek-ai/dsh-work-control'
import {
  ExecutionThreadConflictError,
  type ExecutionThread,
} from '@deepseek-ai/dsh-work-execution'
import {
  continueWorkThread,
  type ContinueWorkThreadResult,
} from '@deepseek-ai/dsh-work-orchestrator/continuation'
import type { RemoteNodeCommand, RemoteNodeCommandChanged } from '@deepseek-ai/dsh-work-node-gateway'

export type WorkCoordinationState = 'ignored' | 'waiting' | 'continued' | 'validation' | 'blocked'

/** Compact diagnostic result of one deterministic reconciliation pass. */
export interface WorkCoordinationResult {
  readonly taskId: WorkItemId
  readonly state: WorkCoordinationState
  readonly stageId?: string | undefined
  readonly reason?: string
  readonly continuation?: ContinueWorkThreadResult
}

/** Reconciliation could not converge after concurrent durable mutations. */
export class WorkExecutionCoordinatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkExecutionCoordinatorError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workExecutionCoordinator: WorkExecutionCoordinator
  }
}

const MAX_RECONCILE_ATTEMPTS = 4

/**
 * Thin policy layer over WorkControl, WorkExecution, WorkOrchestrator, and WorkValidation.
 * It owns no duplicate task/thread/environment database.
 */
export class WorkExecutionCoordinator extends Service {
  static inject = ['workControl', 'workExecution', 'workOrchestrator', 'workValidation']

  private readonly taskTails = new Map<WorkItemId, Promise<void>>()

  constructor(ctx: Context) {
    super(ctx, 'workExecutionCoordinator')
    ctx.on('work-execution/changed', change => {
      this.schedule(change.thread.taskId)
    })
    ctx.on('work-control/changed', change => {
      if (change.item?.kind === 'task') this.schedule(change.item.id)
    })
    ctx.on('work-node-gateway/command-changed', (change: RemoteNodeCommandChanged) => {
      const command = change.command
      if (command.kind === 'cancel' || command.state !== 'rejected') return
      const thread = this.ctx.workExecution.get(command.payload.threadId)
      if (thread === undefined) return
      this.scheduleRejected(thread.taskId, command)
    })
  }

  /** Reconcile durable work left across Host restarts before waiting for new events. */
  protected async [Service.init](): Promise<void> {
    for (const task of this.ctx.workControl.listTasks()) {
      if (this.ctx.workExecution.list(task.id).length === 0) continue
      await this.reconcile(task.id)
    }
  }

  /**
   * Re-read authoritative task/thread facts and perform at most one workflow decision.
   * Public mainly for diagnostics/tests; ordinary operation is event-driven.
   */
  async reconcile(taskId: WorkItemId): Promise<WorkCoordinationResult> {
    return await this.withTaskLock(taskId, () => this.reconcileWithRetries(taskId))
  }

  private schedule(taskId: WorkItemId): void {
    void this.withTaskLock(taskId, () => this.reconcileWithRetries(taskId))
      .catch(error => this.ctx.logger.warn(`work-execution-coordinator: ${renderError(error)}`))
  }

  private scheduleRejected(taskId: WorkItemId, command: Extract<RemoteNodeCommand, { kind: 'execute' | 'resume' }>): void {
    void this.withTaskLock(taskId, () => this.handleRejectedCommand(command))
      .catch(error => this.ctx.logger.warn(`work-execution-coordinator: rejected command reconciliation failed: ${renderError(error)}`))
  }

  private async reconcileWithRetries(taskId: WorkItemId): Promise<WorkCoordinationResult> {
    for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt++) {
      try {
        return await this.reconcileOnce(taskId)
      } catch (error) {
        if (!isRetryableConflict(error)) throw error
      }
    }
    throw new WorkExecutionCoordinatorError(`task '${taskId}' reconciliation did not converge`)
  }

  private async reconcileOnce(taskId: WorkItemId): Promise<WorkCoordinationResult> {
    const item = this.ctx.workControl.get(taskId)
    if (item === undefined || item.kind !== 'task') return { taskId, state: 'ignored', reason: 'task-missing' }

    if (item.status === 'validation') {
      if (item.validation?.state === 'passed' && !hasRequiredUserAcceptance(item)) {
        const done = await this.ctx.workControl.setStatus({ id: item.id, revision: item.revision }, 'done')
        await this.cleanupTerminalThreads(done)
        return { taskId, state: 'ignored', stageId: done.currentStageId, reason: 'validation-passed-automatically' }
      }
      await this.cleanupTerminalThreads(item)
      return { taskId, state: 'ignored', stageId: item.currentStageId, reason: 'task-validation' }
    }
    if (item.status === 'done' || item.status === 'cancelled') {
      await this.cleanupTerminalThreads(item)
      return { taskId, state: 'ignored', reason: `task-${item.status}` }
    }
    if (item.status === 'blocked') {
      await this.cleanupBlockedThreads(item)
      return { taskId, state: 'blocked', stageId: item.currentStageId, reason: 'task-already-blocked' }
    }
    if (item.status !== 'running' || item.workflow === undefined || item.currentStageId === undefined) {
      return { taskId, state: 'ignored', reason: `task-${item.status}` }
    }

    const stage = item.workflow.stages.find(candidate => candidate.id === item.currentStageId)
    if (stage === undefined) {
      return await this.blockTask(item, [], `workflow has no current stage '${item.currentStageId}'`)
    }

    const threads = activeThreads(this.ctx.workExecution.list(item.id))
    const failed = threads.find(thread => threadFailureAtOrBeforeStage(thread, stage.id) !== undefined)
    if (failed !== undefined) {
      return await this.blockTask(item, threads, threadFailureAtOrBeforeStage(failed, stage.id)!)
    }
    const coordinateMissing = threads.find(thread => thread.state === 'idle' && thread.lastAttempt !== undefined && thread.lastAttempt.stageId === undefined)
    if (coordinateMissing !== undefined) {
      return await this.blockTask(
        item,
        threads,
        `thread '${coordinateMissing.id}' attempt has no workflow-stage coordinate; automatic advancement is unsafe`,
      )
    }
    if (threads.some(thread => thread.state === 'blocked')) {
      const blocker = threads.find(thread => thread.state === 'blocked')?.blocker ?? 'execution thread blocked'
      return await this.blockTask(item, threads, blocker)
    }
    if (threads.some(thread => thread.state === 'running')) {
      return { taskId, state: 'waiting', stageId: stage.id, reason: 'runner-active' }
    }

    if (stage.kind === 'validation') {
      if (threads.some(thread => thread.state === 'idle' && thread.lastAttempt === undefined)) {
        await this.cancelUnpublishedIdleThreads(threads)
      }
      return await this.enterValidation(item, stage.id)
    }

    if (threads.length === 0) {
      return { taskId, state: 'waiting', stageId: stage.id, reason: 'awaiting-initial-dispatch' }
    }
    if (threads.some(thread => thread.state === 'idle' && thread.lastAttempt === undefined)) {
      return { taskId, state: 'waiting', stageId: stage.id, reason: 'runner-publication-pending' }
    }

    const currentStageAttempts = threads.filter(thread => thread.lastAttempt?.stageId === stage.id)
    if (currentStageAttempts.length === 0) {
      return await this.continueCurrentStage(item, stage, threads)
    }
    if (currentStageAttempts.some(thread => thread.lastAttempt?.stopReason !== 'completed')) {
      const failedThread = currentStageAttempts.find(thread => thread.lastAttempt?.stopReason !== 'completed')!
      return await this.blockTask(
        item,
        threads,
        `thread '${failedThread.id}' stopped with ${failedThread.lastAttempt?.stopReason ?? 'unknown'} at stage '${stage.id}'`,
      )
    }

    const currentIds = new Set(currentStageAttempts.map(thread => thread.id))
    const oldStageThreads = threads.filter(thread => !currentIds.has(thread.id))
    await this.closeInactiveThreads(oldStageThreads)
    return await this.advanceCompletedStage(item, stage, currentStageAttempts)
  }

  private async continueCurrentStage(
    task: TaskWorkItem,
    stage: WorkflowStage,
    threads: readonly ExecutionThread[],
  ): Promise<WorkCoordinationResult> {
    const completed = threads.filter(thread => thread.state === 'idle' && thread.lastAttempt?.stopReason === 'completed')
    if (completed.length === 0) {
      return { taskId: task.id, state: 'waiting', stageId: stage.id, reason: 'no-completed-thread-to-continue' }
    }
    const primary = choosePrimary(completed)
    await this.closeInactiveThreads(threads.filter(thread => thread.id !== primary.id))
    const current = this.ctx.workExecution.get(primary.id)
    const latestTask = this.requireRunningTask(task.id)
    if (current === undefined || current.state !== 'idle') {
      return { taskId: task.id, state: 'waiting', stageId: stage.id, reason: 'primary-thread-changed' }
    }
    try {
      const continuation = await continueWorkThread(this.ctx, {
        taskId: latestTask.id,
        taskRevision: latestTask.revision,
        threadId: current.id,
        threadRevision: current.revision,
        nextStep: stageInstruction(stage),
      })
      return { taskId: task.id, state: 'continued', stageId: stage.id, continuation }
    } catch (error) {
      return await this.blockTask(latestTask, [current], `stage '${stage.id}' continuation failed: ${renderError(error)}`)
    }
  }

  private async advanceCompletedStage(
    task: TaskWorkItem,
    stage: WorkflowStage,
    completedThreads: readonly ExecutionThread[],
  ): Promise<WorkCoordinationResult> {
    const workflow = task.workflow!
    const index = workflow.stages.findIndex(candidate => candidate.id === stage.id)
    const next = workflow.stages[index + 1]
    const primary = choosePrimary(completedThreads)

    if (next === undefined) {
      return await this.enterValidation(task, stage.id)
    }

    const advanced = await this.ctx.workControl.setStage({ id: task.id, revision: task.revision }, next.id)
    if (next.kind === 'validation') {
      return await this.enterValidation(advanced, next.id)
    }

    await this.closeInactiveThreads(completedThreads.filter(thread => thread.id !== primary.id))
    const current = this.ctx.workExecution.get(primary.id)
    if (current === undefined || current.state !== 'idle') {
      return { taskId: task.id, state: 'waiting', stageId: next.id, reason: 'primary-thread-changed-after-stage-advance' }
    }
    try {
      const continuation = await continueWorkThread(this.ctx, {
        taskId: advanced.id,
        taskRevision: advanced.revision,
        threadId: current.id,
        threadRevision: current.revision,
        nextStep: stageInstruction(next),
      })
      return { taskId: task.id, state: 'continued', stageId: next.id, continuation }
    } catch (error) {
      return await this.blockTask(advanced, [current], `stage '${next.id}' continuation failed: ${renderError(error)}`)
    }
  }

  private async enterValidation(task: TaskWorkItem, stageId: string): Promise<WorkCoordinationResult> {
    const latest = this.requireRunningTask(task.id)
    await this.ctx.workValidation.beginValidation({ id: latest.id, revision: latest.revision })
    await this.cleanupTerminalThreads(this.requireTask(task.id))
    return { taskId: task.id, state: 'validation', stageId }
  }

  private async blockTask(
    task: TaskWorkItem,
    threads: readonly ExecutionThread[],
    reason: string,
  ): Promise<WorkCoordinationResult> {
    for (const thread of threads) {
      const current = this.ctx.workExecution.get(thread.id)
      if (current?.state !== 'idle') continue
      if (current.lastAttempt === undefined) {
        await this.ctx.workExecution.cancelThread({ id: current.id, revision: current.revision })
      } else if (current.lastAttempt.stopReason === 'completed') {
        await this.ctx.workExecution.closeThread({ id: current.id, revision: current.revision })
      } else {
        await this.ctx.workExecution.blockThread({ id: current.id, revision: current.revision }, reason)
      }
    }
    const latest = this.ctx.workControl.get(task.id)
    if (latest?.kind === 'task' && latest.status === 'running') {
      await this.ctx.workControl.setStatus({ id: latest.id, revision: latest.revision }, 'blocked')
    }
    return { taskId: task.id, state: 'blocked', stageId: task.currentStageId, reason }
  }

  private async handleRejectedCommand(command: Extract<RemoteNodeCommand, { kind: 'execute' | 'resume' }>): Promise<void> {
    const thread = this.ctx.workExecution.get(command.payload.threadId)
    if (thread === undefined) return
    const reason = `remote command '${command.id}' rejected: ${command.failureCode ?? 'REMOTE_REJECTED'}`
    if (thread.state === 'idle') {
      await this.ctx.workExecution.blockThread({ id: thread.id, revision: thread.revision }, reason)
    }
    const task = this.ctx.workControl.get(thread.taskId)
    if (task?.kind === 'task' && task.status === 'running') {
      await this.ctx.workControl.setStatus({ id: task.id, revision: task.revision }, 'blocked')
    }
  }

  private async cleanupBlockedThreads(task: TaskWorkItem): Promise<void> {
    for (const thread of activeThreads(this.ctx.workExecution.list(task.id))) {
      const current = this.ctx.workExecution.get(thread.id)
      if (current?.state !== 'idle') continue
      if (current.lastAttempt?.stopReason === 'completed') {
        await this.ctx.workExecution.closeThread({ id: current.id, revision: current.revision })
      } else if (current.lastAttempt === undefined) {
        await this.ctx.workExecution.cancelThread({ id: current.id, revision: current.revision })
      }
    }
  }

  private async cleanupTerminalThreads(task: TaskWorkItem): Promise<void> {
    for (const thread of activeThreads(this.ctx.workExecution.list(task.id))) {
      const current = this.ctx.workExecution.get(thread.id)
      if (current === undefined || current.state === 'running') continue
      if (task.status === 'cancelled') {
        await this.ctx.workExecution.cancelThread({ id: current.id, revision: current.revision })
      } else {
        await this.ctx.workExecution.closeThread({ id: current.id, revision: current.revision })
      }
    }
  }

  private async closeInactiveThreads(threads: readonly ExecutionThread[]): Promise<void> {
    for (const thread of threads) {
      const current = this.ctx.workExecution.get(thread.id)
      if (current === undefined || (current.state !== 'idle' && current.state !== 'blocked')) continue
      await this.ctx.workExecution.closeThread({ id: current.id, revision: current.revision })
    }
  }

  private async cancelUnpublishedIdleThreads(threads: readonly ExecutionThread[]): Promise<void> {
    for (const thread of threads) {
      const current = this.ctx.workExecution.get(thread.id)
      if (current?.state !== 'idle' || current.lastAttempt !== undefined) continue
      await this.ctx.workExecution.cancelThread({ id: current.id, revision: current.revision })
    }
  }

  private requireTask(taskId: WorkItemId): TaskWorkItem {
    const item = this.ctx.workControl.get(taskId)
    if (item === undefined || item.kind !== 'task') throw new WorkExecutionCoordinatorError(`unknown task '${taskId}'`)
    return item
  }

  private requireRunningTask(taskId: WorkItemId): TaskWorkItem {
    const task = this.requireTask(taskId)
    if (task.status !== 'running') throw new WorkExecutionCoordinatorError(`task '${taskId}' is no longer running`)
    return task
  }

  private async withTaskLock<T>(taskId: WorkItemId, operation: () => Promise<T>): Promise<T> {
    const previous = this.taskTails.get(taskId) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => next, () => next)
    this.taskTails.set(taskId, tail)
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release()
      if (this.taskTails.get(taskId) === tail) this.taskTails.delete(taskId)
    }
  }
}

function activeThreads(threads: readonly ExecutionThread[]): ExecutionThread[] {
  return threads.filter(thread => thread.state !== 'closed' && thread.state !== 'cancelled')
}

function choosePrimary(threads: readonly ExecutionThread[]): ExecutionThread {
  const ordered = [...threads].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || String(left.id).localeCompare(String(right.id)))
  const primary = ordered[0]
  if (primary === undefined) throw new WorkExecutionCoordinatorError('cannot choose primary from an empty thread set')
  return primary
}

function hasRequiredUserAcceptance(task: TaskWorkItem): boolean {
  return (task.validationPolicy?.validators ?? []).some(validator =>
    validator.kind === 'user-acceptance' && validator.requirement === 'required')
}

function threadFailureAtOrBeforeStage(thread: ExecutionThread, currentStageId: string): string | undefined {
  if (thread.state !== 'idle' || thread.lastAttempt === undefined) return undefined
  if (thread.lastAttempt.stopReason === 'completed') return undefined
  const coordinate = thread.lastAttempt.stageId ?? 'unknown-stage'
  return `thread '${thread.id}' stopped with ${thread.lastAttempt.stopReason} at '${coordinate}' while task is at '${currentStageId}'`
}

function stageInstruction(stage: WorkflowStage): string {
  const description = stage.description?.trim()
  return `Continue with workflow stage '${stage.title}' (${stage.id}).${description === undefined || description === '' ? '' : ` ${description}`}`
}

function isRetryableConflict(error: unknown): boolean {
  return error instanceof WorkItemConflictError || error instanceof ExecutionThreadConflictError
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default WorkExecutionCoordinator
