// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkConsoleSnapshot, WorkConsoleTaskCard, WorkConsoleTaskDetail } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkConsoleRootProps } from '../src/client/contract.ts'
import { WorkConsoleRoot } from '../src/client/WorkConsoleRoot.tsx'

afterEach(cleanup)

const unusedGlobalHook = (() => { throw new Error('unused global hook') }) as never
const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }

function props(
  snapshot: WorkConsoleSnapshot,
  selectedTaskId: string | null,
  detail?: WorkConsoleTaskDetail,
  overrides: Partial<WorkConsoleRootProps> = {},
): WorkConsoleRootProps {
  return {
    useSessions: unusedGlobalHook,
    useWorkspaces: unusedGlobalHook,
    useStore: select => select({ open: true, selectedTaskId }),
    actions,
    useWorkConsole: select => select({
      loading: false,
      detailLoading: false,
      error: undefined,
      snapshot,
      detailTaskId: selectedTaskId ?? undefined,
      detail,
    }),
    openConsole: vi.fn(),
    closeConsole: vi.fn(),
    refreshConsole: vi.fn(),
    selectTask: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  }
}

function card(overrides: Partial<WorkConsoleTaskCard> & Pick<WorkConsoleTaskCard, 'id' | 'title' | 'priority' | 'status'>): WorkConsoleTaskCard {
  return {
    revision: 1,
    summary: '',
    tags: [],
    execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
    updatedAt: '2026-08-17T02:00:00.000Z',
    ...overrides,
  }
}

function snapshot(tasks: WorkConsoleTaskCard[], resources: WorkConsoleSnapshot['resources']): WorkConsoleSnapshot {
  return {
    generatedAt: '2026-08-17T02:00:00.000Z',
    tasks,
    resources,
    pending: { blockedTasks: 0, validationTasks: 0, pendingUserAcceptance: 0 },
  }
}

describe('WorkConsoleRoot branch matrix', () => {
  it('shows all Runner resources and truthful degraded/unavailable states', () => {
    const selected = card({
      id: 'task-degraded',
      title: '降级资源任务',
      priority: 'p1',
      status: 'done',
      execution: {
        threadCount: 1,
        runningThreadCount: 0,
        blockedThreadCount: 0,
        provider: 'runner-5',
        mode: 'one-shot',
      },
      placement: {
        threadId: 'thread-x',
        nodeId: 'node-fallback',
        nodeState: 'degraded',
        environmentId: 'env-fallback',
        environmentState: 'degraded',
        boundEnvironmentRevision: 1,
        currentEnvironmentRevision: 1,
        stale: false,
      },
      validation: { state: 'passed', requiredPassed: 1, requiredTotal: 1 },
    })
    const state = snapshot([selected], {
      nodes: { total: 2, online: 1, degraded: 1, offline: 0 },
      environments: { total: 2, ready: 1, degraded: 0, unavailable: 1 },
      runners: [1, 2, 3, 4, 5].map(index => ({
        provider: `runner-${index}`,
        nodeCount: 1,
        onlineNodeCount: index === 4 ? 0 : 1,
      })),
    })
    const detail: WorkConsoleTaskDetail = {
      card: selected,
      threads: [{ id: 'short', revision: 1, state: 'closed', updatedAt: '2026-08-17T02:00:00.000Z' }],
      environments: [{
        id: 'env-fallback',
        revision: 1,
        name: 'Minimal Env',
        state: 'ready',
        workspace: { path: '/work/minimal' },
        runtime: { os: 'linux', arch: 'x64', versions: {} },
        devices: [],
        capabilities: [],
      }],
      validators: [{
        index: 0,
        kind: 'runtime-check',
        requirement: 'required',
        label: '失败检查',
        outcome: 'failed',
        source: 'automation',
        checkedAt: '2026-08-17T02:00:00.000Z',
        evidence: [{ kind: 'log', label: 'log', reference: 'log://without-summary' }],
      }],
    }

    render(<WorkConsoleRoot {...props(state, selected.id, detail)} />)
    expect(screen.getByText('1 降级')).toBeTruthy()
    expect(screen.getByText('1 不可用')).toBeTruthy()
    expect(screen.getAllByText('runner-5').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('node-fallback').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('env-fallback').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('验收 1/1')).toBeTruthy()
    expect(screen.getByText('失败检查')).toBeTruthy()
    expect(screen.getByText('log://without-summary')).toBeTruthy()
    expect(screen.getByText('short')).toBeTruthy()
    expect(screen.getAllByText('完成').length).toBeGreaterThanOrEqual(2)
  })

  it('shows healthy resource labels and empty/fallback Task Detail facts', () => {
    const selected = card({ id: 'task-empty', title: '未组织任务', priority: 'p2', status: 'unclaimed' })
    const readyPlacement = card({
      id: 'task-ready',
      title: '就绪资源任务',
      priority: 'p1',
      status: 'running',
      placement: {
        threadId: 'thread-ready',
        nodeId: 'node-ready-id',
        nodeName: 'Node Ready',
        nodeState: 'online',
        environmentId: 'env-ready-id',
        environmentName: 'Env Ready',
        environmentState: 'ready',
        boundEnvironmentRevision: 2,
        currentEnvironmentRevision: 2,
        stale: false,
      },
    })
    const state = snapshot([selected, readyPlacement], {
      nodes: { total: 1, online: 1, degraded: 0, offline: 0 },
      environments: { total: 1, ready: 1, degraded: 0, unavailable: 0 },
      runners: [],
    })
    const detail: WorkConsoleTaskDetail = {
      card: selected,
      threads: [],
      environments: [],
      validators: [],
    }

    render(<WorkConsoleRoot {...props(state, selected.id, detail)} />)
    expect(screen.getByText('全部在线')).toBeTruthy()
    expect(screen.getByText('全部 Ready')).toBeTruthy()
    expect(screen.getByText('未分类')).toBeTruthy()
    expect(screen.getByText('未设置')).toBeTruthy()
    expect(screen.getByText('未运行')).toBeTruthy()
    expect(screen.getAllByText('未绑定')).toHaveLength(2)
    expect(screen.getByText('暂无 ExecutionThread')).toBeTruthy()
    expect(screen.getByText('当前 Task 没有独立验收项')).toBeTruthy()
    expect(screen.getByText('Environment · 0')).toBeTruthy()
    expect(screen.getAllByText('待认领').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('ENV STALE')).toBeNull()
  })

  it('renders a non-loading missing detail and ignores non-Escape keys', () => {
    const selected = card({ id: 'task-missing-detail', title: '详情缺失', priority: 'p2', status: 'running' })
    const state = snapshot([selected], {
      nodes: { total: 0, online: 0, degraded: 0, offline: 0 },
      environments: { total: 0, ready: 0, degraded: 0, unavailable: 0 },
      runners: [],
    })
    const closeConsole = vi.fn()
    render(<WorkConsoleRoot {...props(state, selected.id, undefined, { closeConsole })} />)
    expect(screen.getByText('Task Detail 暂不可用')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(closeConsole).not.toHaveBeenCalled()
  })
})
