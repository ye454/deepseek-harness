/** Package-owned invariant companion for `@deepseek-ai/dsh-work-orchestrator`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-console/internal-orchestrator'

export const name = 'work-orchestrator-invariant'
export const inject = ['invariants']

/** The Orchestrator owns scheduling policy but no second durable record family. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
