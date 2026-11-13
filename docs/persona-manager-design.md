# 人格管理插件设计

本文描述 `@xiaoxing/persona-manager` 当前的 0.1.0 实现。首次纳入 Git 的是已经验收的代码快照，不重建此前未受版本管理的中间版本。

## 1. 仓库与依赖

这是独立插件仓库：源码、包清单、资源、说明文档与许可均在本目录内。安装入口为本仓库根目录，不依赖仓库外的文件，也不依赖其他插件。不同插件分别维护自己的提交历史，不通过跨仓库相对导入互相调用。

```text
persona-manager/
├── .gitignore
├── .gitattributes
├── package.json
├── cordis.patch.yml
├── index.js
├── client.js
├── locale/
│   ├── en.json
│   └── zh.json
├── icon.svg
├── README.md
├── CONTRIBUTING.md
├── LICENSE
└── docs/
    └── persona-manager-design.md
```

Host 仅使用 Node 内置模块，Client 的 React 与 DSH 能力由宿主模块表提供。没有独立服务进程或 npm 运行依赖；DSH 的服务、Remote 描述符与槽位 API 属于宿主接口，升级时仍需验证兼容性。

| 宿主服务 | 用途 |
|---|---|
| `tools` | 注册模型工具，是 Host 的声明式依赖 |
| `configEditor` | 读取预设的继承配置，覆盖或还原原生配置 |
| `agentPresets` | 注册、注销、选择人格与 AI 编辑预设 |
| `sessionController` | 创建并激活 AI 编辑会话 |
| `sessions` | AI 编辑首条消息的持久化确认 |
| `workspaceRegistry` | 将 AI 编辑会话挂到首个工作区 |

后五项通过 `ctx.get` 延迟读取；缺失时按操作返回错误或不提供相关能力，不通过其他小星Bot插件补齐。

## 2. Host、Client 与 Remote

[index.js](<../index.js>) 为函数式插件，导出 `inject` / `apply`，通过 `ctx.effect` 注册 `xiaoxingPersona` 服务、`persona_manager` 工具与预设生命周期清理。

[client.js](<../client.js>) 通过 `window.__ModuleLoader__.load` 挂载。它注册 `settings.section` 与 `settings.section.icon`（ID 为 `xiaoxing-persona`），使用 `xiaoxing-persona` 命名空间中的中英文字典。

服务实例的 `typertRemote` 字段提供 `{service, serviceKey, namespace}` 绑定，原型上的 `@deepseek-ai/dsh-typert-protocol/remote-methods` 标记提供方法表。网关按源码中的简单 `request` 参数名派生 JSON 参数，因此 Remote 方法不能改成解构参数而仍沿用现有描述符。

Host 的 `remove` 在 wire 上导出为 `delete`，避免与客户端 Remote 命名空间已有方法冲突。Client 动态挂载 11 个方法后，通过 `ctx.get('remote.xiaoxingPersona')` 访问，而不是依赖未注入的属性代理。

Client 解包两层结果：外层为 Remote 的 `{ok, value}`，业务失败在内层以 `{ok:false, code, message}` 表达。服务的 `_guard` 统一把业务异常转为该失败对象；成功结果各方法不同，并非全部包含 `ok`。

## 3. 人设文件与导入

默认目录由 [cordis.patch.yml](<../cordis.patch.yml>) 中的 `!!js dshHomePath('xiaoxing', 'personas')` 提供。入口在缺少显式目录时尝试 `process.env.DSH_HOME`，未把 `profileContext.home` 传入配置解析函数。

每个人设为一个 `<id>.md`，frontmatter 字段包括 name、description、slot、order、enabled、sourceFormat、sourceFile、importedAt、emoji。文件 ID 保留 Unicode，剔除路径分隔符和 Windows 保留字符；显式 ID 必须是安全的单个文件名段。

文件按槽位、order、name 排序。组合时只取启用且正文非空的文件，对各正文 `trim()` 后用两个换行连接，返回 `{text, used, count}`。

保存器保留未知 frontmatter 字段，不改写正文措辞；但会去掉正文开头空行并补上结尾换行，不承诺字节级保真。文件与状态写入经同一个服务队列串行，写到同目录临时文件后 rename。

导入识别：

- OpenClaw：SOUL → voice；IDENTITY → identity；AGENTS → instructions，默认停用。用户画像、记忆、技能与运行配置不导入。
- Hermes SOUL：voice，名称取文件所在目录名。
- Hermes profile：读取 distribution 中的 name / version / description，version 只用于缺省描述；不保存 author 字段。
- Hermes YAML：personalities → overlay，当前选择项启用；system_prompt → instructions，默认停用。
- 通用 Markdown：voice，名称取一级标题或文件名。

YAML 解析器只实现所需子集，失败返回带位置的错误。疑似指令覆盖或零宽字符只产生告警。导入返回 `{ok, format, created, skipped, warnings}`。

## 4. 应用与恢复

应用是注册同名 Agent 预设，不是写入全局 deployment 人格。

1. 组合正文。空内容默认拒绝；只有显式 `allowEmpty` 才注销人格预设并移除应用记录。
2. 检测 `{{...}}` 模板组。`force` 只跳过此检查，不能保证严格模板插值成功。
3. **先注销旧预设，再查找可用 ID**，避免把上一次的自身注册误判为撞名。ID 与名称来自首个启用且有正文的文件；撞名时追加 `-persona-N`。
4. 从 `configEditor.configuration()` 读取 `preset-standard` 的已求值 inherited config，以其插件列表为模板，把原生 persona 行的 prefix 替换为正文；无需手写宿主预设的工具列表。
5. `agentPresets.register` 注册运行时预设（order 90），保存 disposer。新会话可选用；不自动切换默认模式或已开始的会话。
6. 读取 `settings.json` 中的覆盖开关。当前实现遍历所有可寻址且含 persona 行的 Agent 预设：开时替换 prefix，关时只还原 persona 行配置，保留其他子行自定义。
7. 把 `system-prompt` 行还原为 inherited config，清掉部署级用户人格。**整行还原也会移除该行其他覆盖项。**
8. 保存 `.applied.json`，包括 presetId、name、text、files、overrideBuiltIn、appliedAt。

Config Editor 的 `edit` 接收完整配置。当返回值与 inherited 等价时，宿主可删除多余的 profile 覆盖行；不直接改写 profile YAML。

Bootstrap 在 `agentPresets` 服务可用时执行：注册 AI 编辑预设，并从应用快照恢复人格预设。恢复使用快照 text，不重新组合编辑后尚未应用的文件。

禁用插件时运行时预设注销，但文件与快照保留。原生 profile 中已写入的覆盖不随插件禁用消失；关闭覆盖开关后再次应用才还原。`setOverrideBuiltIn` 仅持久化选择，不即时执行覆盖。

## 5. AI 编辑会话

`aiEdit` 可编辑指定文件，也可在未指定 ID 时辅助新建：

```text
sessionController.create（首个工作区）
  → resolveAgent
  → agentPresets.select('xiaoxing-ai-edit')
  → agent.followup（用户消息）
  → sessions.flush（服务可用时）
  → Client 跳转到新会话
```

`xiaoxing-ai-edit` 的模板来自内置 `preset-minimal` 的 inherited config（order 91）。它保留基础助理说明，但不携带已应用的用户人设。选择失败返回 `select-failed`，不回退到带用户人设的会话。

首条消息携带待编辑正文、存储格式约束、可选修改要求，要求只改正文、不引入模板组、完成后不自动应用。这里的正文属于编辑材料，提交为用户消息，不是会话系统人设。

## 6. 业务接口

| Host 方法 | request | 成功结果 |
|---|---|---|
| `list` | `{}` | `{files}`，不含正文 |
| `read` | `{id}` | `{file}`，含正文 |
| `write` | `{id?, name?, description?, slot?, order?, enabled?, emoji?, body}` | `{file}` |
| `remove` / wire `delete` | `{id}` | `{ok, id}` |
| `toggle` | `{id, enabled}` | `{file}` |
| `import` | `{path, format?}` | `{ok, format, created, skipped, warnings}` |
| `compose` | `{}` | `{text, used, count}` |
| `apply` | `{force?, allowEmpty?}` | `{ok, mode, presetId, presetName, appliedPrefix, overrideBuiltIn, deploymentCleared, overridden, restored, failures}` |
| `status` | `{}` | 目录与文件数量、应用快照、覆盖状态、部署人格、canApply |
| `aiEdit` | `{id?, instruction?}` | `{ok, sessionId}` |
| `setOverrideBuiltIn` | `{enabled}` | `{ok, overrideBuiltIn}` |

模型工具只有 `status` / `list` / `read` / `write` / `remove` / `toggle` / `import` / `compose` / `apply` 九种 action。参数使用原生 JSON Schema，包括 emoji、force、allowEmpty；`execute(args)` 调用相同业务方法。工具返回 `{ok, summary, data?}`，摘要作为模型可见文本渲染。

## 7. 验证与已知边界

当前代码在纳入 Git 前已完成 DSH 设置页、人设编辑与导入、同名预设重复应用、AI 编辑不带用户人设、覆盖开关、重启恢复的人工验证。具体私人数据与人设名不纳入验证文档。

仓库初始化后的检查范围见 [CONTRIBUTING.md](<../CONTRIBUTING.md>)。当前没有自动化行为测试；语法与文件检查不代表 Remote、渲染或宿主升级验证通过。

- 依赖宿主内置行 ID `preset-standard` / `preset-minimal`；模板缺失时相关预设能力不可用。
- 覆盖遍历范围不限定为固定四个内置模式，部署级还原是整行配置还原。
- 组合文本是严格模板输入，强制应用含模板组的正文仍可能在运行时失败。
- 不负责选择 IM 插件的默认预设；其他插件需通过 DSH 原生预设名册显式选用。
- 人设与应用快照属于用户私有数据；Git 管理的是插件源码，不是这些数据的备份。

许可与作者见仓库 [LICENSE](<../LICENSE>) 和 [package.json](<../package.json>)。
