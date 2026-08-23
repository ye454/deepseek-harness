import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type WorkNodeRegistry from '../src/index.ts'
import { WorkNodeId } from '../src/index.ts'
import type { WorkNode, WorkNodeChanged } from '../src/index.ts'
import * as WorkNodeInvariant from '../src/invariant.ts'

const node = (revision = 1, state: WorkNode['state'] = 'online'): WorkNode => ({
  id: WorkNodeId('node-1'),
  revision,
  name: 'Node',
  state,
  protocolVersion: 1,
  runnerProviders: ['codex'],
  features: ['execute'],
  lastSeenAt: '2026-08-15T00:00:00.000Z',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
})

async function setup(current?: WorkNode): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workNodes', {
    get: (id: WorkNode['id']) => current?.id === id ? current : undefined,
  } as WorkNodeRegistry)
  await ctx.plugin(WorkNodeInvariant)
  return ctx
}

function change(value: WorkNode): WorkNodeChanged {
  return {
    operation: value.revision === 1 ? 'register' : value.state === 'offline' ? 'offline' : 'refresh',
    node: value,
    ref: { id: value.id, revision: value.revision },
  }
}

describe('work-node durable projection invariant', () => {
  it('accepts a change matching the current registry projection', async () => {
    const current = node(2, 'degraded')
    const ctx = await setup(current)
    expect(() => { ctx.emit('work-node/changed', change(current)) }).not.toThrow()
  })

  it('rejects absent, stale, or divergent node facts', async () => {
    const missing = await setup()
    expect(() => { missing.emit('work-node/changed', change(node())) }).toThrow(/does not match/)

    const current = node(2)
    const ctx = await setup(current)
    expect(() => { ctx.emit('work-node/changed', change(node(1))) }).toThrow(/does not match/)
    expect(() => {
      ctx.emit('work-node/changed', change({ ...current, state: 'offline' }))
    }).toThrow(/does not match/)
    expect(() => {
      ctx.emit('work-node/changed', change({ ...current, protocolVersion: 2 }))
    }).toThrow(/does not match/)
  })
})
