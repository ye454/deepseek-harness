/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-validation`.
 * @module @deepseek-ai/dsh-work-validation/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-validation'

/** Cordis companion plugin name. */
export const name = 'work-validation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every emitted validation mutation must already match the durable detailed projection. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('work-validation/session-changed', change => {
      const current = ctx.workValidation.getSession(change.session.taskId)
      if (
        current === undefined
        || current.generation !== change.session.generation
        || current.policyFingerprint !== change.session.policyFingerprint
        || current.startedTaskRevision !== change.session.startedTaskRevision
      ) {
        fail(`task '${change.session.taskId}' validation session event does not match durable state`)
      }
    })
    ctx.on('work-validation/result-changed', change => {
      const current = ctx.workValidation.listResults(change.result.taskId, change.result.generation)
        .find(result => result.validatorIndex === change.result.validatorIndex)
      if (
        current === undefined
        || current.revision !== change.result.revision
        || current.outcome !== change.result.outcome
        || current.source !== change.result.source
        || current.validatorKind !== change.result.validatorKind
      ) {
        fail(`task '${change.result.taskId}' validator ${change.result.validatorIndex} event does not match durable state`)
      }
    })
  },
  { inject: ['workValidation'] },
)

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
