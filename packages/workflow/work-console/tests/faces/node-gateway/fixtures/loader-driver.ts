#!/usr/bin/env node

import { createHmac } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '../../../../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'work-node-gateway-loader-test'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)
const secret = process.env.WORK_NODE_TEST_SECRET
if (secret === undefined) throw new Error(`${NAME}: WORK_NODE_TEST_SECRET is required`)

const features = ['execute', 'cancel', 'resume', 'environment-report']
const snapshot = {
  workspace: { path: '/tmp/project', branch: 'main', commit: 'abc123', dirty: false },
  runtime: { os: 'linux', arch: 'x64', versions: { node: '24' } },
  services: [],
  devices: [],
  capabilities: ['git'],
  secretRefs: [],
}

async function post(ctx: Context, path: string, body: unknown): Promise<Response> {
  const raw = JSON.stringify(body)
  const timestamp = String(Date.now())
  const signature = createHmac('sha256', secret!)
    .update(`POST\n${path}\n${timestamp}\n${raw}`)
    .digest('hex')
  return await fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-node-key': 'pc2',
      'x-dsh-timestamp': timestamp,
      'x-dsh-signature': signature,
    },
    body: raw,
  })
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))

  const helloResponse = await post(ctx, '/work-node/v1/hello', {
    nodeKey: 'pc2', name: 'Loader PC2', protocolVersion: 1,
    runnerProviders: ['codex'], features,
  })
  if (!helloResponse.ok) throw new Error(`hello failed: ${await helloResponse.text()}`)
  const hello = await helloResponse.json() as { nodeId: string; nodeRevision: number }

  const initialPollResponse = await post(ctx, '/work-node/v1/poll', {
    nodeKey: 'pc2', nodeRevision: hello.nodeRevision, protocolVersion: 1,
    runnerProviders: ['codex'], features,
    environments: [{ key: 'main', name: 'Loader Environment', snapshot }],
  })
  if (!initialPollResponse.ok) throw new Error(`poll failed: ${await initialPollResponse.text()}`)
  const initialPoll = await initialPollResponse.json() as { nodeRevision: number }

  const idea = await ctx.workControl.createIdea({ title: 'Loader remote task' })
  const promoted = await ctx.workControl.promoteIdea({ id: idea.id, revision: idea.revision })
  const task = await ctx.workControl.organizeTask({ id: promoted.id, revision: promoted.revision }, {
    taskType: 'bug-fix',
    workflow: { version: 1, stages: [{ id: 'fix', title: 'Fix', kind: 'implementation' }] },
    validationPolicy: { version: 1, validators: [] },
  })
  const thread = await ctx.workExecution.createThread({ taskId: task.id })
  const environment = ctx.workEnvironments.list()[0]
  if (environment === undefined) throw new Error('expected remote environment')
  await ctx.workEnvironments.bindThread(
    { id: thread.id, revision: thread.revision },
    { id: environment.id, revision: environment.revision },
  )
  const command = await ctx.workNodeGateway.enqueueExecute(
    { id: thread.id, revision: thread.revision }, 'codex', 'one-shot',
  )

  const deliveryResponse = await post(ctx, '/work-node/v1/poll', {
    nodeKey: 'pc2', nodeRevision: initialPoll.nodeRevision, protocolVersion: 1,
    runnerProviders: ['codex'], features,
    environments: [{ key: 'main', name: 'Loader Environment', snapshot }],
  })
  if (!deliveryResponse.ok) throw new Error(`delivery poll failed: ${await deliveryResponse.text()}`)
  const delivery = await deliveryResponse.json() as { commands: Array<{ id: string }> }

  process.stdout.write(`${JSON.stringify({
    commandId: command.id,
    delivered: delivery.commands.map(item => item.id),
    commandState: ctx.workNodeGateway.getCommand(command.id)?.state,
    threadState: ctx.workExecution.get(thread.id)?.state,
    environmentRevision: ctx.workEnvironments.get(environment.id)?.revision,
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
