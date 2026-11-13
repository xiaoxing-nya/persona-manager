# 小星人格管理

`@xiaoxing/persona-manager` 是独立的 DeepSeek Harness（DSH）插件仓库。它管理 Markdown 人设文件，支持导入 OpenClaw / Hermes Agent 设定、可视化编辑和 AI 辅助编辑，并把启用内容应用为同名 Agent 预设。

插件只依赖 DSH 原生服务，不依赖其他小星Bot插件或 IM 插件。人格文件与本机运行状态不属于源码仓库。

## 功能

- 多个人设文件独立启用，按 `identity → voice → instructions → overlay` 的槽位顺序组合。
- 设置页编辑名称、描述、槽位、排序、正文，支持组合预览与导入。
- 应用后注册同名 Agent 预设，用户自行在新会话的模式选择器中选用；不切换宿主默认选中的预设。
- 可选覆盖内置预设的人格，默认关闭；已有会话继续保留其原预设。
- 「AI辅助」开启新的编辑会话，使用专用预设，不带已应用的用户人设；编辑结束不自动应用。

## 使用

在 DSH 插件管理中安装本仓库的绝对目录，打开「设置 → 小星人格」管理人设。也可通过 DSH CLI 安装，下面的路径与 profile 名称需替换为实际值：

```powershell
dsh plugin --profile desktop add 'C:\path\to\persona-manager'
```

安装是否即时生效以 DSH 返回结果为准；需要重启或刷新时按提示操作。CLI 与 Desktop 的安装要求以所用 DSH 版本的说明为准。

## 配置与本机数据

本仓库的 `cordis.patch.yml` 插入 `xiaoxing-persona-manager` 行，携带：

```yaml
config:
  personaDir: !!js dshHomePath('xiaoxing', 'personas')
```

`personaDir` 为人设目录，通常解析为 `<DSH_HOME>/xiaoxing/personas`，不存在时首次文件操作创建。插件未声明 Config schema；未提供该字段时，当前入口尝试使用 `process.env.DSH_HOME`，两者均不可用时，需要读写人设目录的操作返回 `no-home`，列表与组合等只读操作仍可返回空结果。入口未接入 `profileContext.home` 回退。

该目录保存：

| 文件 | 用途 |
|---|---|
| `<id>.md` | 人设正文与 frontmatter |
| `.applied.json` | 已应用的预设 ID、名称、正文快照、来源文件、覆盖状态与应用时间 |
| `settings.json` | `overrideBuiltInPresets` 开关 |

这些是用户私有数据，不随本仓库提交或发布。不要把真实人设、凭据、会话日志放进源码目录；本地测试数据可放在已忽略的 `.local/` 下。

## 人设格式

```markdown
---
name: 示例人格
description: 用于说明文件格式
slot: voice
order: 100
enabled: true
sourceFormat: manual
sourceFile: ""
importedAt: ""
emoji: ""
---

人设正文。
```

- `id` 为文件名去掉 `.md`；创建时由 `name` 派生，保留 Unicode，去除路径分隔符与 Windows 保留字符，空白改为 `-`，重名时追加序号。
- 文件按槽位、`order`、`name` 排序，只有启用且正文非空的文件参与组合。
- 正文不会被自动润色；保存时去掉开头空行并补上结尾换行，因此不承诺字节级原样保存。
- frontmatter 使用扁平字段，未知字段在编辑已有文件时保留。

## 应用与预设生命周期

1. 组合启用的正文。空内容默认拒绝，只有明确传入 `allowEmpty: true` 才清空已应用的人格。
2. 检测 `{{...}}` 模板组；默认拒绝，`force: true` 可强制应用，但原生严格插值仍可能失败。
3. 注销上一次注册的预设，再以首个参与组合文件的 ID / 名称注册同名预设。ID 撞名时追加 `-persona-N`。
4. 预设模板来自内置 `preset-standard` 行的已求值继承配置，不硬编码工具与插件列表；用户人格进入其原生 `dsh-persona` 的 `prefix`。
5. 根据已保存的覆盖开关，覆盖或还原可寻址预设中的 persona 行。当前实现遍历所有含 persona 行的 Agent 预设，不仅限于固定四个内置模式；还原时保留其他子行的用户自定义。
6. 将 `system-prompt` 行还原为继承配置，清除部署级用户人格。**这是整行还原，也可能移除该行其他自定义配置，应用前应确认。**
7. 保存 `.applied.json`。重启时按快照恢复注册，不重新组合尚未应用的修改。

同名预设是运行时注册：禁用或卸载插件后不再出现在预设名册中，重新启用时从快照恢复。内置预设覆盖保存在原生 profile 配置中，禁用插件不会自动还原；需在插件启用时关闭覆盖开关并再次应用。

覆盖开关只保存选择，下一次「应用人格」时才更新预设。

## AI 辅助

点击「AI辅助」后，插件通过原生 `sessionController` 创建新会话，挂到首个已注册工作区，并在首轮开始前选择 `xiaoxing-ai-edit`。

该预设来自内置 `preset-minimal` 的继承配置，保留基础助理说明，不带用户已应用的人设。正文、格式约束与可选编辑要求作为新会话的用户消息提交，随后跳转到该会话。要求编辑代理只修改正文、不引入 `{{...}}` 模板组，完成后不自动应用。

## 导入

| 输入 | 行为 |
|---|---|
| OpenClaw 工作区（含 `SOUL.md`） | `SOUL.md` → voice；`IDENTITY.md` → identity；`AGENTS.md` → instructions，默认停用。跳过用户画像、记忆、技能与运行配置。 |
| Hermes `SOUL.md` | voice，名称取文件所在目录名。 |
| Hermes profile（含 `distribution.yaml`） | 读取 name / version / description，导入 `SOUL.md`；version 只用于缺省描述，不保存 author 字段。 |
| Hermes YAML 配置 | `agent.personalities` → overlay；当前选择的 personality 初始启用；`agent.system_prompt` → instructions，默认停用。 |
| 其他 Markdown | voice，名称取一级标题或文件名。 |

导入返回 `{ok, format, created, skipped, warnings}`。正文中疑似指令覆盖、零宽字符等只产生告警，不阻断。YAML 解析器为自写子集，不支持完整 YAML；失败返回带位置的错误，不尝试猜测。

## 服务与模型工具

Host 服务 `xiaoxingPersona` 与设置页共用业务操作。Remote 方法：`list`、`read`、`write`、`delete`、`toggle`、`import`、`compose`、`apply`、`status`、`aiEdit`、`setOverrideBuiltIn`。

Host 的删除实现名为 `remove`，wire 导出名为 `delete`，避免与客户端命名空间已有方法冲突。客户端通过 `ctx.get('remote.xiaoxingPersona')` 访问。

模型工具 `persona_manager` 的 action 为 `status` / `list` / `read` / `write` / `remove` / `toggle` / `import` / `compose` / `apply`；`aiEdit` 与覆盖开关是设置页操作，不是工具 action。工具结果为 `{ok, summary, data?}`。

## 开发与许可

Host 只使用 Node 内置模块；Client 的 React 与 DSH 服务由宿主模块表提供。没有 npm 运行依赖，也没有独立 Web 服务。

```powershell
node --check index.js
node --check client.js
git status --short
```

本仓库目前没有自动化行为测试。语法检查不能代替 DSH 中的安装、Remote 调用、预设生命周期与界面验证。

- [设计说明](<docs/persona-manager-design.md>)
- [维护与提交约定](<CONTRIBUTING.md>)

作者：xiaoxing-nya `<xiaoxing_bot@luoli.my>`。许可：[MIT](<LICENSE>)。
