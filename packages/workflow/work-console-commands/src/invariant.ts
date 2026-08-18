/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-console-commands`.
 * Command mutations are asserted by the Work Control and Work Validation domain invariants.
 * @module @deepseek-ai/dsh-work-console-commands/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-console-commands'

/** Cordis companion plugin name. */
export const name = 'work-console-commands-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** This package owns no durable table/event stream beyond mutations asserted by its dependencies. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
