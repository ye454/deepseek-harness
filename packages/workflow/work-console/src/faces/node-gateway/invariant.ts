/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-node-gateway`.
 * @module @deepseek-ai/dsh-work-node-gateway/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-node-gateway'

/** Cordis companion plugin name. */
export const name = 'work-node-gateway-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every package-owned command event must match the already-published durable command projection. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('work-node-gateway/command-changed', change => {
      const current = ctx.workNodeGateway.getCommand(change.command.id)
      if (
        current === undefined
        || current.state !== change.command.state
        || current.updatedAt !== change.command.updatedAt
        || current.kind !== change.command.kind
        || current.nodeId !== change.command.nodeId
      ) {
        fail(`remote command '${change.command.id}' event does not match durable gateway state`)
      }
    })
  },
  { inject: ['workNodeGateway'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
