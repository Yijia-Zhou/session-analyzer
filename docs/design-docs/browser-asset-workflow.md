# Browser asset workflow / 浏览器资产流程

Status: accepted on merge / 状态：合入后生效

## Policy / 规则

Daily development builds and tests current source, but ordinary PRs omit changes to these two generated files. Both remain tracked; existing history is retained. / 日常开发构建并测试当前源码，但普通 PR 不提交以下两个生成文件的变更。文件仍受 Git 跟踪，保留既有历史。

- `public/assets/app.js`
- `public/vendor/highlightjs/highlight.min.js`

`public/index.html`, CSS, notices, source, tests and documentation remain ordinary reviewed files. A release PR targeting `main` commits assets generated from its final source. `main` and release tags retain matching assets. A same-repository `main` backmerge may bring this verified snapshot into development. / HTML、CSS、许可证声明、源码、测试和文档仍正常提交与审查。面向 `main` 的发布 PR 提交由最终源码生成的资产；`main` 与发布 tag 保持匹配。同仓库 `main` 回灌可将已验证快照带回开发分支。

The benefit is smaller review diffs and fewer generated-file conflicts; the cost is rebuilding for branch previews and historical investigation. Git storage reduction is not the goal. / 收益是减少评审 diff 与生成文件冲突，代价是分支预览和历史排查时需要重建。目标并非节省 Git 存储。

## Local development / 本地开发

After the [pinned toolchain and strict dependency setup](../development.md), run: / 完成[固定工具链与严格依赖配置](../development.md)后运行：

```sh
npm run dev -- --repo /path/to/project
```

This builds before server startup and forwards arguments to the server. It is not a watcher: restart after source changes. `npm start`, direct `node server.js` and installed CLI startup continue to serve existing assets, without adding build dependencies to the installed package. Build first whenever using those source-checkout paths. / 此入口先构建再启动服务，并转发参数。它不是 watch：源码修改后重新启动。`npm start`、直接运行 server 与已安装 CLI 仍使用已有资产，不给安装包增加构建依赖；在源码 checkout 使用这些入口前须先构建。

Build and verify behavior before restoring generated changes for a development commit: / 开发提交前先构建并核验行为，再仅恢复生成文件的变更：

```sh
npm run build
npm run build:check
git restore --source=HEAD --staged --worktree -- public/assets/app.js public/vendor/highlightjs/highlight.min.js
git diff --check
```

Restore only these paths. This leaves local assets stale when source changed; run `npm run dev` for the next preview, or rebuild before browser/package tests. Do not use `assume-unchanged`, `skip-worktree`, blanket cleanup or deletion. / 仅恢复这两个路径。源码有变时，这会使本地产物落后；下次预览运行 `npm run dev`，浏览器／安装包测试前重新构建。不要用 `assume-unchanged`、`skip-worktree`、整树清理或删除文件。

For a PR opened under the old policy, first sync the migration's target branch, then restore these paths from that updated target ref, commit the adjustment and rebuild locally. Do not remove handwritten HTML/CSS or rewrite unrelated history. / 旧规则下打开的 PR，先同步已迁移的目标分支，再从更新后的目标 ref 恢复这两个路径、提交调整，并在本地重建。不要移除手写 HTML／CSS 或重写无关历史。

Historical checkout and `git bisect` must include compatible dependencies and `npm run build` at each candidate. / 检出历史提交和 `git bisect` 的每个候选都须准备匹配依赖并运行构建。

## CI and release / CI 与发布

`scripts/ci-assets.js policy` runs without dependency installation in the full-history scope job. Ordinary PRs compare their exact merge-base diff and fail if either generated path changed, including moves or deletion. Missing commits/history fail the gate. PRs targeting `main`, main pushes and tag dispatches select `committed`; development pushes and ordinary PRs select `rebuild`. Same-repository `main` backmerges may update the saved release assets and select `rebuild`, because the merged development source may already be newer than that release. Unknown event contexts fail. / 策略脚本在具备完整历史的 scope job 中运行，无需安装依赖。普通 PR 检查精确 merge-base diff，任一生成路径发生变化（包括移动或删除）即失败；缺少提交／历史也失败。面向 `main` 的 PR、main push 和 tag dispatch 选择 committed；开发 push 与普通 PR 选择 rebuild。同仓库 `main` 回灌可更新已保存的发布资产，但合并后的开发源码可能已领先于发布，因此选择 rebuild。未知事件上下文失败。

Every Node, package and browser job prepares its own assets after strict installation. `rebuild` generates from current source; `committed` calls the existing non-mutating `--check` before testing. The final CI gate still requires scope and all required suites. / 每个 Node、安装包和浏览器 job 都在严格安装后独立准备资产。rebuild 从当前源码生成；committed 在测试前调用已有的非修改式检查。最终 CI 仍要求 scope 与所有必需套件通过。

Release preparation builds and commits both assets on the release branch before final review. `release:check` still starts with `build:check`; `prepublishOnly` and the publication workflow do not rebuild to repair stale committed assets. Candidate hashing, exact-main identity, Linux/Windows verification, npm staging and human approval follow the [release runbook](npm-release-runbook.md). / 发布准备在 release 分支最终审查前构建并提交两份资产。release:check 仍以一致性检查开头；prepublishOnly 与发布 workflow 不通过重建来修补落后的已提交资产。候选哈希、精确 main 身份、Linux／Windows 验证、npm staging 与人工审批继续遵循[发布手册](npm-release-runbook.md)。

Validation must demonstrate both paths: stale assets are replaced for development tests, while committed/release checks fail without changing those bytes. / 验证须同时证明：开发测试替换落后资产；提交／发布检查失败且不改变这些字节。
