/**
 * Pure derivation of billed-token rows from the session list snapshot.
 * Figures come from the durable `tokenUsage` projection already carried on
 * each list summary — this module does not meter a second time.
 */

import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { billedInputTokens, billedTotalTokens } from '@deepseek-ai/dsh-token-meter/client'

/** One billed session as the Usage page presents it. */
export interface UsageRow {
  id: SessionId
  title: string
  workspace: string
  workspaceId: WorkspaceId | undefined
  origin: SessionSummary['origin']
  archived: boolean
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  updatedAt: number
}

/** Local filter applied after {@link deriveUsageRows}. */
export interface UsageFilter {
  /** Case-insensitive substring of title or workspace label. */
  query: string
  /** Inclusive lower bound on billed total; 0 keeps every row. */
  minTotal: number
}

/** Aggregated billed totals over a row set. */
export interface UsageTotals {
  sessions: number
  input: number
  output: number
  total: number
}

/** CSV header, column order matching {@link usageCsv}. */
export const USAGE_CSV_HEADER = [
  'title', 'workspace', 'sessionId', 'input', 'output', 'cacheRead', 'cacheWrite', 'total', 'updatedAt',
] as const

/**
 * Directory display label: basename of the path (both separators accepted).
 * @param cwd - directory path, or undefined when the session has none.
 * @returns basename, the raw cwd when it has no basename, or undefined.
 */
function pathLabel(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base !== undefined && base !== '' ? base : cwd
}

/**
 * Resolve the workspace label for one session.
 * @param session - list summary.
 * @param workspaces - Host workspace list in stable order.
 * @param ungrouped - localized label for sessions outside every workspace.
 * @returns workspace title, path basename, or the ungrouped label.
 */
function workspaceOf(
  session: SessionSummary,
  workspaces: readonly WorkspaceView[],
  ungrouped: string,
): { label: string; workspaceId: WorkspaceId | undefined } {
  for (const workspace of workspaces) {
    if (workspace.sessionIds.includes(session.id)) {
      return { label: workspace.title, workspaceId: workspace.workspaceId }
    }
  }
  return { label: pathLabel(session.cwd) ?? ungrouped, workspaceId: undefined }
}

/**
 * Build billed rows for every non-blank session, including archived and
 * subagent sessions. Sort is total descending, then recency, then id.
 * @param list - session list snapshot.
 * @param workspaces - Host workspace list.
 * @param archivedSessionIds - registry-global archive set.
 * @param ungrouped - localized ungrouped label.
 * @returns rows ready to filter and render.
 */
export function deriveUsageRows(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  ungrouped: string,
): UsageRow[] {
  const archived = new Set(archivedSessionIds)
  const rows: UsageRow[] = []
  for (const id of list.ids) {
    const session = list.byId[id]
    if (session === undefined || session.blank) continue
    const usage = session.projectionValues?.tokenUsage
    const input = usage === undefined ? 0 : billedInputTokens(usage)
    const output = usage?.outputTokens ?? 0
    const cacheRead = usage?.cacheReadTokens ?? 0
    const cacheWrite = usage?.cacheWriteTokens ?? 0
    const total = usage === undefined ? 0 : billedTotalTokens(usage)
    const workspace = workspaceOf(session, workspaces, ungrouped)
    rows.push({
      id: session.id,
      title: session.displayTitle,
      workspace: workspace.label,
      workspaceId: workspace.workspaceId,
      origin: session.origin,
      archived: archived.has(session.id),
      input,
      output,
      cacheRead,
      cacheWrite,
      total,
      updatedAt: session.updatedAt,
    })
  }
  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.id < b.id ? -1 : 1
  })
  return rows
}

/**
 * Keep rows whose title or workspace contains the query and whose total
 * meets the inclusive minimum.
 * @param rows - derived usage rows.
 * @param filter - title/workspace query and minimum total.
 * @returns the matching subset in the original order.
 */
export function filterUsageRows(rows: readonly UsageRow[], filter: UsageFilter): UsageRow[] {
  const query = filter.query.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (row.total < filter.minTotal) return false
    if (query.length === 0) return true
    return row.title.toLocaleLowerCase().includes(query)
      || row.workspace.toLocaleLowerCase().includes(query)
  })
}

/**
 * Sum billed buckets over a row set.
 * @param rows - visible usage rows.
 * @returns session count plus input, output, and total tokens.
 */
export function sumUsage(rows: readonly UsageRow[]): UsageTotals {
  let input = 0
  let output = 0
  let total = 0
  for (const row of rows) {
    input += row.input
    output += row.output
    total += row.total
  }
  return { sessions: rows.length, input, output, total }
}

/**
 * Escape one CSV cell: quote when the value contains comma, quote, or newline.
 * @param value - raw cell text.
 * @returns RFC 4180 cell text.
 */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

/**
 * Serialize usage rows as CSV with a header line.
 * @param rows - visible usage rows.
 * @returns CSV document including a trailing newline.
 */
export function usageCsv(rows: readonly UsageRow[]): string {
  const lines = [USAGE_CSV_HEADER.join(',')]
  for (const row of rows) {
    lines.push([
      csvCell(row.title),
      csvCell(row.workspace),
      csvCell(row.id),
      String(row.input),
      String(row.output),
      String(row.cacheRead),
      String(row.cacheWrite),
      String(row.total),
      csvCell(new Date(row.updatedAt).toISOString()),
    ].join(','))
  }
  return `${lines.join('\n')}\n`
}

/**
 * Serialize usage rows plus totals as JSON.
 * @param rows - visible usage rows.
 * @param totals - aggregated billed totals for those rows.
 * @returns pretty-printed JSON document.
 */
export function usageJson(rows: readonly UsageRow[], totals: UsageTotals): string {
  return `${JSON.stringify({
    totals,
    sessions: rows.map(row => ({
      title: row.title,
      workspace: row.workspace,
      sessionId: row.id,
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      cacheWrite: row.cacheWrite,
      total: row.total,
      updatedAt: new Date(row.updatedAt).toISOString(),
      archived: row.archived,
      origin: row.origin ?? null,
    })),
  }, null, 2)}\n`
}
