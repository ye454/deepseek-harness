/**
 * Durable remote-node gateway domain declaration.
 * @module @deepseek-ai/dsh-work-node-gateway/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { workEnvironmentSnapshot } from '@deepseek-ai/dsh-work-environment'
import type { ExecutionThreadId } from '@deepseek-ai/dsh-work-execution'
import type { WorkEnvironmentId } from '@deepseek-ai/dsh-work-environment'
import type { WorkNodeId } from '@deepseek-ai/dsh-work-node'
import type { RemoteNodeCommandId } from './types.ts'

const commandId = z.string().transform(value => value as RemoteNodeCommandId)
const nodeId = z.string().transform(value => value as WorkNodeId)
const environmentId = z.string().transform(value => value as WorkEnvironmentId)
const threadId = z.string().transform(value => value as ExecutionThreadId)
const commandState = z.enum(['queued', 'accepted', 'settled', 'rejected'])
const stopReason = z.enum(['completed', 'failed', 'cancelled', 'interrupted', 'refused', 'limit', 'unknown'])

const executePayload = z.object({
  threadId,
  threadRevision: z.number().int().positive(),
  environmentId,
  environmentRevision: z.number().int().positive(),
  runnerProvider: z.string(),
  mode: z.enum(['one-shot', 'continuable']),
  prompt: z.string(),
  promptBytes: z.number().int().nonnegative(),
  resumeSessionId: z.string().transform(SessionId).optional(),
})

const cancelPayload = z.object({
  threadId,
  attemptSeq: z.number().int().positive(),
})

const baseCommand = {
  id: commandId,
  nodeId,
  state: commandState,
  createdAt: z.string(),
  updatedAt: z.string(),
  settledAt: z.string().optional(),
}

/** Durable gateway command schema. */
export const remoteNodeCommandRecord = z.discriminatedUnion('kind', [
  z.object({
    ...baseCommand,
    kind: z.literal('execute'),
    payload: executePayload,
    acceptedThreadRevision: z.number().int().positive().optional(),
    resultStopReason: stopReason.optional(),
  }),
  z.object({
    ...baseCommand,
    kind: z.literal('resume'),
    payload: executePayload,
    acceptedThreadRevision: z.number().int().positive().optional(),
    resultStopReason: stopReason.optional(),
  }),
  z.object({
    ...baseCommand,
    kind: z.literal('cancel'),
    payload: cancelPayload,
  }),
])

/** Stable configured node-key identity schema. */
export const remoteNodeIdentityRecord = z.object({
  nodeKey: z.string(),
  nodeId,
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Stable node-local environment-key identity schema. */
export const remoteEnvironmentIdentityRecord = z.object({
  key: z.string(),
  nodeKey: z.string(),
  environmentKey: z.string(),
  environmentId,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type RemoteNodeCommandRecord = z.infer<typeof remoteNodeCommandRecord>
export type RemoteNodeIdentityRecord = z.infer<typeof remoteNodeIdentityRecord>
export type RemoteEnvironmentIdentityRecord = z.infer<typeof remoteEnvironmentIdentityRecord>

/** Durable identity and command queue for the HTTP pull gateway. */
export const workNodeGatewayDomainSpec = defineDomain({
  name: 'work-node-gateway',
  version: 1,
  tables: {
    nodes: domainTable<string, RemoteNodeIdentityRecord>(remoteNodeIdentityRecord),
    environments: domainTable<string, RemoteEnvironmentIdentityRecord>(remoteEnvironmentIdentityRecord),
    commands: domainTable<RemoteNodeCommandId, RemoteNodeCommandRecord>(remoteNodeCommandRecord),
  },
})

export { workEnvironmentSnapshot }
