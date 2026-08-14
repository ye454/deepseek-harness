# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

Usage settings page. The browser plugin registers one localized `settings.section` contribution with id `usage` at order `12`. It performs no extra Host read: billed totals come from the session-list `tokenUsage` projection already on each `SessionSummary`, the same durable meter the conversation stats line reads.

The page lists every non-blank session, including archived sessions and subagent children. Each row shows title, workspace (or Ungrouped), input, output, and total. A title/workspace search and a minimum-total filter apply locally. Opening a row calls `ctx.sessions.open` and closes Settings. **Export CSV** and **Export JSON** download the currently visible rows; CSV columns are title, workspace, sessionId, input, output, cacheRead, cacheWrite, total, and updatedAt.

Compact spelling of token counts is `formatCompactTokens` from [`dsh-token-meter`](../../llm/token-meter/README.md). Registration uses `ctx.slots.inject()`, so it follows late section declaration, redeclaration, locale changes, and teardown.

## Model Experience

None, as this package only visualizes an existing session-list projection in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **List projection only** — the page does not re-fold a session log or estimate cost; a session whose provider never reported usage shows zeros.
- **No price or model breakdown** — export is token counts, not currency or per-model rows.
