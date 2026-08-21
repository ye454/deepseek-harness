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
  const createRemote = vi.fn().mockResolvedValue({
    ok: true,
    value: { ok: true, value: { id: 'idea-1', revision: 1, title: 'new idea' } },
  })
  const promoteRemote = vi.fn().mockResolvedValue({
    ok: true,
    value: { ok: true, value: { id: 'idea-1', revision: 2, status: 'organizing', priority: 'p2' } },
  })
  const organizeRemote = vi.fn().mockResolvedValue({
    ok: true,
    value: { ok: true, value: { taskId: 'task-p0', revision: 2, status: 'running', taskType: 'bug-fix', stageId: 'diagnosis' } },
  })
  const decideRemote = vi.fn().mockResolvedValue({
    ok: true,
    value: { ok: true, value: { taskId: 'task-p0', revision: 2, status: 'done', decision: 'accept' } },
  })
  ctx.provide('remote', {
    workConsole: {
      snapshot: snapshotRemote,
      task: taskRemote,
      createIdea: createRemote,
      promoteIdea: promoteRemote,
      organizeTask: organizeRemote,
      decideAcceptance: decideRemote,
    },
  } as never)

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
  return { ctx, fiber, parent, snapshotRemote, taskRemote, createRemote, promoteRemote, organizeRemote, decideRemote }
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

  it('wires passive Idea capture through the unified Work Console Remote', async () => {
    const { ctx, createRemote, snapshotRemote } = await bench()
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)
    await expect(face.createIdea('idea', 'summary', ['rag'])).resolves.toBe(true)
    expect(createRemote).toHaveBeenCalledWith({ title: 'idea', summary: 'summary', tags: ['rag'] })
    expect(snapshotRemote).toHaveBeenCalledOnce()
  })

  it('wires Idea promotion through the unified Work Console Remote', async () => {
    const { ctx, promoteRemote, snapshotRemote } = await bench()
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)
    await expect(face.promoteIdea('idea-1', 1)).resolves.toBe(true)
    expect(promoteRemote).toHaveBeenCalledWith({ id: 'idea-1', revision: 1 })
    expect(snapshotRemote).toHaveBeenCalledOnce()
  })

  it('wires deterministic organization and reloads the selected Task Detail', async () => {
    const { ctx, organizeRemote, snapshotRemote, taskRemote } = await bench()
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)
    await expect(face.organizeTask('task-p0', 1, 'bug-fix')).resolves.toBe(true)
    expect(organizeRemote).toHaveBeenCalledWith({ taskId: 'task-p0', taskRevision: 1, taskType: 'bug-fix' })
    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(taskRemote).toHaveBeenCalledWith('task-p0')
  })

  it('keeps acceptance detail open while another human gate remains and closes terminal decisions', async () => {
    const first = await bench()
    first.decideRemote.mockResolvedValueOnce({
      ok: true,
      value: { ok: true, value: { taskId: 'task-p0', revision: 2, status: 'validation', decision: 'accept' } },
    })
    const firstActions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const firstFace = injectedFace(first.ctx, firstActions)
    await expect(firstFace.decideAcceptance('task-p0', 1, 2, 1, 'accept')).resolves.toBe(true)
    expect(first.taskRemote).toHaveBeenCalledWith('task-p0')
    expect(firstActions.selectTask).not.toHaveBeenCalled()

    const second = await bench()
    const secondActions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const secondFace = injectedFace(second.ctx, secondActions)
    await expect(secondFace.decideAcceptance('task-p0', 1, 2, 1, 'return')).resolves.toBe(true)
    expect(secondActions.selectTask).toHaveBeenCalledWith(null)
  })

  it('does not mutate local selection when Host mutation commands fail', async () => {
    const { ctx, createRemote, promoteRemote, organizeRemote, decideRemote } = await bench()
    createRemote.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'invalid-input', field: 'title', reason: 'empty' } },
    })
    promoteRemote.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'conflict', id: 'idea-1', expectedRevision: 1, currentRevision: 2 } },
    })
    organizeRemote.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'conflict', id: 'task-p0', expectedRevision: 1, currentRevision: 2 } },
    })
    decideRemote.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'not-ready', taskId: 'task-p0', reason: 'automated-pending' } },
    })
    const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
    const face = injectedFace(ctx, actions)
    await expect(face.createIdea(' ', '', [])).resolves.toBe(false)
    await expect(face.promoteIdea('idea-1', 1)).resolves.toBe(false)
    await expect(face.organizeTask('task-p0', 1, 'custom')).resolves.toBe(false)
    await expect(face.decideAcceptance('task-p0', 1, 2, 1, 'accept')).resolves.toBe(false)
    expect(actions.selectTask).not.toHaveBeenCalled()
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
