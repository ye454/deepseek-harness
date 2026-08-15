/**
 * DSH subagent consumer for work-control execution threads. The bridge discovers real provider capabilities,
 * logs the exact child prompt, starts a published subagent, and records only runner facts in work-execution.
 * @module @deepseek-ai/dsh-work-runner-subagent
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SubagentResult, SubagentRun, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { ExecutionThreadConflictError } from '@deepseek-ai/dsh-work-execution'
import type { ExecutionStopReason, ExecutionThread, ExecutionThreadRef } from '@deepseek-ai/dsh-work-execution'
import type { TaskWorkItem } from '@deepseek-ai/dsh-work-control'
import { buildBoundedWorkPrompt } from './prompt.ts'
import type {
  RunOneShotRequest,
  RunOneShotResult,
  WorkRunnerDescriptor,
  WorkRunnerSubagentRequestEvent,
} from './types.ts'

export { buildBoundedWorkPrompt, WORK_RUNNER_PROMPT_PREFIX, WorkPromptBudgetError } from './prompt.ts'
export type * from './types.ts'

/** A bridge request cannot be admitted before any runner is published. */
export class WorkRunnerPreflightError extends Error {
  /** @param message - Concrete rejected preflight reason. */
  constructor(message: string) {
    super(message)
    this.name = 'WorkRunnerPreflightError'
  }
}

/** Stateless bridge from work execution threads to registered DSH subagent providers. */
export class WorkSubagentRunner extends Service {
  static inject = ['subagents', 'workControl', 'workExecution']

  constructor(ctx: Context) {
    super(ctx, 'workSubagentRunner')
  }

  /**
   * Discover registered providers without inventing capabilities they do not expose.
   * @returns provider facts in DSH registry order.
   */
  listRunners(): WorkRunnerDescriptor[] {
    return this.ctx.subagents.list().map(name => {
      const provider = this.ctx.subagents.getProvider(name)
      /* v8 ignore next -- list() is derived from the same provider map used by getProvider(). */
      if (provider === undefined) throw new Error(`subagent provider '${name}' disappeared during discovery`)
      return {
        provider: provider.name,
        oneShot: true,
        continuable: provider.prepareContinuable !== undefined,
        inheritsParentContext: provider.inheritsParentContext,
        capabilities: { ...provider.capabilities },
      }
    })
  }

  /**
   * Run one one-shot provider against the current task context. Preflight and prompt-budget failures happen
   * before the request event; after the exact prompt is logged, provider startup may still reject without a
   * published run. A published run is immediately attached to the thread or disposed if that commit loses a race.
   * @param request - thread, delegating parent, provider, cancellation, byte budget, and optional Handoff.
   * @returns runner output plus the settled execution-thread projection.
   */
  async runOneShot(request: RunOneShotRequest): Promise<RunOneShotResult> {
    request.signal.throwIfAborted()
    const provider = this.ctx.subagents.getProvider(request.provider)
    if (provider === undefined) {
      throw new WorkRunnerPreflightError(`no DSH subagent provider registered for '${request.provider}'`)
    }

    const thread = this.requireIdleThread(request.thread)
    const task = this.requireRunningTask(thread)
    const prompt = buildBoundedWorkPrompt(task, request.handoff, request.maxPromptBytes)
    const event: WorkRunnerSubagentRequestEvent = {
      kind: 'work-runner/subagent-request',
      version: 1,
      taskId: task.id,
      threadId: thread.id,
      threadRevision: thread.revision,
      provider: provider.name,
      mode: 'one-shot',
      maxPromptBytes: request.maxPromptBytes,
      prompt: prompt.text,
    }
    request.parent.session.append('work-runner/subagent-request', event)

    const run = await this.ctx.subagents.start(provider.name, {
      label: task.title,
      prompt: [{ type: 'text', text: prompt.text }],
      parent: request.parent,
      signal: request.signal,
    })

    let running: ExecutionThread
    try {
      running = await this.ctx.workExecution.beginAttempt(request.thread, {
        provider: provider.name,
        mode: 'one-shot',
        subagentSessionId: run.id,
      })
    } catch (error) {
      await disposeAfterFailure(run, error)
    }

    try {
      const result = await run.result
      const stopReason = mapStopReason(result.stopReason)
      const settled = await this.ctx.workExecution.settleAttempt(refOf(running), { stopReason })
      await run.dispose()
      return {
        provider: provider.name,
        childId: run.id,
        output: result.output,
        stopReason,
        thread: settled,
      }
    } catch (error) {
      await this.settleUnknownIfStillRunning(running)
      await disposeAfterFailure(run, error)
    }
  }

  private requireIdleThread(expected: ExecutionThreadRef): ExecutionThread {
    const current = this.ctx.workExecution.get(expected.id)
    if (current === undefined) {
      throw new WorkRunnerPreflightError(`unknown execution thread '${expected.id}'`)
    }
    if (current.revision !== expected.revision) {
      throw new ExecutionThreadConflictError(expected, current.revision)
    }
    if (current.state !== 'idle' || current.activeAttempt !== undefined) {
      throw new WorkRunnerPreflightError(`execution thread '${expected.id}' is not idle`)
    }
    return current
  }

  private requireRunningTask(thread: ExecutionThread): TaskWorkItem {
    const item = this.ctx.workControl.get(thread.taskId)
    if (item === undefined) {
      throw new WorkRunnerPreflightError(`execution thread '${thread.id}' references unknown task '${thread.taskId}'`)
    }
    if (item.kind !== 'task' || item.status !== 'running') {
      throw new WorkRunnerPreflightError(`work item '${thread.taskId}' is not a running task`)
    }
    return item
  }

  private async settleUnknownIfStillRunning(running: ExecutionThread): Promise<void> {
    const current = this.ctx.workExecution.get(running.id)
    if (current?.state !== 'running' || current.revision !== running.revision) return
    try {
      await this.ctx.workExecution.settleAttempt(refOf(current), { stopReason: 'unknown' })
    } catch (settleError) {
      this.ctx.logger.warn(`work runner: failed to settle thread '${running.id}' after runner failure: ${String(settleError)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workSubagentRunner: WorkSubagentRunner
  }
}

function refOf(thread: ExecutionThread): ExecutionThreadRef {
  return { id: thread.id, revision: thread.revision }
}

function mapStopReason(reason: SubagentStopReason): ExecutionStopReason {
  switch (reason) {
    case 'completed': return 'completed'
    case 'aborted': return 'cancelled'
    case 'error': return 'failed'
    case 'max-tokens': return 'limit'
    case 'refusal': return 'refused'
    default:
      // SubagentStopReasonMap is merge-extensible; unrecognized provider variants remain visible as unknown.
      return 'unknown'
  }
}

async function disposeAfterFailure(run: SubagentRun, error: unknown): Promise<never> {
  try {
    await run.dispose()
  } catch (disposeError) {
    throw new AggregateError([error, disposeError], 'work runner operation and subagent disposal both failed')
  }
  throw error
}

/** Type-only compile anchor for the imported result contract. */
const _subagentResultContract: SubagentResult | undefined = undefined
void _subagentResultContract

export default WorkSubagentRunner
