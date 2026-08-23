#!/usr/bin/env node

import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '../../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { WorkNodeRunnerProvider } from '../../src/index.ts'

const NAME = 'work-node-daemon-loader-test'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const fixtureRunner: WorkNodeRunnerProvider = {
  name: 'loader-runner',
  modes: ['one-shot'],
  async start(request) {
    let settled = false
    let resolve!: (value: 'completed' | 'interrupted') => void
    const result = new Promise<'completed' | 'interrupted'>(done => { resolve = done })
    const timer = setTimeout(() => {
      settled = true
      resolve('completed')
    }, 30)
    timer.unref()
    const cancel = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve('interrupted')
    }
    request.signal.addEventListener('abort', cancel, { once: true })
    return {
      result,
      cancel,
      async dispose() {
        request.signal.removeEventListener('abort', cancel)
        if (!settled) cancel()
        await result
      },
    }
  },
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`${NAME}: timed out waiting for state`)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
let disposeRunner: (() => void) | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  disposeRunner = ctx.workNodeDaemon.registerRunner(fixtureRunner)

  const node = await waitFor(() => ctx!.workNodes.list().find(candidate =>
    candidate.runnerProviders.includes('loader-runner') && candidate.features.includes('execute'),
  ))
  const environment = await waitFor(() => ctx!.workEnvironments.list(node.id)[0])

  const idea = await ctx.workControl.createIdea({ title: 'Loader daemon task' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'bug-fix',
    workflow: { version: 1, stages: [{ id: 'fix', title: 'Fix', kind: 'implementation' }] },
    validationPolicy: { version: 1, validators: [] },
  })
  const thread = await ctx.workExecution.createThread({ taskId: task.id })
  await ctx.workEnvironments.bindThread(
    { id: thread.id, revision: thread.revision },
    { id: environment.id, revision: environment.revision },
  )
  const command = await ctx.workNodeGateway.enqueueExecute(
    { id: thread.id, revision: thread.revision }, 'loader-runner', 'one-shot',
  )

  const completed = await waitFor(() => {
    const current = ctx!.workExecution.get(thread.id)
    return current?.lastAttempt?.stopReason === 'completed' && current.state === 'idle' ? current : undefined
  })
  const journal = await waitFor(() => {
    const current = ctx!.workNodeDaemon.getJournal(command.id)
    return current?.reportedAt === undefined ? undefined : current
  })

  process.stdout.write(`${JSON.stringify({
    nodeId: node.id,
    nodeHasResume: node.features.includes('resume'),
    environmentRevision: environment.revision,
    commandState: ctx.workNodeGateway.getCommand(command.id)?.state,
    threadState: completed.state,
    stopReason: completed.lastAttempt?.stopReason,
    journalState: journal.state,
    journalReported: journal.reportedAt !== undefined,
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  disposeRunner?.()
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
