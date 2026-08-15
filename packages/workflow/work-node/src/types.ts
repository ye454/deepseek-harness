/**
 * Remote work-node vocabulary. This file contains types only.
 * @module @deepseek-ai/dsh-work-node/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable remote/local worker-node identity. */
export type WorkNodeId = Branded<'WorkNodeId'>

/** Compare-and-set identity for one exact node revision. */
export interface WorkNodeRef {
  readonly id: WorkNodeId
  readonly revision: number
}

/** Administrative availability published by the node/gateway layer. */
export type WorkNodeState = 'online' | 'degraded' | 'offline'

/** Node-level features used by scheduling and transport preflight. */
export type WorkNodeFeature =
  | 'execute'
  | 'cancel'
  | 'resume'
  | 'usage'
  | 'tool-events'
  | 'environment-report'
  | 'mcp-stdio'
  | 'mcp-streamable-http'

/** Durable node projection. Runtime environment details belong to work-environment. */
export interface WorkNode extends WorkNodeRef {
  readonly name: string
  readonly state: WorkNodeState
  readonly protocolVersion: number
  readonly runnerProviders: readonly string[]
  readonly features: readonly WorkNodeFeature[]
  readonly degradedReason?: string
  readonly lastSeenAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Initial registration supplied by a node gateway after authentication/handshake. */
export interface RegisterWorkNodeRequest {
  readonly name: string
  readonly protocolVersion: number
  readonly runnerProviders?: readonly string[]
  readonly features?: readonly WorkNodeFeature[]
}

/** A successful heartbeat/capability refresh replaces the advertised runtime capabilities. */
export interface RefreshWorkNodeRequest {
  readonly protocolVersion: number
  readonly runnerProviders?: readonly string[]
  readonly features?: readonly WorkNodeFeature[]
  readonly state?: 'online' | 'degraded'
  readonly degradedReason?: string
}

/** Post-commit node change notification. */
export interface WorkNodeChanged {
  readonly operation: 'register' | 'refresh' | 'offline'
  readonly node: WorkNode
  readonly ref: WorkNodeRef
}
