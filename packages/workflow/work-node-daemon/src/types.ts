/**
 * Remote worker-daemon runner and environment vocabulary. This file contains types only.
 * @module @deepseek-ai/dsh-work-node-daemon/src/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ExecutionStopReason, RunnerMode } from '@deepseek-ai/dsh-work-execution'
import type { WorkEnvironmentSnapshot, WorkEnvironmentState } from '@deepseek-ai/dsh-work-environment'
import type { RemoteNodeCommand, RemoteNodeCommandId } from '@deepseek-ai/dsh-work-node-gateway'

/** Start request passed to one daemon-local Runner provider. */
export interface WorkNodeRunnerStartRequest {
  readonly commandId: RemoteNodeCommandId
  readonly prompt: string
  readonly cwd: string
  readonly signal: AbortSignal
  readonly mode: RunnerMode
  readonly resumeSessionId?: SessionId
}

/** Published daemon-local Runner handle. */
export interface WorkNodeRunnerHandle {
  /** Native session identity only when the provider truly supports continuable mode. */
  readonly sessionId?: SessionId
  /** Terminal runner result. The promise never rejects after publication. */
  readonly result: Promise<ExecutionStopReason>
  /** Request cooperative/forced cancellation of the owned Runner. */
  cancel(): void
  /** Tear the Runner down to quiescence. Idempotent. */
  dispose(): Promise<void>
}

/** Daemon-local Runner provider registered under one stable name. */
export interface WorkNodeRunnerProvider {
  readonly name: string
  /** Truthful modes this provider can execute on this daemon. */
  readonly modes: readonly RunnerMode[]
  /**
   * Publish one Runner or reject before publication. A continuable handle must return a session id;
   * a one-shot provider must not invent one merely for the gateway protocol.
   */
  start(request: WorkNodeRunnerStartRequest): Promise<WorkNodeRunnerHandle>
}

/** One configured local environment that the daemon reports to the gateway. */
export interface WorkNodeDaemonEnvironmentConfig {
  readonly key: string
  readonly name: string
  readonly workspacePath: string
  readonly capabilities?: readonly string[]
  readonly devices?: readonly string[]
  readonly secretRefs?: readonly string[]
}

/** One environment report prepared for a gateway poll. */
export interface WorkNodeDaemonEnvironmentReport {
  readonly key: string
  readonly name: string
  readonly state?: WorkEnvironmentState
  readonly degradedReason?: string
  readonly snapshot: WorkEnvironmentSnapshot
}

/** Daemon-local durable processing state for one remote command id. */
export type WorkNodeDaemonJournalState =
  | 'starting'
  | 'published'
  | 'accepted'
  | 'settled'
  | 'rejected'
  | 'interrupted'

/** Durable daemon record used for command-id deduplication and restart recovery. */
export interface WorkNodeDaemonJournalRecord {
  readonly commandId: RemoteNodeCommandId
  readonly kind: RemoteNodeCommand['kind']
  readonly runnerProvider?: string
  readonly state: WorkNodeDaemonJournalState
  readonly sessionId?: SessionId
  readonly stopReason?: ExecutionStopReason
  readonly createdAt: string
  readonly updatedAt: string
}

/** Daemon-side command lifecycle notification. */
export interface WorkNodeDaemonCommandChanged {
  readonly record: WorkNodeDaemonJournalRecord
}
