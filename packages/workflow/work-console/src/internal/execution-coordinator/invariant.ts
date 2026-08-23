/** Package-owned invariant companion for the execution coordinator. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-execution-coordinator'

export const name = 'work-execution-coordinator-invariant'
export const inject = ['invariants']

/** The coordinator owns policy wiring, not a second durable record family. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
