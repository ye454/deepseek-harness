import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/loader-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('work-node through a real Cordis Loader composition', () => {
  it('boots the durable registry and persists refreshed capability facts', async () => {
    let persisted: Record<string, unknown> | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'work-node-domain',
      tempDirPrefix: 'work-node-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        persisted = JSON.parse(
          await readFile(join(cwd, '.work-node-store', 'work-node.json'), 'utf8'),
        ) as Record<string, unknown>
      },
    })

    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Record<string, unknown>
    expect(result).toMatchObject({
      revision: 2,
      state: 'degraded',
      protocolVersion: 1,
      runners: ['codex'],
      features: ['environment-report', 'execute'],
    })

    const tables = persisted?.['tables'] as Record<string, Record<string, unknown>> | undefined
    const records = Object.values(tables?.['nodes'] ?? {})
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      revision: 2,
      name: 'Loader Node',
      state: 'degraded',
      degradedReason: 'fixture',
      runnerProviders: ['codex'],
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
