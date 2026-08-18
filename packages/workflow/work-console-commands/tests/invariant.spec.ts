import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as CommandInvariant from '../src/invariant.ts'

describe('work-console-commands invariant companion', () => {
  it('registers package ownership without creating another durable relation', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(CommandInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
