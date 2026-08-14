import { describe, expect, it } from 'vitest'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  deriveUsageRows, filterUsageRows, sumUsage, usageCsv, usageJson,
} from '../src/client/usage-rows.ts'

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

const usage = (
  uncachedInputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
) => ({ tokenUsage: { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } })

describe('deriveUsageRows', () => {
  it('skips blank sessions, includes archived and subagent rows, and sorts by total', () => {
    const billed = summary({
      id: sid('billed'), displayTitle: 'Billed', updatedAt: 10,
      projectionValues: usage(100, 20, 50, 30),
    })
    const smaller = summary({
      id: sid('small'), displayTitle: 'Small', updatedAt: 20,
      projectionValues: usage(5, 1),
    })
    const child = summary({
      id: sid('child'), displayTitle: 'Child', origin: 'subagent', updatedAt: 15,
      projectionValues: usage(2, 2),
    })
    const stray = summary({
      id: sid('stray'), displayTitle: 'Stray', updatedAt: 4,
      projectionValues: usage(0, 3),
    })
    const blank = summary({ id: sid('blank'), displayTitle: 'Blank', blank: true })
    const archived = summary({
      id: sid('old'), displayTitle: 'Old', updatedAt: 5, cwd: '/loose',
      projectionValues: usage(1, 0),
    })
    const rows = deriveUsageRows(
      listOf(blank, smaller, billed, child, archived, stray),
      [workspace('proj', ['billed', 'small', 'child', 'blank'], 'Project')],
      [sid('old')],
      'Ungrouped',
    )
    expect(rows.map(row => row.id)).toEqual([
      sid('billed'), sid('small'), sid('child'), sid('stray'), sid('old'),
    ])
    expect(rows[0]).toMatchObject({
      title: 'Billed', workspace: 'Project', input: 180, output: 20, total: 200, archived: false,
    })
    expect(rows[2]).toMatchObject({ origin: 'subagent', total: 4 })
    expect(rows[3]).toMatchObject({ title: 'Stray', workspace: 'Ungrouped', total: 3 })
    expect(rows[4]).toMatchObject({ archived: true, workspace: 'loose', total: 1 })
  })

  it('skips missing ids, maps absent usage to zeros, and labels slash-only cwd', () => {
    const ghost = sid('ghost')
    const listed = listOf(
      summary({ id: sid('bare'), displayTitle: 'Bare', cwd: '/' }),
      summary({ id: sid('empty-cwd'), displayTitle: 'Empty', cwd: '' }),
    )
    listed.ids = [...listed.ids, ghost]
    const rows = deriveUsageRows(listed, [], [], 'Ungrouped')
    expect(rows.map(row => row.id)).toEqual([sid('bare'), sid('empty-cwd')])
    expect(rows[0]).toMatchObject({ workspace: '/', input: 0, output: 0, total: 0 })
    expect(rows[1]).toMatchObject({ workspace: 'Ungrouped', total: 0 })
  })

  it('breaks total ties by recency, then by id', () => {
    const rows = deriveUsageRows(
      listOf(
        summary({
          id: sid('b'), displayTitle: 'B', updatedAt: 1, projectionValues: usage(1, 0),
        }),
        summary({
          id: sid('a'), displayTitle: 'A', updatedAt: 1, projectionValues: usage(1, 0),
        }),
        summary({
          id: sid('newer'), displayTitle: 'Newer', updatedAt: 2, projectionValues: usage(1, 0),
        }),
      ),
      [],
      [],
      'Ungrouped',
    )
    expect(rows.map(row => row.id)).toEqual([sid('newer'), sid('a'), sid('b')])
  })
})

describe('filterUsageRows and sumUsage', () => {
  const rows = deriveUsageRows(
    listOf(
      summary({
        id: sid('alpha'), displayTitle: 'Alpha chat', updatedAt: 2,
        projectionValues: usage(10, 5),
      }),
      summary({
        id: sid('beta'), displayTitle: 'Beta', cwd: '/work/other', updatedAt: 1,
        projectionValues: usage(100, 0),
      }),
    ),
    [workspace('proj', ['alpha'], 'Project')],
    [],
    'Ungrouped',
  )

  it('filters by title, workspace, and minimum total', () => {
    expect(filterUsageRows(rows, { query: 'alpha', minTotal: 0 }).map(row => row.id))
      .toEqual([sid('alpha')])
    expect(filterUsageRows(rows, { query: 'PROJECT', minTotal: 0 }).map(row => row.id))
      .toEqual([sid('alpha')])
    expect(filterUsageRows(rows, { query: '', minTotal: 20 }).map(row => row.id))
      .toEqual([sid('beta')])
    expect(filterUsageRows(rows, { query: 'nope', minTotal: 0 })).toEqual([])
  })

  it('sums the visible billed buckets', () => {
    expect(sumUsage(rows)).toEqual({ sessions: 2, input: 110, output: 5, total: 115 })
    expect(sumUsage([])).toEqual({ sessions: 0, input: 0, output: 0, total: 0 })
  })
})

describe('export documents', () => {
  it('quotes CSV cells that contain commas or quotes', () => {
    const rows = deriveUsageRows(
      listOf(summary({
        id: sid('quoted'),
        displayTitle: 'Say "hello", world',
        updatedAt: Date.parse('2026-08-14T00:00:00.000Z'),
        projectionValues: usage(1, 2),
      })),
      [],
      [],
      'Ungrouped',
    )
    const csv = usageCsv(rows)
    expect(csv).toContain('title,workspace,sessionId,input,output,cacheRead,cacheWrite,total,updatedAt')
    expect(csv).toContain('"Say ""hello"", world"')
    expect(csv).toContain('2026-08-14T00:00:00.000Z')
  })

  it('serializes JSON with totals and origin null when absent', () => {
    const rows = deriveUsageRows(
      listOf(summary({
        id: sid('json'), displayTitle: 'Json', updatedAt: Date.parse('2026-08-14T00:00:00.000Z'),
        projectionValues: usage(3, 4),
      })),
      [],
      [],
      'Ungrouped',
    )
    const parsed = JSON.parse(usageJson(rows, sumUsage(rows))) as {
      totals: { sessions: number; total: number }
      sessions: { origin: null; sessionId: string }[]
    }
    expect(parsed.totals).toEqual({ sessions: 1, input: 3, output: 4, total: 7 })
    expect(parsed.sessions[0]?.origin).toBeNull()
    expect(parsed.sessions[0]?.sessionId).toBe('json')
  })
})
