// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkConsoleSnapshot, WorkConsoleTaskDetail } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { apply, inject } from '../src/client/index.ts'
import type { WorkConsoleInjected } from '../src/client/contract.ts'

const snapshot: WorkConsoleSnapshot = {
  generatedAt: '2026-08-18T01:00:00.000Z',
  ideas: [],
  tasks: [{
    id: 'task-p0', revision: 1, title: 'P0 task', summary: '', tags: [], priority: 'p0', status: 'running',
    execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
    updatedAt: '2026-08-18T01:00:00.000Z',
  }],
  resources: {
    nodes: { total: 0, online: 0, degraded: 0, offline: 0 },
    environments: { total: 0, ready: 0, degraded: 0, unavailable: 0 },
    runners: [],
  },
  pending: { blockedTasks: 0, validationTasks: 0, pendingUserAcceptance: 0 },
}

const detail: WorkConsoleTaskDetail = { card: snapshot.tasks[0]!, threads: [], environments: [], validators: [] }

type TestParentProps = PropsRuntime<'root'> & PropsRenderSlots<'sidebar.footer.action' | 'shell.overlay'>

function TestParent(props: TestParentProps) {
  void props.renderSlot
  return null
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const snapshotRemote = vi.fn().mockResolvedValue({ ok: true, value: snapshot })
  const taskRemote = vi.fn().mockResolvedValue({ ok: true, value: detail })
  ctx.provide('remote', { workConsole: { snapshot: snapshotRemote, task: taskRemote } } as never)

  const parent = ctx.plugin({
    apply(parentCtx: Context) {
      return parentCtx.slots.register({
        name: 'root',
        children: {
          'sidebar.footer.action': { kind: 'list', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
      }, TestParent)
    },
  })
  await parent.await()
  const fiber = ctx.plugin({ apply })
  await fiber.await()
  return { ctx, fiber, parent, snapshotRemote, taskRemote }
}

function injectedFace(ctx: Context, actions: { open: () => void; close: () => void; selectTask: (taskId: string | null) => void }): WorkConsoleInjected {
  const entry = ctx.slots.entries('shell.overlay')[0]!
  return (entry.inject as (bound: never) => WorkConsoleInjected)(actions as never)
}

describe('ui-work-console client apply', () => {
  it('declares the exact services needed by the browser plugin', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.workConsole'])
  })

  it('registers one sidebar action and one overlay with one shared controller', async () => {
    const { ctx } = await bench()
    const sidebar = ctx.slots.entries('sidebar.footer.action')
    const overlays = ctx.slots.entries('shell.overlay')
    expect(sidebar).toHaveLength(1)
    expect(overlays).toHaveLength(1)
    expect(sidebar[0]!.options).toMatchObject({ id: 'global-work-console', order: -20 })
    expect(overlays[0]!.options).toMatchObject({ id: 'global-work-console', order: 10 })

    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const sidebarFace = (sidebar[0]!.inject as (bound: never) => WorkConsoleInjected)(actions as never)
    const overlayFace = (overlays[0]!.inject as (bound: never) => WorkConsoleInjected)(actions as never)
    expect(sidebarFace.hooks.workConsole).toBe(overlayFace.hooks.workConsole)
  })

  it('opens the lightweight surface without auto-selecting or loading a Task Detail', async () => {
    const { ctx, snapshotRemote, taskRemote } = await bench()
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)

    face.openConsole(null)
    await vi.waitFor(() => { expect(snapshotRemote).toHaveBeenCalledOnce() })
    expect(actions.open).toHaveBeenCalledOnce()
    expect(actions.selectTask).not.toHaveBeenCalled()
    expect(taskRemote).not.toHaveBeenCalled()
  })

  it('refreshes an existing selection and loads only that Task Detail', async () => {
    const { ctx, snapshotRemote, taskRemote } = await bench()
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)

    face.refreshConsole('task-p0')
    await vi.waitFor(() => {
      expect(snapshotRemote).toHaveBeenCalledOnce()
      expect(taskRemote).toHaveBeenCalledWith('task-p0')
    })
    expect(actions.selectTask).not.toHaveBeenCalled()
  })

  it('clears a selection that disappeared from the refreshed snapshot', async () => {
    const { ctx, snapshotRemote, taskRemote } = await bench()
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)
    snapshotRemote.mockResolvedValueOnce({ ok: true, value: { ...snapshot, tasks: [] } })

    face.refreshConsole('task-p0')
    await vi.waitFor(() => { expect(snapshotRemote).toHaveBeenCalledOnce() })
    expect(actions.selectTask).toHaveBeenCalledWith(null)
    expect(taskRemote).not.toHaveBeenCalled()
  })

  it('wires explicit selection, clear-error, and close callbacks', async () => {
    const { ctx, taskRemote } = await bench()
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)

    face.selectTask('task-p0')
    await vi.waitFor(() => { expect(taskRemote).toHaveBeenCalledWith('task-p0') })
    expect(actions.selectTask).toHaveBeenCalledWith('task-p0')
    face.clearError()
    face.closeConsole()
    expect(actions.close).toHaveBeenCalledOnce()
  })

  it('stops synchronization after a failed snapshot refresh', async () => {
    const { ctx, snapshotRemote, taskRemote } = await bench()
    snapshotRemote.mockResolvedValueOnce({ ok: false, error: { code: 'OFFLINE', message: 'down' } })
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)

    face.refreshConsole('task-p0')
    await vi.waitFor(() => { expect(snapshotRemote).toHaveBeenCalledOnce() })
    expect(actions.selectTask).not.toHaveBeenCalled()
    expect(taskRemote).not.toHaveBeenCalled()
  })

  it('removes both contributions when the plugin fiber is disposed', async () => {
    const { ctx, fiber, parent } = await bench()
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
    await parent.dispose()
  })
})
