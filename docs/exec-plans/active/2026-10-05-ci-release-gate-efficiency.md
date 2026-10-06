# CI and release gate efficiency / CI 与发布 gate 效率

Status: implementation, local validation and hosted full-scope Actions acceptance complete on `v0.3.0-development`; hosted docs-only PR skip acceptance remains pending. Version 0.3.0 is provisional; package version remains 0.2.1. / 状态：已在 `v0.3.0-development` 完成实现、本地验证及 hosted 全量 Actions 验收；纯文档 PR 跳过路径的 hosted 验收仍待完成。0.3.0 为暂定目标；package 版本保持 0.2.1。

## Scope and decisions / 范围与决策

- Allow only PRs whose complete merge-base diff consists of ordinary Markdown files at `README.md`, `README.zh-CN.md`, `docs/development.md`, or `docs/exec-plans/**/*.md` to omit the browser job. Retain all Node and package checks. Main/development pushes and manual CI remain full. / 仅当 PR 完整 merge-base diff 全部为上述路径的普通 Markdown 文件时省略 browser job；保留全部 Node 与 package 检查。Main／开发分支 push 和手动 CI 仍为全量。
- Unknown paths, binary content, file types, incomplete history/diff/statistics, and empty comparisons require browser coverage. Moves qualify at both old and new paths. A failed/cancelled classification job cannot grant a successful aggregate result. / 未知路径、二进制内容、文件类型、不完整历史／diff／统计与空比较均要求 browser 覆盖。移动须同时核对新旧路径；分类 job 失败或取消不能使聚合结果成功。
- Keep the required workflow running and its `ci` job always evaluating expected outcomes. Accept browser `skipped` only for an explicitly classified documents-only PR with the other required jobs successful. / 必需 workflow 始终触发，`ci` 始终评估预期结果；仅对明确分类为纯文档且其他必需 job 成功的 PR 接受 browser `skipped`。
- In the unprivileged publish verify job, use the guarded directory dry-run to invoke `prepublishOnly` → `release:check` once, before browser/audits/hash recording. Preserve stage permissions, Environment, source/hash reproduction and maintainer approvals. / 在无特权 publish verify job 中，通过目录 dry-run 触发一次 `prepublishOnly` → `release:check`，然后执行 browser／audit／hash。保留 stage 权限、Environment、来源／hash 复现与维护者审批。
- Progress output, hash logging and cross-workflow CI reuse are outside this increment. / 进度输出、hash 日志与跨 workflow CI 复用不属于本次增量。

## Validation / 验证

- Hosted full-scope acceptance: [CI 37490110958](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/37490110958) passed on `f577cf43ab6707f63b84a69f0b22b9ddab8763b6`, including all Node/package jobs, Browser and the aggregate `ci`. Windows ran npm 12.0.2 and passed 1586/1586 tests; the lifecycle guard exercised both success and injected failure. This confirms the Windows repair but does not exercise a docs-only PR browser skip. / Hosted 全量验收：上述 CI 在所列提交上全部通过，包含全部 Node／package job、Browser 与聚合 `ci`。Windows 使用 npm 12.0.2，1586/1586 测试通过；生命周期 guard 覆盖成功与注入失败。此结果确认 Windows 修复，但不覆盖纯文档 PR 的 browser 跳过路径。

- 2026-10-06 Windows repair: the lifecycle test now launches the absolute `npm_execpath` with `process.execPath`. Direct `node --test` resolves the configured global npm installation before isolating the fixture, then checks that exact CLI against the pinned version. Empty configs, credential filtering, offline dry-run, exit codes 0/42 and exactly-once assertions remain enforced. Direct Windows execution passed; hosted confirmation is recorded above. / 2026-10-06 Windows 修复：生命周期测试改用 `process.execPath` 启动绝对 `npm_execpath`；直接 `node --test` 在隔离 fixture 前解析已配置的全局 npm 安装，再验证该 CLI 符合固定版本。继续强制空配置、凭据过滤、离线 dry-run、退出码 0／42 与恰好一次断言。Windows 直接运行已通过，hosted 确认见上。

- Review fix: the synthetic lifecycle fixture sets `NPM_CONFIG_OFFLINE=true` with its isolated empty cache, so npm 12 metadata lookups during `publish --dry-run` cannot depend on public registry availability. The assertions retain exactly one guard call per invocation, require exit codes 0/42 for success/injected failure, and reject emitted tarballs. The focused 32-test command below passed again after this fix. / Review 修复：合成 lifecycle fixture 在独立空缓存下设置 `NPM_CONFIG_OFFLINE=true`，使 npm 12 在 `publish --dry-run` 期间的 metadata 查询不依赖公共 registry 可用性。断言保留每次调用 guard 恰好执行一次，要求成功／注入失败分别返回退出码 0／42，并确认不生成 tarball。修复后重新运行下述 32 项聚焦测试，全部通过。
- PASS: `node --test test/ci-scope.test.js test/package.test.js test/release-publish-guard.test.js test/release-automation.test.js`, 32/32 on Windows Node 24.18.1 / npm 12.0.2. Includes real Git merge-base history, cross-boundary rename and binary-document cases, the actual aggregate Bash truth table, workflow contracts, and anonymous synthetic npm dry-run success/failure injection. No package was published. / PASS：上述命令在 Windows Node 24.18.1／npm 12.0.2 上 32/32 通过，涵盖真实 Git merge-base 历史、跨范围重命名和二进制文档、实际聚合 Bash 状态组合、workflow 契约及匿名合成 npm dry-run 成功／失败注入；未发布 package。
- PASS: `npm run build:check`, YAML parsing of both changed workflows using the existing Playwright-bundled parser, local documentation references and `git diff --check`. No dependency or generated-asset change. / PASS：生成资产检查、使用现有 Playwright 内置 parser 解析两份 workflow YAML、本地文档引用与 diff 检查；未变更依赖或生成资产。
- Hosted full-scope acceptance is recorded above; document-only PR skip acceptance remains open. No timing reduction is claimed from local simulation. / Hosted 全量验收已记录于上；纯文档 PR 跳过验收仍待完成。不将本地模拟宣称为实测耗时改善。

## References / 引用

- [Development validation](../../development.md#validation-scope)
- [Release runbook](../../design-docs/npm-release-runbook.md)
- [0.2.1 release evidence](../completed/2026-10-05-v0.2.1-release.md)
