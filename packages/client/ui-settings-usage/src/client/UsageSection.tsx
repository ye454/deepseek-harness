/**
 * Usage settings section: billed token totals per session from the existing
 * list `tokenUsage` projection, with title/workspace filter, a minimum-total
 * bound, and CSV/JSON export of the visible rows.
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatCompactTokens } from '@deepseek-ai/dsh-token-meter/client'
import {
  deriveUsageRows, filterUsageRows, sumUsage, usageCsv, usageJson, type UsageRow,
} from './usage-rows.ts'
import css from './UsageSection.module.css'

/** Registration-side callbacks used by the section. */
export interface UsageSectionInjected {
  /** Open a session by id (then the section closes settings). */
  open: (sessionId: SessionId) => void
  /** Save a text document through the browser download affordance. */
  downloadText: (filename: string, mime: string, body: string) => void
}

/** Full component props assembled by the Settings slot renderer. */
export type UsageSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.usage'>
  & InjectFace<UsageSectionInjected>

/**
 * Parse the minimum-total field: empty or invalid input is treated as 0.
 * @param raw - the number input's current value.
 * @returns a non-negative integer lower bound.
 */
function parseMinTotal(raw: string): number {
  if (raw.trim() === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

/**
 * Render one tag for archived or subagent rows.
 * @param row - derived usage row.
 * @param t - section copy.
 * @returns the tag span, or null when neither applies.
 */
function rowTag(row: UsageRow, t: UsageSectionProps['t']): ReactNode {
  if (row.archived) return <span className={css.tag}>{t('archived')}</span>
  if (row.origin === 'subagent') return <span className={css.tag}>{t('subagent')}</span>
  return null
}

/**
 * Render the Usage settings page.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function UsageSection({
  useSessions, useWorkspaces, close, t, open, downloadText,
}: UsageSectionProps): ReactNode {
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const [query, setQuery] = useState('')
  const [minTotalRaw, setMinTotalRaw] = useState('')

  const rows = useMemo(
    () => deriveUsageRows(list, workspaces, archivedSessionIds, t('ungrouped')),
    [list, workspaces, archivedSessionIds, t],
  )
  const visible = useMemo(
    () => filterUsageRows(rows, { query, minTotal: parseMinTotal(minTotalRaw) }),
    [rows, query, minTotalRaw],
  )
  const totals = useMemo(() => sumUsage(visible), [visible])

  /**
   * Download the currently visible rows as CSV or JSON.
   * @param kind - export format.
   */
  const exportVisible = (kind: 'csv' | 'json'): void => {
    if (kind === 'csv') {
      downloadText('dsh-usage.csv', 'text/csv', usageCsv(visible))
      return
    }
    downloadText('dsh-usage.json', 'application/json', usageJson(visible, totals))
  }

  /**
   * Open the selected session and close the settings panel.
   * @param id - session to open.
   */
  const openSession = (id: SessionId): void => {
    open(id)
    close()
  }

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <div className={css.toolbar}>
        <label className={css.search}>
          <IconSearchOutline16 aria-hidden="true" />
          <span className={css.visuallyHidden}>{t('search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </label>
        <label className={css.minTotal}>
          <span>{t('minTotal')}</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={minTotalRaw}
            placeholder="0"
            aria-label={t('minTotal')}
            onChange={(event) => { setMinTotalRaw(event.currentTarget.value) }}
          />
        </label>
        <div className={css.exports}>
          <Button
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={() => { exportVisible('csv') }}
          >
            {t('exportCsv')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={() => { exportVisible('json') }}
          >
            {t('exportJson')}
          </Button>
        </div>
      </div>
      <p className={css.summary} data-usage-summary="">
        {t('totals.sessions', { n: totals.sessions })}
        {' · '}
        {t('col.input')} {formatCompactTokens(totals.input)}
        {' · '}
        {t('col.output')} {formatCompactTokens(totals.output)}
        {' · '}
        {t('col.total')} {formatCompactTokens(totals.total)}
      </p>
      {rows.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
      {rows.length > 0 && visible.length === 0 ? <p className={css.status}>{t('emptySearch')}</p> : null}
      {visible.length > 0 ? (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('col.title')}</th>
              <th>{t('col.workspace')}</th>
              <th>{t('col.input')}</th>
              <th>{t('col.output')}</th>
              <th>{t('col.total')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr key={row.id}>
                <td>
                  <button type="button" className={css.session} onClick={() => { openSession(row.id) }}>
                    <span className={css.sessionTitle}>{row.title}</span>
                    {rowTag(row, t)}
                  </button>
                </td>
                <td>{row.workspace}</td>
                <td className={css.numeric}>{formatCompactTokens(row.input)}</td>
                <td className={css.numeric}>{formatCompactTokens(row.output)}</td>
                <td className={css.numeric}>{formatCompactTokens(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
