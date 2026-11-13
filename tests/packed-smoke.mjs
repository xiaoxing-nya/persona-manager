/** Load the actual unpacked distribution and verify first-run behavior there. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageRoot = resolve(process.argv[2] ?? '')
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
assert.equal(manifest.name, '@xiaoxing/persona-manager')
assert.equal(manifest.version, '0.2.0-rc.1')
const plugin = await import(pathToFileURL(join(packageRoot, 'index.js')).href)
assert.equal(typeof plugin.apply, 'function')
const temp = await mkdtemp(join(tmpdir(), 'persona-packed-test-'))
const cleanups = []
function load() {
  let service
  const ctx = {
    get: () => undefined,
    logger: { warn() {} },
    provide: (_key, value) => { service = value; return () => {} },
    tools: { register: () => () => {} },
    inject: () => ({}),
    effect: callback => { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  plugin.apply(ctx, { personaDir: join(temp, 'personas') })
  return service
}
try {
  const service = load()
  await service.initialize()
  const dir = join(temp, 'personas')
  assert.equal(await readFile(join(dir, 'basic.md'), 'utf8'), await readFile(join(packageRoot, 'defaults/basic.md'), 'utf8'))
  assert(!(await readdir(dir)).includes('.applied.json'))
  assert.equal(service.presetDisposers.size, 0)
  const removed = await service.remove({ id: 'basic' })
  assert.equal(removed.ok, true)
  await service.disposePresets()
  const recovered = load()
  await recovered.initialize()
  assert(!(await readdir(dir)).includes('basic.md'), 'A deleted starter must not return after reload')
  console.log('Unpacked distribution: module load, packaged starter, no auto-apply, reload idempotency: OK')
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup()
  assert(resolve(temp).startsWith(resolve(tmpdir()) + sep))
  await rm(temp, { recursive: true, force: true })
}
