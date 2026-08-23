import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService, { type TaskPriority, type ValidatorSpec } from '../src/internal/control/index.ts'
import WorkExecutionService from '../src/internal/execution/index.ts'
import WorkEnvironmentRegistry, { type WorkEnvironmentSnapshot } from '../src/internal/environment/index.ts'
import WorkNodeRegistry from '../src/internal/node/index.ts'
import WorkValidationService from '../src/internal/validation/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkConsoleGateway from '../src/index.ts'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

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

async function promote(ctx: Context, title: string, priority: TaskPriority = 'p2') {
  const idea = await ctx.workControl.createIdea({ title })
  return await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority })
}

async function organize(
  ctx: Context,
  title: string,
  priority: TaskPriority = 'p2',
  validators: readonly ValidatorSpec[] = [],
) {
  const promoted = await promote(ctx, title, priority)
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'bug-fix',
    workflow: {
      version: 1,
      stages: [
        { id: 'fix', title: 'Fix', kind: 'implementation' },
        { id: 'validate', title: 'Validate', kind: 'validation' },
      ],
    },
    validationPolicy: { version: 1, validators },
  })
}

function runtimeSnapshot(full = false): WorkEnvironmentSnapshot {
  return {
    workspace: full
      ? { path: '/work/full', repository: 'https://example.invalid/repo.git', branch: 'main', commit: 'abc', dirty: false }
      : { path: '/work/minimal' },
    runtime: { os: 'linux', arch: 'x64', versions: {} },
    services: [],
    devices: [],
    capabilities: [],
    secretRefs: [],
  }
}

async function node(ctx: Context, name: string, runnerProviders: readonly string[]) {
  return await ctx.workNodes.registerNode({
    name,
    protocolVersion: 1,
    runnerProviders,
    features: ['execute', 'environment-report'],
  })
}

describe('WorkConsoleGateway host branch matrix', () => {
  it('projects organizing, blocked, done, settled, closed and cancelled execution facts truthfully', async () => {
    const ctx = await harness()
    const organizing = await promote(ctx, 'Organizing', 'p2')

    let blockedTask = await organize(ctx, 'Blocked', 'p1')
    let blockedThread = await ctx.workExecution.createThread({ taskId: blockedTask.id })
    blockedThread = await ctx.workExecution.blockThread(
      { id: blockedThread.id, revision: blockedThread.revision },
      'waiting for device',
    )
    blockedTask = await ctx.workControl.setStatus({ id: blockedTask.id, revision: blockedTask.revision }, 'blocked')

    const settledTask = await organize(ctx, 'Settled', 'p1')
    let settledThread = await ctx.workExecution.createThread({ taskId: settledTask.id })
    settledThread = await ctx.workExecution.beginAttempt(
      { id: settledThread.id, revision: settledThread.revision },
      { provider: 'claude-code', mode: 'continuable', subagentSessionId: 'native-session' as SessionId },
    )
    settledThread = await ctx.workExecution.settleAttempt(
      { id: settledThread.id, revision: settledThread.revision },
      { stopReason: 'failed' },
    )

    const filteredTask = await organize(ctx, 'Filtered threads', 'p2')
    let closed = await ctx.workExecution.createThread({ taskId: filteredTask.id })
    closed = await ctx.workExecution.closeThread({ id: closed.id, revision: closed.revision })
    let cancelled = await ctx.workExecution.createThread({ taskId: filteredTask.id })
    cancelled = await ctx.workExecution.cancelThread({ id: cancelled.id, revision: cancelled.revision })
    expect(closed.state).toBe('closed')
    expect(cancelled.state).toBe('cancelled')

    let done = await organize(ctx, 'Done', 'p2')
    done = await ctx.workControl.setStatus({ id: done.id, revision: done.revision }, 'done')

    const board = ctx.workConsole.snapshot()
    expect(board.tasks.find(card => card.id === String(organizing.id))).toMatchObject({
      status: 'unclaimed',
      execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
    })
    expect(board.tasks.find(card => card.id === String(blockedTask.id))).toMatchObject({
      status: 'blocked',
      execution: { threadCount: 1, blockedThreadCount: 1 },
    })
    expect(board.tasks.find(card => card.id === String(settledTask.id))).toMatchObject({
      execution: {
        provider: 'claude-code',
        mode: 'continuable',
        lastStopReason: 'failed',
        runningThreadCount: 0,
      },
    })
    expect(board.tasks.find(card => card.id === String(filteredTask.id))?.execution.threadCount).toBe(0)
    expect(board.tasks.find(card => card.id === String(done.id))?.status).toBe('done')

    const settledDetail = ctx.workConsole.task(String(settledTask.id))
    expect(settledDetail?.threads[0]?.lastAttempt).toMatchObject({
      provider: 'claude-code',
      mode: 'continuable',
      stopReason: 'failed',
      nativeSessionId: 'native-session',
    })
    expect(settledDetail?.threads[0]?.lastAttempt?.finishedAt).toBeTypeOf('string')
    expect(settledDetail?.threads[0]?.blocker).toBeUndefined()
    expect(ctx.workConsole.task('missing-work-item')).toBeNull()
    const idea = await ctx.workControl.createIdea({ title: 'Idea only' })
    expect(ctx.workConsole.task(String(idea.id))).toBeNull()
    await ctx.fiber.dispose()
  })

  it('aggregates shared Runner capacity across online, degraded and offline Nodes and all Environment states', async () => {
    const ctx = await harness()
    const online = await node(ctx, 'Online', ['shared', 'online-only'])
    let degraded = await node(ctx, 'Degraded', ['shared'])
    let offline = await node(ctx, 'Offline', ['offline-only'])

    degraded = await ctx.workNodes.refreshNode(
      { id: degraded.id, revision: degraded.revision },
      {
        state: 'degraded',
        degradedReason: 'high load',
        protocolVersion: 1,
        runnerProviders: ['shared'],
        features: ['execute', 'environment-report'],
      },
    )
    offline = await ctx.workNodes.markOffline({ id: offline.id, revision: offline.revision })

    await ctx.workEnvironments.registerEnvironment({
      nodeId: online.id,
      name: 'Ready Env',
      snapshot: runtimeSnapshot(),
    })
    await ctx.workEnvironments.registerEnvironment({
      nodeId: online.id,
      name: 'Degraded Env',
      state: 'degraded',
      degradedReason: 'service unhealthy',
      snapshot: runtimeSnapshot(),
    })
    await ctx.workEnvironments.registerEnvironment({
      nodeId: degraded.id,
      name: 'Unavailable Env',
      state: 'unavailable',
      degradedReason: 'device missing',
      snapshot: runtimeSnapshot(),
    })

    const resources = ctx.workConsole.snapshot().resources
    expect(resources.nodes).toEqual({ total: 3, online: 1, degraded: 1, offline: 1 })
    expect(resources.environments).toEqual({ total: 3, ready: 1, degraded: 1, unavailable: 1 })
    expect(resources.runners).toContainEqual({ provider: 'shared', nodeCount: 2, onlineNodeCount: 1 })
    expect(resources.runners).toContainEqual({ provider: 'offline-only', nodeCount: 1, onlineNodeCount: 0 })
    expect(offline.state).toBe('offline')
    await ctx.fiber.dispose()
  })

  it('projects minimal Environment fields, explicit user actor, advisory gates and validation without a session', async () => {
    const ctx = await harness()
    const validators: readonly ValidatorSpec[] = [
      { kind: 'user-acceptance', requirement: 'required', label: 'Required human' },
      { kind: 'user-acceptance', requirement: 'advisory', label: 'Advisory human' },
      { kind: 'smoke-test', requirement: 'optional', label: 'Optional smoke' },
    ]
    const task = await organize(ctx, 'Human validation', 'p1', validators)
    const worker = await node(ctx, 'Worker', ['codex'])
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: worker.id,
      name: 'Minimal Env',
      snapshot: runtimeSnapshot(),
    })
    const thread = await ctx.workExecution.createThread({ taskId: task.id })
    await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: environment.id, revision: environment.revision },
    )

    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    await ctx.workValidation.recordUserAcceptance({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'passed',
      actor: 'local-user',
      evidence: [{ kind: 'artifact', label: 'human decision', reference: 'acceptance:1' }],
    })
    const current = ctx.workControl.get(task.id)
    if (current?.kind !== 'task') throw new Error('expected organized task')
    expect(current.validation?.state).toBe('passed')
    expect(current.validation?.checkedAt).toBeTypeOf('string')

    const detail = ctx.workConsole.task(String(task.id))
    expect(detail?.environments[0]).toEqual({
      id: String(environment.id),
      revision: environment.revision,
      name: 'Minimal Env',
      state: 'ready',
      workspace: { path: '/work/minimal' },
      runtime: { os: 'linux', arch: 'x64', versions: {} },
      devices: [],
      capabilities: [],
    })
    expect(detail?.validators[0]).toMatchObject({
      outcome: 'passed',
      source: 'user',
      actor: 'local-user',
      evidence: [{ reference: 'acceptance:1' }],
    })
    expect(detail?.validators[1]).toMatchObject({ requirement: 'advisory', evidence: [] })
    expect(detail?.validators[2]).toMatchObject({ requirement: 'optional', evidence: [] })
    expect(ctx.workConsole.snapshot().pending.pendingUserAcceptance).toBe(0)
    expect(ctx.workConsole.snapshot().tasks.find(card => card.id === String(task.id))?.validation?.checkedAt).toBeTypeOf('string')

    let noSession = await organize(ctx, 'Validation without generation', 'p2', [
      { kind: 'user-acceptance', requirement: 'required', label: 'Pending human' },
    ])
    noSession = await ctx.workControl.setStatus({ id: noSession.id, revision: noSession.revision }, 'validation')
    expect(ctx.workConsole.snapshot().pending.pendingUserAcceptance).toBe(1)
    expect(ctx.workConsole.task(String(noSession.id))?.validationGeneration).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('projects missing bound Node/Environment defensively without corrupting durable bindings', async () => {
    const ctx = await harness()
    const task = await organize(ctx, 'Defensive placement', 'p1')
    const worker = await node(ctx, 'Worker', ['codex'])
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: worker.id,
      name: 'Runtime',
      snapshot: runtimeSnapshot(true),
    })
    const thread = await ctx.workExecution.createThread({ taskId: task.id })
    await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: environment.id, revision: environment.revision },
    )

    const environmentGet = vi.spyOn(ctx.workEnvironments, 'get').mockReturnValue(undefined)
    const missingEnvironment = ctx.workConsole.task(String(task.id))
    expect(missingEnvironment?.card.placement).toMatchObject({
      nodeName: 'Worker',
      environmentId: String(environment.id),
      stale: true,
    })
    expect(missingEnvironment?.card.placement?.environmentName).toBeUndefined()
    expect(missingEnvironment?.environments).toEqual([])
    environmentGet.mockRestore()

    const nodeGet = vi.spyOn(ctx.workNodes, 'get').mockReturnValue(undefined)
    const missingNode = ctx.workConsole.task(String(task.id))
    expect(missingNode?.card.placement).toMatchObject({
      environmentName: 'Runtime',
      environmentState: 'ready',
      stale: false,
    })
    expect(missingNode?.card.placement?.nodeName).toBeUndefined()
    nodeGet.mockRestore()
    await ctx.fiber.dispose()
  })

  it('sorts equal-priority cards by update time and then title when timestamps tie', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T03:00:00.000Z'))
    const ctx = await harness()
    await organize(ctx, 'Old', 'p1')

    vi.setSystemTime(new Date('2026-08-17T03:00:01.000Z'))
    await organize(ctx, 'Beta', 'p1')
    await organize(ctx, 'Alpha', 'p1')

    expect(ctx.workConsole.snapshot().tasks.map(card => card.title)).toEqual(['Alpha', 'Beta', 'Old'])
    await ctx.fiber.dispose()
  })
})
