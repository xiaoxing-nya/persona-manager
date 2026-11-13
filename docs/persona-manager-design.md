# 人格管理插件设计

本文描述独立插件 `@xiaoxing/persona-manager` 的 `0.2.0-rc.3` 发布候选。首次 Git 导入的 0.1.0 是此前已验收快照；后续候选在其上进行有测试的产品化修复，本轮加入 USER.md 用户资料类别，保留单一预览和规范槽位，不重建历史中间版本。

## 1. 仓库与依赖

源码、资源、默认模板、文档、许可和测试都在本仓库内，只通过 DSH 原生服务协作，不依赖其他插件源码或本机父目录布局。

| 文件/目录 | 职责 |
|---|---|
| [index.js](<../index.js>) | Host 服务、模型工具、文件管理与预设生命周期 |
| [client.js](<../client.js>) | 设置页、Remote 挂载、状态与用户确认 |
| [defaults/basic.md](<../defaults/basic.md>) | 中性、最小基础人格模板 |
| [package.json](<../package.json>) | 独立包、兼容范围、资源与检查入口 |
| [cordis.patch.yml](<../cordis.patch.yml>) | 插入 Host 行并提供默认目录 |
| `tests/` | 隔离行为与 Client 注册契约测试 |
| `scripts/` | 包文件、默认模板与文档链接检查 |

Host 仅使用 Node 内置模块。React 与 Client 服务由 DSH 模块表提供；没有 npm 运行依赖或独立 Web 服务。兼容声明面向 DSH `>=0.2.2-rc.1 <0.3.0-0`，实际宿主接口核验基于 `0.2.2-rc.1`；这不是对未测试版本的实机认证。

声明式 Host 依赖为 `tools`；`agentPresets`、`configEditor`、`sessionController`、`sessions`、`workspaceRegistry`、`workingDirectory` 与 `profileContext` 按需要读取。可选服务不缓存缺失状态，缺失能力通过状态/错误明确显示。

## 2. 首次使用与文件安全

数据目录优先取 `personaDir`，再取 `profileContext.home` / `DSH_HOME` 下的 `xiaoxing/personas`。默认值由 bundle 的 `!!js dshHomePath(...)` 提供，目录不属于源码仓库。

启动安排 `initialize()`，与后续操作使用同一队列：

1. 有合法 `.initialized.json` 时不再创建默认文件。
2. 未初始化且目录已有任何内容时，仅记录初始化，不插入默认人格。
3. 真正空目录中以 `wx` 独占创建 `basic.md`，不覆盖已有文件。
4. 写入版本为 1 的初始化记录；不应用人格、不切换默认预设。

删除基础人格不触发重建；删除整个目录与记录才视为全新安装。`list` / `compose` 保持只读，可在无目录时返回空结果；初始化失败会记录诊断，仍能浏览可读文件。

人设 ID 保留 Unicode，最长 120 字符，禁止路径分隔符、Windows 保留字符与设备名。重名后缀计入长度限制。写操作校验 body、enabled、排序等类型；临时文件用唯一名称与独占创建后 rename。文件符号链接和目录不能充当人设/状态文件。

Frontmatter 仍为扁平字段，未知键编辑时保留；正文不自动改写措辞，但会清理开头空行并补结尾换行。组合时只取启用的非空正文，按 slot / order / name 排序，trim 后以两个换行连接。

槽位顺序为 `identity → voice → user → instructions → personality`，Host、Client、工具枚举与 Hermes personalities 导入使用同一组名称。user 表示用户明确提供的资料，区别于助手 identity；不自动创建默认资料。只增加类别，不添加旧槽位别名或迁移路径，不自动修改用户文件。

## 3. Remote 与错误

`xiaoxingPersona` 实例上有 `typertRemote` 绑定，原型上有 Remote 方法标记；每个 Remote 方法使用简单 `request` 参数。Host `remove` 的 wire 名为 `delete`，避免与客户端命名空间冲突。

Client 通过 `ctx.get('remote.xiaoxingPersona')` 访问，解包 Remote 与业务两层结果。业务失败为 `{ok:false, code, message}`。损坏 JSON 报 `invalid-state`，不把坏文件静默替换成空状态。

Remote 挂载失败仍注册设置页错误入口。刷新不会吞掉刚发生的操作错误；缺服务不是永久 loading，也不是“目录没有文件”。设置页只有一个「预览组合」入口，调用 `compose` 展示当前启用且已保存文件的组合全文；展开后同一按钮收起，再展开重新读取。它不是已应用快照，也不包含编辑器里尚未保存的草稿；应用、保存、导入、开关或刷新后收起旧预览。

`status` 区分覆盖偏好、实际覆盖、应用快照是否加载、待应用修改、首次创建与可用能力。不存在的导航能力只禁用 AI 操作；跳转失败保留面板并显示已创建的会话 ID。

## 4. 应用事务与覆盖所有权

应用创建同名运行时预设，不自动选中默认模式，也不改变已开始会话的版本。

1. 校验正文/模板组、宿主服务、标准预设模板与应用快照。
2. 查名册时只排除本插件拥有的旧应用预设，不吞名册失败；ID 与名称来自首个参与组合文件。
3. 计算完整配置计划，限定四个内置行：`preset-standard` / `preset-ptc` / `preset-minimal` / `preset-cordis`。
4. 只有存在不同于 inherited 的非空部署级人格时才要求 `clearDeployment`。无用户部署人格的出厂配置不需要确认，也不写 `system-prompt`。
5. 注销旧应用注册，再注册候选；`register` 可返回 broken 预设，因此用户应用路径还通过 `resolve` 检查可用性。
6. 按计划调用 `configEditor.edit`；在修改点重新取当前行，拒绝被替换的快照。
7. 最后提交 `.applied.json`。此前任意失败恢复旧注册与已尝试的配置；回滚只覆盖仍等于本次输出的配置，外部修改保留。恢复失败明确报 `rollback-failed`。

覆盖开时保存四个预设的原始 persona 配置，只写 prefix。重复应用保留原基线；用户在其他入口改了 prefix 后，再次明确覆盖则捕获新的基线。关时仅恢复仍等于本插件上次输出的 prefix，保留当前 suffix / complete / includeRuntimeContext 和其他子行；从未由本插件覆盖的预设不动。

部署级移除也是字段级：只把用户 personaPrefix / personaSuffix 恢复为 inherited 值，保留宿主基础 coding prompt、toolOrder 等其他设置。不会写空字符串去抹掉宿主默认说明。

应用记录兼容旧版未带版本字段的快照，新记录为 version 1，并含 builtInOriginals。覆盖偏好仅保存选择，下一次 Apply 才改变配置；状态显示实际结果，不以选择值冒充生效。

## 5. 预设启动与卸载

`ctx.inject` 自己拥有 child Fiber，不能把返回的 Fiber 当作 `ctx.effect` disposer。启动恢复进服务队列，避免与用户 apply 并发。

Bootstrap 从 `.applied.json` 恢复原快照，不重新组合尚未应用的文件；AI 编辑模板来自内置 minimal 的 inherited 配置。Bootstrap 不等待可能依赖全局 Loader 完成的诊断，用户操作与状态查询再检查 broken。

卸载首先关闭操作准入，等待在途队列，再等待每个注册 disposer。卸载期间晚到的注册立即释放；不清空 map 后放任异步注册重新写回。没有按 ID 强行注销其他插件预设的路径。

同名预设禁用后不再供新会话选择，文件与快照保留。原生 profile 覆盖不会因插件禁用自动消失，需明确关闭覆盖后再次应用。

## 6. AI 编辑与导入边界

AI 编辑先检查本插件拥有的 `xiaoxing-ai-edit`，再调用 `sessionController.create({agentPreset: 'xiaoxing-ai-edit', ...})`。不先按默认用户人格建会话再尝试 select。正文为用户消息中的编辑材料，不是系统人格；未保存的既有正文要求先保存，新建草稿可携带参考。

`agent.followup` 入队后可调用 `sessions.flush`；false 表示没有持久化监听器，不是失败，只有拒绝才报错。已有会话不会被自动应用人格。

导入支持 OpenClaw、Hermes 与通用 Markdown，规则见 [README](<../README.md>)。统一使用普通文件与有界字节读取，默认每文件 1 MiB（可配置）。隐藏配置文件与私有 DSH 状态拒绝导入。模型工具的导入还限定请求会话工作目录或人格目录，真实路径必须仍在范围内；外部来源由设置页的用户显式选择。

YAML 为所需子集，不是完整 YAML；解析失败返回位置。疑似注入只告警，不保证任意外部人设可信。插件与预设不是安全沙箱，导入设定应由用户审阅。

USER.md 可在 OpenClaw 工作区中或作为单独 Markdown 导入，归入 user；不读取记忆或运行配置。用户资料的 AI 提示仅整理已提供事实，不猜填个人信息；新草稿的类别从 Client 传入并在创建会话前校验。

## 7. 业务接口

| 方法 | request / 特点 |
|---|---|
| list / read / write / remove / toggle | 文件操作，返回文件投影或明确失败 |
| import | `{path, format?}`，返回 created / skipped / warnings |
| compose | `{}`，返回 text / used / count，不应用 |
| apply | `{force?, allowEmpty?, clearDeployment?}`，返回实际预设、覆盖/恢复/跳过与部署移除结果 |
| status | `{}`，返回快照与 canApply / canAiEdit / needsApply 等实际状态 |
| aiEdit | `{id?, instruction?, slot?}`，新草稿使用所选 slot；已有文件以磁盘类别为准，返回新会话 ID |
| setOverrideBuiltIn | `{enabled}`，只保存覆盖选择 |

模型工具有九种 action，不提供 AI 开会话或覆盖开关授权；结果为 `{ok, summary, data?}`。工具描述精简为用途与关键行为，导入范围和清空约束放在参数上。

## 8. 检查范围

当前有 51 项隔离测试：37 项生命周期/CRUD/槽位/事务/AI 提示，9 项导入与状态，5 项 Client 注册与用户资料/单一预览契约。注册测试不创建模拟页面，也不能替代真实视觉与点击验证。测试目录均为可识别、可清理的临时目录，不操作真实用户人设。

[维护约定](<../CONTRIBUTING.md>)规定包检查、测试、Git 检查与真实 DSH 验证分开记录。正式上传/发布不在本轮自动化步骤中，`private` 保护与远程目标保持待用户确认。
