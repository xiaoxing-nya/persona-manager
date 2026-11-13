# 维护与提交

## 独立仓库

本目录是 `@xiaoxing/persona-manager` 的仓库根，也是 DSH 安装入口。源码与文档应可单独检出、阅读与安装，不能依赖本仓库之外的文件或其他插件源码。

插件间通过 DSH 原生服务与预设接口协作，不添加跨仓库相对导入、共享可变全局状态或隐式 IM 插件依赖。本仓库自包含，不使用子模块。

## Git 身份

仓库本地作者与提交者使用：`xiaoxing-nya <xiaoxing_bot@luoli.my>`，不修改全局 Git 身份。

```powershell
git config --local user.name 'xiaoxing-nya'
git config --local user.email 'xiaoxing_bot@luoli.my'
git log --format='%h %s | %an <%ae> | %cn <%ce>'
```

这里是提交署名，不是 GPG / SSH 密钥签名；没有配置或伪造签名证书。

## 提交历史

初始化采用当前已验收的 0.1.0 快照，不重建未保存的旧版代码，不倒签日期，不把内部迭代编号当作已发布版本。

后续按实际改动组织提交，例如 `feat(persona): ...`、`fix(persona): ...`、`docs(persona): ...`、`chore(repo): ...`。每个提交只解决一个明确问题，但 Host、Client、包清单与必要资源应保持一致，避免提交半套插件。

没有配置远程仓库；推送、公开发布与重写已经分享的历史需要单独确认。

## 提交前检查

在本仓库根运行：

```powershell
npm run check
npm test
git diff --check
git diff --cached --check
git status --short
```

修改行为时，还应在 DSH 中验证设置页与工具共用操作、Remote 请求、预设应用/还原/注销、重启恢复、AI 编辑会话。使用临时测试人设，不覆盖真实用户数据；验证后恢复测试改动。

当前包含 42 项 Node 隔离测试，没有独立构建流程。`tests/run.mjs` 逐个以继承标准输出的独立进程执行，避免 Node test runner 的管道捕获限制。语法、行为测试、打包清单、Git 检查和真实界面验证分别记录，不能相互替代。

打包使用 `pnpm pack`，检查压缩包中的 defaults/basic.md、Host/Client、patch、locale、图标与文档；应从解包目录验证首次创建，不只检查链接安装。

## 私有数据

不提交真实人设、应用快照、凭据、profile 配置、会话日志或本机路径。默认运行目录位于 DSH_HOME，Git 与安装目录都不需要访问它。

本地测试数据使用 `.local/` 或源码仓库外的临时目录；`.gitignore` 中的排除规则只是辅助，暂存前仍要检查实际文件清单。`.gitattributes` 统一文本为 LF。

包清单保持 `private: true`，避免误发布；当前维护者署名与 MIT 许可位于 `package.json` / `LICENSE`。
