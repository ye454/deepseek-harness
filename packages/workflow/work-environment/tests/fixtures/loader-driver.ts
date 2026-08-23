#!/usr/bin/env node

import type {} from '../../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'work-environment-loader-test'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))

  const idea = await ctx.workControl.createIdea({ title: 'Loader environment task' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'bug-fix',
    workflow: { version: 1, stages: [{ id: 'fix', title: 'Fix', kind: 'implementation' }] },
    validationPolicy: { version: 1, validators: [] },
  })
  const thread = await ctx.workExecution.createThread({ taskId: task.id })
  const node = await ctx.workNodes.registerNode({
    name: 'Loader Node',
    protocolVersion: 1,
    runnerProviders: ['codex'],
    features: ['execute', 'environment-report'],
  })
  const environment = await ctx.workEnvironments.registerEnvironment({
    nodeId: node.id,
    name: 'Loader Env',
    snapshot: {
      workspace: { path: '/tmp/project', branch: 'main', commit: 'abc123', dirty: false },
      runtime: { os: 'linux', arch: 'x64', versions: { node: '24' } },
      services: [],
      devices: [],
      capabilities: ['git'],
      secretRefs: [],
    },
  })
  const binding = await ctx.workEnvironments.bindThread(
    { id: thread.id, revision: thread.revision },
    { id: environment.id, revision: environment.revision },
  )
  const preflight = ctx.workEnvironments.preflight(thread.id, 'codex')

  process.stdout.write(`${JSON.stringify({
    environmentId: environment.id,
    environmentRevision: environment.revision,
    bindingRevision: binding.revision,
    preflight,
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
