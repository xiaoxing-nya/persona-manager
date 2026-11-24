/** Validate the standalone package contract without loading a live DSH profile. */
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
assert.equal(manifest.name, '@xiaoxing/persona-manager')
assert.equal(manifest.author.name, 'xiaoxing-nya')
assert.equal(manifest.author.email, 'xiaoxing_bot@luoli.my')
assert.equal(manifest.type, 'module')
assert.equal(manifest.private, true, 'Publishing stays disabled until explicitly authorized')
assert.equal(manifest.dsh.manifestVersion, 1)
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(manifest.dsh.client.platform, 'web')
assert.equal(manifest.engines.node, '>=24.9.0', 'Node engine floor must match DSH host >=24.9.0')
assert(manifest.engines.dsh)

const required = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'CONTRIBUTING.md',
  'defaults/basic.md', 'docs/persona-manager-design.md', 'locale/en.json', 'locale/zh.json']
for (const name of required) assert((await stat(resolve(root, name))).isFile(), `Missing runtime or documentation file: ${name}`)
assert(manifest.files.includes('defaults'), 'The starter must be distributed, not just available in a linked checkout')
assert(manifest.files.includes('docs'))
for (const [name, file] of Object.entries(manifest.exports)) {
  if (name.includes('*')) continue
  assert((await stat(resolve(root, file))).isFile(), `Missing export: ${name}`)
}
const en = JSON.parse(await readFile(resolve(root, 'locale/en.json'), 'utf8'))
const zh = JSON.parse(await readFile(resolve(root, 'locale/zh.json'), 'utf8'))
assert.deepEqual(Object.keys(en.meta).sort(), Object.keys(zh.meta).sort())
for (const meta of [en.meta, zh.meta]) assert(meta.title.trim() && meta.description.trim())
const starter = await readFile(resolve(root, 'defaults/basic.md'), 'utf8')
assert(starter.startsWith('---\n') && starter.includes('enabled: true'))
assert(!starter.includes('{{'), 'The default persona must not depend on template variables')
assert(starter.length < 500, 'The starter is intentionally minimal')
for (const name of ['README.md', 'CONTRIBUTING.md', 'docs/persona-manager-design.md']) {
  const text = await readFile(resolve(root, name), 'utf8')
  for (const match of text.matchAll(/\]\(<([^>]+)>\)/g)) {
    const target = match[1].split('#')[0]
    if (/^[a-z]+:\/\//i.test(target)) continue
    assert((await stat(resolve(dirname(resolve(root, name)), target))).isFile(), `Broken document link: ${name} -> ${target}`)
  }
}
console.log('Package contract, starter, exports, locale metadata and document links: OK')
