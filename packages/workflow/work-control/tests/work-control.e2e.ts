import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/loader-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('work-control through a real Cordis Loader composition', () => {
  it('boots storage + work-control, promotes one passive idea, and persists the task', async () => {
    let persisted: Record<string, unknown> | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'work-control-domain',
      tempDirPrefix: 'work-control-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        persisted = JSON.parse(
          await readFile(join(cwd, '.work-control-store', 'work-control.json'), 'utf8'),
        ) as Record<string, unknown>
      },
    })

    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Record<string, unknown>
    expect(result).toMatchObject({
      kind: 'task',
      status: 'organizing',
      priority: 'p0',
      ideas: 0,
      tasks: 1,
    })

    const tables = persisted?.['tables'] as Record<string, Record<string, unknown>> | undefined
    const records = Object.values(tables?.['items'] ?? {})
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'task',
      status: 'organizing',
      priority: 'p0',
      title: 'Loader idea',
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
