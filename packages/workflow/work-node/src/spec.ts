/**
 * Durable work-node domain declaration.
 * @module @deepseek-ai/dsh-work-node/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkNodeId } from './types.ts'

const workNodeId = z.string().transform(value => value as WorkNodeId)
const workNodeFeature = z.enum([
  'execute',
  'cancel',
  'resume',
  'usage',
  'tool-events',
  'environment-report',
  'mcp-stdio',
  'mcp-streamable-http',
])

/** Durable work-node record schema. */
export const workNodeRecord = z.object({
  id: workNodeId,
  revision: z.number().int().positive(),
  name: z.string(),
  state: z.enum(['online', 'degraded', 'offline']),
  protocolVersion: z.number().int().positive(),
  runnerProviders: z.array(z.string()),
  features: z.array(workNodeFeature),
  degradedReason: z.string().optional(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Stored node record inferred from {@link workNodeRecord}. */
export type WorkNodeRecord = z.infer<typeof workNodeRecord>

/** One durable registry table keyed by {@link WorkNodeId}. */
export const workNodeDomainSpec = defineDomain({
  name: 'work-node',
  version: 1,
  tables: {
    nodes: domainTable<WorkNodeId, WorkNodeRecord>(workNodeRecord),
  },
})
