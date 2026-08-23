/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-node-daemon`.
 * @module @deepseek-ai/dsh-work-node-daemon/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-node-daemon'

/** Cordis companion plugin name. */
export const name = 'work-node-daemon-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every journal event must match the already-committed local durable record. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('work-node-daemon/command-changed', change => {
      const current = ctx.workNodeDaemon.getJournal(change.record.commandId)
      if (
        current === undefined
        || current.state !== change.record.state
        || current.updatedAt !== change.record.updatedAt
        || current.kind !== change.record.kind
        || current.reportedAt !== change.record.reportedAt
      ) {
        fail(`work-node-daemon command '${change.record.commandId}' event does not match durable journal state`)
      }
    })
  },
  { inject: ['workNodeDaemon'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
