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

describe('WorkConsole passive ideas', () => {
  it('projects Idea cards without creating executable task facts', async () => {
    const ctx = await harness()
    const idea = await ctx.workControl.createIdea({
      title: 'RAG new indexing idea',
      summary: 'Keep this passive until the user promotes it.',
      tags: ['rag', 'index'],
    })

    const snapshot = ctx.workConsole.snapshot()
    expect(snapshot.ideas).toEqual([{
      id: String(idea.id),
      revision: idea.revision,
      title: idea.title,
      summary: idea.summary,
      tags: ['rag', 'index'],
      createdAt: idea.createdAt,
      updatedAt: idea.updatedAt,
    }])
    expect(snapshot.tasks).toEqual([])
    expect(ctx.workExecution.list()).toEqual([])
    await ctx.fiber.dispose()
  })
})
