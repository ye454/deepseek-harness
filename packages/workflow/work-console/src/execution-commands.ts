/** Host-owned Work Console execution-plan command. */
import type { Context } from '@deepseek-ai/cordis'
import { WorkItemId } from './internal/control/index.ts'
import { WorkEnvironmentId } from './internal/environment/index.ts'
import {
  WorkOrchestratorError,
  WorkOrchestratorPartialStartError,
  type WorkOrchestrator,
} from './internal/orchestrator/index.ts'
import type {
  StartWorkConsoleExecutionRequest,
  StartWorkConsoleExecutionResult,
  StartedWorkConsoleExecutionPlacement,
} from './execution-types.ts'

/** Queue one explicit execution plan through the scheduler-owned orchestration boundary. */
export async function startWorkConsoleExecution(
  ctx: Context,
  request: StartWorkConsoleExecutionRequest,
): Promise<StartWorkConsoleExecutionResult> {
  const orchestrator = optionalOrchestrator(ctx)
  if (orchestrator === undefined) {
    return { ok: false, error: { code: 'execution-unavailable', reason: 'work orchestrator is not configured' } }
  }
  try {
    const result = await orchestrator.startTask({
      taskId: WorkItemId(request.taskId),
      taskRevision: request.taskRevision,
      placements: request.placements.map(placement => ({
        environmentId: WorkEnvironmentId(placement.environmentId),
        environmentRevision: placement.environmentRevision,
        provider: placement.provider,
        role: placement.role,
      })),
    })
    return {
      ok: true,
      value: {
        taskId: String(result.taskId),
        started: result.started.map(projectStarted),
      },
    }
  } catch (error) {
    if (error instanceof WorkOrchestratorPartialStartError) {
      return {
        ok: false,
        error: {
          code: 'partial-start',
          reason: error.message,
          failedIndex: error.failedIndex,
          started: error.started.map(projectStarted),
        },
      }
    }
    if (error instanceof WorkOrchestratorError) {
      return {
        ok: false,
        error: {
          code: error.message.includes('gateway is not configured') ? 'execution-unavailable' : 'invalid-plan',
          reason: error.message,
        },
      }
    }
    throw error
  }
}

function optionalOrchestrator(ctx: Context): WorkOrchestrator | undefined {
  return (ctx as unknown as { readonly workOrchestrator?: WorkOrchestrator }).workOrchestrator
}

function projectStarted(value: {
  readonly threadId: string
  readonly environmentId: string
  readonly provider: string
  readonly role: string
  readonly commandId: string
}): StartedWorkConsoleExecutionPlacement {
  return {
    threadId: String(value.threadId),
    environmentId: String(value.environmentId),
    provider: value.provider,
    role: value.role,
    commandId: value.commandId,
  }
}
