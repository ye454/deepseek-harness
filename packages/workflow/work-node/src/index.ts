/**
 * Durable work-node registry. Node transport/authentication and environment snapshots are separate capabilities.
 * @module @deepseek-ai/dsh-work-node
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { workNodeDomainSpec } from './spec.ts'
import type { WorkNodeRecord } from './spec.ts'
import type {
  RefreshWorkNodeRequest,
  RegisterWorkNodeRequest,
  WorkNode,
  WorkNodeChanged,
  WorkNodeFeature,
  WorkNodeId as WorkNodeIdBrand,
  WorkNodeRef,
} from './types.ts'

export type {
  RefreshWorkNodeRequest,
  RegisterWorkNodeRequest,
  WorkNode,
  WorkNodeChanged,
  WorkNodeFeature,
  WorkNodeRef,
  WorkNodeState,
} from './types.ts'
export { workNodeDomainSpec, workNodeRecord } from './spec.ts'

/** Stable remote/local worker-node identity. */
export type WorkNodeId = WorkNodeIdBrand

/**
 * Brand a raw string as a work-node id.
 * @param id - Raw persisted identifier.
 * @returns the same string with the work-node brand.
 */
export function WorkNodeId(id: string): WorkNodeId {
  return id as WorkNodeId
}

/** A request named no durable node. */
export class WorkNodeNotFoundError extends Error {
  /** @param id - Missing node id. */
  constructor(readonly id: WorkNodeId) {
    super(`unknown work node '${id}'`)
    this.name = 'WorkNodeNotFoundError'
  }
}

/** A compare-and-set node mutation used a stale revision. */
export class WorkNodeConflictError extends Error {
  /**
   * @param expected - Caller-owned node revision.
   * @param actualRevision - Current durable revision.
   */
  constructor(readonly expected: WorkNodeRef, readonly actualRevision: number) {
    super(`stale work node '${expected.id}' revision ${expected.revision}; current revision is ${actualRevision}`)
    this.name = 'WorkNodeConflictError'
  }
}

/** A node report is internally inconsistent. */
export class WorkNodeReportError extends Error {
  /** @param message - Concrete rejected report reason. */
  constructor(message: string) {
    super(message)
    this.name = 'WorkNodeReportError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workNodes: WorkNodeRegistry
  }

  interface Events {
    /**
     * One work-node mutation committed durably.
     * @param change - Exact committed node projection.
     * @mode emit
     */
    'work-node/changed'(change: WorkNodeChanged): void
  }
}

/** Durable registry of authenticated node facts reported by a later gateway/daemon layer. */
export class WorkNodeRegistry extends Service {
  static inject = ['storageDomain']

  private table?: KvTable<WorkNodeId, WorkNodeRecord>

  constructor(ctx: Context) {
    super(ctx, 'workNodes')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workNodeDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workNodes.domainClose')
    this.table = domain.table('nodes')
  }

  /**
   * Register a new node after the future transport/authentication layer accepts its handshake.
   * Registration always begins online; later liveness decisions use refresh/markOffline.
   * @param request - Display name, protocol version, runner providers, and node features.
   * @returns the new durable node.
   */
  async registerNode(request: RegisterWorkNodeRequest): Promise<WorkNode> {
    const now = new Date().toISOString()
    const id = WorkNodeId(randomUUID())
    const node: WorkNode = {
      id,
      revision: 1,
      name: requireText(request.name, 'node name'),
      state: 'online',
      protocolVersion: requireProtocolVersion(request.protocolVersion),
      runnerProviders: normalizeStrings(request.runnerProviders ?? []),
      features: normalizeFeatures(request.features ?? []),
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }
    await this.requireTable().put(id, node)
    this.emitChanged({ operation: 'register', node, ref: refOf(node) })
    return node
  }

  /**
   * Replace one node's advertised runtime capabilities and refresh liveness.
   * Omitted state resolves explicitly to online; degraded requires a nonempty reason.
   * @param expected - Exact node revision from the gateway's previous acknowledged report.
   * @param request - New protocol/capability advertisement.
   * @returns the refreshed node.
   */
  async refreshNode(expected: WorkNodeRef, request: RefreshWorkNodeRequest): Promise<WorkNode> {
    const state = request.state ?? 'online'
    const degradedReason = state === 'degraded'
      ? requireText(request.degradedReason ?? '', 'degraded reason')
      : undefined
    if (state === 'online' && request.degradedReason !== undefined) {
      throw new WorkNodeReportError('degradedReason is only valid when node state is degraded')
    }
    const protocolVersion = requireProtocolVersion(request.protocolVersion)
    const runnerProviders = normalizeStrings(request.runnerProviders ?? [])
    const features = normalizeFeatures(request.features ?? [])
    const next = await this.requireTable().update(expected.id, record => {
      const current = asWorkNode(record)
      assertRef(current, expected)
      const now = new Date().toISOString()
      return {
        ...withoutDegradedReason(current),
        revision: current.revision + 1,
        state,
        protocolVersion,
        runnerProviders,
        features,
        ...degradedReason === undefined ? {} : { degradedReason },
        lastSeenAt: now,
        updatedAt: now,
      }
    })
    const node = asWorkNode(next)
    this.emitChanged({ operation: 'refresh', node, ref: refOf(node) })
    return node
  }

  /**
   * Mark a node offline without inventing a heartbeat timeout policy in the registry.
   * The caller that owns liveness observation decides when this transition is justified.
   * @param expected - Exact last acknowledged node revision.
   * @returns the offline node.
   */
  async markOffline(expected: WorkNodeRef): Promise<WorkNode> {
    const next = await this.requireTable().update(expected.id, record => {
      const current = asWorkNode(record)
      assertRef(current, expected)
      if (current.state === 'offline') return current
      return {
        ...withoutDegradedReason(current),
        revision: current.revision + 1,
        state: 'offline',
        updatedAt: new Date().toISOString(),
      }
    })
    const node = asWorkNode(next)
    this.emitChanged({ operation: 'offline', node, ref: refOf(node) })
    return node
  }

  /**
   * Read one node.
   * @param id - Work-node identity.
   * @returns current durable node or undefined.
   */
  get(id: WorkNodeId): WorkNode | undefined {
    const record = this.requireTable().get(id)
    return record === undefined ? undefined : asWorkNode(record)
  }

  /**
   * List nodes newest-heartbeat first.
   * @returns a fresh ordered array.
   */
  list(): WorkNode[] {
    return [...this.requireTable().entries()]
      .map(([, record]) => asWorkNode(record))
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || String(left.id).localeCompare(String(right.id)))
  }

  private requireTable(): KvTable<WorkNodeId, WorkNodeRecord> {
    if (this.table === undefined) throw new Error('work-node domain is not initialized')
    return this.table
  }

  private emitChanged(change: WorkNodeChanged): void {
    try {
      this.ctx.emit('work-node/changed', change)
    } catch (error) {
      // The node report already committed; observers cannot retroactively reject it.
      this.ctx.logger.warn(`work-node: work-node/changed listener failed: ${String(error)}`)
    }
  }
}

/** Storage Domain already validated this record; narrow Zod optional output at the persistence boundary. */
function asWorkNode(record: WorkNodeRecord): WorkNode {
  return record as WorkNode
}

function refOf(node: WorkNode): WorkNodeRef {
  return { id: node.id, revision: node.revision }
}

function assertRef(current: WorkNode, expected: WorkNodeRef): void {
  if (current.revision !== expected.revision) {
    throw new WorkNodeConflictError(expected, current.revision)
  }
}

function withoutDegradedReason(node: WorkNode): Omit<WorkNode, 'degradedReason'> {
  const { degradedReason, ...rest } = node
  void degradedReason
  return rest
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new WorkNodeReportError(`${field} must not be empty`)
  return normalized
}

function requireProtocolVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WorkNodeReportError('protocolVersion must be a positive safe integer')
  }
  return value
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort()
}

function normalizeFeatures(values: readonly WorkNodeFeature[]): WorkNodeFeature[] {
  return [...new Set(values)].sort()
}

export default WorkNodeRegistry
