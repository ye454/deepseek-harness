import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const execFileAsync = promisify(execFile)
const binScript = fileURLToPath(new URL('./fixtures/loader-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to allocate test port')
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
  return address.port
}

async function gitWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'work-node-daemon-loader-'))
  await execFileAsync('git', ['init', '-q'], { cwd: directory })
  await writeFile(join(directory, 'README.md'), '# loader fixture\n')
  await execFileAsync('git', ['add', 'README.md'], { cwd: directory })
  await execFileAsync('git', [
    '-c', 'user.name=DSH Test',
    '-c', 'user.email=dsh-test@example.invalid',
    'commit', '-q', '-m', 'fixture',
  ], { cwd: directory })
  return directory
}

describe('work-node-daemon through a real Cordis Loader composition', () => {
  it('reports an environment and completes one remote one-shot Runner command', async () => {
    const workspace = await gitWorkspace()
    const port = await freePort()
    let persisted: Record<string, unknown> | undefined
    try {
      const { stdout, stderr } = await runLoaderSmoke({
        label: 'work-node-daemon',
        tempDirPrefix: 'work-node-daemon-e2e-',
        binScript,
        libBinScript: binScript,
        configPath,
        tsconfigPath: repoTsconfig,
        env: {
          WORK_NODE_DAEMON_TEST_SECRET: 'loader-daemon-secret',
          WORK_NODE_DAEMON_TEST_PORT: String(port),
          WORK_NODE_DAEMON_TEST_WORKSPACE: workspace,
        },
        inspect: async (cwd) => {
          persisted = JSON.parse(
            await readFile(join(cwd, '.work-node-daemon-store', 'work-node-daemon.json'), 'utf8'),
          ) as Record<string, unknown>
        },
      })

      expect(stderr).toBe('')
      const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Record<string, unknown>
      expect(result).toMatchObject({
        nodeHasResume: false,
        environmentRevision: 1,
        commandState: 'settled',
        threadState: 'idle',
        stopReason: 'completed',
        journalState: 'settled',
        journalReported: true,
      })
      const tables = persisted?.['tables'] as Record<string, Record<string, unknown>> | undefined
      expect(Object.values(tables?.['commands'] ?? {})).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
