// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  WorkConsoleSnapshot,
  WorkConsoleTaskCard,
  WorkConsoleTaskDetail,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  WorkConsoleRootProps,
  WorkConsoleTriggerProps,
} from '../src/client/contract.ts'
import type { WorkConsoleRemoteState } from '../src/client/controller.ts'
import { WorkConsoleRoot, WorkConsoleTrigger } from '../src/client/WorkConsoleRoot.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const unusedGlobalHook = (() => { throw new Error('unused global hook') }) as never

function task(overrides: Partial<WorkConsoleTaskCard> & Pick<WorkConsoleTaskCard, 'id' | 'title' | 'priority' | 'status'>): WorkConsoleTaskCard {
  return {
    revision: 1,
    summary: '',
    tags: [],
    execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
    updatedAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  }
}

const running = task({
  id: 'task-running',
  title: 'G1 雷达漂移修复',
  summary: '定位漂移并验证修复。',
  tags: ['g1', 'navigation'],
  priority: 'p0',
  status: 'running',
  taskType: 'bug-fix',
  stage: { id: 'fix', title: '方案验证', kind: 'implementation' },
  execution: { threadCount: 2, runningThreadCount: 1, blockedThreadCount: 0, provider: 'codex', mode: 'one-shot' },
  placement: {
    threadId: 'thread-running-1234567890',
    nodeId: 'node-pc2',
    nodeName: 'PC2',
    nodeState: 'online',
    environmentId: 'env-g1',
    environmentName: 'G1 Runtime',
    environmentState: 'ready',
    boundEnvironmentRevision: 1,
    currentEnvironmentRevision: 1,
    stale: false,
  },
})

const blocked = task({
  id: 'task-blocked',
  title: 'RAG 缓存优化',
  priority: 'p1',
  status: 'blocked',
  execution: { threadCount: 1, runningThreadCount: 0, blockedThreadCount: 1, provider: 'claude-code', mode: 'one-shot' },
  placement: {
    threadId: 'thread-blocked',
    nodeId: 'node-worker',
    nodeState: 'degraded',
    environmentId: 'env-worker',
    environmentState: 'degraded',
    boundEnvironmentRevision: 1,
    currentEnvironmentRevision: 2,
    stale: true,
  },
})

const automatedPending = task({
  id: 'task-auto-pending',
  title: '接口回归验证',
  priority: 'p2',
  status: 'validation',
  validation: {
    state: 'pending', requiredPassed: 0, requiredTotal: 2,
    acceptanceState: 'automated-pending', pendingUserAcceptance: 0,
  },
})

const automatedFailed = task({
  id: 'task-auto-failed',
  title: '视觉回归失败',
  priority: 'p1',
  status: 'validation',
  validation: {
    state: 'failed', requiredPassed: 0, requiredTotal: 2,
    acceptanceState: 'automated-failed', pendingUserAcceptance: 0,
  },
})

const humanReady = task({
  id: 'task-human-ready',
  title: '后台 UI 修复',
  summary: 'AI 视觉验收已通过。',
  priority: 'p1',
  status: 'validation',
  stage: { id: 'accept', title: '人工验收', kind: 'validation' },
  validation: {
    state: 'pending', requiredPassed: 1, requiredTotal: 2,
    acceptanceState: 'human-ready', pendingUserAcceptance: 1,
  },
})

const done = task({ id: 'task-done', title: '已完成部署', priority: 'p2', status: 'done' })
const unclaimed = task({ id: 'task-unclaimed', title: '待组织任务', priority: 'p2', status: 'unclaimed' })

const snapshot: WorkConsoleSnapshot = {
  generatedAt: '2026-08-18T10:00:00.000Z',
  ideas: [
    {
      id: 'idea-1', revision: 1, title: 'RAG 新索引策略', summary: '先沉淀，不执行。', tags: ['rag'],
      createdAt: '2026-08-18T09:00:00.000Z', updatedAt: '2026-08-18T09:00:00.000Z',
    },
    {
      id: 'idea-2', revision: 1, title: '机器人异常自恢复', summary: '', tags: [],
      createdAt: '2026-08-18T08:00:00.000Z', updatedAt: '2026-08-18T08:00:00.000Z',
    },
  ],
  tasks: [running, blocked, automatedPending, automatedFailed, humanReady, done, unclaimed],
  resources: {
    nodes: { total: 3, online: 1, degraded: 1, offline: 1 },
    environments: { total: 3, ready: 1, degraded: 1, unavailable: 1 },
    runners: [
      { provider: 'codex', nodeCount: 2, onlineNodeCount: 1 },
      { provider: 'claude-code', nodeCount: 1, onlineNodeCount: 0 },
    ],
  },
  pending: { blockedTasks: 1, validationTasks: 3, pendingUserAcceptance: 1 },
}

const detail: WorkConsoleTaskDetail = {
  card: running,
  threads: [
    {
      id: 'thread-running-1234567890',
      revision: 2,
      state: 'running',
      activeAttempt: { provider: 'codex', mode: 'one-shot', startedAt: '2026-08-18T09:55:00.000Z' },
      placement: running.placement,
      updatedAt: '2026-08-18T10:00:00.000Z',
    },
    {
      id: 'short',
      revision: 3,
      state: 'blocked',
      blocker: '等待真机',
      lastAttempt: {
        provider: 'claude-code', mode: 'one-shot', startedAt: '2026-08-18T09:30:00.000Z',
        finishedAt: '2026-08-18T09:40:00.000Z', stopReason: 'failed',
      },
      updatedAt: '2026-08-18T09:40:00.000Z',
    },
    { id: 'idle-thread', revision: 1, state: 'idle', updatedAt: '2026-08-18T09:20:00.000Z' },
  ],
  environments: [{
    id: 'env-g1', revision: 1, name: 'G1 Runtime', state: 'ready',
    workspace: { path: '/workspace/g1' }, runtime: { os: 'ubuntu-22.04', arch: 'x64', versions: {} },
    devices: ['livox-mid360'], capabilities: ['ros-noetic'],
  }],
  validationGeneration: 2,
  validators: [
    {
      index: 0, kind: 'runtime-check', requirement: 'required', label: '运行检查', outcome: 'passed', source: 'automation',
      checkedAt: '2026-08-18T10:00:00.000Z', evidence: [{ kind: 'log', label: '日志', reference: 'log://42' }],
    },
    {
      index: 1, kind: 'user-acceptance', requirement: 'required', label: '人工确认', outcome: 'failed', source: 'user', actor: 'local-user',
      checkedAt: '2026-08-18T10:01:00.000Z', evidence: [],
    },
    { index: 2, kind: 'artifact-check', requirement: 'optional', label: '产物检查', evidence: [] },
  ],
}

function rootProps(options: {
  readonly open?: boolean
  readonly selectedTaskId?: string | null
  readonly remote?: Partial<WorkConsoleRemoteState>
} = {}): WorkConsoleRootProps {
  const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
  const remoteState: WorkConsoleRemoteState = {
    loading: false,
    detailLoading: false,
    error: undefined,
    snapshot,
    detailTaskId: options.selectedTaskId ?? undefined,
    detail: options.selectedTaskId === running.id ? detail : undefined,
    ...options.remote,
  }
  return {
    useSessions: unusedGlobalHook,
    useWorkspaces: unusedGlobalHook,
    useStore: select => select({ open: options.open ?? true, selectedTaskId: options.selectedTaskId ?? null }),
    actions,
    useWorkConsole: select => select(remoteState),
    openConsole: vi.fn(),
    closeConsole: vi.fn(),
    refreshConsole: vi.fn(),
    selectTask: vi.fn(),
    clearError: vi.fn(),
  }
}

describe('WorkConsoleTrigger', () => {
  it('opens from the wide sidebar and closes from the rail state', () => {
    const openConsole = vi.fn()
    const wide: WorkConsoleTriggerProps = {
      ...rootProps({ open: false }),
      wide: true,
      openConsole,
    }
    const view = render(<WorkConsoleTrigger {...wide} />)
    fireEvent.click(screen.getByRole('button', { name: '全局工作台' }))
    expect(openConsole).toHaveBeenCalledWith(null)
    expect(screen.getByText('全局工作台')).toBeTruthy()

    const closeConsole = vi.fn()
    view.rerender(<WorkConsoleTrigger {...rootProps()} wide={false} closeConsole={closeConsole} />)
    const rail = screen.getByRole('button', { name: '全局工作台' })
    expect(rail.getAttribute('title')).toBe('全局工作台')
    fireEvent.click(rail)
    expect(closeConsole).toHaveBeenCalledOnce()
  })
})

describe('WorkConsoleRoot product surface', () => {
  it('separates passive ideas, active execution, human-ready acceptance, and removes done from the homepage', () => {
    render(<WorkConsoleRoot {...rootProps()} />)
    expect(screen.getByRole('dialog', { name: '持续工作控制台' })).toBeTruthy()

    const ideas = within(screen.getByRole('region', { name: '想法区' }))
    expect(ideas.getByText('RAG 新索引策略')).toBeTruthy()
    expect(ideas.getByText('机器人异常自恢复')).toBeTruthy()
    expect(ideas.getByText('成熟后由用户明确推进到执行区')).toBeTruthy()

    const execution = within(screen.getByRole('region', { name: '执行区' }))
    expect(execution.getByText('G1 雷达漂移修复')).toBeTruthy()
    expect(execution.getByText('RAG 缓存优化')).toBeTruthy()
    expect(execution.getByText('接口回归验证')).toBeTruthy()
    expect(execution.getByText('视觉回归失败')).toBeTruthy()
    expect(execution.getByText('待组织任务')).toBeTruthy()
    expect(execution.queryByText('后台 UI 修复')).toBeNull()
    expect(execution.queryByText('已完成部署')).toBeNull()
    expect(execution.getByText('自动验收')).toBeTruthy()
    expect(execution.getByText('自动验收失败')).toBeTruthy()

    const acceptance = within(screen.getByRole('region', { name: '验收区' }))
    expect(acceptance.getByText('后台 UI 修复')).toBeTruthy()
    expect(acceptance.getByText('待人工验收')).toBeTruthy()
    expect(acceptance.getByText(/人工门禁 1/)).toBeTruthy()
    expect(acceptance.queryByText('接口回归验证')).toBeNull()

    expect(screen.getByText('已完成 1 · 进入执行历史查看')).toBeTruthy()
    expect(screen.queryByLabelText('Task Detail')).toBeNull()
  })

  it('keeps the resource strip compact while reporting unhealthy facts and every Runner', () => {
    render(<WorkConsoleRoot {...rootProps()} />)
    expect(screen.getByText('Nodes')).toBeTruthy()
    expect(screen.getByText('1 离线')).toBeTruthy()
    expect(screen.getByText('1 不可用')).toBeTruthy()
    expect(screen.getByText('codex')).toBeTruthy()
    expect(screen.getByText('claude-code')).toBeTruthy()
    expect(screen.getByText('待人工验收')).toBeTruthy()
  })

  it('covers degraded and healthy resource labels plus the loading strip', () => {
    const degraded: WorkConsoleSnapshot = {
      ...snapshot,
      resources: {
        nodes: { total: 1, online: 0, degraded: 1, offline: 0 },
        environments: { total: 1, ready: 0, degraded: 1, unavailable: 0 },
        runners: [],
      },
    }
    const view = render(<WorkConsoleRoot {...rootProps({ remote: { snapshot: degraded } })} />)
    expect(screen.getAllByText('1 降级')).toHaveLength(2)

    const healthy: WorkConsoleSnapshot = {
      ...snapshot,
      resources: {
        nodes: { total: 1, online: 1, degraded: 0, offline: 0 },
        environments: { total: 1, ready: 1, degraded: 0, unavailable: 0 },
        runners: [],
      },
    }
    view.rerender(<WorkConsoleRoot {...rootProps({ remote: { snapshot: healthy } })} />)
    expect(screen.getAllByText('正常')).toHaveLength(2)

    view.rerender(<WorkConsoleRoot {...rootProps({ remote: { snapshot: undefined, loading: true } })} />)
    expect(screen.getByText('正在读取资源事实…')).toBeTruthy()
    const refresh = screen.getByRole('button', { name: '刷新中…' }) as HTMLButtonElement
    expect(refresh.disabled).toBe(true)
  })

  it('filters ideas/tasks by search and tasks by priority without moving acceptance semantics', () => {
    render(<WorkConsoleRoot {...rootProps()} />)
    const search = screen.getByPlaceholderText('搜索想法 / Task / Stage / Runner')
    fireEvent.change(search, { target: { value: 'RAG' } })
    expect(screen.getByText('RAG 新索引策略')).toBeTruthy()
    expect(screen.getByText('RAG 缓存优化')).toBeTruthy()
    expect(screen.queryByText('G1 雷达漂移修复')).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '优先级' }), { target: { value: 'p1' } })
    const execution = within(screen.getByRole('region', { name: '执行区' }))
    expect(execution.getByText('RAG 缓存优化')).toBeTruthy()
    expect(execution.getByText('视觉回归失败')).toBeTruthy()
    expect(execution.queryByText('G1 雷达漂移修复')).toBeNull()
    expect(screen.getByRole('region', { name: '验收区' }).textContent).toContain('后台 UI 修复')
    expect(screen.getByRole('region', { name: '想法区' }).textContent).toContain('机器人异常自恢复')
  })

  it('opens Task Detail only for a selected Task and closes it through the store action/backdrop', () => {
    const props = rootProps({ selectedTaskId: running.id })
    render(<WorkConsoleRoot {...props} />)
    const drawer = screen.getByLabelText('Task Detail')
    expect(within(drawer).getByText('G1 雷达漂移修复')).toBeTruthy()
    expect(within(drawer).getByText('方案验证')).toBeTruthy()
    expect(within(drawer).getByText('等待真机')).toBeTruthy()
    expect(within(drawer).getByText('log://42')).toBeTruthy()
    expect(within(drawer).getByText(/local-user/)).toBeTruthy()
    expect(within(drawer).getByText('/workspace/g1')).toBeTruthy()
    expect(within(drawer).getByText(/thread-r…7890/)).toBeTruthy()
    expect(within(drawer).getByText('short')).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: '关闭 Task Detail' }))
    expect(props.actions.selectTask).toHaveBeenCalledWith(null)
  })

  it('shows detail loading/unavailable states and closes on backdrop', () => {
    const loadingProps = rootProps({
      selectedTaskId: blocked.id,
      remote: { detailTaskId: blocked.id, detail: undefined, detailLoading: true },
    })
    const view = render(<WorkConsoleRoot {...loadingProps} />)
    expect(screen.getByText('正在读取 Task Detail…')).toBeTruthy()

    const unavailableProps = rootProps({
      selectedTaskId: blocked.id,
      remote: { detailTaskId: blocked.id, detail: undefined, detailLoading: false },
    })
    view.rerender(<WorkConsoleRoot {...unavailableProps} />)
    expect(screen.getByText('Task Detail 暂不可用')).toBeTruthy()
    const backdrop = screen.getByLabelText('Task Detail').parentElement!
    fireEvent.mouseDown(backdrop)
    expect(unavailableProps.actions.selectTask).toHaveBeenCalledWith(null)
  })

  it('routes task clicks, manual refresh/errors, polling, Escape, and closed state without creating model work', () => {
    vi.useFakeTimers()
    const selectTask = vi.fn()
    const refreshConsole = vi.fn()
    const clearError = vi.fn()
    const closeConsole = vi.fn()
    const props = { ...rootProps({ remote: { error: 'offline' } }), selectTask, refreshConsole, clearError, closeConsole }
    const view = render(<WorkConsoleRoot {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /G1 雷达漂移修复/ }))
    expect(selectTask).toHaveBeenCalledWith(running.id)
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(refreshConsole).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByText('关闭', { selector: 'button' }))
    expect(clearError).toHaveBeenCalledOnce()

    act(() => { vi.advanceTimersByTime(5_000) })
    expect(refreshConsole).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(closeConsole).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeConsole).toHaveBeenCalledOnce()

    view.rerender(<WorkConsoleRoot {...rootProps({ open: false })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders empty zones and handles a human-ready card without a pending count from an older wire', () => {
    const legacyReady = task({
      id: 'legacy-human-ready', title: '旧协议验收', priority: 'p2', status: 'validation',
      validation: { state: 'pending', requiredPassed: 1, requiredTotal: 2, acceptanceState: 'human-ready' },
    })
    const emptyish: WorkConsoleSnapshot = {
      generatedAt: snapshot.generatedAt,
      ideas: [],
      tasks: [legacyReady],
      resources: { nodes: { total: 0, online: 0, degraded: 0, offline: 0 }, environments: { total: 0, ready: 0, degraded: 0, unavailable: 0 }, runners: [] },
      pending: { blockedTasks: 0, validationTasks: 1, pendingUserAcceptance: 1 },
    }
    render(<WorkConsoleRoot {...rootProps({ remote: { snapshot: emptyish } })} />)
    expect(screen.getByText('暂无想法')).toBeTruthy()
    expect(screen.getByText('当前没有执行中的 Task')).toBeTruthy()
    expect(screen.getByText(/人工门禁 0/)).toBeTruthy()
  })
})
