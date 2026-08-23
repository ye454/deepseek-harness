import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService from '../src/internal/control/index.ts'
import WorkExecutionService from '../src/internal/execution/index.ts'
import WorkEnvironmentRegistry from '../src/internal/environment/index.ts'
import WorkNodeRegistry from '../src/internal/node/index.ts'
import WorkValidationService from '../src/internal/validation/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkConsoleGateway from '../src/index.ts'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(WorkControlService)
  await ctx.plugin(WorkExecutionService)
  await ctx.plugin(WorkNodeRegistry)
  await ctx.plugin(WorkEnvironmentRegistry)
  await ctx.plugin(WorkValidationService)
  await ctx.plugin(WorkConsoleGateway)
  return ctx
}

async function validationTask(ctx: Context, title: string) {
  const idea = await ctx.workControl.createIdea({ title })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'custom',
    workflow: { version: 1, stages: [{ id: 'review', title: 'Review', kind: 'validation' }] },
    validationPolicy: {
      version: 1,
      validators: [
        { kind: 'smoke-test', requirement: 'required', label: 'Automated smoke' },
        { kind: 'user-acceptance', requirement: 'required', label: 'Human approval' },
      ],
    },
  })
}

async function humanOnlyTask(ctx: Context, title: string) {
  const idea = await ctx.workControl.createIdea({ title })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'custom',
    workflow: { version: 1, stages: [{ id: 'review', title: 'Review', kind: 'validation' }] },
    validationPolicy: {
      version: 1,
      validators: [{ kind: 'user-acceptance', requirement: 'required', label: 'Human approval' }],
    },
  })
}

function card(ctx: Context, taskId: string) {
  const result = ctx.workConsole.snapshot().tasks.find(task => task.id === taskId)
  if (result === undefined) throw new Error(`missing projected task ${taskId}`)
  return result
}

describe('WorkConsole automated -> human acceptance routing', () => {
  it('does not expose a human-only gate while the Task is still running', async () => {
    const ctx = await harness()
    const task = await humanOnlyTask(ctx, 'Still executing')

    expect(card(ctx, String(task.id)).validation).toMatchObject({
      acceptanceState: 'automated-pending',
      pendingUserAcceptance: 0,
    })
    expect(ctx.workConsole.snapshot().pending.pendingUserAcceptance).toBe(0)
    await ctx.fiber.dispose()
  })

  it('keeps human acceptance hidden while required automated validation has not passed', async () => {
    const ctx = await harness()
    let task = await validationTask(ctx, 'Automation pending')
    task = await ctx.workControl.setStatus({ id: task.id, revision: task.revision }, 'validation')

    expect(card(ctx, String(task.id)).validation).toMatchObject({
      acceptanceState: 'automated-pending',
      pendingUserAcceptance: 0,
    })
    expect(ctx.workConsole.snapshot().pending.pendingUserAcceptance).toBe(0)
    await ctx.fiber.dispose()
  })

  it('routes a Task to human acceptance only after required automation passes', async () => {
    const ctx = await harness()
    const task = await validationTask(ctx, 'Human ready')
    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [{ kind: 'test', label: 'smoke', reference: 'ci:smoke' }],
    })

    expect(card(ctx, String(task.id)).validation).toMatchObject({
      state: 'pending',
      acceptanceState: 'human-ready',
      pendingUserAcceptance: 1,
    })
    expect(ctx.workConsole.snapshot().pending.pendingUserAcceptance).toBe(1)
    await ctx.fiber.dispose()
  })

  it('keeps an automated failure out of the human acceptance queue', async () => {
    const ctx = await harness()
    const task = await validationTask(ctx, 'Automation failed')
    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'failed',
      evidence: [{ kind: 'test', label: 'smoke', reference: 'ci:failed' }],
    })

    expect(card(ctx, String(task.id)).validation).toMatchObject({
      state: 'failed',
      acceptanceState: 'automated-failed',
      pendingUserAcceptance: 0,
    })
    expect(ctx.workConsole.snapshot().pending.pendingUserAcceptance).toBe(0)
    await ctx.fiber.dispose()
  })

  it('marks acceptance fully passed after the explicit user decision', async () => {
    const ctx = await harness()
    const task = await validationTask(ctx, 'Accepted')
    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [{ kind: 'test', label: 'smoke', reference: 'ci:passed' }],
    })
    await ctx.workValidation.recordUserAcceptance({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 1,
      outcome: 'passed',
      actor: 'local-user',
    })

    expect(card(ctx, String(task.id)).validation).toMatchObject({
      state: 'passed',
      acceptanceState: 'passed',
      pendingUserAcceptance: 0,
    })
    await ctx.fiber.dispose()
  })
})
