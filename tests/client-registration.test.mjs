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
    for (const key of ['status.starter', 'status.unavailable', 'preview.compose', 'preview.hide', 'override.hint', 'ai.unsaved',
      'error.deployment-persona', 'error.invalid-state', 'error.rollback-failed', 'error.disposed', 'error.preset-failed',
      'error.import-access', 'error.import-too-large', 'error.navigate-failed', 'error.service-unavailable']) {
      assert.equal(typeof dictionary[key], 'string', `${language}:${key}`)
    }
  }
  client.dispose()
})

test('one composition preview control and the personality slot replace the duplicate applied-text view', async () => {
  const client = makeClient()
  await client.plugin.apply(client.ctx)
  const dictionaries = client.locales.get('xiaoxing-persona')
  for (const language of ['en', 'zh']) {
    const dictionary = dictionaries[language]
    assert.equal(typeof dictionary['list.slot.personality'], 'string', `${language}: personality slot label`)
    assert.match(dictionary['list.slot.personality'], /personality/i, `${language}: the slot label names personality`)
    assert.equal(dictionary['list.slot.overlay'], undefined, `${language}: the overlay label is gone`)
    assert.equal(dictionary['status.preview'], undefined, `${language}: the duplicate applied-text label is gone`)
    assert.equal(dictionary['status.previewHide'], undefined, `${language}: the duplicate collapse label is gone`)
    assert.match(dictionary['editor.slotHint'], /personality/, `${language}: the composition hint names personality`)
    assert.doesNotMatch(dictionary['editor.slotHint'], /overlay|叠加/iu, `${language}: the hint drops overlay`)
  }
  // The preview reads the saved composition through the shared Host operation.
  assert.equal((source.match(/call\('compose'/g) ?? []).length, 1, 'exactly one compose call site')
  assert.match(source, /const togglePreview = async \(\) => \{/)
  assert.match(source, /if \(showPreview\) \{ setShowPreview\(false\); return \}/, 'collapsing does not refetch')
  assert.equal((source.match(/t\('preview\.compose'\)/g) ?? []).length, 2, 'one button label and one panel heading')
  for (const retired of ['previewKind', 'showApplied', 'setShowApplied', 'appliedText']) {
    assert.equal(source.includes(retired), false, `retired preview state must not remain: ${retired}`)
  }
  assert.match(source, /const SLOTS = \['identity', 'voice', 'user', 'instructions', 'personality'\]/)
  assert.equal(source.includes("'overlay'"), false, 'the client no longer offers the overlay slot')
  client.dispose()
})


test('USER.md has localized profile controls and new AI drafts carry their category', async () => {
  const client = makeClient()
  await client.plugin.apply(client.ctx)
  const dictionaries = client.locales.get('xiaoxing-persona')
  for (const language of ['en', 'zh']) {
    const dictionary = dictionaries[language]
    assert.equal(dictionary['list.slot.user'], 'USER.md')
    for (const key of ['editor.userBody', 'editor.title.userNew', 'editor.title.userEdit']) assert.equal(typeof dictionary[key], 'string')
    assert.match(dictionary['editor.slotHint'], /SOUL → USER → AGENTS/)
  }
  assert.match(source, /named === '' \? \{ instruction, slot: draft\.slot \} : \{ id: named, instruction \}/)
  assert.match(source, /draft\.slot === 'user' \? 'editor\.userBody' : 'editor\.body'/)
  client.dispose()
})


test('multi-selection has localized select-all and batch actions with deletion confirmation', async () => {
  const client = makeClient()
  await client.plugin.apply(client.ctx)
  const dictionaries = client.locales.get('xiaoxing-persona')
  for (const language of ['en', 'zh']) {
    for (const key of ['list.select', 'list.selectAll', 'bulk.selected', 'bulk.clear', 'bulk.enable', 'bulk.disable', 'bulk.delete', 'bulk.enabled', 'bulk.disabled', 'bulk.deleted', 'bulk.failed', 'bulk.deleteConfirm']) {
      assert.equal(typeof dictionaries[language][key], 'string', `${language}:${key}`)
    }
  }
  assert.match(source, /checked: selectedIds\.includes\(file\.id\)/)
  assert.match(source, /pruneSelection\(current, nextFiles\)/)
  assert.match(source, /method === 'delete' && !confirmAction\(t\('bulk\.deleteConfirm'/)
  assert.match(source, /runSelected\('toggle', \{ enabled: true \}\)/)
  assert.match(source, /runSelected\('toggle', \{ enabled: false \}\)/)
  assert.match(source, /runSelected\('delete'\)/)
  assert.match(source, /setSelectedIds\(failures\.map/)
  assert.equal(client.descriptors.descriptors.length, 11, 'batch actions reuse existing Host endpoints')
  client.dispose()
})

test('pure selection and batch helpers prune stale IDs and preserve individual failures', async () => {
  // Evaluate only data helpers, not React, a page, or a DOM.
  const pruneSource = source.match(/    function pruneSelection\([^]*?\n    \}/)?.[0]
  const batchSource = source.match(/    async function callForFiles\([^]*?\n    \}/)?.[0]
  assert(pruneSource && batchSource)
  const prune = vm.runInNewContext(`(${pruneSource.trim()})`)
  const batch = vm.runInNewContext(`(${batchSource.trim()})`)
  assert.deepEqual(Array.from(prune(['a', 'stale', 'b'], [{ id: 'b' }, { id: 'a' }])), ['a', 'b'])
  const calls = []
  let inFlight = 0
  const outcomes = await batch([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], 'toggle', { enabled: true, id: 'must-not-override' }, async (method, request) => {
    assert.equal(++inFlight, 1, 'Host calls are sequential')
    calls.push({ method, id: request.id, enabled: request.enabled })
    await Promise.resolve()
    inFlight -= 1
    return request.id === 'b' ? { ok: false, code: 'not-found', message: 'missing B' } : { ok: true }
  })
  assert.deepEqual(calls.map(item => item.id), ['a', 'b', 'c'])
  assert(calls.every(item => item.method === 'toggle' && item.enabled === true))
  assert.deepEqual(Array.from(outcomes, item => item.result.ok), [true, false, true])
  assert.equal(outcomes[1].result.code, 'not-found')
  const thrown = await batch([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'delete', {}, async (_method, request) => {
    if (request.id === 'a') throw new Error('simulated disconnect')
    return { ok: true }
  })
  assert.equal(thrown[0].result.ok, false)
  assert.equal(thrown[0].result.code, 'internal')
  assert.match(thrown[0].result.message, /simulated disconnect/)
  assert.equal(thrown[1].result.ok, true)
})
