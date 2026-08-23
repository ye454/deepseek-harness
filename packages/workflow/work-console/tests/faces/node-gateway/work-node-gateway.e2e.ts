import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/loader-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('work-node-gateway through a real Cordis Loader composition', () => {
  it('authenticates a node, persists its environment/command, and leaves the thread idle before ack', async () => {
    let persisted: Record<string, unknown> | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'work-node-gateway',
      tempDirPrefix: 'work-node-gateway-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { WORK_NODE_TEST_SECRET: 'loader-node-secret' },
      inspect: async (cwd) => {
        persisted = JSON.parse(
          await readFile(join(cwd, '.work-node-gateway-store', 'work-node-gateway.json'), 'utf8'),
        ) as Record<string, unknown>
      },
    })

    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Record<string, unknown>
    expect(result).toMatchObject({
      commandState: 'queued',
      threadState: 'idle',
      environmentRevision: 1,
    })
    expect(result['delivered']).toEqual([result['commandId']])

    const tables = persisted?.['tables'] as Record<string, Record<string, unknown>> | undefined
    expect(Object.values(tables?.['nodes'] ?? {})).toHaveLength(1)
    expect(Object.values(tables?.['environments'] ?? {})).toHaveLength(1)
    expect(Object.values(tables?.['commands'] ?? {})).toHaveLength(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
