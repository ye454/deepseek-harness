import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService, { type TaskWorkItem, type WorkItemId } from '@deepseek-ai/dsh-work-control'
import WorkValidationService from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(WorkControlService)
  await ctx.plugin(WorkValidationService)
  return ctx
}

function currentTask(ctx: Context, id: WorkItemId): TaskWorkItem {
  const item = ctx.workControl.get(id)
  if (item?.kind !== 'task') throw new Error(`expected task '${id}'`)
  return item
}

describe('work-control validation invalidation', () => {
  it('clears a passed summary when validation returns to running work', async () => {
    const ctx = await harness()
    const idea = await ctx.workControl.createIdea({ title: 'Fix after validation' })
    const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
    const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
      taskType: 'bug-fix',
      workflow: {
        version: 1,
        stages: [
          { id: 'fix', title: 'Fix', kind: 'implementation' },
          { id: 'validate', title: 'Validate', kind: 'validation' },
        ],
      },
      validationPolicy: {
        version: 1,
        validators: [{ kind: 'automated-test', requirement: 'required', label: 'Regression suite' }],
      },
    })

    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [{ kind: 'test', label: 'regression', reference: 'ci:before-more-work' }],
    })

    let current = currentTask(ctx, task.id)
    expect(current.validation).toMatchObject({ state: 'passed', requiredPassed: 1, requiredTotal: 1 })

    current = await ctx.workControl.setStatus({ id: task.id, revision: current.revision }, 'running')
    expect(current.validation).toEqual({ state: 'pending', requiredPassed: 0, requiredTotal: 1 })

    await expect(
      ctx.workControl.setStatus({ id: task.id, revision: current.revision }, 'done'),
    ).rejects.toThrow(/cannot complete/)

    const second = await ctx.workValidation.beginValidation({ id: task.id, revision: current.revision })
    expect(second.generation).toBe(session.generation + 1)
    expect(ctx.workValidation.listResults(task.id)).toEqual([])
    expect(ctx.workValidation.listResults(task.id, session.generation)).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
