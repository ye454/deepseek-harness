/**
 * Explicit Host-owned mutation boundary for the global Work Console.
 * @module @deepseek-ai/dsh-work-console-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  WorkItemConflictError,
  WorkItemId,
  WorkItemTransitionError,
  type TaskWorkItem,
} from '@deepseek-ai/dsh-work-control'
import { WorkValidationError } from '@deepseek-ai/dsh-work-validation'
import type {
  DecideWorkConsoleAcceptanceRequest,
  DecideWorkConsoleAcceptanceResult,
  PromoteWorkConsoleIdeaRequest,
  PromoteWorkConsoleIdeaResult,
  PromotedWorkConsoleTask,
  WorkConsoleAcceptanceDecisionValue,
  WorkConsoleCommandFailure,
  WorkConsoleCommandRejected,
  WorkConsoleCommandSuccess,
} from './types.ts'

export type * from './types.ts'

// Typert-generated Host/client artifacts use Zod at runtime.
import type {} from 'zod'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workConsoleCommands: WorkConsoleCommandService
  }
}

/** Mutation Remote. It owns orchestration only; Work Control/Validation remain the durable authorities. */
export class WorkConsoleCommandService extends TypertRemoteService {
  static inject = ['workControl', 'workValidation']

  constructor(ctx: Context) {
    super(ctx, 'workConsoleCommands')
  }

  /**
   * Explicitly move one passive Idea into the execution area.
   * Promotion stops at `organizing`; this command never starts a model, Runner, or Environment.
   */
  @Remote('promoteIdea')
  async promoteIdea(request: PromoteWorkConsoleIdeaRequest): Promise<PromoteWorkConsoleIdeaResult> {
    const id = WorkItemId(request.id)
    const current = this.ctx.workControl.get(id)
    if (current === undefined) return rejected({ code: 'not-found', id: request.id })
    if (current.revision !== request.revision) return conflict(request.id, request.revision, current.revision)
    if (current.kind !== 'idea') {
      return rejected({ code: 'invalid-state', id: request.id, reason: 'work item is already an executable task' })
    }

    try {
      const task = await this.ctx.workControl.promoteIdea(
        { id: current.id, revision: current.revision },
        request.priority === undefined ? {} : { priority: request.priority },
      )
      const value: PromotedWorkConsoleTask = {
        id: String(task.id),
        revision: task.revision,
        status: 'organizing',
        priority: task.priority,
      }
      return success(value)
    } catch (error) {
      if (error instanceof WorkItemConflictError) {
        return conflict(request.id, request.revision, error.actualRevision)
      }
      if (error instanceof WorkItemTransitionError) {
        return rejected({ code: 'invalid-state', id: request.id, reason: error.message })
      }
      throw error
    }
  }

  /**
   * Record one explicit human acceptance decision. The browser supplies no actor identity.
   * The Host derives a harness-home-scoped audit actor and rechecks automated readiness before completion.
   */
  @Remote('decideAcceptance')
  async decideAcceptance(request: DecideWorkConsoleAcceptanceRequest): Promise<DecideWorkConsoleAcceptanceResult> {
    const taskId = WorkItemId(request.taskId)
    const inspected = this.inspectAcceptanceRequest(request, taskId)
    if (!inspected.ok) return inspected

    const actor = `harness-home:${getOrCreateAnonymousUserId()}`
    try {
      await this.ctx.workValidation.recordUserAcceptance({
        taskId,
        generation: request.generation,
        validatorIndex: request.validatorIndex,
        outcome: request.decision === 'accept' ? 'passed' : 'failed',
        actor,
      })
    } catch (error) {
      if (error instanceof WorkValidationError) return this.validationRaceFailure(request, taskId)
      if (error instanceof WorkItemConflictError) {
        const latest = this.ctx.workControl.get(taskId)
        return conflict(request.taskId, request.taskRevision, latest?.revision ?? error.actualRevision)
      }
      throw error
    }

    const afterDecision = this.requireCurrentTask(taskId)
    if (!afterDecision.ok) return afterDecision

    if (request.decision === 'return') {
      return await this.returnToExecution(request, afterDecision.value)
    }

    // A concurrent automated result may have landed around the human decision.
    // Re-evaluate the complete current generation before permitting `done`.
    const readiness = this.automatedReadiness(afterDecision.value, request.generation)
    if (!readiness.ok) return readiness
    if (afterDecision.value.validation?.state !== 'passed') {
      return success({
        taskId: String(afterDecision.value.id),
        revision: afterDecision.value.revision,
        status: 'validation',
        decision: 'accept',
      })
    }

    try {
      const done = await this.ctx.workControl.setStatus(
        { id: afterDecision.value.id, revision: afterDecision.value.revision },
        'done',
      )
      return success({
        taskId: String(done.id),
        revision: done.revision,
        status: 'done',
        decision: 'accept',
      })
    } catch (error) {
      if (error instanceof WorkItemConflictError) {
        const latest = this.ctx.workControl.get(taskId)
        return conflict(request.taskId, afterDecision.value.revision, latest?.revision ?? error.actualRevision)
      }
      if (error instanceof WorkItemTransitionError) {
        return rejected({ code: 'invalid-state', id: request.taskId, reason: error.message })
      }
      throw error
    }
  }

  private inspectAcceptanceRequest(
    request: DecideWorkConsoleAcceptanceRequest,
    taskId: ReturnType<typeof WorkItemId>,
  ): WorkConsoleCommandSuccess<TaskWorkItem> | WorkConsoleCommandRejected<WorkConsoleCommandFailure> {
    const item = this.ctx.workControl.get(taskId)
    if (item === undefined) return rejected({ code: 'not-found', id: request.taskId })
    if (item.kind !== 'task') {
      return rejected({ code: 'invalid-state', id: request.taskId, reason: 'work item is still a passive idea' })
    }
    if (item.revision !== request.taskRevision) {
      return conflict(request.taskId, request.taskRevision, item.revision)
    }
    if (item.status !== 'validation') {
      return rejected({ code: 'invalid-state', id: request.taskId, reason: `task status is ${item.status}` })
    }

    const session = this.ctx.workValidation.getSession(taskId)
    if (session?.generation !== request.generation) {
      return rejected({
        code: 'stale-generation',
        taskId: request.taskId,
        expectedGeneration: request.generation,
        ...(session === undefined ? {} : { currentGeneration: session.generation }),
      })
    }

    const validator = item.validationPolicy?.validators[request.validatorIndex]
    if (validator?.kind !== 'user-acceptance' || validator.requirement !== 'required') {
      return rejected({ code: 'invalid-validator', taskId: request.taskId, validatorIndex: request.validatorIndex })
    }

    const readiness = this.automatedReadiness(item, request.generation)
    if (!readiness.ok) return readiness
    return success(item)
  }

  private automatedReadiness(
    task: TaskWorkItem,
    generation: number,
  ): WorkConsoleCommandSuccess<true> | WorkConsoleCommandRejected<WorkConsoleCommandFailure> {
    const results = this.ctx.workValidation.listResults(task.id, generation)
    const byIndex = new Map(results.map(result => [result.validatorIndex, result]))
    let pending = false
    for (const [index, validator] of (task.validationPolicy?.validators ?? []).entries()) {
      if (validator.requirement !== 'required' || validator.kind === 'user-acceptance') continue
      const outcome = byIndex.get(index)?.outcome
      if (outcome === 'failed') {
        return rejected({ code: 'not-ready', taskId: String(task.id), reason: 'automated-failed' })
      }
      if (outcome !== 'passed') pending = true
    }
    return pending
      ? rejected({ code: 'not-ready', taskId: String(task.id), reason: 'automated-pending' })
      : success(true)
  }

  private requireCurrentTask(
    taskId: ReturnType<typeof WorkItemId>,
  ): WorkConsoleCommandSuccess<TaskWorkItem> | WorkConsoleCommandRejected<WorkConsoleCommandFailure> {
    const item = this.ctx.workControl.get(taskId)
    if (item === undefined) return rejected({ code: 'not-found', id: String(taskId) })
    if (item.kind !== 'task') {
      return rejected({ code: 'invalid-state', id: String(taskId), reason: 'work item is no longer a task' })
    }
    if (item.status !== 'validation') {
      return rejected({ code: 'invalid-state', id: String(taskId), reason: `task status is ${item.status}` })
    }
    return success(item)
  }

  private async returnToExecution(
    request: DecideWorkConsoleAcceptanceRequest,
    task: TaskWorkItem,
  ): Promise<DecideWorkConsoleAcceptanceResult> {
    try {
      const running = await this.ctx.workControl.setStatus({ id: task.id, revision: task.revision }, 'running')
      const value: WorkConsoleAcceptanceDecisionValue = {
        taskId: String(running.id),
        revision: running.revision,
        status: 'running',
        decision: 'return',
      }
      return success(value)
    } catch (error) {
      if (error instanceof WorkItemConflictError) {
        const latest = this.ctx.workControl.get(task.id)
        return conflict(request.taskId, task.revision, latest?.revision ?? error.actualRevision)
      }
      if (error instanceof WorkItemTransitionError) {
        return rejected({ code: 'invalid-state', id: request.taskId, reason: error.message })
      }
      throw error
    }
  }

  private validationRaceFailure(
    request: DecideWorkConsoleAcceptanceRequest,
    taskId: ReturnType<typeof WorkItemId>,
  ): DecideWorkConsoleAcceptanceResult {
    const item = this.ctx.workControl.get(taskId)
    if (item === undefined) return rejected({ code: 'not-found', id: request.taskId })
    if (item.kind !== 'task' || item.status !== 'validation') {
      return rejected({
        code: 'invalid-state',
        id: request.taskId,
        reason: item.kind !== 'task' ? 'work item is no longer a task' : `task status is ${item.status}`,
      })
    }
    const session = this.ctx.workValidation.getSession(taskId)
    if (session?.generation !== request.generation) {
      return rejected({
        code: 'stale-generation',
        taskId: request.taskId,
        expectedGeneration: request.generation,
        ...(session === undefined ? {} : { currentGeneration: session.generation }),
      })
    }
    const validator = item.validationPolicy?.validators[request.validatorIndex]
    if (validator?.kind !== 'user-acceptance' || validator.requirement !== 'required') {
      return rejected({ code: 'invalid-validator', taskId: request.taskId, validatorIndex: request.validatorIndex })
    }
    return this.automatedReadiness(item, request.generation)
  }
}

function success<T>(value: T): WorkConsoleCommandSuccess<T> {
  return { ok: true, value }
}

function rejected<E extends WorkConsoleCommandFailure>(error: E): WorkConsoleCommandRejected<E> {
  return { ok: false, error }
}

function conflict(id: string, expectedRevision: number, currentRevision: number): WorkConsoleCommandRejected<{
  readonly code: 'conflict'
  readonly id: string
  readonly expectedRevision: number
  readonly currentRevision: number
}> {
  return rejected({ code: 'conflict', id, expectedRevision, currentRevision })
}

export default WorkConsoleCommandService
