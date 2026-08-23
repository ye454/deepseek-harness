/** Host-owned intake and organization commands for Work Console V1. */
import type { Context } from '@deepseek-ai/cordis'
import {
  WorkItemConflictError,
  WorkItemId,
  WorkItemTransitionError,
} from './internal/control/index.ts'
import type {
  CreateWorkConsoleIdeaRequest,
  CreateWorkConsoleIdeaResult,
  OrganizeWorkConsoleTaskRequest,
  OrganizeWorkConsoleTaskResult,
} from './intake-types.ts'
import { organizationTemplate } from './organization-templates.ts'
import type { WorkConsoleCommandSuccess } from './types.ts'

/** Capture one passive Idea without creating execution state. */
export async function createWorkConsoleIdea(
  ctx: Context,
  request: CreateWorkConsoleIdeaRequest,
): Promise<CreateWorkConsoleIdeaResult> {
  const title = request.title.trim()
  if (title.length === 0) {
    return { ok: false, error: { code: 'invalid-input', field: 'title', reason: 'title must not be empty' } }
  }
  const idea = await ctx.workControl.createIdea({
    title,
    ...(request.summary === undefined ? {} : { summary: request.summary }),
    ...(request.tags === undefined ? {} : { tags: request.tags }),
  })
  return success({ id: String(idea.id), revision: idea.revision, title: idea.title })
}

/** Commit the deterministic template selected by the human and admit the first execution stage. */
export async function organizeWorkConsoleTask(
  ctx: Context,
  request: OrganizeWorkConsoleTaskRequest,
): Promise<OrganizeWorkConsoleTaskResult> {
  const taskId = WorkItemId(request.taskId)
  const current = ctx.workControl.get(taskId)
  if (current === undefined) return { ok: false, error: { code: 'not-found', id: request.taskId } }
  if (current.revision !== request.taskRevision) {
    return {
      ok: false,
      error: {
        code: 'conflict',
        id: request.taskId,
        expectedRevision: request.taskRevision,
        currentRevision: current.revision,
      },
    }
  }
  if (current.kind !== 'task' || current.status !== 'organizing') {
    return {
      ok: false,
      error: {
        code: 'invalid-state',
        id: request.taskId,
        reason: current.kind === 'idea' ? 'work item is still a passive idea' : `task status is ${current.status}`,
      },
    }
  }

  try {
    const organized = await ctx.workControl.organizeTask(
      { id: current.id, revision: current.revision },
      organizationTemplate(request.taskType),
    )
    if (organized.currentStageId === undefined) {
      throw new Error(`organized task '${organized.id}' has no current stage`)
    }
    return success({
      taskId: String(organized.id),
      revision: organized.revision,
      status: 'running',
      taskType: request.taskType,
      stageId: organized.currentStageId,
    })
  } catch (error) {
    if (error instanceof WorkItemConflictError) {
      return {
        ok: false,
        error: {
          code: 'conflict',
          id: request.taskId,
          expectedRevision: request.taskRevision,
          currentRevision: error.actualRevision,
        },
      }
    }
    if (error instanceof WorkItemTransitionError) {
      return { ok: false, error: { code: 'invalid-state', id: request.taskId, reason: error.message } }
    }
    throw error
  }
}

function success<T>(value: T): WorkConsoleCommandSuccess<T> {
  return { ok: true, value }
}
