#!/usr/bin/env node

import type {} from '../../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'work-node-loader-test'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const node = await ctx.workNodes.registerNode({
    name: 'Loader Node',
    protocolVersion: 1,
    runnerProviders: ['codex', 'claude-code'],
    features: ['execute', 'cancel', 'environment-report'],
  })
  const degraded = await ctx.workNodes.refreshNode({ id: node.id, revision: node.revision }, {
    protocolVersion: 1,
    state: 'degraded',
    degradedReason: 'fixture',
    runnerProviders: ['codex'],
    features: ['execute', 'environment-report'],
  })
  process.stdout.write(`${JSON.stringify({
    id: degraded.id,
    revision: degraded.revision,
    state: degraded.state,
    protocolVersion: degraded.protocolVersion,
    runners: degraded.runnerProviders,
    features: degraded.features,
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
