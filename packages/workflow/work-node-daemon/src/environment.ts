/**
 * Configured local workspace Environment collection for the worker daemon.
 * @module @deepseek-ai/dsh-work-node-daemon/src/environment
 */

import { realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { WorkEnvironmentSnapshot } from '@deepseek-ai/dsh-work-environment'
import type { WorkNodeDaemonEnvironmentConfig, WorkNodeDaemonEnvironmentReport } from './types.ts'

/** Environment collector deployment options. */
export interface EnvironmentCollectorOptions {
  readonly gitCommand: string
  readonly commandOutputBytes: number
  readonly processGraceMs: number
}

/** Collects current workspace/Git facts without retaining command history or secrets. */
export class WorkNodeEnvironmentCollector {
  private gitExecutable?: string

  /** @param ctx - Context carrying the managed subprocess service. */
  constructor(private readonly ctx: Context, private readonly options: EnvironmentCollectorOptions) {}

  /**
   * Validate configured environments and resolve the Git executable once at daemon startup.
   * @param environments - Configured environment declarations.
   */
  async prepare(environments: readonly WorkNodeDaemonEnvironmentConfig[]): Promise<void> {
    if (!Number.isSafeInteger(this.options.commandOutputBytes) || this.options.commandOutputBytes <= 0) {
      throw new TypeError('work-node-daemon environmentCommandOutputBytes must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.options.processGraceMs) || this.options.processGraceMs <= 0) {
      throw new TypeError('work-node-daemon processGraceMs must be a positive safe integer')
    }
    this.gitExecutable = await this.ctx.subprocess.resolveExecutable(this.options.gitCommand)
    const seen = new Set<string>()
    for (const environment of environments) {
      const key = requireKey(environment.key)
      if (seen.has(key)) throw new TypeError(`work-node-daemon duplicate environment key '${key}'`)
      seen.add(key)
      requireText(environment.name, 'environment name')
      const canonical = await realpath(environment.workspacePath)
      if (!(await stat(canonical)).isDirectory()) {
        throw new TypeError(`work-node-daemon environment '${key}' workspace is not a directory`)
      }
    }
  }

  /**
   * Collect one report. Git failures degrade the report but do not stop daemon heartbeat; the workspace
   * path and runtime identity remain observable so the central scheduler can refuse it deliberately.
   * @param config - One configured local environment.
   * @param signal - Optional daemon shutdown signal.
   * @returns current environment report.
   */
  async collect(config: WorkNodeDaemonEnvironmentConfig, signal?: AbortSignal): Promise<WorkNodeDaemonEnvironmentReport> {
    const workspacePath = await realpath(config.workspacePath)
    try {
      const git = await this.collectGit(workspacePath, signal)
      const snapshot: WorkEnvironmentSnapshot = {
        workspace: {
          path: workspacePath,
          ...(git.repository === undefined ? {} : { repository: git.repository }),
          ...(git.branch === undefined ? {} : { branch: git.branch }),
          commit: git.commit,
          dirty: git.dirty,
        },
        runtime: {
          os: process.platform,
          arch: process.arch,
          versions: { node: process.version },
        },
        services: [],
        devices: normalize(config.devices ?? []),
        capabilities: normalize(config.capabilities ?? []),
        secretRefs: normalize(config.secretRefs ?? []),
      }
      return { key: requireKey(config.key), name: requireText(config.name, 'environment name'), snapshot }
    } catch (error) {
      const snapshot: WorkEnvironmentSnapshot = {
        workspace: { path: workspacePath },
        runtime: { os: process.platform, arch: process.arch, versions: { node: process.version } },
        services: [],
        devices: normalize(config.devices ?? []),
        capabilities: normalize(config.capabilities ?? []),
        secretRefs: normalize(config.secretRefs ?? []),
      }
      return {
        key: requireKey(config.key),
        name: requireText(config.name, 'environment name'),
        state: 'degraded',
        degradedReason: `git-inspection-failed: ${renderError(error)}`,
        snapshot,
      }
    }
  }

  private async collectGit(cwd: string, signal?: AbortSignal): Promise<{
    repository?: string
    branch?: string
    commit: string
    dirty: boolean
  }> {
    const executable = this.gitExecutable
    if (executable === undefined) throw new Error('Git collector was not prepared')
    const [commit, branch, repository, statusText] = await Promise.all([
      this.runGit(executable, cwd, ['rev-parse', 'HEAD'], signal),
      this.runGit(executable, cwd, ['branch', '--show-current'], signal),
      this.runGit(executable, cwd, ['config', '--get', 'remote.origin.url'], signal, true),
      this.runGit(executable, cwd, ['status', '--porcelain=v1', '--untracked-files=normal'], signal),
    ])
    return {
      ...(repository === '' ? {} : { repository }),
      ...(branch === '' ? {} : { branch }),
      commit: requireText(commit, 'Git commit'),
      dirty: statusText !== '',
    }
  }

  private async runGit(
    executable: string,
    cwd: string,
    args: readonly string[],
    signal: AbortSignal | undefined,
    allowNonZero = false,
  ): Promise<string> {
    const handle = this.ctx.subprocess.spawn({
      argv: [executable, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.options.commandOutputBytes },
        stderr: { maxBytes: this.options.commandOutputBytes },
      },
      graceMs: this.options.processGraceMs,
      signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout?.lossy || stderr?.lossy) throw new Error('Git inspection output exceeded configured limit')
    if (outcome.exitCode !== 0 && !allowNonZero) {
      throw new Error(`git ${args[0] ?? ''} exited ${String(outcome.exitCode)}: ${stderr?.text.trim() ?? ''}`)
    }
    if (outcome.exitCode !== 0 && allowNonZero) return ''
    return stdout?.text.trim() ?? ''
  }
}

function normalize(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort()
}

function requireKey(value: string): string {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new TypeError(`work-node-daemon environment key '${value}' is invalid`)
  }
  return normalized
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new TypeError(`work-node-daemon ${field} must not be empty`)
  return normalized
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
