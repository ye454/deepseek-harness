import { describe, expect, it } from 'vitest'
import {
  billedInputTokens, billedTotalTokens, formatCompactTokens,
} from '@deepseek-ai/dsh-token-meter/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'

const usage = (over: Partial<TokenUsageProjection> = {}): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
})

describe('token-meter display helpers', () => {
  it('sums disjoint billed buckets', () => {
    const sample = usage({
      uncachedInputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 40,
    })
    expect(billedInputTokens(sample)).toBe(60)
    expect(billedTotalTokens(sample)).toBe(100)
  })

  it('spells compact token counts', () => {
    expect(formatCompactTokens(517)).toBe('517')
    expect(formatCompactTokens(12_240)).toBe('12.2K')
    expect(formatCompactTokens(517_000)).toBe('517K')
    expect(formatCompactTokens(1_230_000)).toBe('1.2M')
    expect(formatCompactTokens(100_000_000)).toBe('100M')
  })
})
