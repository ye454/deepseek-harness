/**
 * Durable work-environment domain declaration.
 * @module @deepseek-ai/dsh-work-environment/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ExecutionThreadId } from '../execution/index.ts'
import type { WorkNodeId } from '../node/index.ts'
import type { WorkEnvironmentId } from './types.ts'

const workEnvironmentId = z.string().transform(value => value as WorkEnvironmentId)
const workNodeId = z.string().transform(value => value as WorkNodeId)
const executionThreadId = z.string().transform(value => value as ExecutionThreadId)

const workspaceSnapshot = z.object({
  path: z.string(),
  repository: z.string().optional(),
  branch: z.string().optional(),
  commit: z.string().optional(),
  worktree: z.string().optional(),
  dirty: z.boolean().optional(),
})

const runtimeSnapshot = z.object({
  os: z.string(),
  arch: z.string(),
  shell: z.string().optional(),
  versions: z.record(z.string(), z.string()),
})

const serviceSnapshot = z.object({
  name: z.string(),
  state: z.enum(['running', 'stopped', 'degraded']),
  port: z.number().int().min(1).max(65535).optional(),
})

/** Durable environment snapshot schema. */
export const workEnvironmentSnapshot = z.object({
  workspace: workspaceSnapshot,
  runtime: runtimeSnapshot,
  services: z.array(serviceSnapshot).readonly(),
  devices: z.array(z.string()).readonly(),
  capabilities: z.array(z.string()).readonly(),
  secretRefs: z.array(z.string()).readonly(),
})

/** Durable environment record schema. */
export const workEnvironmentRecord = z.object({
  id: workEnvironmentId,
  revision: z.number().int().positive(),
  nodeId: workNodeId,
  name: z.string(),
  state: z.enum(['ready', 'degraded', 'unavailable']),
  snapshot: workEnvironmentSnapshot,
  degradedReason: z.string().optional(),
  capturedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Durable thread binding schema. */
export const threadEnvironmentBindingRecord = z.object({
  threadId: executionThreadId,
  revision: z.number().int().positive(),
  environmentId: workEnvironmentId,
  environmentRevision: z.number().int().positive(),
  nodeId: workNodeId,
  boundAt: z.string(),
  updatedAt: z.string(),
})

export type WorkEnvironmentRecord = z.infer<typeof workEnvironmentRecord>
export type ThreadEnvironmentBindingRecord = z.infer<typeof threadEnvironmentBindingRecord>

/** Environment records plus one current binding per execution thread. */
export const workEnvironmentDomainSpec = defineDomain({
  name: 'work_environment',
  version: 1,
  tables: {
    environments: domainTable<WorkEnvironmentId, WorkEnvironmentRecord>(workEnvironmentRecord),
    bindings: domainTable<ExecutionThreadId, ThreadEnvironmentBindingRecord>(threadEnvironmentBindingRecord),
  },
})
