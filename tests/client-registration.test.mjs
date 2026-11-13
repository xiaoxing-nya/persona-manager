/** Registration-contract tests only; no mock page, DOM or visual rendering. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function makeClient({ mountFails = false } = {}) {
  let definition
  let descriptors
  const locales = new Map()
  const slots = new Map()
  const cleanups = []
  const logs = []
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: entry => { definition = entry } } },
  }, { filename: 'client.js' })
  assert.equal(definition.id, '@xiaoxing/persona-manager')
  // React is not invoked here: this test inspects registration, not a rendered UI.
  const plugin = definition.factory(name => { assert.equal(name, 'react'); return {} })
  const ctx = {
    logger: { warn: value => { logs.push(value) } },
    get: () => undefined,
    effect: callback => { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    locale: {
      bind: ns => key => locales.get(ns)?.en?.[key] ?? key,
      register: (ns, dictionaries) => { locales.set(ns, dictionaries); return () => locales.delete(ns) },
    },
    remote: { $mount: async payload => {
      descriptors = payload
      if (mountFails) throw new Error('simulated mount failure')
    } },
    slots: {
      inject: (key, callback) => { callback(); cleanups.push(() => { for (const [id, slot] of slots) if (slot.options.name === key) slots.delete(id) }) },
      register: (options, component) => {
        const id = `${options.name}:${options.id}`
        slots.set(id, { options, component })
        return () => slots.delete(id)
      },
    },
  }
  return { plugin, ctx, locales, slots, logs, get descriptors() { return descriptors }, dispose: () => { for (const cleanup of cleanups.reverse()) cleanup() } }
}

test('client registers complete locale, Remote and settings contracts and disposes its entries', async () => {
  const client = makeClient()
  await client.plugin.apply(client.ctx)
  assert.deepEqual(Array.from(client.plugin.inject), ['slots', 'remote', 'locale'])
  const dictionaries = client.locales.get('xiaoxing-persona')
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort())
  const payload = client.descriptors
  assert.equal(payload.package, '@xiaoxing/persona-manager')
  assert.equal(payload.descriptors.length, 11)
  assert(payload.descriptors.some(item => item.method === 'delete'))
  for (const descriptor of payload.descriptors) {
    assert.equal(descriptor.service, 'xiaoxingPersona')
    assert.equal(descriptor.namespace, 'xiaoxingPersona')
    assert.equal(descriptor.parameters[0].wire, 'request')
    assert.equal(descriptor.invocation.kind, 'direct')
  }
  assert(client.slots.has('settings.section:xiaoxing-persona'))
  assert(client.slots.has('settings.section.icon:xiaoxing-persona'))
  assert.equal(typeof client.slots.get('settings.section:xiaoxing-persona').component, 'function')
  client.dispose()
  assert.equal(client.locales.size, 0)
  assert.equal(client.slots.size, 0)
})

test('Remote mount failure does not remove the settings error surface', async () => {
  const client = makeClient({ mountFails: true })
  await client.plugin.apply(client.ctx)
  assert(client.slots.has('settings.section:xiaoxing-persona'))
  assert.equal(client.logs.length, 1)
  client.dispose()
})

test('new Host failure codes and first-run actions have both language entries', async () => {
  const client = makeClient()
  await client.plugin.apply(client.ctx)
  const dictionaries = client.locales.get('xiaoxing-persona')
  for (const language of ['en', 'zh']) {
    const dictionary = dictionaries[language]
    for (const key of ['status.starter', 'status.unavailable', 'preview.compose', 'override.hint', 'ai.unsaved',
      'error.deployment-persona', 'error.invalid-state', 'error.rollback-failed', 'error.disposed', 'error.preset-failed',
      'error.import-access', 'error.import-too-large', 'error.navigate-failed', 'error.service-unavailable']) {
      assert.equal(typeof dictionary[key], 'string', `${language}:${key}`)
    }
  }
  client.dispose()
})
