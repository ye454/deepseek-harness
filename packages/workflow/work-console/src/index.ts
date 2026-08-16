/**
 * Read-only global continuous-work console projection. The service derives every response from the
 * current Work Control / Execution / Node / Environment / Validation authorities and owns no cache.
 * @module @deepseek-ai/dsh-work-console
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkItemId, type TaskWorkItem } from '@deepseek-ai/dsh-work-control'
import type { ExecutionThread } from '@deepseek-ai/dsh-work-execution'
import type { WorkEnvironment } from '@deepseek-ai/dsh-work-environment'
import type { WorkNode } from '@deepseek-ai/dsh-work-node'
import type { WorkValidatorResult } from '@deepseek-ai/dsh-work-validation'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  WorkConsoleAttemptView,
  WorkConsoleBoardStatus,
  WorkConsoleEnvironmentDetail,
  WorkConsoleExecutionView,
  WorkConsolePendingSummary,
  WorkConsolePlacementView,
  WorkConsoleResourceSummary,
  WorkConsoleRunnerSummary,
  WorkConsoleSnapshot,
  WorkConsoleTaskCard,
  WorkConsoleTaskDetail,
  WorkConsoleThreadView,
  WorkConsoleValidatorDetail,
} from './types.ts'

export type * from './types.ts'

/** Read-only Host Remote used by the browser work-console surface. */
export class WorkConsoleGateway extends TypertRemoteService {
  static inject = ['workControl', 'workExecution', 'workNodes', 'workEnvironments', 'workValidation']

  constructor(ctx: Context) {
    super(ctx, 'workConsole')
  }

  /**
   * Build the lightweight global-board snapshot from current durable facts.
   * Cancelled Tasks are deliberately excluded from the active board.
   * @returns tasks, compact resource inventory, and Pending Center counts.
   */
  @Remote('snapshot')
  snapshot(): WorkConsoleSnapshot {
    const tasks = this.ctx.workControl.listTasks()
      .filter(task => task.status !== 'cancelled')
      .map(task => this.card(task))
      .sort(compareCards)
    return {
      generatedAt: new Date().toISOString(),
      tasks,
      resources: this.resourceSummary(),
      pending: this.pendingSummary(tasks),
    }
  }

  /**
   * Build one on-demand detail projection without loading execution logs or large Evidence payloads.
   * @param rawTaskId - Stable WorkItem id from a board card.
   * @returns current Task detail or undefined when the id is absent/not a Task/cancelled.
   */
  @Remote('task')
  task(rawTaskId: string): WorkConsoleTaskDetail | undefined {
    const taskId = WorkItemId(rawTaskId)
    const item = this.ctx.workControl.get(taskId)
    if (item?.kind !== 'task' || item.status === 'cancelled') return undefined
    const threads = this.ctx.workExecution.list(taskId)
    const environmentMap = new Map<string, WorkEnvironment>()
    const threadViews = threads.map(thread => {
      const binding = this.ctx.workEnvironments.getBinding(thread.id)
      if (binding !== undefined) {
        const environment = this.ctx.workEnvironments.get(binding.environmentId)
        if (environment !== undefined) environmentMap.set(String(environment.id), environment)
      }
      return this.threadView(thread)
    })
    const session = this.ctx.workValidation.getSession(taskId)
    const results = session === undefined
      ? []
      : this.ctx.workValidation.listResults(taskId, session.generation)
    return {
      card: this.card(item),
      threads: threadViews,
      environments: [...environmentMap.values()].map(environmentDetail),
      ...(session === undefined ? {} : { validationGeneration: session.generation }),
      validators: validatorDetails(item, results),
    }
  }

  private card(task: TaskWorkItem): WorkConsoleTaskCard {
    const threads = this.ctx.workExecution.list(task.id)
    const activeThreads = threads.filter(thread => thread.state !== 'closed' && thread.state !== 'cancelled')
    const relevant = chooseRelevantThread(activeThreads)
    const stage = task.workflow?.stages.find(candidate => candidate.id === task.currentStageId)
    return {
      id: String(task.id),
      revision: task.revision,
      title: task.title,
      summary: task.summary,
      tags: [...task.tags],
      priority: task.priority,
      status: boardStatus(task.status),
      ...(task.taskType === undefined ? {} : { taskType: task.taskType }),
      ...(stage === undefined ? {} : {
        stage: { id: stage.id, title: stage.title, kind: stage.kind },
      }),
      execution: executionView(activeThreads, relevant),
      ...(relevant === undefined ? {} : placementField(this.ctx, relevant)),
      ...(task.validation === undefined ? {} : {
        validation: {
          state: task.validation.state,
          requiredPassed: task.validation.requiredPassed,
          requiredTotal: task.validation.requiredTotal,
          ...(task.validation.checkedAt === undefined ? {} : { checkedAt: task.validation.checkedAt }),
        },
      }),
      updatedAt: task.updatedAt,
    }
  }

  private threadView(thread: ExecutionThread): WorkConsoleThreadView {
    return {
      id: String(thread.id),
      revision: thread.revision,
      state: thread.state,
      ...(thread.blocker === undefined ? {} : { blocker: thread.blocker }),
      ...(thread.activeAttempt === undefined ? {} : { activeAttempt: attemptView(thread.activeAttempt) }),
      ...(thread.lastAttempt === undefined ? {} : { lastAttempt: attemptView(thread.lastAttempt) }),
      ...placementField(this.ctx, thread),
      updatedAt: thread.updatedAt,
    }
  }

  private resourceSummary(): WorkConsoleResourceSummary {
    const nodes = this.ctx.workNodes.list()
    const environments = this.ctx.workEnvironments.list()
    const runners = new Map<string, { nodeCount: number; onlineNodeCount: number }>()
    for (const node of nodes) {
      for (const provider of node.runnerProviders) {
        const current = runners.get(provider) ?? { nodeCount: 0, onlineNodeCount: 0 }
        current.nodeCount += 1
        if (node.state === 'online') current.onlineNodeCount += 1
        runners.set(provider, current)
      }
    }
    const runnerRows: WorkConsoleRunnerSummary[] = [...runners.entries()]
      .map(([provider, counts]) => ({ provider, ...counts }))
      .sort((left, right) => left.provider.localeCompare(right.provider))
    return {
      nodes: {
        total: nodes.length,
        online: nodes.filter(node => node.state === 'online').length,
        degraded: nodes.filter(node => node.state === 'degraded').length,
        offline: nodes.filter(node => node.state === 'offline').length,
      },
      environments: {
        total: environments.length,
        ready: environments.filter(environment => environment.state === 'ready').length,
        degraded: environments.filter(environment => environment.state === 'degraded').length,
        unavailable: environments.filter(environment => environment.state === 'unavailable').length,
      },
      runners: runnerRows,
    }
  }

  private pendingSummary(cards: readonly WorkConsoleTaskCard[]): WorkConsolePendingSummary {
    let pendingUserAcceptance = 0
    for (const card of cards) {
      if (card.status !== 'validation') continue
      const taskId = WorkItemId(card.id)
      const task = this.ctx.workControl.get(taskId)
      if (task?.kind !== 'task') continue
      const session = this.ctx.workValidation.getSession(taskId)
      const results = session === undefined ? [] : this.ctx.workValidation.listResults(taskId, session.generation)
      const byIndex = new Map(results.map(result => [result.validatorIndex, result]))
      for (const [index, validator] of (task.validationPolicy?.validators ?? []).entries()) {
        if (validator.kind !== 'user-acceptance' || validator.requirement !== 'required') continue
        if (byIndex.get(index)?.outcome !== 'passed') pendingUserAcceptance += 1
      }
    }
    return {
      blockedTasks: cards.filter(card => card.status === 'blocked').length,
      validationTasks: cards.filter(card => card.status === 'validation').length,
      pendingUserAcceptance,
    }
  }
}

function boardStatus(status: TaskWorkItem['status']): WorkConsoleBoardStatus {
  switch (status) {
    case 'organizing': return 'unclaimed'
    case 'running': return 'running'
    case 'blocked': return 'blocked'
    case 'validation': return 'validation'
    case 'done': return 'done'
    case 'cancelled': return 'done'
  }
}

function chooseRelevantThread(threads: readonly ExecutionThread[]): ExecutionThread | undefined {
  return threads.find(thread => thread.state === 'running')
    ?? threads.find(thread => thread.state === 'blocked')
    ?? threads[0]
}

function executionView(threads: readonly ExecutionThread[], relevant: ExecutionThread | undefined): WorkConsoleExecutionView {
  const attempt = relevant?.activeAttempt ?? relevant?.lastAttempt
  return {
    threadCount: threads.length,
    runningThreadCount: threads.filter(thread => thread.state === 'running').length,
    blockedThreadCount: threads.filter(thread => thread.state === 'blocked').length,
    ...(attempt === undefined ? {} : {
      provider: attempt.provider,
      mode: attempt.mode,
      ...(relevant?.activeAttempt === undefined ? {} : { attemptStartedAt: attempt.startedAt }),
      ...('stopReason' in attempt ? { lastStopReason: attempt.stopReason } : {}),
    }),
  }
}

function placementField(ctx: Context, thread: ExecutionThread): { placement?: WorkConsolePlacementView } {
  const binding = ctx.workEnvironments.getBinding(thread.id)
  if (binding === undefined) return {}
  const environment = ctx.workEnvironments.get(binding.environmentId)
  const node = ctx.workNodes.get(binding.nodeId)
  return {
    placement: {
      threadId: String(thread.id),
      nodeId: String(binding.nodeId),
      ...(node === undefined ? {} : { nodeName: node.name, nodeState: node.state }),
      environmentId: String(binding.environmentId),
      ...(environment === undefined ? {} : {
        environmentName: environment.name,
        environmentState: environment.state,
        currentEnvironmentRevision: environment.revision,
      }),
      boundEnvironmentRevision: binding.environmentRevision,
      stale: environment === undefined || environment.revision !== binding.environmentRevision,
    },
  }
}

function attemptView(attempt: ExecutionThread['activeAttempt'] | ExecutionThread['lastAttempt']): WorkConsoleAttemptView {
  if (attempt === undefined) throw new Error('work-console attempt projection received no attempt')
  return {
    provider: attempt.provider,
    mode: attempt.mode,
    startedAt: attempt.startedAt,
    ...('finishedAt' in attempt ? { finishedAt: attempt.finishedAt } : {}),
    ...('stopReason' in attempt ? { stopReason: attempt.stopReason } : {}),
    ...(attempt.subagentSessionId === undefined ? {} : { nativeSessionId: String(attempt.subagentSessionId) }),
  }
}

function environmentDetail(environment: WorkEnvironment): WorkConsoleEnvironmentDetail {
  return {
    id: String(environment.id),
    revision: environment.revision,
    name: environment.name,
    state: environment.state,
    workspace: {
      path: environment.snapshot.workspace.path,
      ...(environment.snapshot.workspace.repository === undefined ? {} : { repository: environment.snapshot.workspace.repository }),
      ...(environment.snapshot.workspace.branch === undefined ? {} : { branch: environment.snapshot.workspace.branch }),
      ...(environment.snapshot.workspace.commit === undefined ? {} : { commit: environment.snapshot.workspace.commit }),
      ...(environment.snapshot.workspace.dirty === undefined ? {} : { dirty: environment.snapshot.workspace.dirty }),
    },
    runtime: {
      os: environment.snapshot.runtime.os,
      arch: environment.snapshot.runtime.arch,
      versions: { ...environment.snapshot.runtime.versions },
    },
    devices: [...environment.snapshot.devices],
    capabilities: [...environment.snapshot.capabilities],
  }
}

function validatorDetails(task: TaskWorkItem, results: readonly WorkValidatorResult[]): WorkConsoleValidatorDetail[] {
  const byIndex = new Map(results.map(result => [result.validatorIndex, result]))
  return (task.validationPolicy?.validators ?? []).map((validator, index) => {
    const result = byIndex.get(index)
    return {
      index,
      kind: validator.kind,
      requirement: validator.requirement,
      label: validator.label,
      ...(result === undefined ? {} : {
        outcome: result.outcome,
        source: result.source,
        ...(result.actor === undefined ? {} : { actor: result.actor }),
        checkedAt: result.checkedAt,
        evidence: result.evidence.map(evidence => ({
          kind: evidence.kind,
          label: evidence.label,
          reference: evidence.reference,
          ...(evidence.summary === undefined ? {} : { summary: evidence.summary }),
        })),
      }),
      ...(result === undefined ? { evidence: [] } : {}),
    }
  })
}

function compareCards(left: WorkConsoleTaskCard, right: WorkConsoleTaskCard): number {
  const priority = { p0: 0, p1: 1, p2: 2 } as const
  return priority[left.priority] - priority[right.priority]
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.title.localeCompare(right.title)
}

export default WorkConsoleGateway
