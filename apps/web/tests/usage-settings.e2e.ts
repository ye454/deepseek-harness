// Web e2e scenario: session-list compact billed totals and the Usage
// settings page over the durable tokenUsage projection. Two seeded logs
// carry known usage; the sidebar row shows the compact total, and Settings
// → 用量 lists both sessions with filter and export. Zero model calls.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/usage-settings', import.meta.url))
const PAGE_EXPECTED = join(SNAPSHOT_DIR, 'page.expected.md')
const MODE = webSnapshotMode()
const ALPHA_ID = 'usage-alpha'
const BETA_ID = 'usage-beta'

/**
 * Build a closed one-turn seed whose assistant message reports billed usage.
 * @param title - durable session title.
 * @param inputTokens - uncached input tokens on the final usage sample.
 * @param outputTokens - output tokens on the final usage sample.
 * @param messageId - unique assistant message id for this seed.
 * @returns session.jsonl text for {@link seedSession}.
 */
function buildSeed(
  title: string,
  inputTokens: number,
  outputTokens: number,
  messageId: string,
): string {
  const lines = [JSON.stringify({
    type: 'session', version: 0, id: '{{sessionId}}', createdAt: 1784974100000,
  })]
  let seq = 0
  let time = 1784974100000
  const at = (event: Record<string, unknown>): void => {
    lines.push(JSON.stringify({ ...event, seq: seq++, time: time++ }))
  }
  at({
    type: 'turn/start',
    data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user', rpcId: 'seed' } } },
  })
  at({
    type: 'user/message',
    data: { content: [{ type: 'text', text: title }], source: { kind: 'user', rpcId: 'seed' } },
    surfaceOp: 'append',
  })
  at({
    type: 'session/title',
    data: { title, messageSeqs: [1], source: { kind: 'fallback' } },
  })
  at({ type: 'step/start', data: { turn: 1, step: 1 } })
  at({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: messageId,
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: 'snapshot', model: 'snapshot-replier' },
      },
      usage: { inputTokens, outputTokens },
    },
    sourceEventSeqs: [],
    surfaceOp: 'append',
  })
  at({ type: 'step/end', data: { turn: 1, step: 1 } })
  at({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  return `${lines.join('\n')}\n`
}

describe('web e2e: Usage settings page and list token totals', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    if (MODE === 'record') throw new Error('usage-settings is a keyless assembled snapshot')
    scaffold = await launchWebScaffold({})
    await seedSession(
      scaffold,
      buildSeed('Alpha billed', 100, 20, '00000000-0000-4000-8000-0000000000aa'),
      ALPHA_ID,
    )
    await seedSession(
      scaffold,
      buildSeed('Beta billed', 12_240, 300, '00000000-0000-4000-8000-0000000000bb'),
      BETA_ID,
    )
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1680, height: 1000 },
      locale: ZH_BROWSER_LOCALE,
      acceptDownloads: true,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const ungrouped = page.getByText('未分组', { exact: true })
    await ungrouped.waitFor({ timeout: 15_000 })
    if (await ungrouped.locator('..').locator('..').getAttribute('aria-expanded') !== 'true') {
      await ungrouped.click()
    }
    // Cold list rows have no title/tokenUsage cache; opening attaches the
    // log so the live title and tokenUsage projections reach the list.
    const seeded = page.getByRole('treeitem')
      .filter({ hasNotText: '未分组' })
      .filter({ hasNotText: '新会话' })
    const deadline = Date.now() + 15_000
    while (await seeded.count() < 2) {
      if (Date.now() > deadline) throw new Error('seeded session rows never appeared under Ungrouped')
      await page.waitForTimeout(200)
    }
    await seeded.nth(0).click()
    await page.getByText('ok', { exact: true }).waitFor({ timeout: 15_000 })
    await seeded.nth(1).click()
    await page.getByText('ok', { exact: true }).waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows compact billed totals on session rows', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-usage-list'))
    await page.getByRole('treeitem', { name: /Alpha billed/ }).waitFor({ timeout: 15_000 })
    await expect.poll(() => page.getByText('12.5K').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(() => page.getByText('120').count(), { timeout: 5_000 }).toBeGreaterThan(0)
  }, 60_000)

  it('lists billed sessions on the Usage page and exports the visible rows', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-usage-page'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '用量' }).click()
    await dialog.getByRole('heading', { name: '用量' }).waitFor({ timeout: 10_000 })
    const summary = dialog.locator('[data-usage-summary]')
    await expect.poll(() => summary.textContent(), { timeout: 10_000 }).toMatch(/2 个会话/)
    await dialog.getByText('Alpha billed').waitFor({ timeout: 10_000 })
    expect(await dialog.getByText('Beta billed').count()).toBe(1)
    const snapshot = (await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd))
      // normalizeAria splits the workspace basename on '/', which misses
      // Windows temp paths; collapse it here too so the golden is portable.
      .split(scaffold.workspaceCwd.split(/[\\/]/).pop()!).join('{{workspace}}')
    await compareOrRefreshGolden(PAGE_EXPECTED, snapshot, MODE)

    await dialog.getByRole('searchbox', { name: '搜索会话或工作区' }).fill('Beta')
    expect(await dialog.getByText('Alpha billed').count()).toBe(0)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '导出 CSV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('dsh-usage.csv')
    const csv = await readFile(await download.path(), 'utf8')
    expect(csv).toContain('Beta billed')
    expect(csv).not.toContain('Alpha billed')
  }, 60_000)

  it('issued zero model calls and stayed clean', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['page.expected.md'])
  })
})
