import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService, { type TaskPriority, type TaskWorkItem } from '../../../src/internal/control/index.ts'
import WorkExecutionService from '../../../src/internal/execution/index.ts'
import WorkNodeRegistry from '../../../src/internal/node/index.ts'
import WorkEnvironmentRegistry, { type WorkEnvironment } from '../../../src/internal/environment/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkOrchestrator, { WorkOrchestratorError, WorkOrchestratorPartialStartError } from '../../../src/internal/orchestrator/index.ts'

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
  const enqueueExecute = vi.fn(async (threadRef: { id: string }) => ({ id: `cmd-${threadRef.id}` }))
  ctx.provide('workNodeGateway', { enqueueExecute } as never)
  await ctx.plugin(WorkOrchestrator)
  return { ctx, enqueueExecute }
}

async function task(ctx: Context, priority: TaskPriority = 'p2'): Promise<TaskWorkItem> {
  const idea = await ctx.workControl.createIdea({ title: `task-${priority}` })
  const promoted = await ctx.workControl.promoteIdea(
    { id: idea.id, revision: idea.revision },
    { priority },
  )
  return await ctx.workControl.organizeTask(
    { id: promoted.id, revision: promoted.revision },
    {
      taskType: 'custom',
      workflow: { version: 1, stages: [{ id: 'run', title: 'Run', kind: 'implementation' }] },
      validationPolicy: { version: 1, validators: [] },
    },
  )
}

async function environment(
  ctx: Context,
  name: string,
  path: string,
  providers: readonly string[] = ['codex'],
  worktree?: string,
): Promise<WorkEnvironment> {
  const node = await ctx.workNodes.registerNode({
    name: `node-${name}`,
    protocolVersion: 1,
    runnerProviders: providers,
    features: ['execute', 'environment-report'],
  })
  return await ctx.workEnvironments.registerEnvironment({
    nodeId: node.id,
    name,
    state: 'ready',
    snapshot: {
      workspace: { path, ...(worktree === undefined ? {} : { worktree }) },
      runtime: { os: 'linux', arch: 'x64', versions: { node: '22' } },
      services: [],
      devices: [],
      capabilities: [],
      secretRefs: [],
    },
  })
}

describe('WorkOrchestrator', () => {
  it('queues one isolated one-shot placement for a normal Task', async () => {
    const { ctx, enqueueExecute } = await harness()
    const current = await task(ctx)
    const env = await environment(ctx, 'main', '/repo/main')

    const result = await ctx.workOrchestrator.startTask({
      taskId: current.id,
      taskRevision: current.revision,
      placements: [{ environmentId: env.id, environmentRevision: env.revision, provider: 'codex', role: '修复主问题并运行测试' }],
    })

    expect(result.started).toHaveLength(1)
    const [thread] = ctx.workExecution.list(current.id)
    expect(thread).toMatchObject({ state: 'idle', taskId: current.id })
    expect(ctx.workEnvironments.getBinding(thread!.id)).toMatchObject({ environmentId: env.id, environmentRevision: env.revision })
    expect(enqueueExecute).toHaveBeenCalledWith(
      { id: thread!.id, revision: thread!.revision },
      'codex',
      'one-shot',
      { nextStep: '修复主问题并运行测试' },
    )
    await ctx.fiber.dispose()
  })

  it('fans out a P0 Task across distinct isolated worktrees', async () => {
    const { ctx, enqueueExecute } = await harness()
    const current = await task(ctx, 'p0')
    const first = await environment(ctx, 'first', '/repo', ['codex'], '/repo/.worktrees/a')
    const second = await environment(ctx, 'second', '/repo', ['claude-code'], '/repo/.worktrees/b')

    const result = await ctx.workOrchestrator.startTask({
      taskId: current.id,
      taskRevision: current.revision,
      placements: [
        { environmentId: first.id, environmentRevision: first.revision, provider: 'codex', role: '分析代码并实现候选修复' },
        { environmentId: second.id, environmentRevision: second.revision, provider: 'claude-code', role: '独立复核并验证失败路径' },
      ],
    })

    expect(result.started).toHaveLength(2)
    expect(ctx.workExecution.list(current.id)).toHaveLength(2)
    expect(enqueueExecute).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('rejects multi-runner fan-out for P1/P2 and rejects duplicate isolation keys before writing Threads', async () => {
    const { ctx } = await harness()
    const normal = await task(ctx, 'p1')
    const a = await environment(ctx, 'a', '/a')
    const b = await environment(ctx, 'b', '/b')
    await expect(ctx.workOrchestrator.startTask({
      taskId: normal.id,
      taskRevision: normal.revision,
      placements: [
        { environmentId: a.id, environmentRevision: a.revision, provider: 'codex', role: 'A' },
        { environmentId: b.id, environmentRevision: b.revision, provider: 'codex', role: 'B' },
      ],
    })).rejects.toThrow(/exactly one execution placement/)
    expect(ctx.workExecution.list(normal.id)).toHaveLength(0)

    const p0 = await task(ctx, 'p0')
    const sharedNode = await ctx.workNodes.registerNode({
      name: 'shared-node', protocolVersion: 1, runnerProviders: ['codex'], features: ['execute', 'environment-report'],
    })
    const makeShared = async (name: string) => await ctx.workEnvironments.registerEnvironment({
      nodeId: sharedNode.id,
      name,
      snapshot: {
        workspace: { path: '/same/repo' },
        runtime: { os: 'linux', arch: 'x64', versions: {} },
        services: [], devices: [], capabilities: [], secretRefs: [],
      },
    })
    const sharedA = await makeShared('shared-a')
    const sharedB = await makeShared('shared-b')
    await expect(ctx.workOrchestrator.startTask({
      taskId: p0.id,
      taskRevision: p0.revision,
      placements: [
        { environmentId: sharedA.id, environmentRevision: sharedA.revision, provider: 'codex', role: 'A' },
        { environmentId: sharedB.id, environmentRevision: sharedB.revision, provider: 'codex', role: 'B' },
      ],
    })).rejects.toThrow(/distinct workspace\/worktree/)
    expect(ctx.workExecution.list(p0.id)).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('rejects a workspace already leased by another active Thread', async () => {
    const { ctx } = await harness()
    const env = await environment(ctx, 'leased', '/repo/leased')
    const owner = await task(ctx)
    const leasedThread = await ctx.workExecution.createThread({ taskId: owner.id })
    await ctx.workEnvironments.bindThread(
      { id: leasedThread.id, revision: leasedThread.revision },
      { id: env.id, revision: env.revision },
    )

    const contender = await task(ctx)
    await expect(ctx.workOrchestrator.startTask({
      taskId: contender.id,
      taskRevision: contender.revision,
      placements: [{ environmentId: env.id, environmentRevision: env.revision, provider: 'codex', role: 'Do work' }],
    })).rejects.toThrow(/already leased/)
    expect(ctx.workExecution.list(contender.id)).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('cancels an unpublished Thread when gateway queueing fails and reports partial fan-out truthfully', async () => {
    const first = await harness()
    const firstTask = await task(first.ctx)
    const firstEnv = await environment(first.ctx, 'fail', '/repo/fail')
    first.enqueueExecute.mockRejectedValueOnce(new Error('gateway unavailable'))
    await expect(first.ctx.workOrchestrator.startTask({
      taskId: firstTask.id,
      taskRevision: firstTask.revision,
      placements: [{ environmentId: firstEnv.id, environmentRevision: firstEnv.revision, provider: 'codex', role: 'Run' }],
    })).rejects.toThrow(WorkOrchestratorError)
    expect(first.ctx.workExecution.list(firstTask.id)).toHaveLength(1)
    expect(first.ctx.workExecution.list(firstTask.id)[0]!.state).toBe('cancelled')
    await first.ctx.fiber.dispose()

    const partial = await harness()
    const p0 = await task(partial.ctx, 'p0')
    const envA = await environment(partial.ctx, 'partial-a', '/repo/a')
    const envB = await environment(partial.ctx, 'partial-b', '/repo/b')
    partial.enqueueExecute.mockResolvedValueOnce({ id: 'cmd-ok' }).mockRejectedValueOnce(new Error('second failed'))
    const error = await partial.ctx.workOrchestrator.startTask({
      taskId: p0.id,
      taskRevision: p0.revision,
      placements: [
        { environmentId: envA.id, environmentRevision: envA.revision, provider: 'codex', role: 'A' },
        { environmentId: envB.id, environmentRevision: envB.revision, provider: 'codex', role: 'B' },
      ],
    }).then(() => undefined, value => value)
    expect(error).toBeInstanceOf(WorkOrchestratorPartialStartError)
    expect((error as WorkOrchestratorPartialStartError).started).toHaveLength(1)
    expect(ctxStates(partial.ctx, p0)).toEqual(['cancelled', 'idle'].sort())
    await partial.ctx.fiber.dispose()
  })
})

function ctxStates(ctx: Context, task: TaskWorkItem): string[] {
  return ctx.workExecution.list(task.id).map(thread => thread.state).sort()
}
