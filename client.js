/**
 * Client half of the Xiaoxing persona manager bundle.
 *
 * Registers one Settings section (`xiaoxing-persona`) plus its navigation icon,
 * mounts the `xiaoxingPersona` Remote namespace, and renders the management
 * list, the editor, the import area, and the apply/preview controls. Every
 * operation goes through the same Host service the `persona_manager` tool uses.
 */

window.__ModuleLoader__.load({
  id: '@xiaoxing/persona-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'xiaoxing-persona'
    /**
     * Wire methods mounted on the `xiaoxingPersona` namespace. `delete` carries
     * the Host's `remove` operation: the client namespace service already
     * declares `remove`, so a wire method with that name is refused at mount.
     */
    const REMOTE_METHODS = ['list', 'read', 'write', 'delete', 'toggle', 'import', 'compose', 'apply', 'status', 'aiEdit', 'setOverrideBuiltIn']
    /** Persona slots in composition order. */
    const SLOTS = ['identity', 'voice', 'instructions', 'personality']

    /** English dictionary (sentence case). */
    const EN = {
      'title': 'Xiaoxing persona manager',
      'intro': 'Persona files are plain Markdown below the persona directory. Enabled files are composed in slot order and applied as a same-named Agent preset; switch a session mode to use it.',
      'loading': 'Loading personas…',
      'refresh': 'Refresh',
      'status.applied': 'Applied · {chars} chars',
      'status.empty': 'Not applied',
      'status.enabled': 'Enabled {enabled}/{count}',
      'status.targets': 'Session mode: preset "{name}"',
      'status.overrideOn': ' · shipped presets overridden',
      'status.dir': 'Directory',
      'status.cannotApply': 'Apply target is unavailable',
      'override.label': 'Override shipped presets',
      'apply.button': 'Apply persona',
      'apply.busy': 'Applying…',
      'apply.done': 'Persona preset "{name}" registered. Switch a session mode to use it; existing conversations keep their current persona.',
      'apply.doneClear': 'Applied persona cleared; the persona preset was retired.',
      'apply.templateConfirm': 'The composed text contains {{...}} groups that the native persona template interpolates strictly, so rendering may fail. Apply anyway?',
      'apply.emptyConfirm': 'No enabled persona has text. Applying now clears the persona that is currently in effect. Continue?',
      'list.title': 'Persona files',
      'list.empty': 'No persona files yet. Create one or import an existing persona.',
      'list.toggle': 'Toggle {name}',
      'list.edit': 'Edit',
      'list.remove': 'Delete',
      'list.removeConfirm': 'Delete persona "{name}"? The file is removed from disk.',
      'list.slot.identity': 'IDENTITY.md',
      'list.slot.voice': 'SOUL.md',
      'list.slot.instructions': 'AGENTS.md',
      'list.slot.personality': 'Personality',
      'list.source.manual': 'manual',
      'list.source.openclaw-workspace': 'OpenClaw',
      'list.source.hermes-soul': 'Hermes SOUL',
      'list.source.hermes-personality-preset': 'Hermes personality',
      'list.source.hermes-profile-distribution': 'Hermes profile',
      'list.source.markdown': 'Markdown',
      'editor.title.new': 'New persona',
      'editor.title.edit': 'Edit persona',
      'editor.name': 'Name',
      'editor.description': 'Description',
      'editor.slot': 'Category',
      'editor.slotHint': 'Composes in order: IDENTITY → SOUL → AGENTS → personality.',
      'editor.order': 'Order',
      'editor.body': 'Persona text',
      'editor.enabled': 'Enabled',
      'editor.save': 'Save',
      'editor.saving': 'Saving…',
      'editor.cancel': 'Cancel',
      'ai.button': 'AI assist',
      'ai.busy': 'Opening session…',
      'ai.hint': 'Opens a new session',
      'import.title': 'Import personas',
      'import.hint': 'Point at an OpenClaw workspace directory, a Hermes SOUL.md, a Hermes config.yaml, or any Markdown file. The format is detected from the file and directory names.',
      'import.path': 'Path',
      'import.pathPlaceholder': 'C:\\Users\\me\\persona or /home/me/persona/SOUL.md',
      'import.button': 'Import',
      'import.busy': 'Importing…',
      'import.created': 'Created: {count}',
      'import.skipped': 'Skipped: {count}',
      'import.warnings': 'Warnings: {count}',
      'import.none': 'Nothing was imported.',
      'new.button': 'New persona',
      'error.title': 'Operation failed',
      'error.remote-unavailable': 'The persona service is not available yet. Reopen this page.',
      'error.invalid-body': 'Persona text must not be empty.',
      'error.invalid-name': 'A name is required.',
      'error.invalid-id': 'That file name is not allowed.',
      'error.invalid-slot': 'Unknown slot.',
      'error.invalid-order': 'Order must be a number.',
      'error.invalid-enabled': 'Enabled must be true or false.',
      'error.invalid-path': 'A path is required.',
      'error.not-found': 'Not found.',
      'error.empty': 'No enabled persona has text.',
      'error.template-groups': 'The composed text contains {{...}} groups.',
      'error.no-editor': 'The configuration editor is unavailable in this profile.',
      'error.no-registry': 'The agent preset registry is unavailable in this profile.',
      'error.no-template': 'The shipped preset template is unavailable.',
      'error.select-failed': 'The AI session could not switch to the persona-free preset.',
      'error.no-home': 'The persona directory is unset and DSH_HOME is unavailable.',
      'error.no-controller': 'Session creation is unavailable in this profile.',
      'error.agent-failed': 'The new session could not start.',
      'error.flush-failed': 'The session did not accept the message.',
      'error.unsupported': 'This source is not a supported persona format.',
      'error.unsupported-directory': 'This directory is not a recognized persona source.',
      'error.yaml-invalid': 'The YAML file could not be parsed.',
      'error.internal': 'The persona service failed.',
      'busy': 'Working…',
      'status.unavailable': 'Service unavailable',
      'status.needsApply': 'Changes pending — apply to update the preset',
      'status.presetUnavailable': 'Applied snapshot saved, but preset could not load',
      'status.overridePending': ' · override setting pending application',
      'status.starter': 'A minimal starter persona was created. Edit it or apply it, then select its mode in a new session.',
      'list.unavailable': 'Persona files could not be loaded. Resolve the error and refresh.',
      'preview.compose': 'Preview composition',
      'preview.hide': 'Hide preview',
      'preview.empty': 'The current composition is empty.',
      'override.hint': 'Changes take effect on the next Apply. Only the four shipped presets are affected.',
      'apply.deploymentConfirm': 'Remove the custom deployment persona prefix/suffix so AI editing stays clean? The shipped base prompt and other settings are preserved.',
      'apply.overrideConfirm': 'Apply this persona to the four shipped presets as well? Existing sessions keep their current revision.',
      'apply.deploymentCleared': ' Custom deployment persona removed.',
      'apply.skipped': ' {count} externally changed preset(s) were preserved.',
      'apply.partial': 'Some configuration updates failed. Inspect the reported state before retrying.',
      'override.saved': 'Override preference saved; apply the persona to make it effective.',
      'delete.snapshotKept': 'File deleted. The applied snapshot stays unchanged until you apply again.',
      'ai.unsaved': 'Save your edits before using AI assist for this existing persona.',
      'error.unsafe-file': 'A persona or state file is not a regular file. Links and directories are not supported.',
      'error.invalid-state': 'Saved state is invalid. It was preserved; repair it before retrying.',
      'error.deployment-persona': 'Removing a custom deployment persona requires confirmation.',
      'error.rollback-failed': 'Apply and recovery failed. Inspect the current preset and configuration before retrying.',
      'error.config-changed': 'Configuration changed during Apply. Refresh and retry.',
      'error.preset-failed': 'The preset could not load. Check its dependencies and refresh.',
      'error.disposed': 'The plugin was unloaded. Reopen this page after reload.',
      'error.invalid-description': 'Description must be text.',
      'error.invalid-emoji': 'Emoji must be text.',
      'error.initialization-failed': 'The persona directory could not be initialized.',
      'error.import-access': 'This source is outside the permitted import scope.',
      'error.import-too-large': 'The import exceeds the configured file-size limit.',
      'error.no-navigation': 'Session navigation is unavailable in this client.',
      'error.navigate-failed': 'The AI session was created, but could not be opened.',
      'error.service-unavailable': 'The Host service is unavailable. Refresh after plugin reload.',
      'error.config-authority': 'A home patch or command-line overlay controls this setting. Change that source first.',
      'error.confirmation-unavailable': 'This client cannot show a confirmation dialog. Reopen in the supported Web UI.',
    }

    /** Chinese dictionary. */
    const ZH = {
      'title': '小星人格管理',
      'intro': '人格文件是人格目录下的纯 Markdown 文件。启用的文件按槽位顺序组合，应用为同名 Agent 预设，按会话切换使用。',
      'loading': '正在加载人格…',
      'refresh': '刷新',
      'status.applied': '已应用 · {chars} 字',
      'status.empty': '未应用',
      'status.enabled': '启用 {enabled}/{count}',
      'status.targets': '应用范围：预设「{name}」',
      'status.overrideOn': ' · 已覆盖内置预设',
      'status.dir': '目录',
      'status.cannotApply': '应用目标不可用',
      'override.label': '覆盖内置预设',
      'apply.button': '应用人格',
      'apply.busy': '正在应用…',
      'apply.done': '人格已应用：预设「{name}」已创建。新会话切换到该模式生效；已有会话保留当前人格。',
      'apply.doneClear': '人格应用已清除，同名预设已移除。',
      'apply.templateConfirm': '组合文本包含 {{...}} 插值组，原生人格模板会严格插值，渲染可能失败。仍要应用吗？',
      'apply.emptyConfirm': '没有任何启用的人格包含正文。继续应用会清空当前生效的人格。要继续吗？',
      'list.title': '人格文件',
      'list.empty': '还没有人格文件。新建一个，或导入现成的人格设定。',
      'list.toggle': '切换 {name}',
      'list.edit': '编辑',
      'list.remove': '删除',
      'list.removeConfirm': '删除人格“{name}”？文件将从磁盘移除。',
      'list.slot.identity': 'IDENTITY.md',
      'list.slot.voice': 'SOUL.md',
      'list.slot.instructions': 'AGENTS.md',
      'list.slot.personality': 'personality',
      'list.source.manual': '手动创建',
      'list.source.openclaw-workspace': 'OpenClaw',
      'list.source.hermes-soul': 'Hermes SOUL',
      'list.source.hermes-personality-preset': 'Hermes 人格预设',
      'list.source.hermes-profile-distribution': 'Hermes 配置分发',
      'list.source.markdown': 'Markdown',
      'editor.title.new': '新建人格',
      'editor.title.edit': '编辑人格',
      'editor.name': '名称',
      'editor.description': '描述',
      'editor.slot': '类别',
      'editor.slotHint': '组合顺序：IDENTITY → SOUL → AGENTS → personality。',
      'editor.order': '排序',
      'editor.body': '人设正文',
      'editor.enabled': '启用',
      'editor.save': '保存',
      'editor.saving': '正在保存…',
      'editor.cancel': '取消',
      'ai.button': 'AI辅助',
      'ai.busy': '正在创建会话…',
      'ai.hint': '将开启新会话',
      'import.title': '导入人格',
      'import.hint': '可以指向 OpenClaw 工作区目录、Hermes 的 SOUL.md、Hermes 的 config.yaml，或任意 Markdown 文件。格式根据文件名与目录约定自动识别。',
      'import.path': '路径',
      'import.pathPlaceholder': 'C:\\Users\\me\\persona 或 /home/me/persona/SOUL.md',
      'import.button': '导入',
      'import.busy': '正在导入…',
      'import.created': '已创建：{count}',
      'import.skipped': '已跳过：{count}',
      'import.warnings': '警告：{count}',
      'import.none': '没有导入任何内容。',
      'new.button': '新建人格',
      'error.title': '操作失败',
      'error.remote-unavailable': '人格服务尚未就绪，请重新打开此页面。',
      'error.invalid-body': '人格正文不能为空。',
      'error.invalid-name': '名称不能为空。',
      'error.invalid-id': '该文件名不可用。',
      'error.invalid-slot': '未知的槽位。',
      'error.invalid-order': '排序必须是数字。',
      'error.invalid-enabled': '启用状态必须是 true 或 false。',
      'error.invalid-path': '路径不能为空。',
      'error.not-found': '未找到。',
      'error.empty': '没有任何启用的人格包含正文。',
      'error.template-groups': '组合文本包含 {{...}} 插值组。',
      'error.no-editor': '当前 profile 中没有可用的配置编辑器。',
      'error.no-registry': '当前 profile 中没有可用的预设注册服务。',
      'error.no-template': '无法读取内置预设模板。',
      'error.select-failed': 'AI 会话切换无人格预设失败。',
      'error.no-home': '人格目录未设置，且 DSH_HOME 不可用。',
      'error.no-controller': '当前 profile 无法创建会话。',
      'error.agent-failed': '新会话启动失败。',
      'error.flush-failed': '会话未接受消息。',
      'error.unsupported': '该来源不是受支持的人格格式。',
      'error.unsupported-directory': '该目录不是可识别的人格来源。',
      'error.yaml-invalid': 'YAML 文件解析失败。',
      'error.internal': '人格服务执行失败。',
      'busy': '处理中…',
      'status.unavailable': '服务不可用',
      'status.needsApply': '有修改待应用，应用后更新预设',
      'status.presetUnavailable': '应用快照已保存，但预设未能加载',
      'status.overridePending': ' · 覆盖设置待应用',
      'status.starter': '已创建最小基础人格。可先编辑或直接应用，再在新会话中选择该模式。',
      'list.unavailable': '人格文件未能加载。处理错误后刷新。',
      'preview.compose': '预览组合',
      'preview.hide': '收起预览',
      'preview.empty': '当前组合为空。',
      'override.hint': '下次应用时生效，只影响四个内置预设。',
      'apply.deploymentConfirm': '为保持 AI 编辑不带用户人设，是否移除部署级自定义人格前缀/后缀？宿主默认说明及其他设置会保留。',
      'apply.overrideConfirm': '同时把此人格应用到四个内置预设？已有会话仍保留原版本。',
      'apply.deploymentCleared': ' 已移除部署级自定义人格。',
      'apply.skipped': ' 已保留 {count} 个外部修改的预设。',
      'apply.partial': '部分配置更新失败，请检查实际状态再重试。',
      'override.saved': '覆盖选择已保存，下次应用时生效。',
      'delete.snapshotKept': '文件已删除，已应用的快照保持不变；再次应用才更新预设。',
      'ai.unsaved': '请先保存当前修改，再对这个人格使用 AI 辅助。',
      'error.unsafe-file': '人设或状态文件不是普通文件，不支持符号链接或目录。',
      'error.invalid-state': '保存的状态无效，文件已保留，请修复后重试。',
      'error.deployment-persona': '移除部署级自定义人格需要确认。',
      'error.rollback-failed': '应用和恢复均失败，请检查当前预设与配置后再重试。',
      'error.config-changed': '应用期间配置已变化，请刷新后重试。',
      'error.preset-failed': '预设未能加载，请检查依赖后刷新。',
      'error.disposed': '插件已卸载，重新加载后请重开此页面。',
      'error.invalid-description': '描述必须是文本。',
      'error.invalid-emoji': 'Emoji 必须是文本。',
      'error.initialization-failed': '人格目录初始化失败。',
      'error.import-access': '该来源不在允许的导入范围内。',
      'error.import-too-large': '导入文件超过配置的大小上限。',
      'error.no-navigation': '当前客户端无法打开会话。',
      'error.navigate-failed': 'AI 会话已创建，但打开失败。',
      'error.service-unavailable': '宿主服务不可用，请在插件重新加载后刷新。',
      'error.config-authority': '该设置由 home patch 或命令行覆盖层控制，请先修改对应来源。',
      'error.confirmation-unavailable': '当前客户端无法显示确认对话框，请在受支持的 Web 界面中重新打开。',
    }

    /** Section styles; only `--dsw-alias-*` theme tokens carry color. */
    const STYLES = `
.xxp-root { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 760px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
.xxp-heading { margin: 0; font-size: 15px; line-height: 24px; font-weight: 600; }
.xxp-intro { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.xxp-panel { display: flex; flex-direction: column; gap: 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 12px; background: var(--dsw-alias-bg-layer-1); }
.xxp-panelTitle { margin: 0; font-size: 13px; line-height: 20px; font-weight: 500; }
.xxp-status { display: flex; flex-direction: column; gap: 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 10px 12px; background: var(--dsw-alias-bg-module-platform); }
.xxp-statusBar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.xxp-statusPreview { display: flex; flex-direction: column; gap: 8px; }
.xxp-statusMain { display: flex; flex: 1 1 260px; flex-direction: column; gap: 2px; min-width: 0; }
.xxp-statusLine { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.xxp-statusLine strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.xxp-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.xxp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.xxp-btn { border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 8px; padding: 5px 12px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
.xxp-btn:active { background: var(--dsw-alias-interactive-bg-active); }
.xxp-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.xxp-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.xxp-btn:disabled { cursor: default; opacity: 0.55; }
.xxp-btnPrimary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); }
.xxp-btnPrimary:hover { background: var(--dsw-alias-button-primary-hover); }
.xxp-btnPrimary:active { background: var(--dsw-alias-button-primary-hover); }
.xxp-btnDanger { color: var(--dsw-alias-state-error-primary); }
.xxp-btnSmall { padding: 3px 9px; font-size: 12px; line-height: 18px; }
.xxp-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; overflow: hidden; }
.xxp-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.xxp-row:first-child { border-top: none; }
.xxp-rowMain { display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; min-width: 0; }
.xxp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 20px; }
.xxp-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.xxp-badge { border-radius: 5px; padding: 1px 6px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; white-space: nowrap; }
.xxp-badgeSlot { color: var(--dsw-alias-state-business-primary); }
.xxp-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.xxp-switch { position: relative; flex: none; width: 32px; height: 18px; border: 0; border-radius: 9px; padding: 0; background: var(--dsw-alias-state-idle-primary); cursor: pointer; }
.xxp-switch[aria-checked="true"] { background: var(--dsw-alias-state-business-primary); }
.xxp-switch:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.xxp-switch:disabled { cursor: default; opacity: 0.55; }
.xxp-switchThumb { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease; }
.xxp-switch[aria-checked="true"] .xxp-switchThumb { transform: translateX(14px); }
.xxp-empty { margin: 0; border: 0.5px dashed var(--dsw-alias-border-l3); border-radius: 12px; padding: 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }
.xxp-form { display: flex; flex-direction: column; gap: 10px; }
.xxp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.xxp-editorHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.xxp-editorMeta { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.xxp-editorMeta .xxp-field { flex: 0 0 auto; }
.xxp-editorMeta .xxp-select { width: 150px; }
.xxp-editorMeta .xxp-input { width: 90px; }
.xxp-hint { margin: -2px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.xxp-label { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.xxp-labelCount { margin-left: 6px; color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.xxp-input, .xxp-select, .xxp-textarea { box-sizing: border-box; width: 100%; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 6px 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; }
.xxp-textarea { min-height: 380px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; }
.xxp-editorFoot { display: flex; justify-content: flex-end; gap: 8px; }
.xxp-aiRow { display: flex; flex-direction: column; gap: 6px; border-top: 0.5px dashed var(--dsw-alias-border-l3); padding-top: 10px; }
.xxp-aiHint { align-self: center; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; white-space: nowrap; }
.xxp-input:focus-visible, .xxp-select:focus-visible, .xxp-textarea:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.xxp-check { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; }
.xxp-pre { margin: 0; max-height: 520px; overflow: auto; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 10px 12px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 19px; white-space: pre-wrap; overflow-wrap: anywhere; }
.xxp-importRow { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
.xxp-importRow .xxp-field { flex: 1 1 320px; }
.xxp-result { display: flex; flex-direction: column; gap: 4px; border-radius: 8px; padding: 8px 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.xxp-resultLine { overflow-wrap: anywhere; }
.xxp-warn { color: var(--dsw-alias-state-warn-label); }
.xxp-error { display: flex; flex-direction: column; gap: 2px; border-radius: 8px; padding: 8px 10px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.xxp-notice { margin: 0; color: var(--dsw-alias-state-success-primary); font-size: 12px; line-height: 18px; }
.xxp-visuallyHidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`

    /**
     * Build the settings section component for one plugin context.
     * @param {any} ctx - client plugin context.
     * @param {(key: string, params?: Record<string, unknown>) => string} fallbackT - namespace-bound translate.
     * @returns {Function} React component receiving the slot props.
     */
    function createSection(ctx, fallbackT) {
      /** Localized text for one Host failure code, falling back to the Host message. */
      function errorText(t, failure) {
        const code = String(failure.code ?? 'internal')
        const key = code.startsWith('gateway/') ? 'error.service-unavailable' : `error.${code}`
        const localized = t(key)
        const detail = String(failure.message ?? '')
        if (localized !== key) return detail === '' ? localized : `${localized} (${detail})`
        return detail === '' ? t('error.internal') : detail
      }

      return function PersonaSection(props) {
        const t = typeof props.t === 'function' ? props.t : fallbackT
        const [files, setFiles] = React.useState([])
        const [listFailure, setListFailure] = React.useState(null)
        const refreshGeneration = React.useRef(0)
        const [status, setStatus] = React.useState(null)
        const [failure, setFailure] = React.useState(null)
        const [notice, setNotice] = React.useState('')
        const [busy, setBusy] = React.useState(true)
        const [draft, setDraft] = React.useState(null)
        const [importPath, setImportPath] = React.useState('')
        const [importResult, setImportResult] = React.useState(null)
        const [showPreview, setShowPreview] = React.useState(false)
        const [previewText, setPreviewText] = React.useState('')
        const [aiBusy, setAiBusy] = React.useState(false)

        /** Call one Remote method and unwrap both envelopes. */
        const call = React.useCallback(async (method, request) => {
          try {
            // The mounted namespace is an optional service keyed
            // `remote.xiaoxingPersona`; resolve it through the global service
            // store (ctx.get), not the ctx property proxy, which only resolves
            // names declared in this plugin's inject list.
            const namespace = ctx.get('remote.xiaoxingPersona')
            if (namespace === undefined || typeof namespace[method] !== 'function') {
              return { ok: false, code: 'remote-unavailable', message: '' }
            }
            const result = await namespace[method](request)
            if (result === null || typeof result !== 'object' || result.ok !== true) {
              const error = result !== null && typeof result === 'object' ? result.error : undefined
              return {
                ok: false,
                code: error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'internal',
                message: error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : '',
              }
            }
            const value = result.value
            if (value !== null && typeof value === 'object' && value.ok === false) {
              return { ok: false, code: String(value.code ?? 'internal'), message: String(value.message ?? '') }
            }
            return { ok: true, value }
          } catch (error) {
            return { ok: false, code: 'remote-unavailable', message: error instanceof Error ? error.message : String(error) }
          }
        }, [])

        /** Re-read the list and the apply status. */
        const refresh = React.useCallback(async (options = {}) => {
          const generation = ++refreshGeneration.current
          const [listResult, statusResult] = await Promise.all([call('list', {}), call('status', {})])
          if (generation !== refreshGeneration.current) return
          if (listResult.ok) setFiles(Array.isArray(listResult.value?.files) ? listResult.value.files : [])
          setListFailure(listResult.ok ? null : listResult)
          setStatus(statusResult.ok ? (statusResult.value ?? null) : null)
          const problem = !listResult.ok ? listResult : !statusResult.ok ? statusResult : null
          if (problem !== null || options.preserveFailure !== true) setFailure(problem)
          setShowPreview(false)
          setBusy(false)
        }, [call])

        React.useEffect(() => {
          void refresh()
          return () => { refreshGeneration.current += 1 }
        }, [refresh])

        const confirmAction = (message) => {
          if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
            setFailure({ code: 'confirmation-unavailable', message: '' })
            return false
          }
          return window.confirm(message)
        }

        const runApply = async (options, overrideConfirmed = false) => {
          if (status?.overrideBuiltIn === true && !overrideConfirmed) {
            if (!confirmAction(t('apply.overrideConfirm'))) return
            overrideConfirmed = true
          }
          setBusy(true)
          setFailure(null)
          setNotice('')
          const result = await call('apply', options)
          if (!result.ok) {
            if (result.code === 'template-groups' && options.force !== true && confirmAction(t('apply.templateConfirm'))) {
              return runApply({ ...options, force: true }, overrideConfirmed)
            }
            if (result.code === 'empty' && options.allowEmpty !== true && confirmAction(t('apply.emptyConfirm'))) {
              return runApply({ ...options, allowEmpty: true }, overrideConfirmed)
            }
            if (result.code === 'deployment-persona' && options.clearDeployment !== true && confirmAction(t('apply.deploymentConfirm'))) {
              return runApply({ ...options, clearDeployment: true }, overrideConfirmed)
            }
            setBusy(false)
            setFailure(current => current?.code === 'confirmation-unavailable' ? current : result)
            await refresh({ preserveFailure: true })
            return
          }
          const value = result.value ?? {}
          let message = value.presetId === '' ? t('apply.doneClear') : t('apply.done', { name: value.presetName ?? '' })
          if (value.deploymentCleared === true) message += t('apply.deploymentCleared')
          if (Array.isArray(value.skipped) && value.skipped.length > 0) message += t('apply.skipped', { count: value.skipped.length })
          if (Array.isArray(value.failures) && value.failures.length > 0) {
            setFailure({ code: 'internal', message: t('apply.partial') })
            await refresh({ preserveFailure: true })
            return
          }
          setNotice(message)
          await refresh()
        }

        /** One preview control: expand with the saved composition, collapse without refetching. */
        const togglePreview = async () => {
          if (showPreview) { setShowPreview(false); return }
          setBusy(true)
          setFailure(null)
          const result = await call('compose', {})
          setBusy(false)
          if (!result.ok) { setFailure(result); return }
          setPreviewText(result.value?.text ?? '')
          setShowPreview(true)
        }

        /** Persist the shipped-preset override switch. */
        const handleOverride = async (enabled) => {
          setBusy(true)
          setFailure(null)
          setNotice('')
          const result = await call('setOverrideBuiltIn', { enabled })
          if (!result.ok) setFailure(result)
          else setNotice(t('override.saved'))
          await refresh({ preserveFailure: !result.ok })
        }

        const handleToggle = async (file) => {
          setBusy(true)
          setFailure(null)
          setNotice('')
          const result = await call('toggle', { id: file.id, enabled: file.enabled !== true })
          if (!result.ok) setFailure(result)
          await refresh({ preserveFailure: !result.ok })
        }

        const handleEdit = async (file) => {
          setBusy(true)
          setFailure(null)
          setNotice('')
          const result = await call('read', { id: file.id })
          if (result.ok) {
            const loaded = result.value?.file ?? {}
            setDraft({
              id: loaded.id ?? file.id,
              isNew: false,
              name: loaded.name ?? file.name,
              description: loaded.description ?? '',
              slot: loaded.slot ?? 'voice',
              order: String(loaded.order ?? 100),
              enabled: loaded.enabled !== false,
              body: loaded.body ?? '',
              savedBody: loaded.body ?? '',
            })
          } else {
            setFailure(result)
          }
          setBusy(false)
        }

        const handleNew = () => {
          setFailure(null)
          setNotice('')
          setDraft({ id: '', isNew: true, name: '', description: '', slot: 'voice', order: '100', enabled: true, body: '' })
        }

        const handleSave = async () => {
          if (draft === null) return
          if (String(draft.name).trim() === '') {
            setFailure({ code: 'invalid-name', message: '' })
            return
          }
          if (String(draft.body).trim() === '') {
            setFailure({ code: 'invalid-body', message: '' })
            return
          }
          setBusy(true)
          setFailure(null)
          setNotice('')
          const request = {
            name: String(draft.name).trim(),
            description: String(draft.description),
            slot: draft.slot,
            enabled: draft.enabled === true,
            body: String(draft.body),
          }
          const order = Number(String(draft.order))
          if (String(draft.order).trim() === '' || !Number.isSafeInteger(order)) {
            setBusy(false)
            setFailure({ code: 'invalid-order', message: '' })
            return
          }
          request.order = order
          if (draft.isNew !== true && typeof draft.id === 'string' && draft.id !== '') request.id = draft.id
          const result = await call('write', request)
          if (!result.ok) {
            setBusy(false)
            setFailure(result)
            return
          }
          setDraft(null)
          await refresh()
        }

        const handleDelete = async (file) => {
          if (!confirmAction(t('list.removeConfirm', { name: file.name }))) return
          setBusy(true)
          setFailure(null)
          setNotice('')
          const result = await call('delete', { id: file.id })
          if (!result.ok) setFailure(result)
          else {
            if (status?.applied?.files?.includes(file.id)) setNotice(t('delete.snapshotKept'))
            if (draft !== null && draft.id === file.id) setDraft(null)
          }
          await refresh({ preserveFailure: !result.ok })
        }

        const handleImport = async () => {
          if (importPath.trim() === '') {
            setFailure({ code: 'invalid-path', message: '' })
            return
          }
          setBusy(true)
          setFailure(null)
          setNotice('')
          const result = await call('import', { path: importPath.trim() })
          if (result.ok) {
            setImportResult(result.value ?? null)
          } else {
            setFailure(result)
            setImportResult(null)
          }
          await refresh({ preserveFailure: !result.ok })
        }

        /** Send the editor's persona (creation brief for a new draft) to a fresh AI session. */
        const handleAiEdit = async () => {
          if (draft === null || aiBusy) return
          const isNew = draft.isNew === true
          const named = !isNew && typeof draft.id === 'string' && draft.id !== '' ? draft.id : ''
          const draftName = isNew && typeof draft.name === 'string' ? draft.name.trim() : ''
          if (!isNew && draft.savedBody !== undefined && draft.body !== draft.savedBody) {
            setFailure({ code: 'internal', message: t('ai.unsaved') })
            return
          }
          const instruction = [
            draftName === '' ? '' : `人格名字用「${draftName}」。`,
            isNew && draft.body.trim() !== '' ? `创作参考草稿：\n${draft.body}` : '',
          ].filter(Boolean).join('\n')
          setAiBusy(true)
          setFailure(null)
          setNotice('')
          const result = await call('aiEdit', named === '' ? { instruction } : { id: named, instruction })
          setAiBusy(false)
          if (!result.ok) {
            setFailure(result)
            return
          }
          const sessionId = result.value?.sessionId
          if (typeof sessionId === 'string' && sessionId !== '') {
            try {
              const navigation = ctx.get('uiWorkspace')
              if (typeof navigation?.openSession !== 'function') throw new Error(t('error.no-navigation'))
              navigation.openSession(sessionId)
              if (typeof props.close === 'function') props.close()
            } catch (error) {
              setFailure({ code: 'navigate-failed', message: `${sessionId}: ${error instanceof Error ? error.message : String(error)}` })
            }
          }
        }

        /** One labelled form field; the label may carry a trailing hint node. */
        const field = (label, control) => h('label', { className: 'xxp-field' },
          h('span', { className: 'xxp-label' }, label),
          control,
        )

        const applied = status !== null && status.applied !== null && typeof status.applied === 'object' ? status.applied : null
        const enabledPart = status === null ? '' : ` · ${t('status.enabled', { enabled: status.enabledFiles ?? 0, count: status.files ?? files.length })}`
        const statusLine = status === null
          ? (busy ? t('loading') : t('status.unavailable'))
          : (applied === null
              ? `${t('status.empty')}${enabledPart}`
              : `${t('status.applied', { chars: applied.chars ?? 0 })}${enabledPart}`)
        const targetsLine = status === null || applied === null
          ? ''
          : `${t('status.targets', { name: applied.name !== '' ? applied.name : applied.presetId })}${status.builtInOverridden === true ? t('status.overrideOn') : ''}${status.needsApply && status.overrideBuiltIn !== applied.overrideBuiltIn ? t('status.overridePending') : ''}`

        return h('div', { className: 'xxp-root' },
          h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
          h('h2', { className: 'xxp-heading' }, t('title')),
          h('p', { className: 'xxp-intro' }, t('intro')),

          h('div', { className: 'xxp-status' },
            h('div', { className: 'xxp-statusBar' },
              h('div', { className: 'xxp-statusMain' },
                h('div', { className: 'xxp-statusLine' }, h('strong', null, statusLine)),
                targetsLine === '' ? null : h('div', { className: 'xxp-statusLine' }, targetsLine),
                status !== null && status.canApply !== true ? h('div', { className: 'xxp-statusLine xxp-warn' }, errorText(t, { code: status.canApplyReason || 'no-editor', message: '' })) : null,
                status !== null ? h('div', { className: 'xxp-statusLine' }, `${t('status.dir')}: `, h('span', { className: 'xxp-mono' }, status.personaDir || '—')) : null,
                applied !== null && applied.available === false ? h('div', { className: 'xxp-statusLine xxp-warn' }, t('status.presetUnavailable')) : null,
                applied !== null && status?.needsApply === true ? h('div', { className: 'xxp-statusLine' }, t('status.needsApply')) : null,
              ),
              h('div', { className: 'xxp-actions' },
                h('label', { className: 'xxp-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: status?.overrideBuiltIn === true,
                    disabled: busy || status === null,
                    onChange: (event) => { void handleOverride(event.target.checked) },
                  }),
                  h('span', null, t('override.label')),
                ),
                h('button', {
                  type: 'button',
                  className: 'xxp-btn xxp-btnPrimary',
                  disabled: busy || aiBusy || listFailure !== null || status?.canApply !== true,
                  onClick: () => { void runApply({}) },
                }, busy ? t('busy') : t('apply.button')),
                h('button', {
                  type: 'button',
                  className: 'xxp-btn',
                  disabled: busy || status === null,
                  onClick: () => { void togglePreview() },
                }, showPreview ? t('preview.hide') : t('preview.compose')),
                h('button', {
                  type: 'button',
                  className: 'xxp-btn',
                  disabled: busy,
                  onClick: () => { setBusy(true); void refresh() },
                }, t('refresh')),
              ),
            ),
            showPreview ? h('div', { className: 'xxp-statusPreview' },
              h('span', { className: 'xxp-statusLine' }, t('preview.compose')),
              previewText === ''
                ? h('p', { className: 'xxp-empty' }, t('preview.empty'))
                : h('pre', { className: 'xxp-pre' }, previewText),
            ) : null,
          ),

          status?.starterCreated === true && applied === null ? h('p', { className: 'xxp-intro' }, t('status.starter')) : null,
          h('p', { className: 'xxp-hint' }, t('override.hint')),
          notice === '' ? null : h('p', { className: 'xxp-notice' }, notice),
          failure === null ? null : h('div', { className: 'xxp-error', role: 'alert' },
            h('strong', null, t('error.title')),
            h('span', null, errorText(t, failure)),
          ),

          draft === null ? null : h('form', {
            className: 'xxp-panel',
            onSubmit: (event) => { event.preventDefault(); void handleSave() },
          },
            h('div', { className: 'xxp-editorHead' },
              h('h3', { className: 'xxp-panelTitle' }, draft.isNew === true ? t('editor.title.new') : t('editor.title.edit')),
              h('div', { className: 'xxp-actions' },
                h('span', { className: 'xxp-aiHint' }, t('ai.hint')),
                h('button', {
                  type: 'button',
                  className: 'xxp-btn xxp-btnSmall',
                  disabled: aiBusy || busy || status?.canAiEdit !== true || typeof ctx.get('uiWorkspace')?.openSession !== 'function',
                  title: status?.canAiEdit !== true ? errorText(t, { code: status?.canAiEditReason || 'preset-failed', message: '' }) : typeof ctx.get('uiWorkspace')?.openSession !== 'function' ? t('error.no-navigation') : '',
                  onClick: () => { void handleAiEdit() },
                }, aiBusy ? t('ai.busy') : t('ai.button')),
                h('label', { className: 'xxp-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: draft.enabled === true,
                    onChange: (event) => { setDraft({ ...draft, enabled: event.target.checked }) },
                  }),
                  h('span', null, t('editor.enabled')),
                ),
              ),
            ),
            h('div', { className: 'xxp-form' },
              field(t('editor.name'), h('input', {
                className: 'xxp-input',
                type: 'text',
                value: draft.name,
                autoFocus: true,
                onChange: (event) => { setDraft({ ...draft, name: event.target.value }) },
              })),
              h('div', { className: 'xxp-editorMeta' },
                field(t('editor.slot'), h('select', {
                  className: 'xxp-select',
                  value: draft.slot,
                  onChange: (event) => { setDraft({ ...draft, slot: event.target.value }) },
                }, SLOTS.map(slot => h('option', { key: slot, value: slot }, t(`list.slot.${slot}`))))),
                field(t('editor.order'), h('input', {
                  className: 'xxp-input',
                  type: 'number',
                  step: '1',
                  value: draft.order,
                  onChange: (event) => { setDraft({ ...draft, order: event.target.value }) },
                })),
              ),
              h('p', { className: 'xxp-hint' }, t('editor.slotHint')),
              field(t('editor.description'), h('input', {
                className: 'xxp-input',
                type: 'text',
                value: draft.description,
                onChange: (event) => { setDraft({ ...draft, description: event.target.value }) },
              })),
              field(h('span', null,
                t('editor.body'),
                h('span', { className: 'xxp-labelCount' }, `${String(draft.body).length}`),
              ), h('textarea', {
                className: 'xxp-textarea',
                value: draft.body,
                onChange: (event) => { setDraft({ ...draft, body: event.target.value }) },
              })),
            ),
            h('div', { className: 'xxp-editorFoot' },
              h('button', {
                type: 'button',
                className: 'xxp-btn',
                disabled: busy,
                onClick: () => { setDraft(null); setFailure(null) },
              }, t('editor.cancel')),
              h('button', { type: 'submit', className: 'xxp-btn xxp-btnPrimary', disabled: busy }, busy ? t('editor.saving') : t('editor.save')),
            ),
          ),

          h('div', { className: 'xxp-panel' },
            h('div', { className: 'xxp-actions' },
              h('h3', { className: 'xxp-panelTitle' }, t('list.title')),
              h('button', {
                type: 'button',
                className: 'xxp-btn xxp-btnSmall',
                disabled: busy,
                onClick: handleNew,
              }, t('new.button')),
            ),
            listFailure !== null && files.length > 0 ? h('p', { className: 'xxp-warn' }, t('list.unavailable')) : null,
            files.length === 0
              ? h('p', { className: 'xxp-empty' }, busy ? t('loading') : listFailure !== null ? t('list.unavailable') : t('list.empty'))
              : h('ul', { className: 'xxp-list' }, files.map(file => h('li', { key: file.id, className: 'xxp-row' },
                h('button', {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': file.enabled === true,
                  'aria-label': t('list.toggle', { name: file.name }),
                  className: 'xxp-switch',
                  disabled: busy,
                  onClick: () => { void handleToggle(file) },
                }, h('span', { className: 'xxp-switchThumb', 'aria-hidden': true })),
                h('div', { className: 'xxp-rowMain' },
                  h('div', { className: 'xxp-name' }, file.emoji ? `${file.emoji} ${file.name}` : file.name),
                  h('div', { className: 'xxp-meta' },
                    h('span', { className: 'xxp-badge xxp-badgeSlot' }, t(`list.slot.${file.slot}`)),
                    h('span', { className: 'xxp-badge' }, t(`list.source.${file.sourceFormat}`)),
                    file.description === '' ? null : h('span', { className: 'xxp-desc' }, file.description),
                  ),
                ),
                h('div', { className: 'xxp-actions' },
                  h('button', {
                    type: 'button',
                    className: 'xxp-btn xxp-btnSmall',
                    disabled: busy,
                    onClick: () => { void handleEdit(file) },
                  }, t('list.edit')),
                  h('button', {
                    type: 'button',
                    className: 'xxp-btn xxp-btnSmall xxp-btnDanger',
                    disabled: busy,
                    onClick: () => { void handleDelete(file) },
                  }, t('list.remove')),
                ),
              ))),
          ),

          h('div', { className: 'xxp-panel' },
            h('h3', { className: 'xxp-panelTitle' }, t('import.title')),
            h('p', { className: 'xxp-intro' }, t('import.hint')),
            h('div', { className: 'xxp-importRow' },
              field(t('import.path'), h('input', {
                className: 'xxp-input',
                type: 'text',
                value: importPath,
                placeholder: t('import.pathPlaceholder'),
                onChange: (event) => { setImportPath(event.target.value) },
              })),
              h('button', {
                type: 'button',
                className: 'xxp-btn',
                disabled: busy,
                onClick: () => { void handleImport() },
              }, busy ? t('busy') : t('import.button')),
            ),
            importResult === null ? null : h('div', { className: 'xxp-result' },
              h('span', { className: 'xxp-resultLine' }, t('import.created', { count: importResult.created?.length ?? 0 })),
              (importResult.created ?? []).map(entry => h('span', { key: `c-${entry.id}`, className: 'xxp-resultLine xxp-mono' }, `+ ${entry.id} (${t(`list.slot.${entry.slot}`)}, ${entry.enabled ? t('editor.enabled') : '—'})`)),
              (importResult.skipped ?? []).length === 0 ? null : h('span', { className: 'xxp-resultLine' }, t('import.skipped', { count: importResult.skipped.length })),
              (importResult.skipped ?? []).map(entry => h('span', { key: `s-${entry.file}`, className: 'xxp-resultLine xxp-mono' }, `- ${entry.file}: ${entry.reason}`)),
              (importResult.warnings ?? []).length === 0 ? null : h('span', { className: 'xxp-resultLine xxp-warn' }, t('import.warnings', { count: importResult.warnings.length })),
              (importResult.warnings ?? []).map(entry => h('span', { key: `w-${entry.code}-${entry.file}`, className: 'xxp-resultLine xxp-warn' }, `! ${entry.code}: ${entry.message}`)),
              (importResult.created ?? []).length === 0 && (importResult.skipped ?? []).length === 0
                ? h('span', { className: 'xxp-resultLine' }, t('import.none'))
                : null,
            ),
          ),
        )
      }
    }

    /** Settings navigation glyph: a persona bust with a sparkle. */
    function PersonaIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 16
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'currentColor',
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block', opacity: props?.active === true ? 1 : 0.78 },
      },
        h('circle', { cx: 11.4, cy: 8.6, r: 3.3 }),
        h('path', { d: 'M11.4 13.6c-3.7 0-6.7 2.8-6.7 6.2 0 .5.4.9.9.9h11.6c.5 0 .9-.4.9-.9 0-3.4-3-6.2-6.7-6.2z' }),
        h('path', { d: 'M18.6 2.4l1.1 2.1 2.1 1.1-2.1 1.1-1.1 2.1-1.1-2.1-2.1-1.1 2.1-1.1z' }),
      )
    }

    return {
      inject: ['slots', 'remote', 'locale'],
      async apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'xiaoxing-persona.locale')

        const descriptors = REMOTE_METHODS.map(method => ({
          id: `@xiaoxing/persona-manager#${method}`,
          service: 'xiaoxingPersona',
          namespace: 'xiaoxingPersona',
          method,
          parameters: [{
            name: 'request',
            wire: 'request',
            source: 'json',
            codec: { mode: 'strict', typeSymbol: `@xiaoxing/persona-manager#req.${method}`, create: () => null },
          }],
          result: { mode: 'strict', typeSymbol: `@xiaoxing/persona-manager#res.${method}`, create: () => null },
          invocation: { kind: 'direct' },
        }))
        try {
          await ctx.remote.$mount({ package: '@xiaoxing/persona-manager', descriptors })
        } catch (error) {
          // Keep the section available so its error state can explain the failure.
          ctx.logger?.warn(`persona Remote mount failed: ${error instanceof Error ? error.message : String(error)}`)
        }

        const Section = createSection(ctx, t)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'xiaoxing-persona',
          order: 60,
          label: () => t('title'),
          locale: NS,
        }, Section))
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'xiaoxing-persona',
        }, PersonaIcon))
      },
    }
  },
})
