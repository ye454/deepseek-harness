/**
 * Client-safe billed totals and compact spelling for {@link TokenUsageProjection}.
 *
 * @module @deepseek-ai/dsh-token-meter/display
 */

import type { TokenUsageProjection } from './projection.ts'

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Sum billed input and output for one session log.
 * @param usage - the session's token-usage projection value.
 * @returns billed input plus output tokens.
 */
export function billedTotalTokens(usage: TokenUsageProjection): number {
  return billedInputTokens(usage) + usage.outputTokens
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatCompactTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}
