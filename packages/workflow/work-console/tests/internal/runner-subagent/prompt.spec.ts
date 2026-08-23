import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { WorkItemId } from '@deepseek-ai/dsh-work-control'
import type { TaskWorkItem } from '@deepseek-ai/dsh-work-control'
import { buildBoundedWorkPrompt, WORK_RUNNER_PROMPT_PREFIX, WorkPromptBudgetError } from '../src/index.ts'

function task(): TaskWorkItem {
  return {
    kind: 'task',
    id: WorkItemId('task-1'),
    revision: 3,
    title: '修复导航漂移',
    summary: '只处理当前定位链路',
    tags: [],
    priority: 'p0',
    status: 'running',
    taskType: 'bug-fix',
    workflow: {
      version: 1,
      stages: [
        { id: 'diagnose', title: '诊断', kind: 'diagnosis' },
        { id: 'verify', title: '真机验收', kind: 'validation' },
      ],
    },
    currentStageId: 'diagnose',
    validationPolicy: {
      version: 1,
      validators: [
        { kind: 'log-check', requirement: 'required', label: '检查定位日志' },
        { kind: 'user-acceptance', requirement: 'required', label: '人工真机确认' },
        { kind: 'static-check', requirement: 'advisory', label: '静态检查' },
      ],
    },
    validation: { state: 'pending', requiredPassed: 0, requiredTotal: 2 },
    createdAt: '2026-08-15T00:00:00.000Z',
    promotedAt: '2026-08-15T00:01:00.000Z',
    updatedAt: '2026-08-15T00:02:00.000Z',
  }
}

describe('bounded Task Context Package', () => {
  it('renders only current task facts, required acceptance, and normalized Handoff conclusions', () => {
    const prompt = buildBoundedWorkPrompt(task(), {
      completed: ['  已复现 ', '已复现', ''],
      facts: ['雷达 10Hz'],
      decisions: ['先不改地图'],
      constraints: ['必须真机验证'],
      references: ['logs/localizer.txt'],
      nextStep: '  检查 TF  ',
    }, 16_384)

    expect(prompt.text.startsWith(WORK_RUNNER_PROMPT_PREFIX)).toBe(true)
    expect(prompt.bytes).toBe(Buffer.byteLength(prompt.text, 'utf8'))
    const payload = JSON.parse(prompt.text.split('WORK_CONTEXT_JSON\n')[1] ?? '') as Record<string, unknown>
    expect(payload).toMatchObject({
      task: {
        id: 'task-1',
        title: '修复导航漂移',
        summary: '只处理当前定位链路',
        priority: 'p0',
        type: 'bug-fix',
        stage: { id: 'diagnose', title: '诊断', kind: 'diagnosis' },
        requiredAcceptance: ['log-check: 检查定位日志', 'user-acceptance: 人工真机确认'],
      },
      handoff: {
        completed: ['已复现'],
        facts: ['雷达 10Hz'],
        decisions: ['先不改地图'],
        constraints: ['必须真机验证'],
        references: ['logs/localizer.txt'],
        nextStep: '检查 TF',
      },
    })
  })

  it('enforces the byte ceiling on the complete rendered prompt without truncation', () => {
    const complete = buildBoundedWorkPrompt(task(), undefined, 16_384)
    expect(() => buildBoundedWorkPrompt(task(), undefined, complete.bytes)).not.toThrow()
    expect(() => buildBoundedWorkPrompt(task(), undefined, complete.bytes - 1)).toThrow(WorkPromptBudgetError)
  })

  it('rejects invalid budgets and inconsistent organized-task metadata', () => {
    expect(() => buildBoundedWorkPrompt(task(), undefined, 0)).toThrow(/positive safe integer/)
    const broken = { ...task(), currentStageId: 'missing' }
    expect(() => buildBoundedWorkPrompt(broken, undefined, 16_384)).toThrow(/absent from its workflow/)
  })
})
