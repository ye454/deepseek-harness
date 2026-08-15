/**
 * Durable execution-thread service over DSH continuable subagents.
 * @module @deepseek-ai/dsh-execution-thread
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { executionThreadDomainSpec } from './spec.ts'
import type { ExecutionThreadRecord } from './spec.ts'
import type {
  ContinueExecutionThreadRequest,
  ExecutionHandoff,
  ExecutionThread,
  ExecutionThreadChanged,
  ExecutionThreadId as ExecutionThreadIdBrand,
  ExecutionThreadRef,
  ExecutionThreadState,
  StartExecutionThreadRequest,
} from './types.ts'

export type {
  ContinueExecutionThreadRequest,
  ExecutionHandoff,
  ExecutionThread,
  ExecutionThreadChanged,
  ExecutionThreadRef,
  ExecutionThreadState,
  StartExecutionThreadRequest,
} from './types.ts'
export { executionThreadDomainSpec, executionThreadRecord } from './spec.ts'

/** Stable execution-thread id. */
export type ExecutionThreadId = ExecutionThreadIdBrand

/** Brand one persisted execution-thread id. */
export function ExecutionThreadId(id: string): ExecutionThreadId {
  return id as ExecutionThreadId
}

/** A request named an unknown execution thread. */
export class ExecutionThreadNotFoundError extends Error {
  constructor(readonly id: ExecutionThreadId) {
    super(`unknown execution thread '${id}'`)
    this.name = 'ExecutionThreadNotFoundError'
  }
}

/** A mutation used a stale execution-thread revision. */
export class ExecutionThreadConflictError extends Error {
  constructor(readonly expected: ExecutionThreadRef, readonly actualRevision: number) {
    super(`stale execution thread '${expected.id}' revision ${expected.revision}; current revision is ${actualRevision}`)
    this.name = 'ExecutionThreadConflictError'
  }
}

/** A requested execution-thread lifecycle transition is invalid. */
export class ExecutionThreadTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionThreadTransitionError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    executionThreads: ExecutionThreadService
  }

  interface Events {
    /**
     * One execution-thread record committed durably.
     * @param change - Exact committed thread projection.
     * @mode emit
     */
    'execution-thread/changed'(change: ExecutionThreadChanged): void
  }
}

const TERMINAL_STATES: ReadonlySet<ExecutionThreadState> = new Set(['completed', 'failed', 'cancelled'])

/**
 * Task execution coordinator that binds one durable record to one continuable DSH subagent session.
 * It does not own the Agent loop, child-session persistence, Remote Nodes, or validation policy.
 */
export class ExecutionThreadService extends Service {
  static inject = ['storageDomain', 'workControl', 'subagents']

  private table?: KvTable<ExecutionThreadId, ExecutionThreadRecord>

  constructor(ctx: Context) {
    super(ctx, 'executionThreads')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(executionThreadDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'executionThreads.domainClose')
    this.table = domain.table('threads')
  }

  /** Start a continuable DSH child for an already organized task. */
  async start(parent: Agent, request: StartExecutionThreadRequest, signal: AbortSignal): Promise<ExecutionThread> {
    const task = this.ctx.workControl.get(request.workItem.id)
    if (task === undefined || task.kind !== 'task') {
      throw new ExecutionThreadTransitionError(`work item '${request.workItem.id}' is not an executable task`)
    }
    if (task.revision !== request.workItem.revision) {
      throw new ExecutionThreadTransitionError(
        `work item '${request.workItem.id}' changed from revision ${request.workItem.revision} to ${task.revision}`,
      )
    }
    if (task.status !== 'running' && task.status !== 'blocked') {
      throw new ExecutionThreadTransitionError(
        `task '${request.workItem.id}' cannot start execution while status is '${task.status}'`,
      )
    }

    const now = new Date().toISOString()
    const id = ExecutionThreadId(randomUUID())
    const starting: ExecutionThread = {
      id,
      revision: 1,
      workItemId: task.id,
      provider: requireText(request.provider, 'execution provider'),
      label: requireText(request.label, 'execution label'),
      parentSessionId: parent.id,
      state: 'starting',
      createdAt: now,
      updatedAt: now,
    }
    await this.requireTable().put(id, starting)
    this.emitChanged({ operation: 'create', thread: starting })

    try {
      const accepted = await this.ctx.subagents.startContinuable({
        provider: starting.provider,
        label: starting.label,
        request: {
          prompt: [...request.prompt],
          parent,
          agentOptions: request.agentOptions,
        },
        signal,
      })
      return await this.updateInternal(id, current => ({
        ...current,
        childSessionId: accepted.childId,
        state: 'running',
      }))
    } catch (error) {
      try {
        await this.updateInternal(id, current => ({ ...current, state: 'failed' }))
      } catch (markError) {
        this.ctx.logger.warn(`execution thread '${id}': could not persist startup failure: ${String(markError)}`)
      }
      throw error
    }
  }

  /** Return one durable thread, or undefined when absent. */
  get(id: ExecutionThreadId): ExecutionThread | undefined {
    const record = this.requireTable().get(id)
    return record === undefined ? undefined : asThread(record)
  }

  /** List all threads newest-first. */
  list(): ExecutionThread[] {
    return [...this.requireTable().entries()]
      .map(([, record]) => asThread(record))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /** List all execution attempts attached to one work item. */
  listForWorkItem(workItemId: ExecutionThread['workItemId']): ExecutionThread[] {
    return this.list().filter(thread => thread.workItemId === workItemId)
  }

  /** Interrupt the current child turn and park the thread without destroying its durable child session. */
  async pause(expected: ExecutionThreadRef, parent: Agent): Promise<ExecutionThread> {
    const current = this.requireCurrent(expected)
    if (current.state !== 'running' && current.state !== 'blocked') {
      throw new ExecutionThreadTransitionError(`execution thread '${expected.id}' is not running or blocked`)
    }
    const childId = requireChildSession(current)
    this.ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: parent })
    return await this.update(expected, value => ({ ...value, state: 'paused' }))
  }

  /** Deliver one later turn to the same durable child and mark the thread running after acceptance. */
  async continue(
    expected: ExecutionThreadRef,
    parent: Agent,
    request: ContinueExecutionThreadRequest,
    signal: AbortSignal,
  ): Promise<ExecutionThread> {
    const current = this.requireCurrent(expected)
    if (current.state !== 'paused' && current.state !== 'blocked') {
      throw new ExecutionThreadTransitionError(`execution thread '${expected.id}' is not paused or blocked`)
    }
    const childId = requireChildSession(current)
    await this.ctx.subagents.followup(parent, childId, [...request.content], {
      source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
      signal,
    })
    return await this.update(expected, value => ({ ...value, state: 'running' }))
  }

  /** Persist a compact operational handoff for later same-runner or cross-runner continuation. */
  async setHandoff(expected: ExecutionThreadRef, handoff: Omit<ExecutionHandoff, 'updatedAt'>): Promise<ExecutionThread> {
    return await this.update(expected, current => {
      if (TERMINAL_STATES.has(current.state)) {
        throw new ExecutionThreadTransitionError(`terminal execution thread '${expected.id}' cannot change handoff`)
      }
      return {
        ...current,
        handoff: {
          summary: handoff.summary.trim(),
          nextStep: handoff.nextStep.trim(),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  }

  /** Mark a live thread blocked while preserving its child session for later continuation. */
  async block(expected: ExecutionThreadRef): Promise<ExecutionThread> {
    return await this.update(expected, current => {
      if (current.state !== 'running') {
        throw new ExecutionThreadTransitionError(`execution thread '${expected.id}' is not running`)
      }
      return { ...current, state: 'blocked' }
    })
  }

  /** Record a terminal outcome. Validation remains owned by work-control consumers. */
  async finish(expected: ExecutionThreadRef, state: 'completed' | 'failed' | 'cancelled'): Promise<ExecutionThread> {
    return await this.update(expected, current => {
      if (TERMINAL_STATES.has(current.state)) {
        throw new ExecutionThreadTransitionError(`execution thread '${expected.id}' is already terminal`)
      }
      return { ...current, state }
    })
  }

  private async update(
    expected: ExecutionThreadRef,
    mutate: (current: ExecutionThread) => ExecutionThread,
  ): Promise<ExecutionThread> {
    const next = await this.requireTable().update(expected.id, record => {
      const current = asThread(record)
      assertRef(current, expected)
      const changed = mutate(current)
      const now = new Date().toISOString()
      return { ...changed, revision: current.revision + 1, updatedAt: now }
    })
    const thread = asThread(next)
    this.emitChanged({ operation: 'update', thread })
    return thread
  }

  private async updateInternal(
    id: ExecutionThreadId,
    mutate: (current: ExecutionThread) => ExecutionThread,
  ): Promise<ExecutionThread> {
    const next = await this.requireTable().update(id, record => {
      const current = asThread(record)
      const changed = mutate(current)
      return { ...changed, revision: current.revision + 1, updatedAt: new Date().toISOString() }
    })
    const thread = asThread(next)
    this.emitChanged({ operation: 'update', thread })
    return thread
  }

  private requireCurrent(expected: ExecutionThreadRef): ExecutionThread {
    const current = this.get(expected.id)
    if (current === undefined) throw new ExecutionThreadNotFoundError(expected.id)
    assertRef(current, expected)
    return current
  }

  private requireTable(): KvTable<ExecutionThreadId, ExecutionThreadRecord> {
    if (this.table === undefined) throw new Error('execution-thread service is not initialized')
    return this.table
  }

  private emitChanged(change: ExecutionThreadChanged): void {
    try {
      this.ctx.emit('execution-thread/changed', change)
    } catch (error) {
      this.ctx.logger.warn(`execution-thread/changed listener failed: ${String(error)}`)
    }
  }
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new ExecutionThreadTransitionError(`${label} must not be empty`)
  return trimmed
}

function requireChildSession(thread: ExecutionThread): NonNullable<ExecutionThread['childSessionId']> {
  if (thread.childSessionId === undefined) {
    throw new ExecutionThreadTransitionError(`execution thread '${thread.id}' has no child session`)
  }
  return thread.childSessionId
}

function assertRef(current: ExecutionThread, expected: ExecutionThreadRef): void {
  if (current.revision !== expected.revision) {
    throw new ExecutionThreadConflictError(expected, current.revision)
  }
}

function asThread(record: ExecutionThreadRecord): ExecutionThread {
  return record
}

export default ExecutionThreadService
