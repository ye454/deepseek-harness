/**
 * One-shot Claude Code Runner adapter for the remote WorkNode daemon.
 * @module @deepseek-ai/dsh-work-node-runner-claude-code
 */

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  startClaudeCodeRun,
} from '@deepseek-ai/dsh-subagent-claude-code'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { ExecutionStopReason } from '@deepseek-ai/dsh-work-execution'
import type { WorkNodeRunnerHandle, WorkNodeRunnerStartRequest } from '@deepseek-ai/dsh-work-node-daemon'

export const name = 'work-node-runner-claude-code'
export const inject = ['workNodeDaemon', 'subprocess']

/* jscpd:ignore-start -- product adapters deliberately mirror the reviewed
 * Codex WorkNode lifecycle while preserving separate SDK/CLI ownership. */
/** Deployment-owned Claude Code environment and process-release bound. */
export interface Config {
  /** Explicit environment layered over the managed subprocess scrub. */
  env?: Record<string, string>
  /** Grace in milliseconds for Claude Code process-tree termination. */
  disposeGraceMs?: number
}

export const Config: s<Config> = s.object({
  env: s.dict(s.string()).default({}),
  disposeGraceMs: s.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

type ResolvedConfig = Required<Config>

/**
 * Register the real Claude Agent SDK runtime as a daemon-local one-shot Runner.
 * Native resume is deliberately not advertised: the current runtime disables
 * SDK session persistence and exposes no continuable-session contract.
 * @param ctx - daemon context carrying WorkNode and subprocess services.
 * @param config - explicit child environment and disposal grace.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertGrace(resolved.disposeGraceMs)

  ctx.effect(() => ctx.workNodeDaemon.registerRunner({
    name: 'claude-code',
    modes: ['one-shot'],
    start: request => startClaudeDaemonRun(ctx, resolved, request),
  }), 'workNodeRunnerClaudeCode.register')
}

async function startClaudeDaemonRun(
  ctx: Context,
  config: ResolvedConfig,
  request: WorkNodeRunnerStartRequest,
): Promise<WorkNodeRunnerHandle> {
  if (request.mode !== 'one-shot' || request.resumeSessionId !== undefined) {
    throw new Error('work-node-runner-claude-code only supports fresh one-shot execution')
  }

  const localAbort = new AbortController()
  const signal = AbortSignal.any([request.signal, localAbort.signal])
  const executable = await ctx.subprocess.resolveExecutable('claude', config.env, signal)
  const run = await startClaudeCodeRun(
    {
      prompt: [{ type: 'text', text: request.prompt }],
      signal,
    },
    {
      cwd: request.cwd,
      executable,
      env: config.env,
      disposeGraceMs: config.disposeGraceMs,
      spawn: spec => ctx.subprocess.spawn(spec),
      onError: (error, stopReason) => {
        ctx.logger.warn(`work-node-runner-claude-code: run failed (${stopReason}): ${error.message}`)
      },
    },
  )

  let disposePromise: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    localAbort.abort(new Error('work-node-runner-claude-code disposed'))
    disposePromise ??= run.dispose()
    return disposePromise
  }

  const result: Promise<ExecutionStopReason> = run.result.then(
    value => mapStopReason(value.stopReason),
    error => {
      ctx.logger.warn(`work-node-runner-claude-code: infrastructure failure after publication: ${renderError(error)}`)
      return 'unknown'
    },
  )

  return {
    result,
    cancel: () => { localAbort.abort(new Error('work-node-runner-claude-code cancelled')) },
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
    throw new TypeError(`work-node-runner-claude-code disposeGraceMs must be > 0 and <= ${MAX_TIMER_DELAY_MS}`)
  }
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
/* jscpd:ignore-end */
