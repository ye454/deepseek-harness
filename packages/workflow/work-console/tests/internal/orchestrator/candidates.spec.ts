import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService from '@deepseek-ai/dsh-work-control'
import WorkExecutionService from '@deepseek-ai/dsh-work-execution'
import WorkNodeRegistry from '@deepseek-ai/dsh-work-node'
import WorkEnvironmentRegistry from '@deepseek-ai/dsh-work-environment'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkOrchestrator from '../src/index.ts'

async function harness(dispatch: boolean) {
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
  const enqueueExecute = vi.fn(async () => ({ id: 'cmd-1' }))
  if (dispatch) ctx.provide('workNodeGateway', { enqueueExecute } as never)
  await ctx.plugin(WorkOrchestrator)
  return { ctx, enqueueExecute }
}

async function runnableTask(ctx: Context) {
  const idea = await ctx.workControl.createIdea({ title: 'candidate task' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'custom',
    workflow: { version: 1, stages: [{ id: 'run', title: 'Run', kind: 'implementation' }] },
    validationPolicy: { version: 1, validators: [] },
  })
}

async function readyEnvironment(ctx: Context) {
  const node = await ctx.workNodes.registerNode({
    name: 'worker-1',
    protocolVersion: 1,
    runnerProviders: ['codex', 'claude-code'],
    features: ['execute', 'environment-report'],
  })
  return await ctx.workEnvironments.registerEnvironment({
    nodeId: node.id,
    name: 'repo worktree',
    snapshot: {
      workspace: {
        path: '/repo',
        worktree: '/repo/.worktrees/task-a',
        repository: 'git@example/repo.git',
        branch: 'work/task-a',
        dirty: false,
      },
      runtime: { os: 'linux', arch: 'x64', versions: {} },
      services: [], devices: [], capabilities: [], secretRefs: [],
    },
  })
}

describe('WorkOrchestrator candidates', () => {
  it('reports compatible zero-token candidates independently from dispatch configuration', async () => {
    const { ctx } = await harness(false)
    const env = await readyEnvironment(ctx)
    expect(ctx.workOrchestrator.listCandidates()).toEqual({
      dispatchAvailable: false,
      candidates: [{
        environmentId: env.id,
        environmentRevision: env.revision,
        environmentName: 'repo worktree',
        nodeId: env.nodeId,
        nodeName: 'worker-1',
        providers: ['claude-code', 'codex'],
        workspace: {
          path: '/repo',
          worktree: '/repo/.worktrees/task-a',
          repository: 'git@example/repo.git',
          branch: 'work/task-a',
          dirty: false,
        },
        available: true,
        issues: [],
      }],
    })
    await ctx.fiber.dispose()
  })

  it('marks a nonterminal Thread workspace lease unavailable', async () => {
    const { ctx } = await harness(true)
    const env = await readyEnvironment(ctx)
    const task = await runnableTask(ctx)
    const thread = await ctx.workExecution.createThread({ taskId: task.id })
    await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: env.id, revision: env.revision },
    )

    const snapshot = ctx.workOrchestrator.listCandidates()
    expect(snapshot.dispatchAvailable).toBe(true)
    expect(snapshot.candidates[0]).toMatchObject({
      environmentId: env.id,
      available: false,
      leasedByThreadId: thread.id,
      issues: ['workspace-leased'],
    })
    await ctx.fiber.dispose()
  })

  it('refuses dispatch cleanly when no gateway is configured and creates no Thread', async () => {
    const { ctx } = await harness(false)
    const env = await readyEnvironment(ctx)
    const task = await runnableTask(ctx)
    await expect(ctx.workOrchestrator.startTask({
      taskId: task.id,
      taskRevision: task.revision,
      placements: [{
        environmentId: env.id,
        environmentRevision: env.revision,
        provider: 'codex',
        role: '实施修复',
      }],
    })).rejects.toThrow(/gateway is not configured/)
    expect(ctx.workExecution.list(task.id)).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
