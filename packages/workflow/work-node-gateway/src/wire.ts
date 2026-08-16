/**
 * JSON wire validation for the authenticated remote-node HTTP protocol.
 * @module @deepseek-ai/dsh-work-node-gateway/src/wire
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { workEnvironmentSnapshot } from '@deepseek-ai/dsh-work-environment'
import type { RemoteNodeCommandId } from './types.ts'

const feature = z.enum([
  'execute',
  'cancel',
  'resume',
  'usage',
  'tool-events',
  'environment-report',
  'mcp-stdio',
  'mcp-streamable-http',
])
const commandId = z.string().transform(value => value as RemoteNodeCommandId)

export const helloRequest = z.object({
  nodeKey: z.string(),
  name: z.string(),
  protocolVersion: z.number().int().positive(),
  runnerProviders: z.array(z.string()),
  features: z.array(feature),
}).strict()

const environmentReport = z.object({
  key: z.string(),
  name: z.string(),
  state: z.enum(['ready', 'degraded', 'unavailable']).optional(),
  degradedReason: z.string().optional(),
  snapshot: workEnvironmentSnapshot,
}).strict()

export const pollRequest = z.object({
  nodeKey: z.string(),
  nodeRevision: z.number().int().positive(),
  protocolVersion: z.number().int().positive(),
  runnerProviders: z.array(z.string()),
  features: z.array(feature),
  state: z.enum(['online', 'degraded']).optional(),
  degradedReason: z.string().optional(),
  environments: z.array(environmentReport),
}).strict()

export const ackRequest = z.object({
  nodeKey: z.string(),
  commandId,
  accepted: z.boolean(),
  subagentSessionId: z.string().transform(SessionId).optional(),
}).strict()

export const resultRequest = z.object({
  nodeKey: z.string(),
  commandId,
  stopReason: z.enum(['completed', 'failed', 'cancelled', 'interrupted', 'refused', 'limit', 'unknown']),
}).strict()
