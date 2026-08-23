import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { WorkConsoleSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { WorkConsoleController } from '../src/client/controller.ts'

const snapshot: WorkConsoleSnapshot = {
  generatedAt: '2026-08-21T10:00:00.000Z',
  ideas: [], tasks: [],
  resources: {
    nodes: { total: 0, online: 0, degraded: 0, offline: 0 },
    environments: { total: 0, ready: 0, degraded: 0, unavailable: 0 },
    runners: [],
  },
  pending: { blockedTasks: 0, validationTasks: 0, pendingUserAcceptance: 0 },
}

function harness(options: {
  create?: () => Promise<unknown>
  organize?: () => Promise<unknown>
} = {}) {
  const ctx = new Context()
  const snapshotRemote = vi.fn().mockResolvedValue({ ok: true, value: snapshot })
  const createRemote = vi.fn(options.create ?? (() => Promise.resolve({
    ok: true, value: { ok: true, value: { id: 'idea-1', revision: 1, title: '新想法' } },
  })))
  const organizeRemote = vi.fn(options.organize ?? (() => Promise.resolve({
    ok: true, value: {
      ok: true,
      value: { taskId: 'task-1', revision: 3, status: 'running', taskType: 'bug-fix', stageId: 'diagnosis' },
    },
  })))
  ctx.provide('remote', {
    workConsole: {
      snapshot: snapshotRemote,
      task: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      createIdea: createRemote,
      organizeTask: organizeRemote,
      promoteIdea: vi.fn(),
      decideAcceptance: vi.fn(),
    },
  } as never)
  return { controller: new WorkConsoleController(ctx), snapshotRemote, createRemote, organizeRemote }
}

describe('WorkConsoleController intake', () => {
  it('captures a passive Idea and refreshes authoritative facts', async () => {
    const { controller, createRemote, snapshotRemote } = harness()
    await expect(controller.createIdea({ title: '新想法', summary: '', tags: ['rag'] }))
      .resolves.toMatchObject({ id: 'idea-1', revision: 1 })
    expect(createRemote).toHaveBeenCalledWith({ title: '新想法', summary: '', tags: ['rag'] })
    expect(snapshotRemote).toHaveBeenCalledOnce()
  })

  it('surfaces create validation and transport failures without fake refresh', async () => {
    const invalid = harness({ create: () => Promise.resolve({
      ok: true,
      value: { ok: false, error: { code: 'invalid-input', field: 'title', reason: 'title must not be empty' } },
    }) })
    await expect(invalid.controller.createIdea({ title: ' ' })).resolves.toBeUndefined()
    expect(invalid.controller.getSnapshot().error).toContain('title must not be empty')
    expect(invalid.snapshotRemote).not.toHaveBeenCalled()

    const offline = harness({ create: () => Promise.resolve({ ok: false, error: { code: 'OFFLINE', message: 'down' } }) })
    await offline.controller.createIdea({ title: 'x' })
    expect(offline.controller.getSnapshot().error).toContain('OFFLINE')
  })

  it('organizes a promoted Task with the selected deterministic template and refreshes', async () => {
    const { controller, organizeRemote, snapshotRemote } = harness()
    await expect(controller.organizeTask({ taskId: 'task-1', taskRevision: 2, taskType: 'bug-fix' }))
      .resolves.toMatchObject({ status: 'running', stageId: 'diagnosis' })
    expect(organizeRemote).toHaveBeenCalledWith({ taskId: 'task-1', taskRevision: 2, taskType: 'bug-fix' })
    expect(snapshotRemote).toHaveBeenCalledOnce()
  })

  it('maps organization conflicts and thrown failures without claiming success', async () => {
    const conflict = harness({ organize: () => Promise.resolve({
      ok: true,
      value: { ok: false, error: { code: 'conflict', id: 'task-1', expectedRevision: 2, currentRevision: 3 } },
    }) })
    await conflict.controller.organizeTask({ taskId: 'task-1', taskRevision: 2, taskType: 'custom' })
    expect(conflict.controller.getSnapshot().error).toContain('revision 3')
    expect(conflict.snapshotRemote).not.toHaveBeenCalled()

    const thrown = harness({ organize: () => Promise.reject(new Error('organization link failed')) })
    await thrown.controller.organizeTask({ taskId: 'task-1', taskRevision: 2, taskType: 'custom' })
    expect(thrown.controller.getSnapshot().error).toBe('organization link failed')
  })
})
