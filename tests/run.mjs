/** Run each Node test file in an isolated process without piped child stdio. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

for (const name of ['persona-manager.test.mjs', 'imports.test.mjs', 'client-registration.test.mjs']) {
  const file = fileURLToPath(new URL(name, import.meta.url))
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit', timeout: 30_000 })
  if (result.error) {
    console.error(`${name}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
