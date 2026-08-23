import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { WorkItem, WorkItemChanged } from '../src/index.ts'
import { WorkItemId } from '../src/index.ts'
import * as WorkControlInvariant from '../src/invariant.ts'

async function setup(current?: WorkItem): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workControl', {
    get: (id: ReturnType<typeof WorkItemId>) => current?.id === id ? current : undefined,
  } as never)
  await ctx.plugin(WorkControlInvariant)
  return ctx
}

const idea = (revision = 1): WorkItem => ({
  kind: 'idea',
  id: WorkItemId('w1'),
  revision,
  title: 'Idea',
  summary: '',
  tags: [],
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
})

function change(operation: WorkItemChanged['operation'], revision = 1): WorkItemChanged {
  const item = idea(revision)
  return operation === 'delete'
    ? { operation, ref: { id: item.id, revision } }
    : { operation, item, ref: { id: item.id, revision } }
}

describe('work-control durable projection invariant', () => {
  it('accepts a change matching the current service projection', async () => {
    const ctx = await setup(idea(2))
    expect(() => { ctx.emit('work-control/changed', change('update', 2)) }).not.toThrow()
  })

  it('rejects a changed event when the record is missing or on another revision', async () => {
    const missing = await setup()
    expect(() => { missing.emit('work-control/changed', change('create')) }).toThrow(/does not match/)

    const stale = await setup(idea(2))
    expect(() => { stale.emit('work-control/changed', change('update', 1)) }).toThrow(/does not match/)
  })

  it('accepts a delete tombstone only after the service stops publishing the item', async () => {
    const removed = await setup()
    expect(() => { removed.emit('work-control/changed', change('delete', 2)) }).not.toThrow()

    const stillPresent = await setup(idea())
    expect(() => { stillPresent.emit('work-control/changed', change('delete', 2)) }).toThrow(/still published/)
  })
})
