import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/loader-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('work-execution through a real Cordis Loader composition', () => {
  it('boots both work domains and persists an idle thread for an organized task', async () => {
    let persisted: Record<string, unknown> | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'work-execution-domain',
      tempDirPrefix: 'work-execution-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        persisted = JSON.parse(
          await readFile(join(cwd, '.work-execution-store', 'work-execution.json'), 'utf8'),
        ) as Record<string, unknown>
      },
    })

    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Record<string, unknown>
    expect(result).toMatchObject({
      taskStatus: 'running',
      threadState: 'idle',
      attemptSeq: 0,
    })

    const tables = persisted?.['tables'] as Record<string, Record<string, unknown>> | undefined
    const records = Object.values(tables?.['threads'] ?? {})
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      state: 'idle',
      attemptSeq: 0,
      revision: 1,
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
