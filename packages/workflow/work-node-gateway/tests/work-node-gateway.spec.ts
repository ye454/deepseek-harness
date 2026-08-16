import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CredentialProvider, { type CredentialInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService from '@deepseek-ai/dsh-work-control'
import WorkExecutionService from '@deepseek-ai/dsh-work-execution'
import WorkEnvironmentRegistry from '@deepseek-ai/dsh-work-environment'
import WorkNodeRegistry from '@deepseek-ai/dsh-work-node'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkNodeGateway from '../src/index.ts'

const SECRET = 'test-node-secret'
const SECRET_REF = 'WORK_NODE_TEST_SECRET'
const FEATURES = ['execute', 'cancel', 'resume', 'environment-report'] as const

class TestCredentials extends CredentialProvider {
  constructor(ctx: Context) {
    super(ctx)
  }

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(String(ref) === SECRET_REF ? { value: SECRET, source: 'test' } : undefined)
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: String(ref) === SECRET_REF, source: 'test', writable: false })
  }

  set(): Promise<void> {
    return Promise.reject(new Error('test credentials are read-only'))
  }

  unset(): Promise<void> {
    return Promise.reject(new Error('test credentials are read-only'))
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(TestCredentials)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(WorkControlService)
  await ctx.plugin(WorkExecutionService)
  await ctx.plugin(WorkNodeRegistry)
  await ctx.plugin(WorkEnvironmentRegistry)
  await ctx.plugin(WorkNodeGateway, {
    nodes: { pc2: SECRET_REF },
    maxRequestBodyBytes: 64 * 1024,
    maxPromptBytes: 16 * 1024,
    maxCommandsPerPoll: 8,
    maxClockSkewMs: 30_000,
    heartbeatTimeoutMs: 60_000,
    sweepIntervalMs: 60_000,
  })
  return ctx
}

function snapshot(commit = 'abc123') {
  return {
    workspace: {
      path: '/workspace/project',
      repository: 'https://example.invalid/project.git',
      branch: 'feature/x',
      commit,
      dirty: false,
    },
    runtime: { os: 'ubuntu-22.04', arch: 'x64', shell: 'bash', versions: { node: '24.0.0' } },
    services: [{ name: 'roscore', state: 'running' as const, port: 11311 }],
    devices: ['livox-mid360'],
    capabilities: ['ros-noetic'],
    secretRefs: ['github-token'],
  }
}

function helloBody() {
  return {
    nodeKey: 'pc2',
    name: 'G1-PC2',
    protocolVersion: 1,
    runnerProviders: ['codex'],
    features: [...FEATURES],
  }
}

function pollBody(nodeRevision: number, commit = 'abc123') {
  return {
    nodeKey: 'pc2',
    nodeRevision,
    protocolVersion: 1,
    runnerProviders: ['codex'],
    features: [...FEATURES],
    environments: [{ key: 'main', name: 'G1 navigation', snapshot: snapshot(commit) }],
  }
}

async function signedPost(
  ctx: Context,
  path: string,
  body: unknown,
  options: { secret?: string; timestamp?: number } = {},
): Promise<Response> {
  const raw = JSON.stringify(body)
  const timestamp = String(options.timestamp ?? Date.now())
  const secret = options.secret ?? SECRET
  const signature = createHmac('sha256', secret)
    .update(`POST\n${path}\n${timestamp}\n${raw}`)
    .digest('hex')
  return await fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-node-key': 'pc2',
      'x-dsh-timestamp': timestamp,
      'x-dsh-signature': signature,
    },
    body: raw,
  })
}

async function connectNode(ctx: Context) {
  const hello = await signedPost(ctx, '/work-node/v1/hello', helloBody())
  expect(hello.status).toBe(200)
  const helloJson = await hello.json() as { nodeId: string; nodeRevision: number }
  const poll = await signedPost(ctx, '/work-node/v1/poll', pollBody(helloJson.nodeRevision))
  expect(poll.status).toBe(200)
  const pollJson = await poll.json() as { nodeId: string; nodeRevision: number; commands: unknown[] }
  expect(pollJson.commands).toEqual([])
  return pollJson
}

async function createBoundThread(ctx: Context, nodeId: string) {
  const idea = await ctx.workControl.createIdea({ title: 'Fix remote navigation' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority: 'p0' })
  const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'bug-fix',
    workflow: {
      version: 1,
      stages: [
        { id: 'diagnose', title: 'Diagnose', kind: 'diagnosis' },
        { id: 'fix', title: 'Fix', kind: 'implementation' },
        { id: 'validate', title: 'Validate', kind: 'validation' },
      ],
    },
    validationPolicy: {
      version: 1,
      validators: [{ kind: 'device-test', requirement: 'required', label: 'G1 field validation' }],
    },
  })
  const thread = await ctx.workExecution.createThread({ taskId: task.id })
  const environment = ctx.workEnvironments.list(nodeId as never)[0]
  if (environment === undefined) throw new Error('expected remote environment')
  await ctx.workEnvironments.bindThread(
    { id: thread.id, revision: thread.revision },
    { id: environment.id, revision: environment.revision },
  )
  return { task, thread, environment }
}

describe('WorkNodeGateway HTTP authentication and heartbeat', () => {
  it('rejects invalid and stale HMAC requests without registering a node', async () => {
    const ctx = await harness()
    const invalid = await signedPost(ctx, '/work-node/v1/hello', helloBody(), { secret: 'wrong-secret' })
    expect(invalid.status).toBe(401)
    expect(ctx.workNodes.list()).toEqual([])

    const stale = await signedPost(ctx, '/work-node/v1/hello', helloBody(), { timestamp: Date.now() - 60_000 })
    expect(stale.status).toBe(401)
    expect(ctx.workNodes.list()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('reuses the stable WorkNode identity and does not refresh an unchanged environment', async () => {
    const ctx = await harness()
    const first = await connectNode(ctx)
    const environment = ctx.workEnvironments.list(first.nodeId as never)[0]
    expect(environment?.revision).toBe(1)

    const secondPoll = await signedPost(ctx, '/work-node/v1/poll', pollBody(first.nodeRevision))
    expect(secondPoll.status).toBe(200)
    const secondPollJson = await secondPoll.json() as { nodeRevision: number }
    expect(ctx.workEnvironments.list(first.nodeId as never)[0]?.revision).toBe(1)

    const reconnect = await signedPost(ctx, '/work-node/v1/hello', helloBody())
    expect(reconnect.status).toBe(200)
    const reconnectJson = await reconnect.json() as { nodeId: string; nodeRevision: number }
    expect(reconnectJson.nodeId).toBe(first.nodeId)
    expect(reconnectJson.nodeRevision).toBeGreaterThan(secondPollJson.nodeRevision)
    expect(ctx.workNodes.list()).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})

describe('WorkNodeGateway durable execution lifecycle', () => {
  it('keeps the thread idle until remote publication is acknowledged, then settles through result', async () => {
    const ctx = await harness()
    const connected = await connectNode(ctx)
    const { thread, environment } = await createBoundThread(ctx, connected.nodeId)

    const queued = await ctx.workNodeGateway.enqueueExecute(
      { id: thread.id, revision: thread.revision },
      'codex',
      'continuable',
      { facts: ['MID360 stream is healthy'], nextStep: 'Inspect localization drift' },
    )
    expect(queued).toMatchObject({
      kind: 'execute', state: 'queued', nodeId: connected.nodeId,
      payload: {
        threadId: thread.id,
        environmentId: environment.id,
        environmentRevision: environment.revision,
        environmentKey: 'main',
        runnerProvider: 'codex',
        mode: 'continuable',
      },
    })
    expect(ctx.workExecution.get(thread.id)?.state).toBe('idle')

    const poll = await signedPost(ctx, '/work-node/v1/poll', pollBody(connected.nodeRevision))
    expect(poll.status).toBe(200)
    const pollJson = await poll.json() as { nodeRevision: number; commands: Array<{ id: string }> }
    expect(pollJson.commands.map(command => command.id)).toEqual([queued.id])
    expect(ctx.workEnvironments.get(environment.id)?.revision).toBe(environment.revision)

    const missingSession = await signedPost(ctx, '/work-node/v1/ack', {
      nodeKey: 'pc2', commandId: queued.id, accepted: true,
    })
    expect(missingSession.status).toBe(409)
    expect(ctx.workExecution.get(thread.id)?.state).toBe('idle')

    const ack = await signedPost(ctx, '/work-node/v1/ack', {
      nodeKey: 'pc2', commandId: queued.id, accepted: true, subagentSessionId: 'remote-codex-session-1',
    })
    expect(ack.status).toBe(200)
    expect(ctx.workExecution.get(thread.id)).toMatchObject({
      state: 'running',
      activeAttempt: { provider: 'codex', mode: 'continuable', subagentSessionId: 'remote-codex-session-1' },
    })

    const result = await signedPost(ctx, '/work-node/v1/result', {
      nodeKey: 'pc2', commandId: queued.id, stopReason: 'completed',
    })
    expect(result.status).toBe(200)
    const settledThread = ctx.workExecution.get(thread.id)
    expect(settledThread).toMatchObject({
      state: 'idle',
      lastAttempt: { provider: 'codex', mode: 'continuable', subagentSessionId: 'remote-codex-session-1', stopReason: 'completed' },
    })

    const resume = await ctx.workNodeGateway.enqueueResume(
      { id: thread.id, revision: settledThread!.revision },
      'codex',
      { nextStep: 'Continue on the same native session' },
    )
    expect(resume).toMatchObject({
      kind: 'resume', state: 'queued',
      payload: { resumeSessionId: 'remote-codex-session-1', environmentKey: 'main' },
    })
    await ctx.fiber.dispose()
  })

  it('rejects a queued command when a material environment change makes its exact binding stale', async () => {
    const ctx = await harness()
    const connected = await connectNode(ctx)
    const { thread } = await createBoundThread(ctx, connected.nodeId)
    const queued = await ctx.workNodeGateway.enqueueExecute(
      { id: thread.id, revision: thread.revision }, 'codex', 'one-shot',
    )

    const poll = await signedPost(ctx, '/work-node/v1/poll', pollBody(connected.nodeRevision, 'changed-commit'))
    expect(poll.status).toBe(200)
    const body = await poll.json() as { commands: unknown[] }
    expect(body.commands).toEqual([])
    expect(ctx.workNodeGateway.getCommand(queued.id)).toMatchObject({
      state: 'rejected', failureCode: 'ENVIRONMENT_STALE',
    })
    expect(ctx.workExecution.get(thread.id)?.state).toBe('idle')
    await ctx.fiber.dispose()
  })

  it('prevents duplicate open remote execution commands for one thread', async () => {
    const ctx = await harness()
    const connected = await connectNode(ctx)
    const { thread } = await createBoundThread(ctx, connected.nodeId)
    await ctx.workNodeGateway.enqueueExecute({ id: thread.id, revision: thread.revision }, 'codex', 'one-shot')
    await expect(
      ctx.workNodeGateway.enqueueExecute({ id: thread.id, revision: thread.revision }, 'codex', 'one-shot'),
    ).rejects.toThrow(/already has open remote command/)
    await ctx.fiber.dispose()
  })
})
