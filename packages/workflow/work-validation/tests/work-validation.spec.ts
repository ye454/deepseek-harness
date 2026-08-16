import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService, { type TaskWorkItem, type WorkItemId } from '@deepseek-ai/dsh-work-control'
import WorkValidationService from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(WorkControlService)
  await ctx.plugin(WorkValidationService)
  return ctx
}

function currentTask(ctx: Context, id: WorkItemId): TaskWorkItem {
  const item = ctx.workControl.get(id)
  if (item?.kind !== 'task') throw new Error(`expected task '${id}'`)
  return item
}

async function taskWithUserGate(ctx: Context) {
  const idea = await ctx.workControl.createIdea({ title: 'Ship remote worker change' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority: 'p1' })
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'feature',
    workflow: {
      version: 1,
      stages: [
        { id: 'implement', title: 'Implement', kind: 'implementation' },
        { id: 'validate', title: 'Validate', kind: 'validation' },
      ],
    },
    validationPolicy: {
      version: 1,
      validators: [
        { kind: 'smoke-test', requirement: 'required', label: 'Remote worker smoke test' },
        { kind: 'user-acceptance', requirement: 'required', label: 'User accepts behavior' },
        { kind: 'log-check', requirement: 'optional', label: 'Inspect diagnostic logs' },
      ],
    },
  })
}

describe('work-validation evidence-backed completion', () => {
  it('keeps done blocked until automated evidence and explicit user acceptance both pass', async () => {
    const ctx = await harness()
    const task = await taskWithUserGate(ctx)
    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })

    expect(currentTask(ctx, task.id)).toMatchObject({
      status: 'validation',
      validation: { state: 'pending', requiredPassed: 0, requiredTotal: 2 },
    })

    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [{ kind: 'test', label: 'worker smoke', reference: 'ci:run-142' }],
    })
    let current = currentTask(ctx, task.id)
    expect(current).toMatchObject({ validation: { state: 'pending', requiredPassed: 1, requiredTotal: 2 } })
    await expect(
      ctx.workControl.setStatus({ id: task.id, revision: current.revision }, 'done'),
    ).rejects.toThrow(/cannot complete/)

    await ctx.workValidation.recordUserAcceptance({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 1,
      outcome: 'passed',
      actor: 'local-user',
      note: 'Behavior accepted in the task detail view',
    })
    current = currentTask(ctx, task.id)
    expect(current).toMatchObject({ validation: { state: 'passed', requiredPassed: 2, requiredTotal: 2 } })
    const done = await ctx.workControl.setStatus({ id: task.id, revision: current.revision }, 'done')
    expect(done.status).toBe('done')
    await ctx.fiber.dispose()
  })

  it('requires Evidence for automated judgments and prevents automation from satisfying user acceptance', async () => {
    const ctx = await harness()
    const task = await taskWithUserGate(ctx)
    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })

    await expect(ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [],
    })).rejects.toThrow(/at least one Evidence/)

    await expect(ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 1,
      outcome: 'passed',
      evidence: [{ kind: 'command', label: 'not a human decision', reference: 'cmd:1' }],
    })).rejects.toThrow(/user-acceptance/)

    expect(ctx.workValidation.listResults(task.id)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('starts a fresh generation so stale evidence cannot satisfy a later validation cycle', async () => {
    const ctx = await harness()
    const idea = await ctx.workControl.createIdea({ title: 'Validate repeatedly' })
    const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
    const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
      taskType: 'bug-fix',
      workflow: { version: 1, stages: [{ id: 'validate', title: 'Validate', kind: 'validation' }] },
      validationPolicy: {
        version: 1,
        validators: [{ kind: 'automated-test', requirement: 'required', label: 'Regression suite' }],
      },
    })

    const first = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: first.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [{ kind: 'test', label: 'regression', reference: 'ci:first' }],
    })
    let current = currentTask(ctx, task.id)
    expect(current.validation?.state).toBe('passed')

    const second = await ctx.workValidation.beginValidation({ id: task.id, revision: current.revision })
    expect(second.generation).toBe(first.generation + 1)
    current = currentTask(ctx, task.id)
    expect(current.validation).toMatchObject({ state: 'pending', requiredPassed: 0, requiredTotal: 1 })
    expect(ctx.workValidation.listResults(task.id)).toEqual([])
    expect(ctx.workValidation.listResults(task.id, first.generation)).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('projects required failure while advisory or optional outcomes do not become completion gates', async () => {
    const ctx = await harness()
    const task = await taskWithUserGate(ctx)
    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })

    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 2,
      outcome: 'failed',
      evidence: [{ kind: 'log', label: 'diagnostic warning', reference: 'log:worker-7' }],
    })
    expect(currentTask(ctx, task.id).validation?.state).toBe('pending')

    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'failed',
      evidence: [{ kind: 'test', label: 'worker smoke', reference: 'ci:failed-7' }],
    })
    expect(currentTask(ctx, task.id).validation).toMatchObject({
      state: 'failed', requiredPassed: 0, requiredTotal: 2,
    })
    await ctx.fiber.dispose()
  })
})
