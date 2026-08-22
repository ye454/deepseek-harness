import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WorkConsoleSnapshot, WorkConsoleTaskDetail } from '@deepseek-ai/dsh-api-remotes/client'
import { WorkConsoleController } from '../src/client/controller.ts'

const snapshot: WorkConsoleSnapshot = {
  generatedAt: '2026-08-22T00:00:00.000Z',
  ideas: [],
  tasks: [{
    id: 'task-1', revision: 3, title: 'task', summary: '', tags: [], priority: 'p0', status: 'running',
    stage: { id: 'fix', title: 'Fix', kind: 'implementation' },
    execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
    updatedAt: '2026-08-22T00:00:00.000Z',
  }],
  resources: {
    nodes: { total: 1, online: 1, degraded: 0, offline: 0 },
    environments: { total: 1, ready: 1, degraded: 0, unavailable: 0 },
    runners: [{ provider: 'codex', nodeCount: 1, onlineNodeCount: 1 }],
  },
  pending: { blockedTasks: 0, validationTasks: 0, pendingUserAcceptance: 0 },
}

const detail: WorkConsoleTaskDetail = { card: snapshot.tasks[0]!, threads: [], environments: [], validators: [] }

function bench(startResult: unknown) {
  const executionPlan = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      dispatchAvailable: true,
      candidates: [{
        environmentId: 'env-1', environmentRevision: 4, environmentName: 'env', nodeId: 'node-1',
        providers: ['codex'], workspace: { path: '/repo' }, available: true, issues: [],
      }],
    },
  })
  const startExecution = vi.fn().mockResolvedValue({ ok: true, value: startResult })
  const snapshotRemote = vi.fn().mockResolvedValue({ ok: true, value: snapshot })
  const task = vi.fn().mockResolvedValue({ ok: true, value: detail })
  const ctx = new Context()
  ctx.provide('remote', { workConsole: { executionPlan, startExecution, snapshot: snapshotRemote, task } } as never)
  return { controller: new WorkConsoleController(ctx), executionPlan, startExecution, snapshotRemote, task }
}

describe('WorkConsoleController execution boundary', () => {
  it('loads candidates on demand and refreshes authoritative board/detail after a successful start', async () => {
    const result = {
      ok: true,
      value: {
        taskId: 'task-1',
        started: [{ threadId: 'thread-1', environmentId: 'env-1', provider: 'codex', role: 'Fix', commandId: 'cmd-1' }],
      },
    }
    const { controller, executionPlan, startExecution, snapshotRemote, task } = bench(result)

    const plan = await controller.executionPlan('task-1')
    expect(plan?.candidates[0]?.environmentRevision).toBe(4)
    expect(executionPlan).toHaveBeenCalledWith('task-1')

    const started = await controller.startExecution({
      taskId: 'task-1',
      taskRevision: 3,
      placements: [{ environmentId: 'env-1', environmentRevision: 4, provider: 'codex', role: 'Fix' }],
    })
    expect(started?.started[0]?.threadId).toBe('thread-1')
    expect(startExecution).toHaveBeenCalledOnce()
    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(task).toHaveBeenCalledWith('task-1')
  })

  it('surfaces partial-start truth without pretending the whole fan-out failed atomically', async () => {
    const { controller } = bench({
      ok: false,
      error: {
        code: 'partial-start',
        reason: 'placement 1 failed',
        failedIndex: 1,
        started: [{ threadId: 'thread-1', environmentId: 'env-1', provider: 'codex', role: 'A', commandId: 'cmd-1' }],
      },
    })

    const value = await controller.startExecution({
      taskId: 'task-1',
      taskRevision: 3,
      placements: [{ environmentId: 'env-1', environmentRevision: 4, provider: 'codex', role: 'A' }],
    })
    expect(value).toBeUndefined()
    expect(controller.getSnapshot().error).toContain('执行已部分启动（1 个已入队）')
    expect(controller.getSnapshot().error).toContain('placement 1 failed')
  })
})
