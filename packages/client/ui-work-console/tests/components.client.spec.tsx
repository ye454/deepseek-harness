// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { WorkConsoleSnapshot, WorkConsoleTaskCard, WorkConsoleTaskDetail } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkConsoleRootProps, WorkConsoleTriggerProps } from '../src/client/contract.ts'
import type { WorkConsoleRemoteState } from '../src/client/controller.ts'
import { WorkConsoleRoot, WorkConsoleTrigger } from '../src/client/WorkConsoleRoot.tsx'

afterEach(() => { cleanup(); vi.useRealTimers() })

const unusedGlobalHook = (() => { throw new Error('unused global hook') }) as never

function card(overrides: Partial<WorkConsoleTaskCard> & Pick<WorkConsoleTaskCard, 'id' | 'title' | 'priority' | 'status'>): WorkConsoleTaskCard {
  return {
    revision: 1,
    summary: '',
    tags: [],
    execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
    updatedAt: '2026-08-18T12:00:00.000Z',
    ...overrides,
  }
}

const running = card({
  id: 'running', title: 'G1 雷达漂移', priority: 'p0', status: 'running', summary: '正在验证修复。',
  taskType: 'bug-fix', stage: { id: 'verify', title: '方案验证', kind: 'validation' },
  execution: { threadCount: 1, runningThreadCount: 1, blockedThreadCount: 0, provider: 'codex', mode: 'one-shot' },
  placement: {
    threadId: 'thread-running-1234567890', nodeId: 'node-pc2', nodeName: 'PC2', nodeState: 'online',
    environmentId: 'env-g1', environmentName: 'G1 Runtime', environmentState: 'ready',
    boundEnvironmentRevision: 1, currentEnvironmentRevision: 2, stale: true,
  },
})

const dispatchable = card({
  id: 'dispatch-me', revision: 5, title: 'P0 并行排障', priority: 'p0', status: 'running',
  taskType: 'bug-fix', stage: { id: 'verify', title: '方案验证', kind: 'validation' },
})

const organizing = card({ id: 'organize-me', revision: 2, title: '待组织 Task', priority: 'p2', status: 'unclaimed' })

const humanReady = card({
  id: 'accept-me', title: '后台 UI 修复', priority: 'p1', status: 'validation',
  validation: { state: 'pending', requiredPassed: 1, requiredTotal: 2, acceptanceState: 'human-ready', pendingUserAcceptance: 1 },
})

const automatedFailed = card({
  id: 'auto-failed', title: '自动验收失败任务', priority: 'p2', status: 'validation',
  validation: { state: 'failed', requiredPassed: 0, requiredTotal: 1, acceptanceState: 'automated-failed', pendingUserAcceptance: 0 },
})

const snapshot: WorkConsoleSnapshot = {
  generatedAt: '2026-08-18T12:00:00.000Z',
  ideas: [
    { id: 'idea-1', revision: 3, title: 'RAG 新索引策略', summary: '先沉淀。', tags: ['rag'], createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z' },
    { id: 'idea-2', revision: 1, title: '机器人异常自恢复', summary: '', tags: [], createdAt: '2026-08-18T09:00:00.000Z', updatedAt: '2026-08-18T09:00:00.000Z' },
  ],
  tasks: [running, dispatchable, organizing, humanReady, automatedFailed, card({ id: 'done', title: '完成任务', priority: 'p2', status: 'done' })],
  resources: {
    nodes: { total: 2, online: 1, degraded: 0, offline: 1 },
    environments: { total: 2, ready: 1, degraded: 1, unavailable: 0 },
    runners: [{ provider: 'codex', nodeCount: 1, onlineNodeCount: 1 }, { provider: 'claude-code', nodeCount: 1, onlineNodeCount: 0 }],
  },
  pending: { blockedTasks: 0, validationTasks: 2, pendingUserAcceptance: 1 },
}

const acceptanceDetail: WorkConsoleTaskDetail = {
  card: humanReady,
  threads: [],
  environments: [],
  validationGeneration: 4,
  validators: [
    { index: 0, kind: 'visual-model', requirement: 'required', label: '视觉模型', outcome: 'passed', source: 'automation', checkedAt: '2026-08-18T11:50:00.000Z', evidence: [{ kind: 'screenshot', label: '截图', reference: 'artifact://screen-1' }] },
    { index: 1, kind: 'user-acceptance', requirement: 'required', label: '人工确认', evidence: [] },
  ],
}

const organizingDetail: WorkConsoleTaskDetail = { card: organizing, threads: [], environments: [], validators: [] }
const dispatchableDetail: WorkConsoleTaskDetail = { card: dispatchable, threads: [], environments: [], validators: [] }

function props(options: {
  selected?: string | null
  remote?: Partial<WorkConsoleRemoteState>
  createIdea?: WorkConsoleRootProps['createIdea']
  promoteIdea?: WorkConsoleRootProps['promoteIdea']
  organizeTask?: WorkConsoleRootProps['organizeTask']
  loadExecutionPlan?: WorkConsoleRootProps['loadExecutionPlan']
  startExecution?: WorkConsoleRootProps['startExecution']
  decideAcceptance?: WorkConsoleRootProps['decideAcceptance']
} = {}): WorkConsoleRootProps {
  const selected = options.selected ?? null
  const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
  const remote: WorkConsoleRemoteState = {
    loading: false,
    detailLoading: false,
    error: undefined,
    snapshot,
    detailTaskId: selected ?? undefined,
    detail: selected === 'accept-me'
      ? acceptanceDetail
      : selected === 'organize-me' ? organizingDetail : selected === 'dispatch-me' ? dispatchableDetail : undefined,
    ...options.remote,
  }
  return {
    useSessions: unusedGlobalHook,
    useWorkspaces: unusedGlobalHook,
    useStore: select => select({ open: true, selectedTaskId: selected }),
    actions,
    useWorkConsole: select => select(remote),
    openConsole: vi.fn(),
    closeConsole: vi.fn(),
    refreshConsole: vi.fn(),
    selectTask: vi.fn(),
    createIdea: options.createIdea ?? vi.fn().mockResolvedValue(true),
    promoteIdea: options.promoteIdea ?? vi.fn().mockResolvedValue(true),
    organizeTask: options.organizeTask ?? vi.fn().mockResolvedValue(true),
    loadExecutionPlan: options.loadExecutionPlan ?? vi.fn().mockResolvedValue(undefined),
    startExecution: options.startExecution ?? vi.fn().mockResolvedValue(true),
    decideAcceptance: options.decideAcceptance ?? vi.fn().mockResolvedValue(true),
    clearError: vi.fn(),
  }
}

describe('WorkConsoleTrigger', () => {
  it('opens wide and closes rail modes', () => {
    const openConsole = vi.fn()
    const base = props()
    const wide: WorkConsoleTriggerProps = { ...base, wide: true, useStore: select => select({ open: false, selectedTaskId: null }), openConsole }
    const view = render(<WorkConsoleTrigger {...wide} />)
    fireEvent.click(screen.getByRole('button', { name: '全局工作台' }))
    expect(openConsole).toHaveBeenCalledWith(null)

    const closeConsole = vi.fn()
    view.rerender(<WorkConsoleTrigger {...base} wide={false} closeConsole={closeConsole} />)
    fireEvent.click(screen.getByRole('button', { name: '全局工作台' }))
    expect(closeConsole).toHaveBeenCalledOnce()
  })
})

describe('WorkConsoleRoot', () => {
  it('renders the lightweight three-zone product and keeps completed work out of the homepage', () => {
    render(<WorkConsoleRoot {...props()} />)
    const ideas = within(screen.getByRole('region', { name: '想法区' }))
    const execution = within(screen.getByRole('region', { name: '执行区' }))
    const acceptance = within(screen.getByRole('region', { name: '验收区' }))
    expect(ideas.getByText('RAG 新索引策略')).toBeTruthy()
    expect(execution.getByText('G1 雷达漂移')).toBeTruthy()
    expect(execution.getByText('待组织 Task')).toBeTruthy()
    expect(execution.getByText('自动验收失败任务')).toBeTruthy()
    expect(acceptance.getByText('后台 UI 修复')).toBeTruthy()
    expect(execution.queryByText('完成任务')).toBeNull()
    expect(screen.getByText('已完成 1 · 进入执行历史查看')).toBeTruthy()
    expect(screen.getByText('ENV STALE')).toBeTruthy()
  })

  it('captures a new Idea explicitly and states that it does not enter execution', async () => {
    const createIdea = vi.fn().mockResolvedValue(true)
    render(<WorkConsoleRoot {...props({ createIdea })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ 记录想法' }))
    expect(screen.getByText('仅记录，不进入执行，不调用模型')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '想法标题' }), { target: { value: '  新 RAG 方案  ' } })
    fireEvent.change(screen.getByRole('textbox', { name: '想法说明' }), { target: { value: '先记录' } })
    fireEvent.change(screen.getByRole('textbox', { name: '想法标签' }), { target: { value: 'rag, search,rag' } })
    fireEvent.click(screen.getByRole('button', { name: '保存想法' }))
    await vi.waitFor(() => {
      expect(createIdea).toHaveBeenCalledWith('  新 RAG 方案  ', '先记录', ['rag', 'search'])
    })
  })

  it('promotes an Idea only after explicit button action', async () => {
    const promoteIdea = vi.fn().mockResolvedValue(true)
    render(<WorkConsoleRoot {...props({ promoteIdea })} />)
    fireEvent.click(screen.getAllByRole('button', { name: '推进到执行' })[0]!)
    await vi.waitFor(() => { expect(promoteIdea).toHaveBeenCalledWith('idea-1', 3) })
  })

  it('accepts a valid Idea drag payload and ignores empty/invalid payloads', async () => {
    const promoteIdea = vi.fn().mockResolvedValue(true)
    render(<WorkConsoleRoot {...props({ promoteIdea })} />)
    const execution = screen.getByRole('region', { name: '执行区' })
    const transfer = {
      dropEffect: 'none',
      effectAllowed: 'all',
      getData: vi.fn().mockReturnValue(JSON.stringify({ id: 'idea-2', revision: 1 })),
      setData: vi.fn(),
    }
    fireEvent.dragOver(execution, { dataTransfer: transfer })
    expect(transfer.dropEffect).toBe('move')
    fireEvent.drop(execution, { dataTransfer: transfer })
    await vi.waitFor(() => { expect(promoteIdea).toHaveBeenCalledWith('idea-2', 1) })

    transfer.getData.mockReturnValueOnce('')
    fireEvent.drop(execution, { dataTransfer: transfer })
    transfer.getData.mockReturnValueOnce('{broken')
    fireEvent.drop(execution, { dataTransfer: transfer })
    transfer.getData.mockReturnValueOnce(JSON.stringify({ id: 42, revision: 0 }))
    fireEvent.drop(execution, { dataTransfer: transfer })
    expect(promoteIdea).toHaveBeenCalledTimes(1)
  })

  it('publishes the drag payload from an Idea card', () => {
    render(<WorkConsoleRoot {...props()} />)
    const setData = vi.fn()
    const cardNode = screen.getByText('RAG 新索引策略').closest('article')!
    fireEvent.dragStart(cardNode, { dataTransfer: { effectAllowed: 'none', setData, getData: vi.fn() } })
    expect(setData).toHaveBeenCalledWith('application/x-dsh-work-idea', JSON.stringify({ id: 'idea-1', revision: 3 }))
  })

  it('organizes an unclaimed Task only after the user selects a type and confirms', async () => {
    const organizeTask = vi.fn().mockResolvedValue(true)
    render(<WorkConsoleRoot {...props({ selected: 'organize-me', organizeTask })} />)
    const drawer = screen.getByLabelText('Task Detail')
    expect(within(drawer).getByText(/不会调用模型，也不会自动启动 Runner/)).toBeTruthy()
    fireEvent.change(within(drawer).getByRole('combobox', { name: '任务类型' }), { target: { value: 'bug-fix' } })
    fireEvent.click(within(drawer).getByRole('button', { name: '确认组织' }))
    await vi.waitFor(() => {
      expect(organizeTask).toHaveBeenCalledWith('organize-me', organizing.revision, 'bug-fix')
    })
  })

  it('loads execution resources only on demand and submits real P0 two-runner fan-out', async () => {
    const loadExecutionPlan = vi.fn().mockResolvedValue({
      dispatchAvailable: true,
      candidates: [
        {
          environmentId: 'env-a', environmentRevision: 7, environmentName: 'worktree-a', nodeId: 'node-a', nodeName: 'PC-A',
          providers: ['codex'], workspace: { path: '/repo', worktree: '/repo/.worktrees/a' }, available: true, issues: [],
        },
        {
          environmentId: 'env-b', environmentRevision: 9, environmentName: 'worktree-b', nodeId: 'node-b', nodeName: 'PC-B',
          providers: ['claude-code'], workspace: { path: '/repo', worktree: '/repo/.worktrees/b' }, available: true, issues: [],
        },
      ],
    })
    const startExecution = vi.fn().mockResolvedValue(true)
    render(<WorkConsoleRoot {...props({ selected: 'dispatch-me', loadExecutionPlan, startExecution })} />)
    expect(loadExecutionPlan).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '配置执行' }))
    await vi.waitFor(() => { expect(loadExecutionPlan).toHaveBeenCalledWith('dispatch-me') })
    expect(screen.getByRole('button', { name: '+ 并行角色' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '+ 并行角色' }))
    expect((screen.getByRole('combobox', { name: 'Runner 1' }) as HTMLSelectElement).value).toBe('codex')
    expect((screen.getByRole('combobox', { name: 'Runner 2' }) as HTMLSelectElement).value).toBe('claude-code')
    fireEvent.click(screen.getByRole('button', { name: '启动 2 个 Runner' }))
    await vi.waitFor(() => {
      expect(startExecution).toHaveBeenCalledWith('dispatch-me', 5, [
        { environmentId: 'env-a', environmentRevision: 7, provider: 'codex', role: '完成当前 Stage：方案验证，并返回可验证结果' },
        { environmentId: 'env-b', environmentRevision: 9, provider: 'claude-code', role: '独立复核当前 Stage，并输出可验证结论' },
      ])
    })
  })

  it('shows resources but hard-disables execution when dispatch Gateway is absent', async () => {
    const loadExecutionPlan = vi.fn().mockResolvedValue({
      dispatchAvailable: false,
      candidates: [{
        environmentId: 'env-a', environmentRevision: 1, environmentName: 'local-env', nodeId: 'node-a', nodeName: 'PC-A',
        providers: ['codex'], workspace: { path: '/repo' }, available: true, issues: [],
      }],
    })
    const startExecution = vi.fn().mockResolvedValue(true)
    render(<WorkConsoleRoot {...props({ selected: 'dispatch-me', loadExecutionPlan, startExecution })} />)
    fireEvent.click(screen.getByRole('button', { name: '配置执行' }))
    await screen.findByText(/远程执行 Gateway 未配置/)
    const start = screen.getByRole('button', { name: '启动执行' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(startExecution).not.toHaveBeenCalled()
  })

  it('shows acceptance controls only after Evidence is opened and passes exact decision coordinates', async () => {
    const decideAcceptance = vi.fn().mockResolvedValue(true)
    render(<WorkConsoleRoot {...props({ selected: 'accept-me', decideAcceptance })} />)
    const drawer = screen.getByLabelText('Task Detail')
    expect(within(drawer).getByText('artifact://screen-1')).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: '通过验收' }))
    await vi.waitFor(() => {
      expect(decideAcceptance).toHaveBeenCalledWith('accept-me', humanReady.revision, 4, 1, 'accept')
    })
  })

  it('can explicitly return a human-ready Task to execution', async () => {
    const decideAcceptance = vi.fn().mockResolvedValue(true)
    render(<WorkConsoleRoot {...props({ selected: 'accept-me', decideAcceptance })} />)
    fireEvent.click(screen.getByRole('button', { name: '退回执行' }))
    await vi.waitFor(() => {
      expect(decideAcceptance).toHaveBeenCalledWith('accept-me', humanReady.revision, 4, 1, 'return')
    })
  })

  it('does not expose human decision controls on ordinary execution detail', () => {
    const detail: WorkConsoleTaskDetail = { card: running, threads: [], environments: [], validators: [] }
    render(<WorkConsoleRoot {...props({ selected: 'running', remote: { detailTaskId: 'running', detail } })} />)
    expect(screen.queryByRole('button', { name: '通过验收' })).toBeNull()
    expect(screen.queryByRole('button', { name: '退回执行' })).toBeNull()
    expect(screen.queryByRole('button', { name: '确认组织' })).toBeNull()
  })

  it('filters by search/priority and preserves Idea visibility under Task priority filtering', () => {
    render(<WorkConsoleRoot {...props()} />)
    const search = screen.getByPlaceholderText('搜索想法 / Task / Stage / Runner')
    fireEvent.change(search, { target: { value: 'RAG' } })
    expect(screen.getByText('RAG 新索引策略')).toBeTruthy()
    expect(screen.queryByText('G1 雷达漂移')).toBeNull()
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '优先级' }), { target: { value: 'p1' } })
    expect(screen.getByText('后台 UI 修复')).toBeTruthy()
    expect(screen.getByText('RAG 新索引策略')).toBeTruthy()
    expect(screen.queryByText('G1 雷达漂移')).toBeNull()
  })

  it('reports resource failures, transport error, refresh/polling, and Escape close', () => {
    vi.useFakeTimers()
    const refreshConsole = vi.fn()
    const closeConsole = vi.fn()
    const clearError = vi.fn()
    render(<WorkConsoleRoot {...{ ...props({ remote: { error: 'offline' } }), refreshConsole, closeConsole, clearError }} />)
    expect(screen.getByText('1 离线')).toBeTruthy()
    expect(screen.getByText('1 降级')).toBeTruthy()
    expect(screen.getByText('claude-code')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    fireEvent.click(screen.getByText('关闭', { selector: 'button' }))
    expect(clearError).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(refreshConsole).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(closeConsole).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeConsole).toHaveBeenCalledOnce()
  })
})
