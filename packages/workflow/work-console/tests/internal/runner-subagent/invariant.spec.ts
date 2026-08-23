import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { WorkItemId } from '../../../src/internal/control/index.ts'
import { ExecutionThreadId } from '../../../src/internal/execution/index.ts'
import { WORK_RUNNER_PROMPT_PREFIX } from '../../../src/internal/runner-subagent/index.ts'
import type { WorkRunnerSubagentRequestEvent } from '../../../src/internal/runner-subagent/index.ts'
import * as WorkRunnerInvariant from '../../../src/internal/runner-subagent/invariant.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(WorkRunnerInvariant)
  return ctx
}

function requestEvent(overrides: Partial<WorkRunnerSubagentRequestEvent> = {}): SessionEvent {
  const prompt = `${WORK_RUNNER_PROMPT_PREFIX}\n\nWORK_CONTEXT_JSON\n{"task":{"id":"task-1"}}`
  const session = Session.create(SessionId('detached'))
  return session.append('work-runner/subagent-request', {
    kind: 'work-runner/subagent-request',
    version: 1,
    taskId: WorkItemId('task-1'),
    threadId: ExecutionThreadId('thread-1'),
    threadRevision: 1,
    provider: 'codex',
    mode: 'one-shot',
    maxPromptBytes: 8192,
    promptBytes: Buffer.byteLength(prompt, 'utf8'),
    prompt,
    ...overrides,
  })
}

describe('work-runner request invariant', () => {
  it('accepts a truthful bounded prompt event', async () => {
    const ctx = await setup()
    const event = requestEvent()
    expect(() => { ctx.emit('session/event', Session.create(SessionId('scope')), event) }).not.toThrow()
  })

  it('rejects false byte accounting, an exceeded ceiling, or a different prompt prefix', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('scope'))
    expect(() => { ctx.emit('session/event', session, requestEvent({ promptBytes: 1 })) }).toThrow(/does not truthfully/)
    expect(() => { ctx.emit('session/event', session, requestEvent({ maxPromptBytes: 1 })) }).toThrow(/does not truthfully/)
    expect(() => {
      ctx.emit('session/event', session, requestEvent({ prompt: 'different', promptBytes: 9 }))
    }).toThrow(/does not truthfully/)
  })
})
