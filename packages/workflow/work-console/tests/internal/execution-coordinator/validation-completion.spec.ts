import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkItemId, type TaskWorkItem, type WorkControlService } from '@deepseek-ai/dsh-work-control'
import type { WorkExecutionService } from '@deepseek-ai/dsh-work-execution'
import type { WorkValidationService } from '@deepseek-ai/dsh-work-validation'
import type { WorkOrchestrator } from '@deepseek-ai/dsh-work-orchestrator'
import WorkExecutionCoordinator from '../src/index.ts'

function validationTask(withHumanGate: boolean): TaskWorkItem {
  return {
    kind: 'task',
    id: WorkItemId(withHumanGate ? 'human-validation' : 'auto-validation'),
    revision: 7,
    title: 'Validation task',
    summary: '',
    tags: [],
    priority: 'p1',
    status: 'validation',
    taskType: 'feature',
    workflow: { version: 1, stages: [{ id: 'validation', title: 'Validation', kind: 'validation' }] },
    currentStageId: 'validation',
    validationPolicy: {
      version: 1,
      validators: withHumanGate
        ? [
            { kind: 'automated-test', requirement: 'required', label: 'Tests' },
            { kind: 'user-acceptance', requirement: 'required', label: 'Human acceptance' },
          ]
        : [{ kind: 'automated-test', requirement: 'required', label: 'Tests' }],
    },
    validation: {
      state: 'passed',
      requiredPassed: withHumanGate ? 2 : 1,
      requiredTotal: withHumanGate ? 2 : 1,
      checkedAt: '2026-08-22T12:00:00.000Z',
    },
    createdAt: '2026-08-22T10:00:00.000Z',
    promotedAt: '2026-08-22T10:01:00.000Z',
    updatedAt: '2026-08-22T12:00:00.000Z',
  }
}

async function harness(task: TaskWorkItem) {
  const ctx = new Context()
  let current = task
  const setStatus = vi.fn(async (expected: { id: typeof task.id; revision: number }, status: TaskWorkItem['status']) => {
    expect(expected).toEqual({ id: current.id, revision: current.revision })
    current = { ...current, revision: current.revision + 1, status }
    return current
  })
  ctx.provide('workControl', {
    get: (id: typeof task.id) => id === current.id ? current : undefined,
    listTasks: () => [current],
    setStatus,
  } as unknown as WorkControlService)
  ctx.provide('workExecution', {
    list: () => [],
  } as unknown as WorkExecutionService)
  ctx.provide('workOrchestrator', {} as WorkOrchestrator)
  ctx.provide('workValidation', {} as WorkValidationService)
  await ctx.plugin(WorkExecutionCoordinator)
  return { ctx, setStatus, current: () => current }
}

describe('WorkExecutionCoordinator validation completion', () => {
  it('moves evidence-passed validation to done when no required human gate exists', async () => {
    const task = validationTask(false)
    const { ctx, setStatus, current } = await harness(task)
    const result = await ctx.workExecutionCoordinator.reconcile(task.id)
    expect(result).toMatchObject({ state: 'ignored', reason: 'validation-passed-automatically' })
    expect(setStatus).toHaveBeenCalledOnce()
    expect(current().status).toBe('done')
  })

  it('keeps validation open when a required human acceptance gate exists', async () => {
    const task = validationTask(true)
    const { ctx, setStatus, current } = await harness(task)
    const result = await ctx.workExecutionCoordinator.reconcile(task.id)
    expect(result).toMatchObject({ state: 'ignored', reason: 'task-validation' })
    expect(setStatus).not.toHaveBeenCalled()
    expect(current().status).toBe('validation')
  })
})
