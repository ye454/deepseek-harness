import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WorkConsoleSnapshot, WorkConsoleTaskDetail } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { WorkConsoleController, chooseWorkConsoleTask } from '../src/client/controller.ts'

function snapshot(title: string, priority: 'p0' | 'p1' | 'p2' = 'p1'): WorkConsoleSnapshot {
  return {
    generatedAt: '2026-08-16T00:00:00.000Z',
    tasks: [{
      id: title,
      revision: 1,
      title,
      summary: '',
      tags: [],
      priority,
      status: 'running',
      execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
      updatedAt: '2026-08-16T00:00:00.000Z',
    }],
    resources: {
      nodes: { total: 0, online: 0, degraded: 0, offline: 0 },
      environments: { total: 0, ready: 0, degraded: 0, unavailable: 0 },
      runners: [],
    },
    pending: { blockedTasks: 0, validationTasks: 0, pendingUserAcceptance: 0 },
  }
}

function detail(id: string): WorkConsoleTaskDetail {
  return {
    card: snapshot(id).tasks[0]!,
    threads: [],
    environments: [],
    validators: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(value => { resolve = value })
  return { promise, resolve }
}

function harness(remote: {
  snapshot: () => Promise<unknown>
  task: (taskId: string) => Promise<unknown>
}) {
  const ctx = new Context()
  ctx.provide('remote', { workConsole: remote } as never)
  return { ctx, controller: new WorkConsoleController(ctx) }
}

describe('WorkConsoleController', () => {
  it('uses last-request-wins so a slow old refresh cannot overwrite newer global facts', async () => {
    const first = deferred<unknown>()
    let call = 0
    const { controller } = harness({
      snapshot: () => {
        call += 1
        return call === 1
          ? first.promise
          : Promise.resolve({ ok: true, value: snapshot('new', 'p0') })
      },
      task: () => Promise.resolve({ ok: true, value: undefined }),
    })

    const oldRequest = controller.refresh()
    const newRequest = controller.refresh()
    await newRequest
    expect(controller.getSnapshot().snapshot?.tasks[0]?.title).toBe('new')

    first.resolve({ ok: true, value: snapshot('old') })
    await oldRequest
    expect(controller.getSnapshot().snapshot?.tasks[0]?.title).toBe('new')
  })

  it('keeps the last good snapshot visible when a later transport read fails', async () => {
    let fail = false
    const { controller } = harness({
      snapshot: () => Promise.resolve(fail
        ? { ok: false, error: { code: 'OFFLINE', message: 'host unavailable' } }
        : { ok: true, value: snapshot('stable') }),
      task: () => Promise.resolve({ ok: true, value: undefined }),
    })

    await controller.refresh()
    fail = true
    await controller.refresh()
    expect(controller.getSnapshot().snapshot?.tasks[0]?.title).toBe('stable')
    expect(controller.getSnapshot().error).toContain('OFFLINE')
    controller.clearError()
    expect(controller.getSnapshot().error).toBeUndefined()
  })

  it('keeps Task Detail scoped to the most recently requested Task id', async () => {
    const first = deferred<unknown>()
    const { controller } = harness({
      snapshot: () => Promise.resolve({ ok: true, value: snapshot('board') }),
      task: taskId => taskId === 'old'
        ? first.promise
        : Promise.resolve({ ok: true, value: detail(taskId) }),
    })

    const oldRequest = controller.loadTask('old')
    await controller.loadTask('new')
    expect(controller.getSnapshot()).toMatchObject({ detailTaskId: 'new', detail: { card: { id: 'new' } } })

    first.resolve({ ok: true, value: detail('old') })
    await oldRequest
    expect(controller.getSnapshot()).toMatchObject({ detailTaskId: 'new', detail: { card: { id: 'new' } } })
  })
})

describe('chooseWorkConsoleTask', () => {
  it('retains a valid selection and otherwise prefers P0 over ordinary running work', () => {
    const mixed: WorkConsoleSnapshot = {
      ...snapshot('p1'),
      tasks: [snapshot('p1').tasks[0]!, snapshot('p0', 'p0').tasks[0]!],
    }
    expect(chooseWorkConsoleTask(mixed, 'p1')).toBe('p1')
    expect(chooseWorkConsoleTask(mixed, 'missing')).toBe('p0')
  })
})
