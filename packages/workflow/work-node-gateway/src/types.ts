/**
 * Authenticated remote-node gateway vocabulary. This file contains types only.
 * @module @deepseek-ai/dsh-work-node-gateway/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ExecutionStopReason, ExecutionThreadId, RunnerMode } from '@deepseek-ai/dsh-work-execution'
import type { WorkEnvironmentId, WorkEnvironmentSnapshot, WorkEnvironmentState } from '@deepseek-ai/dsh-work-environment'
import type { WorkNodeFeature, WorkNodeId, WorkNodeState } from '@deepseek-ai/dsh-work-node'

/** Stable identity of one durable command delivered to a remote node. */
export type RemoteNodeCommandId = Branded<'RemoteNodeCommandId'>

/** Durable command lifecycle. */
export type RemoteNodeCommandState = 'queued' | 'accepted' | 'settled' | 'rejected'

/** Stable configured node-key to durable WorkNode binding. */
export interface RemoteNodeIdentity {
  readonly nodeKey: string
  readonly nodeId: WorkNodeId
  readonly createdAt: string
  readonly updatedAt: string
}

/** Stable remote environment-key to durable WorkEnvironment binding. */
export interface RemoteEnvironmentIdentity {
  readonly key: string
  readonly nodeKey: string
  readonly environmentKey: string
  readonly environmentId: WorkEnvironmentId
  readonly createdAt: string
  readonly updatedAt: string
}

/** Shared execution payload delivered for fresh or native-resume work. */
export interface RemoteExecutePayload {
  readonly threadId: ExecutionThreadId
  readonly threadRevision: number
  readonly environmentId: WorkEnvironmentId
  readonly environmentRevision: number
  readonly environmentKey: string
  readonly runnerProvider: string
  readonly mode: RunnerMode
  readonly prompt: string
  readonly promptBytes: number
  readonly resumeSessionId?: SessionId
}

/** Cancel request for the currently active remote attempt. */
export interface RemoteCancelPayload {
  readonly threadId: ExecutionThreadId
  readonly attemptSeq: number
}

/** One durable outbound command. */
export type RemoteNodeCommand =
  | {
      readonly id: RemoteNodeCommandId
      readonly nodeId: WorkNodeId
      readonly kind: 'execute' | 'resume'
      readonly state: RemoteNodeCommandState
      readonly payload: RemoteExecutePayload
      /** Child/native session published by the remote Runner after acceptance. */
      readonly publishedSessionId?: SessionId
      /** ExecutionThread revision immediately after the accepted attempt was recorded. */
      readonly acceptedThreadRevision?: number
      readonly resultStopReason?: ExecutionStopReason
      /** Stable machine-readable reason when delivery or remote admission rejects the command. */
      readonly failureCode?: string
      readonly createdAt: string
      readonly updatedAt: string
      readonly settledAt?: string
    }
  | {
      readonly id: RemoteNodeCommandId
      readonly nodeId: WorkNodeId
      readonly kind: 'cancel'
      readonly state: RemoteNodeCommandState
      readonly payload: RemoteCancelPayload
      readonly failureCode?: string
      readonly createdAt: string
      readonly updatedAt: string
      readonly settledAt?: string
    }

/** One environment report carried in a heartbeat/poll request. */
export interface RemoteEnvironmentReport {
  readonly key: string
  readonly name: string
  readonly state?: WorkEnvironmentState
  readonly degradedReason?: string
  readonly snapshot: WorkEnvironmentSnapshot
}

/** Initial authenticated handshake. */
export interface RemoteNodeHelloRequest {
  readonly nodeKey: string
  readonly name: string
  readonly protocolVersion: number
  readonly runnerProviders: readonly string[]
  readonly features: readonly WorkNodeFeature[]
}

/** Heartbeat plus environment refresh and command poll. */
export interface RemoteNodePollRequest {
  readonly nodeKey: string
  readonly nodeRevision: number
  readonly protocolVersion: number
  readonly runnerProviders: readonly string[]
  readonly features: readonly WorkNodeFeature[]
  readonly state?: Exclude<WorkNodeState, 'offline'>
  readonly degradedReason?: string
  readonly environments: readonly RemoteEnvironmentReport[]
}

/** A remote runner published or refused one queued command. */
export interface RemoteNodeAckRequest {
  readonly nodeKey: string
  readonly commandId: RemoteNodeCommandId
  readonly accepted: boolean
  readonly subagentSessionId?: SessionId
}

/** Terminal result for one accepted execute/resume command. */
export interface RemoteNodeResultRequest {
  readonly nodeKey: string
  readonly commandId: RemoteNodeCommandId
  readonly stopReason: ExecutionStopReason
}

/** Successful hello response. */
export interface RemoteNodeHelloResponse {
  readonly nodeId: WorkNodeId
  readonly nodeRevision: number
}

/** Successful heartbeat/poll response. */
export interface RemoteNodePollResponse {
  readonly nodeId: WorkNodeId
  readonly nodeRevision: number
  readonly commands: readonly RemoteNodeCommand[]
}
