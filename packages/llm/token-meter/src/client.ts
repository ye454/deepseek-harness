/**
 * Client-namespace projection of token-meter's browser-safe types and
 * compact billed-token display helpers.
 *
 * @module @deepseek-ai/dsh-token-meter/client
 */

export type * from './projection.ts'
export {
  billedInputTokens, billedTotalTokens, formatCompactTokens,
} from './display.ts'
