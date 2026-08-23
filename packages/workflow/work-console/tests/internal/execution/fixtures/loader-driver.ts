#!/usr/bin/env node

import type {} from '../../../../src/internal/control/index.ts'
import type {} from '../../../../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'work-execution-loader-test'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const idea = await ctx.workControl.createIdea({ title: 'Execute through Loader' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority: 'p0' })
  const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'custom',
    workflow: { version: 1, stages: [{ id: 'execute', title: 'Execute', kind: 'implementation' }] },
    validationPolicy: { version: 1, validators: [] },
  })
  const thread = await ctx.workExecution.createThread({ taskId: task.id })
  process.stdout.write(`${JSON.stringify({
    taskId: task.id,
    taskStatus: task.status,
    threadId: thread.id,
    threadState: thread.state,
    attemptSeq: thread.attemptSeq,
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
