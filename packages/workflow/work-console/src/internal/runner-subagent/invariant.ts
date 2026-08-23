/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-runner-subagent`.
 * @module @deepseek-ai/dsh-work-runner-subagent/invariant
 */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { WORK_RUNNER_PROMPT_PREFIX } from './prompt.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-runner-subagent'

/** Cordis companion plugin name. */
export const name = 'work-runner-subagent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every package request event must truthfully describe its exact bounded prompt. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('session/event', (_session, event) => {
      if (event.type !== 'work-runner/subagent-request') return
      const data = event.data
      const bytes = Buffer.byteLength(data.prompt, 'utf8')
      if (
        data.kind !== 'work-runner/subagent-request'
        || data.version !== 1
        || data.mode !== 'one-shot'
        || data.promptBytes !== bytes
        || data.promptBytes > data.maxPromptBytes
        || !data.prompt.startsWith(WORK_RUNNER_PROMPT_PREFIX)
      ) {
        fail(`work runner request at seq ${event.seq} does not truthfully describe its bounded prompt`)
      }
    })
  },
  { inject: ['sessions'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
