/**
 * One-shot Codex Runner adapter for the remote WorkNode daemon.
 * @module @deepseek-ai/dsh-work-node-runner-codex
 */

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  startCodexRun,
} from '@deepseek-ai/dsh-subagent-codex'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { ExecutionStopReason } from '@deepseek-ai/dsh-work-execution'
import type { WorkNodeRunnerHandle, WorkNodeRunnerStartRequest } from '@deepseek-ai/dsh-work-node-daemon'

export const name = 'work-node-runner-codex'
export const inject = ['workNodeDaemon', 'subprocess']

/** Deployment-owned Codex environment and process-release bound. */
export interface Config {
  /** Explicit environment layered over the managed subprocess scrub. */
  env?: Record<string, string>
  /** Grace in milliseconds for Codex app-server process-tree termination. */
  disposeGraceMs?: number
}

export const Config: s<Config> = s.object({
  env: s.dict(s.string()).default({}),
  disposeGraceMs: s.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

type ResolvedConfig = Required<Config>

/**
 * Register the real Codex app-server runtime as a daemon-local one-shot Runner.
 * Native resume is deliberately not advertised: the existing Codex runtime starts
 * one fresh app-server thread per command and does not expose a continuable session contract.
 * @param ctx - daemon context carrying WorkNode and subprocess services.
 * @param config - explicit child environment and disposal grace.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertGrace(resolved.disposeGraceMs)

  ctx.effect(() => ctx.workNodeDaemon.registerRunner({
    name: 'codex',
    modes: ['one-shot'],
    start: request => startCodexDaemonRun(ctx, resolved, request),
  }), 'workNodeRunnerCodex.register')
}

async function startCodexDaemonRun(
  ctx: Context,
  config: ResolvedConfig,
  request: WorkNodeRunnerStartRequest,
): Promise<WorkNodeRunnerHandle> {
  if (request.mode !== 'one-shot' || request.resumeSessionId !== undefined) {
    throw new Error('work-node-runner-codex only supports fresh one-shot execution')
  }

  const localAbort = new AbortController()
  const signal = AbortSignal.any([request.signal, localAbort.signal])
  const run = await startCodexRun(
    {
      prompt: [{ type: 'text', text: request.prompt }],
      signal,
    },
    {
      cwd: request.cwd,
      env: config.env,
      disposeGraceMs: config.disposeGraceMs,
      spawn: spec => ctx.subprocess.spawn(spec),
      onError: (error, stopReason) => {
        ctx.logger.warn(`work-node-runner-codex: run failed (${stopReason}): ${error.message}`)
      },
    },
  )

  let disposePromise: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    localAbort.abort(new Error('work-node-runner-codex disposed'))
    disposePromise ??= run.dispose()
    return disposePromise
  }

  const result: Promise<ExecutionStopReason> = run.result.then(
    value => mapStopReason(value.stopReason),
    error => {
      ctx.logger.warn(`work-node-runner-codex: infrastructure failure after publication: ${renderError(error)}`)
      return 'unknown'
    },
  )

  return {
    result,
    cancel: () => { localAbort.abort(new Error('work-node-runner-codex cancelled')) },
    dispose,
  }
}

function mapStopReason(reason: SubagentStopReason): ExecutionStopReason {
  switch (reason) {
    case 'completed': return 'completed'
    case 'aborted': return 'cancelled'
    case 'error': return 'failed'
    case 'max-tokens': return 'limit'
    case 'refusal': return 'refused'
    default: return 'unknown'
  }
}

function assertGrace(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`work-node-runner-codex disposeGraceMs must be > 0 and <= ${MAX_TIMER_DELAY_MS}`)
  }
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
