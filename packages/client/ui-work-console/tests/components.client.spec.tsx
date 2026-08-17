// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  WorkConsoleSnapshot,
  WorkConsoleTaskDetail,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  WorkConsoleRootProps,
  WorkConsoleTriggerProps,
} from '../src/client/contract.ts'
import { WorkConsoleRoot, WorkConsoleTrigger } from '../src/client/WorkConsoleRoot.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => { vi.useRealTimers() })

const snapshot: WorkConsoleSnapshot = {
  generatedAt: '2026-08-17T01:00:00.000Z',
  resources: {
    nodes: { total: 2, online: 1, degraded: 0, offline: 1 },
    environments: { total: 2, ready: 1, degraded: 1, unavailable: 0 },
    runners: [
      { provider: 'codex', nodeCount: 1, onlineNodeCount: 1 },
      { provider: 'claude-code', nodeCount: 1, onlineNodeCount: 0 },
    ],
  },
  pending: { blockedTasks: 1, validationTasks: 1, pendingUserAcceptance: 1 },
  tasks: [
    {
      id: 'task-p0',
      revision: 4,
      title: '修复 G1 雷达漂移',
      summary: '检查定位漂移并验证修复。',
      tags: ['g1', 'navigation'],
      priority: 'p0',
      status: 'running',
      taskType: 'bug-fix',
      stage: { id: 'diagnosis', title: '问题诊断', kind: 'diagnosis' },
      execution: {
        threadCount: 2,
        runningThreadCount: 1,
        blockedThreadCount: 0,
        provider: 'codex',
        mode: 'one-shot',
        attemptStartedAt: '2026-08-17T01:01:00.000Z',
      },
      placement: {
        threadId: 'thread-1234567890',
        nodeId: 'node-pc2',
        nodeName: 'PC2',
        nodeState: 'online',
        environmentId: 'env-g1',
        environmentName: 'G1 Runtime',
        environmentState: 'ready',
        boundEnvironmentRevision: 1,
        currentEnvironmentRevision: 2,
        stale: true,
      },
      validation: { state: 'pending', requiredPassed: 0, requiredTotal: 2 },
      updatedAt: '2026-08-17T01:02:00.000Z',
    },
    {
      id: 'task-blocked',
      revision: 2,
      title: 'RAG 缓存优化',
      summary: '',
      tags: ['rag'],
      priority: 'p1',
      status: 'blocked',
      execution: {
        threadCount: 1,
        runningThreadCount: 0,
        blockedThreadCount: 1,
        provider: 'claude-code',
        mode: 'one-shot',
        lastStopReason: 'failed',
      },
      updatedAt: '2026-08-17T00:50:00.000Z',
    },
    {
      id: 'task-validation',
      revision: 3,
      title: '后台 UI 修复',
      summary: '等待视觉验收',
      tags: ['ui'],
      priority: 'p2',
      status: 'validation',
      execution: { threadCount: 1, runningThreadCount: 0, blockedThreadCount: 0 },
      validation: { state: 'failed', requiredPassed: 1, requiredTotal: 2, checkedAt: '2026-08-17T01:03:00.000Z' },
      updatedAt: '2026-08-17T01:03:00.000Z',
    },
  ],
}

const detail: WorkConsoleTaskDetail = {
  card: snapshot.tasks[0]!,
  threads: [
    {
      id: 'thread-1234567890',
      revision: 2,
      state: 'running',
      activeAttempt: {
        provider: 'codex',
        mode: 'one-shot',
        startedAt: '2026-08-17T01:01:00.000Z',
      },
      placement: snapshot.tasks[0]!.placement!,
      updatedAt: '2026-08-17T01:02:00.000Z',
    },
    {
      id: 'thread-blocked-1234567890',
      revision: 3,
      state: 'blocked',
      blocker: '等待设备',
      lastAttempt: {
        provider: 'claude-code',
        mode: 'one-shot',
        startedAt: '2026-08-17T00:30:00.000Z',
        finishedAt: '2026-08-17T00:40:00.000Z',
        stopReason: 'failed',
      },
      updatedAt: '2026-08-17T00:40:00.000Z',
    },
  ],
  environments: [
    {
      id: 'env-g1',
      revision: 2,
      name: 'G1 Runtime',
      state: 'ready',
      workspace: {
        path: '/workspace/g1',
        repository: 'https://example.invalid/g1.git',
        branch: 'fix/drift',
        commit: 'abcdef1234567890',
        dirty: true,
      },
      runtime: { os: 'ubuntu-22.04', arch: 'x64', versions: { python: '3.10' } },
      devices: ['livox-mid360'],
      capabilities: ['ros-noetic'],
    },
  ],
  validationGeneration: 2,
  validators: [
    {
      index: 0,
      kind: 'runtime-check',
      requirement: 'required',
      label: '定位运行检查',
      outcome: 'passed',
      source: 'automation',
      checkedAt: '2026-08-17T01:04:00.000Z',
      evidence: [
        { kind: 'log', label: '定位日志', reference: 'log://run/42', summary: '漂移未复现' },
      ],
    },
    {
      index: 1,
      kind: 'user-acceptance',
      requirement: 'required',
      label: '用户验收',
      evidence: [],
    },
  ],
}

const unusedGlobalHook = (() => { throw new Error('unused global hook') }) as never
const actions = {
  open: vi.fn(),
  close: vi.fn(),
  selectTask: vi.fn(),
}

function rootProps(overrides: Partial<WorkConsoleRootProps> = {}): WorkConsoleRootProps {
  const viewState = { open: true, selectedTaskId: 'task-p0' }
  const remoteState = {
    loading: false,
    detailLoading: false,
    error: undefined,
    snapshot,
    detailTaskId: 'task-p0',
    detail,
  }
  return {
    useSessions: unusedGlobalHook,
    useWorkspaces: unusedGlobalHook,
    useStore: select => select(viewState),
    actions,
    useWorkConsole: select => select(remoteState),
    openConsole: vi.fn(),
    closeConsole: vi.fn(),
    refreshConsole: vi.fn(),
    selectTask: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  }
}

describe('WorkConsoleTrigger', () => {
  it('opens the global surface from the wide sidebar and preserves current selection', () => {
    const openConsole = vi.fn()
    const props: WorkConsoleTriggerProps = {
      useSessions: unusedGlobalHook,
      useWorkspaces: unusedGlobalHook,
      wide: true,
      useStore: select => select({ open: false, selectedTaskId: 'task-p0' }),
      actions,
      useWorkConsole: (() => { throw new Error('unused remote hook') }) as never,
      openConsole,
      closeConsole: vi.fn(),
      refreshConsole: vi.fn(),
      selectTask: vi.fn(),
      clearError: vi.fn(),
    }
    render(<WorkConsoleTrigger {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '全局工作台' }))
    expect(openConsole).toHaveBeenCalledWith('task-p0')
    expect(screen.getByText('全局工作台')).toBeTruthy()
  })

  it('closes an already-open rail surface', () => {
    const closeConsole = vi.fn()
    const props = rootProps({ closeConsole }) as WorkConsoleTriggerProps
    render(<WorkConsoleTrigger {...props} wide={false} />)
    const trigger = screen.getByRole('button', { name: '全局工作台' })
    expect(trigger.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(trigger)
    expect(closeConsole).toHaveBeenCalledOnce()
  })
})

describe('WorkConsoleRoot', () => {
  it('renders global resources, P0 facts, stale Environment, threads and current-generation Evidence', () => {
    render(<WorkConsoleRoot {...rootProps()} />)
    expect(screen.getByRole('dialog', { name: '持续工作控制台' })).toBeTruthy()
    expect(screen.getByText('Nodes')).toBeTruthy()
    expect(screen.getByText('Pending Center')).toBeTruthy()
    expect(screen.getAllByText('修复 G1 雷达漂移').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('P0 紧急').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('ENV STALE').length).toBeGreaterThan(0)
    expect(screen.getByText('Validation · Gen 2')).toBeTruthy()
    expect(screen.getByText('log://run/42')).toBeTruthy()
    expect(screen.getByText('/workspace/g1')).toBeTruthy()
    expect(screen.getByText('等待设备')).toBeTruthy()
  })

  it('filters by search, priority, Runner and Node without changing Host facts', () => {
    render(<WorkConsoleRoot {...rootProps()} />)
    const board = within(screen.getByRole('region', { name: '全局任务看板' }))
    const search = screen.getByPlaceholderText('搜索任务 / Stage / Runner / Node')
    fireEvent.change(search, { target: { value: 'RAG' } })
    expect(board.getByText('RAG 缓存优化')).toBeTruthy()
    expect(board.queryByText('修复 G1 雷达漂移')).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0]!, { target: { value: 'p1' } })
    expect(board.getByText('RAG 缓存优化')).toBeTruthy()
    expect(board.queryByText('后台 UI 修复')).toBeNull()
    fireEvent.change(selects[0]!, { target: { value: 'all' } })
    fireEvent.change(selects[1]!, { target: { value: 'codex' } })
    expect(board.getByText('修复 G1 雷达漂移')).toBeTruthy()
    expect(board.queryByText('RAG 缓存优化')).toBeNull()
    fireEvent.change(selects[1]!, { target: { value: 'all' } })
    fireEvent.change(selects[2]!, { target: { value: 'PC2' } })
    expect(board.getByText('修复 G1 雷达漂移')).toBeTruthy()
    expect(board.queryByText('后台 UI 修复')).toBeNull()
  })

  it('requests Task Detail from a clicked card, refreshes manually, clears errors, and closes', () => {
    const selectTask = vi.fn()
    const refreshConsole = vi.fn()
    const clearError = vi.fn()
    const closeConsole = vi.fn()
    const props = rootProps({
      selectTask,
      refreshConsole,
      clearError,
      closeConsole,
      useWorkConsole: select => select({
        loading: false,
        detailLoading: false,
        error: 'transport failed',
        snapshot,
        detailTaskId: 'task-p0',
        detail,
      }),
    })
    render(<WorkConsoleRoot {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /RAG 缓存优化/ }))
    expect(selectTask).toHaveBeenCalledWith('task-blocked')
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(refreshConsole).toHaveBeenCalledWith('task-p0')
    fireEvent.click(screen.getByText('关闭', { selector: 'button' }))
    expect(clearError).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '关闭工作台' }))
    expect(closeConsole).toHaveBeenCalledOnce()
  })

  it('polls only while open and closes on Escape', () => {
    vi.useFakeTimers()
    const refreshConsole = vi.fn()
    const closeConsole = vi.fn()
    const view = render(<WorkConsoleRoot {...rootProps({ refreshConsole, closeConsole })} />)
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(refreshConsole).toHaveBeenCalledWith('task-p0')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeConsole).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('renders closed and loading/empty states without inventing task facts', () => {
    const { rerender } = render(<WorkConsoleRoot {...rootProps({
      useStore: select => select({ open: false, selectedTaskId: null }),
    })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<WorkConsoleRoot {...rootProps({
      useStore: select => select({ open: true, selectedTaskId: null }),
      useWorkConsole: select => select({
        loading: true,
        detailLoading: false,
        error: undefined,
        snapshot: undefined,
        detailTaskId: undefined,
        detail: undefined,
      }),
    })} />)
    expect(screen.getByText('正在读取全局资源事实…')).toBeTruthy()
    expect(screen.getByText('选择一个 Task 查看执行与验收事实')).toBeTruthy()
  })
})
