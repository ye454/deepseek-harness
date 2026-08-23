#!/usr/bin/env node

import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-work-control'
import type {} from '@deepseek-ai/dsh-work-execution'
import type {} from '../../src/index.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'work-runner-loader-test'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))

  const idea = await ctx.workControl.createIdea({ title: 'Loader runner task' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision }, { priority: 'p0' })
  const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'custom',
    workflow: { version: 1, stages: [{ id: 'execute', title: 'Execute', kind: 'implementation' }] },
    validationPolicy: {
      version: 1,
      validators: [{ kind: 'user-acceptance', requirement: 'required', label: 'Human approval' }],
    },
  })
  const thread = await ctx.workExecution.createThread({ taskId: task.id })

  const session = Session.create(SessionId('fixture-parent'))
  const parent = { session } as unknown as Agent
  const result = await ctx.workSubagentRunner.runOneShot({
    thread: { id: thread.id, revision: thread.revision },
    parent,
    provider: 'fixture-runner',
    signal: new AbortController().signal,
    maxPromptBytes: 8192,
    handoff: { facts: ['Loader composition reached runner bridge'], nextStep: 'Return fixture result' },
  })
  const requestEvent = session.events.find(event => event.type === 'work-runner/subagent-request')
  if (requestEvent?.type !== 'work-runner/subagent-request') throw new Error('runner request event was not logged')
  const output = result.output[0]
  if (output?.type !== 'text') throw new Error('fixture runner returned no text output')

  process.stdout.write(`${JSON.stringify({
    taskStatus: task.status,
    threadState: result.thread.state,
    attemptSeq: result.thread.attemptSeq,
    provider: result.provider,
    stopReason: result.stopReason,
    requestType: requestEvent.type,
    promptBytes: requestEvent.data.promptBytes,
    output: output.text,
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
