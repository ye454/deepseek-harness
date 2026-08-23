import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { WorkItemId } from '@deepseek-ai/dsh-work-control'
import type { ExecutionThread, ExecutionThreadChanged, WorkExecutionService } from '../src/index.ts'
import { ExecutionThreadId } from '../src/index.ts'
import * as WorkExecutionInvariant from '../src/invariant.ts'

const thread = (revision = 1, state: ExecutionThread['state'] = 'idle'): ExecutionThread => ({
  id: ExecutionThreadId('thread-1'),
  revision,
  taskId: WorkItemId('task-1'),
  state,
  attemptSeq: 0,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
})

async function setup(current?: ExecutionThread): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workExecution', {
    get: (id: ExecutionThread['id']) => current?.id === id ? current : undefined,
  } as WorkExecutionService)
  await ctx.plugin(WorkExecutionInvariant)
  return ctx
}

function change(value: ExecutionThread): ExecutionThreadChanged {
  return {
    operation: value.revision === 1 ? 'create' : 'update',
    thread: value,
    ref: { id: value.id, revision: value.revision },
  }
}

describe('work-execution durable projection invariant', () => {
  it('accepts an event matching the durable projection', async () => {
    const value = thread(2, 'blocked')
    const ctx = await setup(value)
    expect(() => { ctx.emit('work-execution/changed', change(value)) }).not.toThrow()
  })

  it('fails when the durable thread is absent or on another revision', async () => {
    const missing = await setup()
    expect(() => { missing.emit('work-execution/changed', change(thread())) }).toThrow(/does not match/)

    const stale = await setup(thread(2))
    expect(() => { stale.emit('work-execution/changed', change(thread(1))) }).toThrow(/does not match/)
  })

  it('fails when state, task ownership, or attempt sequence diverges at the same revision', async () => {
    const durable = thread(3, 'idle')
    const ctx = await setup(durable)
    const wrongState = { ...durable, state: 'blocked' as const }
    expect(() => { ctx.emit('work-execution/changed', change(wrongState)) }).toThrow(/does not match/)

    const wrongTask = { ...durable, taskId: WorkItemId('task-2') }
    expect(() => { ctx.emit('work-execution/changed', change(wrongTask)) }).toThrow(/does not match/)

    const wrongSeq = { ...durable, attemptSeq: 1 }
    expect(() => { ctx.emit('work-execution/changed', change(wrongSeq)) }).toThrow(/does not match/)
  })
})
