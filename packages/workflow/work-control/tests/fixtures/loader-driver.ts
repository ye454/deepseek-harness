#!/usr/bin/env node

import type {} from '../../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'work-control-loader-test'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const idea = await ctx.workControl.createIdea({ title: 'Loader idea', tags: ['global'] })
  const task = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority: 'p0' })
  process.stdout.write(`${JSON.stringify({
    id: task.id,
    kind: task.kind,
    status: task.status,
    priority: task.priority,
    ideas: ctx.workControl.listIdeas().length,
    tasks: ctx.workControl.listTasks().length,
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
