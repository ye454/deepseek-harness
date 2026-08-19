/**
 * Durable work-control storage declaration.
 * @module @deepseek-ai/dsh-work-control/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkItemId } from './types.ts'

const workItemId = z.string().transform(value => value as WorkItemId)
const taskPriority = z.enum(['p0', 'p1', 'p2'])
const taskStatus = z.enum(['organizing', 'running', 'blocked', 'validation', 'done', 'cancelled'])
const taskType = z.enum(['bug-fix', 'ui-fix', 'feature', 'performance', 'deployment', 'research', 'custom'])
const stageKind = z.enum([
  'diagnosis', 'research', 'experiment', 'design', 'implementation',
  'deployment', 'validation', 'conclusion', 'custom',
])
const validatorKind = z.enum([
  'automated-test', 'visual-model', 'runtime-check', 'log-check', 'benchmark',
  'device-test', 'static-check', 'artifact-check', 'smoke-test', 'user-acceptance',
])
const validatorRequirement = z.enum(['required', 'advisory', 'optional'])

export const workflowStageRecord = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: stageKind,
  description: z.string().optional(),
})

export const workflowPlanRecord = z.object({
  version: z.literal(1),
  stages: z.array(workflowStageRecord).min(1),
})

export const validatorSpecRecord = z.object({
  kind: validatorKind,
  requirement: validatorRequirement,
  label: z.string().min(1),
})

export const validationPolicyRecord = z.object({
  version: z.literal(1),
  validators: z.array(validatorSpecRecord),
})

export const validationSummaryRecord = z.object({
  state: z.enum(['pending', 'passed', 'failed']),
  checkedAt: z.string().optional(),
  requiredPassed: z.number().int().nonnegative(),
  requiredTotal: z.number().int().nonnegative(),
})

const common = {
  id: workItemId,
  title: z.string().min(1),
  summary: z.string(),
  tags: z.array(z.string()),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
}

export const ideaWorkItemRecord = z.object({
  kind: z.literal('idea'),
  ...common,
})

export const taskWorkItemRecord = z.object({
  kind: z.literal('task'),
  ...common,
  priority: taskPriority,
  status: taskStatus,
  taskType: taskType.optional(),
  workflow: workflowPlanRecord.optional(),
  currentStageId: z.string().min(1).optional(),
  validationPolicy: validationPolicyRecord.optional(),
  validation: validationSummaryRecord.optional(),
  promotedAt: z.string(),
})

export const workItemRecord = z.discriminatedUnion('kind', [ideaWorkItemRecord, taskWorkItemRecord])
export type WorkItemRecord = z.infer<typeof workItemRecord>

export const workControlDomainSpec = defineDomain({
  name: 'work-control',
  version: 1,
  tables: {
    items: domainTable<WorkItemId, WorkItemRecord>(workItemRecord),
  },
})
