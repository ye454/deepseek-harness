/** Host-owned mutation helpers for the global Work Console. */
import type { Context } from '@deepseek-ai/cordis'
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

/** Promote one passive Idea into `organizing`; no Runner/model/environment is started here. */
export async function promoteWorkConsoleIdea(
  ctx: Context,
  request: PromoteWorkConsoleIdeaRequest,
): Promise<PromoteWorkConsoleIdeaResult> {
  const id = WorkItemId(request.id)
  const current = ctx.workControl.get(id)
  if (current === undefined) return rejected({ code: 'not-found', id: request.id })
  if (current.revision !== request.revision) return conflict(request.id, request.revision, current.revision)
  if (current.kind !== 'idea') {
    return rejected({ code: 'invalid-state', id: request.id, reason: 'work item is already an executable task' })
  }

  try {
    const task = await ctx.workControl.promoteIdea(
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

/** Record one explicit human acceptance decision; actor identity is Host-owned. */
export async function decideWorkConsoleAcceptance(
  ctx: Context,
  request: DecideWorkConsoleAcceptanceRequest,
): Promise<DecideWorkConsoleAcceptanceResult> {
  const taskId = WorkItemId(request.taskId)
  const inspected = inspectAcceptanceRequest(ctx, request, taskId)
  if (!inspected.ok) return inspected

  const actor = `harness-home:${getOrCreateAnonymousUserId()}`
  try {
    await ctx.workValidation.recordUserAcceptance({
      taskId,
      generation: request.generation,
      validatorIndex: request.validatorIndex,
      outcome: request.decision === 'accept' ? 'passed' : 'failed',
      actor,
    })
  } catch (error) {
    if (error instanceof WorkValidationError) {
      const raced = inspectAcceptanceRequest(ctx, request, taskId)
      if (!raced.ok) return raced
      return rejected({ code: 'invalid-state', id: request.taskId, reason: error.message })
    }
    if (error instanceof WorkItemConflictError) {
      const latest = ctx.workControl.get(taskId)
      return conflict(request.taskId, request.taskRevision, latest?.revision ?? error.actualRevision)
    }
    throw error
  }

  const afterDecision = requireCurrentTask(ctx, taskId)
  if (!afterDecision.ok) return afterDecision

  if (request.decision === 'return') {
    return returnToExecution(ctx, request, afterDecision.value)
  }

  const readiness = automatedReadiness(ctx, afterDecision.value, request.generation)
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
    const done = await ctx.workControl.setStatus(
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
      const latest = ctx.workControl.get(taskId)
      return conflict(request.taskId, afterDecision.value.revision, latest?.revision ?? error.actualRevision)
    }
    if (error instanceof WorkItemTransitionError) {
      return rejected({ code: 'invalid-state', id: request.taskId, reason: error.message })
    }
    throw error
  }
}

function inspectAcceptanceRequest(
  ctx: Context,
  request: DecideWorkConsoleAcceptanceRequest,
  taskId: ReturnType<typeof WorkItemId>,
): WorkConsoleCommandSuccess<TaskWorkItem> | WorkConsoleCommandRejected<WorkConsoleCommandFailure> {
  const item = ctx.workControl.get(taskId)
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

  const session = ctx.workValidation.getSession(taskId)
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

  const readiness = automatedReadiness(ctx, item, request.generation)
  if (!readiness.ok) return readiness
  return success(item)
}

function automatedReadiness(
  ctx: Context,
  task: TaskWorkItem,
  generation: number,
): WorkConsoleCommandSuccess<true> | WorkConsoleCommandRejected<WorkConsoleCommandFailure> {
  const results = ctx.workValidation.listResults(task.id, generation)
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

function requireCurrentTask(
  ctx: Context,
  taskId: ReturnType<typeof WorkItemId>,
): WorkConsoleCommandSuccess<TaskWorkItem> | WorkConsoleCommandRejected<WorkConsoleCommandFailure> {
  const item = ctx.workControl.get(taskId)
  if (item === undefined) return rejected({ code: 'not-found', id: String(taskId) })
  if (item.kind !== 'task') {
    return rejected({ code: 'invalid-state', id: String(taskId), reason: 'work item is no longer a task' })
  }
  if (item.status !== 'validation') {
    return rejected({ code: 'invalid-state', id: String(taskId), reason: `task status is ${item.status}` })
  }
  return success(item)
}

async function returnToExecution(
  ctx: Context,
  request: DecideWorkConsoleAcceptanceRequest,
  task: TaskWorkItem,
): Promise<DecideWorkConsoleAcceptanceResult> {
  try {
    const running = await ctx.workControl.setStatus({ id: task.id, revision: task.revision }, 'running')
    const value: WorkConsoleAcceptanceDecisionValue = {
      taskId: String(running.id),
      revision: running.revision,
      status: 'running',
      decision: 'return',
    }
    return success(value)
  } catch (error) {
    if (error instanceof WorkItemConflictError) {
      const latest = ctx.workControl.get(task.id)
      return conflict(request.taskId, task.revision, latest?.revision ?? error.actualRevision)
    }
    if (error instanceof WorkItemTransitionError) {
      return rejected({ code: 'invalid-state', id: request.taskId, reason: error.message })
    }
    throw error
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
