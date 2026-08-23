import { describe, expect, it, vi } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('work-execution-coordinator invariant companion', () => {
  it('registers the package-owned no-op installer', async () => {
    const register = vi.fn().mockReturnValue(() => {})
    const ctx = { invariants: { register } } as never
    const dispose = await invariant.apply(ctx)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-work-execution-coordinator', expect.any(Function))
    expect(() => { (register.mock.calls[0]![1] as (ctx: never) => void)(undefined as never) }).not.toThrow()
    expect(dispose).toBeTypeOf('function')
  })
})
