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

async function organizedTask(ctx: Context, title: string, priority: 'p0' | 'p1' | 'p2', withUserGate = false) {
  const idea = await ctx.workControl.createIdea({ title, summary: `${title} summary`, tags: ['global'] })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority })
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
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
      validators: withUserGate
        ? [
            { kind: 'smoke-test', requirement: 'required', label: 'Remote smoke' },
            { kind: 'user-acceptance', requirement: 'required', label: 'User accepts' },
          ]
        : [],
    },
  })
}

function environmentSnapshot(commit = 'abc123') {
  return {
    workspace: {
      path: '/workspace/g1',
      repository: 'https://example.invalid/g1.git',
      branch: 'feature/drift',
      commit,
      dirty: false,
    },
    runtime: {
      os: 'ubuntu-22.04',
      arch: 'x64',
      shell: 'bash',
      versions: { node: '24.0.0', python: '3.10.12' },
    },
    services: [{ name: 'roscore', state: 'running' as const, port: 11311 }],
    devices: ['livox-mid360'],
    capabilities: ['ros-noetic', 'dds'],
    secretRefs: ['NODE_TOKEN'],
  }
}

describe('WorkConsoleGateway global projection', () => {
  it('sorts P0 first and projects real Runner/Node/Environment facts including stale bindings', async () => {
    const ctx = await harness()
    const p1 = await organizedTask(ctx, 'RAG cache optimization', 'p1')
    const p0 = await organizedTask(ctx, 'G1 radar drift', 'p0')

    const node = await ctx.workNodes.registerNode({
      name: 'G1-PC2',
      protocolVersion: 1,
      runnerProviders: ['codex', 'claude-code'],
      features: ['execute', 'cancel', 'environment-report'],
    })
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: node.id,
      name: 'G1 Navigation',
      snapshot: environmentSnapshot(),
    })
    const thread = await ctx.workExecution.createThread({ taskId: p0.id })
    await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: environment.id, revision: environment.revision },
    )
    await ctx.workExecution.beginAttempt(
      { id: thread.id, revision: thread.revision },
      { provider: 'codex', mode: 'one-shot' },
    )
    await ctx.workEnvironments.refreshEnvironment(
      { id: environment.id, revision: environment.revision },
      { snapshot: environmentSnapshot('changed-commit') },
    )

    // Give the lower-priority task an execution thread too; P0 must still sort first.
    await ctx.workExecution.createThread({ taskId: p1.id })

    const snapshot = ctx.workConsole.snapshot()
    expect(snapshot.tasks.map(task => task.title)).toEqual(['G1 radar drift', 'RAG cache optimization'])
    expect(snapshot.tasks[0]).toMatchObject({
      priority: 'p0',
      status: 'running',
      execution: { provider: 'codex', mode: 'one-shot', runningThreadCount: 1 },
      placement: {
        nodeName: 'G1-PC2',
        nodeState: 'online',
        environmentName: 'G1 Navigation',
        environmentState: 'ready',
        boundEnvironmentRevision: 1,
        currentEnvironmentRevision: 2,
        stale: true,
      },
    })
    expect(snapshot.resources).toMatchObject({
      nodes: { total: 1, online: 1, degraded: 0, offline: 0 },
      environments: { total: 1, ready: 1, degraded: 0, unavailable: 0 },
      runners: [
        { provider: 'claude-code', nodeCount: 1, onlineNodeCount: 1 },
        { provider: 'codex', nodeCount: 1, onlineNodeCount: 1 },
      ],
    })
    await ctx.fiber.dispose()
  })

  it('projects Pending Center and only current-generation Evidence while omitting secret references from detail', async () => {
    const ctx = await harness()
    const task = await organizedTask(ctx, 'Validate remote worker', 'p1', true)
    const thread = await ctx.workExecution.createThread({ taskId: task.id })
    const node = await ctx.workNodes.registerNode({
      name: 'Worker-01',
      protocolVersion: 1,
      runnerProviders: ['claude-code'],
      features: ['execute', 'environment-report'],
    })
    const environment = await ctx.workEnvironments.registerEnvironment({
      nodeId: node.id,
      name: 'Worker Env',
      snapshot: environmentSnapshot(),
    })
    await ctx.workEnvironments.bindThread(
      { id: thread.id, revision: thread.revision },
      { id: environment.id, revision: environment.revision },
    )

    const first = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: first.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [{ kind: 'test', label: 'old smoke', reference: 'ci:old' }],
    })
    let current = ctx.workControl.get(task.id)
    if (current?.kind !== 'task') throw new Error('expected task')
    current = await ctx.workControl.setStatus({ id: current.id, revision: current.revision }, 'running')
    const second = await ctx.workValidation.beginValidation({ id: current.id, revision: current.revision })
    await ctx.workValidation.recordAutomatedResult({
      taskId: current.id,
      generation: second.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [{ kind: 'test', label: 'current smoke', reference: 'ci:current', summary: 'worker started and settled' }],
    })

    const snapshot = ctx.workConsole.snapshot()
    expect(snapshot.pending).toEqual({
      blockedTasks: 0,
      validationTasks: 1,
      pendingUserAcceptance: 1,
    })
    expect(snapshot.tasks[0]?.validation).toMatchObject({ state: 'pending', requiredPassed: 1, requiredTotal: 2 })

    const detail = ctx.workConsole.task(String(task.id))
    expect(detail?.validationGeneration).toBe(second.generation)
    expect(detail?.validators[0]).toMatchObject({
      label: 'Remote smoke',
      outcome: 'passed',
      evidence: [{ reference: 'ci:current' }],
    })
    expect(detail?.validators[0]?.evidence.map(item => item.reference)).not.toContain('ci:old')
    expect(detail?.validators[1]).toMatchObject({ label: 'User accepts', outcome: undefined, evidence: [] })
    expect(JSON.stringify(detail)).not.toContain('NODE_TOKEN')
    expect(detail?.environments[0]).toMatchObject({
      name: 'Worker Env',
      workspace: { path: '/workspace/g1', commit: 'abc123' },
      devices: ['livox-mid360'],
      capabilities: ['dds', 'ros-noetic'],
    })
    await ctx.fiber.dispose()
  })

  it('excludes cancelled Tasks instead of folding them into completed work', async () => {
    const ctx = await harness()
    const task = await organizedTask(ctx, 'Cancelled experiment', 'p2')
    await ctx.workControl.setStatus({ id: task.id, revision: task.revision }, 'cancelled')
    expect(ctx.workConsole.snapshot().tasks).toEqual([])
    expect(ctx.workConsole.task(String(task.id))).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
