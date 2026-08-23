/**
 * Durable execution-environment snapshots and explicit ExecutionThread binding.
 * @module @deepseek-ai/dsh-work-environment
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ExecutionThread, ExecutionThreadId, ExecutionThreadRef } from '@deepseek-ai/dsh-work-execution'
import type { WorkNode, WorkNodeId } from '@deepseek-ai/dsh-work-node'
import { workEnvironmentDomainSpec } from './spec.ts'
import type { ThreadEnvironmentBindingRecord, WorkEnvironmentRecord } from './spec.ts'
import type {
  EnvironmentPreflightIssue,
  EnvironmentPreflightResult,
  RefreshWorkEnvironmentRequest,
  RegisterWorkEnvironmentRequest,
  ThreadEnvironmentBinding,
  ThreadEnvironmentBindingChanged,
  ThreadEnvironmentBindingRef,
  WorkEnvironment,
  WorkEnvironmentChanged,
  WorkEnvironmentId as WorkEnvironmentIdBrand,
  WorkEnvironmentRef,
  WorkEnvironmentSnapshot,
  WorkEnvironmentState,
} from './types.ts'

export type {
  EnvironmentPreflightIssue,
  EnvironmentPreflightResult,
  EnvironmentServiceSnapshot,
  RefreshWorkEnvironmentRequest,
  RegisterWorkEnvironmentRequest,
  RuntimeSnapshot,
  ThreadEnvironmentBinding,
  ThreadEnvironmentBindingChanged,
  ThreadEnvironmentBindingRef,
  WorkEnvironment,
  WorkEnvironmentChanged,
  WorkEnvironmentRef,
  WorkEnvironmentSnapshot,
  WorkEnvironmentState,
  WorkspaceSnapshot,
} from './types.ts'
export { threadEnvironmentBindingRecord, workEnvironmentDomainSpec, workEnvironmentRecord, workEnvironmentSnapshot } from './spec.ts'

/** Stable work-environment identity. */
export type WorkEnvironmentId = WorkEnvironmentIdBrand

/** Brand a raw persisted string as a work-environment id. */
export function WorkEnvironmentId(id: string): WorkEnvironmentId {
  return id as WorkEnvironmentId
}

export class WorkEnvironmentNotFoundError extends Error {
  constructor(readonly id: WorkEnvironmentId) {
    super(`unknown work environment '${id}'`)
    this.name = 'WorkEnvironmentNotFoundError'
  }
}

export class WorkEnvironmentConflictError extends Error {
  constructor(readonly expected: WorkEnvironmentRef, readonly actualRevision: number) {
    super(`stale work environment '${expected.id}' revision ${expected.revision}; current revision is ${actualRevision}`)
    this.name = 'WorkEnvironmentConflictError'
  }
}

export class WorkEnvironmentReportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkEnvironmentReportError'
  }
}

export class ThreadEnvironmentBindingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThreadEnvironmentBindingError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workEnvironments: WorkEnvironmentRegistry
  }

  interface Events {
    /** @param change - Exact committed environment mutation. @mode emit */
    'work-environment/changed'(change: WorkEnvironmentChanged): void
    /** @param change - Exact committed thread binding mutation. @mode emit */
    'work-environment/binding-changed'(change: ThreadEnvironmentBindingChanged): void
  }
}

/** Durable environment registry and scheduler-facing preflight projection. */
export class WorkEnvironmentRegistry extends Service {
  static inject = ['storageDomain', 'workNodes', 'workExecution']

  private environments?: KvTable<WorkEnvironmentId, WorkEnvironmentRecord>
  private bindings?: KvTable<ExecutionThreadId, ThreadEnvironmentBindingRecord>

  constructor(ctx: Context) {
    super(ctx, 'workEnvironments')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workEnvironmentDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workEnvironments.domainClose')
    this.environments = domain.table('environments')
    this.bindings = domain.table('bindings')
  }

  /** Register a named environment from an authenticated node report. */
  async registerEnvironment(request: RegisterWorkEnvironmentRequest): Promise<WorkEnvironment> {
    this.requireReportingNode(request.nodeId)
    const state = request.state ?? 'ready'
    const degradedReason = resolveStateReason(state, request.degradedReason)
    const now = new Date().toISOString()
    const environment: WorkEnvironment = {
      id: WorkEnvironmentId(randomUUID()),
      revision: 1,
      nodeId: request.nodeId,
      name: requireText(request.name, 'environment name'),
      state,
      snapshot: normalizeSnapshot(request.snapshot),
      ...degradedReason === undefined ? {} : { degradedReason },
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    await this.requireEnvironmentTable().put(environment.id, environment)
    this.emitEnvironmentChanged({ operation: 'register', environment, ref: environmentRef(environment) })
    return environment
  }

  /** Replace the environment snapshot while preserving its stable identity. */
  async refreshEnvironment(
    expected: WorkEnvironmentRef,
    request: RefreshWorkEnvironmentRequest,
  ): Promise<WorkEnvironment> {
    const current = this.get(expected.id)
    if (current === undefined) throw new WorkEnvironmentNotFoundError(expected.id)
    this.requireReportingNode(current.nodeId)
    const state = request.state ?? 'ready'
    const degradedReason = resolveStateReason(state, request.degradedReason)
    const next = await this.requireEnvironmentTable().update(expected.id, record => {
      const environment = asEnvironment(record)
      assertEnvironmentRef(environment, expected)
      const now = new Date().toISOString()
      return {
        ...withoutDegradedReason(environment),
        revision: environment.revision + 1,
        state,
        snapshot: normalizeSnapshot(request.snapshot),
        ...degradedReason === undefined ? {} : { degradedReason },
        capturedAt: now,
        updatedAt: now,
      }
    })
    const environment = asEnvironment(next)
    this.emitEnvironmentChanged({ operation: 'refresh', environment, ref: environmentRef(environment) })
    return environment
  }

  /** Read one current environment. */
  get(id: WorkEnvironmentId): WorkEnvironment | undefined {
    const record = this.requireEnvironmentTable().get(id)
    return record === undefined ? undefined : asEnvironment(record)
  }

  /** List environments, optionally limited to one node. */
  list(nodeId?: WorkNodeId): WorkEnvironment[] {
    return [...this.requireEnvironmentTable().entries()]
      .map(([, record]) => asEnvironment(record))
      .filter(environment => nodeId === undefined || environment.nodeId === nodeId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || String(left.id).localeCompare(String(right.id)))
  }

  /**
   * Pin an inactive ExecutionThread to one exact environment revision. Rebinding is explicit;
   * later environment refreshes intentionally make the binding stale until this operation runs again.
   */
  async bindThread(threadRef: ExecutionThreadRef, environmentRefValue: WorkEnvironmentRef): Promise<ThreadEnvironmentBinding> {
    const thread = this.requireThread(threadRef)
    if (thread.state === 'running' || thread.state === 'closed' || thread.state === 'cancelled') {
      throw new ThreadEnvironmentBindingError(`thread '${thread.id}' cannot bind environment while state is ${thread.state}`)
    }
    const environment = this.get(environmentRefValue.id)
    if (environment === undefined) throw new WorkEnvironmentNotFoundError(environmentRefValue.id)
    assertEnvironmentRef(environment, environmentRefValue)

    const existing = this.requireBindingTable().get(thread.id)
    const now = new Date().toISOString()
    const binding: ThreadEnvironmentBinding = {
      threadId: thread.id,
      revision: existing === undefined ? 1 : existing.revision + 1,
      environmentId: environment.id,
      environmentRevision: environment.revision,
      nodeId: environment.nodeId,
      boundAt: existing?.boundAt ?? now,
      updatedAt: now,
    }
    await this.requireBindingTable().put(thread.id, binding)
    this.emitBindingChanged({ binding, ref: bindingRef(binding) })
    return binding
  }

  /** Return the current environment binding for one thread. */
  getBinding(threadId: ExecutionThreadId): ThreadEnvironmentBinding | undefined {
    const record = this.requireBindingTable().get(threadId)
    return record === undefined ? undefined : asBinding(record)
  }

  /**
   * Run a no-side-effect scheduler preflight over the current thread, pinned environment, and current node facts.
   * A stale environment revision is a hard failure rather than silently adopting new runtime state.
   */
  preflight(threadId: ExecutionThreadId, runnerProvider?: string): EnvironmentPreflightResult {
    const issues: EnvironmentPreflightIssue[] = []
    const thread = this.ctx.workExecution.get(threadId)
    if (thread === undefined) return result(['thread-missing'])
    if (thread.state !== 'idle') issues.push('thread-busy')

    const binding = this.getBinding(threadId)
    if (binding === undefined) return result([...issues, 'binding-missing'])
    const environment = this.get(binding.environmentId)
    if (environment === undefined) return result([...issues, 'environment-missing'])
    if (environment.revision !== binding.environmentRevision) issues.push('environment-stale')
    if (environment.state === 'degraded') issues.push('environment-degraded')
    if (environment.state === 'unavailable') issues.push('environment-unavailable')

    const node = this.ctx.workNodes.get(binding.nodeId)
    if (node === undefined) return result([...issues, 'node-missing'])
    if (node.state === 'degraded') issues.push('node-degraded')
    if (node.state === 'offline') issues.push('node-offline')
    if (!node.features.includes('execute')) issues.push('node-execute-unsupported')
    if (runnerProvider !== undefined && !node.runnerProviders.includes(runnerProvider)) issues.push('runner-unavailable')
    return result(issues)
  }

  private requireReportingNode(nodeId: WorkNodeId): WorkNode {
    const node = this.ctx.workNodes.get(nodeId)
    if (node === undefined) throw new WorkEnvironmentReportError(`unknown reporting node '${nodeId}'`)
    if (node.state === 'offline') throw new WorkEnvironmentReportError(`offline node '${nodeId}' cannot report an environment`)
    if (!node.features.includes('environment-report')) {
      throw new WorkEnvironmentReportError(`node '${nodeId}' does not advertise environment-report`)
    }
    return node
  }

  private requireThread(expected: ExecutionThreadRef): ExecutionThread {
    const thread = this.ctx.workExecution.get(expected.id)
    if (thread === undefined) throw new ThreadEnvironmentBindingError(`unknown execution thread '${expected.id}'`)
    if (thread.revision !== expected.revision) {
      throw new ThreadEnvironmentBindingError(
        `stale execution thread '${expected.id}' revision ${expected.revision}; current revision is ${thread.revision}`,
      )
    }
    return thread
  }

  private requireEnvironmentTable(): KvTable<WorkEnvironmentId, WorkEnvironmentRecord> {
    if (this.environments === undefined) throw new Error('work-environment domain is not initialized')
    return this.environments
  }

  private requireBindingTable(): KvTable<ExecutionThreadId, ThreadEnvironmentBindingRecord> {
    if (this.bindings === undefined) throw new Error('work-environment binding domain is not initialized')
    return this.bindings
  }

  private emitEnvironmentChanged(change: WorkEnvironmentChanged): void {
    try {
      this.ctx.emit('work-environment/changed', change)
    } catch (error) {
      this.ctx.logger.warn(`work-environment: changed listener failed: ${String(error)}`)
    }
  }

  private emitBindingChanged(change: ThreadEnvironmentBindingChanged): void {
    try {
      this.ctx.emit('work-environment/binding-changed', change)
    } catch (error) {
      this.ctx.logger.warn(`work-environment: binding listener failed: ${String(error)}`)
    }
  }
}

function asEnvironment(record: WorkEnvironmentRecord): WorkEnvironment {
  return record as WorkEnvironment
}

function asBinding(record: ThreadEnvironmentBindingRecord): ThreadEnvironmentBinding {
  return record as ThreadEnvironmentBinding
}

function environmentRef(environment: WorkEnvironment): WorkEnvironmentRef {
  return { id: environment.id, revision: environment.revision }
}

function bindingRef(binding: ThreadEnvironmentBinding): ThreadEnvironmentBindingRef {
  return { threadId: binding.threadId, revision: binding.revision }
}

function assertEnvironmentRef(current: WorkEnvironment, expected: WorkEnvironmentRef): void {
  if (current.revision !== expected.revision) {
    throw new WorkEnvironmentConflictError(expected, current.revision)
  }
}

function withoutDegradedReason(environment: WorkEnvironment): Omit<WorkEnvironment, 'degradedReason'> {
  const { degradedReason, ...rest } = environment
  void degradedReason
  return rest
}

function resolveStateReason(state: WorkEnvironmentState, value: string | undefined): string | undefined {
  if (state === 'ready') {
    if (value !== undefined) throw new WorkEnvironmentReportError('degradedReason is only valid for degraded/unavailable state')
    return undefined
  }
  return requireText(value ?? '', 'environment degraded reason')
}

function normalizeSnapshot(snapshot: WorkEnvironmentSnapshot): WorkEnvironmentSnapshot {
  const workspacePath = requireText(snapshot.workspace.path, 'workspace path')
  const os = requireText(snapshot.runtime.os, 'runtime os')
  const arch = requireText(snapshot.runtime.arch, 'runtime arch')
  const versions = Object.fromEntries(
    Object.entries(snapshot.runtime.versions)
      .map(([name, version]) => [requireText(name, 'runtime version name'), requireText(version, 'runtime version')])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  const services = [...snapshot.services]
    .map(service => ({ ...service, name: requireText(service.name, 'service name') }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    workspace: {
      ...snapshot.workspace,
      path: workspacePath,
      ...normalizeOptional(snapshot.workspace.repository, 'repository', 'repository'),
      ...normalizeOptional(snapshot.workspace.branch, 'branch', 'branch'),
      ...normalizeOptional(snapshot.workspace.commit, 'commit', 'commit'),
      ...normalizeOptional(snapshot.workspace.worktree, 'worktree', 'worktree'),
    },
    runtime: {
      ...snapshot.runtime,
      os,
      arch,
      ...normalizeOptional(snapshot.runtime.shell, 'shell', 'shell'),
      versions,
    },
    services,
    devices: normalizeStrings(snapshot.devices),
    capabilities: normalizeStrings(snapshot.capabilities),
    secretRefs: normalizeStrings(snapshot.secretRefs),
  }
}

function normalizeOptional(value: string | undefined, field: string, key: string): Record<string, string> {
  if (value === undefined) return {}
  return { [key]: requireText(value, field) }
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort()
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new WorkEnvironmentReportError(`${field} must not be empty`)
  return normalized
}

function result(issues: readonly EnvironmentPreflightIssue[]): EnvironmentPreflightResult {
  return { ok: issues.length === 0, issues: [...new Set(issues)] }
}

export default WorkEnvironmentRegistry
