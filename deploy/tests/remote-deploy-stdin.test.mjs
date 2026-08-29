import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const deployScript = path.join(repoRoot, 'deploy', 'remote-deploy.sh')
const bashPath = process.env.SRMS_BASH_PATH || 'bash'

function bashPathLiteral(value) {
  return value.replaceAll('\\', '/').replaceAll("'", "'\"'\"'")
}

test('database backup leaves the remaining streamed deployment script available to bash', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'srms-deploy-stdin-'))
  const fakeCompose = path.join(tempDir, 'fake-compose.sh')
  const deployDir = path.join(tempDir, 'deploy-root')

  await writeFile(
    fakeCompose,
    `#!/bin/sh
non_interactive=false
for argument in "$@"; do
  if [ "$argument" = '--interactive=false' ]; then
    non_interactive=true
  fi
done
if [ "$non_interactive" != 'true' ]; then
  cat >/dev/null
fi
printf '%s\n' '-- MySQL dump 10.13  Distrib 8.4.0'
printf '%s\n' '-- Dump completed on 2026-08-29 12:00:00'
`,
    'utf8',
  )

  try {
    const child = spawn(bashPath, ['-s'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk
    })
    const exitPromise = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })

    child.stdin.write(`set -euo pipefail
source '${bashPathLiteral(deployScript)}'
compose=(sh '${bashPathLiteral(fakeCompose)}')
backup_database '${bashPathLiteral(deployDir)}' ae2dc26d89ccde1b650a3f5d0eb7b9d686868b01
`)

    await new Promise((resolve) => setTimeout(resolve, 150))
    child.stdin.write("printf 'AFTER_BACKUP_REACHED\\n'\n")
    child.stdin.end()

    const exitCode = await exitPromise

    assert.equal(exitCode, 0, stderr)
    assert.match(stdout, /AFTER_BACKUP_REACHED/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
