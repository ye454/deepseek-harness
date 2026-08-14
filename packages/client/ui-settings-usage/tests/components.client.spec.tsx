// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { UsageSectionProps } from '../src/client/UsageSection.tsx'
import { en, type UsageKey } from '../src/client/locales.ts'
import { downloadText } from '../src/client/download.ts'

afterEach(cleanup)

const t = ((key: UsageKey, params?: Record<string, string | number>) => {
  const template = en[key]
  if (params === undefined) return template
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}) as UsageSectionProps['t']

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

const summary = (over: Partial<SessionSummary> & Pick<SessionSummary, 'id' | 'displayTitle'>): SessionSummary => ({
  running: false,
  blank: false,
  updatedAt: 1,
  ...over,
})

const listOf = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
})

const workspace = (id: string, sessionIds: string[], title = id): WorkspaceView => ({
  workspaceId: wid(id),
  path: `/projects/${id}`,
  title,
  sessionIds: sessionIds.map(sid),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function useSnapshot<T>(snapshot: T): SnapshotSelectorHook<T> {
  return select => select(snapshot)
}

function props(over: {
  list?: SessionListState
  workspaces?: WorkspaceListState
  open?: UsageSectionProps['open']
  close?: () => void
  downloadText?: UsageSectionProps['downloadText']
} = {}): UsageSectionProps {
  const list = over.list ?? listOf()
  const workspaces = over.workspaces ?? {
    items: [],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: undefined,
  }
  return {
    t,
    useSessions: useSnapshot(list),
    useWorkspaces: useSnapshot(workspaces),
    close: over.close ?? vi.fn(),
    open: over.open ?? vi.fn(),
    downloadText: over.downloadText ?? vi.fn(),
  } as UsageSectionProps
}

const billedList = listOf(
  summary({
    id: sid('alpha'), displayTitle: 'Alpha chat', updatedAt: 2,
    projectionValues: {
      tokenUsage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
  }),
  summary({
    id: sid('beta'), displayTitle: 'Beta notes', cwd: '/work/other', updatedAt: 1,
    projectionValues: {
      tokenUsage: { uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
  }),
)

const billedWorkspaces: WorkspaceListState = {
  items: [workspace('proj', ['alpha'], 'Project')],
  archivedSessionIds: [],
  state: 'idle',
  phase: 'ready',
  error: null,
  baselinesReady: true,
  recentWorkspaceId: undefined,
}

describe('UsageSection', () => {
  it('renders the empty state when no sessions exist', () => {
    render(<UsageSection {...props()} />)
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.getByText(/0 sessions/)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.exportCsv })).toHaveProperty('disabled', true)
  })

  it('filters by query and minimum total, then exports the visible rows', () => {
    const download = vi.fn()
    render(<UsageSection {...props({
      list: billedList, workspaces: billedWorkspaces, downloadText: download,
    })} />)
    expect(screen.getByText('Alpha chat')).toBeTruthy()
    expect(screen.getByText('Beta notes')).toBeTruthy()
    expect(screen.getByText(/2 sessions/)).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'alpha' },
    })
    expect(screen.queryByText('Beta notes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.exportCsv }))
    expect(download).toHaveBeenCalledWith(
      'dsh-usage.csv',
      'text/csv',
      expect.stringContaining('Alpha chat'),
    )
    expect(download.mock.calls[0]?.[2]).not.toContain('Beta notes')

    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: en.minTotal }), {
      target: { value: '50' },
    })
    expect(screen.queryByText('Alpha chat')).toBeNull()
    expect(screen.getByText('Beta notes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.exportJson }))
    expect(download).toHaveBeenCalledWith(
      'dsh-usage.json',
      'application/json',
      expect.stringContaining('Beta notes'),
    )
  })

  it('treats an invalid minimum as zero and reports no matches', () => {
    render(<UsageSection {...props({ list: billedList, workspaces: billedWorkspaces })} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: en.minTotal }), {
      target: { value: 'abc' },
    })
    expect(screen.getByText('Alpha chat')).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton', { name: en.minTotal }), {
      target: { value: '-3' },
    })
    expect(screen.getByText('Alpha chat')).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton', { name: en.minTotal }), {
      target: { value: '1.9' },
    })
    expect(screen.getByText('Alpha chat')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'missing' },
    })
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('opens a session and closes settings', () => {
    const open = vi.fn()
    const close = vi.fn()
    render(<UsageSection {...props({
      list: billedList, workspaces: billedWorkspaces, open, close,
    })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Alpha chat' }))
    expect(open).toHaveBeenCalledWith(sid('alpha'))
    expect(close).toHaveBeenCalledOnce()
  })

  it('tags archived and subagent rows', () => {
    const list = listOf(
      summary({
        id: sid('old'), displayTitle: 'Old',
        projectionValues: {
          tokenUsage: { uncachedInputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      }),
      summary({
        id: sid('child'), displayTitle: 'Child', origin: 'subagent',
        projectionValues: {
          tokenUsage: { uncachedInputTokens: 2, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      }),
    )
    render(<UsageSection {...props({
      list,
      workspaces: { ...billedWorkspaces, archivedSessionIds: [sid('old')] },
    })} />)
    expect(screen.getByText(en.archived)).toBeTruthy()
    expect(screen.getByText(en.subagent)).toBeTruthy()
  })
})

describe('downloadText', () => {
  it('creates an object-URL download and revokes it after click', () => {
    const click = vi.fn()
    const create = vi.fn(() => 'blob:usage')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') Object.defineProperty(el, 'click', { value: click })
      return el
    })
    downloadText('dsh-usage.csv', 'text/csv', 'title\n')
    expect(create).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:usage')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
