/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-work-console`.
 * @module @deepseek-ai/dsh-client-ui-work-console/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-work-console'

/** Cordis companion plugin name. */
export const name = 'client-ui-work-console-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No Host runtime invariant: browser state is covered by slot/store/Remote tests. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
