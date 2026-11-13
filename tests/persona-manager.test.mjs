/**
 * Behavior tests for the persona-manager Host half.
 *
 * These tests use only Node built-ins. They build a fake Cordis context and
 * fake `configEditor` / `agentPresets` / Session services, then drive the
 * service captured from `ctx.provide('xiaoxingPersona', service)`.
 *
 * The suite is intentionally written against the intended product behavior:
 * first-run seeding, transactional apply, four-preset override scope, snapshot
 * recovery, teardown safety, and a persona-free AI editing session.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { apply } from '../index.js'

const AGENT_PRESET_NAME = '@deepseek-ai/dsh-agent-preset'
const PERSONA_PLUGIN_NAME = '@deepseek-ai/dsh-persona'
const SYSTEM_PROMPT_ENTRY_ID = 'system-prompt'
const BUILT_IN_ROWS = ['preset-standard', 'preset-ptc', 'preset-minimal', 'preset-cordis']
const REAL_PERSONA_DIR = resolve(homedir(), '.dsh', 'xiaoxing', 'personas')
const DEFAULT_PERSONA_TEMPLATE = join(import.meta.dirname, '..', 'defaults', 'basic.md')

let tmp
let fakes

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'persona-manager-test-'))
  assertTempDir(tmp)
  fakes = []
})

afterEach(async () => {
  const results = await Promise.allSettled(fakes.map(fake => fake.dispose()))
  fakes = []
  assertTempDir(tmp)
  await rm(tmp, { recursive: true, force: true })
  const failure = results.find(result => result.status === 'rejected')
  if (failure !== undefined) throw failure.reason
})

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

function assertTempDir(dir) {
  const resolved = resolve(dir)
  const tempRoot = resolve(tmpdir())
  assert.ok(
    resolved === tempRoot || resolved.startsWith(tempRoot + sep),
    `test directory must live under ${tempRoot}, got ${resolved}`,
  )
  assert.notEqual(resolved, REAL_PERSONA_DIR, 'tests must not use the real persona directory')
  assert.ok(
    !resolved.startsWith(REAL_PERSONA_DIR + sep),
    'tests must not write inside the real persona directory',
  )
}

function defer() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function expectOk(result, label = 'operation') {
  assert.ok(result && result.ok !== false, `${label} failed: ${JSON.stringify(result)}`)
  return result
}

function expectFailure(result, label = 'operation') {
  assert.ok(result && result.ok === false, `${label} unexpectedly succeeded: ${JSON.stringify(result)}`)
  return result
}

async function readJson(dir, name) {
  return JSON.parse(await readFile(join(dir, name), 'utf8'))
}

function personaMarkdown({ name, description = '', slot = 'voice', order = 100, enabled = true, body = '' }) {
  return [
    '---',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    `slot: ${slot}`,
    `order: ${order}`,
    `enabled: ${enabled}`,
    'sourceFormat: manual',
    'sourceFile: ""',
    'importedAt: ""',
    'emoji: ""',
    '---',
    '',
    body,
    '',
  ].join('\n')
}

async function writePersona(dir, id, body, meta = {}) {
  await writeFile(join(dir, `${id}.md`), personaMarkdown({ name: meta.name ?? id, body, ...meta }), 'utf8')
}

function presetRow(rowId, presetId, prefix, extra = {}) {
  const config = {
    id: presetId,
    order: 1,
    plugins: [
      { id: 'persona', name: PERSONA_PLUGIN_NAME, config: { prefix, ...extra } },
      { id: 'other', name: '@deepseek-ai/dsh-some-tool', config: { keep: true } },
    ],
  }
  return {
    id: rowId,
    name: AGENT_PRESET_NAME,
    config: structuredClone(config),
    inherited: structuredClone(config),
  }
}

function systemPromptRow({ current, inherited } = {}) {
  const base = {
    personaPrefix: 'coding-agent-default',
    personaSuffix: '',
    includeHarnessIdentity: true,
    includeRuntimeContext: true,
  }
  return {
    id: SYSTEM_PROMPT_ENTRY_ID,
    name: '@deepseek-ai/dsh-system-prompt',
    config: structuredClone(current ?? base),
    inherited: structuredClone(inherited ?? base),
  }
}

function defaultEditorRows() {
  return [
    presetRow('preset-standard', 'standard', 'standard-prefix'),
    presetRow('preset-ptc', 'ptc', 'ptc-prefix'),
    presetRow('preset-minimal', 'minimal', 'minimal-prefix', {
      complete: true,
      includeRuntimeContext: false,
    }),
    presetRow('preset-cordis', 'cordis', 'cordis-prefix'),
    systemPromptRow(),
  ]
}

function createFakeEditor(rows) {
  const state = rows.map(row => ({
    entry: {
      options: {
        id: row.id,
        name: row.name,
        config: structuredClone(row.config),
      },
    },
    inherited: structuredClone(row.inherited ?? row.config ?? {}),
  }))
  const calls = []
  const editor = {
    calls,
    failEditId: '',
    entries() {
      return state.map(item => item.entry)
    },
    configuration() {
      return state.map(item => ({
        entry: item.entry,
        inherited: structuredClone(item.inherited),
        override: {},
      }))
    },
    async edit(entry, change) {
      const item = state.find(candidate => candidate.entry === entry || candidate.entry.options.id === entry?.options?.id)
      if (item === undefined) throw new Error(`unknown configuration entry: ${entry?.options?.id}`)
      if (editor.failEditId === item.entry.options.id) throw new Error(`simulated edit failure: ${item.entry.options.id}`)
      const current = structuredClone(item.entry.options.config ?? {})
      const inherited = structuredClone(item.inherited ?? {})
      const next = change(current, inherited)
      calls.push({
        id: item.entry.options.id,
        current,
        inherited,
        next: structuredClone(next),
      })
      item.entry.options.config = structuredClone(next)
    },
    getRow(id) {
      return state.find(item => item.entry.options.id === id)
    },
    removeRow(id) {
      const index = state.findIndex(item => item.entry.options.id === id)
      if (index >= 0) state.splice(index, 1)
    },
  }
  return editor
}

function createFakeRegistry(options = {}) {
  const definitions = new Map()
  const calls = []
  const shipped = options.shipped ?? []
  const brokenIds = options.brokenIds ?? new Set()
  let failOnce = options.failOnce ?? null
  let gate = options.registerGate ?? null

  const registry = {
    shipped,
    definitions,
    calls,
    brokenIds,
    async register(definition) {
      calls.push({ type: 'register', definition: structuredClone(definition) })
      if (typeof failOnce === 'function') {
        const error = failOnce(definition)
        failOnce = null
        if (error instanceof Error) throw error
      }
      if (definitions.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
      if (gate !== null && gate.id === definition.id) {
        const current = gate
        gate = null
        await current.promise
      }
      definitions.set(definition.id, structuredClone(definition))
      let disposed = false
      return async () => {
        if (disposed) return
        disposed = true
        definitions.delete(definition.id)
      }
    },
    async list() {
      return [
        ...shipped.map(row => ({ ...row })),
        ...[...definitions.values()].map(row => ({
          id: row.id,
          name: row.name,
          ...(brokenIds.has(row.id) ? { broken: 'simulated activation failure' } : {}),
        })),
      ]
    },
    async resolve(id) {
      if (!definitions.has(id)) throw new Error(`Unknown agent preset: ${id}`)
      return {
        id,
        ...(brokenIds.has(id) ? { broken: 'simulated activation failure' } : {}),
      }
    },
    async select(agent, id) {
      calls.push({ type: 'select', id })
      return id
    },
    setFailOnce(fn) {
      failOnce = fn
    },
    setRegisterGate(next) {
      gate = next
    },
  }
  return registry
}

function createFakeCtx() {
  const services = {}
  const provided = new Map()
  const tools = []
  const effects = []
  const injected = []
  const logs = []
  const pending = []
  let disposed = false

  const ctx = {
    get(name) {
      return services[name] ?? provided.get(name)
    },
    provide(name, value) {
      provided.set(name, value)
      return () => {
        if (provided.get(name) === value) provided.delete(name)
      }
    },
    effect(execute, label) {
      const result = execute()
      const entry = { label, disposers: [] }
      if (typeof result === 'function') {
        entry.disposers.push(result)
      } else if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        const task = Promise.resolve(result).then(disposer => {
          if (typeof disposer === 'function') entry.disposers.push(disposer)
        })
        pending.push(task)
      }
      effects.push(entry)
      return async () => {
        for (const disposer of [...entry.disposers].reverse()) await disposer()
      }
    },
    inject(deps, callback) {
      injected.push({ deps, callback })
      return () => {}
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    logger: {
      warn(...args) {
        logs.push(args.map(String).join(' '))
      },
      error(...args) {
        logs.push(args.map(String).join(' '))
      },
    },
  }

  return {
    ctx,
    services,
    provided,
    tools,
    effects,
    injected,
    logs,
    pending,
    async settle() {
      await Promise.allSettled(pending)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await Promise.allSettled(pending)
      const failures = []
      for (const entry of [...effects].reverse()) {
        for (const disposer of [...entry.disposers].reverse()) {
          try { await disposer() } catch (error) { failures.push(error) }
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'fake context cleanup failed')
    },
  }
}

/**
 * Build a service against a temp persona directory.
 *
 * `seed: false` writes a valid initialization marker first so the automatic
 * startup initialization cannot add `basic.md` to tests that are not about
 * seeding. `seed: true` leaves the directory untouched for seeding tests.
 */
async function loadService({
  personaDir = tmp,
  editorRows,
  registryOptions,
  services = {},
  config = {},
  seed = false,
} = {}) {
  if (personaDir !== '' && !seed) {
    await mkdir(personaDir, { recursive: true })
    const marker = join(personaDir, '.initialized.json')
    try {
      await writeFile(marker, `${JSON.stringify({ version: 1, createdDefault: false, defaultPersonaId: 'basic' })}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }

  const fake = createFakeCtx()
  const editor = createFakeEditor(editorRows ?? defaultEditorRows())
  const registry = createFakeRegistry(registryOptions)
  Object.assign(fake.services, {
    configEditor: editor,
    agentPresets: registry,
    ...services,
  })
  apply(fake.ctx, { personaDir, ...config })
  const service = fake.provided.get('xiaoxingPersona')
  assert.ok(service, 'apply() must provide the xiaoxingPersona service')
  fakes.push(fake)
  await fake.settle()
  return { fake, service, editor, registry }
}

async function initializeService(service) {
  assert.equal(typeof service.initialize, 'function', 'service.initialize() is required for first-run seeding')
  const result = service.initialize()
  assert.ok(result && typeof result.then === 'function', 'service.initialize() must return a promise')
  await result
}

async function withNoHome(fn) {
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    return await fn()
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
}

// ---------------------------------------------------------------------------
// First-run initialization
// ---------------------------------------------------------------------------

describe('first-run initialization', () => {
  it('creates basic.md and the initialization marker without applying', async () => {
    const { service, registry } = await loadService({ seed: true })
    await initializeService(service)

    const names = await readdir(tmp)
    assert.ok(names.includes('basic.md'), `expected basic.md, got ${names.join(', ')}`)
    assert.ok(names.includes('.initialized.json'), `expected .initialized.json, got ${names.join(', ')}`)
    assert.ok(!names.includes('.applied.json'), 'initialization must not apply a persona')

    const seeded = await readFile(join(tmp, 'basic.md'), 'utf8')
    const template = await readFile(DEFAULT_PERSONA_TEMPLATE, 'utf8')
    assert.equal(seeded, template, 'the starter persona must be copied from defaults/basic.md')
    assert.ok(!seeded.includes('{{'), 'the starter persona must not contain template groups')

    const marker = await readJson(tmp, '.initialized.json')
    assert.equal(marker.version, 1)
    assert.equal(marker.createdDefault, true)
    assert.equal(marker.defaultPersonaId, 'basic')

    const list = expectOk(await service.list({}), 'list')
    assert.equal(list.files.length, 1)
    assert.equal(list.files[0].id, 'basic')

    const status = expectOk(await service.status({}), 'status')
    assert.equal(status.applied, null)
    assert.equal(status.files, 1)
    assert.equal(registry.calls.filter(call => call.type === 'register').length, 0)
  })

  it('does not seed when any file already exists', async () => {
    await writeFile(join(tmp, 'notes.txt'), 'keep me', 'utf8')
    const { service } = await loadService({ seed: true })
    await initializeService(service)

    assert.ok(!(await exists(join(tmp, 'basic.md'))), 'any existing file must suppress the starter')
    assert.equal(await readFile(join(tmp, 'notes.txt'), 'utf8'), 'keep me')
    const marker = await readJson(tmp, '.initialized.json')
    assert.equal(marker.createdDefault, false)
  })

  it('does not seed when a persona file already exists', async () => {
    await writePersona(tmp, 'existing', 'EXISTING BODY', { name: '已有' })
    const before = await readFile(join(tmp, 'existing.md'), 'utf8')
    const { service } = await loadService({ seed: true })
    await initializeService(service)

    assert.ok(!(await exists(join(tmp, 'basic.md'))))
    assert.equal(await readFile(join(tmp, 'existing.md'), 'utf8'), before)
  })

  it('does not seed when an applied snapshot already exists', async () => {
    await writeFile(join(tmp, '.applied.json'), `${JSON.stringify({
      version: 1,
      presetId: 'old',
      name: 'Old',
      text: 'OLD TEXT',
      files: [],
      overrideBuiltIn: false,
      appliedAt: '2026-01-01T00:00:00.000Z',
    })}\n`, 'utf8')
    const { service } = await loadService({ seed: true })
    await initializeService(service)

    assert.ok(!(await exists(join(tmp, 'basic.md'))), 'an applied snapshot counts as previous data')
  })

  it('does not seed twice and does not resurrect a deleted starter', async () => {
    const first = await loadService({ seed: true })
    await initializeService(first.service)
    const seeded = await readFile(join(tmp, 'basic.md'), 'utf8')

    await initializeService(first.service)
    assert.equal(await readFile(join(tmp, 'basic.md'), 'utf8'), seeded, 'repeated initialization must be idempotent')

    await rm(join(tmp, 'basic.md'))
    await initializeService(first.service)
    assert.ok(!(await exists(join(tmp, 'basic.md'))), 'deleting the starter must not recreate it')

    const second = await loadService({ seed: true })
    await initializeService(second.service)
    assert.ok(!(await exists(join(tmp, 'basic.md'))), 'a new service must honor the initialization marker')
  })

  it('rejects an invalid initialization marker instead of guessing', async () => {
    await writeFile(join(tmp, '.initialized.json'), `${JSON.stringify({ version: 2 })}\n`, 'utf8')
    const { service } = await loadService({ seed: true })
    await assert.rejects(
      service.initialize(),
      error => error?.code === 'invalid-state',
      'an invalid marker must fail with invalid-state',
    )
  })
})

// ---------------------------------------------------------------------------
// No-home read-only behavior
// ---------------------------------------------------------------------------

describe('no-home behavior', () => {
  it('list and compose return empty results without writing', async () => {
    await withNoHome(async () => {
      const { service } = await loadService({ personaDir: '', seed: false })

      const list = expectOk(await service.list({}), 'list')
      assert.deepEqual(list.files, [])

      const compose = expectOk(await service.compose({}), 'compose')
      assert.equal(compose.text, '')
      assert.deepEqual(compose.used, [])
      assert.equal(compose.count, 0)

      assert.deepEqual(await readdir(tmp), [], 'read-only operations must not write to the temp directory')
    })
  })
})

// ---------------------------------------------------------------------------
// CRUD and file ids
// ---------------------------------------------------------------------------

describe('CRUD and file ids', () => {
  it('supports create/read/toggle/update/remove and preserves Unicode ids', async () => {
    const { service } = await loadService()
    const created = expectOk(await service.write({
      name: '小腥·猫娘',
      description: '测试人格',
      body: '你是小腥。',
    }), 'write create')
    const id = created.file.id
    assert.ok(id.includes('小腥'), `Unicode id expected, got ${id}`)
    assert.equal(created.file.name, '小腥·猫娘')

    const list = expectOk(await service.list({}), 'list')
    assert.ok(list.files.some(file => file.id === id))

    const read = expectOk(await service.read({ id }), 'read')
    assert.match(read.file.body, /你是小腥/)

    const toggled = expectOk(await service.toggle({ id, enabled: false }), 'toggle')
    assert.equal(toggled.file.enabled, false)

    const updated = expectOk(await service.write({ id, name: '小腥·猫娘', body: '更新正文' }), 'write update')
    assert.match(updated.file.body, /更新正文/)

    const removed = expectOk(await service.remove({ id }), 'remove')
    assert.equal(removed.id, id)
    const missing = expectFailure(await service.read({ id }), 'read removed')
    assert.equal(missing.code, 'not-found')
  })

  it('strips path separators and Windows-reserved characters from a new id', async () => {
    const { service } = await loadService()
    const created = expectOk(await service.write({ name: 'a/b:c*?"<>|', body: 'x' }), 'write sanitized id')
    assert.ok(!/[\\/:*?"<>|]/u.test(created.file.id), `unsafe id: ${created.file.id}`)
    expectOk(await service.read({ id: created.file.id }), 'read sanitized id')
  })

  it('does not create a Windows device-named persona', async () => {
    const { service } = await loadService()
    const result = await service.write({ name: 'CON', body: 'x' })
    if (result.ok === false) {
      assert.equal(result.code, 'invalid-id')
    } else {
      assert.ok(
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(result.file.id),
        `unsafe device id: ${result.file.id}`,
      )
      expectOk(await service.read({ id: result.file.id }), 'read device-safe id')
    }
    const names = await readdir(tmp)
    assert.ok(
      !names.some(name => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.md$/iu.test(name)),
      `a device file was created: ${names.join(', ')}`,
    )
  })

  it('keeps generated ids within the 120-character limit on collision', async () => {
    const { service } = await loadService()
    const name = 'a'.repeat(120)
    const first = expectOk(await service.write({ name, body: 'one' }), 'write first 120-char name')
    assert.ok(first.file.id.length <= 120, `first id length ${first.file.id.length}`)

    const second = expectOk(await service.write({ name, body: 'two' }), 'write second 120-char name')
    assert.ok(second.file.id.length <= 120, `second id length ${second.file.id.length}`)
    assert.notEqual(second.file.id, first.file.id)

    expectOk(await service.read({ id: second.file.id }), 'read collided id')
    expectOk(await service.toggle({ id: second.file.id, enabled: false }), 'toggle collided id')
    expectOk(await service.remove({ id: second.file.id }), 'remove collided id')
  })

  it('stores the personality slot and exposes only canonical slots to the tool', async () => {
    const { service, fake } = await loadService()
    const created = expectOk(await service.write({ name: '叠加人格', slot: 'personality', body: 'PERSONA' }), 'write personality')
    assert.equal(created.file.slot, 'personality')
    assert.match(await readFile(join(tmp, `${created.file.id}.md`), 'utf8'), /^slot: personality$/m)

    const tool = fake.tools.find(candidate => candidate.name === 'persona_manager')
    assert.ok(tool, 'the persona_manager tool must be registered')
    assert.deepEqual(tool.parameters.properties.slot.enum, ['identity', 'voice', 'user', 'instructions', 'personality'])

    const rejected = expectFailure(await service.write({ name: 'unknown', slot: 'nope', body: 'x' }), 'unknown slot')
    assert.equal(rejected.code, 'invalid-slot')
    for (const invalid of ['overlay', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const failure = expectFailure(await service.write({ name: `invalid-${invalid}`, slot: invalid, body: 'x' }), `slot ${invalid}`)
      assert.equal(failure.code, 'invalid-slot', `${invalid} must not be accepted as a slot`)
    }
  })

  it('supports user-profile tool writes, edits, toggles and removal without applying', async () => {
    const { service, fake } = await loadService()
    const tool = fake.tools.find(candidate => candidate.name === 'persona_manager')
    const result = expectOk(await tool.execute({ action: 'write', id: 'provided-user', name: 'User preferences', slot: 'user', body: 'Prefers concise replies.' }, {}), 'tool write user')
    assert.equal(result.data.file.slot, 'user')
    assert.equal(expectOk(await service.read({ id: 'provided-user' })).file.body.trim(), 'Prefers concise replies.')
    assert.equal(expectOk(await service.list({})).files[0].slot, 'user')
    expectOk(await service.write({ id: 'provided-user', body: 'Prefers clear replies.' }))
    assert.equal(expectOk(await service.compose({})).text, 'Prefers clear replies.')
    expectOk(await service.toggle({ id: 'provided-user', enabled: false }))
    assert.equal(expectOk(await service.compose({})).text, '')
    expectOk(await service.toggle({ id: 'provided-user', enabled: true }))
    assert.equal(expectOk(await service.read({ id: 'provided-user' })).file.slot, 'user')
    assert.ok(!(await readdir(tmp)).includes('.applied.json'))
    expectOk(await service.remove({ id: 'provided-user' }))
    assert.equal(expectOk(await service.list({})).files.length, 0)
  })

  it('composes identity, voice, user, instructions and personality in that order', async () => {
    const { service } = await loadService()
    for (const [slot, body] of [['personality', 'PERSONALITY'], ['instructions', 'INSTRUCTIONS'], ['user', 'USER'], ['voice', 'VOICE'], ['identity', 'IDENTITY']]) {
      expectOk(await service.write({ name: `slot-${slot}`, slot, body }), `write ${slot}`)
    }
    const composed = expectOk(await service.compose({}), 'compose canonical order')
    assert.deepEqual(composed.text.split('\n\n'), ['IDENTITY', 'VOICE', 'USER', 'INSTRUCTIONS', 'PERSONALITY'])
  })
})

// ---------------------------------------------------------------------------
// Apply transaction
// ---------------------------------------------------------------------------

describe('apply transaction', () => {
  it('validates the preset template before disposing the old registration', async () => {
    const { service, editor, registry } = await loadService()
    expectOk(await service.write({ name: '小星', body: 'OLD PERSONA' }), 'write persona')
    const first = expectOk(await service.apply({}), 'first apply')
    assert.ok(first.presetId)
    assert.ok(registry.definitions.has(first.presetId))

    editor.removeRow('preset-standard')
    const second = expectFailure(await service.apply({}), 'apply without template')
    assert.equal(second.code, 'no-template')
    assert.ok(registry.definitions.has(first.presetId), 'old registration must survive a template failure')

    const status = expectOk(await service.status({}), 'status')
    assert.equal(status.applied.presetId, first.presetId)
  })

  it('reuses the same preset id on repeated apply', async () => {
    const { service, registry } = await loadService()
    expectOk(await service.write({ name: '小星', body: 'PERSONA' }), 'write persona')
    const first = expectOk(await service.apply({}), 'first apply')
    const second = expectOk(await service.apply({}), 'second apply')
    assert.equal(second.presetId, first.presetId)
    assert.equal([...registry.definitions.keys()].filter(id => id === first.presetId).length, 1)
    assert.ok(![...registry.definitions.keys()].some(id => id.startsWith(`${first.presetId}-persona-`)))
  })

  it('keeps a stable suffixed id when a shipped preset owns the base id', async () => {
    const { service, registry } = await loadService({
      registryOptions: { shipped: [{ id: 'persona-id', name: 'Shipped' }] },
    })
    expectOk(await service.write({ name: 'persona id', body: 'PERSONA' }), 'write persona')
    const first = expectOk(await service.apply({}), 'first apply')
    assert.equal(first.presetId, 'persona-id-persona-2')
    const second = expectOk(await service.apply({}), 'second apply')
    assert.equal(second.presetId, 'persona-id-persona-2')
    assert.ok(registry.definitions.has('persona-id-persona-2'))
  })

  it('rolls back the old registration when the new preset is broken', async () => {
    const { service, registry } = await loadService()
    expectOk(await service.write({ name: 'old', body: 'OLD' }), 'write old')
    const first = expectOk(await service.apply({}), 'first apply')
    assert.equal(first.presetId, 'old')

    expectOk(await service.remove({ id: 'old' }), 'remove old')
    expectOk(await service.write({ name: 'new', body: 'NEW' }), 'write new')
    registry.brokenIds.add('new')

    const second = expectFailure(await service.apply({}), 'apply broken preset')
    assert.equal(second.code, 'preset-failed')
    assert.ok(registry.definitions.has('old'), 'old registration must be restored')
    assert.ok(!registry.definitions.has('new'), 'broken registration must be disposed')

    const status = expectOk(await service.status({}), 'status')
    assert.equal(status.applied.presetId, 'old')
  })

  it('rolls back the old registration when register throws', async () => {
    const { service, registry } = await loadService()
    expectOk(await service.write({ name: 'old', body: 'OLD' }), 'write old')
    const first = expectOk(await service.apply({}), 'first apply')
    assert.equal(first.presetId, 'old')

    expectOk(await service.remove({ id: 'old' }), 'remove old')
    expectOk(await service.write({ name: 'new', body: 'NEW' }), 'write new')
    registry.setFailOnce(definition => definition.id === 'new' ? new Error('simulated register failure') : undefined)

    const second = expectFailure(await service.apply({}), 'apply register failure')
    assert.ok(registry.definitions.has('old'), 'old registration must be restored')
    assert.ok(!registry.definitions.has('new'), 'failed registration must not remain')
  })

  it('rolls back the old registration and config when a built-in edit fails', async () => {
    const { service, editor, registry } = await loadService()
    expectOk(await service.write({ name: 'old', body: 'OLD' }), 'write old')
    const first = expectOk(await service.apply({}), 'first apply')
    const before = new Map(editor.entries().map(entry => [entry.options.id, structuredClone(entry.options.config)]))

    await writeFile(join(tmp, 'settings.json'), `${JSON.stringify({ overrideBuiltInPresets: true })}\n`, 'utf8')
    editor.failEditId = 'preset-standard'

    const second = expectFailure(await service.apply({}), 'apply config failure')
    assert.ok(registry.definitions.has(first.presetId), 'old registration must be restored')
    for (const [id, config] of before) {
      assert.deepEqual(editor.getRow(id).entry.options.config, config, `config for ${id} must be rolled back`)
    }
  })

  it('rolls back when the applied snapshot write fails', async () => {
    const { service, editor, registry } = await loadService()
    expectOk(await service.write({ name: 'old', body: 'OLD' }), 'write old')
    const first = expectOk(await service.apply({}), 'first apply')
    const before = new Map(editor.entries().map(entry => [entry.options.id, structuredClone(entry.options.config)]))

    expectOk(await service.remove({ id: 'old' }), 'remove old')
    expectOk(await service.write({ name: 'new', body: 'NEW' }), 'write new')

    const originalWrite = service._writeAppliedRecord
    service._writeAppliedRecord = async () => { throw new Error('simulated snapshot failure') }
    try {
      const second = expectFailure(await service.apply({}), 'apply snapshot failure')
      assert.ok(registry.definitions.has(first.presetId), 'old registration must be restored')
      assert.ok(!registry.definitions.has('new'), 'new registration must be disposed')
      for (const [id, config] of before) {
        assert.deepEqual(editor.getRow(id).entry.options.config, config, `config for ${id} must be rolled back`)
      }
    } finally {
      service._writeAppliedRecord = originalWrite
    }
  })
})

// ---------------------------------------------------------------------------
// Built-in preset override scope
// ---------------------------------------------------------------------------

describe('built-in preset override scope', () => {
  it('migrates legacy override snapshots without saving the applied text as the original', async () => {
    const rows = defaultEditorRows()
    for (const row of rows) {
      if (!BUILT_IN_ROWS.includes(row.id)) continue
      row.config.plugins.find(item => item.name === PERSONA_PLUGIN_NAME).config.prefix = 'LEGACY USER PERSONA'
    }
    await writePersona(tmp, 'legacy', 'LEGACY USER PERSONA')
    await writeFile(join(tmp, 'settings.json'), JSON.stringify({ overrideBuiltInPresets: true }))
    await writeFile(join(tmp, '.applied.json'), JSON.stringify({
      presetId: 'legacy', name: 'legacy', text: 'LEGACY USER PERSONA', files: ['legacy'],
      overrideBuiltIn: true, appliedAt: '2026-01-01T00:00:00.000Z',
    }))
    const { service, editor } = await loadService({ editorRows: rows })
    await service.bootstrapPresets()
    expectOk(await service.apply({}), 'upgrade apply')
    const snapshot = await readJson(tmp, '.applied.json')
    for (const id of BUILT_IN_ROWS) {
      const shipped = editor.getRow(id).inherited.plugins.find(item => item.name === PERSONA_PLUGIN_NAME).config.prefix
      assert.equal(snapshot.builtInOriginals[id].prefix, shipped)
    }
    expectOk(await service.setOverrideBuiltIn({ enabled: false }))
    expectOk(await service.apply({}), 'restore upgraded overrides')
    for (const id of BUILT_IN_ROWS) {
      const row = editor.getRow(id)
      const shipped = row.inherited.plugins.find(item => item.name === PERSONA_PLUGIN_NAME).config.prefix
      assert.equal(row.entry.options.config.plugins.find(item => item.name === PERSONA_PLUGIN_NAME).config.prefix, shipped)
    }
  })

  it('reports higher-layer authority refusal without a false rollback failure', async () => {
    const { service, editor, registry } = await loadService()
    expectOk(await service.write({ name: 'Example', body: 'PERSONA' }))
    expectOk(await service.setOverrideBuiltIn({ enabled: true }))
    const originalEdit = editor.edit
    editor.edit = async (entry, change) => {
      if (entry.options.id === 'preset-ptc') throw new Error('configuration is overridden by a home patch or command-line overlay')
      return originalEdit(entry, change)
    }
    try {
      const failure = expectFailure(await service.apply({}))
      assert.equal(failure.code, 'config-authority')
      assert.equal(registry.definitions.size, 0)
      assert.equal(editor.getRow('preset-standard').entry.options.config.plugins[0].config.prefix, 'standard-prefix')
      assert.equal(await exists(join(tmp, '.applied.json')), false)
    } finally { editor.edit = originalEdit }
  })

  it('overrides only the four built-in presets and preserves third-party/other fields', async () => {
    const rows = [
      ...defaultEditorRows(),
      presetRow('preset-custom', 'custom', 'custom-prefix'),
    ]
    const { service, editor, registry } = await loadService({ editorRows: rows })
    await writeFile(join(tmp, 'settings.json'), `${JSON.stringify({ overrideBuiltInPresets: true })}\n`, 'utf8')
    expectOk(await service.write({ name: '小星', body: 'USER PERSONA' }), 'write persona')

    const result = expectOk(await service.apply({}), 'apply override')
    assert.deepEqual(result.overridden.sort(), [...BUILT_IN_ROWS].sort())

    for (const id of BUILT_IN_ROWS) {
      const persona = editor.getRow(id).entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
      assert.equal(persona.config.prefix, 'USER PERSONA', `${id} persona must be overridden`)
    }

    const customPersona = editor.getRow('preset-custom').entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    assert.equal(customPersona.config.prefix, 'custom-prefix', 'third-party presets must not be touched')

    const minimalPersona = editor.getRow('preset-minimal').entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    assert.equal(minimalPersona.config.complete, true, 'other persona fields must be preserved')
    assert.equal(minimalPersona.config.includeRuntimeContext, false, 'other persona fields must be preserved')

    const applied = await readJson(tmp, '.applied.json')
    assert.equal(applied.builtInOriginals['preset-standard'].prefix, 'standard-prefix')
    assert.equal(applied.builtInOriginals['preset-custom'], undefined)
    assert.equal(registry.definitions.size, 1)
  })

  it('restores only the prefix written by the plugin and keeps user edits', async () => {
    const rows = [
      ...defaultEditorRows(),
      presetRow('preset-custom', 'custom', 'custom-prefix'),
    ]
    const { service, editor } = await loadService({ editorRows: rows })
    await writeFile(join(tmp, 'settings.json'), `${JSON.stringify({ overrideBuiltInPresets: true })}\n`, 'utf8')
    expectOk(await service.write({ name: '小星', body: 'USER PERSONA' }), 'write persona')
    expectOk(await service.apply({}), 'apply override')

    // A user changes one built-in persona after the plugin's override.
    const standardPersona = editor.getRow('preset-standard').entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    standardPersona.config.prefix = 'USER EDIT'

    // A user changes another field on a different built-in preset.
    const ptcPersona = editor.getRow('preset-ptc').entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    ptcPersona.config.suffix = 'USER SUFFIX'

    await writeFile(join(tmp, 'settings.json'), `${JSON.stringify({ overrideBuiltInPresets: false })}\n`, 'utf8')
    const restored = expectOk(await service.apply({}), 'apply restore')

    assert.ok(restored.restored.includes('preset-ptc'))
    assert.ok(!restored.restored.includes('preset-standard'), 'a user-edited prefix must not be restored')

    const standardAfter = editor.getRow('preset-standard').entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    assert.equal(standardAfter.config.prefix, 'USER EDIT', 'the user edit must survive restore')

    const ptcAfter = editor.getRow('preset-ptc').entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    assert.equal(ptcAfter.config.prefix, 'ptc-prefix', 'the plugin-written prefix must be restored')
    assert.equal(ptcAfter.config.suffix, 'USER SUFFIX', 'other fields must survive restore')

    const minimalAfter = editor.getRow('preset-minimal').entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    assert.equal(minimalAfter.config.prefix, 'minimal-prefix')
    assert.equal(minimalAfter.config.complete, true)

    const customAfter = editor.getRow('preset-custom').entry.options.config.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    assert.equal(customAfter.config.prefix, 'custom-prefix')
  })

  it('clears only user persona fields on system-prompt and preserves other fields', async () => {
    const system = systemPromptRow({
      current: {
        personaPrefix: 'USER DEPLOY',
        personaSuffix: 'USER SUFFIX',
        includeHarnessIdentity: true,
        includeRuntimeContext: false,
        toolOrder: ['x'],
      },
      inherited: {
        personaPrefix: 'coding-agent-default',
        personaSuffix: '',
        includeHarnessIdentity: true,
        includeRuntimeContext: true,
      },
    })
    const { service, editor } = await loadService({
      editorRows: [...defaultEditorRows().filter(row => row.id !== SYSTEM_PROMPT_ENTRY_ID), system],
    })
    expectOk(await service.write({ name: '小星', body: 'PERSONA' }), 'write persona')

    const result = expectOk(await service.apply({ clearDeployment: true }), 'apply with clearDeployment')
    assert.equal(result.deploymentCleared, true)

    const config = editor.getRow(SYSTEM_PROMPT_ENTRY_ID).entry.options.config
    assert.equal(config.personaPrefix, 'coding-agent-default', 'the user prefix must be restored to inherited')
    assert.equal(config.personaSuffix, '', 'the user suffix must be restored to inherited')
    assert.equal(config.includeRuntimeContext, false, 'other system-prompt fields must be preserved')
    assert.deepEqual(config.toolOrder, ['x'], 'other system-prompt fields must be preserved')
  })

  it('does not report deploymentCleared when only the inherited default is present', async () => {
    const { service, editor } = await loadService()
    expectOk(await service.write({ name: '小星', body: 'PERSONA' }), 'write persona')

    const result = expectOk(await service.apply({}), 'apply without deployment override')
    assert.equal(result.deploymentCleared, false)
    assert.equal(editor.calls.filter(call => call.id === SYSTEM_PROMPT_ENTRY_ID).length, 0)
  })

  it('requires clearDeployment before clearing a user deployment persona', async () => {
    const system = systemPromptRow({
      current: {
        personaPrefix: 'USER DEPLOY',
        personaSuffix: '',
        includeHarnessIdentity: true,
        includeRuntimeContext: true,
      },
      inherited: {
        personaPrefix: 'coding-agent-default',
        personaSuffix: '',
        includeHarnessIdentity: true,
        includeRuntimeContext: true,
      },
    })
    const { service, editor, registry } = await loadService({
      editorRows: [...defaultEditorRows().filter(row => row.id !== SYSTEM_PROMPT_ENTRY_ID), system],
    })
    expectOk(await service.write({ name: '小星', body: 'PERSONA' }), 'write persona')
    const before = structuredClone(editor.getRow(SYSTEM_PROMPT_ENTRY_ID).entry.options.config)

    const result = expectFailure(await service.apply({}), 'apply without clearDeployment')
    assert.equal(result.code, 'deployment-persona')
    assert.deepEqual(editor.getRow(SYSTEM_PROMPT_ENTRY_ID).entry.options.config, before)
    assert.equal(registry.calls.filter(call => call.type === 'register').length, 0)
    assert.ok(!(await exists(join(tmp, '.applied.json'))), 'a rejected apply must not write a snapshot')
  })
})

// ---------------------------------------------------------------------------
// Bootstrap and teardown
// ---------------------------------------------------------------------------

describe('bootstrap and teardown', () => {
  it('restores the applied snapshot without recomposing edited files', async () => {
    await writePersona(tmp, 'a', 'NEW TEXT', { name: 'A' })
    await writeFile(join(tmp, '.applied.json'), `${JSON.stringify({
      version: 1,
      presetId: 'old',
      name: 'Old',
      text: 'OLD TEXT',
      files: ['a'],
      overrideBuiltIn: false,
      appliedAt: '2026-01-01T00:00:00.000Z',
    })}\n`, 'utf8')

    const { service, registry } = await loadService()
    await service.bootstrapPresets()

    assert.ok(registry.definitions.has('old'), 'the snapshot preset must be restored')
    const definition = registry.definitions.get('old')
    const persona = definition.plugins.find(plugin => plugin.name === PERSONA_PLUGIN_NAME)
    assert.equal(persona.config.prefix, 'OLD TEXT', 'bootstrap must use the snapshot, not the edited file')
    assert.ok(registry.definitions.has('xiaoxing-ai-edit'), 'the AI editing preset must be registered')
    assert.equal(service.appliedPresetId, 'old')
  })

  it('does not leak a registration that resolves during teardown', async () => {
    await writeFile(join(tmp, '.applied.json'), `${JSON.stringify({
      version: 1,
      presetId: 'old',
      name: 'Old',
      text: 'OLD TEXT',
      files: [],
      overrideBuiltIn: false,
      appliedAt: '2026-01-01T00:00:00.000Z',
    })}\n`, 'utf8')

    const gate = defer()
    const started = defer()
    const { service, registry } = await loadService({
      registryOptions: { registerGate: { id: 'old', promise: gate.promise } },
    })
    const originalRegister = registry.register
    registry.register = async definition => {
      if (definition.id === 'old') started.resolve()
      return originalRegister(definition)
    }

    const bootstrap = service.bootstrapPresets()
    await started.promise

    const disposal = service.disposePresets()
    assert.ok(disposal && typeof disposal.then === 'function', 'disposePresets() must return a promise')

    gate.resolve()
    await bootstrap
    await disposal

    assert.ok(!registry.definitions.has('old'), 'a late registration must not survive teardown')
    assert.equal(service.appliedPresetId, '')
  })

  it('exposes async disposePresets() and serialized bootstrapPresets()', async () => {
    const { service } = await loadService()
    assert.equal(typeof service.initialize, 'function')
    assert.equal(typeof service.bootstrapPresets, 'function')
    assert.equal(typeof service.disposePresets, 'function')
    const disposal = service.disposePresets()
    assert.ok(disposal && typeof disposal.then === 'function', 'disposePresets() must be async')
    await disposal
  })
})

// ---------------------------------------------------------------------------
// AI editing session
// ---------------------------------------------------------------------------

describe('AI editing session', () => {
  function sessionServices({ createError = null, flushResult = false, flushError = null } = {}) {
    const createCalls = []
    const followups = []
    const flushCalls = []
    const agent = {
      id: 'session-ai',
      session: { id: 'session-ai' },
      followup(message) {
        followups.push(message)
      },
    }
    const controller = {
      async create(request) {
        createCalls.push(request)
        if (createError !== null) throw createError
        return { sessionId: request.sessionId, agentPreset: request.agentPreset }
      },
      async resolveAgent() {
        return { agent }
      },
    }
    const sessions = {
      async flush(session) {
        flushCalls.push(session)
        if (flushError !== null) throw flushError
        return flushResult
      },
    }
    const workspaceRegistry = {
      list() {
        return [{ id: 'ws1' }]
      },
    }
    return { controller, sessions, workspaceRegistry, createCalls, followups, flushCalls }
  }

  it('creates the session with xiaoxing-ai-edit directly and does not select afterwards', async () => {
    const fixture = sessionServices()
    const { service, registry } = await loadService({
      services: {
        sessionController: fixture.controller,
        sessions: fixture.sessions,
        workspaceRegistry: fixture.workspaceRegistry,
      },
    })
    await service.bootstrapPresets()
    const created = expectOk(await service.write({ name: '小星', body: 'PERSONA' }), 'write persona')

    const result = expectOk(await service.aiEdit({ id: created.file.id, instruction: '改一下' }), 'aiEdit')
    assert.ok(result.sessionId)
    assert.equal(fixture.createCalls.length, 1)
    assert.equal(fixture.createCalls[0].agentPreset, 'xiaoxing-ai-edit', 'create must name the persona-free preset')
    assert.equal(registry.calls.filter(call => call.type === 'select').length, 0, 'aiEdit must not select after create')
    assert.equal(fixture.followups.length, 1)
    assert.equal(fixture.flushCalls.length, 1)
    assert.match(fixture.followups[0].content[0].text, /PERSONA/)
  })

  it('AI editing uses supplied user facts instead of persona creative guidance', async () => {
    const fixture = sessionServices()
    const { service } = await loadService({ services: { sessionController: fixture.controller, sessions: fixture.sessions, workspaceRegistry: fixture.workspaceRegistry } })
    await service.bootstrapPresets()
    const created = expectOk(await service.write({ name: 'User facts', slot: 'user', body: 'Provided fact: prefers Chinese.' }))
    expectOk(await service.aiEdit({ id: created.file.id, slot: 'voice', instruction: '整理措辞' }))
    const prompt = fixture.followups[0].content[0].text
    assert.match(prompt, /用户资料整理任务/)
    assert.match(prompt, /Provided fact: prefers Chinese/)
    assert.match(prompt, /不得虚构、猜填/)
    assert.match(prompt, /slot: user/)
    assert.doesNotMatch(prompt, /500–3000|第二人称|示范台词/)
  })

  it('AI user-profile creation asks for facts and does not seed a user file', async () => {
    const fixture = sessionServices()
    const { service } = await loadService({ services: { sessionController: fixture.controller, sessions: fixture.sessions, workspaceRegistry: fixture.workspaceRegistry } })
    await service.bootstrapPresets()
    const before = (await readdir(tmp)).sort()
    expectOk(await service.aiEdit({ slot: 'user' }))
    const prompt = fixture.followups[0].content[0].text
    assert.match(prompt, /用户资料整理任务/)
    assert.match(prompt, /先请用户说明要记录的信息/)
    assert.match(prompt, /slot: user/)
    assert.doesNotMatch(prompt, /500–3000|第二人称|示范台词/)
    assert.deepEqual((await readdir(tmp)).sort(), before)
  })

  it('rejects an invalid AI creation slot before creating a session', async () => {
    const fixture = sessionServices()
    const { service } = await loadService({ services: { sessionController: fixture.controller, sessions: fixture.sessions, workspaceRegistry: fixture.workspaceRegistry } })
    await service.bootstrapPresets()
    assert.equal(expectFailure(await service.aiEdit({ slot: 'nope' })).code, 'invalid-slot')
    assert.equal(fixture.createCalls.length, 0)
  })

  it('treats sessions.flush(false) as non-fatal', async () => {
    const fixture = sessionServices({ flushResult: false })
    const { service } = await loadService({
      services: {
        sessionController: fixture.controller,
        sessions: fixture.sessions,
        workspaceRegistry: fixture.workspaceRegistry,
      },
    })
    await service.bootstrapPresets()
    const created = expectOk(await service.write({ name: '小星', body: 'PERSONA' }), 'write persona')

    const result = await service.aiEdit({ id: created.file.id })
    assert.notEqual(result.ok, false, `flush(false) must not fail aiEdit: ${JSON.stringify(result)}`)
  })

  it('reports agent-failed when session creation fails', async () => {
    const fixture = sessionServices({ createError: new Error('simulated create failure') })
    const { service } = await loadService({
      services: {
        sessionController: fixture.controller,
        sessions: fixture.sessions,
        workspaceRegistry: fixture.workspaceRegistry,
      },
    })
    await service.bootstrapPresets()
    const created = expectOk(await service.write({ name: '小星', body: 'PERSONA' }), 'write persona')

    const result = expectFailure(await service.aiEdit({ id: created.file.id }), 'aiEdit create failure')
    assert.equal(result.code, 'agent-failed')
    assert.equal(fixture.followups.length, 0)
  })
})
