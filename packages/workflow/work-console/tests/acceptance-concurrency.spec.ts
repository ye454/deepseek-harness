import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService, { type TaskWorkItem } from '@deepseek-ai/dsh-work-control'
import WorkExecutionService from '@deepseek-ai/dsh-work-execution'
import WorkEnvironmentRegistry from '@deepseek-ai/dsh-work-environment'
import WorkNodeRegistry from '@deepseek-ai/dsh-work-node'
import WorkValidationService from '@deepseek-ai/dsh-work-validation'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkConsoleGateway from '../src/index.ts'

let home = ''
let originalDshHome: string | undefined

beforeEach(() => {
  originalDshHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'dsh-work-console-acceptance-cas-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  rmSync(home, { recursive: true, force: true })
})

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

function currentTask(ctx: Context, id: TaskWorkItem['id']): TaskWorkItem {
  const item = ctx.workControl.get(id)
  if (item?.kind !== 'task') throw new Error(`expected task ${id}`)
  return item
}

async function humanValidationTask(ctx: Context): Promise<{
  task: TaskWorkItem
  generation: number
}> {
  const idea = await ctx.workControl.createIdea({ title: 'Concurrent acceptance' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  const organized = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'custom',
    workflow: {
      version: 1,
      stages: [
        { id: 'run', title: 'Run', kind: 'implementation' },
        { id: 'accept', title: 'Accept', kind: 'validation' },
      ],
    },
    validationPolicy: {
      version: 1,
      validators: [{ kind: 'user-acceptance', requirement: 'required', label: 'Human' }],
    },
  })
  const session = await ctx.workValidation.beginValidation({ id: organized.id, revision: organized.revision })
  return { task: currentTask(ctx, organized.id), generation: session.generation }
}

describe('Work Console human-acceptance CAS', () => {
  it('serializes same-task decisions so a stale concurrent decision cannot overwrite the first', async () => {
    const ctx = await harness()
    const { task, generation } = await humanValidationTask(ctx)
    const request = {
      taskId: String(task.id),
      taskRevision: task.revision,
      generation,
      validatorIndex: 0,
    } as const

    const [accepted, returned] = await Promise.all([
      ctx.workConsole.decideAcceptance({ ...request, decision: 'accept' }),
      ctx.workConsole.decideAcceptance({ ...request, decision: 'return' }),
    ])

    expect(accepted).toMatchObject({ ok: true, value: { status: 'done', decision: 'accept' } })
    expect(returned).toMatchObject({
      ok: false,
      error: {
        code: 'conflict',
        expectedRevision: task.revision,
      },
    })
    expect(currentTask(ctx, task.id).status).toBe('done')

    const results = ctx.workValidation.listResults(task.id, generation)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ source: 'user', outcome: 'passed', validatorIndex: 0 })
    await ctx.fiber.dispose()
  })
})
