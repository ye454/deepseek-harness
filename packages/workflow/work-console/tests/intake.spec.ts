import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService from '@deepseek-ai/dsh-work-control'
import WorkExecutionService from '@deepseek-ai/dsh-work-execution'
import WorkEnvironmentRegistry from '@deepseek-ai/dsh-work-environment'
import WorkNodeRegistry from '@deepseek-ai/dsh-work-node'
import WorkValidationService from '@deepseek-ai/dsh-work-validation'
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
  it('captures a passive Idea without creating execution state', async () => {
    const ctx = await harness()
    const result = await ctx.workConsole.createIdea({
      title: '  雷达恢复策略  ',
      summary: '先记录，暂不执行',
      tags: ['g1', 'recovery'],
    })
    expect(result).toMatchObject({ ok: true, value: { title: '雷达恢复策略', revision: 1 } })
    expect(ctx.workControl.listIdeas()).toHaveLength(1)
    expect(ctx.workControl.listTasks()).toHaveLength(0)
    expect(ctx.workExecution.listAll()).toHaveLength(0)
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

  it.each(TYPES)('organizes %s with a deterministic zero-token template and no Runner thread', async taskType => {
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

  it('rejects stale and non-organizing organization requests', async () => {
    const ctx = await harness()
    const idea = await ctx.workControl.createIdea({ title: 'organize guard' })
    expect(await ctx.workConsole.organizeTask({
      taskId: String(idea.id), taskRevision: idea.revision, taskType: 'custom',
    })).toMatchObject({ ok: false, error: { code: 'invalid-state' } })

    const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
    expect(await ctx.workConsole.organizeTask({
      taskId: String(promoted.id), taskRevision: promoted.revision - 1, taskType: 'custom',
    })).toMatchObject({ ok: false, error: { code: 'conflict' } })
    await ctx.fiber.dispose()
  })
})
