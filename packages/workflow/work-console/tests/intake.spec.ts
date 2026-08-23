import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService, { WorkItemConflictError, WorkItemTransitionError } from '../src/internal/control/index.ts'
import WorkExecutionService from '../src/internal/execution/index.ts'
import WorkEnvironmentRegistry from '../src/internal/environment/index.ts'
import WorkNodeRegistry from '../src/internal/node/index.ts'
import WorkValidationService from '../src/internal/validation/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkConsoleGateway from '../src/index.ts'
import type { WorkConsoleTaskType } from '../src/intake-types.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(WorkControlService)
  await ctx.plugin(WorkExecutionService)
  await ctx.plugin(WorkNodeRegistry)
  await ctx.plugin(WorkEnvironmentRegistry)
  await ctx.plugin(WorkValidationService)
  await ctx.plugin(WorkConsoleGateway)
  return ctx
}

const TYPES: readonly WorkConsoleTaskType[] = [
  'bug-fix', 'ui-fix', 'feature', 'performance', 'deployment', 'research', 'custom',
]

describe('Work Console intake', () => {
  it('captures a passive Idea without creating a Task', async () => {
    const ctx = await harness()
    const result = await ctx.workConsole.createIdea({
      title: '  雷达恢复策略  ',
      summary: '先记录，暂不执行',
      tags: ['g1', 'recovery'],
    })
    expect(result).toMatchObject({ ok: true, value: { title: '雷达恢复策略', revision: 1 } })
    expect(ctx.workControl.listIdeas()).toHaveLength(1)
    expect(ctx.workControl.listTasks()).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('accepts title-only capture and leaves optional summary/tags empty', async () => {
    const ctx = await harness()
    const result = await ctx.workConsole.createIdea({ title: '仅标题' })
    expect(result.ok).toBe(true)
    expect(ctx.workControl.listIdeas()[0]).toMatchObject({ title: '仅标题', summary: '', tags: [] })
    await ctx.fiber.dispose()
  })

  it('rejects an empty Idea title without writing a work item', async () => {
    const ctx = await harness()
    expect(await ctx.workConsole.createIdea({ title: '   ' })).toEqual({
      ok: false,
      error: { code: 'invalid-input', field: 'title', reason: 'title must not be empty' },
    })
    expect(ctx.workControl.list()).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it.each(TYPES)('organizes %s with a deterministic zero-token template and no Runner thread', async (taskType) => {
    const ctx = await harness()
    const idea = await ctx.workControl.createIdea({ title: `Task ${taskType}` })
    const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
    const result = await ctx.workConsole.organizeTask({
      taskId: String(promoted.id),
      taskRevision: promoted.revision,
      taskType,
    })
    expect(result.ok).toBe(true)
    const task = ctx.workControl.get(promoted.id)
    expect(task).toMatchObject({ kind: 'task', status: 'running', taskType })
    if (task?.kind !== 'task') throw new Error('expected organized task')
    expect(task.workflow?.stages.length).toBeGreaterThan(0)
    expect(task.currentStageId).toBe(task.workflow?.stages[0]?.id)
    expect(task.validationPolicy?.version).toBe(1)
    expect(ctx.workExecution.list(task.id)).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('rejects missing, stale, passive, and already-organized requests', async () => {
    const ctx = await harness()
    expect(await ctx.workConsole.organizeTask({
      taskId: 'missing-task', taskRevision: 1, taskType: 'custom',
    })).toMatchObject({ ok: false, error: { code: 'not-found' } })

    const idea = await ctx.workControl.createIdea({ title: 'organize guard' })
    expect(await ctx.workConsole.organizeTask({
      taskId: String(idea.id), taskRevision: idea.revision, taskType: 'custom',
    })).toMatchObject({ ok: false, error: { code: 'invalid-state' } })

    const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
    expect(await ctx.workConsole.organizeTask({
      taskId: String(promoted.id), taskRevision: promoted.revision - 1, taskType: 'custom',
    })).toMatchObject({ ok: false, error: { code: 'conflict' } })

    const organized = await ctx.workConsole.organizeTask({
      taskId: String(promoted.id), taskRevision: promoted.revision, taskType: 'custom',
    })
    if (!organized.ok) throw new Error('expected first organization to succeed')
    expect(await ctx.workConsole.organizeTask({
      taskId: String(promoted.id), taskRevision: organized.value.revision, taskType: 'custom',
    })).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
    await ctx.fiber.dispose()
  })

  it('maps organization CAS and transition races to typed business failures', async () => {
    const ctx = await harness()
    const idea = await ctx.workControl.createIdea({ title: 'race guards' })
    const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
    const ref = { id: promoted.id, revision: promoted.revision }

    vi.spyOn(ctx.workControl, 'organizeTask').mockRejectedValueOnce(
      new WorkItemConflictError(ref, promoted.revision + 1),
    )
    expect(await ctx.workConsole.organizeTask({
      taskId: String(promoted.id), taskRevision: promoted.revision, taskType: 'bug-fix',
    })).toMatchObject({ ok: false, error: { code: 'conflict', currentRevision: promoted.revision + 1 } })

    vi.spyOn(ctx.workControl, 'organizeTask').mockRejectedValueOnce(
      new WorkItemTransitionError('task changed state during organization'),
    )
    expect(await ctx.workConsole.organizeTask({
      taskId: String(promoted.id), taskRevision: promoted.revision, taskType: 'bug-fix',
    })).toMatchObject({ ok: false, error: { code: 'invalid-state', reason: 'task changed state during organization' } })
    await ctx.fiber.dispose()
  })
})
