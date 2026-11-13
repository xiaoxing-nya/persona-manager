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

在 DSH 插件管理中安装本仓库的绝对目录或经检查的安装包，打开「设置 → 小星人格管理」管理人设。也可通过 DSH CLI 安装，下面的路径与 profile 名称需替换为实际值：

```powershell
dsh plugin --profile desktop add 'C:\path\to\persona-manager'
```

安装是否即时生效以 DSH 返回结果为准；需要重启或刷新时按提示操作。CLI 与 Desktop 的安装要求以所用 DSH 版本的说明为准。

## 首次使用与基础人格

首次启用会创建数据目录，仅在目录为空且不存在初始化记录时复制 [最小基础人格模板](<defaults/basic.md>) 为 `basic.md`：

> 你是一位友好、可靠的助手。使用用户的语言交流，表达清楚简洁；不确定时如实说明。

名称为「基础人格」，`slot: voice`、`enabled: true`。它不会自动应用或切换模式：可以先编辑，再点击「预览组合 → 应用人格」，然后在新会话中选择对应预设。

已有任何文件的目录不会插入默认人格，也不会覆盖现有设定或应用快照。`.initialized.json` 记录初始化；删除基础人格后不会在重启时重新生成。删除整个数据目录连同记录，相当于重新初始化。

## 配置与本机数据

本仓库的 `cordis.patch.yml` 插入 `xiaoxing-persona-manager` 行，携带：

```yaml
config:
  personaDir: !!js dshHomePath('xiaoxing', 'personas')
```

`personaDir` 为人设目录，通常解析为 `<DSH_HOME>/xiaoxing/personas`。未提供时依次使用 `profileContext.home`、`process.env.DSH_HOME`。全部不可用时，写操作返回 `no-home`，列表与组合仍可返回空结果。首次创建失败会在状态中给出诊断，不阻断已有文件的只读浏览。

`maxImportBytes` 控制每个导入文件的字节上限，默认 1048576（1 MiB），可配置为 1–67108864。插件不声明 Config schema，以上选项通过自己的 Cordis 插件行配置；不手工覆盖整个 profile 文件。

该目录保存：

| 文件 | 用途 |
|---|---|
| `<id>.md` | 人设正文与 frontmatter |
| `.applied.json` | 应用快照、来源文件、覆盖状态与覆盖前原始人格配置 |
| `.initialized.json` | 首次初始化记录，避免删除后重新生成默认人格 |
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

- `id` 为文件名去掉 `.md`，最长 120 字符；创建时保留 Unicode、清洗路径分隔符和 Windows 保留字符，重名时安全追加序号。设备名如 `CON` / `NUL` 不可显式使用，自动派生时会加前缀。
- 只接受普通人设文件，不跟随文件符号链接；损坏状态文件保留并明确报错，不静默重置。
- 文件按槽位、`order`、`name` 排序，只有启用且正文非空的文件参与组合。
- 正文不会被自动润色；保存时去掉开头空行并补上结尾换行，因此不承诺字节级原样保存。
- frontmatter 使用扁平字段，未知字段在编辑已有文件时保留。

## 应用与预设生命周期

1. 组合启用的正文。空内容默认拒绝，只有明确传入 `allowEmpty: true` 才清空已应用的人格。
2. 检测 `{{...}}` 模板组；默认拒绝，`force: true` 可强制应用，但原生严格插值仍可能失败。
3. 先完成模板、名册和状态校验，再替换预设；ID / 名称取首个参与组合文件，撞名时追加 `-persona-N`。注册后的加载失败也会被检查，失败时恢复旧注册。
4. 预设模板来自内置 `preset-standard` 行的已求值继承配置，不硬编码工具与插件列表；用户人格进入其原生 `dsh-persona` 的 `prefix`。
5. 覆盖只针对 `standard` / `ptc` / `minimal` / `cordis` 四个内置预设。记录覆盖前的配置；关闭时只恢复本插件写入的 prefix，保留其他字段与外部修改，第三方预设不动。
6. 若存在不同于宿主继承值的部署级自定义人格，需明确确认 `clearDeployment: true` 后才还原对应 prefix / suffix；默认基础提示词、`toolOrder` 等其他设置保持不变。
7. 配置更新与快照写入失败会尝试回滚；外部并发修改不会被回滚覆盖。恢复失败明确返回 `rollback-failed`，需检查当前状态再重试。快照最后提交，重启恢复使用快照，不重新组合未应用修改。

同名预设是运行时注册：禁用或卸载插件后不再出现在预设名册中，重新启用时从快照恢复。内置预设覆盖保存在原生 profile 配置中，禁用插件不会自动还原；需在插件启用时关闭覆盖开关并再次应用。

覆盖开关只保存选择，下一次「应用人格」时才更新预设。

## AI 辅助

点击「AI辅助」后，插件检查专用预设可用性，并通过原生 `sessionController.create` 直接指定 `xiaoxing-ai-edit`，挂到首个已注册工作区；不先创建带默认用户人设的会话再切换。已有文件请先保存正文修改，新建草稿可作为创作参考带入。

该预设来自内置 `preset-minimal` 的继承配置，保留基础助理说明，不带用户已应用的人设。正文、格式约束与可选编辑要求作为新会话的用户消息提交，随后跳转到该会话。要求编辑代理只修改正文、不引入 `{{...}}` 模板组，完成后不自动应用。

## 导入

| 输入 | 行为 |
|---|---|
| OpenClaw 工作区（含 `SOUL.md`） | `SOUL.md` → voice；`IDENTITY.md` → identity；`AGENTS.md` → instructions，默认停用。跳过用户画像、记忆、技能与运行配置。 |
| Hermes `SOUL.md` | voice，名称取文件所在目录名。 |
| Hermes profile（含 `distribution.yaml`） | 读取 name / version / description，导入 `SOUL.md`；version 只用于缺省描述，不保存 author 字段。 |
| Hermes YAML 配置 | `agent.personalities` → overlay；当前选择的 personality 初始启用；`agent.system_prompt` → instructions，默认停用。 |
| 其他 Markdown | voice，名称取一级标题或文件名。 |

导入只读普通文件，每个文件受 `maxImportBytes` 限制；隐藏配置文件与非人格目录中的私有 DSH 状态不能作为来源。模型工具限于当前会话工作目录或已配置的人格目录，并验证真实路径；工作区外的来源由用户在设置页显式导入。导入不是通用文件读取工具。

导入返回 `{ok, format, created, skipped, warnings}`。正文中疑似指令覆盖、零宽字符等只产生告警，不阻断。YAML 解析器为自写子集，不支持完整 YAML；失败返回带位置的错误，不尝试猜测。

## 服务与模型工具

Host 服务 `xiaoxingPersona` 与设置页共用业务操作。Remote 方法：`list`、`read`、`write`、`delete`、`toggle`、`import`、`compose`、`apply`、`status`、`aiEdit`、`setOverrideBuiltIn`。

Host 的删除实现名为 `remove`，wire 导出名为 `delete`，避免与客户端命名空间已有方法冲突。客户端通过 `ctx.get('remote.xiaoxingPersona')` 访问。

模型工具 `persona_manager` 的 action 为 `status` / `list` / `read` / `write` / `remove` / `toggle` / `import` / `compose` / `apply`；`aiEdit` 与覆盖开关是设置页操作，不是工具 action。工具结果为 `{ok, summary, data?}`。

## 开发与许可

Host 只使用 Node 内置模块；Client 的 React 与 DSH 服务由宿主模块表提供。没有 npm 运行依赖，也没有独立 Web 服务。

```powershell
npm run check
npm test
git status --short
```

包含 42 项隔离测试（首次使用、CRUD、预设事务与清理、导入边界、Client 注册）。测试不使用真实用户数据；Node 子进程继承标准输出，不依赖 test runner 的管道捕获。语法与隔离测试不能代替 DSH 中的真实界面验证。

当前为 `0.2.0-rc.1` 发布候选；Node 22+，兼容声明为 DSH `>=0.2.2-rc.1 <0.3.0-0`，实机核验基于 `0.2.2-rc.1`，其他版本需复测。保持 `private: true`，未配置远程仓库或执行上传；实际发布前另行确认目标仓库/渠道。

- [设计说明](<docs/persona-manager-design.md>)
- [维护与提交约定](<CONTRIBUTING.md>)
- [发布前检查报告](<docs/release-check.md>)

作者：xiaoxing-nya `<xiaoxing_bot@luoli.my>`。许可：[MIT](<LICENSE>)。
