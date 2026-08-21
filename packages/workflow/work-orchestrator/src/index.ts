/**
 * Safe orchestration from an organized Task to isolated remote one-shot execution threads.
 * Durable Task/Thread/Binding/Gateway authorities remain in their existing packages.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { TaskWorkItem } from '@deepseek-ai/dsh-work-control'
import type { ExecutionThread } from '@deepseek-ai/dsh-work-execution'
import type { WorkEnvironment } from '@deepseek-ai/dsh-work-environment'
import type { WorkHandoff } from '@deepseek-ai/dsh-work-runner-subagent'
import type {
  StartWorkTaskRequest,
  StartWorkTaskResult,
  StartedWorkPlacement,
  WorkOrchestratorPlacement,
} from './types.ts'

export type * from './types.ts'

const MAX_P0_PARALLEL = 3

/** Deterministic scheduler/preflight rejection. */
export class WorkOrchestratorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkOrchestratorError'
  }
}

/** A later placement failed after earlier remote commands were already queued durably. */
export class WorkOrchestratorPartialStartError extends WorkOrchestratorError {
  constructor(
    readonly started: readonly StartedWorkPlacement[],
    readonly failedIndex: number,
    readonly causeValue: unknown,
  ) {
    super(`work orchestration partially started ${started.length} placement(s); placement ${failedIndex} failed: ${renderError(causeValue)}`)
    this.name = 'WorkOrchestratorPartialStartError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workOrchestrator: WorkOrchestrator
  }
}

interface ResolvedPlacement {
  readonly environment: WorkEnvironment
  readonly provider: string
  readonly role: string
  readonly isolationKey: string
}

/** Stateless coordinator over existing durable work authorities. */
export class WorkOrchestrator extends Service {
  static inject = ['workControl', 'workExecution', 'workNodes', 'workEnvironments', 'workNodeGateway']

  constructor(ctx: Context) {
    super(ctx, 'workOrchestrator')
  }

  /**
   * Queue one or more isolated one-shot execution roles.
   * P1/P2 admit exactly one placement. P0 may fan out to at most three distinct workspaces/worktrees.
   */
  async startTask(request: StartWorkTaskRequest): Promise<StartWorkTaskResult> {
    const task = this.requireTask(request)
    this.assertFreshStart(task)
    const resolved = this.resolvePlacements(task, request.placements)
    this.assertNoWorkspaceCollisions(resolved)

    const started: StartedWorkPlacement[] = []
    for (const [index, placement] of resolved.entries()) {
      let created: ExecutionThread | undefined
      try {
        created = await this.ctx.workExecution.createThread({ taskId: task.id })
        await this.ctx.workEnvironments.bindThread(
          { id: created.id, revision: created.revision },
          { id: placement.environment.id, revision: placement.environment.revision },
        )
        const preflight = this.ctx.workEnvironments.preflight(created.id, placement.provider)
        if (!preflight.ok) {
          throw new WorkOrchestratorError(
            `placement ${index} preflight failed: ${preflight.issues.join(', ')}`,
          )
        }
        const handoff: WorkHandoff = { nextStep: placement.role }
        const command = await this.ctx.workNodeGateway.enqueueExecute(
          { id: created.id, revision: created.revision },
          placement.provider,
          'one-shot',
          handoff,
        )
        started.push({
          threadId: created.id,
          environmentId: placement.environment.id,
          provider: placement.provider,
          role: placement.role,
          commandId: String(command.id),
        })
      } catch (error) {
        if (created !== undefined) await this.cancelUnpublishedThread(created.id)
        if (started.length > 0) throw new WorkOrchestratorPartialStartError(started, index, error)
        if (error instanceof WorkOrchestratorError) throw error
        throw new WorkOrchestratorError(renderError(error))
      }
    }
    return { taskId: task.id, started }
  }

  private requireTask(request: StartWorkTaskRequest): TaskWorkItem {
    const item = this.ctx.workControl.get(request.taskId)
    if (item === undefined) throw new WorkOrchestratorError(`unknown task '${request.taskId}'`)
    if (item.kind !== 'task') throw new WorkOrchestratorError(`work item '${request.taskId}' is still an Idea`)
    if (item.revision !== request.taskRevision) {
      throw new WorkOrchestratorError(
        `stale task '${request.taskId}' revision ${request.taskRevision}; current revision is ${item.revision}`,
      )
    }
    if (item.status !== 'running' || item.workflow === undefined || item.currentStageId === undefined) {
      throw new WorkOrchestratorError(`task '${request.taskId}' is not an organized running Task`)
    }
    return item
  }

  private assertFreshStart(task: TaskWorkItem): void {
    const active = this.ctx.workExecution.list(task.id)
      .filter(thread => thread.state !== 'closed' && thread.state !== 'cancelled')
    if (active.length > 0) {
      throw new WorkOrchestratorError(`task '${task.id}' already owns ${active.length} active ExecutionThread(s)`)
    }
  }

  private resolvePlacements(
    task: TaskWorkItem,
    placements: readonly WorkOrchestratorPlacement[],
  ): ResolvedPlacement[] {
    if (placements.length === 0) throw new WorkOrchestratorError('execution plan must contain at least one placement')
    if (task.priority !== 'p0' && placements.length !== 1) {
      throw new WorkOrchestratorError(`${task.priority.toUpperCase()} tasks admit exactly one execution placement`)
    }
    if (task.priority === 'p0' && placements.length > MAX_P0_PARALLEL) {
      throw new WorkOrchestratorError(`P0 fan-out exceeds maximum ${MAX_P0_PARALLEL}`)
    }

    return placements.map((placement, index) => {
      if (!Number.isSafeInteger(placement.environmentRevision) || placement.environmentRevision < 1) {
        throw new WorkOrchestratorError(`placement ${index} has invalid environment revision`)
      }
      const environment = this.ctx.workEnvironments.get(placement.environmentId)
      if (environment === undefined) throw new WorkOrchestratorError(`placement ${index} environment does not exist`)
      if (environment.revision !== placement.environmentRevision) {
        throw new WorkOrchestratorError(
          `placement ${index} environment revision is stale; current revision is ${environment.revision}`,
        )
      }
      if (environment.state !== 'ready') {
        throw new WorkOrchestratorError(`placement ${index} environment state is ${environment.state}`)
      }
      const node = this.ctx.workNodes.get(environment.nodeId)
      if (node === undefined) throw new WorkOrchestratorError(`placement ${index} node does not exist`)
      if (node.state !== 'online') throw new WorkOrchestratorError(`placement ${index} node state is ${node.state}`)
      if (!node.features.includes('execute')) {
        throw new WorkOrchestratorError(`placement ${index} node does not advertise execute`)
      }
      const provider = requireText(placement.provider, `placement ${index} provider`)
      if (!node.runnerProviders.includes(provider)) {
        throw new WorkOrchestratorError(`placement ${index} provider '${provider}' is unavailable on node '${node.name}'`)
      }
      const role = requireText(placement.role, `placement ${index} role`)
      return {
        environment,
        provider,
        role,
        isolationKey: workspaceIsolationKey(environment),
      }
    })
  }

  private assertNoWorkspaceCollisions(placements: readonly ResolvedPlacement[]): void {
    const requested = new Set<string>()
    for (const placement of placements) {
      if (requested.has(placement.isolationKey)) {
        throw new WorkOrchestratorError('parallel placements must use distinct workspace/worktree isolation keys')
      }
      requested.add(placement.isolationKey)
    }

    for (const thread of this.ctx.workExecution.list()) {
      if (thread.state === 'closed' || thread.state === 'cancelled') continue
      const binding = this.ctx.workEnvironments.getBinding(thread.id)
      if (binding === undefined) continue
      const environment = this.ctx.workEnvironments.get(binding.environmentId)
      if (environment === undefined) continue
      if (requested.has(workspaceIsolationKey(environment))) {
        throw new WorkOrchestratorError(
          `workspace '${environment.snapshot.workspace.worktree ?? environment.snapshot.workspace.path}' is already leased by thread '${thread.id}'`,
        )
      }
    }
  }

  private async cancelUnpublishedThread(threadId: ExecutionThread['id']): Promise<void> {
    const current = this.ctx.workExecution.get(threadId)
    if (current === undefined || (current.state !== 'idle' && current.state !== 'blocked')) return
    try {
      await this.ctx.workExecution.cancelThread({ id: current.id, revision: current.revision })
    } catch (error) {
      this.ctx.logger.warn(`work-orchestrator: failed to cancel unpublished thread '${threadId}': ${renderError(error)}`)
    }
  }
}

function workspaceIsolationKey(environment: WorkEnvironment): string {
  const workspace = environment.snapshot.workspace.worktree ?? environment.snapshot.workspace.path
  return `${environment.nodeId}\n${workspace}`
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new WorkOrchestratorError(`${field} must not be empty`)
  return normalized
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default WorkOrchestrator
