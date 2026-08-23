/**
 * Single external DSH plugin boundary for the continuous-work system.
 *
 * The Work subsystem is one installable bundle. Domain services live under
 * this package and are mounted as child Cordis plugins owned by this root fiber.
 */
import type { Context } from '@deepseek-ai/cordis'
import WorkControl from './internal/control/index.ts'
import WorkEnvironment from './internal/environment/index.ts'
import WorkExecution from './internal/execution/index.ts'
import WorkExecutionCoordinator from './internal/execution-coordinator/index.ts'
import WorkNode from './internal/node/index.ts'
import WorkOrchestrator from './internal/orchestrator/index.ts'
import WorkValidation from './internal/validation/index.ts'
import { WorkConsoleGateway } from './index.ts'

export * from './index.ts'

/** Stable external plugin name. */
export const name = 'work-console'

/**
 * Mount the default Host-plane Work stack below one owning plugin fiber.
 * Cordis resolves each child's `inject` dependencies; listing order only mirrors
 * the domain layering for readability.
 */
export function apply(ctx: Context): void {
  ctx.plugin(WorkControl)
  ctx.plugin(WorkExecution)
  ctx.plugin(WorkNode)
  ctx.plugin(WorkEnvironment)
  ctx.plugin(WorkOrchestrator)
  ctx.plugin(WorkValidation)
  ctx.plugin(WorkExecutionCoordinator)
  ctx.plugin(WorkConsoleGateway)
}
