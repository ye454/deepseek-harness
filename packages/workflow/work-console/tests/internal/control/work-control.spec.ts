import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkControlService, {
  WorkItemConflictError,
  isTaskStatusTransitionAllowed,
} from '../src/index.ts'
import type { TaskWorkItem, WorkItemRef } from '../src/index.ts'

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const fiber = await ctx.plugin(WorkControlService)
  return { ctx, pool, fiber, work: ctx.workControl }
}

function ref(item: { id: WorkItemRef['id']; revision: number }): WorkItemRef {
  return { id: item.id, revision: item.revision }
}

async function organizedTask(work: WorkControlService): Promise<TaskWorkItem> {
  const idea = await work.createIdea({ title: 'Ship dashboard', tags: [' ui ', 'ui', ''] })
  const promoted = await work.promoteIdea(ref(idea), { priority: 'p0' })
  return await work.organizeTask(ref(promoted), {
    taskType: 'ui-fix',
    workflow: {
      version: 1,
      stages: [
        { id: 'inspect', title: 'Inspect', kind: 'diagnosis' },
        { id: 'implement', title: 'Implement', kind: 'implementation' },
        { id: 'accept', title: 'Accept', kind: 'validation' },
      ],
    },
    validationPolicy: {
      version: 1,
      validators: [
        { kind: 'visual-model', requirement: 'required', label: 'AI visual review' },
        { kind: 'user-acceptance', requirement: 'required', label: 'Human acceptance' },
        { kind: 'static-check', requirement: 'advisory', label: 'Typecheck' },
      ],
    },
  })
}

describe('WorkControlService passive ideas and promotion', () => {
  it('captures a normalized passive idea and promotes the same id only on explicit request', async () => {
    const { work } = await harness()
    const idea = await work.createIdea({
      title: '  New navigation idea  ',
      summary: '  explore later  ',
      tags: [' robot ', 'robot', '', 'slam'],
    })

    expect(idea).toMatchObject({
      kind: 'idea',
      revision: 1,
      title: 'New navigation idea',
      summary: 'explore later',
      tags: ['robot', 'slam'],
    })
    expect(work.listIdeas()).toEqual([idea])
    expect(work.listTasks()).toEqual([])

    const task = await work.promoteIdea(ref(idea))
    expect(task.id).toBe(idea.id)
    expect(task).toMatchObject({ kind: 'task', revision: 2, priority: 'p2', status: 'organizing' })
    expect(work.listIdeas()).toEqual([])
    expect(work.listTasks()).toEqual([task])
  })

  it('rejects empty idea titles and stale compare-and-set revisions', async () => {
    const { work } = await harness()
    await expect(work.createIdea({ title: '   ' })).rejects.toThrow(/must not be empty/)

    const idea = await work.createIdea({ title: 'One' })
    const task = await work.promoteIdea(ref(idea))
    await expect(work.setPriority(ref(idea), 'p1')).rejects.toBeInstanceOf(WorkItemConflictError)
    await expect(work.promoteIdea(ref(task))).rejects.toThrow(/already a task/)
  })

  it('serializes delete and promote so one revision cannot land both transitions', async () => {
    const { work } = await harness()
    const idea = await work.createIdea({ title: 'Race' })
    const expected = ref(idea)
    const [promote, remove] = await Promise.allSettled([
      work.promoteIdea(expected, { priority: 'p1' }),
      work.deleteIdea(expected),
    ])

    expect(promote.status).toBe('fulfilled')
    expect(remove.status).toBe('rejected')
    expect(work.get(idea.id)?.kind).toBe('task')
  })

  it('deletes only passive ideas and reports unknown ids after deletion', async () => {
    const { work } = await harness()
    const idea = await work.createIdea({ title: 'Disposable' })
    await expect(work.deleteIdea(ref(idea))).resolves.toBe(true)
    expect(work.get(idea.id)).toBeUndefined()
    await expect(work.deleteIdea(ref(idea))).rejects.toThrow(/unknown work item/)
  })
})

describe('WorkControlService workflow and acceptance', () => {
  it('organizes a dynamic workflow, moves stages, and enforces status transitions', async () => {
    const { work } = await harness()
    const task = await organizedTask(work)
    expect(task).toMatchObject({
      status: 'running',
      priority: 'p0',
      taskType: 'ui-fix',
      currentStageId: 'inspect',
      validation: { state: 'pending', requiredPassed: 0, requiredTotal: 2 },
    })

    const staged = await work.setStage(ref(task), 'implement')
    expect(staged.currentStageId).toBe('implement')
    await expect(work.setStage(ref(staged), 'missing')).rejects.toThrow(/has no stage/)

    const blocked = await work.setStatus(ref(staged), 'blocked')
    await expect(work.setStatus(ref(blocked), 'done')).rejects.toThrow(/cannot move from blocked to done/)
    const resumed = await work.setStatus(ref(blocked), 'running')
    expect(resumed.status).toBe('running')
  })

  it('keeps required human acceptance as a hard Done gate after automated checks', async () => {
    const { work } = await harness()
    const task = await organizedTask(work)
    const validating = await work.setStatus(ref(task), 'validation')

    const aiPassed = await work.setValidationSummary(ref(validating), {
      state: 'pending',
      requiredPassed: 1,
      requiredTotal: 2,
      checkedAt: '2026-08-15T00:00:00.000Z',
    })
    await expect(work.setStatus(ref(aiPassed), 'done')).rejects.toThrow(/required validators pass/)

    const accepted = await work.setValidationSummary(ref(aiPassed), {
      state: 'passed',
      requiredPassed: 2,
      requiredTotal: 2,
      checkedAt: '2026-08-15T00:01:00.000Z',
    })
    const done = await work.setStatus(ref(accepted), 'done')
    expect(done.status).toBe('done')
    await expect(work.setPriority(ref(done), 'p1')).rejects.toThrow(/terminal task/)
  })

  it('rejects forged validation counts and premature passed summaries', async () => {
    const { work } = await harness()
    const task = await organizedTask(work)
    await expect(work.setValidationSummary(ref(task), {
      state: 'pending', requiredPassed: 0, requiredTotal: 1,
    })).rejects.toThrow(/does not match task policy/)
    await expect(work.setValidationSummary(ref(task), {
      state: 'passed', requiredPassed: 1, requiredTotal: 2,
    })).rejects.toThrow(/cannot pass/)
    await expect(work.setValidationSummary(ref(task), {
      state: 'pending', requiredPassed: 3, requiredTotal: 2,
    })).rejects.toThrow(/cannot exceed/)
  })

  it('rejects duplicate stages and empty validator labels before organization commits', async () => {
    const { work } = await harness()
    const idea = await work.createIdea({ title: 'Invalid plan' })
    const task = await work.promoteIdea(ref(idea))
    await expect(work.organizeTask(ref(task), {
      taskType: 'custom',
      workflow: {
        version: 1,
        stages: [
          { id: 'same', title: 'A', kind: 'custom' },
          { id: 'same', title: 'B', kind: 'custom' },
        ],
      },
      validationPolicy: { version: 1, validators: [] },
    })).rejects.toThrow(/duplicate workflow stage/)

    await expect(work.organizeTask(ref(task), {
      taskType: 'custom',
      workflow: { version: 1, stages: [{ id: 'one', title: 'One', kind: 'custom' }] },
      validationPolicy: {
        version: 1,
        validators: [{ kind: 'artifact-check', requirement: 'optional', label: '  ' }],
      },
    })).rejects.toThrow(/validator label/)
  })

  it('allows direct completion when the task policy has no required validators', async () => {
    const { work } = await harness()
    const idea = await work.createIdea({ title: 'No gate' })
    const task = await work.promoteIdea(ref(idea))
    const running = await work.organizeTask(ref(task), {
      taskType: 'custom',
      workflow: { version: 1, stages: [{ id: 'do', title: 'Do', kind: 'implementation' }] },
      validationPolicy: {
        version: 1,
        validators: [{ kind: 'static-check', requirement: 'advisory', label: 'Optional signal' }],
      },
    })
    await expect(work.setStatus(ref(running), 'done')).resolves.toMatchObject({ status: 'done' })
  })
})

describe('WorkControlService commit semantics', () => {
  it('contains change-listener failures after the durable commit', async () => {
    const { ctx, work } = await harness()
    ctx.on('work-control/changed', () => { throw new Error('observer failed') })
    const idea = await work.createIdea({ title: 'Committed anyway' })
    expect(work.get(idea.id)).toMatchObject({ title: 'Committed anyway' })
  })

  it('does not publish a record when the storage write rejects', async () => {
    const pool = new MemoryMediaPool()
    const { work } = await harness(pool)
    pool.failNextWrites = 1
    await expect(work.createIdea({ title: 'Must fail' })).rejects.toThrow(/injected write failure/)
    expect(work.listIdeas()).toEqual([])
  })

  it('exposes the explicit status-transition table', () => {
    expect(isTaskStatusTransitionAllowed('running', 'blocked')).toBe(true)
    expect(isTaskStatusTransitionAllowed('running', 'running')).toBe(true)
    expect(isTaskStatusTransitionAllowed('blocked', 'done')).toBe(false)
    expect(isTaskStatusTransitionAllowed('done', 'running')).toBe(false)
  })
})
