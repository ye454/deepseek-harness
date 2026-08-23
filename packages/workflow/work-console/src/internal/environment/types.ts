/**
 * Durable execution-environment vocabulary. This file contains types only.
 * @module @deepseek-ai/dsh-work-environment/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ExecutionThreadId } from '@deepseek-ai/dsh-work-execution'
import type { WorkNodeId } from '@deepseek-ai/dsh-work-node'

/** Stable identity of one named execution environment on a work node. */
export type WorkEnvironmentId = Branded<'WorkEnvironmentId'>

/** Compare-and-set identity for one exact environment revision. */
export interface WorkEnvironmentRef {
  readonly id: WorkEnvironmentId
  readonly revision: number
}

/** Whether the last reported environment can currently admit execution. */
export type WorkEnvironmentState = 'ready' | 'degraded' | 'unavailable'

/** Reproducible workspace/Git facts. */
export interface WorkspaceSnapshot {
  readonly path: string
  readonly repository?: string
  readonly branch?: string
  readonly commit?: string
  readonly worktree?: string
  readonly dirty?: boolean
}

/** Runtime facts needed for compatibility checks. */
export interface RuntimeSnapshot {
  readonly os: string
  readonly arch: string
  readonly shell?: string
  readonly versions: Readonly<Record<string, string>>
}

/** One named service observed in the environment. */
export interface EnvironmentServiceSnapshot {
  readonly name: string
  readonly state: 'running' | 'stopped' | 'degraded'
  readonly port?: number
}

/** Compact environment snapshot. Secret values and full process tables are deliberately excluded. */
export interface WorkEnvironmentSnapshot {
  readonly workspace: WorkspaceSnapshot
  readonly runtime: RuntimeSnapshot
  readonly services: readonly EnvironmentServiceSnapshot[]
  readonly devices: readonly string[]
  readonly capabilities: readonly string[]
  readonly secretRefs: readonly string[]
}

/** Durable environment record. */
export interface WorkEnvironment extends WorkEnvironmentRef {
  readonly nodeId: WorkNodeId
  readonly name: string
  readonly state: WorkEnvironmentState
  readonly snapshot: WorkEnvironmentSnapshot
  readonly degradedReason?: string
  readonly capturedAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Register one environment after a node reports a snapshot. */
export interface RegisterWorkEnvironmentRequest {
  readonly nodeId: WorkNodeId
  readonly name: string
  readonly state?: WorkEnvironmentState
  readonly degradedReason?: string
  readonly snapshot: WorkEnvironmentSnapshot
}

/** Replace the current snapshot for one existing environment. */
export interface RefreshWorkEnvironmentRequest {
  readonly state?: WorkEnvironmentState
  readonly degradedReason?: string
  readonly snapshot: WorkEnvironmentSnapshot
}

/** CAS identity of a thread-to-environment binding. */
export interface ThreadEnvironmentBindingRef {
  readonly threadId: ExecutionThreadId
  readonly revision: number
}

/** A thread is pinned to one exact environment revision until explicitly rebound. */
export interface ThreadEnvironmentBinding extends ThreadEnvironmentBindingRef {
  readonly environmentId: WorkEnvironmentId
  readonly environmentRevision: number
  readonly nodeId: WorkNodeId
  readonly boundAt: string
  readonly updatedAt: string
}

/** Scheduler-facing preflight issue. */
export type EnvironmentPreflightIssue =
  | 'binding-missing'
  | 'thread-missing'
  | 'thread-busy'
  | 'environment-missing'
  | 'environment-stale'
  | 'environment-degraded'
  | 'environment-unavailable'
  | 'node-missing'
  | 'node-degraded'
  | 'node-offline'
  | 'node-execute-unsupported'
  | 'runner-unavailable'

/** Compact scheduler result; detailed diagnostics remain in resource/environment views. */
export interface EnvironmentPreflightResult {
  readonly ok: boolean
  readonly issues: readonly EnvironmentPreflightIssue[]
}

/** Post-commit environment mutation. */
export interface WorkEnvironmentChanged {
  readonly operation: 'register' | 'refresh'
  readonly environment: WorkEnvironment
  readonly ref: WorkEnvironmentRef
}

/** Post-commit thread binding mutation. */
export interface ThreadEnvironmentBindingChanged {
  readonly binding: ThreadEnvironmentBinding
  readonly ref: ThreadEnvironmentBindingRef
}
