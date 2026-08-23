import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CredentialProvider, { type CredentialInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import WorkControlService from '@deepseek-ai/dsh-work-control'
import WorkExecutionService from '@deepseek-ai/dsh-work-execution'
import WorkEnvironmentRegistry from '@deepseek-ai/dsh-work-environment'
import WorkNodeRegistry from '@deepseek-ai/dsh-work-node'
import WorkNodeGateway from '@deepseek-ai/dsh-work-node-gateway'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkNodeDaemon from '../src/index.ts'
import type { WorkNodeRunnerHandle, WorkNodeRunnerProvider } from '../src/index.ts'

const execFileAsync = promisify(execFile)
const SECRET = 'daemon-test-secret'
const SECRET_REF = 'WORK_NODE_DAEMON_TEST_SECRET'

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

async function gitWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'work-node-daemon-'))
  await execFileAsync('git', ['init', '-q'], { cwd: directory })
  await writeFile(join(directory, 'README.md'), '# fixture\n')
  await execFileAsync('git', ['add', 'README.md'], { cwd: directory })
  await execFileAsync('git', [
    '-c', 'user.name=DSH Test',
    '-c', 'user.email=dsh-test@example.invalid',
    'commit', '-q', '-m', 'fixture',
  ], { cwd: directory })
  return directory
}

function oneShotProvider(name = 'fixture-one-shot'): WorkNodeRunnerProvider {
  return {
    name,
    modes: ['one-shot'],
    async start(request): Promise<WorkNodeRunnerHandle> {
      let settled = false
      let settle!: (value: 'completed' | 'interrupted') => void
      const result = new Promise<'completed' | 'interrupted'>(resolve => { settle = resolve })
      const timer = setTimeout(() => {
        settled = true
        settle('completed')
      }, 25)
      timer.unref()
      const abort = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        settle('interrupted')
      }
      request.signal.addEventListener('abort', abort, { once: true })
      return {
        result,
        cancel: abort,
        async dispose() {
          request.signal.removeEventListener('abort', abort)
          if (!settled) abort()
          await result
        },
      }
    },
  }
}

async function system(workspace: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(TestCredentials)
  await ctx.plugin(LocalSubprocessRuntime)
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
    heartbeatTimeoutMs: 10_000,
    sweepIntervalMs: 1_000,
  })
  await ctx.plugin(WorkNodeDaemon, {
    gatewayUrl: `http://127.0.0.1:${ctx.webServer.port}`,
    nodeKey: 'pc2',
    nodeName: 'Fixture PC2',
    credential: SECRET_REF,
    protocolVersion: 1,
    pollIntervalMs: 15,
    retryDelayMs: 15,
    requestTimeoutMs: 2_000,
    maxConcurrentRuns: 2,
    gitCommand: 'git',
    environmentCommandOutputBytes: 16 * 1024,
    processGraceMs: 500,
    environments: [{ key: 'main', name: 'Fixture Workspace', workspacePath: workspace }],
  })
  return ctx
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for daemon state')
}

async function createTaskAndThread(ctx: Context) {
  const idea = await ctx.workControl.createIdea({ title: 'Remote daemon execution' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority: 'p0' })
  const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'bug-fix',
    workflow: { version: 1, stages: [{ id: 'fix', title: 'Fix', kind: 'implementation' }] },
    validationPolicy: { version: 1, validators: [] },
  })
  const thread = await ctx.workExecution.createThread({ taskId: task.id })
  return { task, thread }
}

describe('WorkNodeDaemon', () => {
  it('reports truthful one-shot capability and completes the full remote command lifecycle', async () => {
    const workspace = await gitWorkspace()
    const ctx = await system(workspace)
    try {
      const disposeRunner = ctx.workNodeDaemon.registerRunner(oneShotProvider())
      const node = await waitFor(() => ctx.workNodes.list().find(candidate =>
        candidate.runnerProviders.includes('fixture-one-shot')
        && candidate.features.includes('execute')
        && !candidate.features.includes('resume'),
      ))
      const environment = await waitFor(() => ctx.workEnvironments.list(node.id)[0])
      expect(environment.snapshot.workspace.commit).toMatch(/^[0-9a-f]{40}$/)
      expect(environment.snapshot.workspace.dirty).toBe(false)

      const { thread } = await createTaskAndThread(ctx)
      await ctx.workEnvironments.bindThread(
        { id: thread.id, revision: thread.revision },
        { id: environment.id, revision: environment.revision },
      )
      const command = await ctx.workNodeGateway.enqueueExecute(
        { id: thread.id, revision: thread.revision },
        'fixture-one-shot',
        'one-shot',
        { nextStep: 'Run the bounded fixture task' },
      )
      expect(ctx.workExecution.get(thread.id)?.state).toBe('idle')

      const completed = await waitFor(() => {
        const current = ctx.workExecution.get(thread.id)
        return current?.lastAttempt?.stopReason === 'completed' && current.state === 'idle' ? current : undefined
      })
      expect(completed.lastAttempt).toMatchObject({ provider: 'fixture-one-shot', mode: 'one-shot', stopReason: 'completed' })
      expect(ctx.workNodeGateway.getCommand(command.id)).toMatchObject({ state: 'settled', resultStopReason: 'completed' })
      const journal = await waitFor(() => {
        const current = ctx.workNodeDaemon.getJournal(command.id)
        return current?.reportedAt === undefined ? undefined : current
      })
      expect(journal).toMatchObject({ state: 'settled', stopReason: 'completed' })

      expect(() => ctx.workNodeDaemon.registerRunner(oneShotProvider())).toThrow(/already registered/)
      disposeRunner()
    } finally {
      await ctx.fiber.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('derives resume capability only from a provider that actually advertises continuable mode', async () => {
    const workspace = await gitWorkspace()
    const ctx = await system(workspace)
    try {
      const provider: WorkNodeRunnerProvider = {
        name: 'future-native',
        modes: ['continuable'],
        start: () => Promise.reject(new Error('not executed in capability test')),
      }
      const dispose = ctx.workNodeDaemon.registerRunner(provider)
      const node = await waitFor(() => ctx.workNodes.list().find(candidate =>
        candidate.runnerProviders.includes('future-native') && candidate.features.includes('resume'),
      ))
      expect(node.features).toContain('execute')
      expect(node.features).toContain('cancel')
      dispose()
    } finally {
      await ctx.fiber.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
