/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-control`.
 * @module @deepseek-ai/dsh-work-control/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { WorkItemId } from '@deepseek-ai/dsh-work-control'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-control'

/** Cordis companion plugin name. */
export const name = 'work-control-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every package-owned change event must equal the service's authoritative durable projection at emission. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('work-control/changed', change => {
      if (change.operation === 'delete') {
        if (ctx.workControl.get(change.ref.id) !== undefined) {
          fail(`deleted work item '${change.ref.id}' is still published by ctx.workControl`)
        }
        return
      }
      const current = ctx.workControl.get(WorkItemId(change.ref.id))
      if (current === undefined || current.revision !== change.ref.revision) {
        fail(`work item '${change.ref.id}' change event does not match the durable service projection`)
      }
    })
  },
  { inject: ['workControl'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
