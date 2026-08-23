/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-console`.
 * @module @deepseek-ai/dsh-work-console/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-console'

/** Cordis companion plugin name. */
export const name = 'work-console-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Read-only derived projection: it owns no durable mutation or event stream to assert. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
