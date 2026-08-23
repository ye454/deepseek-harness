/**
 * Restart-safe continuation of one existing ExecutionThread into the Task's current workflow Stage.
 * The helper lives in the Orchestrator package so Environment/Runner/lease admission has one owner.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkItemId } from '@deepseek-ai/dsh-work-control'
import type { ExecutionThread, ExecutionThreadId } from '@deepseek-ai/dsh-work-execution'
import type { WorkEnvironment } from '@deepseek-ai/dsh-work-environment'
import type { WorkNodeGateway } from '@deepseek-ai/dsh-work-node-gateway'
import type { WorkHandoff } from '@deepseek-ai/dsh-work-runner-subagent'

/** Exact durable coordinates for continuing an existing execution effort. */
export interface ContinueWorkThreadRequest {
  readonly taskId: WorkItemId
  readonly taskRevision: number
  readonly threadId: ExecutionThreadId
  readonly threadRevision: number
  /** Compact current-stage instruction; never a transcript or private reasoning. */
  readonly nextStep: string
}

/** One queued or already-open command for the current workflow Stage. */
export interface ContinueWorkThreadResult {
  readonly taskId: WorkItemId
  readonly threadId: ExecutionThreadId
  readonly provider: string
  readonly commandId: string
  readonly alreadyQueued: boolean
}

/** Deterministic continuation/preflight rejection. */
export class WorkContinuationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkContinuationError'
  }
}

/**
 * Re-dispatch one completed Thread into the Task's current Stage.
 *
 * If the same Environment has refreshed since the previous attempt, the operation explicitly rebinds the
 * inactive Thread to the latest exact revision before re-running preflight. This never silently reuses a stale
 * revision. Existing open commands are returned idempotently so a Host restart between Stage mutation and
 * remote publication cannot enqueue duplicate work.
 */
export async function continueWorkThread(
  ctx: Context,
  request: ContinueWorkThreadRequest,
): Promise<ContinueWorkThreadResult> {
  const task = ctx.workControl.get(request.taskId)
  if (task === undefined || task.kind !== 'task') throw new WorkContinuationError(`unknown task '${request.taskId}'`)
  if (task.revision !== request.taskRevision) {
    throw new WorkContinuationError(
      `stale task '${request.taskId}' revision ${request.taskRevision}; current revision is ${task.revision}`,
    )
  }
  if (task.status !== 'running' || task.workflow === undefined || task.currentStageId === undefined) {
    throw new WorkContinuationError(`task '${request.taskId}' is not an organized running Task`)
  }

  const thread = ctx.workExecution.get(request.threadId)
  if (thread === undefined || thread.taskId !== task.id) {
    throw new WorkContinuationError(`thread '${request.threadId}' does not belong to task '${task.id}'`)
  }
  if (thread.revision !== request.threadRevision) {
    throw new WorkContinuationError(
      `stale thread '${thread.id}' revision ${request.threadRevision}; current revision is ${thread.revision}`,
    )
  }
  if (thread.state !== 'idle' || thread.activeAttempt !== undefined) {
    throw new WorkContinuationError(`thread '${thread.id}' is not idle`)
  }
  const previous = thread.lastAttempt
  if (previous === undefined || previous.stopReason !== 'completed') {
    throw new WorkContinuationError(`thread '${thread.id}' has no completed attempt to continue from`)
  }
  if (previous.stageId === task.currentStageId) {
    throw new WorkContinuationError(`thread '${thread.id}' already completed current stage '${task.currentStageId}'`)
  }

  const gateway = optionalGateway(ctx)
  if (gateway === undefined) throw new WorkContinuationError('remote execution gateway is not configured')
  const existing = openCommand(gateway, thread)
  if (existing !== undefined) {
    return {
      taskId: task.id,
      threadId: thread.id,
      provider: previous.provider,
      commandId: String(existing.id),
      alreadyQueued: true,
    }
  }

  const binding = ctx.workEnvironments.getBinding(thread.id)
  if (binding === undefined) throw new WorkContinuationError(`thread '${thread.id}' has no environment binding`)
  const environment = ctx.workEnvironments.get(binding.environmentId)
  if (environment === undefined) throw new WorkContinuationError(`thread '${thread.id}' environment is missing`)
  if (environment.state !== 'ready') {
    throw new WorkContinuationError(`thread '${thread.id}' environment state is ${environment.state}`)
  }
  if (environment.nodeId !== binding.nodeId) {
    throw new WorkContinuationError(`thread '${thread.id}' environment node changed`)
  }

  if (environment.revision !== binding.environmentRevision) {
    await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: environment.id, revision: environment.revision },
    )
  }

  assertNoForeignWorkspaceLease(ctx, thread, environment)
  const preflight = ctx.workEnvironments.preflight(thread.id, previous.provider)
  if (!preflight.ok) {
    throw new WorkContinuationError(`thread '${thread.id}' continuation preflight failed: ${preflight.issues.join(', ')}`)
  }

  const handoff: WorkHandoff = { nextStep: requireText(request.nextStep, 'nextStep') }
  const command = previous.mode === 'continuable' && previous.subagentSessionId !== undefined
    ? await gateway.enqueueResume({ id: thread.id, revision: thread.revision }, previous.provider, handoff)
    : await gateway.enqueueExecute({ id: thread.id, revision: thread.revision }, previous.provider, previous.mode, handoff)

  return {
    taskId: task.id,
    threadId: thread.id,
    provider: previous.provider,
    commandId: String(command.id),
    alreadyQueued: false,
  }
}

function openCommand(gateway: WorkNodeGateway, thread: ExecutionThread) {
  return gateway.listCommands().find(command =>
    command.kind !== 'cancel'
    && command.payload.threadId === thread.id
    && (command.state === 'queued' || command.state === 'accepted'))
}

function assertNoForeignWorkspaceLease(ctx: Context, thread: ExecutionThread, environment: WorkEnvironment): void {
  const requested = workspaceIsolationKey(environment)
  for (const other of ctx.workExecution.list()) {
    if (other.id === thread.id || other.state === 'closed' || other.state === 'cancelled') continue
    const binding = ctx.workEnvironments.getBinding(other.id)
    if (binding === undefined) continue
    const otherEnvironment = ctx.workEnvironments.get(binding.environmentId)
    if (otherEnvironment === undefined) continue
    if (workspaceIsolationKey(otherEnvironment) === requested) {
      throw new WorkContinuationError(
        `workspace '${environment.snapshot.workspace.worktree ?? environment.snapshot.workspace.path}' is already leased by thread '${other.id}'`,
      )
    }
  }
}

function workspaceIsolationKey(environment: WorkEnvironment): string {
  return `${environment.nodeId}\n${environment.snapshot.workspace.worktree ?? environment.snapshot.workspace.path}`
}

function optionalGateway(ctx: Context): WorkNodeGateway | undefined {
  return (ctx as unknown as { readonly workNodeGateway?: WorkNodeGateway }).workNodeGateway
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new WorkContinuationError(`${field} must not be empty`)
  return normalized
}
