/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-environment`.
 * @module @deepseek-ai/dsh-work-environment/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { WorkEnvironmentId } from '@deepseek-ai/dsh-work-environment'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-environment'

/** Cordis companion plugin name. */
export const name = 'work-environment-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every emitted mutation must already match the durable environment/binding projection. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('work-environment/changed', change => {
      const current = ctx.workEnvironments.get(WorkEnvironmentId(change.ref.id))
      if (
        current === undefined
        || current.revision !== change.ref.revision
        || current.nodeId !== change.environment.nodeId
        || current.capturedAt !== change.environment.capturedAt
      ) {
        fail(`work environment '${change.ref.id}' change event does not match durable state`)
      }
    })
    ctx.on('work-environment/binding-changed', change => {
      const current = ctx.workEnvironments.getBinding(change.ref.threadId)
      if (
        current === undefined
        || current.revision !== change.ref.revision
        || current.environmentId !== change.binding.environmentId
        || current.environmentRevision !== change.binding.environmentRevision
      ) {
        fail(`execution thread '${change.ref.threadId}' environment binding event does not match durable state`)
      }
    })
  },
  { inject: ['workEnvironments'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
