import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService from '@deepseek-ai/dsh-work-control'
import WorkExecutionService from '@deepseek-ai/dsh-work-execution'
import WorkEnvironmentRegistry from '@deepseek-ai/dsh-work-environment'
import WorkNodeRegistry from '@deepseek-ai/dsh-work-node'
import WorkOrchestrator from '@deepseek-ai/dsh-work-orchestrator'
import WorkValidationService from '@deepseek-ai/dsh-work-validation'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkConsoleGateway from '../src/index.ts'

async function harness(options: { orchestrator?: boolean; gateway?: boolean } = {}) {
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

  const enqueueExecute = vi.fn(async (threadRef: { id: string }) => ({ id: `cmd-${threadRef.id}` }))
  if (options.gateway === true) ctx.provide('workNodeGateway', { enqueueExecute } as never)
  if (options.orchestrator === true) await ctx.plugin(WorkOrchestrator)
  await ctx.plugin(WorkConsoleGateway)
  return { ctx, enqueueExecute }
}

async function organizedTask(ctx: Context, priority: 'p0' | 'p1' | 'p2' = 'p2') {
  const idea = await ctx.workControl.createIdea({ title: `execution-${priority}` })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority })
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'bug-fix',
    workflow: { version: 1, stages: [{ id: 'fix', title: 'Fix', kind: 'implementation' }] },
    validationPolicy: { version: 1, validators: [] },
  })
}

async function readyEnvironment(ctx: Context, path = '/repo/main') {
  const node = await ctx.workNodes.registerNode({
    name: 'worker',
    protocolVersion: 1,
    runnerProviders: ['codex'],
    features: ['execute', 'environment-report'],
  })
  return await ctx.workEnvironments.registerEnvironment({
    nodeId: node.id,
    name: 'main',
    snapshot: {
      workspace: { path },
      runtime: { os: 'linux', arch: 'x64', versions: {} },
      services: [],
      devices: [],
      capabilities: [],
      secretRefs: [],
    },
  })
}

describe('WorkConsole execution plan boundary', () => {
  it('keeps the legacy console usable when orchestration is not mounted', async () => {
    const { ctx } = await harness()
    const task = await organizedTask(ctx)

    expect(ctx.workConsole.executionPlan(String(task.id))).toEqual({
      dispatchAvailable: false,
      candidates: [],
    })
    await expect(ctx.workConsole.startExecution({
      taskId: String(task.id),
      taskRevision: task.revision,
      placements: [],
    })).resolves.toEqual({
      ok: false,
      error: { code: 'execution-unavailable', reason: 'work orchestrator is not configured' },
    })
    await ctx.fiber.dispose()
  })

  it('projects exact candidates and queues one explicit placement through the orchestrator', async () => {
    const { ctx, enqueueExecute } = await harness({ orchestrator: true, gateway: true })
    const task = await organizedTask(ctx)
    const environment = await readyEnvironment(ctx)

    const plan = ctx.workConsole.executionPlan(String(task.id))
    expect(plan).toMatchObject({
      dispatchAvailable: true,
      candidates: [{
        environmentId: String(environment.id),
        environmentRevision: environment.revision,
        providers: ['codex'],
        available: true,
      }],
    })

    const result = await ctx.workConsole.startExecution({
      taskId: String(task.id),
      taskRevision: task.revision,
      placements: [{
        environmentId: String(environment.id),
        environmentRevision: environment.revision,
        provider: 'codex',
        role: '修复并运行验证',
      }],
    })
    expect(result).toMatchObject({ ok: true, value: { taskId: String(task.id), started: [{ provider: 'codex', role: '修复并运行验证' }] } })
    expect(ctx.workExecution.list(task.id)).toHaveLength(1)
    expect(enqueueExecute).toHaveBeenCalledOnce()
    expect(ctx.workConsole.executionPlan(String(task.id))).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('does not expose a fresh execution plan for organizing or already-active work', async () => {
    const { ctx } = await harness({ orchestrator: true })
    const idea = await ctx.workControl.createIdea({ title: 'organizing' })
    const organizing = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority: 'p2' })
    expect(ctx.workConsole.executionPlan(String(organizing.id))).toBeUndefined()

    const task = await organizedTask(ctx)
    await readyEnvironment(ctx)
    await ctx.workExecution.createThread({ taskId: task.id })
    expect(ctx.workConsole.executionPlan(String(task.id))).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
