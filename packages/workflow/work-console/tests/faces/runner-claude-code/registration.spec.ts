import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type WorkNodeDaemon from '@deepseek-ai/dsh-work-node-daemon'
import type { WorkNodeRunnerProvider } from '@deepseek-ai/dsh-work-node-daemon'
import { apply } from '../src/index.ts'

function fixture() {
  const ctx = new Context()
  let provider: WorkNodeRunnerProvider | undefined
  ctx.provide('workNodeDaemon', {
    registerRunner(value: WorkNodeRunnerProvider) {
      provider = value
      return () => { if (provider === value) provider = undefined }
    },
  } as WorkNodeDaemon)
  ctx.provide('subprocess', {} as SubprocessRuntime)
  return { ctx, provider: () => provider }
}

describe('work-node-runner-claude-code', () => {
  it('registers the existing Claude Code runtime as one-shot only', () => {
    const { ctx, provider } = fixture()
    apply(ctx, { env: {}, disposeGraceMs: 3_000 })
    expect(provider()?.name).toBe('claude-code')
    expect(provider()?.modes).toEqual(['one-shot'])
  })

  it('fails loud on an invalid process-release bound', () => {
    const { ctx } = fixture()
    expect(() => apply(ctx, { env: {}, disposeGraceMs: 0 })).toThrow(/disposeGraceMs/)
  })
})
