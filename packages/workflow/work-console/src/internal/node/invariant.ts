/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-node`.
 * @module @deepseek-ai/dsh-work-node/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { WorkNodeId } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-console/internal-node'

/** Cordis companion plugin name. */
export const name = 'work-node-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every package-owned change event must match the already-published durable node projection. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('work-node/changed', (change) => {
      const current = ctx.workNodes.get(WorkNodeId(change.ref.id))
      if (
        current === undefined
        || current.revision !== change.ref.revision
        || current.state !== change.node.state
        || current.protocolVersion !== change.node.protocolVersion
        || current.lastSeenAt !== change.node.lastSeenAt
      ) {
        fail(`work node '${change.ref.id}' change event does not match the durable registry projection`)
      }
    })
  },
  { inject: ['workNodes'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
