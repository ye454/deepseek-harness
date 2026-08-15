/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-execution-thread`.
 * @module @deepseek-ai/dsh-execution-thread/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { ExecutionThreadId } from '@deepseek-ai/dsh-execution-thread'

const PACKAGE_NAME = '@deepseek-ai/dsh-execution-thread'

/** Cordis companion plugin name. */
export const name = 'execution-thread-invariant'
/** Services required before the invariant can observe the owned relation. */
export const inject = ['invariants']

/**
 * Every durable thread-table put must be immediately readable through the owning service at the same revision.
 */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'execution-thread' || change.table !== 'threads' || change.operation === 'deleted') return
      const thread = ctx.executionThreads.get(ExecutionThreadId(change.key))
      if (thread === undefined) {
        fail(`execution thread '${change.key}' committed durably but the executionThreads service cannot read it`)
      }
    })
  },
  { inject: ['executionThreads'] },
)

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
