import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentProvider, SubagentRun, SubagentRuntime, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { WorkItemId } from '../../../src/internal/control/index.ts'
import type { TaskWorkItem } from '../../../src/internal/control/index.ts'
import type WorkControlService from '../../../src/internal/control/index.ts'
import { ExecutionThreadId } from '../../../src/internal/execution/index.ts'
import type { ExecutionStopReason, ExecutionThread, ExecutionThreadRef } from '../../../src/internal/execution/index.ts'
import type WorkExecutionService from '../../../src/internal/execution/index.ts'
import WorkSubagentRunner, { WorkPromptBudgetError, WorkRunnerPreflightError } from '../../../src/internal/runner-subagent/index.ts'

const taskId = WorkItemId('task-1')
const threadId = ExecutionThreadId('thread-1')

function task(): TaskWorkItem {
  return {
    kind: 'task',
    id: taskId,
    revision: 3,
    title: 'Fix navigation',
    summary: 'Investigate drift only',
    tags: [],
    priority: 'p0',
    status: 'running',
    taskType: 'bug-fix',
    workflow: { version: 1, stages: [{ id: 'diagnose', title: 'Diagnose', kind: 'diagnosis' }] },
    currentStageId: 'diagnose',
    validationPolicy: {
      version: 1,
      validators: [{ kind: 'user-acceptance', requirement: 'required', label: 'Human device check' }],
    },
    validation: { state: 'pending', requiredPassed: 0, requiredTotal: 1 },
    createdAt: '2026-08-15T00:00:00.000Z',
    promotedAt: '2026-08-15T00:01:00.000Z',
    updatedAt: '2026-08-15T00:02:00.000Z',
  }
}

function idleThread(): ExecutionThread {
  return {
    id: threadId,
    revision: 1,
    taskId,
    state: 'idle',
    attemptSeq: 0,
    createdAt: '2026-08-15T00:03:00.000Z',
    updatedAt: '2026-08-15T00:03:00.000Z',
  }
}

function provider(name: string, options: { inherits?: boolean; continuable?: boolean } = {}): SubagentProvider {
  return {
    name,
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: options.inherits ?? false,
    start: async () => { throw new Error('provider.start should be reached only through fake runtime.start') },
    ...options.continuable ? { prepareContinuable: async () => ({}) } : {},
  }
}

async function harness(options: {
  providers?: SubagentProvider[]
  run?: SubagentRun
  startError?: Error
  beginError?: Error
} = {}) {
  const ctx = new Context()
  let current = idleThread()
  const beginCalls: unknown[] = []
  const settleCalls: { stopReason: ExecutionStopReason }[] = []
  const startCalls: SubagentStartRequest[] = []
  const providerList = options.providers ?? [provider('codex')]
  const providers = new Map(providerList.map(item => [item.name, item]))

  const defaultRun: SubagentRun = options.run ?? {
    id: SessionId('child-1'),
    localAgent: undefined,
    result: Promise.resolve({
      output: [{ type: 'text', text: 'done' }],
      stopReason: 'completed',
    }),
    dispose: vi.fn(async () => {}),
  }

  const subagents = {
    list: () => [...providers.keys()],
    getProvider: (name: string) => providers.get(name),
    start: async (_name: string, request: SubagentStartRequest) => {
      startCalls.push(request)
      if (options.startError !== undefined) throw options.startError
      return defaultRun
    },
  } as unknown as SubagentRuntime

  const workControl = {
    get: (id: typeof taskId) => id === taskId ? task() : undefined,
  } as unknown as WorkControlService

  const workExecution = {
    get: (id: typeof threadId) => id === threadId ? current : undefined,
    beginAttempt: async (expected: ExecutionThreadRef, request: { provider: string; mode: 'one-shot'; subagentSessionId: SessionId }) => {
      beginCalls.push({ expected, request })
      if (options.beginError !== undefined) throw options.beginError
      const seq = current.attemptSeq + 1
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'running',
        attemptSeq: seq,
        activeAttempt: {
          seq,
          provider: request.provider,
          mode: request.mode,
          subagentSessionId: request.subagentSessionId,
          startedAt: '2026-08-15T00:04:00.000Z',
        },
        updatedAt: '2026-08-15T00:04:00.000Z',
      }
      return current
    },
    settleAttempt: async (expected: ExecutionThreadRef, request: { stopReason: ExecutionStopReason }) => {
      settleCalls.push(request)
      if (expected.revision !== current.revision) throw new Error('stale test settlement')
      const activeAttempt = current.activeAttempt
      if (activeAttempt === undefined) throw new Error('test thread has no attempt')
      const { activeAttempt: _removed, ...rest } = current
      void _removed
      current = {
        ...rest,
        revision: current.revision + 1,
        state: 'idle',
        lastAttempt: {
          ...activeAttempt,
          finishedAt: '2026-08-15T00:05:00.000Z',
          stopReason: request.stopReason,
        },
        updatedAt: '2026-08-15T00:05:00.000Z',
      }
      return current
    },
  } as unknown as WorkExecutionService

  ctx.provide('subagents', subagents)
  ctx.provide('workControl', workControl)
  ctx.provide('workExecution', workExecution)
  await ctx.plugin(WorkSubagentRunner)

  const session = Session.create(SessionId('parent-1'))
  const parent = { session } as unknown as Agent
  return {
    ctx,
    parent,
    session,
    runner: ctx.workSubagentRunner,
    run: defaultRun,
    startCalls,
    beginCalls,
    settleCalls,
    thread: () => current,
  }
}

function runRequest(parent: Agent, providerName = 'codex') {
  return {
    thread: { id: threadId, revision: 1 },
    parent,
    provider: providerName,
    signal: new AbortController().signal,
    maxPromptBytes: 8_192,
    handoff: { facts: ['Root cause confirmed'], nextStep: 'Implement fix' },
  }
}

describe('WorkSubagentRunner provider discovery and preflight', () => {
  it('reports one-shot and native-continuation facts from real provider methods', async () => {
    const { runner } = await harness({
      providers: [provider('codex'), provider('spawn', { continuable: true }), provider('fork', { inherits: true, continuable: true })],
    })
    expect(runner.listRunners()).toEqual([
      expect.objectContaining({ provider: 'codex', oneShot: true, continuable: false, inheritsParentContext: false }),
      expect.objectContaining({ provider: 'spawn', oneShot: true, continuable: true, inheritsParentContext: false }),
      expect.objectContaining({ provider: 'fork', oneShot: true, continuable: true, inheritsParentContext: true }),
    ])
  })

  it('rejects inherited-parent providers and oversized packets before logging or starting a runner', async () => {
    const inherited = await harness({ providers: [provider('fork', { inherits: true })] })
    await expect(inherited.runner.runOneShot(runRequest(inherited.parent, 'fork'))).rejects.toBeInstanceOf(WorkRunnerPreflightError)
    expect(inherited.session.events).toHaveLength(0)
    expect(inherited.startCalls).toHaveLength(0)

    const bounded = await harness()
    await expect(bounded.runner.runOneShot({ ...runRequest(bounded.parent), maxPromptBytes: 16 }))
      .rejects.toBeInstanceOf(WorkPromptBudgetError)
    expect(bounded.session.events).toHaveLength(0)
    expect(bounded.startCalls).toHaveLength(0)
  })
})

describe('WorkSubagentRunner one-shot lifecycle', () => {
  it('logs the exact bounded child prompt before provider start, then records and settles the published attempt', async () => {
    const h = await harness()
    const mutableSubagents = h.ctx.subagents as unknown as {
      start: (name: string, request: SubagentStartRequest) => Promise<SubagentRun>
    }
    const originalStart = mutableSubagents.start
    mutableSubagents.start = async (name, request) => {
      const event = h.session.events.at(-1)
      expect(event?.type).toBe('work-runner/subagent-request')
      if (event?.type !== 'work-runner/subagent-request') throw new Error('missing runner request event')
      const block = request.prompt[0]
      expect(block?.type).toBe('text')
      if (block?.type !== 'text') throw new Error('unexpected prompt block')
      expect(event.data.prompt).toBe(block.text)
      expect(event.data.promptBytes).toBe(Buffer.byteLength(block.text, 'utf8'))
      expect(event.data.promptBytes).toBeLessThanOrEqual(event.data.maxPromptBytes)
      return originalStart(name, request)
    }

    const result = await h.runner.runOneShot(runRequest(h.parent))
    expect(result).toMatchObject({ provider: 'codex', childId: 'child-1', stopReason: 'completed' })
    expect(result.output).toEqual([{ type: 'text', text: 'done' }])
    expect(h.beginCalls).toHaveLength(1)
    expect(h.settleCalls).toEqual([{ stopReason: 'completed' }])
    expect(result.thread).toMatchObject({ state: 'idle', attemptSeq: 1, lastAttempt: { provider: 'codex', stopReason: 'completed' } })
    expect(h.run.dispose).toHaveBeenCalledTimes(1)
  })

  it('leaves the thread idle when provider startup rejects, while retaining the attempted request event', async () => {
    const h = await harness({ startError: new Error('provider unavailable') })
    await expect(h.runner.runOneShot(runRequest(h.parent))).rejects.toThrow('provider unavailable')
    expect(h.session.events.at(-1)?.type).toBe('work-runner/subagent-request')
    expect(h.beginCalls).toHaveLength(0)
    expect(h.thread().state).toBe('idle')
  })

  it('disposes a published runner when attaching the attempt loses a thread race', async () => {
    const h = await harness({ beginError: new Error('thread changed') })
    await expect(h.runner.runOneShot(runRequest(h.parent))).rejects.toThrow('thread changed')
    expect(h.run.dispose).toHaveBeenCalledTimes(1)
    expect(h.thread().state).toBe('idle')
  })

  it('settles a published attempt as unknown and disposes it when result delivery rejects', async () => {
    const failingRun: SubagentRun = {
      id: SessionId('child-failure'),
      localAgent: undefined,
      result: new Promise((_resolve, reject) => { queueMicrotask(() => reject(new Error('transport lost'))) }),
      dispose: vi.fn(async () => {}),
    }
    const h = await harness({ run: failingRun })
    await expect(h.runner.runOneShot(runRequest(h.parent))).rejects.toThrow('transport lost')
    expect(h.settleCalls).toEqual([{ stopReason: 'unknown' }])
    expect(h.thread()).toMatchObject({ state: 'idle', lastAttempt: { stopReason: 'unknown' } })
    expect(failingRun.dispose).toHaveBeenCalledTimes(1)
  })
})
