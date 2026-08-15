/**
 * Durable execution-thread storage declaration.
 * @module @deepseek-ai/dsh-execution-thread/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkItemId } from '@deepseek-ai/dsh-work-control'
import type { ExecutionThreadId } from './types.ts'

const executionThreadId = z.string().transform(value => value as ExecutionThreadId)
const workItemId = z.string().transform(WorkItemId)
const sessionId = z.string().transform(SessionId)

/** Durable execution-thread record schema. */
export const executionThreadRecord = z.object({
  id: executionThreadId,
  revision: z.number().int().positive(),
  workItemId,
  provider: z.string().min(1),
  label: z.string().min(1),
  parentSessionId: sessionId,
  childSessionId: sessionId.optional(),
  state: z.enum(['starting', 'running', 'paused', 'blocked', 'completed', 'failed', 'cancelled']),
  handoff: z.object({
    summary: z.string(),
    nextStep: z.string(),
    updatedAt: z.string(),
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Durable execution-thread record inferred from the boundary schema. */
export type ExecutionThreadRecord = z.infer<typeof executionThreadRecord>

/** One global execution-thread table. */
export const executionThreadDomainSpec = defineDomain({
  name: 'execution-thread',
  version: 1,
  tables: {
    threads: domainTable<ExecutionThreadId, ExecutionThreadRecord>(executionThreadRecord),
  },
})
