/**
 * Durable evidence-backed validation storage declaration.
 * @module @deepseek-ai/dsh-work-validation/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkItemId } from '../control/index.ts'

const workItemId = z.string().transform(value => value as WorkItemId)
const validatorKind = z.enum([
  'automated-test', 'visual-model', 'runtime-check', 'log-check', 'benchmark',
  'device-test', 'static-check', 'artifact-check', 'smoke-test', 'user-acceptance',
])
const validatorRequirement = z.enum(['required', 'advisory', 'optional'])
const evidenceKind = z.enum([
  'test', 'command', 'log', 'benchmark', 'artifact', 'screenshot', 'device', 'runtime', 'git', 'url',
])

export const evidenceRefRecord = z.object({
  kind: evidenceKind,
  label: z.string().min(1),
  reference: z.string().min(1),
  summary: z.string().optional(),
})

export const workValidationSessionRecord = z.object({
  taskId: workItemId,
  generation: z.number().int().positive(),
  startedTaskRevision: z.number().int().positive(),
  policyFingerprint: z.string().min(1),
  startedAt: z.string(),
  updatedAt: z.string(),
})

export const workValidatorResultRecord = z.object({
  taskId: workItemId,
  generation: z.number().int().positive(),
  validatorIndex: z.number().int().nonnegative(),
  validatorKind,
  requirement: validatorRequirement,
  label: z.string().min(1),
  outcome: z.enum(['passed', 'failed']),
  source: z.enum(['automation', 'user']),
  actor: z.string().optional(),
  evidence: z.array(evidenceRefRecord).readonly(),
  note: z.string().optional(),
  revision: z.number().int().positive(),
  checkedAt: z.string(),
  updatedAt: z.string(),
})

export type WorkValidationSessionRecord = z.infer<typeof workValidationSessionRecord>
export type WorkValidatorResultRecord = z.infer<typeof workValidatorResultRecord>

/** One active generation per Task; result rows retain older generations for audit history. */
export const workValidationDomainSpec = defineDomain({
  name: 'work_validation',
  version: 1,
  tables: {
    sessions: domainTable<WorkItemId, WorkValidationSessionRecord>(workValidationSessionRecord),
    results: domainTable<string, WorkValidatorResultRecord>(workValidatorResultRecord),
  },
})
