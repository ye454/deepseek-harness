/**
 * Durable worker-daemon command journal declaration.
 * @module @deepseek-ai/dsh-work-node-daemon/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { RemoteNodeCommandId } from '@deepseek-ai/dsh-work-node-gateway'

const commandId = z.string().transform(value => value as RemoteNodeCommandId)
const stopReason = z.enum(['completed', 'failed', 'cancelled', 'interrupted', 'refused', 'limit', 'unknown'])

/** Durable local journal record used to deduplicate at-least-once gateway delivery. */
export const workNodeDaemonJournalRecord = z.object({
  commandId,
  kind: z.enum(['execute', 'resume', 'cancel']),
  runnerProvider: z.string().optional(),
  state: z.enum(['starting', 'published', 'accepted', 'settled', 'rejected', 'interrupted']),
  sessionId: z.string().transform(SessionId).optional(),
  stopReason: stopReason.optional(),
  reportedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Durable journal value inferred from {@link workNodeDaemonJournalRecord}. */
export type WorkNodeDaemonJournalRecordValue = z.infer<typeof workNodeDaemonJournalRecord>

/** One local journal row per remote command id. */
export const workNodeDaemonDomainSpec = defineDomain({
  name: 'work-node-daemon',
  version: 1,
  tables: {
    commands: domainTable<RemoteNodeCommandId, WorkNodeDaemonJournalRecordValue>(workNodeDaemonJournalRecord),
  },
})
