import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkNodeRegistry, {
  WorkNodeConflictError,
  WorkNodeReportError,
} from '../../../src/internal/node/index.ts'
import type { WorkNodeRef } from '../../../src/internal/node/index.ts'

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(WorkNodeRegistry)
  return { ctx, pool, nodes: ctx.workNodes }
}

function ref(node: { id: WorkNodeRef['id']; revision: number }): WorkNodeRef {
  return { id: node.id, revision: node.revision }
}

describe('WorkNodeRegistry registration and capability facts', () => {
  it('registers an online node and normalizes runner/features without changing identity semantics', async () => {
    const { nodes } = await harness()
    const node = await nodes.registerNode({
      name: '  G1-PC2  ',
      protocolVersion: 1,
      runnerProviders: [' codex ', 'claude-code', 'codex', ''],
      features: ['execute', 'cancel', 'execute', 'environment-report'],
    })

    expect(node).toMatchObject({
      revision: 1,
      name: 'G1-PC2',
      state: 'online',
      protocolVersion: 1,
      runnerProviders: ['claude-code', 'codex'],
      features: ['cancel', 'environment-report', 'execute'],
    })
    expect(nodes.get(node.id)).toEqual(node)
  })

  it('refreshes capability facts with explicit degraded-state semantics', async () => {
    const { nodes } = await harness()
    const node = await nodes.registerNode({ name: 'Server-01', protocolVersion: 1 })
    const degraded = await nodes.refreshNode(ref(node), {
      protocolVersion: 2,
      state: 'degraded',
      degradedReason: 'GPU service unavailable',
      runnerProviders: ['dsh', 'codex'],
      features: ['execute', 'usage', 'tool-events'],
    })

    expect(degraded).toMatchObject({
      revision: 2,
      state: 'degraded',
      degradedReason: 'GPU service unavailable',
      protocolVersion: 2,
      runnerProviders: ['codex', 'dsh'],
      features: ['execute', 'tool-events', 'usage'],
    })

    const online = await nodes.refreshNode(ref(degraded), {
      protocolVersion: 2,
      runnerProviders: ['dsh'],
      features: ['execute', 'resume', 'cancel'],
    })
    expect(online.state).toBe('online')
    expect(online.degradedReason).toBeUndefined()
  })

  it('rejects inconsistent reports and invalid protocol/name values before durability', async () => {
    const { nodes } = await harness()
    await expect(nodes.registerNode({ name: '   ', protocolVersion: 1 })).rejects.toBeInstanceOf(WorkNodeReportError)
    await expect(nodes.registerNode({ name: 'node', protocolVersion: 0 })).rejects.toThrow(/protocolVersion/)

    const node = await nodes.registerNode({ name: 'node', protocolVersion: 1 })
    await expect(nodes.refreshNode(ref(node), {
      protocolVersion: 1,
      state: 'degraded',
    })).rejects.toThrow(/degraded reason/)
    await expect(nodes.refreshNode(ref(node), {
      protocolVersion: 1,
      state: 'online',
      degradedReason: 'should not exist',
    })).rejects.toThrow(/only valid/)
    expect(nodes.get(node.id)?.revision).toBe(1)
  })
})

describe('WorkNodeRegistry liveness and commit semantics', () => {
  it('marks offline only through an explicit owner call and allows a later successful refresh', async () => {
    const { nodes } = await harness()
    const node = await nodes.registerNode({ name: 'PC2', protocolVersion: 1, features: ['execute'] })
    const offline = await nodes.markOffline(ref(node))
    expect(offline).toMatchObject({ state: 'offline', revision: 2 })
    expect(offline.lastSeenAt).toBe(node.lastSeenAt)

    const online = await nodes.refreshNode(ref(offline), {
      protocolVersion: 1,
      runnerProviders: ['codex'],
      features: ['execute', 'cancel'],
    })
    expect(online).toMatchObject({ state: 'online', revision: 3 })
  })

  it('rejects delayed reports through compare-and-set revisions', async () => {
    const { nodes } = await harness()
    const node = await nodes.registerNode({ name: 'PC2', protocolVersion: 1 })
    const refreshed = await nodes.refreshNode(ref(node), { protocolVersion: 1 })
    await expect(nodes.markOffline(ref(node))).rejects.toBeInstanceOf(WorkNodeConflictError)
    expect(nodes.get(refreshed.id)?.revision).toBe(2)
  })

  it('contains observer failure after commit and never publishes a failed storage write', async () => {
    const pool = new MemoryMediaPool()
    const { ctx, nodes } = await harness(pool)
    ctx.on('work-node/changed', () => { throw new Error('observer failed') })
    const node = await nodes.registerNode({ name: 'Committed', protocolVersion: 1 })
    expect(nodes.get(node.id)).toBeDefined()

    pool.failNextWrites = 1
    await expect(nodes.registerNode({ name: 'Rejected', protocolVersion: 1 })).rejects.toThrow(/injected write failure/)
    expect(nodes.list()).toHaveLength(1)
  })
})
