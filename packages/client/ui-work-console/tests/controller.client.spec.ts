import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WorkConsoleSnapshot, WorkConsoleTaskDetail } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { WorkConsoleController } from '../src/client/controller.ts'

function snapshot(title: string, priority: 'p0' | 'p1' | 'p2' = 'p1'): WorkConsoleSnapshot {
  return {
    generatedAt: '2026-08-16T00:00:00.000Z',
    ideas: [],
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
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

  it('keeps the last good snapshot visible when a later Remote result fails', async () => {
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
    controller.clearError()
    expect(controller.getSnapshot().error).toBeUndefined()
  })

  it('publishes transport exceptions, preserves the prior snapshot, and notifies only live subscribers', async () => {
    let throwNow = false
    const { controller } = harness({
      snapshot: () => throwNow
        ? Promise.reject(new Error('socket down'))
        : Promise.resolve({ ok: true, value: snapshot('prior') }),
      task: () => Promise.resolve({ ok: true, value: undefined }),
    })
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    await controller.refresh()
    const afterSuccess = listener.mock.calls.length
    expect(afterSuccess).toBeGreaterThan(0)

    throwNow = true
    await controller.refresh()
    expect(controller.getSnapshot().snapshot?.tasks[0]?.title).toBe('prior')
    expect(controller.getSnapshot().error).toBe('socket down')
    expect(listener.mock.calls.length).toBeGreaterThan(afterSuccess)

    unsubscribe()
    const afterUnsubscribe = listener.mock.calls.length
    controller.clearError()
    expect(listener).toHaveBeenCalledTimes(afterUnsubscribe)
  })

  it('ignores a stale refresh rejection after a newer refresh wins', async () => {
    const first = deferred<unknown>()
    let call = 0
    const { controller } = harness({
      snapshot: () => ++call === 1
        ? first.promise
        : Promise.resolve({ ok: true, value: snapshot('winner') }),
      task: () => Promise.resolve({ ok: true, value: undefined }),
    })
    const oldRequest = controller.refresh()
    await controller.refresh()
    first.reject('old failure')
    await oldRequest
    expect(controller.getSnapshot().snapshot?.tasks[0]?.title).toBe('winner')
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

  it('surfaces Task Remote failures and non-Error exceptions without fabricating detail', async () => {
    let mode: 'result' | 'throw' = 'result'
    const { controller } = harness({
      snapshot: () => Promise.resolve({ ok: true, value: snapshot('board') }),
      task: () => mode === 'result'
        ? Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'gone' } })
        : Promise.reject('wire broke'),
    })

    await controller.loadTask('missing')
    expect(controller.getSnapshot().error).toContain('NOT_FOUND')
    expect(controller.getSnapshot().detail).toBeUndefined()
    mode = 'throw'
    await controller.loadTask('broken')
    expect(controller.getSnapshot().error).toBe('wire broke')
    expect(controller.getSnapshot().detail).toBeUndefined()
  })

  it('ignores a stale Task rejection after a newer Task Detail wins', async () => {
    const first = deferred<unknown>()
    const { controller } = harness({
      snapshot: () => Promise.resolve({ ok: true, value: snapshot('board') }),
      task: taskId => taskId === 'old'
        ? first.promise
        : Promise.resolve({ ok: true, value: detail(taskId) }),
    })
    const oldRequest = controller.loadTask('old')
    await controller.loadTask('new')
    first.reject(new Error('old task failed'))
    await oldRequest
    expect(controller.getSnapshot()).toMatchObject({
      detailTaskId: 'new',
      detail: { card: { id: 'new' } },
      error: undefined,
    })
  })
})
