import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService from '@deepseek-ai/dsh-work-control'
import WorkExecutionService, { type ExecutionThread } from '@deepseek-ai/dsh-work-execution'
import WorkEnvironmentRegistry from '@deepseek-ai/dsh-work-environment'
import WorkNodeRegistry from '@deepseek-ai/dsh-work-node'
import WorkOrchestrator from '@deepseek-ai/dsh-work-orchestrator'
import WorkValidationService from '@deepseek-ai/dsh-work-validation'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkExecutionCoordinator from '../src/index.ts'

function environmentSnapshot(path: string, commit = 'a1') {
  return {
    workspace: { path, repository: 'https://example.invalid/work.git', branch: 'feature/work', commit, dirty: false },
    runtime: { os: 'ubuntu-22.04', arch: 'x64', shell: 'bash', versions: { node: '24.0.0' } },
    services: [],
    devices: [],
    capabilities: ['git'],
    secretRefs: [],
  }
}

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
  await ctx.plugin(WorkOrchestrator)

  const commands: Array<Record<string, unknown>> = []
  const enqueueExecute = vi.fn(async (threadRef: { id: string; revision: number }, runnerProvider: string, mode: string, handoff: unknown) => {
    const binding = ctx.workEnvironments.getBinding(threadRef.id as never)!
    const command = {
      id: `cmd-${commands.length + 1}`,
      nodeId: binding.nodeId,
      kind: 'execute',
      state: 'queued',
      payload: { threadId: threadRef.id, threadRevision: threadRef.revision, runnerProvider, mode },
      handoff,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    commands.push(command)
    return command
  })
  const enqueueResume = vi.fn(async (threadRef: { id: string; revision: number }, runnerProvider: string, handoff: unknown) => {
    const binding = ctx.workEnvironments.getBinding(threadRef.id as never)!
    const command = {
      id: `cmd-${commands.length + 1}`,
      nodeId: binding.nodeId,
      kind: 'resume',
      state: 'queued',
      payload: { threadId: threadRef.id, threadRevision: threadRef.revision, runnerProvider, mode: 'continuable' },
      handoff,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    commands.push(command)
    return command
  })
  ctx.provide('workNodeGateway', {
    listCommands: () => [...commands],
    enqueueExecute,
    enqueueResume,
  } as never)

  const node = await ctx.workNodes.registerNode({
    name: 'worker',
    protocolVersion: 1,
    runnerProviders: ['codex'],
    features: ['execute', 'environment-report'],
  })
  const firstEnvironment = await ctx.workEnvironments.registerEnvironment({
    nodeId: node.id,
    name: 'worktree-a',
    snapshot: environmentSnapshot('/workspace/a'),
  })
  const secondEnvironment = await ctx.workEnvironments.registerEnvironment({
    nodeId: node.id,
    name: 'worktree-b',
    snapshot: environmentSnapshot('/workspace/b'),
  })

  return { ctx, commands, enqueueExecute, enqueueResume, firstEnvironment, secondEnvironment }
}

async function task(ctx: Context, priority: 'p0' | 'p1' = 'p1') {
  const idea = await ctx.workControl.createIdea({ title: 'Continuous task' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority })
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'feature',
    workflow: {
      version: 1,
      stages: [
        { id: 'design', title: 'Design', kind: 'design' },
        { id: 'implementation', title: 'Implementation', kind: 'implementation' },
        { id: 'validation', title: 'Validation', kind: 'validation' },
      ],
    },
    validationPolicy: {
      version: 1,
      validators: [{ kind: 'user-acceptance', requirement: 'required', label: 'Human accepts' }],
    },
  })
}

async function completedThread(
  ctx: Context,
  taskId: Parameters<Context['workExecution']['createThread']>[0]['taskId'],
  environment: { id: Parameters<Context['workEnvironments']['bindThread']>[1]['id']; revision: number },
  stopReason: 'completed' | 'failed' = 'completed',
): Promise<ExecutionThread> {
  const created = await ctx.workExecution.createThread({ taskId })
  await ctx.workEnvironments.bindThread(
    { id: created.id, revision: created.revision },
    { id: environment.id, revision: environment.revision },
  )
  const running = await ctx.workExecution.beginAttempt(
    { id: created.id, revision: created.revision },
    { provider: 'codex', mode: 'one-shot' },
  )
  expect(running.activeAttempt?.stageId).toBe('design')
  return await ctx.workExecution.settleAttempt(
    { id: running.id, revision: running.revision },
    { stopReason },
  )
}

describe('WorkExecutionCoordinator', () => {
  it('converges successful P0 fan-out, advances the Stage, rebinds refreshed Environment, and queues one primary continuation', async () => {
    const { ctx, commands, enqueueExecute, firstEnvironment, secondEnvironment } = await harness()
    const work = await task(ctx, 'p0')
    await completedThread(ctx, work.id, firstEnvironment)
    await completedThread(ctx, work.id, secondEnvironment)

    const refreshedA = await ctx.workEnvironments.refreshEnvironment(
      { id: firstEnvironment.id, revision: firstEnvironment.revision },
      { snapshot: environmentSnapshot('/workspace/a', 'after-design') },
    )
    const refreshedB = await ctx.workEnvironments.refreshEnvironment(
      { id: secondEnvironment.id, revision: secondEnvironment.revision },
      { snapshot: environmentSnapshot('/workspace/b', 'after-design') },
    )

    await ctx.plugin(WorkExecutionCoordinator)
    await vi.waitFor(() => {
      expect(ctx.workControl.get(work.id)).toMatchObject({ status: 'running', currentStageId: 'implementation' })
      expect(commands).toHaveLength(1)
    })

    const live = ctx.workExecution.list(work.id).filter(thread => thread.state !== 'closed' && thread.state !== 'cancelled')
    expect(live).toHaveLength(1)
    expect(live[0]?.lastAttempt).toMatchObject({ stageId: 'design', stopReason: 'completed' })
    const binding = ctx.workEnvironments.getBinding(live[0]!.id)!
    const currentEnvironment = ctx.workEnvironments.get(binding.environmentId)!
    expect(binding.environmentRevision).toBe(currentEnvironment.revision)
    expect([refreshedA.revision, refreshedB.revision]).toContain(binding.environmentRevision)
    expect(enqueueExecute).toHaveBeenCalledOnce()
  })

  it('continues the primary through the next Stage and enters a fresh Validation generation without treating Runner completion as acceptance', async () => {
    const { ctx, commands, firstEnvironment } = await harness()
    const work = await task(ctx)
    const first = await completedThread(ctx, work.id, firstEnvironment)
    await ctx.plugin(WorkExecutionCoordinator)
    await vi.waitFor(() => { expect(commands).toHaveLength(1) })

    const primary = ctx.workExecution.get(first.id)!
    const implementation = await ctx.workExecution.beginAttempt(
      { id: primary.id, revision: primary.revision },
      { provider: 'codex', mode: 'one-shot' },
    )
    expect(implementation.activeAttempt?.stageId).toBe('implementation')
    await ctx.workExecution.settleAttempt(
      { id: implementation.id, revision: implementation.revision },
      { stopReason: 'completed' },
    )

    await vi.waitFor(() => {
      expect(ctx.workControl.get(work.id)).toMatchObject({ status: 'validation', currentStageId: 'validation' })
    })
    expect(ctx.workValidation.getSession(work.id)?.generation).toBe(1)
    expect(ctx.workValidation.listResults(work.id)).toEqual([])
    expect(ctx.workExecution.list(work.id).filter(thread => thread.state !== 'closed' && thread.state !== 'cancelled')).toEqual([])
  })

  it('blocks on a failed Runner result instead of advancing the workflow', async () => {
    const { ctx, commands, firstEnvironment } = await harness()
    const work = await task(ctx)
    const failed = await completedThread(ctx, work.id, firstEnvironment, 'failed')
    await ctx.plugin(WorkExecutionCoordinator)

    await vi.waitFor(() => {
      expect(ctx.workControl.get(work.id)).toMatchObject({ status: 'blocked', currentStageId: 'design' })
    })
    expect(ctx.workExecution.get(failed.id)).toMatchObject({ state: 'blocked' })
    expect(commands).toEqual([])
  })

  it('reuses an already-open queued continuation after restart instead of dispatching a duplicate command', async () => {
    const { ctx, commands, enqueueExecute, firstEnvironment } = await harness()
    const work = await task(ctx)
    const settled = await completedThread(ctx, work.id, firstEnvironment)
    const advanced = await ctx.workControl.setStage({ id: work.id, revision: work.revision }, 'implementation')
    commands.push({
      id: 'cmd-existing',
      kind: 'execute',
      state: 'queued',
      payload: { threadId: settled.id, threadRevision: settled.revision, runnerProvider: 'codex', mode: 'one-shot' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await ctx.plugin(WorkExecutionCoordinator)
    const result = await ctx.workExecutionCoordinator.reconcile(advanced.id)
    expect(result).toMatchObject({
      state: 'continued',
      stageId: 'implementation',
      continuation: { commandId: 'cmd-existing', alreadyQueued: true },
    })
    expect(enqueueExecute).not.toHaveBeenCalled()
    expect(commands).toHaveLength(1)
  })

  it('turns a durable remote command rejection into a blocked Task and Thread', async () => {
    const { ctx, firstEnvironment } = await harness()
    const work = await task(ctx)
    const created = await ctx.workExecution.createThread({ taskId: work.id })
    await ctx.workEnvironments.bindThread(
      { id: created.id, revision: created.revision },
      { id: firstEnvironment.id, revision: firstEnvironment.revision },
    )
    await ctx.plugin(WorkExecutionCoordinator)

    ctx.emit('work-node-gateway/command-changed', {
      command: {
        id: 'rejected-command' as never,
        nodeId: firstEnvironment.nodeId,
        kind: 'execute',
        state: 'rejected',
        payload: {
          threadId: created.id,
          threadRevision: created.revision,
          environmentId: firstEnvironment.id,
          environmentRevision: firstEnvironment.revision,
          environmentKey: 'env',
          runnerProvider: 'codex',
          mode: 'one-shot',
          prompt: 'bounded',
          promptBytes: 7,
        },
        failureCode: 'REMOTE_REJECTED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })

    await vi.waitFor(() => {
      expect(ctx.workControl.get(work.id)).toMatchObject({ status: 'blocked' })
      expect(ctx.workExecution.get(created.id)).toMatchObject({ state: 'blocked' })
    })
  })
})
