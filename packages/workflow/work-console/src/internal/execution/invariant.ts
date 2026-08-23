/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-execution`.
 * @module @deepseek-ai/dsh-work-execution/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { ExecutionThreadId } from '@deepseek-ai/dsh-work-execution'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-execution'

/** Cordis companion plugin name. */
export const name = 'work-execution-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every package-owned event must describe the thread projection already visible through the service. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('work-execution/changed', change => {
      const current = ctx.workExecution.get(ExecutionThreadId(change.ref.id))
      if (
        current === undefined
        || current.revision !== change.ref.revision
        || current.taskId !== change.thread.taskId
        || current.state !== change.thread.state
        || current.attemptSeq !== change.thread.attemptSeq
      ) {
        fail(`execution thread '${change.ref.id}' change event does not match the durable service projection`)
      }
    })
  },
  { inject: ['workExecution'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
