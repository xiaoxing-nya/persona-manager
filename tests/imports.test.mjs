/** Import admission and metadata tests use only owned temporary directories. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'

async function fixture(t, { maxImportBytes = 1024 * 1024 } = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'persona-import-test-'))
  assert(resolve(temp).startsWith(resolve(tmpdir()) + sep))
  const home = join(temp, 'home')
  const data = join(home, 'xiaoxing', 'personas')
  const workspace = join(temp, 'workspace')
  const outside = join(temp, 'outside')
  for (const dir of [data, workspace, outside]) await mkdir(dir, { recursive: true })
  let service
  let tool
  const cleanups = []
  const ctx = {
    logger: { warn() {} },
    get: name => name === 'profileContext' ? { home } : name === 'workingDirectory' ? { get: () => workspace } : undefined,
    provide: (key, value) => { assert.equal(key, 'xiaoxingPersona'); service = value; return () => {} },
    tools: { register: value => { tool = value; return () => {} } },
    effect: callback => { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    inject: () => ({}),
  }
  apply(ctx, { personaDir: data, maxImportBytes })
  t.after(async () => {
    try { for (const cleanup of cleanups.reverse()) await cleanup() }
    finally { assert(resolve(temp).startsWith(resolve(tmpdir()) + sep)); await rm(temp, { recursive: true, force: true }) }
  })
  await service.initialize()
  return { service, tool, home, data, workspace, outside, agent: { session: { id: 'isolated-test' } } }
}

function success(result) { assert.notEqual(result.ok, false, JSON.stringify(result)); return result }

test('OpenClaw imports supplied personas and USER profiles, but skips runtime and memory data', async t => {
  const f = await fixture(t)
  const input = join(f.workspace, 'openclaw')
  await mkdir(input)
  await writeFile(join(input, 'SOUL.md'), 'You answer clearly.\n')
  await writeFile(join(input, 'IDENTITY.md'), '# Identity\n- Name: Example\n- Emoji: ⭐\n')
  await writeFile(join(input, 'AGENTS.md'), 'Example behavior rules.\n')
  await writeFile(join(input, 'USER.md'), 'Provided user preference: concise answers.\n')
  await writeFile(join(input, 'MEMORY.md'), 'Private memory must not be imported.\n')
  await writeFile(join(input, 'openclaw.json'), '{"exampleSecret":"not-real"}\n')
  const imported = success(await f.service.import({ path: input }))
  assert.equal(imported.created.length, 4)
  assert(!imported.skipped.some(item => item.file === 'USER.md'))
  assert(imported.skipped.some(item => item.file === 'MEMORY.md'))
  const user = imported.created.find(item => item.slot === 'user')
  assert.equal(user.enabled, true)
  assert.equal(success(await f.service.read({ id: user.id })).file.body.trim(), 'Provided user preference: concise answers.')
  assert(imported.skipped.some(item => item.file === 'openclaw.json'))
  const rules = imported.created.find(item => item.slot === 'instructions')
  assert.equal(rules.enabled, false)
  for (const item of imported.created) {
    const file = success(await f.service.read({ id: item.id })).file
    assert(!file.body.includes('Private memory'))
    assert(!file.body.includes('exampleSecret'))
  }
})

test('a directly imported USER.md is a user profile, while other Markdown stays voice', async t => {
  const f = await fixture(t)
  const input = join(f.workspace, 'uSeR.Md')
  await writeFile(input, '# Supplied preferences\nPrefers plain explanations.\n')
  const imported = success(await f.service.import({ path: input }))
  assert.equal(imported.created[0].slot, 'user')
  const file = success(await f.service.read({ id: imported.created[0].id })).file
  assert.equal(file.slot, 'user')
  assert.match(file.body, /Prefers plain explanations/)
  assert.match(await readFile(join(f.data, `${file.id}.md`), 'utf8'), /^slot: user$/m)
  const other = join(f.workspace, 'other.md')
  await writeFile(other, 'Some other Markdown.\n')
  assert.equal(success(await f.service.import({ path: other })).created[0].slot, 'voice')
})

test('Hermes YAML imports only selected personalities and disabled system instructions', async t => {
  const f = await fixture(t)
  const input = join(f.workspace, 'config.yaml')
  await writeFile(input, 'agent:\n  display:\n    personality: quiet\n  personalities:\n    quiet: |\n      You answer simply.\n    lively: "You sound lively."\n  system_prompt: "Example instructions."\napi_key: "not-real-and-not-imported"\n')
  const result = success(await f.service.import({ path: input }))
  assert.equal(result.created.length, 3)
  assert.equal(result.created.find(item => item.name === 'quiet').enabled, true)
  assert.equal(result.created.find(item => item.name === 'lively').enabled, false)
  assert.equal(result.created.find(item => item.slot === 'instructions').enabled, false)

  // Personalities use the canonical slot, both in the projection and on disk.
  for (const name of ['quiet', 'lively']) {
    const created = result.created.find(item => item.name === name)
    assert.equal(created.slot, 'personality')
    const stored = success(await f.service.read({ id: created.id })).file
    assert.equal(stored.slot, 'personality')
    assert.match(await readFile(join(f.data, `${created.id}.md`), 'utf8'), /^slot: personality$/m)
  }
})

test('Hermes distribution version is used only in its default description', async t => {
  const f = await fixture(t)
  const input = join(f.workspace, 'distribution')
  await mkdir(input)
  await writeFile(join(input, 'distribution.yaml'), 'name: Example profile\nversion: "1.2.3"\nauthor: Example\n')
  await writeFile(join(input, 'SOUL.md'), 'Example persona.\n')
  const result = success(await f.service.import({ path: input }))
  const file = success(await f.service.read({ id: result.created[0].id })).file
  assert.equal(file.name, 'Example profile')
  assert(file.description.includes('1.2.3'))
  assert.equal(file.author, undefined)
})

test('model import allows its workspace and refuses an external source; UI import remains explicit', async t => {
  const f = await fixture(t)
  await writeFile(join(f.workspace, 'example.md'), '# Example\nExample persona.\n')
  await writeFile(join(f.outside, 'external.md'), '# External\nExternal example.\n')
  const allowed = await f.tool.execute({ action: 'import', path: 'example.md' }, { agent: f.agent })
  assert.equal(allowed.ok, true, allowed.summary)
  const denied = await f.tool.execute({ action: 'import', path: join(f.outside, 'external.md') }, { agent: f.agent })
  assert.equal(denied.ok, false)
  assert(denied.summary.includes('import-access'))
  success(await f.service.import({ path: join(f.outside, 'external.md') }))
})

test('hidden files and private harness state are not accepted as persona imports', async t => {
  const f = await fixture(t)
  await writeFile(join(f.workspace, '.credentials.yaml'), 'agent:\n  personalities:\n    hidden: "Must not import"\n')
  await writeFile(join(f.home, 'private.md'), 'Must not import private harness state.\n')
  const before = (await readdir(f.data)).sort()
  const hidden = await f.service.import({ path: join(f.workspace, '.credentials.yaml') })
  const privateState = await f.service.import({ path: join(f.home, 'private.md') })
  assert.equal(hidden.code, 'import-access')
  assert.equal(privateState.code, 'import-access')
  assert.deepEqual((await readdir(f.data)).sort(), before)
})

test('import size limits use bytes and reject before creating persona files', async t => {
  const f = await fixture(t, { maxImportBytes: 64 })
  const input = join(f.workspace, 'large.md')
  await writeFile(input, '星'.repeat(30))
  const before = (await readdir(f.data)).sort()
  const result = await f.service.import({ path: input })
  assert.equal(result.code, 'import-too-large')
  assert.deepEqual((await readdir(f.data)).sort(), before)
})

test('model imports cannot escape through a workspace directory link', async t => {
  const f = await fixture(t)
  await writeFile(join(f.outside, 'linked.md'), 'External data must not be read.\n')
  try {
    await symlink(f.outside, join(f.workspace, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(`Directory links unavailable: ${error.code}`); return }
    throw error
  }
  const result = await f.tool.execute({ action: 'import', path: 'external-link/linked.md' }, { agent: f.agent })
  assert.equal(result.ok, false)
  assert(result.summary.includes('import-access'))
})

test('status distinguishes a saved override preference from effective coverage', async t => {
  const f = await fixture(t)
  success(await f.service.setOverrideBuiltIn({ enabled: true }))
  const status = success(await f.service.status({}))
  assert.equal(status.overrideBuiltIn, true)
  assert.equal(status.builtInOverridden, false)
  assert.equal(status.starterCreated, true)
  assert.equal(status.canApply, false)
  assert.equal(status.canApplyReason, 'no-editor')
})
