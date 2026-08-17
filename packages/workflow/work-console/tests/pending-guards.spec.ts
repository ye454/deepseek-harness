import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => { vi.restoreAllMocks() })

async function harness() {
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

async function validationTask(ctx: Context) {
  const idea = await ctx.workControl.createIdea({ title: 'Pending guard' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  let task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'review',
    workflow: { version: 1, stages: [{ id: 'review', title: 'Review', kind: 'validation' }] },
    validationPolicy: {
      version: 1,
      validators: [{ kind: 'user-acceptance', requirement: 'required', label: 'Human approval' }],
    },
  })
  task = await ctx.workControl.setStatus({ id: task.id, revision: task.revision }, 'validation')
  return task
}

describe('WorkConsole pending-summary defensive reads', () => {
  it('does not invent pending user acceptance when the backing Task disappears during read projection', async () => {
    const ctx = await harness()
    await validationTask(ctx)
    vi.spyOn(ctx.workControl, 'get').mockReturnValue(undefined)
    expect(ctx.workConsole.snapshot().pending).toMatchObject({ validationTasks: 1, pendingUserAcceptance: 0 })
    await ctx.fiber.dispose()
  })

  it('treats a validation Task with no policy as having no pending validators', async () => {
    const ctx = await harness()
    const task = await validationTask(ctx)
    const current = ctx.workControl.get(task.id)
    if (current?.kind !== 'task') throw new Error('expected Task')
    const { validationPolicy, ...withoutPolicy } = current
    void validationPolicy
    vi.spyOn(ctx.workControl, 'get').mockReturnValue(withoutPolicy)
    expect(ctx.workConsole.snapshot().pending).toMatchObject({ validationTasks: 1, pendingUserAcceptance: 0 })
    await ctx.fiber.dispose()
  })
})
