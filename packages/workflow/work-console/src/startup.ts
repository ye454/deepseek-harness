/**
 * Single external DSH plugin boundary for the continuous-work system.
 *
 * The Work subsystem is one installable bundle. Domain services stay split into
 * focused internal modules, but they are mounted as child Cordis plugins owned
 * by this one root fiber instead of being installed as independent DSH bundles.
 */
import type { Context } from '@deepseek-ai/cordis'
import WorkControl from '@deepseek-ai/dsh-work-control'
import WorkEnvironment from '@deepseek-ai/dsh-work-environment'
import WorkExecution from '@deepseek-ai/dsh-work-execution'
import WorkExecutionCoordinator from '@deepseek-ai/dsh-work-execution-coordinator'
import WorkNode from '@deepseek-ai/dsh-work-node'
import WorkOrchestrator from '@deepseek-ai/dsh-work-orchestrator'
import WorkValidation from '@deepseek-ai/dsh-work-validation'
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
