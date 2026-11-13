/** Load the actual unpacked distribution and verify first-run behavior there. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageRoot = resolve(process.argv[2] ?? '')
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
assert.equal(manifest.name, '@xiaoxing/persona-manager')
const expectedManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.deepEqual(manifest, expectedManifest, 'Packed metadata must match the source candidate')
const plugin = await import(pathToFileURL(join(packageRoot, 'index.js')).href)
assert.equal(typeof plugin.apply, 'function')
const temp = await mkdtemp(join(tmpdir(), 'persona-packed-test-'))
const cleanups = []
let registeredTool
function load() {
  let service
  const ctx = {
    get: () => undefined,
    logger: { warn() {} },
    provide: (_key, value) => { service = value; return () => {} },
    tools: { register: value => { registeredTool = value; return () => {} } },
    inject: () => ({}),
    effect: callback => { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  plugin.apply(ctx, { personaDir: join(temp, 'personas') })
  return service
}
try {
  const service = load()
  assert.deepEqual(registeredTool.parameters.properties.slot.enum, ['identity', 'voice', 'user', 'instructions', 'personality'])
  await service.initialize()
  const dir = join(temp, 'personas')
  assert.equal(await readFile(join(dir, 'basic.md'), 'utf8'), await readFile(join(packageRoot, 'defaults/basic.md'), 'utf8'))
  assert(!(await readdir(dir)).includes('.applied.json'))
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.md')), ['basic.md'], 'Initialization must not create user information')
  assert.equal(service.presetDisposers.size, 0)
  const saved = await registeredTool.execute({ action: 'write', id: 'personality-check', name: 'Package test', slot: 'personality', body: 'PERSONALITY PACKAGE TEST' }, {})
  assert.equal(saved.ok, true, saved.summary)
  assert.match(await readFile(join(dir, 'personality-check.md'), 'utf8'), /^slot: personality$/m)
  assert((await service.compose({})).text.includes('PERSONALITY PACKAGE TEST'))
  assert.equal((await service.remove({ id: 'personality-check' })).ok, true)
  const user = await registeredTool.execute({ action: 'write', id: 'user-check', name: 'Supplied user facts', slot: 'user', body: 'Provided preference: concise answers.' }, {})
  assert.equal(user.ok, true, user.summary)
  assert.equal(user.data.file.slot, 'user')
  assert.match(await readFile(join(dir, 'user-check.md'), 'utf8'), /^slot: user$/m)
  assert((await service.compose({})).text.includes('Provided preference: concise answers.'))
  assert.equal((await service.remove({ id: 'user-check' })).ok, true)
  const removed = await service.remove({ id: 'basic' })
  assert.equal(removed.ok, true)
  await service.disposePresets()
  const recovered = load()
  await recovered.initialize()
  assert(!(await readdir(dir)).includes('basic.md'), 'A deleted starter must not return after reload')
  console.log('Unpacked distribution: module load, packaged starter, user and personality tool/write/compose, no auto-apply, reload idempotency: OK')
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup()
  assert(resolve(temp).startsWith(resolve(tmpdir()) + sep))
  await rm(temp, { recursive: true, force: true })
}
