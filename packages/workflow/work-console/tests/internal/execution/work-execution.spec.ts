import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { TaskStatus, TaskWorkItem, WorkControlService } from '../../../src/internal/control/index.ts'
import { WorkItemId } from '../../../src/internal/control/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkExecutionService, {
  ExecutionTaskUnavailableError,
  ExecutionThreadConflictError,
  ExecutionThreadTransitionError,
} from '../../../src/internal/execution/index.ts'
import type { ExecutionThreadRef } from '../../../src/internal/execution/index.ts'

function ref(thread: { id: ExecutionThreadRef['id']; revision: number }): ExecutionThreadRef {
  return { id: thread.id, revision: thread.revision }
}

async function harness(initialStatus: TaskStatus = 'running', pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)

  let status = initialStatus
  const taskId = WorkItemId('task-1')
  const task = (): TaskWorkItem => ({
    kind: 'task',
    id: taskId,
    revision: 3,
    title: 'Task',
    summary: '',
    tags: [],
    priority: 'p1',
    status,
    taskType: 'custom',
    workflow: { version: 1, stages: [{ id: 'execute', title: 'Execute', kind: 'implementation' }] },
    currentStageId: 'execute',
    validationPolicy: { version: 1, validators: [] },
    validation: { state: 'pending', requiredPassed: 0, requiredTotal: 0 },
    createdAt: '2026-08-15T00:00:00.000Z',
    promotedAt: '2026-08-15T00:01:00.000Z',
    updatedAt: '2026-08-15T00:02:00.000Z',
  })
  ctx.provide('workControl', {
    get: (id: typeof taskId) => id === taskId ? task() : undefined,
  } as WorkControlService)

  await ctx.plugin(WorkExecutionService)
  return {
    ctx,
    pool,
    taskId,
    work: ctx.workExecution,
    setTaskStatus(next: TaskStatus) { status = next },
  }
}

describe('WorkExecutionService thread isolation', () => {
  it('creates multiple independent threads for one running task', async () => {
    const { taskId, work } = await harness()
    const first = await work.createThread({ taskId })
    const second = await work.createThread({ taskId })

    expect(first.id).not.toBe(second.id)
    expect(first).toMatchObject({ taskId, revision: 1, state: 'idle', attemptSeq: 0 })
    expect(work.list(taskId)).toHaveLength(2)
  })

  it('records one published attempt and rejects a second active runner on the same thread', async () => {
    const { taskId, work } = await harness()
    const thread = await work.createThread({ taskId })
    const running = await work.beginAttempt(ref(thread), {
      provider: 'claude-code',
      mode: 'one-shot',
      subagentSessionId: SessionId('claude-child'),
    })

    expect(running).toMatchObject({
      state: 'running',
      attemptSeq: 1,
      activeAttempt: {
        seq: 1,
        provider: 'claude-code',
        mode: 'one-shot',
        subagentSessionId: 'claude-child',
      },
    })
    await expect(work.beginAttempt(ref(running), { provider: 'codex', mode: 'one-shot' }))
      .rejects.toBeInstanceOf(ExecutionThreadTransitionError)
  })

  it('settles attempts compactly and permits a later provider attempt without claiming native continuity', async () => {
    const { taskId, work } = await harness()
    const thread = await work.createThread({ taskId })
    const first = await work.beginAttempt(ref(thread), { provider: 'claude-code', mode: 'one-shot' })
    const settled = await work.settleAttempt(ref(first), { stopReason: 'completed' })

    expect(settled.activeAttempt).toBeUndefined()
    expect(settled).toMatchObject({
      state: 'idle',
      attemptSeq: 1,
      lastAttempt: { seq: 1, provider: 'claude-code', mode: 'one-shot', stopReason: 'completed' },
    })

    const second = await work.beginAttempt(ref(settled), {
      provider: 'spawn',
      mode: 'continuable',
      subagentSessionId: SessionId('dsh-child'),
    })
    expect(second).toMatchObject({
      attemptSeq: 2,
      activeAttempt: { seq: 2, provider: 'spawn', mode: 'continuable', subagentSessionId: 'dsh-child' },
    })
  })

  it('blocks and resumes only inactive threads while the global task is running', async () => {
    const { taskId, work, setTaskStatus } = await harness()
    const thread = await work.createThread({ taskId })
    const blocked = await work.blockThread(ref(thread), 'Waiting for device')
    expect(blocked).toMatchObject({ state: 'blocked', blocker: 'Waiting for device' })

    setTaskStatus('blocked')
    await expect(work.resumeThread(ref(blocked))).rejects.toBeInstanceOf(ExecutionTaskUnavailableError)
    setTaskStatus('running')
    const resumed = await work.resumeThread(ref(blocked))
    expect(resumed.state).toBe('idle')
    expect(resumed.blocker).toBeUndefined()
  })

  it('does not admit new execution while the owning work item is not running', async () => {
    for (const status of ['organizing', 'blocked', 'validation', 'done', 'cancelled'] as const) {
      const { taskId, work } = await harness(status)
      await expect(work.createThread({ taskId })).rejects.toBeInstanceOf(ExecutionTaskUnavailableError)
    }
  })

  it('rechecks task state before a previously-created thread starts an attempt', async () => {
    const { taskId, work, setTaskStatus } = await harness()
    const thread = await work.createThread({ taskId })
    setTaskStatus('validation')
    await expect(work.beginAttempt(ref(thread), { provider: 'codex', mode: 'one-shot' }))
      .rejects.toBeInstanceOf(ExecutionTaskUnavailableError)
  })
})

describe('WorkExecutionService lifecycle and commit semantics', () => {
  it('rejects stale thread revisions', async () => {
    const { taskId, work } = await harness()
    const thread = await work.createThread({ taskId })
    const blocked = await work.blockThread(ref(thread), 'Wait')
    await expect(work.resumeThread(ref(thread))).rejects.toBeInstanceOf(ExecutionThreadConflictError)
    expect(work.get(blocked.id)?.state).toBe('blocked')
  })

  it('closes or cancels only inactive threads', async () => {
    const { taskId, work } = await harness()
    const first = await work.createThread({ taskId })
    const running = await work.beginAttempt(ref(first), { provider: 'codex', mode: 'one-shot' })
    await expect(work.closeThread(ref(running))).rejects.toThrow(/must be inactive/)
    const settled = await work.settleAttempt(ref(running), { stopReason: 'failed' })
    const closed = await work.closeThread(ref(settled))
    expect(closed).toMatchObject({ state: 'closed' })
    expect(closed.closedAt).toBeTypeOf('string')

    const second = await work.createThread({ taskId })
    const cancelled = await work.cancelThread(ref(second))
    expect(cancelled.state).toBe('cancelled')
  })

  it('contains observer failure after commit and preserves storage failure before publication', async () => {
    const pool = new MemoryMediaPool()
    const { ctx, taskId, work } = await harness('running', pool)
    ctx.on('work-execution/changed', () => { throw new Error('observer failure') })
    const thread = await work.createThread({ taskId })
    expect(work.get(thread.id)).toBeDefined()

    pool.failNextWrites = 1
    await expect(work.createThread({ taskId })).rejects.toThrow(/injected write failure/)
    expect(work.list(taskId)).toHaveLength(1)
  })

  it('rejects empty provider and live-thread blocking', async () => {
    const { taskId, work } = await harness()
    const thread = await work.createThread({ taskId })
    await expect(work.beginAttempt(ref(thread), { provider: '   ', mode: 'one-shot' })).rejects.toThrow(/must not be empty/)
    const running = await work.beginAttempt(ref(thread), { provider: 'codex', mode: 'one-shot' })
    await expect(work.blockThread(ref(running), 'Wait')).rejects.toThrow(/must be idle/)
  })
})
