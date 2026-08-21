// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkConsoleSnapshot, WorkConsoleTaskDetail } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkConsoleRootProps } from '../src/client/contract.ts'
import type { WorkConsoleRemoteState } from '../src/client/controller.ts'
import { WorkConsoleRoot } from '../src/client/WorkConsoleRoot.tsx'

afterEach(cleanup)

const snapshot: WorkConsoleSnapshot = {
  generatedAt: '2026-08-18T11:00:00.000Z',
  ideas: [],
  tasks: [{
    id: 'minimal-task',
    revision: 1,
    title: '最小任务',
    summary: '',
    tags: [],
    priority: 'p2',
    status: 'unclaimed',
    execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
    updatedAt: '2026-08-18T11:00:00.000Z',
  }],
  resources: {
    nodes: { total: 0, online: 0, degraded: 0, offline: 0 },
    environments: { total: 0, ready: 0, degraded: 0, unavailable: 0 },
    runners: [],
  },
  pending: { blockedTasks: 0, validationTasks: 0, pendingUserAcceptance: 0 },
}

const detail: WorkConsoleTaskDetail = {
  card: snapshot.tasks[0]!,
  threads: [],
  environments: [],
  validators: [],
}

function props(): WorkConsoleRootProps {
  const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }
  const remote: WorkConsoleRemoteState = {
    loading: false,
    detailLoading: false,
    error: undefined,
    snapshot,
    detailTaskId: 'minimal-task',
    detail,
  }
  const unused = (() => { throw new Error('unused') }) as never
  return {
    useSessions: unused,
    useWorkspaces: unused,
    useStore: select => select({ open: true, selectedTaskId: 'minimal-task' }),
    actions,
    useWorkConsole: select => select(remote),
    openConsole: vi.fn(),
    closeConsole: vi.fn(),
    refreshConsole: vi.fn(),
    selectTask: vi.fn(),
    createIdea: vi.fn().mockResolvedValue(true),
    promoteIdea: vi.fn().mockResolvedValue(true),
    organizeTask: vi.fn().mockResolvedValue(true),
    decideAcceptance: vi.fn().mockResolvedValue(true),
    clearError: vi.fn(),
  }
}

describe('WorkConsoleRoot minimal detail', () => {
  it('renders truthful fallbacks instead of inventing execution or validation facts', () => {
    render(<WorkConsoleRoot {...props()} />)
    const drawer = screen.getByLabelText('Task Detail')
    expect(within(drawer).getByText('未分类')).toBeTruthy()
    expect(within(drawer).getByText('未设置')).toBeTruthy()
    expect(within(drawer).getByText('未运行')).toBeTruthy()
    expect(within(drawer).getAllByText('未绑定')).toHaveLength(2)
    expect(within(drawer).getByText('暂无 ExecutionThread')).toBeTruthy()
    expect(within(drawer).getByText('当前 Task 没有独立验收项')).toBeTruthy()
    expect(within(drawer).getByText('Validation')).toBeTruthy()
    expect(within(drawer).getByText('Environment · 0')).toBeTruthy()
    expect(within(drawer).getByText('待组织')).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: '确认组织' })).toBeTruthy()
    expect(within(drawer).queryByText('ENV STALE')).toBeNull()
  })
})
