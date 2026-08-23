import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkControlService, {
  WorkItemConflictError,
  WorkItemTransitionError,
  type TaskWorkItem,
  type ValidatorSpec,
} from '../src/internal/control/index.ts'
import WorkExecutionService from '../src/internal/execution/index.ts'
import WorkEnvironmentRegistry from '../src/internal/environment/index.ts'
import WorkNodeRegistry from '../src/internal/node/index.ts'
import WorkValidationService, { WorkValidationError } from '../src/internal/validation/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkConsoleGateway from '../src/index.ts'

let home = ''
let originalDshHome: string | undefined

beforeEach(() => {
  originalDshHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'dsh-work-console-commands-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  rmSync(home, { recursive: true, force: true })
})

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

function currentTask(ctx: Context, id: TaskWorkItem['id']): TaskWorkItem {
  const item = ctx.workControl.get(id)
  if (item?.kind !== 'task') throw new Error(`expected task ${id}`)
  return item
}

async function organizedTask(
  ctx: Context,
  title: string,
  validators: readonly ValidatorSpec[] = [],
): Promise<TaskWorkItem> {
  const idea = await ctx.workControl.createIdea({ title })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  return await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'custom',
    workflow: {
      version: 1,
      stages: [
        { id: 'run', title: 'Run', kind: 'implementation' },
        { id: 'accept', title: 'Accept', kind: 'validation' },
      ],
    },
    validationPolicy: { version: 1, validators },
  })
}

const AUTOMATION_AND_HUMAN: readonly ValidatorSpec[] = [
  { kind: 'smoke-test', requirement: 'required', label: 'Smoke' },
  { kind: 'user-acceptance', requirement: 'required', label: 'Human' },
]

async function beginWithAutomation(
  ctx: Context,
  title: string,
  outcome: 'passed' | 'failed',
) {
  const task = await organizedTask(ctx, title, AUTOMATION_AND_HUMAN)
  const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
  await ctx.workValidation.recordAutomatedResult({
    taskId: task.id,
    generation: session.generation,
    validatorIndex: 0,
    outcome,
    evidence: [{ kind: 'test', label: 'smoke', reference: `ci:${outcome}` }],
  })
  return { task: currentTask(ctx, task.id), session }
}

describe('WorkConsoleGateway promoteIdea', () => {
  it('promotes explicitly to organizing without doing organization work', async () => {
    const ctx = await harness()
    const idea = await ctx.workControl.createIdea({ title: 'Promote me' })
    const result = await ctx.workConsole.promoteIdea({ id: String(idea.id), revision: idea.revision, priority: 'p0' })
    expect(result).toMatchObject({
      ok: true,
      value: { id: String(idea.id), status: 'organizing', priority: 'p0' },
    })
    const item = ctx.workControl.get(idea.id)
    expect(item).toMatchObject({ kind: 'task', status: 'organizing', priority: 'p0' })
    expect(ctx.workExecution.list()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('uses P2 by default and rejects missing, stale, and already-promoted work', async () => {
    const ctx = await harness()
    const idea = await ctx.workControl.createIdea({ title: 'Default' })
    expect(await ctx.workConsole.promoteIdea({ id: 'missing', revision: 1 })).toMatchObject({
      ok: false, error: { code: 'not-found' },
    })
    expect(await ctx.workConsole.promoteIdea({ id: String(idea.id), revision: idea.revision + 1 })).toMatchObject({
      ok: false, error: { code: 'conflict', currentRevision: idea.revision },
    })
    const first = await ctx.workConsole.promoteIdea({ id: String(idea.id), revision: idea.revision })
    expect(first).toMatchObject({ ok: true, value: { priority: 'p2' } })
    const task = currentTask(ctx, idea.id)
    expect(await ctx.workConsole.promoteIdea({ id: String(task.id), revision: task.revision })).toMatchObject({
      ok: false, error: { code: 'invalid-state' },
    })
    await ctx.fiber.dispose()
  })

  it('maps promotion races and rethrows infrastructure failures', async () => {
    const ctx = await harness()
    const conflictIdea = await ctx.workControl.createIdea({ title: 'Race' })
    vi.spyOn(ctx.workControl, 'promoteIdea').mockRejectedValueOnce(
      new WorkItemConflictError({ id: conflictIdea.id, revision: conflictIdea.revision }, conflictIdea.revision + 1),
    )
    expect(await ctx.workConsole.promoteIdea({ id: String(conflictIdea.id), revision: conflictIdea.revision })).toMatchObject({
      ok: false, error: { code: 'conflict', currentRevision: conflictIdea.revision + 1 },
    })

    const stateIdea = await ctx.workControl.createIdea({ title: 'State race' })
    vi.spyOn(ctx.workControl, 'promoteIdea').mockRejectedValueOnce(new WorkItemTransitionError('promotion closed'))
    expect(await ctx.workConsole.promoteIdea({ id: String(stateIdea.id), revision: stateIdea.revision })).toMatchObject({
      ok: false, error: { code: 'invalid-state', reason: 'promotion closed' },
    })

    const brokenIdea = await ctx.workControl.createIdea({ title: 'Broken' })
    vi.spyOn(ctx.workControl, 'promoteIdea').mockRejectedValueOnce(new Error('storage down'))
    await expect(ctx.workConsole.promoteIdea({ id: String(brokenIdea.id), revision: brokenIdea.revision }))
      .rejects.toThrow('storage down')
    await ctx.fiber.dispose()
  })
})

describe('WorkConsoleGateway decideAcceptance', () => {
  it('rejects missing/idea/stale-revision/non-validation requests before mutation', async () => {
    const ctx = await harness()
    expect(await ctx.workConsole.decideAcceptance({
      taskId: 'missing', taskRevision: 1, generation: 1, validatorIndex: 0, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'not-found' } })

    const idea = await ctx.workControl.createIdea({ title: 'Idea' })
    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(idea.id), taskRevision: idea.revision, generation: 1, validatorIndex: 0, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'invalid-state' } })

    const running = await organizedTask(ctx, 'Running', [{ kind: 'user-acceptance', requirement: 'required', label: 'Human' }])
    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(running.id), taskRevision: running.revision + 1, generation: 1, validatorIndex: 0, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'conflict', currentRevision: running.revision } })
    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(running.id), taskRevision: running.revision, generation: 1, validatorIndex: 0, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'invalid-state', reason: 'task status is running' } })
    await ctx.fiber.dispose()
  })

  it('requires the current generation and a required user-acceptance validator', async () => {
    const ctx = await harness()
    const task = await organizedTask(ctx, 'Validator checks', [
      { kind: 'smoke-test', requirement: 'required', label: 'Smoke' },
      { kind: 'user-acceptance', requirement: 'optional', label: 'Optional human' },
      { kind: 'user-acceptance', requirement: 'required', label: 'Required human' },
    ])
    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    const current = currentTask(ctx, task.id)

    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(task.id), taskRevision: current.revision, generation: session.generation + 1, validatorIndex: 2, decision: 'accept',
    })).toMatchObject({
      ok: false,
      error: { code: 'stale-generation', currentGeneration: session.generation },
    })
    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(task.id), taskRevision: current.revision, generation: session.generation, validatorIndex: 0, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'invalid-validator', validatorIndex: 0 } })
    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(task.id), taskRevision: current.revision, generation: session.generation, validatorIndex: 1, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'invalid-validator', validatorIndex: 1 } })
    await ctx.fiber.dispose()
  })

  it('does not ask a human before required automation passes, and blocks automated failure', async () => {
    const ctx = await harness()
    const pending = await organizedTask(ctx, 'Pending', AUTOMATION_AND_HUMAN)
    const pendingSession = await ctx.workValidation.beginValidation({ id: pending.id, revision: pending.revision })
    const pendingCurrent = currentTask(ctx, pending.id)
    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(pending.id), taskRevision: pendingCurrent.revision, generation: pendingSession.generation, validatorIndex: 1, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'not-ready', reason: 'automated-pending' } })

    const failed = await beginWithAutomation(ctx, 'Failed', 'failed')
    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(failed.task.id), taskRevision: failed.task.revision, generation: failed.session.generation, validatorIndex: 1, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'not-ready', reason: 'automated-failed' } })
    await ctx.fiber.dispose()
  })

  it('accepts with a Host-owned harness-home actor and completes when every required gate passed', async () => {
    const ctx = await harness()
    const ready = await beginWithAutomation(ctx, 'Ready', 'passed')
    const result = await ctx.workConsole.decideAcceptance({
      taskId: String(ready.task.id), taskRevision: ready.task.revision, generation: ready.session.generation, validatorIndex: 1, decision: 'accept',
    })
    expect(result).toMatchObject({ ok: true, value: { status: 'done', decision: 'accept' } })
    expect(currentTask(ctx, ready.task.id).status).toBe('done')
    const user = ctx.workValidation.listResults(ready.task.id, ready.session.generation).find(item => item.validatorIndex === 1)
    expect(user).toMatchObject({ source: 'user', outcome: 'passed' })
    expect(user?.actor).toMatch(/^harness-home:[0-9a-f-]{36}$/i)
    await ctx.fiber.dispose()
  })

  it('keeps validation open when another required human gate still remains', async () => {
    const ctx = await harness()
    const validators: readonly ValidatorSpec[] = [
      { kind: 'smoke-test', requirement: 'required', label: 'Smoke' },
      { kind: 'user-acceptance', requirement: 'required', label: 'Human A' },
      { kind: 'user-acceptance', requirement: 'required', label: 'Human B' },
    ]
    const task = await organizedTask(ctx, 'Two humans', validators)
    const session = await ctx.workValidation.beginValidation({ id: task.id, revision: task.revision })
    await ctx.workValidation.recordAutomatedResult({
      taskId: task.id,
      generation: session.generation,
      validatorIndex: 0,
      outcome: 'passed',
      evidence: [{ kind: 'test', label: 'smoke', reference: 'ci:ok' }],
    })
    let current = currentTask(ctx, task.id)
    const first = await ctx.workConsole.decideAcceptance({
      taskId: String(task.id), taskRevision: current.revision, generation: session.generation, validatorIndex: 1, decision: 'accept',
    })
    expect(first).toMatchObject({ ok: true, value: { status: 'validation' } })

    current = currentTask(ctx, task.id)
    const second = await ctx.workConsole.decideAcceptance({
      taskId: String(task.id), taskRevision: current.revision, generation: session.generation, validatorIndex: 2, decision: 'accept',
    })
    expect(second).toMatchObject({ ok: true, value: { status: 'done' } })
    await ctx.fiber.dispose()
  })

  it('records a human rejection then returns the Task to execution with validation reset', async () => {
    const ctx = await harness()
    const ready = await beginWithAutomation(ctx, 'Return it', 'passed')
    const result = await ctx.workConsole.decideAcceptance({
      taskId: String(ready.task.id), taskRevision: ready.task.revision, generation: ready.session.generation, validatorIndex: 1, decision: 'return',
    })
    expect(result).toMatchObject({ ok: true, value: { status: 'running', decision: 'return' } })
    const running = currentTask(ctx, ready.task.id)
    expect(running.status).toBe('running')
    expect(running.validation).toEqual({ state: 'pending', requiredPassed: 0, requiredTotal: 2 })
    const user = ctx.workValidation.listResults(ready.task.id, ready.session.generation).find(item => item.validatorIndex === 1)
    expect(user).toMatchObject({ source: 'user', outcome: 'failed' })
    expect(user?.actor).toMatch(/^harness-home:[0-9a-f-]{36}$/i)
    await ctx.fiber.dispose()
  })

  it('maps validation races and propagates unexpected infrastructure failures', async () => {
    const ctx = await harness()
    const ready = await beginWithAutomation(ctx, 'Race', 'passed')
    vi.spyOn(ctx.workValidation, 'recordUserAcceptance').mockRejectedValueOnce(new WorkValidationError('validation changed'))
    expect(await ctx.workConsole.decideAcceptance({
      taskId: String(ready.task.id), taskRevision: ready.task.revision, generation: ready.session.generation, validatorIndex: 1, decision: 'accept',
    })).toMatchObject({ ok: false, error: { code: 'invalid-state', reason: 'validation changed' } })

    vi.spyOn(ctx.workValidation, 'recordUserAcceptance').mockRejectedValueOnce(new Error('storage exploded'))
    await expect(ctx.workConsole.decideAcceptance({
      taskId: String(ready.task.id), taskRevision: ready.task.revision, generation: ready.session.generation, validatorIndex: 1, decision: 'accept',
    })).rejects.toThrow('storage exploded')
    await ctx.fiber.dispose()
  })

  it('maps Work Control conflicts after accepted/rejected validation decisions', async () => {
    const acceptCtx = await harness()
    const accepted = await beginWithAutomation(acceptCtx, 'Done conflict', 'passed')
    vi.spyOn(acceptCtx.workControl, 'setStatus').mockRejectedValueOnce(new WorkItemConflictError(
      { id: accepted.task.id, revision: accepted.task.revision + 1 },
      accepted.task.revision + 2,
    ))
    const acceptResult = await acceptCtx.workConsole.decideAcceptance({
      taskId: String(accepted.task.id), taskRevision: accepted.task.revision, generation: accepted.session.generation, validatorIndex: 1, decision: 'accept',
    })
    expect(acceptResult).toMatchObject({ ok: false, error: { code: 'conflict' } })
    await acceptCtx.fiber.dispose()

    const returnCtx = await harness()
    const returned = await beginWithAutomation(returnCtx, 'Return conflict', 'passed')
    vi.spyOn(returnCtx.workControl, 'setStatus').mockRejectedValueOnce(new WorkItemConflictError(
      { id: returned.task.id, revision: returned.task.revision + 1 },
      returned.task.revision + 2,
    ))
    const returnResult = await returnCtx.workConsole.decideAcceptance({
      taskId: String(returned.task.id), taskRevision: returned.task.revision, generation: returned.session.generation, validatorIndex: 1, decision: 'return',
    })
    expect(returnResult).toMatchObject({ ok: false, error: { code: 'conflict' } })
    await returnCtx.fiber.dispose()
  })
})
