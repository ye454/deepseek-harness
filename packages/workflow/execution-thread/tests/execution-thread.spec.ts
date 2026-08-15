import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import WorkControlService from '../../work-control/src/index.ts'
import type { WorkItemRef } from '../../work-control/src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ExecutionThreadService, { ExecutionThreadConflictError } from '../src/index.ts'

function workRef(item: { id: WorkItemRef['id']; revision: number }): WorkItemRef {
  return { id: item.id, revision: item.revision }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(WorkControlService)

  const calls = {
    starts: 0,
    interrupts: 0,
    followups: 0,
  }
  const childId = SessionId('child-session')
  const subagents = {
    startContinuable: async () => {
      calls.starts += 1
      return { childId, messageId: 'message-1' }
    },
    interrupt: () => { calls.interrupts += 1 },
    followup: async () => {
      calls.followups += 1
      return 'message-2'
    },
  } as unknown as SubagentRuntime
  ctx.provide('subagents', subagents)
  await ctx.plugin(ExecutionThreadService)

  const parent = { id: SessionId('parent-session') } as unknown as Agent
  return { ctx, calls, parent, service: ctx.executionThreads, work: ctx.workControl }
}

async function organizedTask(work: WorkControlService) {
  const idea = await work.createIdea({ title: 'Implement persistent task runner' })
  const promoted = await work.promoteIdea(workRef(idea), { priority: 'p1' })
  return await work.organizeTask(workRef(promoted), {
    taskType: 'feature',
    workflow: {
      version: 1,
      stages: [{ id: 'implement', title: 'Implement', kind: 'implementation' }],
    },
    validationPolicy: { version: 1, validators: [] },
  })
}

describe('ExecutionThreadService', () => {
  it('starts one durable continuable child only for an organized task', async () => {
    const { calls, parent, service, work } = await harness()
    const task = await organizedTask(work)
    const thread = await service.start(parent, {
      workItem: workRef(task),
      provider: 'codex',
      label: 'Implement',
      prompt: [{ type: 'text', text: 'Implement the task.' }],
    }, new AbortController().signal)

    expect(calls.starts).toBe(1)
    expect(thread).toMatchObject({
      workItemId: task.id,
      provider: 'codex',
      parentSessionId: parent.id,
      childSessionId: SessionId('child-session'),
      state: 'running',
      revision: 2,
    })
    expect(service.listForWorkItem(task.id)).toEqual([thread])
  })

  it('parks and resumes the same child session while enforcing revision CAS', async () => {
    const { calls, parent, service, work } = await harness()
    const task = await organizedTask(work)
    const running = await service.start(parent, {
      workItem: workRef(task),
      provider: 'claude-code',
      label: 'Investigate',
      prompt: [{ type: 'text', text: 'Investigate.' }],
    }, new AbortController().signal)

    const paused = await service.pause({ id: running.id, revision: running.revision }, parent)
    expect(calls.interrupts).toBe(1)
    expect(paused.state).toBe('paused')
    await expect(service.pause({ id: running.id, revision: running.revision }, parent))
      .rejects.toBeInstanceOf(ExecutionThreadConflictError)

    const resumed = await service.continue(
      { id: paused.id, revision: paused.revision },
      parent,
      { content: [{ type: 'text', text: 'Continue from the saved state.' }] },
      new AbortController().signal,
    )
    expect(calls.followups).toBe(1)
    expect(resumed).toMatchObject({ state: 'running', childSessionId: running.childSessionId })
  })

  it('stores only compact handoff fields and can mark a thread blocked', async () => {
    const { parent, service, work } = await harness()
    const task = await organizedTask(work)
    const running = await service.start(parent, {
      workItem: workRef(task),
      provider: 'spawn',
      label: 'Run',
      prompt: [{ type: 'text', text: 'Run.' }],
    }, new AbortController().signal)

    const handoff = await service.setHandoff(
      { id: running.id, revision: running.revision },
      { summary: ' Root cause isolated. ', nextStep: ' Apply the minimal patch. ' },
    )
    expect(handoff.handoff).toMatchObject({
      summary: 'Root cause isolated.',
      nextStep: 'Apply the minimal patch.',
    })

    const blocked = await service.block({ id: handoff.id, revision: handoff.revision })
    expect(blocked.state).toBe('blocked')
  })
})
