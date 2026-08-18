import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { WorkConsoleSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { WorkConsoleController } from '../src/client/controller.ts'

const snapshot: WorkConsoleSnapshot = {
  generatedAt: '2026-08-18T14:00:00.000Z',
  ideas: [],
  tasks: [],
  resources: {
    nodes: { total: 0, online: 0, degraded: 0, offline: 0 },
    environments: { total: 0, ready: 0, degraded: 0, unavailable: 0 },
    runners: [],
  },
  pending: { blockedTasks: 0, validationTasks: 0, pendingUserAcceptance: 0 },
}

function harness(options: {
  promote?: () => Promise<unknown>
  decide?: () => Promise<unknown>
}) {
  const ctx = new Context()
  const snapshotRemote = vi.fn().mockResolvedValue({ ok: true, value: snapshot })
  const promoteRemote = vi.fn(options.promote ?? (() => Promise.resolve({
    ok: true,
    value: { ok: true, value: { id: 'idea-1', revision: 2, status: 'organizing', priority: 'p2' } },
  })))
  const decideRemote = vi.fn(options.decide ?? (() => Promise.resolve({
    ok: true,
    value: { ok: true, value: { taskId: 'task-1', revision: 4, status: 'done', decision: 'accept' } },
  })))
  ctx.provide('remote', {
    workConsole: {
      snapshot: snapshotRemote,
      task: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
    workConsoleCommands: {
      promoteIdea: promoteRemote,
      decideAcceptance: decideRemote,
    },
  } as never)
  return { controller: new WorkConsoleController(ctx), snapshotRemote, promoteRemote, decideRemote }
}

describe('WorkConsoleController commands', () => {
  it('refreshes authoritative facts after successful Idea promotion', async () => {
    const { controller, snapshotRemote, promoteRemote } = harness({})
    await expect(controller.promoteIdea({ id: 'idea-1', revision: 1 })).resolves.toMatchObject({ status: 'organizing' })
    expect(promoteRemote).toHaveBeenCalledWith({ id: 'idea-1', revision: 1 })
    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().error).toBeUndefined()
  })

  it('renders outer transport and inner business promotion failures without refreshing', async () => {
    const outer = harness({ promote: () => Promise.resolve({ ok: false, error: { code: 'OFFLINE', message: 'host down' } }) })
    await expect(outer.controller.promoteIdea({ id: 'idea-1', revision: 1 })).resolves.toBeUndefined()
    expect(outer.controller.getSnapshot().error).toContain('OFFLINE')
    expect(outer.snapshotRemote).not.toHaveBeenCalled()

    const inner = harness({ promote: () => Promise.resolve({
      ok: true,
      value: { ok: false, error: { code: 'conflict', id: 'idea-1', expectedRevision: 1, currentRevision: 2 } },
    }) })
    await inner.controller.promoteIdea({ id: 'idea-1', revision: 1 })
    expect(inner.controller.getSnapshot().error).toContain('revision 2')
    expect(inner.snapshotRemote).not.toHaveBeenCalled()
  })

  it('contains command exceptions as visible errors', async () => {
    const { controller } = harness({ promote: () => Promise.reject(new Error('command socket failed')) })
    await expect(controller.promoteIdea({ id: 'idea-1', revision: 1 })).resolves.toBeUndefined()
    expect(controller.getSnapshot().error).toBe('command socket failed')
  })

  it('refreshes after successful human acceptance', async () => {
    const { controller, snapshotRemote, decideRemote } = harness({})
    await expect(controller.decideAcceptance({
      taskId: 'task-1', taskRevision: 3, generation: 2, validatorIndex: 1, decision: 'accept',
    })).resolves.toMatchObject({ status: 'done' })
    expect(decideRemote).toHaveBeenCalledWith({
      taskId: 'task-1', taskRevision: 3, generation: 2, validatorIndex: 1, decision: 'accept',
    })
    expect(snapshotRemote).toHaveBeenCalledOnce()
  })

  it('maps each acceptance business failure family to actionable UI text', async () => {
    const failures = [
      [{ code: 'not-found', id: 'task-1' }, '目标已不存在'],
      [{ code: 'invalid-state', id: 'task-1', reason: 'already done' }, 'already done'],
      [{ code: 'stale-generation', taskId: 'task-1', expectedGeneration: 1, currentGeneration: 2 }, '验收轮次已变化'],
      [{ code: 'invalid-validator', taskId: 'task-1', validatorIndex: 1 }, '验收项已变化'],
      [{ code: 'not-ready', taskId: 'task-1', reason: 'automated-failed' }, '自动验收未通过'],
      [{ code: 'not-ready', taskId: 'task-1', reason: 'automated-pending' }, '自动验收尚未完成'],
    ] as const

    for (const [error, text] of failures) {
      const { controller } = harness({ decide: () => Promise.resolve({ ok: true, value: { ok: false, error } }) })
      await controller.decideAcceptance({
        taskId: 'task-1', taskRevision: 3, generation: 2, validatorIndex: 1, decision: 'accept',
      })
      expect(controller.getSnapshot().error).toContain(text)
    }
  })

  it('handles acceptance outer transport errors and thrown failures', async () => {
    const outer = harness({ decide: () => Promise.resolve({ ok: false, error: { code: 'OFFLINE', message: 'host down' } }) })
    await outer.controller.decideAcceptance({
      taskId: 'task-1', taskRevision: 3, generation: 2, validatorIndex: 1, decision: 'return',
    })
    expect(outer.controller.getSnapshot().error).toContain('OFFLINE')

    const thrown = harness({ decide: () => Promise.reject('command link lost') })
    await thrown.controller.decideAcceptance({
      taskId: 'task-1', taskRevision: 3, generation: 2, validatorIndex: 1, decision: 'return',
    })
    expect(thrown.controller.getSnapshot().error).toBe('command link lost')
  })
})
