/**
 * Host half of the Xiaoxing persona manager bundle.
 *
 * Persona files are Markdown with flat YAML frontmatter below
 * `<DSH_HOME>/xiaoxing/personas`. The `xiaoxingPersona` service owns every
 * business operation; the `persona_manager` tool and the Web settings page call
 * the same methods. Applying registers a same-named Agent preset through the
 * native `agentPresets` registry (plus an optional override of the shipped
 * presets through `configEditor`), so users pick the persona per session by
 * switching modes; AI-edit sessions switch to a persona-free preset this
 * plugin registers alongside.
 */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

/** Cordis service key and Remote namespace of the persona service. */
const SERVICE_KEY = 'xiaoxingPersona'
/** Wire namespace exposed to the Web client. */
const REMOTE_NAMESPACE = 'xiaoxingPersona'
/** Prototype property carrying the Remote method markers. */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'
/** Remote methods in declaration order. */
const REMOTE_METHODS = Object.freeze(['list', 'read', 'write', 'remove', 'toggle', 'import', 'compose', 'apply', 'status', 'aiEdit', 'setOverrideBuiltIn'])
/**
 * Wire names for methods whose Service name cannot be mounted on the client
 * namespace service: `RemoteNamespaceService` already declares `remove`, and
 * `assertMethodAvailable` rejects a method that exists on its prototype.
 */
const REMOTE_EXPORT_NAMES = Object.freeze({ remove: 'delete' })
/** Native row that owns the deployment persona. */
const SYSTEM_PROMPT_ENTRY_ID = 'system-prompt'
/** Native package name of the agent preset row. */
const AGENT_PRESET_NAME = '@deepseek-ai/dsh-agent-preset'
/** Native package name of the per-agent persona row. */
const PERSONA_PLUGIN_NAME = '@deepseek-ai/dsh-persona'
/** Child row id used inside an agent preset. */
const PERSONA_ROW_ID = 'persona'
/** Persona slots in composition order. */
const SLOT_ORDER = Object.freeze({ identity: 0, voice: 1, instructions: 2, personality: 3 })
/** Slot used when a file declares none. */
const DEFAULT_SLOT = 'voice'
/** Default order inside one slot. */
const DEFAULT_ORDER = 100
/** Frontmatter keys in the order written back. */
const FRONTMATTER_KEYS = Object.freeze([
  'name', 'description', 'slot', 'order', 'enabled', 'sourceFormat', 'sourceFile', 'importedAt', 'emoji',
])
/** Known `sourceFormat` values. */
const SOURCE_FORMATS = Object.freeze([
  'manual', 'openclaw-workspace', 'hermes-soul', 'hermes-personality-preset',
  'hermes-profile-distribution', 'markdown',
])
/** Strict `{{...}}` groups the native persona template would interpolate. */
const TEMPLATE_GROUP_PATTERN = /\{\{[\s\S]*?\}\}/u
/** Registry id of the persona-free preset AI-edit sessions switch to. */
const AI_EDIT_PRESET_ID = 'xiaoxing-ai-edit'
/** Display name of the AI-edit preset in the mode roster. */
const AI_EDIT_PRESET_NAME = '小星AI辅助'
/** Profile row whose inherited config templates the persona preset. */
const PERSONA_PRESET_SOURCE_ROW = 'preset-standard'
/** Profile row whose inherited config templates the AI-edit preset. */
const AI_EDIT_PRESET_SOURCE_ROW = 'preset-minimal'
/** Roster order of the persona preset; shipped presets use 1-4. */
const PERSONA_PRESET_ORDER = 90
/** Persisted apply record, below the persona directory. */
const APPLIED_FILENAME = '.applied.json'
/** Persisted override switch, below the persona directory. */
const SETTINGS_FILENAME = 'settings.json'
/** One-time onboarding record; deleting a persona must not recreate it. */
const INITIALIZED_FILENAME = '.initialized.json'
/** Packaged, minimal starter persona, copied only into a fresh empty directory. */
const DEFAULT_PERSONA_URL = new URL('./defaults/basic.md', import.meta.url)
const DEFAULT_PERSONA_ID = 'basic'
/** Only the four shipped preset rows participate in the opt-in override. */
const BUILT_IN_PRESET_ROWS = Object.freeze(['preset-standard', 'preset-ptc', 'preset-minimal', 'preset-cordis'])
/** Windows device names are not ordinary persona filenames. */
const RESERVED_ID_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu
/** Characters Windows forbids in a file name, plus every control character. */
const UNSAFE_ID_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/gu
/** Single-match form of the same class, used to validate one id. */
const UNSAFE_ID_PATTERN = /[\\/:*?"<>|\u0000-\u001f\u007f]/u
/** Upper bound for one generated id. */
const MAX_ID_LENGTH = 120

/** Business failure carrying a stable code for the UI and the tool. */
class PersonaError extends Error {
  /**
   * @param {string} code - stable machine-readable code.
   * @param {string} message - human-readable English detail.
   */
  constructor(code, message) {
    super(message)
    this.name = 'PersonaError'
    this.code = code
  }
}

/** @param {unknown} error @returns {string} */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** @returns {string} ISO timestamp for import provenance. */
function nowIso() {
  return new Date().toISOString()
}

/** Normalize any Remote or tool request into a plain object. */
function asRequest(request) {
  return request !== null && typeof request === 'object' ? request : {}
}

/**
 * Derive a file id from a display name: drop path separators and Windows
 * reserved characters, turn whitespace runs into `-`, and keep Unicode.
 * @param {string} name - display name.
 * @returns {string} file id, possibly empty when the name holds no usable character.
 */
function idFromName(name) {
  const cleaned = String(name ?? '')
    .replace(UNSAFE_ID_CHARS, ' ')
    .replace(/\s+/gu, '-')
    .replace(/^[.\s-]+/u, '')
    .replace(/[.\s-]+$/u, '')
  const safe = RESERVED_ID_PATTERN.test(cleaned) ? `persona-${cleaned}` : cleaned
  return safe.slice(0, MAX_ID_LENGTH).replace(/[. ]+$/u, '')
}

/**
 * Whether a caller-supplied id is one safe file name segment.
 * @param {unknown} id - candidate id.
 * @returns {boolean}
 */
function isSafeId(id) {
  return typeof id === 'string'
    && id.length > 0
    && id.length <= MAX_ID_LENGTH
    && !UNSAFE_ID_PATTERN.test(id)
    && !RESERVED_ID_PATTERN.test(id)
    && id !== '.'
    && id !== '..'
    && !/[. ]$/u.test(id)
}

/** Whether a canonical path is inside one configured directory. */
function withinDirectory(path, directory) {
  if (directory === '') return false
  const part = relative(directory, path)
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
}

/** Compare two persona records by slot, order, then name. */
function comparePersonaFiles(left, right) {
  const slotDelta = (SLOT_ORDER[left.slot] ?? DEFAULT_ORDER) - (SLOT_ORDER[right.slot] ?? DEFAULT_ORDER)
  if (slotDelta !== 0) return slotDelta
  if (left.order !== right.order) return left.order - right.order
  if (left.name === right.name) return 0
  return left.name < right.name ? -1 : 1
}

/** Parse one flat frontmatter scalar (plain, single-quoted, double-quoted, boolean, number). */
function parseFrontmatterScalar(value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return unescapeYamlDouble(text.slice(1, -1))
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/gu, "'")
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  if (/^-?\d+$/u.test(text)) return Number.parseInt(text, 10)
  if (/^-?\d*\.\d+$/u.test(text)) return Number.parseFloat(text)
  return text
}

/** Format one flat frontmatter scalar, quoting whenever plain style would be ambiguous. */
function formatFrontmatterScalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const text = value === undefined || value === null ? '' : String(value)
  if (text === '') return '""'
  const plain = /^[A-Za-z0-9\u0080-\uFFFF][^:"'#\n]*$/u.test(text)
  const reserved = /^(true|false|null|~|-?\d+(\.\d+)?)$/u.test(text)
  return plain && !reserved ? text : JSON.stringify(text)
}

/**
 * Split one persona file into frontmatter entries and body text.
 * @param {string} text - file contents.
 * @returns {{ entries: Array<[string, unknown]>, body: string, hasFrontmatter: boolean }}
 */
function parsePersonaFile(text) {
  const source = String(text ?? '').replace(/^\uFEFF/u, '')
  const lines = source.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') return { entries: [], body: source, hasFrontmatter: false }
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') { end = index; break }
  }
  if (end < 0) return { entries: [], body: source, hasFrontmatter: false }
  const entries = []
  for (let index = 1; index < end; index += 1) {
    const line = lines[index].trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/u.exec(line)
    if (match === null) continue
    entries.push([match[1], parseFrontmatterScalar(match[2])])
  }
  const bodyLines = lines.slice(end + 1)
  if (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift()
  return { entries, body: bodyLines.join('\n'), hasFrontmatter: true }
}

/**
 * Render one persona file: stable frontmatter order, then the body verbatim.
 * @param {Record<string, unknown>} meta - normalized metadata.
 * @param {string} body - persona text.
 * @param {Array<[string, unknown]>} [extra] - unknown frontmatter keys kept from the file.
 * @returns {string}
 */
function serializePersonaFile(meta, body, extra) {
  const lines = ['---']
  for (const key of FRONTMATTER_KEYS) lines.push(`${key}: ${formatFrontmatterScalar(meta[key])}`)
  for (const [key, value] of extra ?? []) {
    if (FRONTMATTER_KEYS.includes(key)) continue
    lines.push(`${key}: ${formatFrontmatterScalar(value)}`)
  }
  lines.push('---', '')
  const text = String(body ?? '').replace(/^\n+/u, '')
  const terminated = text.endsWith('\n') ? text : `${text}\n`
  return `${lines.join('\n')}\n${terminated}`
}

/**
 * Normalize frontmatter into the stored metadata record.
 * @param {Record<string, unknown>} meta - parsed frontmatter values.
 * @param {string} fallbackName - name used when the file declares none.
 * @returns {Record<string, unknown>}
 */
function normalizeMeta(meta, fallbackName) {
  const raw = meta !== null && typeof meta === 'object' ? meta : {}
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : fallbackName
  const order = Number(raw.order)
  const slot = typeof raw.slot === 'string' && Object.hasOwn(SLOT_ORDER, raw.slot) ? raw.slot : DEFAULT_SLOT
  const sourceFormat = typeof raw.sourceFormat === 'string' && SOURCE_FORMATS.includes(raw.sourceFormat)
    ? raw.sourceFormat
    : 'manual'
  return {
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    slot,
    order: Number.isFinite(order) ? Math.trunc(order) : DEFAULT_ORDER,
    enabled: raw.enabled === undefined ? true : raw.enabled === true || raw.enabled === 'true',
    sourceFormat,
    sourceFile: typeof raw.sourceFile === 'string' ? raw.sourceFile : '',
    importedAt: typeof raw.importedAt === 'string' ? raw.importedAt : '',
    emoji: typeof raw.emoji === 'string' ? raw.emoji : '',
  }
}

/** Read and parse one persona file from disk. */
async function readPersonaFile(dir, fileName) {
  const path = join(dir, fileName)
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new PersonaError('unsafe-file', `persona file must be a regular file, not a link or directory: ${fileName}`)
  }
  const text = await readFile(path, 'utf8')
  const parsed = parsePersonaFile(text)
  const id = basename(fileName, extname(fileName))
  const meta = normalizeMeta(Object.fromEntries(parsed.entries), id)
  const extra = parsed.entries.filter(([key]) => !FRONTMATTER_KEYS.includes(key))
  return {
    id,
    ...meta,
    body: parsed.body,
    extra,
    updatedAt: info.mtime.toISOString(),
    size: info.size,
    path,
  }
}

/** Public projection of one persona file, without the body. */
function summarizePersonaFile(file) {
  return {
    id: file.id,
    name: file.name,
    description: file.description,
    slot: file.slot,
    order: file.order,
    enabled: file.enabled,
    sourceFormat: file.sourceFormat,
    emoji: file.emoji,
    updatedAt: file.updatedAt,
    size: file.size,
  }
}

/** Public projection including the body. */
function projectPersonaFile(file) {
  return {
    ...summarizePersonaFile(file),
    sourceFile: file.sourceFile,
    importedAt: file.importedAt,
    body: file.body,
  }
}

/** Unescape one YAML double-quoted scalar body. */
function unescapeYamlDouble(text) {
  return text.replace(/\\(u[0-9a-fA-F]{4}|.)/gu, (match, escape) => {
    if (escape.startsWith('u')) return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
    switch (escape) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case '"': return '"'
      case '\\': return '\\'
      default: return escape
    }
  })
}

/** Whether one YAML line carries no content. */
function isYamlBlank(raw) {
  const text = raw.trim()
  return text === '' || text.startsWith('#')
}

/** Parse one YAML scalar (plain, quoted, boolean, number, inline scalar sequence). */
function parseYamlScalar(value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return unescapeYamlDouble(text.slice(1, -1))
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/gu, "'")
  if (text === 'true' || text === 'True' || text === 'TRUE') return true
  if (text === 'false' || text === 'False' || text === 'FALSE') return false
  if (text === 'null' || text === 'Null' || text === 'NULL' || text === '~') return null
  if (/^-?\d+$/u.test(text)) return Number.parseInt(text, 10)
  if (/^-?\d*\.\d+$/u.test(text)) return Number.parseFloat(text)
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map(item => parseYamlScalar(item))
  }
  return text
}

/** Match one `key: value` mapping entry. */
function matchYamlEntry(line) {
  const match = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^:#][^:]*?))\s*:(?:\s+(.*))?$/u.exec(line)
  if (match === null) return undefined
  const key = match[1] !== undefined
    ? unescapeYamlDouble(match[1])
    : match[2] !== undefined ? match[2].replace(/''/gu, "'") : match[3].trim()
  if (key === '') return undefined
  return { key, value: match[4] === undefined ? '' : match[4].trim() }
}

/** Whether a mapping value starts a literal or folded block. */
function isBlockIndicator(value) {
  return /^[>|][+-]?$/u.test(value)
}

/** Read the indented lines of one literal (`|`) or folded (`>`) block. */
function readYamlBlock(lines, start, parentIndent, indicator) {
  const folded = indicator.startsWith('>')
  const collected = []
  let index = start
  let blockIndent = -1
  while (index < lines.length) {
    const raw = lines[index]
    if (raw.trim() === '') { collected.push(''); index += 1; continue }
    const indent = raw.length - raw.trimStart().length
    if (indent <= parentIndent) break
    if (blockIndent < 0) blockIndent = indent
    if (indent < blockIndent) break
    collected.push(raw.slice(blockIndent))
    index += 1
  }
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()
  const text = folded
    ? collected.join(' ').replace(/[ \t]+/gu, ' ').trim()
    : collected.join('\n').replace(/\n+$/u, '')
  return { text, next: index }
}

/** Find the next meaningful YAML line at or after `start`. */
function nextYamlLine(lines, start) {
  for (let index = start; index < lines.length; index += 1) {
    const raw = lines[index]
    if (isYamlBlank(raw)) continue
    return { indent: raw.length - raw.trimStart().length, text: raw.trim() }
  }
  return undefined
}

/** Build one structured YAML parse failure. */
function yamlFailure(index, message) {
  return { ok: false, line: index + 1, message }
}

/**
 * Parse the YAML subset Hermes Agent configuration files use: nested mappings,
 * plain and quoted scalars, literal (`|`) and folded (`>`) blocks, and scalar
 * sequences. Anything else fails with a line number instead of a guessed value.
 * @param {string} text - file contents.
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, line: number, message: string }}
 */
function parseYamlSubset(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/u, '').split(/\r?\n/u)
  const root = {}
  const stack = [{ indent: -1, container: root, kind: 'map' }]
  let index = 0
  while (index < lines.length) {
    const raw = lines[index]
    if (isYamlBlank(raw)) { index += 1; continue }
    if (/^ *\t/u.test(raw)) return yamlFailure(index, 'tab indentation is not supported')
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const frame = stack[stack.length - 1]
    if (line === '-' || line.startsWith('- ')) {
      if (frame.kind !== 'seq') return yamlFailure(index, 'sequence item without a parent sequence')
      const item = line === '-' ? '' : line.slice(2).trim()
      if (item === '') return yamlFailure(index, 'nested sequences are not supported')
      if (matchYamlEntry(item) !== undefined) return yamlFailure(index, 'mapping entries inside a sequence are not supported')
      frame.container.push(parseYamlScalar(item))
      index += 1
      continue
    }
    if (frame.kind !== 'map') return yamlFailure(index, 'mapping entry inside a sequence is not supported')
    const entry = matchYamlEntry(line)
    if (entry === undefined) return yamlFailure(index, 'expected a "key: value" mapping entry')
    if (isBlockIndicator(entry.value)) {
      const block = readYamlBlock(lines, index + 1, indent, entry.value)
      frame.container[entry.key] = block.text
      index = block.next
      continue
    }
    if (entry.value === '') {
      const next = nextYamlLine(lines, index + 1)
      if (next !== undefined && next.indent > indent && (next.text === '-' || next.text.startsWith('- '))) {
        const sequence = []
        frame.container[entry.key] = sequence
        stack.push({ indent, container: sequence, kind: 'seq' })
      } else {
        const mapping = {}
        frame.container[entry.key] = mapping
        stack.push({ indent, container: mapping, kind: 'map' })
      }
      index += 1
      continue
    }
    frame.container[entry.key] = parseYamlScalar(entry.value)
    index += 1
  }
  return { ok: true, value: root }
}

/** Prompt-injection patterns reported as import warnings; none of them blocks. */
const INJECTION_PATTERNS = Object.freeze([
  { code: 'ignore-previous', pattern: /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)\b/iu, message: 'text asks to ignore previous instructions' },
  { code: 'disregard', pattern: /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier|system)\b/iu, message: 'text asks to disregard prior instructions' },
  { code: 'forget', pattern: /\bforget\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\b/iu, message: 'text asks to forget prior instructions' },
  { code: 'role-override', pattern: /\byou\s+are\s+now\b|\bact\s+as\s+(?:the\s+)?system\b|\bsystem\s+prompt\s*:/iu, message: 'text attempts to override the assistant role' },
  { code: 'zero-width', pattern: /[\u200B\u200C\u200D\uFEFF]/u, message: 'text contains zero-width characters' },
  { code: 'html-comment', pattern: /<!--[\s\S]*?-->/u, message: 'text contains an HTML comment' },
])

/**
 * Scan one imported body for prompt-injection patterns.
 * @param {string} file - source path reported in the warning.
 * @param {string} body - imported text.
 * @returns {Array<{ file: string, code: string, message: string }>}
 */
function scanInjectionPatterns(file, body) {
  const warnings = []
  for (const candidate of INJECTION_PATTERNS) {
    if (candidate.pattern.test(body)) warnings.push({ file, code: candidate.code, message: candidate.message })
  }
  return warnings
}

/** Read the first Markdown level-one heading of a document. */
function firstHeading(body) {
  const match = /^\s*#\s+(.+)$/mu.exec(body)
  return match === null ? '' : match[1].trim()
}

/** Read `- Label: value` lines (bold labels optional, colon inside or outside the bold) from an OpenClaw IDENTITY.md document. */
function parseIdentityFields(body) {
  const fields = {}
  for (const line of body.split('\n')) {
    const match = /^\s*[-*]\s*\*{0,2}\s*([A-Za-z][A-Za-z ]*?)\s*\*{0,2}\s*:\s*\*{0,2}\s*(.+)$/u.exec(line)
    if (match === null) continue
    fields[match[1].trim().toLowerCase()] = match[2].trim()
  }
  return fields
}

/** Build the stored metadata for one planned import entry. */
function importMeta(entry, sourceFile) {
  return {
    name: entry.name,
    description: entry.description ?? '',
    slot: entry.slot,
    order: entry.order ?? DEFAULT_ORDER,
    enabled: entry.enabled,
    sourceFormat: entry.sourceFormat,
    sourceFile,
    importedAt: nowIso(),
    emoji: entry.emoji ?? '',
  }
}

/**
 * Replace the persona row prefix inside one preset plugin list. A list without
 * a persona row gains one at the front, matching shipped preset conventions.
 * @param {unknown[]} plugins - cloned preset plugin rows.
 * @param {string} text - persona text the mounted row carries.
 * @returns {unknown[]} the updated plugin list.
 */
function withPersonaPrefix(plugins, text) {
  const rows = Array.isArray(plugins) ? plugins : []
  let replaced = false
  const next = rows.map(item => {
    if (item === null || typeof item !== 'object' || item.name !== PERSONA_PLUGIN_NAME) return item
    replaced = true
    return { ...item, config: { ...(item.config ?? {}), prefix: text } }
  })
  if (replaced) return next
  return [{ id: PERSONA_ROW_ID, name: PERSONA_PLUGIN_NAME, config: { prefix: text } }, ...next]
}

/**
 * Build the first message of an AI-edit Session: the saved persona body, the
 * storage format contract, creative guidance, the edit workflow, and the
 * user's instruction. Chinese-first because the feature's users ask in Chinese.
 * @param {{ id: string, name: string, slot: string }} file - saved persona projection.
 * @param {string} instruction - what the user wants changed.
 * @returns {string} the injected prompt.
 */
function buildAiEditPrompt(file, instruction) {
  return [
    '# 人格修订任务',
    '',
    `请修订人格文件「${file.name}」（id：${file.id}，类别：${file.slot}）。`,
    '',
    '## 当前正文',
    '',
    file.body,
    '',
    '## 格式要求',
    '',
    '- 人设正文是纯 Markdown，应用后会注入同名 Agent 预设的 persona 段（系统提示词最前部）',
    '- 正文中不要出现 `{{...}}` 模板插值组（原生渲染会严格插值，导致会话报错）',
    '- 不要包含"忽略之前的指令"之类的提示注入语句',
    '- 建议长度 500–3000 字符',
    '',
    '## 创作建议',
    '',
    '- 用第二人称"你是……"书写，写具体行为倾向而非抽象形容词',
    '- 覆盖：身份、性格、说话风格、行为边界、与用户的互动方式',
    '- 给出语气示例（2–3 句示范台词）比堆砌形容词更有效',
    '- 保留原正文里仍然成立的核心设定，只改需要改的部分',
    '',
    '## 修改方法',
    '',
    '- 先用 persona_manager 工具的 read action 读取当前文件确认内容',
    '- 再用 write action 写回：带上相同的 id，name/slot/order/enabled 保持不变，只替换 body（需要时同步 description）',
    '- 完成后向用户报告修改要点；除非用户明确要求，不要调用 apply action',
    '',
    ...(instruction === '' ? [
      '## 接下来',
      '',
      '用户会在本会话中提出具体修改要求。请先用一两句话确认你已读取该人格并了解上述约束，然后请用户描述想要的修改。',
    ] : [
      '## 用户要求',
      '',
      instruction,
    ]),
  ].join('\n')
}

/**
 * Build the first message of an AI-creation Session: the storage format
 * contract, creative guidance, the creation workflow, and the user's brief.
 * @param {string} instruction - what the user wants created.
 * @returns {string} the injected prompt.
 */
function buildAiCreatePrompt(instruction) {
  return [
    '# 人格创作任务',
    '',
    '请创作一个全新的人格文件。',
    '',
    '## 格式要求',
    '',
    '- 人设正文是纯 Markdown，应用后会注入同名 Agent 预设的 persona 段（系统提示词最前部）',
    '- 正文中不要出现 `{{...}}` 模板插值组（原生渲染会严格插值，导致会话报错）',
    '- 不要包含"忽略之前的指令"之类的提示注入语句',
    '- 建议长度 500–3000 字符',
    '',
    '## 创作建议',
    '',
    '- 先起一个名字，再写正文；类别通常用 voice（SOUL.md）',
    '- 用第二人称"你是……"书写，写具体行为倾向而非抽象形容词',
    '- 覆盖：身份、性格、说话风格、行为边界、与用户的互动方式',
    '- 给出语气示例（2–3 句示范台词）比堆砌形容词更有效',
    '',
    '## 创作方法',
    '',
    '- 用 persona_manager 工具的 write action 创建：不带 id，带 name 与正文 body，slot 用 voice',
    '- 完成后向用户报告创建结果与要点；除非用户明确要求，不要调用 apply action',
    '',
    ...(instruction === '' ? [
      '## 接下来',
      '',
      '用户会在本会话中提出具体创作要求。请先简短说明你已准备好创作并了解上述约束，然后请用户描述想要的人格。',
    ] : [
      '## 用户要求',
      '',
      instruction,
    ]),
  ].join('\n')
}

/**
 * The persona service: every business operation lives here, and both callers
 * (the `persona_manager` tool and the Web settings page) go through it.
 */
class PersonaService {
  /**
   * @param {{
   *   personaDir: string,
   *   getEditor: () => any,
   *   getAgentPresets: () => any,
   *   log: (message: string) => void,
   * }} deps - resolved plugin configuration and service access.
   */
  constructor(deps) {
    this.deps = deps
    this.queue = Promise.resolve()
    this.initialized = false
    this.initialization = null
    this.initializationError = null
    this.closed = false
    this.presetDefinitions = new Map()
    this.bootstrapErrors = {}
    this.sessionDeps = undefined
    /** Registry disposers of presets this service registered, by preset id. */
    this.presetDisposers = new Map()
    /** Registry id of the currently applied persona preset, or ''. */
    this.appliedPresetId = ''
    this.typertRemote = Object.freeze({
      service: this,
      serviceKey: SERVICE_KEY,
      namespace: REMOTE_NAMESPACE,
    })
  }

  /** Admit model imports only within the session workspace or persona directory. */
  async authorizeModelImport(rawPath, agent) {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') throw new PersonaError('invalid-path', 'an import path is required')
    const root = this.deps.getImportRoot?.(agent)
    if (typeof root !== 'string' || root === '') throw new PersonaError('import-access', 'model imports require a session workspace; use the settings page to import external persona files')
    const source = resolve(root, rawPath.trim())
    const allowed = [resolve(root), this.deps.personaDir].filter(Boolean)
    if (!allowed.some(dir => withinDirectory(source, dir))) throw new PersonaError('import-access', 'the import is outside the session workspace; use the settings page for external sources')
    const canonical = await realpath(source)
    const canonicalRoots = await Promise.all(allowed.map(dir => realpath(dir).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })))
    if (!canonicalRoots.some(dir => dir !== null && withinDirectory(canonical, dir))) throw new PersonaError('import-access', 'the import link points outside the permitted directories')
    return canonical
  }

  /** Read a regular import file with a bounded byte budget. */
  async _readImportFile(source) {
    if (basename(source).startsWith('.')) throw new PersonaError('import-access', 'hidden configuration files are not persona import sources')
    const info = await lstat(source)
    if (!info.isFile() || info.isSymbolicLink()) throw new PersonaError('unsafe-file', 'import sources must be regular files')
    const canonical = await realpath(source)
    if (this.deps.dshHome !== '' && withinDirectory(canonical, this.deps.dshHome) && !withinDirectory(canonical, this.deps.personaDir)) {
      throw new PersonaError('import-access', 'private harness state is not a persona import source')
    }
    const limit = this.deps.maxImportBytes
    if (info.size > limit) throw new PersonaError('import-too-large', `import file exceeds ${limit} bytes`)
    const handle = await open(canonical, 'r')
    try {
      const buffer = Buffer.alloc(limit + 1)
      let size = 0
      while (size < buffer.length) {
        const result = await handle.read(buffer, size, buffer.length - size, null)
        if (result.bytesRead === 0) break
        size += result.bytesRead
      }
      if (size > limit) throw new PersonaError('import-too-large', `import file exceeds ${limit} bytes`)
      return buffer.subarray(0, size).toString('utf8')
    } finally {
      await handle.close()
    }
  }

  /** Resolve the Session-creation services lazily; the plugin stays usable without them. */
  _sessionDeps() {
    return this.deps.getSessionDeps()
  }

  /** List every persona file. */
  async list(request) {
    return this._guard('list', () => this._serialize(async () => {
      const dir = this.deps.personaDir
      const files = dir === '' ? [] : await this._listFiles(dir)
      return { files: files.map(summarizePersonaFile) }
    }, false))
  }

  /** Read one persona file including its body. */
  async read(request) {
    return this._guard('read', () => this._serialize(async () => {
      const req = asRequest(request)
      const id = this._requireId(req.id)
      const dir = await this._ensureDir()
      const file = await this._requireFile(dir, id)
      return { file: projectPersonaFile(file) }
    }))
  }

  /** Create or update one persona file. */
  async write(request) {
    return this._guard('write', () => this._serialize(async () => {
      const req = asRequest(request)
      if (req.id !== undefined && typeof req.id !== 'string') throw new PersonaError('invalid-id', 'id must be a string')
      if (req.name !== undefined && typeof req.name !== 'string') throw new PersonaError('invalid-name', 'name must be a string')
      if (req.enabled !== undefined && typeof req.enabled !== 'boolean') throw new PersonaError('invalid-enabled', 'enabled must be a boolean')
      if (req.description !== undefined && typeof req.description !== 'string') throw new PersonaError('invalid-description', 'description must be a string')
      if (req.emoji !== undefined && typeof req.emoji !== 'string') throw new PersonaError('invalid-emoji', 'emoji must be a string')
      const body = typeof req.body === 'string' ? req.body : ''
      if (body.trim() === '') throw new PersonaError('invalid-body', 'body must be a non-empty string')
      const dir = await this._ensureDir()
      const requestedId = typeof req.id === 'string' && req.id.trim() !== '' ? req.id.trim() : ''
      if (requestedId !== '' && !isSafeId(requestedId)) {
        throw new PersonaError('invalid-id', `id ${JSON.stringify(requestedId)} is not a safe file name`)
      }
      const existing = requestedId === '' ? undefined : await this._readIfExists(dir, requestedId)
      const requestedName = typeof req.name === 'string' ? req.name.trim() : ''
      if (requestedId === '' && requestedName === '') {
        throw new PersonaError('invalid-name', 'name is required when id is absent')
      }
      const id = requestedId !== '' ? requestedId : await this._uniqueId(dir, idFromName(requestedName) || 'persona')
      const slot = req.slot === undefined ? (existing?.slot ?? DEFAULT_SLOT) : this._requireSlot(req.slot)
      const order = req.order === undefined ? (existing?.order ?? DEFAULT_ORDER) : this._requireOrder(req.order)
      const sourceFormat = typeof req.sourceFormat === 'string' && SOURCE_FORMATS.includes(req.sourceFormat)
        ? req.sourceFormat
        : (existing?.sourceFormat ?? 'manual')
      const meta = {
        name: requestedName !== '' ? requestedName : (existing?.name ?? id),
        description: req.description === undefined ? (existing?.description ?? '') : String(req.description),
        slot,
        order,
        enabled: req.enabled === undefined ? (existing?.enabled ?? true) : req.enabled === true,
        sourceFormat,
        sourceFile: existing?.sourceFile ?? '',
        importedAt: existing?.importedAt ?? '',
        emoji: req.emoji === undefined ? (existing?.emoji ?? '') : String(req.emoji),
      }
      const path = join(dir, `${id}.md`)
      await this._writeAtomic(path, serializePersonaFile(meta, body, existing?.extra))
      const file = await readPersonaFile(dir, `${id}.md`)
      return { file: projectPersonaFile(file) }
    }))
  }

  /** Delete one persona file. */
  async remove(request) {
    return this._guard('remove', () => this._serialize(async () => {
      const req = asRequest(request)
      const id = this._requireId(req.id)
      const dir = await this._ensureDir()
      const existing = await this._readIfExists(dir, id)
      if (existing === undefined) throw new PersonaError('not-found', `no persona with id ${JSON.stringify(id)}`)
      await unlink(join(dir, `${id}.md`))
      return { ok: true, id }
    }))
  }

  /** Enable or disable one persona file. */
  async toggle(request) {
    return this._guard('toggle', () => this._serialize(async () => {
      const req = asRequest(request)
      const id = this._requireId(req.id)
      if (typeof req.enabled !== 'boolean') throw new PersonaError('invalid-enabled', 'enabled must be a boolean')
      const dir = await this._ensureDir()
      const existing = await this._requireFile(dir, id)
      const meta = { ...existing, enabled: req.enabled }
      await this._writeAtomic(join(dir, `${id}.md`), serializePersonaFile(meta, existing.body, existing.extra))
      const file = await readPersonaFile(dir, `${id}.md`)
      return { file: projectPersonaFile(file) }
    }))
  }

  /** Import persona files from an OpenClaw or Hermes Agent source. */
  async import(request) {
    return this._guard('import', () => this._serialize(async () => {
      const req = asRequest(request)
      const rawPath = typeof req.path === 'string' ? req.path.trim() : ''
      if (rawPath === '') throw new PersonaError('invalid-path', 'path is required')
      const target = resolve(rawPath)
      let info
      try {
        info = await stat(target)
      } catch (error) {
        if (error && error.code === 'ENOENT') throw new PersonaError('not-found', `no such file or directory: ${target}`)
        throw error
      }
      const forced = typeof req.format === 'string' && req.format !== '' ? req.format : ''
      const plan = info.isDirectory()
        ? await this._planDirectory(target, forced)
        : await this._planFile(target, forced)
      const dir = await this._ensureDir()
      const created = []
      for (const entry of plan.entries) {
        const id = await this._uniqueId(dir, idFromName(entry.name) || 'persona')
        const meta = importMeta(entry, entry.sourceFile)
        await this._writeAtomic(join(dir, `${id}.md`), serializePersonaFile(meta, entry.body))
        created.push({ id, slot: meta.slot, name: meta.name, enabled: meta.enabled })
      }
      return { ok: true, format: plan.format, created, skipped: plan.skipped, warnings: plan.warnings }
    }))
  }

  /** Compose every enabled persona file into one text. */
  async compose(request) {
    return this._guard('compose', () => this._serialize(() => this._compose(), false))
  }

  /**
   * Apply the composed text as a same-named Agent preset registered at runtime,
   * optionally overriding the shipped presets, and clear the deployment-level
   * persona that would otherwise reach every session (including AI-edit ones).
   */
  async apply(request) {
    return this._guard('apply', () => this._serialize(async () => {
      const req = asRequest(request)
      const composed = await this._compose()
      const text = composed.text
      if (text.trim() === '' && req.allowEmpty !== true) {
        throw new PersonaError('empty', 'no enabled persona text; pass allowEmpty to clear the applied persona')
      }
      if (req.force !== true && TEMPLATE_GROUP_PATTERN.test(text)) {
        throw new PersonaError(
          'template-groups',
          'the composed text contains {{...}} groups that the native persona template interpolates strictly; pass force to apply anyway',
        )
      }
      const editor = this.deps.getEditor()
      if (editor === undefined || editor === null) throw new PersonaError('no-editor', 'the configEditor service is unavailable in this profile')
      const registry = this._agentPresets()
      const overrideBuiltIn = await this._readOverrideSetting()
      const previousRecord = await this._readAppliedRecord()
      const previousDefinition = this.presetDefinitions.get(this.appliedPresetId)
      const clearing = text.trim() === ''
      let definition = null
      if (!clearing) {
        // Complete all validation before retiring a working preset.
        const template = this._presetTemplate(editor, PERSONA_PRESET_SOURCE_ROW)
        if (template === null) throw new PersonaError('no-template', 'the shipped standard preset template is unavailable')
        const primary = await this._primaryFile()
        definition = {
          id: await this._uniquePresetId(registry, primary.id),
          name: primary.name,
          description: `小星Bot 人格预设（${composed.count} 个设定文件）`,
          order: PERSONA_PRESET_ORDER,
          plugins: withPersonaPrefix(template.plugins, text),
        }
      }
      const plan = this._planApplication(editor, text, overrideBuiltIn && !clearing, previousRecord)
      if (plan.deploymentCleared && req.clearDeployment !== true) {
        throw new PersonaError('deployment-persona', 'applying requires clearing the deployment persona prefix and suffix; confirm with clearDeployment to keep AI editing free of user persona')
      }
      const attempted = []
      try {
        await this._disposeAppliedPreset()
        if (definition !== null) {
          await this._registerPreset(registry, definition)
          this.appliedPresetId = definition.id
        }
        for (const update of plan.updates) {
          if (this.closed) throw new PersonaError('disposed', 'the persona service was unloaded during apply')
          attempted.push(update)
          await this._editConfig(editor, update)
        }
        if (this.closed) throw new PersonaError('disposed', 'the persona service was unloaded before apply committed')
        // The snapshot is the last commit point: failed earlier steps preserve it.
        if (clearing) await this._removeAppliedRecord()
        else await this._writeAppliedRecord({
          version: 1,
          presetId: definition.id,
          name: definition.name,
          text,
          files: composed.used,
          overrideBuiltIn,
          builtInOriginals: plan.originals,
          appliedAt: nowIso(),
        })
        delete this.bootstrapErrors.applied
      } catch (error) {
        const rollbackErrors = await this._rollbackConfigs(editor, attempted)
        try {
          await this._disposeAppliedPreset()
          if (previousDefinition !== undefined && !this.closed) {
            await this._registerPreset(registry, previousDefinition)
            this.appliedPresetId = previousDefinition.id
          }
        } catch (rollbackError) {
          rollbackErrors.push(messageOf(rollbackError))
        }
        if (rollbackErrors.length > 0) throw new PersonaError('rollback-failed', `apply failed: ${messageOf(error)}; recovery also failed: ${rollbackErrors.join('; ')}; inspect the current preset and configuration before retrying`)
        throw error
      }
      return {
        ok: true,
        mode: 'preset',
        presetId: definition?.id ?? '',
        presetName: definition?.name ?? '',
        appliedPrefix: text,
        overrideBuiltIn,
        deploymentCleared: plan.deploymentCleared,
        overridden: plan.overridden,
        restored: plan.restored,
        skipped: plan.skipped,
        failures: [],
      }
    }))
  }

  /** Persist the override switch for shipped presets. */
  async setOverrideBuiltIn(request) {
    return this._guard('setOverrideBuiltIn', () => this._serialize(async () => {
      const req = asRequest(request)
      if (typeof req.enabled !== 'boolean') throw new PersonaError('invalid-enabled', 'enabled must be a boolean')
      await this._writeOverrideSetting(req.enabled)
      return { ok: true, overrideBuiltIn: req.enabled }
    }))
  }

  /** Report the applied preset, the override switch, and the persona directory. */
  async status(request) {
    return this._guard('status', () => this._serialize(async () => {
      const dir = this.deps.personaDir
      const files = dir === '' ? [] : await this._listFiles(dir)
      const editor = this.deps.getEditor()
      const registry = this.deps.getAgentPresets()
      const applied = await this._readAppliedRecord()
      const overrideBuiltIn = await this._readOverrideSetting()
      const appliedText = applied?.text ?? ''
      const rows = editor == null ? [] : editor.configuration()
      const builtInOverridden = appliedText !== '' && rows.some(row => {
        if (!BUILT_IN_PRESET_ROWS.includes(row?.entry?.options?.id)) return false
        const persona = rowConfig(row).plugins?.find(item => item?.name === PERSONA_PLUGIN_NAME)
        return persona?.config?.prefix === appliedText
      })
      const deployment = rows.find(row => row?.entry?.options?.id === SYSTEM_PROMPT_ENTRY_ID)
      const deploymentPersona = this._deploymentChange(deployment)?.text ?? ''
      let appliedAvailable = false
      let presetError = this.bootstrapErrors.applied ?? null
      let aiError = this.bootstrapErrors.ai ?? null
      if (registry != null && applied !== null && this.presetDisposers.has(applied.presetId)) {
        try { await this._checkPreset(registry, applied.presetId); appliedAvailable = true; presetError = null }
        catch (error) { presetError = { code: error.code ?? 'preset-failed', message: messageOf(error) } }
      }
      let aiAvailable = false
      if (registry != null && this.presetDisposers.has(AI_EDIT_PRESET_ID)) {
        try { await this._checkPreset(registry, AI_EDIT_PRESET_ID); aiAvailable = true; aiError = null }
        catch (error) { aiError = { code: error.code ?? 'preset-failed', message: messageOf(error) } }
      }
      const canApplyReason = dir === '' ? 'no-home' : editor == null ? 'no-editor' : registry == null ? 'no-registry'
        : this.initializationError?.code ?? (this._presetTemplate(editor, PERSONA_PRESET_SOURCE_ROW) === null ? 'no-template' : '')
      const canAiEditReason = dir === '' ? 'no-home' : this._sessionDeps().controller == null ? 'no-controller'
        : !aiAvailable ? (aiError?.code ?? 'preset-failed') : ''
      const enabled = files.filter(file => file.enabled && file.body.trim() !== '')
      const needsApply = enabled.map(file => file.body.trim()).join('\n\n') !== appliedText
        || (applied !== null && (enabled[0]?.name !== applied.name || !isDeepStrictEqual(enabled.map(file => file.id), applied.files)
          || applied.overrideBuiltIn !== overrideBuiltIn))
      return {
        mode: 'preset',
        personaDir: dir,
        files: files.length,
        enabledFiles: files.filter(file => file.enabled).length,
        applied: applied === null ? null : {
          presetId: applied.presetId,
          name: applied.name,
          chars: appliedText.length,
          files: applied.files,
          overrideBuiltIn: applied.overrideBuiltIn === true,
          appliedAt: applied.appliedAt,
          available: appliedAvailable,
        },
        appliedText,
        overrideBuiltIn,
        builtInOverridden,
        deploymentPersona,
        canApply: canApplyReason === '',
        canApplyReason,
        canAiEdit: canAiEditReason === '',
        canAiEditReason,
        needsApply,
        starterCreated: this.initialization?.createdDefault === true && files.some(file => file.id === DEFAULT_PERSONA_ID),
        initializationError: this.initializationError,
        presetError,
      }
    }, false))
  }

  /**
   * Open one clean Session whose first message carries the saved persona, the
   * storage format contract, creative guidance, and the edit workflow, so the
   * session's agent revises the file with the `persona_manager` tool.
   */
  async aiEdit(request) {
    return this._guard('aiEdit', () => this._serialize(async () => {
      const req = asRequest(request)
      const id = typeof req.id === 'string' && req.id.trim() !== '' ? this._requireId(req.id) : ''
      const instruction = typeof req.instruction === 'string' ? req.instruction.trim() : ''
      let file = undefined
      if (id !== '') {
        const dir = await this._ensureDir()
        file = await this._requireFile(dir, id)
      }
      const controller = this._sessionDeps().controller
      if (controller === undefined || controller === null) {
        throw new PersonaError('no-controller', 'the sessionController service is unavailable in this profile')
      }
      const registry = this._agentPresets()
      if (!this.presetDisposers.has(AI_EDIT_PRESET_ID)) throw new PersonaError('preset-failed', 'the clean AI editing preset is not available')
      await this._checkPreset(registry, AI_EDIT_PRESET_ID)
      const sessionId = `session-${randomUUID()}`
      let created
      try {
        created = await controller.create({
          sessionId,
          agentPreset: AI_EDIT_PRESET_ID,
          ...this._defaultWorkspaceRequest(),
        })
      } catch (error) {
        throw new PersonaError('agent-failed', `could not create the clean AI editing session: ${messageOf(error)}`)
      }
      const resolved = await controller.resolveAgent(created.sessionId)
      if (resolved === null || typeof resolved !== 'object' || !('agent' in resolved)) {
        const detail = resolved !== null && typeof resolved === 'object' && 'error' in resolved ? messageOf(resolved.error) : 'unknown failure'
        throw new PersonaError('agent-failed', `could not activate the new session: ${detail}`)
      }
      const agent = resolved.agent
      const message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: file === undefined ? buildAiCreatePrompt(instruction) : buildAiEditPrompt(file, instruction) }],
        source: { kind: 'xiaoxing-persona' },
      }
      agent.followup(message)
      const sessions = this._sessionDeps().sessions
      if (sessions !== undefined && sessions !== null) {
        try {
          await sessions.flush(agent.session)
        } catch (error) {
          throw new PersonaError('flush-failed', `could not flush the AI editing session: ${messageOf(error)}`)
        }
      }
      return { ok: true, sessionId: created.sessionId }
    }))
  }

  /** First registered Workspace id, so the created Session joins the sidebar; omitted when none. */
  _defaultWorkspaceRequest() {
    try {
      const registry = this._sessionDeps().registry
      const list = registry === undefined || registry === null ? [] : registry.list()
      return Array.isArray(list) && list.length > 0 && list[0] !== null && typeof list[0] === 'object' && list[0].id !== undefined
        ? { workspaceId: list[0].id }
        : {}
    } catch {
      return {}
    }
  }

  /** Initialize the data directory without applying or replacing any persona. */
  initialize() {
    return this._serialize(() => this.initialization).catch(error => {
      this.initializationError = { code: error.code ?? 'initialization-failed', message: messageOf(error) }
      throw error
    })
  }

  /** Seed the starter only once, and only when no previous data exists. */
  async _initializeOnce() {
    if (this.initialized) return
    const dir = await this._ensureDir()
    const marker = await this._readJson(INITIALIZED_FILENAME, null)
    if (marker !== null) {
      if (marker === null || typeof marker !== 'object' || marker.version !== 1 || typeof marker.createdDefault !== 'boolean') {
        throw new PersonaError('invalid-state', 'invalid initialization record; preserve it and repair the data directory before continuing')
      }
      this.initialization = marker
      this.initialized = true
      this.initializationError = null
      return
    }
    const names = await readdir(dir)
    const existing = names.length > 0
    let createdDefault = false
    if (!existing) {
      const template = await readFile(DEFAULT_PERSONA_URL, 'utf8')
      try {
        await writeFile(join(dir, `${DEFAULT_PERSONA_ID}.md`), template, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        createdDefault = true
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
    }
    const record = { version: 1, createdDefault, defaultPersonaId: DEFAULT_PERSONA_ID }
    await this._writeJson(INITIALIZED_FILENAME, record)
    this.initialization = record
    this.initialized = true
    this.initializationError = null
  }

  /** Serialize startup, user operations and preset recovery in one lifecycle. */
  _serialize(task, initialize = true) {
    const run = this.queue.then(async () => {
      if (this.closed) throw new PersonaError('disposed', 'the persona service was unloaded; reopen the settings page after reload')
      if (initialize) await this._initializeOnce()
      return task()
    })
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Map business failures to the Remote result envelope instead of throwing. */
  async _guard(name, run) {
    try {
      return await run()
    } catch (error) {
      if (error instanceof PersonaError) return { ok: false, code: error.code, message: error.message }
      return { ok: false, code: 'internal', message: `persona ${name} failed: ${messageOf(error)}` }
    }
  }

  /** Resolve the persona directory, creating it on first use. */
  async _ensureDir() {
    const dir = this.deps.personaDir
    if (dir === '') {
      throw new PersonaError('no-home', 'personaDir is unset and DSH_HOME is not available; set personaDir in the plugin config')
    }
    await mkdir(dir, { recursive: true })
    return dir
  }

  /** Read every persona file in one directory, sorted for composition. */
  async _listFiles(dir) {
    let names
    try {
      names = await readdir(dir)
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }
    const files = []
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.md')) continue
      try {
        files.push(await readPersonaFile(dir, name))
      } catch (error) {
        if (error && error.code === 'ENOENT') continue
        throw error
      }
    }
    return files.sort(comparePersonaFiles)
  }

  /** Read one persona file, or undefined when it does not exist. */
  async _readIfExists(dir, id) {
    try {
      return await readPersonaFile(dir, `${id}.md`)
    } catch (error) {
      if (error && error.code === 'ENOENT') return undefined
      throw error
    }
  }

  /** Read one persona file or fail with `not-found`. */
  async _requireFile(dir, id) {
    const file = await this._readIfExists(dir, id)
    if (file === undefined) throw new PersonaError('not-found', `no persona with id ${JSON.stringify(id)}`)
    return file
  }

  /** Whether one id is already taken in the directory. */
  async _exists(dir, id) {
    try {
      await stat(join(dir, `${id}.md`))
      return true
    } catch (error) {
      if (error && error.code === 'ENOENT') return false
      throw error
    }
  }

  /** First free id derived from `base`. */
  async _uniqueId(dir, base) {
    const root = base === '' ? 'persona' : base
    let candidate = root
    let suffix = 2
    while (await this._exists(dir, candidate)) {
      const ending = `-${suffix}`
      candidate = `${root.slice(0, MAX_ID_LENGTH - ending.length)}${ending}`
      suffix += 1
    }
    return candidate
  }

  /** Replace one file atomically: write a sibling temporary file, then rename. */
  async _writeAtomic(path, content) {
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
    try {
      try {
        const existing = await lstat(path)
        if (!existing.isFile() || existing.isSymbolicLink()) throw new PersonaError('unsafe-file', 'refusing to replace a link or directory with persona data')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }

  /** Validate a caller-supplied id. */
  _requireId(value) {
    if (!isSafeId(value)) throw new PersonaError('invalid-id', 'id must be a non-empty safe file name')
    return value
  }

  /** Validate a caller-supplied slot. */
  _requireSlot(value) {
    if (typeof value !== 'string' || !Object.hasOwn(SLOT_ORDER, value)) {
      throw new PersonaError('invalid-slot', `slot must be one of ${Object.keys(SLOT_ORDER).join(', ')}`)
    }
    return value
  }

  /** Validate a caller-supplied order. */
  _requireOrder(value) {
    const order = Number(value)
    if (!Number.isFinite(order) || !Number.isInteger(order)) throw new PersonaError('invalid-order', 'order must be a finite integer')
    return order
  }

  /** Read the addressable config rows, tolerating a missing editor. */
  _editorEntries(editor) {
    try {
      const entries = editor.entries()
      return Array.isArray(entries) ? entries : []
    } catch {
      return []
    }
  }

  /** Read the persona text a row currently carries. */
  _appliedPrefix(editor, mode, entryId) {
    let rows
    try {
      rows = editor.configuration()
    } catch {
      return ''
    }
    if (!Array.isArray(rows)) return ''
    const row = rows.find(item => item?.entry?.options?.id === entryId)
    if (row === undefined) return ''
    const config = rowConfig(row)
    if (mode === 'preset') {
      const plugins = Array.isArray(config.plugins) ? config.plugins : []
      const persona = plugins.find(item => item !== null && typeof item === 'object' && item.name === PERSONA_PLUGIN_NAME)
      return typeof persona?.config?.prefix === 'string' ? persona.config.prefix : ''
    }
    return typeof config.personaPrefix === 'string' ? config.personaPrefix : ''
  }

  /** Compose the enabled persona bodies. */
  async _compose() {
    const dir = this.deps.personaDir
    const files = dir === '' ? [] : await this._listFiles(dir)
    const enabled = files.filter(file => file.enabled)
    const used = []
    const bodies = []
    for (const file of enabled) {
      const body = file.body.trim()
      if (body === '') continue
      used.push(file.id)
      bodies.push(body)
    }
    return { text: bodies.join('\n\n'), used, count: used.length }
  }

  /** The agent preset registry, or a typed failure when unavailable. */
  _agentPresets() {
    const registry = this.deps.getAgentPresets()
    if (registry === undefined || registry === null || typeof registry.register !== 'function') {
      throw new PersonaError('no-registry', 'the agentPresets service is unavailable in this profile')
    }
    return registry
  }

  /** The first enabled persona file with text; names the applied preset. */
  async _primaryFile() {
    const dir = this.deps.personaDir
    const files = dir === '' ? [] : await this._listFiles(dir)
    for (const file of files) {
      if (file.enabled && file.body.trim() !== '') return { id: file.id, name: file.name }
    }
    throw new PersonaError('empty', 'no enabled persona text')
  }

  /** One free preset id derived from a persona file id, avoiding roster clashes. */
  async _uniquePresetId(registry, fileId) {
    const rows = await registry.list()
    const taken = rows.map(row => String(row?.id ?? '')).filter(id =>
      !(id === this.appliedPresetId && this.presetDisposers.has(id)))
    const base = isSafeId(fileId) ? fileId : 'persona'
    let candidate = base
    let suffix = 2
    while (taken.includes(candidate)) {
      candidate = `${base}-persona-${suffix}`
      suffix += 1
    }
    return candidate
  }

  /** The evaluated inherited config of one profile preset row, or null. */
  _presetTemplate(editor, entryId) {
    let rows
    try {
      rows = editor.configuration()
    } catch {
      return null
    }
    if (!Array.isArray(rows)) return null
    const row = rows.find(item => item?.entry?.options?.id === entryId)
    const inherited = row?.inherited
    if (inherited === null || typeof inherited !== 'object' || !Array.isArray(inherited.plugins)) return null
    return structuredClone(inherited)
  }

  /** Plan narrowly owned native changes, preserving unrelated user settings. */
  _planApplication(editor, text, override, previousRecord) {
    const rows = editor.configuration()
    if (!Array.isArray(rows)) throw new PersonaError('no-editor', 'the configuration directory is unavailable')
    const updates = []
    const overridden = []
    const restored = []
    const skipped = []
    const originals = {}
    const saved = previousRecord?.builtInOriginals ?? {}
    for (const row of rows) {
      const id = row?.entry?.options?.id
      if (!BUILT_IN_PRESET_ROWS.includes(id) || row?.entry?.options?.name !== AGENT_PRESET_NAME) continue
      const before = structuredClone(rowConfig(row))
      const plugins = Array.isArray(before.plugins) ? before.plugins : []
      const persona = plugins.find(item => item?.name === PERSONA_PLUGIN_NAME)
      if (persona === undefined) continue
      let after
      if (override) {
        // Keep the pre-override persona, even across repeated applications.
        const stillOwned = previousRecord?.overrideBuiltIn === true && persona.config?.prefix === previousRecord.text
        const inheritedPersona = row.inherited?.plugins?.find(item => item?.name === PERSONA_PLUGIN_NAME)
        // Legacy snapshots have no original baseline: use the shipped persona,
        // never preserve this plugin's own old override as the original.
        originals[id] = structuredClone(stillOwned ? (saved[id] ?? inheritedPersona?.config ?? persona.config ?? {}) : (persona.config ?? {}))
        after = { ...before, plugins: withPersonaPrefix(plugins, text) }
        overridden.push(id)
      } else if (previousRecord?.overrideBuiltIn === true && persona.config?.prefix === previousRecord.text) {
        const inheritedPersona = row.inherited?.plugins?.find(item => item?.name === PERSONA_PLUGIN_NAME)
        const original = saved[id] ?? inheritedPersona?.config
        if (original === undefined) { skipped.push(id); continue }
        const restoredConfig = { ...(persona.config ?? {}) }
        if (Object.hasOwn(original, 'prefix')) restoredConfig.prefix = structuredClone(original.prefix)
        else delete restoredConfig.prefix
        after = {
          ...before,
          plugins: plugins.map(item => item?.name === PERSONA_PLUGIN_NAME
            ? { ...item, config: restoredConfig } : item),
        }
        restored.push(id)
      } else {
        // No owned override, or the user changed it elsewhere: do not touch it.
        if (previousRecord?.overrideBuiltIn === true) skipped.push(id)
        continue
      }
      if (!isDeepStrictEqual(before, after)) updates.push({ id, before, after })
    }
    const deployment = rows.find(row => row?.entry?.options?.id === SYSTEM_PROMPT_ENTRY_ID)
    const change = this._deploymentChange(deployment)
    if (change !== null) updates.push({ id: SYSTEM_PROMPT_ENTRY_ID, before: change.before, after: change.after })
    return { updates, originals, overridden, restored, skipped, deploymentCleared: change !== null }
  }

  /** Remove only user-added deployment persona; keep the shipped base prompt. */
  _deploymentChange(row) {
    if (row === undefined) return null
    const before = structuredClone(rowConfig(row))
    const inherited = row.inherited ?? {}
    const after = { ...before }
    const texts = []
    for (const key of ['personaPrefix', 'personaSuffix']) {
      if (typeof before[key] !== 'string' || before[key] === '' || isDeepStrictEqual(before[key], inherited[key])) continue
      texts.push(before[key])
      if (Object.hasOwn(inherited, key)) after[key] = structuredClone(inherited[key])
      else delete after[key]
    }
    return texts.length === 0 ? null : { before, after, text: texts.join('\n') }
  }

  /** Re-read the entry at the mutation point; reject a superseded snapshot. */
  async _editConfig(editor, update) {
    const entry = editor.entries().find(candidate => candidate?.options?.id === update.id)
    if (entry === undefined) throw new PersonaError('config-changed', `configuration entry disappeared: ${update.id}`)
    try {
      await editor.edit(entry, current => {
        if (!isDeepStrictEqual(current, update.before)) throw new PersonaError('config-changed', `configuration changed during apply: ${update.id}`)
        return structuredClone(update.after)
      })
    } catch (error) {
      if (/overridden.*(?:home patch|command.line overlay)/iu.test(messageOf(error))) {
        throw new PersonaError('config-authority', 'this setting is controlled by a home patch or command-line overlay; change that source instead of the profile override')
      }
      throw error
    }
  }

  /** Roll back only configurations still equal to this operation's output. */
  async _rollbackConfigs(editor, attempted) {
    const errors = []
    for (const update of [...attempted].reverse()) {
      try {
        const entry = editor.entries().find(candidate => candidate?.options?.id === update.id)
        if (entry === undefined) throw new Error(`entry disappeared: ${update.id}`)
        const row = editor.configuration().find(candidate => candidate?.entry?.options?.id === update.id)
        if (row !== undefined && isDeepStrictEqual(rowConfig(row), update.before)) continue
        await editor.edit(entry, current => {
          if (isDeepStrictEqual(current, update.before)) return current
          if (!isDeepStrictEqual(current, update.after)) throw new Error(`entry was edited elsewhere: ${update.id}`)
          return structuredClone(update.before)
        })
      } catch (error) {
        errors.push(messageOf(error))
      }
    }
    return errors
  }

  /** Retire the applied preset registered by this service. */
  async _disposeAppliedPreset() {
    const presetId = this.appliedPresetId
    if (presetId === '') return
    const disposer = this.presetDisposers.get(presetId)
    if (disposer !== undefined) await disposer()
    this.presetDisposers.delete(presetId)
    this.presetDefinitions.delete(presetId)
    this.appliedPresetId = ''
  }

  /** JSON helper: read one file below the persona directory, or undefined. */
  async _readJson(fileName, fallback) {
    const dir = this.deps.personaDir
    if (dir === '') return fallback
    try {
      const path = join(dir, fileName)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw new PersonaError('unsafe-file', `state file must be a regular file: ${fileName}`)
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return fallback
      if (error instanceof SyntaxError) throw new PersonaError('invalid-state', `invalid JSON in ${fileName}; the file was not overwritten`)
      throw error
    }
  }

  /** JSON helper: write one file below the persona directory atomically. */
  async _writeJson(fileName, value) {
    const dir = await this._ensureDir()
    await this._writeAtomic(join(dir, fileName), `${JSON.stringify(value, null, 2)}\n`)
  }

  /** JSON helper: remove one file below the persona directory when present. */
  async _removeJson(fileName) {
    const dir = this.deps.personaDir
    if (dir === '') return
    await unlink(join(dir, fileName)).catch(error => {
      if (error && error.code !== 'ENOENT') throw error
    })
  }

  /** The persisted override switch for shipped presets. */
  async _readOverrideSetting() {
    const settings = await this._readJson(SETTINGS_FILENAME, {})
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)
      || (settings.overrideBuiltInPresets !== undefined && typeof settings.overrideBuiltInPresets !== 'boolean')) {
      throw new PersonaError('invalid-state', 'invalid override settings; the settings file was not overwritten')
    }
    return settings.overrideBuiltInPresets === true
  }

  /** Persist the override switch for shipped presets. */
  async _writeOverrideSetting(enabled) {
    const settings = await this._readJson(SETTINGS_FILENAME, {})
    const base = settings !== null && typeof settings === 'object' ? settings : {}
    await this._writeJson(SETTINGS_FILENAME, { ...base, overrideBuiltInPresets: enabled === true })
  }

  /** The persisted apply record, or null. */
  async _readAppliedRecord() {
    const record = await this._readJson(APPLIED_FILENAME, null)
    if (record === null) return null
    if (typeof record !== 'object' || Array.isArray(record)
      || (record.version !== undefined && record.version !== 1)
      || typeof record.presetId !== 'string' || record.presetId === ''
      || typeof record.name !== 'string' || typeof record.text !== 'string' || record.text.trim() === ''
      || !Array.isArray(record.files) || record.files.some(id => typeof id !== 'string')
      || typeof record.appliedAt !== 'string'
      || (record.overrideBuiltIn !== undefined && typeof record.overrideBuiltIn !== 'boolean')
      || (record.builtInOriginals !== undefined && (record.builtInOriginals === null || typeof record.builtInOriginals !== 'object' || Array.isArray(record.builtInOriginals)))) {
      throw new PersonaError('invalid-state', 'invalid applied persona snapshot; preserve it and repair it before applying again')
    }
    return record
  }

  /** Persist the apply record. */
  async _writeAppliedRecord(record) {
    await this._writeJson(APPLIED_FILENAME, record)
  }

  /** Remove the apply record. */
  async _removeAppliedRecord() {
    await this._removeJson(APPLIED_FILENAME)
  }

  /**
   * Register the AI-edit preset and restore the applied preset after a Host
   * restart. Both templates come from the shipped rows' evaluated inherited
   * config, so they follow DSH upgrades without a hardcoded plugin list.
   */
  bootstrapPresets() {
    return this._serialize(async () => {
      const editor = this.deps.getEditor()
      const registry = this._agentPresets()
      try {
        const template = editor == null ? null : this._presetTemplate(editor, AI_EDIT_PRESET_SOURCE_ROW)
        if (template === null) throw new PersonaError('no-template', 'the minimal preset template is unavailable for AI editing')
        await this._registerPreset(registry, {
          id: AI_EDIT_PRESET_ID,
          name: AI_EDIT_PRESET_NAME,
          description: 'Persona editing / 人格编辑（不带用户人设）',
          order: PERSONA_PRESET_ORDER + 1,
          plugins: template.plugins,
        }, false)
        delete this.bootstrapErrors.ai
      } catch (error) {
        this.bootstrapErrors.ai = { code: error.code ?? 'preset-failed', message: messageOf(error) }
        this.deps.log(`AI preset bootstrap failed: ${messageOf(error)}`)
      }
      try {
        const applied = await this._readAppliedRecord()
        if (applied === null) return
        const template = editor == null ? null : this._presetTemplate(editor, PERSONA_PRESET_SOURCE_ROW)
        if (template === null) throw new PersonaError('no-template', 'the standard preset template is unavailable for recovery')
        await this._registerPreset(registry, {
          id: applied.presetId,
          name: applied.name,
          description: 'Xiaoxing persona / 小星人格',
          order: PERSONA_PRESET_ORDER,
          plugins: withPersonaPrefix(template.plugins, applied.text),
        }, false)
        this.appliedPresetId = applied.presetId
        delete this.bootstrapErrors.applied
      } catch (error) {
        this.bootstrapErrors.applied = { code: error.code ?? 'preset-failed', message: messageOf(error) }
        this.deps.log(`persona preset recovery failed: ${messageOf(error)}`)
      }
    }, false).catch(error => {
      if (!this.closed) {
        this.bootstrapErrors.applied = { code: error.code ?? 'preset-failed', message: messageOf(error) }
        this.deps.log(`persona preset bootstrap failed: ${messageOf(error)}`)
      }
    })
  }

  /** A registered preset can still be broken; check it on user operations. */
  async _checkPreset(registry, id) {
    const preset = await registry.resolve(id)
    if (preset.broken !== undefined && preset.broken !== null) throw new PersonaError('preset-failed', `preset ${id} cannot load: ${preset.broken}`)
    return preset
  }

  /** Register only owned revisions and release late registrations on unload. */
  async _registerPreset(registry, definition, verify = true) {
    if (this.closed) throw new PersonaError('disposed', 'the persona service was unloaded')
    const previous = this.presetDefinitions.get(definition.id)
    const existing = this.presetDisposers.get(definition.id)
    if (existing !== undefined && isDeepStrictEqual(previous, definition)) {
      if (verify) await this._checkPreset(registry, definition.id)
      return existing
    }
    if (existing !== undefined) {
      await existing()
      this.presetDisposers.delete(definition.id)
      this.presetDefinitions.delete(definition.id)
    }
    let disposer
    try {
      disposer = await registry.register(definition)
      if (this.closed) throw new PersonaError('disposed', 'the persona service was unloaded during preset registration')
      if (verify) await this._checkPreset(registry, definition.id)
      this.presetDisposers.set(definition.id, disposer)
      this.presetDefinitions.set(definition.id, structuredClone(definition))
      return disposer
    } catch (error) {
      if (disposer !== undefined) await disposer()
      if (previous !== undefined && !this.closed) await this._registerPreset(registry, previous, verify)
      throw error
    }
  }

  /** Stop admission, wait for in-flight work, then await every owned disposer. */
  disposePresets() {
    if (this.closeTask !== undefined) return this.closeTask
    this.closed = true
    this.closeTask = this.queue.then(async () => {
      const errors = []
      for (const [id, disposer] of this.presetDisposers) {
        try {
          await disposer()
          this.presetDisposers.delete(id)
          this.presetDefinitions.delete(id)
        } catch (error) {
          errors.push(`${id}: ${messageOf(error)}`)
        }
      }
      this.appliedPresetId = ''
      if (errors.length > 0) throw new PersonaError('preset-failed', `preset cleanup failed: ${errors.join('; ')}`)
    })
    return this.closeTask
  }

  /** Plan an import from one directory. */
  async _planDirectory(target, forced) {
    const names = await readdir(target)
    const lower = new Map(names.map(name => [name.toLowerCase(), name]))
    const format = forced !== ''
      ? forced
      : lower.has('distribution.yaml')
        ? 'hermes-profile-distribution'
        : lower.has('soul.md') ? 'openclaw-workspace' : ''
    if (format === 'hermes-profile-distribution') return this._planProfileDistribution(target, names, lower)
    if (format === 'openclaw-workspace') return this._planOpenclawWorkspace(target, names, lower)
    if (format === 'hermes-soul') {
      const soul = lower.get('soul.md')
      if (soul === undefined) throw new PersonaError('not-found', `no SOUL.md in ${target}`)
      const plan = await this._planHermesSoul(join(target, soul), target)
      return { ...plan, skipped: names.filter(name => name !== soul).map(name => ({ file: name, reason: 'not part of a Hermes SOUL import' })) }
    }
    throw new PersonaError(
      'unsupported-directory',
      `cannot recognize ${target}: expected distribution.yaml or SOUL.md, or pass format explicitly`,
    )
  }

  /** Plan an import from one file. */
  async _planFile(target, forced) {
    const name = basename(target)
    const lower = name.toLowerCase()
    const format = forced !== ''
      ? forced
      : lower === 'soul.md'
        ? 'hermes-soul'
        : lower.endsWith('.yaml') || lower.endsWith('.yml')
          ? 'hermes-config'
          : lower.endsWith('.md') ? 'markdown' : ''
    if (format === 'hermes-soul') return this._planHermesSoul(target, undefined)
    if (format === 'hermes-config' || format === 'hermes-personality-preset') return this._planHermesConfig(target)
    if (format === 'markdown') return this._planMarkdownFile(target)
    throw new PersonaError('unsupported', `cannot import ${target}: expected SOUL.md, a YAML config, or Markdown`)
  }

  /** Plan an OpenClaw workspace import. */
  async _planOpenclawWorkspace(target, names, lower) {
    const entries = []
    const skipped = []
    const warnings = []
    const soul = lower.get('soul.md')
    const identity = lower.get('identity.md')
    const agents = lower.get('agents.md')
    const consumed = new Set()
    if (soul !== undefined) {
      const source = join(target, soul)
      const body = await this._readImportFile(source)
      entries.push({
        name: basename(target),
        description: 'OpenClaw SOUL document',
        slot: 'voice',
        enabled: true,
        sourceFormat: 'openclaw-workspace',
        sourceFile: source,
        body,
      })
      warnings.push(...scanInjectionPatterns(source, body))
      consumed.add(soul)
    }
    if (identity !== undefined) {
      const source = join(target, identity)
      const body = await this._readImportFile(source)
      const fields = parseIdentityFields(body)
      const description = [fields.vibe, fields.creature].filter(value => typeof value === 'string' && value !== '').join(' · ')
      entries.push({
        name: fields.name ?? basename(target),
        description,
        slot: 'identity',
        enabled: true,
        emoji: fields.emoji ?? '',
        sourceFormat: 'openclaw-workspace',
        sourceFile: source,
        body,
      })
      warnings.push(...scanInjectionPatterns(source, body))
      consumed.add(identity)
    }
    if (agents !== undefined) {
      const source = join(target, agents)
      const body = await this._readImportFile(source)
      entries.push({
        name: `${basename(target)} agents`,
        description: 'OpenClaw AGENTS document (behavior rules, imported disabled)',
        slot: 'instructions',
        enabled: false,
        sourceFormat: 'openclaw-workspace',
        sourceFile: source,
        body,
      })
      warnings.push(...scanInjectionPatterns(source, body))
      consumed.add(agents)
    }
    const reasons = new Map([
      ['user.md', 'user profile is not imported'],
      ['bootstrap.md', 'bootstrap notes are not a persona document'],
      ['memory.md', 'memory notes are not a persona document'],
      ['openclaw.json', 'runtime configuration is not imported'],
      ['memory', 'memory directory is not imported'],
      ['skills', 'skills directory is not imported'],
      ['distribution.yaml', 'profile distribution metadata is not imported'],
    ])
    for (const name of names) {
      if (consumed.has(name)) continue
      skipped.push({ file: name, reason: reasons.get(name.toLowerCase()) ?? 'unrecognized file' })
    }
    return { format: 'openclaw-workspace', entries, skipped, warnings }
  }

  /** Plan a Hermes profile distribution import. */
  async _planProfileDistribution(target, names, lower) {
    const entries = []
    const skipped = []
    const warnings = []
    const distributionName = lower.get('distribution.yaml')
    let metadata = {}
    if (distributionName !== undefined) {
      const source = join(target, distributionName)
      const parsed = parseYamlSubset(await this._readImportFile(source))
      if (!parsed.ok) throw new PersonaError('yaml-invalid', `${source}:${parsed.line}: ${parsed.message}`)
      metadata = parsed.value
    }
    const soul = lower.get('soul.md')
    const consumed = new Set()
    if (soul !== undefined) {
      const source = join(target, soul)
      const body = await this._readImportFile(source)
      const label = typeof metadata.name === 'string' && metadata.name !== '' ? metadata.name : basename(target)
      const version = typeof metadata.version === 'string' ? metadata.version : ''
      entries.push({
        name: label,
        description: typeof metadata.description === 'string' && metadata.description !== ''
          ? metadata.description
          : `Hermes profile distribution${version === '' ? '' : ` ${version}`}`,
        slot: 'voice',
        enabled: true,
        sourceFormat: 'hermes-profile-distribution',
        sourceFile: source,
        body,
      })
      warnings.push(...scanInjectionPatterns(source, body))
      consumed.add(soul)
    }
    if (distributionName !== undefined) consumed.add(distributionName)
    for (const name of names) {
      if (consumed.has(name)) continue
      skipped.push({ file: name, reason: 'not part of a Hermes profile distribution import' })
    }
    if (entries.length === 0) throw new PersonaError('unsupported', `${target} holds no SOUL.md to import`)
    return { format: 'hermes-profile-distribution', entries, skipped, warnings }
  }

  /** Plan a Hermes SOUL.md import. */
  async _planHermesSoul(source, directory) {
    const body = await this._readImportFile(source)
    const parent = directory ?? dirname(source)
    const name = basename(parent)
    return {
      format: 'hermes-soul',
      entries: [{
        name,
        description: 'Hermes SOUL document',
        slot: 'voice',
        enabled: true,
        sourceFormat: 'hermes-soul',
        sourceFile: source,
        body,
      }],
      skipped: [],
      warnings: scanInjectionPatterns(source, body),
    }
  }

  /** Plan a Hermes `config.yaml` import. */
  async _planHermesConfig(source) {
    const text = await this._readImportFile(source)
    const parsed = parseYamlSubset(text)
    if (!parsed.ok) throw new PersonaError('yaml-invalid', `${source}:${parsed.line}: ${parsed.message}`)
    const root = parsed.value
    const agent = root.agent !== null && typeof root.agent === 'object' ? root.agent : {}
    const personalities = agent.personalities !== null && typeof agent.personalities === 'object' ? agent.personalities : {}
    const display = agent.display !== null && typeof agent.display === 'object'
      ? agent.display
      : root.display !== null && typeof root.display === 'object' ? root.display : {}
    const selected = typeof display.personality === 'string' ? display.personality : ''
    const entries = []
    const warnings = []
    for (const [key, value] of Object.entries(personalities)) {
      const body = typeof value === 'string' ? value : JSON.stringify(value)
      if (body.trim() === '') continue
      entries.push({
        name: key,
        description: `Hermes personality preset: ${key}`,
        slot: 'personality',
        enabled: selected === key,
        sourceFormat: 'hermes-personality-preset',
        sourceFile: source,
        body,
      })
      warnings.push(...scanInjectionPatterns(source, body))
    }
    const systemPrompt = typeof agent.system_prompt === 'string' ? agent.system_prompt : ''
    if (systemPrompt.trim() !== '') {
      entries.push({
        name: `${basename(source, extname(source))} system prompt`,
        description: 'Hermes agent system prompt (imported disabled)',
        slot: 'instructions',
        enabled: false,
        sourceFormat: 'hermes-personality-preset',
        sourceFile: source,
        body: systemPrompt,
      })
      warnings.push(...scanInjectionPatterns(source, systemPrompt))
    }
    if (entries.length === 0) {
      throw new PersonaError('unsupported', `${source} declares no agent.personalities entry and no agent.system_prompt`)
    }
    return { format: 'hermes-config', entries, skipped: [], warnings }
  }

  /** Plan a generic Markdown import. */
  async _planMarkdownFile(source) {
    const body = await this._readImportFile(source)
    const heading = firstHeading(body)
    const name = heading !== '' ? heading : basename(source, extname(source))
    return {
      format: 'markdown',
      entries: [{
        name,
        description: `Imported from ${basename(source)}`,
        slot: 'voice',
        enabled: true,
        sourceFormat: 'markdown',
        sourceFile: source,
        body,
      }],
      skipped: [],
      warnings: scanInjectionPatterns(source, body),
    }
  }
}

/** Effective config of one `configuration()` row. */
function rowConfig(row) {
  const own = row?.entry?.options?.config
  if (own !== null && typeof own === 'object' && Object.keys(own).length > 0) return own
  const inherited = row?.inherited !== null && typeof row?.inherited === 'object' ? row.inherited : {}
  const override = row?.override !== null && typeof row?.override === 'object' ? row.override : {}
  return { ...inherited, ...override }
}

Object.defineProperty(PersonaService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze(REMOTE_METHODS.map(method => Object.freeze({
      method,
      invocation: Object.freeze({ kind: 'direct' }),
      ...(REMOTE_EXPORT_NAMES[method] === undefined ? {} : { exportName: REMOTE_EXPORT_NAMES[method] }),
    }))),
  }),
})

/** Tool result envelope: `data` is omitted when the action has none. */
function toolResult(ok, summary, data) {
  return data === undefined ? { ok, summary } : { ok, summary, data }
}

/** Map one service failure to a tool result. */
function toolFailure(result) {
  return toolResult(false, `persona_manager: ${result.code}: ${result.message}`)
}

/** Whether a service answer is its failure envelope. */
function isFailure(result) {
  return result !== null && typeof result === 'object' && result.ok === false
}

/** Build the `persona_manager` tool definition. */
function createPersonaTool(service) {
  return {
    name: 'persona_manager',
    description: 'Manage XiaoxingBot persona files: status, list, read, write, toggle, remove, import OpenClaw/Hermes setups, compose enabled text, and apply a same-named Agent preset. Applying does not switch existing sessions or the default mode; it may update the four shipped personas when the user has enabled that override in settings. Inspect status and compose before applying. 管理人设文件、导入与组合，应用为同名 Agent 预设；不会自动切换会话。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'list', 'read', 'write', 'remove', 'toggle', 'import', 'compose', 'apply'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Persona file id (file name without the .md extension).' },
        name: { type: 'string', description: 'Display name; a new file id is derived from it when id is absent.' },
        description: { type: 'string', description: 'Short description stored in the frontmatter.' },
        body: { type: 'string', description: 'Persona text for write; required and must not be empty.' },
        slot: {
          type: 'string',
          enum: ['identity', 'voice', 'instructions', 'personality'],
          description: 'Composition slot; defaults to voice.',
        },
        order: { type: 'integer', description: 'Order inside the slot; defaults to 100.' },
        enabled: { type: 'boolean', description: 'Whether the file takes part in composition.' },
        emoji: { type: 'string', description: 'Optional emoji stored in the frontmatter.' },
        path: { type: 'string', description: 'For import: a persona file/directory inside the requesting session workspace or persona directory. Use the settings page for external sources.' },
        force: { type: 'boolean', description: 'Apply even when the text contains {{...}} template groups.' },
        allowEmpty: { type: 'boolean', description: 'Explicitly retire the applied persona when no enabled file has text; defaults to false.' },
        clearDeployment: { type: 'boolean', description: 'Set only with user consent to remove custom deployment persona prefix/suffix; preserves the inherited base prompt and other settings. Required only when such customization exists.' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['ok', 'summary'],
      },
      render: (args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args, exec) {
      const request = asRequest(args)
      const action = typeof request.action === 'string' ? request.action : ''
      try {
        switch (action) {
          case 'status': {
            const result = await service.status({})
            if (isFailure(result)) return toolFailure(result)
            const applied = result.applied === null || result.applied === undefined ? null : result.applied
            const summary = `Persona mode ${result.mode}; directory ${result.personaDir || '(unset)'}; ${result.files} file(s), ${result.enabledFiles} enabled; applied preset: ${applied === null ? 'none' : `${applied.presetId} (${applied.chars} character(s), available: ${applied.available === true})`}; override preference: ${result.overrideBuiltIn === true}; actually overridden: ${result.builtInOverridden === true}; custom deployment persona present: ${result.deploymentPersona !== ''}; pending changes: ${result.needsApply === true}; can apply: ${result.canApply}.`
            return toolResult(true, summary, result)
          }
          case 'list': {
            const result = await service.list({})
            if (isFailure(result)) return toolFailure(result)
            const rows = result.files.map(file => `${file.id} (${file.slot}, ${file.enabled ? 'enabled' : 'disabled'})`)
            return toolResult(true, `${result.files.length} persona file(s)${rows.length === 0 ? '' : `: ${rows.join(', ')}`}.`, result)
          }
          case 'read': {
            const result = await service.read({ id: request.id })
            if (isFailure(result)) return toolFailure(result)
            const file = result.file
            return toolResult(true, `Persona ${JSON.stringify(file.name)} (id ${file.id}, slot ${file.slot}, ${file.enabled ? 'enabled' : 'disabled'}), ${file.body.length} character(s).`, result)
          }
          case 'write': {
            const result = await service.write({
              id: request.id,
              name: request.name,
              description: request.description,
              body: request.body,
              slot: request.slot,
              order: request.order,
              enabled: request.enabled,
              emoji: request.emoji,
            })
            if (isFailure(result)) return toolFailure(result)
            const file = result.file
            return toolResult(true, `Saved persona ${JSON.stringify(file.name)} (id ${file.id}, slot ${file.slot}, ${file.enabled ? 'enabled' : 'disabled'}).`, result)
          }
          case 'remove': {
            const result = await service.remove({ id: request.id })
            if (isFailure(result)) return toolFailure(result)
            return toolResult(true, `Removed persona ${JSON.stringify(result.id)}.`, result)
          }
          case 'toggle': {
            if (typeof request.enabled !== 'boolean') {
              return toolResult(false, 'persona_manager: invalid-enabled: enabled must be a boolean')
            }
            const result = await service.toggle({ id: request.id, enabled: request.enabled })
            if (isFailure(result)) return toolFailure(result)
            const file = result.file
            return toolResult(true, `Persona ${JSON.stringify(file.name)} is now ${file.enabled ? 'enabled' : 'disabled'}.`, result)
          }
          case 'import': {
            const path = await service.authorizeModelImport(request.path, exec?.agent)
            const result = await service.import({ path })
            if (isFailure(result)) return toolFailure(result)
            const summary = `Imported ${result.created.length} persona file(s) as ${result.format}; ${result.skipped.length} skipped; ${result.warnings.length} warning(s).`
            return toolResult(true, summary, result)
          }
          case 'compose': {
            const result = await service.compose({})
            if (isFailure(result)) return toolFailure(result)
            return toolResult(true, `Composed ${result.count} persona file(s) into ${result.text.length} character(s).`, result)
          }
          case 'apply': {
            const result = await service.apply({ force: request.force, allowEmpty: request.allowEmpty, clearDeployment: request.clearDeployment })
            if (isFailure(result)) return toolFailure(result)
            const failures = Array.isArray(result.failures) ? result.failures.length : 0
            const cleared = result.presetId === ''
              ? 'Applied persona cleared; the persona preset was retired.'
              : `Registered persona preset ${JSON.stringify(result.presetName)} (id ${result.presetId}, ${result.appliedPrefix.length} character(s)). Switch a session's mode to this preset to use it; existing conversations keep their current persona.`
            const builtIn = result.overrideBuiltIn === true
              ? ` Overrode ${Array.isArray(result.overridden) ? result.overridden.length : 0} shipped preset(s).`
              : ' Shipped presets were left unchanged or had only this plugin’s override restored.'
            const deployment = result.deploymentCleared === true ? ' Cleared the deployment-level persona.' : ''
            return toolResult(true, `${cleared}${builtIn}${deployment}${failures > 0 ? `; ${failures} preset update(s) failed` : ''}`, result)
          }
          default:
            return toolResult(false, `persona_manager: invalid-action: unknown action ${JSON.stringify(action)}`)
        }
      } catch (error) {
        if (error instanceof PersonaError) return toolFailure(error)
        return toolResult(false, `persona_manager failed: ${messageOf(error)}`)
      }
    },
  }
}

/** Resolve the persona directory from config, then the profile home, then `DSH_HOME`. */
function resolvePersonaDir(config, profileHome) {
  if (typeof config.personaDir === 'string' && config.personaDir.trim() !== '') return resolve(config.personaDir.trim())
  const home = typeof profileHome === 'string' && profileHome.trim() !== ''
    ? profileHome.trim()
    : (typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '')
  return home === '' ? '' : join(home, 'xiaoxing', 'personas')
}

/** Read the plugin row config defensively; the bundle declares no Config schema. */
function readConfig(config, profileHome) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  if (raw.personaDir !== undefined && typeof raw.personaDir !== 'string') throw new PersonaError('invalid-config', 'personaDir must be a string')
  const maxImportBytes = raw.maxImportBytes ?? 1024 * 1024
  if (!Number.isSafeInteger(maxImportBytes) || maxImportBytes < 1 || maxImportBytes > 64 * 1024 * 1024) {
    throw new PersonaError('invalid-config', 'maxImportBytes must be an integer between 1 and 67108864')
  }
  const home = typeof profileHome === 'string' && profileHome !== '' ? profileHome : (process.env.DSH_HOME ?? '')
  return {
    personaDir: resolvePersonaDir(raw, profileHome),
    dshHome: home === '' ? '' : resolve(home),
    maxImportBytes,
  }
}

/** Required services. */
export const inject = ['tools']

/**
 * Register the persona service and the `persona_manager` tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx - owning plugin context.
 * @param {unknown} config - plugin row config, read defensively.
 */
export function apply(ctx, config) {
  const settings = readConfig(config, ctx.get('profileContext')?.home)
  const service = new PersonaService({
    personaDir: settings.personaDir,
    dshHome: settings.dshHome,
    maxImportBytes: settings.maxImportBytes,
    getImportRoot: agent => agent?.session == null ? undefined : ctx.get('workingDirectory')?.get(agent.session),
    getEditor: () => ctx.get('configEditor'),
    getAgentPresets: () => ctx.get('agentPresets'),
    log: (message) => { ctx.logger.warn(message) },
    getSessionDeps: () => ({
      controller: ctx.get('sessionController'),
      sessions: ctx.get('sessions'),
      registry: ctx.get('workspaceRegistry'),
    }),
  })
  ctx.effect(() => ctx.provide(SERVICE_KEY, service), 'xiaoxing-persona.provide')
  const tool = createPersonaTool(service)
  ctx.effect(() => ctx.tools.register(tool), 'persona-manager.tool')
  // Runtime preset registration follows the registry: bootstrap when the
  // agentPresets service is present, and retire presets on teardown.
  ctx.effect(() => {
    void service.initialize().catch(error => { ctx.logger.warn(`persona initialization failed: ${messageOf(error)}`) })
    return () => service.disposePresets()
  }, 'xiaoxing-persona.lifecycle')
  // inject owns its child fiber; a Fiber is not an effect disposer.
  ctx.inject(['agentPresets', 'configEditor'], () => { void service.bootstrapPresets() })
}
