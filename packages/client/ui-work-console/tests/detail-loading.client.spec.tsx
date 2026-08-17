// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkConsoleSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkConsoleRootProps } from '../src/client/contract.ts'
import type { WorkConsoleControllerState } from '../src/client/controller.ts'
import { WorkConsoleRoot } from '../src/client/WorkConsoleRoot.tsx'

afterEach(cleanup)

const board: WorkConsoleSnapshot = {
  generatedAt: '2026-08-17T04:00:00.000Z',
  tasks: [{
    id: 'task-1',
    revision: 1,
    title: 'Loading detail',
    summary: '',
    tags: [],
    priority: 'p2',
    status: 'running',
    execution: { threadCount: 0, runningThreadCount: 0, blockedThreadCount: 0 },
    updatedAt: '2026-08-17T04:00:00.000Z',
  }],
  resources: {
    nodes: { total: 0, online: 0, degraded: 0, offline: 0 },
    environments: { total: 0, ready: 0, degraded: 0, unavailable: 0 },
    runners: [],
  },
  pending: { blockedTasks: 0, validationTasks: 0, pendingUserAcceptance: 0 },
}

const unusedGlobalHook = (() => { throw new Error('unused global hook') }) as never
const actions = { open: vi.fn(), close: vi.fn(), selectTask: vi.fn() }

function props(remote: WorkConsoleControllerState): WorkConsoleRootProps {
  return {
    useSessions: unusedGlobalHook,
    useWorkspaces: unusedGlobalHook,
    useStore: select => select({ open: true, selectedTaskId: 'task-1' }),
    actions,
    useWorkConsole: select => select(remote),
    openConsole: vi.fn(),
    closeConsole: vi.fn(),
    refreshConsole: vi.fn(),
    selectTask: vi.fn(),
    clearError: vi.fn(),
  }
}

describe('WorkConsole Task Detail loading identity', () => {
  it('shows loading only when the pending Detail request belongs to the selected Task', () => {
    const matching: WorkConsoleControllerState = {
      loading: false,
      detailLoading: true,
      snapshot: board,
      detailTaskId: 'task-1',
    }
    const view = render(<WorkConsoleRoot {...props(matching)} />)
    expect(screen.getByText('正在读取 Task Detail…')).toBeTruthy()

    const stale: WorkConsoleControllerState = {
      loading: false,
      detailLoading: true,
      snapshot: board,
      detailTaskId: 'task-old',
    }
    view.rerender(<WorkConsoleRoot {...props(stale)} />)
    expect(screen.getByText('Task Detail 暂不可用')).toBeTruthy()
  })
})
