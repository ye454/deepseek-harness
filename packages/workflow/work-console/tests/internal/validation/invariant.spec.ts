import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { WorkItemId } from '@deepseek-ai/dsh-work-control'
import type WorkValidationService from '../src/index.ts'
import type { WorkValidationSession, WorkValidatorResult } from '../src/index.ts'
import * as WorkValidationInvariant from '../src/invariant.ts'

const taskId = WorkItemId('task-1')

const session: WorkValidationSession = {
  taskId,
  generation: 2,
  startedTaskRevision: 7,
  policyFingerprint: 'fingerprint-2',
  startedAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
}

const result: WorkValidatorResult = {
  taskId,
  generation: 2,
  validatorIndex: 0,
  validatorKind: 'smoke-test',
  requirement: 'required',
  label: 'Smoke test',
  outcome: 'passed',
  source: 'automation',
  evidence: [{ kind: 'test', label: 'CI', reference: 'ci:42' }],
  revision: 3,
  checkedAt: '2026-08-16T00:01:00.000Z',
  updatedAt: '2026-08-16T00:01:00.000Z',
}

async function setup(currentSession?: WorkValidationSession, currentResult?: WorkValidatorResult): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workValidation', {
    getSession: () => currentSession,
    listResults: () => currentResult === undefined ? [] : [currentResult],
  } as WorkValidationService)
  await ctx.plugin(WorkValidationInvariant)
  return ctx
}

describe('work-validation durable projection invariant', () => {
  it('accepts matching committed session and result events', async () => {
    const ctx = await setup(session, result)
    expect(() => { ctx.emit('work-validation/session-changed', { session }) }).not.toThrow()
    expect(() => { ctx.emit('work-validation/result-changed', { result }) }).not.toThrow()
  })

  it('rejects stale or divergent validation facts', async () => {
    const ctx = await setup(session, result)
    expect(() => {
      ctx.emit('work-validation/session-changed', {
        session: { ...session, generation: session.generation - 1 },
      })
    }).toThrow(/does not match/)
    expect(() => {
      ctx.emit('work-validation/result-changed', {
        result: { ...result, outcome: 'failed' },
      })
    }).toThrow(/does not match/)
  })
})
