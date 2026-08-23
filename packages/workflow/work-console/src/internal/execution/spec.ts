/**
 * Durable work-execution domain declaration.
 * @module @deepseek-ai/dsh-work-execution/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkItemId } from '@deepseek-ai/dsh-work-control'
import type { ExecutionThreadId } from './types.ts'

const executionThreadId = z.string().transform(value => value as ExecutionThreadId)
const workItemId = z.string().transform(WorkItemId)
const sessionId = z.string().transform(SessionId)

const runnerMode = z.enum(['one-shot', 'continuable'])
const stopReason = z.enum(['completed', 'failed', 'cancelled', 'interrupted', 'refused', 'limit', 'unknown'])

const activeAttempt = z.object({
  seq: z.number().int().positive(),
  provider: z.string(),
  mode: runnerMode,
  subagentSessionId: sessionId.optional(),
  stageId: z.string().optional(),
  startedAt: z.string(),
})

const settledAttempt = activeAttempt.extend({
  finishedAt: z.string(),
  stopReason,
})

/** Durable execution-thread record schema. */
export const executionThreadRecord = z.object({
  id: executionThreadId,
  revision: z.number().int().positive(),
  taskId: workItemId,
  state: z.enum(['idle', 'running', 'blocked', 'closed', 'cancelled']),
  attemptSeq: z.number().int().nonnegative(),
  activeAttempt: activeAttempt.optional(),
  lastAttempt: settledAttempt.optional(),
  blocker: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().optional(),
})

/** Stored record inferred from {@link executionThreadRecord}. */
export type ExecutionThreadRecord = z.infer<typeof executionThreadRecord>

/** One table keyed by {@link ExecutionThreadId}; attempt history is intentionally external. */
export const workExecutionDomainSpec = defineDomain({
  name: 'work-execution',
  version: 1,
  tables: {
    threads: domainTable<ExecutionThreadId, ExecutionThreadRecord>(executionThreadRecord),
  },
})
