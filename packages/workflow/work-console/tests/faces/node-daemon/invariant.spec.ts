import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type WorkNodeDaemon from '../src/index.ts'
import type { WorkNodeDaemonJournalRecord } from '../src/index.ts'
import * as WorkNodeDaemonInvariant from '../src/invariant.ts'

const record = (state: WorkNodeDaemonJournalRecord['state'] = 'accepted'): WorkNodeDaemonJournalRecord => ({
  commandId: 'command-1' as never,
  kind: 'execute',
  runnerProvider: 'fixture',
  state,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: state === 'accepted' ? '2026-08-16T00:01:00.000Z' : '2026-08-16T00:00:00.000Z',
})

async function setup(current?: WorkNodeDaemonJournalRecord): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workNodeDaemon', {
    getJournal: (id: WorkNodeDaemonJournalRecord['commandId']) => current?.commandId === id ? current : undefined,
  } as WorkNodeDaemon)
  await ctx.plugin(WorkNodeDaemonInvariant)
  return ctx
}

describe('work-node-daemon journal invariant', () => {
  it('accepts an event matching the current durable journal', async () => {
    const current = record('accepted')
    const ctx = await setup(current)
    expect(() => { ctx.emit('work-node-daemon/command-changed', { record: current }) }).not.toThrow()
  })

  it('rejects absent or stale journal event projections', async () => {
    const missing = await setup()
    expect(() => { missing.emit('work-node-daemon/command-changed', { record: record() }) }).toThrow(/does not match/)

    const current = record('accepted')
    const ctx = await setup(current)
    expect(() => { ctx.emit('work-node-daemon/command-changed', { record: record('starting') }) }).toThrow(/does not match/)
  })
})
