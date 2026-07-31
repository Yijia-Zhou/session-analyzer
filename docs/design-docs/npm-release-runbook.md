# npm Release Runbook / npm 发布运行手册

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-07-31 / 最近更新：2026-07-31
- Applies to: the public `session-analyzer` npm package / 适用范围：公共 `session-analyzer` npm package
- Related product spec: / 相关产品规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related plans: / 相关计划：
  - `docs/exec-plans/active/2026-07-31-first-public-npm-release.md`
  - `docs/exec-plans/completed/2026-06-10-v0.1-release-hardening.md`
- Related debt: / 相关技术债：
  - `docs/exec-plans/tech-debt-tracker.md#10-release-workflow-and-trusted-publishing--发布流程与-trusted-publishing`

## Purpose / 目的

This is the durable release procedure for manual npm releases of `session-analyzer`. A version-specific execution plan records the target version, release commit, toolchain versions, CI runs, package manifest, integrity values, and public verification evidence; it must reference this runbook instead of redefining the publication path. / 本文档是 `session-analyzer` 手动 npm 发布的长期运行手册。每个版本专属的执行计划负责记录目标版本、release commit、工具链版本、CI run、package manifest、完整性值与公共验证证据；版本计划必须引用本运行手册，而不是重新定义发布路径。

This runbook covers direct manual publication through npm with interactive 2FA. Trusted Publishing or npm staged publishing may later replace the authentication and irreversible-publication phase, but they do not replace version closure, CI, package inspection, public verification, evidence recording, or recovery rules. / 本运行手册覆盖通过 npm 与交互式 2FA 进行的直接手动发布。Trusted Publishing 或 npm staged publishing 以后可以替换认证与不可逆发布阶段，但不会替代版本收口、CI、package 检查、公共验证、证据记录或恢复规则。

## Release model / 发布模型

The release has three distinct objects. They must not be conflated. / 发布过程中存在三个不同对象，不得混为一谈。

1. **Release source / 发布来源**: the clean repository tree at the exact commit that will receive the release tag. This is the input to the irreversible `npm publish` command. / 将获得 release tag 的精确 commit 所对应的干净仓库工作树。它是不可逆 `npm publish` 命令的输入。
2. **Inspection candidate / 检查候选制品**: a tarball produced with `npm pack` from that source and used to inspect the manifest, contents, hashes, installed CLI, and packaged server. It is evidence, not the positional input to `npm publish`. / 从该来源通过 `npm pack` 生成的 tarball，用于检查 manifest、内容、哈希、安装后的 CLI 与 packaged server。它是证据，不是 `npm publish` 的位置参数输入。
3. **Published artifact / 已发布制品**: the tarball npm prepares from the same clean source after `prepublishOnly` succeeds during the actual directory-based publication. / 实际从工作树发布时，在 `prepublishOnly` 成功后，由 npm 从同一干净来源准备的 tarball。

The supported manual publication path is therefore:

因此，受支持的手动发布路径是：

```text
clean tagged-intent commit
        ↓
CI + local gates
        ↓
npm pack inspection candidate
        ↓
directory-based npm publish --dry-run
        ↓
directory-based npm publish --tag next
        ↓
public exact-version verification
        ↓
promote to latest
        ↓
Git tag + GitHub Release
```

### Lifecycle safety invariant / 生命周期安全不变量

The repository uses `prepublishOnly` to run `release:check`. npm runs `prepublishOnly` before preparing and packing a package during a directory-based `npm publish`. In the release toolchain verified on 2026-07-31, publishing a prebuilt tarball with `npm publish <file.tgz>` did **not** execute the tarball's `prepublishOnly`; an npm 12.0.2 dry run confirmed that `prepublishOnly`, `release:check`, and package smoke were all absent. / 仓库使用 `prepublishOnly` 运行 `release:check`。通过工作树执行 `npm publish` 时，npm 会在准备和打包 package 前运行 `prepublishOnly`。在 2026-07-31 验证的发布工具链中，使用 `npm publish <file.tgz>` 发布预构建 tarball **不会**执行 tarball 中的 `prepublishOnly`；npm 12.0.2 dry run 已确认 `prepublishOnly`、`release:check` 与 package smoke 均未出现。

Consequently, the irreversible command must be run from the package root with **no positional package or tarball argument**. Do not use `--ignore-scripts`. / 因此，不可逆命令必须在 package root 中执行，且**不得带 package 或 tarball 位置参数**。不得使用 `--ignore-scripts`。

```powershell
# Correct: publishes from the current clean package root and runs prepublishOnly.
npm publish --foreground-scripts --tag='next' --access='public'

# Forbidden for this repository: bypasses the intended prepublishOnly guard.
npm publish '.\session-analyzer-<version>.tgz' --tag='next' --access='public'
```

`next` is a live public dist-tag, not a private staging area. Publishing with `--tag='next'` makes the exact version publicly installable while preventing it from becoming the default `npm install session-analyzer` version until verification is complete. / `next` 是公开生效的 dist-tag，不是私有 staging area。使用 `--tag='next'` 发布后，精确版本会立即可公开安装，但在验证完成前不会成为 `npm install session-analyzer` 的默认版本。

## Responsibilities and authority / 职责与权限

### Repository automation or an implementation agent / 仓库自动化或实现 agent

- May prepare release metadata, run read-only registry checks, add or update CI, execute tests and audits, generate and inspect a candidate tarball, and execute `npm publish --dry-run`. / 可以准备发布 metadata、执行只读 registry 检查、新增或更新 CI、运行测试与 audit、生成并检查候选 tarball，以及执行 `npm publish --dry-run`。
- Must stop before npm authentication, an irreversible registry write, dist-tag promotion, a remote Git tag, or a GitHub Release unless the maintainer explicitly authorizes that external mutation. / 除非维护者明确授权相应外部状态变更，否则必须在 npm 认证、不可逆 registry 写入、dist-tag 提升、远端 Git tag 或 GitHub Release 前停止。

### Maintainer / 维护者

- Reviews the release diff and the recorded evidence. / 审查发布 diff 与已记录证据。
- Owns npm login, interactive 2FA, the first irreversible publication, promotion to `latest`, remote tag creation, and GitHub Release publication. / 负责 npm 登录、交互式 2FA、首次不可逆发布、提升到 `latest`、创建远端 tag 与发布 GitHub Release。
- Must stop if the working tree, CI result, package name, version, registry, or recorded manifest differs from the approved release plan. / 如果工作树、CI 结果、package 名、版本、registry 或已记录 manifest 与获批 release plan 不一致，必须停止。

## Required invariants / 必需不变量

Every release must satisfy all of the following before the first registry write. / 每次发布都必须在首次 registry 写入前满足以下全部条件。

1. `package.json`, `package-lock.json`, the bilingual changelog, package metadata tests, intended Git tag, and intended GitHub Release agree on one unused version. / `package.json`、`package-lock.json`、双语 changelog、package metadata 测试、预期 Git tag 与预期 GitHub Release 对同一个未使用版本保持一致。
2. The release source is a committed, pushed, CI-verified commit with an empty `git status --porcelain`. / 发布来源是已经 commit、push 并通过 CI 验证的 commit，且 `git status --porcelain` 为空。
3. The release toolchain uses the supported Node.js/npm versions named in the version-specific plan and the official `https://registry.npmjs.org/` registry. / 发布工具链使用版本专属计划中指定的受支持 Node.js/npm 版本，以及官方 `https://registry.npmjs.org/` registry。
4. Generated assets are current; Node, browser, installed-package smoke, and required cross-platform CI jobs pass. / 生成资产保持最新；Node、browser、安装后 package smoke 与要求的跨平台 CI job 均通过。
5. Production and full dependency audits have zero unresolved findings, or a reviewed exception is explicitly recorded before publication. / Production 与完整依赖 audit 不存在未解决 finding，或在发布前已明确记录经过审查的例外。
6. The inspection candidate contains only the approved runtime allowlist and documentation, with no credentials, real transcripts, `.codex`, test fixtures, development plans, source maps, temporary output, personal absolute paths, or logs. / 检查候选制品只包含获批的运行时白名单与文档，不包含凭据、真实 transcript、`.codex`、测试 fixture、开发计划、source map、临时输出、个人绝对路径或日志。
7. The final dry run and actual publish are executed from the repository package root without a positional package spec and without `--ignore-scripts`; `prepublishOnly` must complete in both operations. / 最终 dry run 与实际 publish 均从仓库 package root 执行，不带位置 package spec，也不使用 `--ignore-scripts`；两次操作中的 `prepublishOnly` 都必须完成。
8. The initial live version is published under `next`, verified by exact version on Windows and Linux, and only then promoted to `latest`. / 初始 live 版本以 `next` 发布，在 Windows 与 Linux 上按精确版本完成验证后，才提升到 `latest`。
9. A published `name@version` is never reused, even if it is later unpublished. / 已发布的 `name@version` 永不复用，即使之后被 unpublish。
10. Evidence is recorded in the version-specific plan before it is moved to `completed/`. / 版本专属计划移动到 `completed/` 前，必须记录证据。

## Standard manual release workflow / 标准手动发布流程

### 1. Open the version-specific plan / 建立版本专属计划

Create an active plan that references this runbook and records: / 创建引用本运行手册的 active plan，并记录：

- package name and target version / package 名与目标版本
- source branch and baseline commit / source branch 与基线 commit
- intended release commit and tag / 预期 release commit 与 tag
- release Node.js/npm versions / 发布使用的 Node.js/npm 版本
- supported runtime matrix / 支持的运行时矩阵
- first-release-only name availability and account prerequisites / 仅首发需要的名称可用性与账户前置条件
- version-specific risks, compatibility decisions, and validation exceptions / 版本特有风险、兼容性决策与验证例外

Do not copy the generic publication commands into a conflicting version-specific workflow. If a version requires a different publication mechanism, update or explicitly supersede this runbook before publication. / 不得把通用发布命令复制成与本运行手册冲突的版本专属流程。如果某个版本需要不同的发布机制，必须在发布前更新或明确取代本运行手册。

### 2. Close release metadata / 收口发布 metadata

- Update `package.json` and `package-lock.json` to the target version. / 将 `package.json` 与 `package-lock.json` 更新为目标版本。
- Close the bilingual `Unreleased` changes into the dated version entry while retaining a blank bilingual `Unreleased` section. / 将双语 `Unreleased` 变更收口到带日期的版本条目，同时保留空的双语 `Unreleased` 区段。
- Update both READMEs and the relevant product/design docs when runtime support or behavior changed. / 如果运行时支持或行为发生变化，同步更新两份 README 与相关产品/设计文档。
- Review dependency and lockfile changes against the official registry. / 对照官方 registry 审查依赖与 lockfile 变更。
- Verify `publishConfig.registry` and public access. / 验证 `publishConfig.registry` 与 public access。

### 3. Commit, push, and obtain CI evidence / Commit、push 并取得 CI 证据

The release commit must contain every packed source change and generated asset. Push it through the normal review path and wait for all required Linux and Windows jobs. Record the commit SHA and CI run URL in the active plan. / Release commit 必须包含所有会被打包的源文件变更与生成资产。通过正常 review 路径推送，并等待所有要求的 Linux 与 Windows job。把 commit SHA 与 CI run URL 记录到 active plan。

Before continuing locally:

本地继续前：

```powershell
git status --short
git rev-parse HEAD
git log -1 --oneline
```

`git status --short` must be empty. An inspection tarball must not remain as an untracked file inside the worktree during the final dry run or actual publish. / `git status --short` 必须为空。最终 dry run 或实际 publish 期间，检查用 tarball 不得作为 untracked file 留在工作树中。

### 4. Verify the release environment / 验证发布环境

Record the exact output:

记录精确输出：

```powershell
node --version
npm --version
npm config get registry
npm ping --registry='https://registry.npmjs.org/'
```

The registry must be exactly `https://registry.npmjs.org/`. Do not continue with an old Node.js/npm installation, a mirror registry, or a toolchain different from the one approved in the active plan. / Registry 必须精确为 `https://registry.npmjs.org/`。如果 Node.js/npm 版本过旧、registry 指向镜像，或工具链与 active plan 获批版本不同，不得继续。

Verify the version contract:

验证版本契约：

```powershell
node -p 'require("./package.json").name'
node -p 'require("./package.json").version'
node -p 'JSON.stringify(require("./package.json").engines)'
node -p 'JSON.stringify(require("./package.json").publishConfig)'
```

For the first public release, recheck package-name availability immediately before authentication. Treat `E404` as availability evidence only at that moment; it is not a reservation. / 对首次公开发布，在认证前立即复查 package 名可用性。`E404` 只表示当时可用，并不构成保留。

```powershell
npm view 'session-analyzer' version --registry='https://registry.npmjs.org/'
```

For later versions, prove that the target version is unused:

对于后续版本，证明目标版本尚未使用：

```powershell
npm view 'session-analyzer' versions --json --registry='https://registry.npmjs.org/'
```

### 5. Run local release gates / 运行本地 release gate

Use a clean dependency installation and the official registry. / 使用干净依赖安装与官方 registry。

```powershell
npm ci --registry='https://registry.npmjs.org/'
npm run release:check
npm run test:browser
npm audit --omit=dev --registry='https://registry.npmjs.org/'
npm audit --registry='https://registry.npmjs.org/'
git diff --check
git status --short
```

`release:check` must include generated-asset verification, the full Node test suite, and installed-package smoke. The final `git status --short` must still be empty. / `release:check` 必须包含生成资产验证、完整 Node 测试与安装后 package smoke。最后的 `git status --short` 仍必须为空。

### 6. Generate and inspect the candidate / 生成并检查候选制品

Run:

执行：

```powershell
npm pack --dry-run
npm pack
Get-FileHash -Algorithm SHA256 -LiteralPath '.\session-analyzer-<version>.tgz'
tar -tf '.\session-analyzer-<version>.tgz'
```

Record npm's filename, packed size, unpacked size, entry count, SHA-1, integrity, and a separate SHA-256. Extract the tarball into a newly created temporary directory and verify: / 记录 npm 提供的 filename、packed size、unpacked size、entry count、SHA-1、integrity，以及单独计算的 SHA-256。把 tarball 解压到新建临时目录，并验证：

- every required runtime file is present / 所有必需运行时文件均存在
- forbidden development paths are absent / 禁止的开发路径不存在
- packed text has no tested credential or personal-path patterns / 打包文本不包含已检查的凭据或个人路径模式
- packed files are byte-identical to their repository sources unless npm has a documented normalization / 除非 npm 存在已记录的规范化行为，否则打包文件与仓库源文件逐字节一致
- the installed CLI help and packaged server smoke pass / 安装后 CLI help 与 packaged server smoke 通过

The candidate is inspection evidence only. After recording the evidence, remove it from the worktree or retain a copy outside the worktree. Do not pass it to `npm publish`. Reconfirm that `git status --short` is empty. / 候选制品只作为检查证据。记录证据后，将其移出工作树，或只在工作树外保留副本。不得把它传给 `npm publish`。再次确认 `git status --short` 为空。

### 7. Execute the final guarded dry run / 执行最终受保护 dry run

From the clean package root, with no positional argument:

在干净 package root 中执行，且不带位置参数：

```powershell
npm publish --dry-run --foreground-scripts --tag='next' --access='public'
```

The output must prove that `prepublishOnly` and `release:check` ran successfully. Review the final package manifest and confirm that it agrees with the inspected candidate. If the lifecycle output or manifest is missing, different, or ambiguous, stop. / 输出必须证明 `prepublishOnly` 与 `release:check` 成功运行。审查最终 package manifest，并确认其与已检查候选制品一致。如果生命周期输出或 manifest 缺失、不一致或含糊，必须停止。

Run once more:

再次执行：

```powershell
git status --short
git rev-parse HEAD
```

The worktree and commit must still match the approved release evidence. Make no source, metadata, dependency, generated-asset, or documentation changes after this point. Any change invalidates the dry run and requires returning to the appropriate earlier phase. / 工作树与 commit 必须继续匹配获批发布证据。此后不得修改源代码、metadata、依赖、生成资产或文档。任何变更都会使 dry run 失效，并要求回到相应的早期阶段。

### 8. Authenticate and perform the irreversible publication / 认证并执行不可逆发布

This is the first mandatory human-controlled boundary. / 这是第一个必须由人工控制的边界。

```powershell
npm login --registry='https://registry.npmjs.org/'
npm whoami --registry='https://registry.npmjs.org/'
npm ping --registry='https://registry.npmjs.org/'
npm publish --foreground-scripts --tag='next' --access='public'
```

The publish command intentionally has no path argument. Confirm the package name, version, registry, public access, and `next` tag in npm's prompt/output before completing 2FA. / Publish 命令有意不带 path 参数。在完成 2FA 前，从 npm prompt/output 中确认 package 名、版本、registry、public access 与 `next` tag。

If the CLI exits ambiguously because of a timeout, disconnect, or terminal failure, do not immediately retry. First query the exact version from the registry; the registry write may have succeeded even though the local command did not report success. / 如果 CLI 因 timeout、断线或 terminal failure 含糊退出，不得立即重试。先从 registry 查询精确版本；即使本地命令没有报告成功，registry 写入也可能已经成功。

### 9. Verify the public exact version / 验证公共精确版本

Record:

记录：

```powershell
npm view 'session-analyzer@<version>' --registry='https://registry.npmjs.org/'
npm view 'session-analyzer' dist-tags --json --registry='https://registry.npmjs.org/'
npm view 'session-analyzer' repository --json --registry='https://registry.npmjs.org/'
npx --yes 'session-analyzer@<version>' --help
```

From clean Windows and Linux environments, verify: / 在干净 Windows 与 Linux 环境中验证：

- exact-version `npx` / 精确版本 `npx`
- global installation and CLI help / 全局安装与 CLI help
- packaged server startup against a test project and synthetic Codex home / 针对测试项目与合成 Codex home 启动 packaged server
- root HTML and `/api/state` / 根 HTML 与 `/api/state`
- registry metadata and the absence of an unintended `latest` promotion / registry metadata，以及未发生意外的 `latest` 提升

Do not use real transcripts for public release verification. / 公共发布验证不得使用真实 transcript。

### 10. Promote the verified version / 提升已验证版本

Only after Windows and Linux exact-version verification succeeds:

只有 Windows 与 Linux 精确版本验证成功后：

```powershell
npm dist-tag add 'session-analyzer@<version>' 'latest'
npm dist-tag ls 'session-analyzer'
```

This is another human-controlled registry mutation and may require 2FA. Confirm that both `next` and `latest` point to the intended version, or remove/update `next` according to the version-specific plan. / 这是另一个由人工控制的 registry mutation，可能需要 2FA。确认 `next` 与 `latest` 都指向预期版本，或按照版本专属计划移除/更新 `next`。

### 11. Create the release tag and GitHub Release / 创建 release tag 与 GitHub Release

Tag the exact commit used as the clean publication source. Do not tag a rebuilt, amended, or later commit. / 对作为干净发布来源的精确 commit 打 tag。不得对重新构建、amend 后或更晚的 commit 打 tag。

```powershell
git tag -a 'v<version>' -m 'Release v<version>' '<release-commit>'
git push origin 'v<version>'
```

Create the GitHub Release from that tag and use the bilingual changelog entry as release notes. Verify that npm version, Git tag, GitHub Release, and release commit all agree. / 从该 tag 创建 GitHub Release，并使用双语 changelog 条目作为 release notes。验证 npm version、Git tag、GitHub Release 与 release commit 全部一致。

### 12. Close the version plan / 收尾版本计划

- Record all public verification evidence and URLs. / 记录全部公共验证证据与 URL。
- Record any warning, retry, exception, deprecation, or dist-tag correction. / 记录任何 warning、retry、exception、deprecation 或 dist-tag 修正。
- Update the trusted-publishing debt status if automation changed. / 如果自动化发生变化，更新 trusted-publishing 技术债状态。
- Move the active plan to `completed/` only after publication, public verification, promotion, tag, and GitHub Release are all complete. / 只有发布、公共验证、提升、tag 与 GitHub Release 全部完成后，才把 active plan 移到 `completed/`。

## Release evidence template / 发布证据模板

Copy this section into the version-specific plan. / 把本节复制到版本专属计划。

```text
Release identity:
- Package:
- Version:
- Release commit:
- Source branch:
- Git tag:
- GitHub Release:

Toolchain:
- OS:
- Node.js:
- npm:
- Registry:
- npm account:
- Authentication mode:

Repository state:
- git status:
- package.json version:
- package-lock.json version:
- changelog entry:
- publishConfig:

CI:
- Commit:
- Run URL:
- Linux Node 22:
- Linux Node 24:
- Windows Node 24:
- Browser:
- Package smoke:

Local gates:
- npm ci:
- release:check:
- browser tests:
- production audit:
- full audit:
- git diff --check:
- final guarded publish dry-run:
- prepublishOnly observed:

Inspection candidate:
- Filename:
- Packed size:
- Unpacked size:
- Entry count:
- SHA-1:
- SHA-256:
- npm integrity:
- Allowlist result:
- Sensitive-path result:
- Installed CLI/server result:

Registry publication:
- Published under next:
- Exact-version registry metadata:
- Windows public smoke:
- Linux public smoke:
- Promoted to latest:
- Final dist-tags:

Exceptions and recovery actions:
- None / details:
```

## Failure and recovery / 失败与恢复

### Before any registry write / 在任何 registry 写入前

Discard the candidate evidence, correct the repository, commit the correction, rerun CI and every invalidated local phase, then generate a new candidate and dry run. Never waive a failed gate silently. / 丢弃候选证据，修正仓库，提交修正，重跑 CI 与所有已失效的本地阶段，然后生成新候选并重新 dry run。不得静默豁免失败 gate。

### Ambiguous publication result / 发布结果含糊

Query `npm view <name>@<version>` before retrying. If the version exists, treat it as published and move to exact-version verification. If it does not exist, diagnose authentication or transport state before another attempt. / 重试前查询 `npm view <name>@<version>`。如果版本存在，按已发布处理并进入精确版本验证。如果不存在，在再次尝试前诊断认证或传输状态。

### Published under `next` but verification fails / 已以 `next` 发布但验证失败

- Do not promote it to `latest`. / 不得提升到 `latest`。
- Deprecate the exact version with a precise message when useful. / 必要时使用精确消息 deprecate 该版本。
- Fix the repository and publish a new patch version. / 修复仓库并发布新的 patch 版本。
- Do not attempt to overwrite or reuse the failed version. / 不得尝试覆盖或复用失败版本。

### Incorrect `latest` promotion / 错误提升到 `latest`

Move `latest` back to the last verified version, record the incident, and publish a corrected patch version if necessary. Do not move or recreate an already public release tag to disguise the mistake. / 把 `latest` 恢复到上一个已验证版本，记录 incident，并在必要时发布修正 patch 版本。不得移动或重建已公开 release tag 来掩盖错误。

### Unpublish / Unpublish

Unpublish is not the normal rollback mechanism. npm registry versions are immutable, and an unpublished `name@version` cannot be reused. Prefer leaving a failed version off `latest`, deprecating it, and releasing a new patch. / Unpublish 不是常规回滚机制。npm registry 版本不可变，已 unpublish 的 `name@version` 也不能复用。应优先让失败版本不进入 `latest`、将其 deprecate，并发布新的 patch。

## Known traps / 已知陷阱

- `npm publish <file.tgz>` bypasses this repository's intended `prepublishOnly` gate in the verified npm 12 workflow. / 在已验证的 npm 12 流程中，`npm publish <file.tgz>` 会绕过本仓库预期的 `prepublishOnly` gate。
- `npm publish` without `--tag='next'` assigns `latest` by default. / `npm publish` 不带 `--tag='next'` 时默认分配 `latest`。
- `next` is public and immediately installable; it is not npm staged publishing. / `next` 是公开且可立即安装的版本，不等同于 npm staged publishing。
- `--ignore-scripts` disables the lifecycle protection. / `--ignore-scripts` 会禁用生命周期保护。
- A user-level `.npmrc` can point installs and diagnostics at a mirror; always pass or verify the official registry. / 用户级 `.npmrc` 可能让安装与诊断指向镜像；始终显式传入或验证官方 registry。
- A candidate `.tgz` inside the worktree makes the tree dirty and can be overwritten or removed by later package-smoke runs. / 工作树内的候选 `.tgz` 会使工作树变脏，并可能被后续 package-smoke 覆盖或删除。
- npm 11 and npm 12 use different `npm pack --json` top-level shapes; repository package-smoke normalization supports both, but hand-written parsers must not assume one shape. / npm 11 与 npm 12 使用不同的 `npm pack --json` 顶层形态；仓库 package-smoke normalization 已兼容两者，但手写 parser 不得只假设其中一种。
- A package-name `E404` is not a reservation; recheck immediately before first publication. / Package 名 `E404` 不构成保留；首次发布前必须立即复查。
- A CLI timeout does not prove the registry write failed. / CLI timeout 不能证明 registry 写入失败。
- `name@version` cannot be reused after publication or unpublish. / `name@version` 在发布或 unpublish 后都不能复用。

## Alternatives considered / 已考虑的备选方案

### Publish the exact inspected tarball / 发布精确的已检查 tarball

- Advantage: the local bytes being uploaded are directly known. / 优点：直接知道上传的本地 bytes。
- Rejected for the current manual workflow: npm treats the tarball as already prepared and does not execute its embedded `prepublishOnly`, so the irreversible path bypasses the repository release guard. / 当前手动流程已拒绝：npm 把 tarball 视为已准备制品，不执行其中的 `prepublishOnly`，因此不可逆路径会绕过仓库 release guard。

### Add a custom publishing wrapper / 增加自定义发布 wrapper

- Advantage: a wrapper could rerun gates, verify a recorded hash, and then publish the same tarball. / 优点：wrapper 可以重跑 gate、验证已记录哈希，然后发布同一个 tarball。
- Deferred: it adds code around an authenticated irreversible mutation and must also isolate package-smoke tarball handling. The clean-tree path already composes correctly with npm's lifecycle. / 已推迟：它会在带认证的不可逆 mutation 周围增加代码，还必须隔离 package-smoke 的 tarball 处理。干净工作树路径已经能与 npm 生命周期正确组合。

### Publish directly to `latest` / 直接发布到 `latest`

- Advantage: fewer registry mutations. / 优点：registry mutation 更少。
- Rejected: exact-version Windows/Linux verification should happen before the version becomes the default install target. / 已拒绝：版本成为默认安装目标前，应先完成精确版本的 Windows/Linux 验证。

### Create the Git tag before npm publication / 在 npm 发布前创建 Git tag

- Advantage: the apparent release identity exists before publication. / 优点：发布前已有表面上的 release identity。
- Rejected: a failed or abandoned registry publication would leave a misleading public tag. The immutable release commit is recorded first; the public tag follows successful registry verification. / 已拒绝：registry 发布失败或放弃时会留下误导性的公开 tag。应先记录不可变 release commit，在 registry 验证成功后再创建公开 tag。

### Trusted Publishing or npm staged publishing / Trusted Publishing 或 npm staged publishing

- Preferred future direction after the package exists and the repository approval model is configured. / Package 建立且仓库审批模型配置完成后，这是优先的未来方向。
- Adoption must explicitly update this runbook. It may replace manual login/publication, but all pre-publication gates, source identity checks, exact-version verification, dist-tag policy, and evidence requirements remain. / 采用时必须明确更新本运行手册。它可以替换手动登录/发布，但所有发布前 gate、来源身份检查、精确版本验证、dist-tag policy 与证据要求继续保留。

## References / 参考

- npm scripts and lifecycle order: `https://docs.npmjs.com/cli/v11/using-npm/scripts/`
- npm publish: `https://docs.npmjs.com/cli/publish/`
- Creating and publishing unscoped public packages: `https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/`
- Requiring 2FA for publishing: `https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/`
- Adding dist-tags: `https://docs.npmjs.com/adding-dist-tags-to-packages/`
- npm unpublish policy: `https://docs.npmjs.com/policies/unpublish/`
- Trusted Publishing: `https://docs.npmjs.com/trusted-publishers/`

## Decision log / 决策日志

- 2026-07-31: Accepted clean-tree, directory-based manual publication as the only supported direct `npm publish` path. Candidate tarballs remain inspection evidence and must not be passed to the irreversible command. This decision followed a review finding and an npm 12.0.2 dry-run reproduction showing that positional tarball publication skipped `prepublishOnly`. / 2026-07-31：接受基于干净工作树、从目录执行的手动发布，作为唯一受支持的直接 `npm publish` 路径。候选 tarball 继续作为检查证据，不得传给不可逆命令。该决策源于一次 review finding，以及 npm 12.0.2 dry-run 复现：带位置 tarball 的发布会跳过 `prepublishOnly`。
- 2026-07-31: Retained `next` as the live pre-promotion dist-tag, with exact-version Windows/Linux verification required before `latest`. / 2026-07-31：保留 `next` 作为提升前的公开 dist-tag，并要求在进入 `latest` 前完成精确版本的 Windows/Linux 验证。
