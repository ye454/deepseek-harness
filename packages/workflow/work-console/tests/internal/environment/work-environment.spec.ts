import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService from '../../../src/internal/control/index.ts'
import WorkExecutionService from '../../../src/internal/execution/index.ts'
import WorkNodeRegistry from '../../../src/internal/node/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkEnvironmentRegistry from '../../../src/internal/environment/index.ts'

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
  return ctx
}

async function createThread(ctx: Context) {
  const idea = await ctx.workControl.createIdea({ title: 'Environment test' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'bug-fix',
    workflow: { version: 1, stages: [{ id: 'fix', title: 'Fix', kind: 'implementation' }] },
    validationPolicy: { version: 1, validators: [] },
  })
  const thread = await ctx.workExecution.createThread({ taskId: task.id })
  return { task, thread }
}

function snapshot(path = '/workspace/project') {
  return {
    workspace: {
      path,
      repository: 'https://example.invalid/project.git',
      branch: 'feature/x',
      commit: 'abc123',
      dirty: false,
    },
    runtime: {
      os: 'ubuntu-22.04',
      arch: 'x64',
      shell: 'bash',
      versions: { python: '3.10.12', node: '24.0.0' },
    },
    services: [{ name: 'roscore', state: 'running' as const, port: 11311 }],
    devices: ['livox-mid360'],
    capabilities: ['ros-noetic', 'dds'],
    secretRefs: ['github-token'],
  }
}

async function createNode(ctx: Context, runners: readonly string[] = ['codex']) {
  return await ctx.workNodes.registerNode({
    name: 'PC2',
    protocolVersion: 1,
    runnerProviders: runners,
    features: ['execute', 'cancel', 'environment-report'],
  })
}

describe('WorkEnvironmentRegistry', () => {
  it('pins a thread to one exact environment revision and passes compatible preflight', async () => {
    const ctx = await harness()
    const { thread } = await createThread(ctx)
    const node = await createNode(ctx)
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: node.id,
      name: 'G1 navigation',
      snapshot: snapshot(),
    })

    const binding = await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: environment.id, revision: environment.revision },
    )

    expect(binding).toMatchObject({
      revision: 1,
      environmentId: environment.id,
      environmentRevision: 1,
      nodeId: node.id,
    })
    expect(ctx.workEnvironments.preflight(thread.id, 'codex')).toEqual({ ok: true, issues: [] })
  })

  it('detects environment drift until the thread is explicitly rebound', async () => {
    const ctx = await harness()
    const { thread } = await createThread(ctx)
    const node = await createNode(ctx)
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: node.id,
      name: 'Build env',
      snapshot: snapshot(),
    })
    await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: environment.id, revision: environment.revision },
    )

    const refreshed = await ctx.workEnvironments.refreshEnvironment(
      { id: environment.id, revision: environment.revision },
      { snapshot: snapshot('/workspace/project-v2') },
    )
    expect(ctx.workEnvironments.preflight(thread.id, 'codex')).toMatchObject({
      ok: false,
      issues: ['environment-stale'],
    })

    const rebound = await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: refreshed.id, revision: refreshed.revision },
    )
    expect(rebound.revision).toBe(2)
    expect(ctx.workEnvironments.preflight(thread.id, 'codex')).toEqual({ ok: true, issues: [] })
  })

  it('surfaces node and runner incompatibility instead of silently degrading', async () => {
    const ctx = await harness()
    const { thread } = await createThread(ctx)
    const node = await createNode(ctx, ['claude-code'])
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: node.id,
      name: 'Remote env',
      snapshot: snapshot(),
    })
    await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: environment.id, revision: environment.revision },
    )

    expect(ctx.workEnvironments.preflight(thread.id, 'codex').issues).toContain('runner-unavailable')
    const offline = await ctx.workNodes.markOffline({ id: node.id, revision: node.revision })
    expect(offline.state).toBe('offline')
    expect(ctx.workEnvironments.preflight(thread.id, 'claude-code').issues).toContain('node-offline')
  })

  it('rejects environment reports from nodes that do not advertise environment-report', async () => {
    const ctx = await harness()
    const node = await ctx.workNodes.registerNode({
      name: 'Opaque node',
      protocolVersion: 1,
      runnerProviders: ['codex'],
      features: ['execute'],
    })
    await expect(ctx.workEnvironments.registerEnvironment({
      nodeId: node.id,
      name: 'Unknown env',
      snapshot: snapshot(),
    })).rejects.toThrow(/does not advertise environment-report/)
  })

  it('refuses to rebind a running thread', async () => {
    const ctx = await harness()
    const { thread } = await createThread(ctx)
    const node = await createNode(ctx)
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: node.id,
      name: 'Busy env',
      snapshot: snapshot(),
    })
    const running = await ctx.workExecution.beginAttempt(
      { id: thread.id, revision: thread.revision },
      { provider: 'codex', mode: 'one-shot' },
    )
    await expect(ctx.workEnvironments.bindThread(
      { id: running.id, revision: running.revision },
      { id: environment.id, revision: environment.revision },
    )).rejects.toThrow(/cannot bind environment while state is running/)
  })

  it('normalizes compact snapshot fields without persisting secret values', async () => {
    const ctx = await harness()
    const node = await createNode(ctx)
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: node.id,
      name: '  Normalized  ',
      snapshot: {
        ...snapshot('  /workspace/project  '),
        devices: [' lidar ', 'lidar', ''],
        capabilities: [' ros ', 'ros'],
        secretRefs: [' token-a ', 'token-a'],
      },
    })
    expect(environment.name).toBe('Normalized')
    expect(environment.snapshot.workspace.path).toBe('/workspace/project')
    expect(environment.snapshot.devices).toEqual(['lidar'])
    expect(environment.snapshot.capabilities).toEqual(['ros'])
    expect(environment.snapshot.secretRefs).toEqual(['token-a'])
    expect(JSON.stringify(environment)).not.toContain('secretValue')
  })
})
