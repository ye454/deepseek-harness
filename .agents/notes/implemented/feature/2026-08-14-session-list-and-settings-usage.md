# Agent Note: Session-list and Settings usage from tokenUsage

Status: implemented

English | [中文](2026-08-14-session-list-and-settings-usage.zh.md)

## Problem

Provider-reported token usage already lives in the durable `tokenUsage` session projection and the conversation stats line, but the session list and Settings had no way to compare conversations or export those figures. Users who wire third-party OpenAI-compatible routes still need a per-conversation billed total without a second meter.

## Decision

**The list row and the Settings page both read the existing list `tokenUsage` projection.** `SessionSummary.projectionValues.tokenUsage` is already on every list snapshot. `ui-workspace` projects billed input/output/total onto `SessionNode` and paints a compact total on non-blank rows whose total is greater than zero; the hover card lists input, output, and total. Compact spelling is `formatCompactTokens` from `@deepseek-ai/dsh-token-meter/client`, shared with the composer stats line. That `/client` specifier is an exact inline-safe wire layer (types plus pure helpers); the host package root stays outside the client purity allowlist.

**Usage is a dedicated Settings section, not a General row.** `@deepseek-ai/dsh-client-ui-settings-usage` registers `settings.section` id `usage` at order `12`. It lists every non-blank session, including archived sessions and subagent children, filters locally by title/workspace and a minimum total, opens a row through `ctx.sessions.open` then `close()`, and downloads the visible rows as CSV or JSON. It does not add a Host RPC, a second fold, or a price column.

## Alternatives considered

**Put the page in `ui-workspace`.** Rejected because Settings self-registration already owns top-level pages (`ui-settings-models`), and mixing a billing table into the sidebar browser would couple browsing chrome to export/filter UI.

**Fold each session log in the browser.** Rejected because the list snapshot already carries the durable projection; a second fold would drift from the composer stats and cost a round trip per row.

**Show tokens only in the hover card.** Rejected because the requested list affordance is a comparable total at a glance; the hover card remains the breakdown.

## Consequences

A conversation with billed usage shows a compact total beside its relative time in the sidebar. Settings → 用量 (Usage) aggregates the same numbers, including sessions the sidebar hides (archived, subagent). Export is token counts, not currency. Sessions whose provider never reported usage stay unlabeled in the list and show zeros on the Usage page.
