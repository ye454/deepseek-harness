import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/loader-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('work-environment through a real Cordis Loader composition', () => {
  it('persists an environment binding and passes scheduler preflight', async () => {
    let persisted: Record<string, unknown> | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'work-environment-domain',
      tempDirPrefix: 'work-environment-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        persisted = JSON.parse(
          await readFile(join(cwd, '.work-environment-store', 'work-environment.json'), 'utf8'),
        ) as Record<string, unknown>
      },
    })

    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Record<string, unknown>
    expect(result).toMatchObject({
      environmentRevision: 1,
      bindingRevision: 1,
      preflight: { ok: true, issues: [] },
    })

    const tables = persisted?.['tables'] as Record<string, Record<string, unknown>> | undefined
    expect(Object.values(tables?.['environments'] ?? {})).toHaveLength(1)
    expect(Object.values(tables?.['bindings'] ?? {})).toHaveLength(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
