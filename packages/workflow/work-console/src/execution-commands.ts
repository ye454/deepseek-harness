/** Host-owned Work Console execution-plan command. */
import type { Context } from '@deepseek-ai/cordis'
import { WorkItemId } from '@deepseek-ai/dsh-work-control'
import { WorkEnvironmentId } from '@deepseek-ai/dsh-work-environment'
import {
  WorkOrchestratorError,
  WorkOrchestratorPartialStartError,
} from '@deepseek-ai/dsh-work-orchestrator'
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
  try {
    const result = await ctx.workOrchestrator.startTask({
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
