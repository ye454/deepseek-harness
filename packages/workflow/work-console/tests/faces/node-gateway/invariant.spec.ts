import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type WorkNodeGateway from '../src/index.ts'
import { RemoteNodeCommandId } from '../src/index.ts'
import type { RemoteNodeCommand, RemoteNodeCommandChanged } from '../src/index.ts'
import * as WorkNodeGatewayInvariant from '../src/invariant.ts'

const command = (state: RemoteNodeCommand['state'] = 'queued'): RemoteNodeCommand => ({
  id: RemoteNodeCommandId('command-1'),
  nodeId: 'node-1' as never,
  kind: 'cancel',
  state,
  payload: { threadId: 'thread-1' as never, attemptSeq: 1 },
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: state === 'queued' ? '2026-08-16T00:00:00.000Z' : '2026-08-16T00:01:00.000Z',
})

async function setup(current?: RemoteNodeCommand): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workNodeGateway', {
    getCommand: (id: RemoteNodeCommand['id']) => current?.id === id ? current : undefined,
  } as WorkNodeGateway)
  await ctx.plugin(WorkNodeGatewayInvariant)
  return ctx
}

function change(value: RemoteNodeCommand): RemoteNodeCommandChanged {
  return { command: value }
}

describe('work-node-gateway durable command invariant', () => {
  it('accepts an event matching the current durable command projection', async () => {
    const current = command('accepted')
    const ctx = await setup(current)
    expect(() => { ctx.emit('work-node-gateway/command-changed', change(current)) }).not.toThrow()
  })

  it('rejects absent or stale command event projections', async () => {
    const missing = await setup()
    expect(() => { missing.emit('work-node-gateway/command-changed', change(command())) }).toThrow(/does not match/)

    const current = command('accepted')
    const ctx = await setup(current)
    expect(() => { ctx.emit('work-node-gateway/command-changed', change(command('queued'))) }).toThrow(/does not match/)
  })
})
