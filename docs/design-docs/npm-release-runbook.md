# npm Release Runbook / npm 发布运行手册

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-08-03 / 最近更新：2026-08-03
- Applies to: the public `session-analyzer` npm package / 适用范围：公共 `session-analyzer` npm package
- Related product spec: / 相关产品规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related plans: / 相关计划：
  - `docs/exec-plans/active/2026-08-02-v0.1.3-release.md`
  - `docs/exec-plans/active/2026-08-02-npm-trusted-publishing.md`
  - `docs/exec-plans/completed/2026-07-31-first-public-npm-release.md`
  - `docs/exec-plans/completed/2026-06-10-v0.1-release-hardening.md`
- Related debt: / 相关技术债：
  - `docs/exec-plans/tech-debt-tracker.md#10-release-workflow-and-trusted-publishing--发布流程与-trusted-publishing`

## Purpose / 目的

This is the durable release procedure for `session-analyzer`. The preferred path for an existing package uses GitHub Actions Trusted Publishing to create a private npm staged package, followed by maintainer review and npm 2FA approval. Isolated interactive publication remains a documented fallback. Release evidence uses two layers: the version-specific execution plan is the durable public record for release identity, verifiable gate results, artifact hash continuity, and public verification; optional raw command output, account-side readback, machine-specific details, and transient diagnostics belong only in a Git-ignored maintainer-local appendix. The version plan must reference this runbook instead of redefining the publication path. / 本文档是 `session-analyzer` 的长期发布运行手册。Package 已存在时，首选路径使用 GitHub Actions Trusted Publishing 创建私有 npm staged package，随后由维护者审查并通过 npm 2FA approve。隔离的交互式发布继续作为有文档记录的 fallback。发布证据采用两层结构：版本专属执行计划是长期公开记录，负责保存 release identity、可复核 gate 结果、制品哈希连续性与公共验证；可选的原始命令输出、账户侧 readback、本机特有细节与临时诊断只进入 Git 忽略的维护者本地附录。版本计划必须引用本运行手册，而不是重新定义发布路径。

Trusted Publishing replaces reusable publication credentials, not release governance. Version closure, CI, package inspection, source identity, public verification, evidence recording, and recovery rules remain mandatory. The OIDC trust is intentionally stage-only: automation cannot make a version public, and approval still requires maintainer 2FA. / Trusted Publishing 替代的是可复用发布凭据，而不是 release governance。版本收口、CI、package 检查、来源身份、公共验证、证据记录与恢复规则继续为强制要求。OIDC trust 有意限制为 stage-only：自动化不能让版本公开，approve 仍要求维护者 2FA。

## Release model / 发布模型

The release has four distinct objects or states. They must not be conflated. / 发布过程中存在四个不同对象或状态，不得混为一谈。

1. **Release source / 发布来源**: the clean repository tree at the exact commit that will receive the release tag. / 将获得 release tag 的精确 commit 所对应的干净仓库工作树。
2. **Verified candidate / 已验证候选制品**: a tarball produced from that source after the unprivileged release gates, inspected for manifest, contents, hashes, installed CLI, and packaged server behavior. / 从该来源在无特权 release gate 后生成的 tarball，用于检查 manifest、内容、哈希、安装后 CLI 与 packaged server 行为。
3. **Staged artifact / staged 制品**: the private, immutable npm registry submission created by the stage-only OIDC workflow. Its bytes and tag await maintainer review and 2FA approval; it is not publicly installable. / 由 stage-only OIDC workflow 创建的私有、不可变 npm registry submission。其字节与 tag 等待维护者审查和 2FA approve；此时不可公开安装。
4. **Published artifact / 已发布制品**: the exact staged artifact made public by approval, or, on the manual fallback path, the tarball npm prepares from the clean source after `prepublishOnly` succeeds. / 通过 approve 公开的精确 staged 制品；在手动 fallback 路径上，则是 `prepublishOnly` 成功后由 npm 从干净来源准备的 tarball。

The preferred path for an existing package is:

因此，已有 package 的首选路径是：

```text
clean tagged-intent commit
        ↓
required CI on main
        ↓
manual publish.yml dispatch for that exact main commit
        ↓
unprivileged release/browser/audit/package gates
        ↓
guarded directory npm publish --dry-run
        ↓
verified candidate SHA-256
        ↓
minimal OIDC job reproduces identical bytes without project scripts
        ↓
npm stage publish <verified.tgz> --tag latest
        ↓
maintainer review/download/hash comparison
        ↓
maintainer 2FA approval
        ↓
anonymous public exact-version verification
        ↓
Git tag + GitHub Release
```

The staged `latest` tag is immutable but does not move the public dist-tag until 2FA approval. Staged versions share npm's package-version uniqueness constraint; never stage an already published version or use a casual test version. The first live acceptance of the trust relationship must therefore use the next real, approved, unused release version. / Staged `latest` tag 不可变，但在 2FA approve 前不会移动公共 dist-tag。Staged version 与 npm package version 共享唯一性约束；不得 staging 已发布版本，也不得使用随意的测试版本。因此，trust relationship 的首次真实验收必须使用下一个真实、获批且未使用的 release version。

The direct manual fallback continues to publish an established-package candidate under `next`, verify it publicly, and then promote it to `latest`. An inaugural direct publication remains exceptional: npm requires a `latest` tag and the first `session-analyzer` publication created both `next` and `latest`. / 直接手动 fallback 继续把已有 package 的候选版本发布到 `next`，完成公共验证后再提升到 `latest`。首次直接发布仍是例外：npm 要求存在 `latest` tag，且 `session-analyzer` 首发同时创建了 `next` 与 `latest`。

### Lifecycle safety invariant / 生命周期安全不变量

The repository uses `prepublishOnly` to run `release:check`. npm runs `prepublishOnly` before preparing and packing a package during a directory-based `npm publish` or directory-based `npm stage publish`. Publishing or staging a prebuilt tarball does **not** execute the tarball's `prepublishOnly`. / 仓库使用 `prepublishOnly` 运行 `release:check`。通过工作树执行 `npm publish` 或 `npm stage publish` 时，npm 会在准备和打包 package 前运行 `prepublishOnly`。发布或 staging 预构建 tarball **不会**执行 tarball 中的 `prepublishOnly`。

Consequently, direct `npm publish` must be run from the package root with **no positional package or tarball argument** and without `--ignore-scripts`. The automated staged path has one narrow exception: its unprivileged job must first pass `release:check`, package smoke, browser, audits, and a directory-based `npm publish --dry-run` that proves `prepublishOnly`; it then records the candidate SHA-256. The OIDC job runs no project dependency or script, regenerates the tarball with scripts disabled from the exact verified commit, requires byte identity, and may pass only that tarball to `npm stage publish`. / 因此，直接 `npm publish` 必须在 package root 中执行，且**不得带 package 或 tarball 位置参数**，也不得使用 `--ignore-scripts`。自动 staged 路径只有一个严格限定的例外：无特权 job 必须先通过 `release:check`、package smoke、browser、audit，以及能够证明 `prepublishOnly` 的目录式 `npm publish --dry-run`，随后记录候选 SHA-256。OIDC job 不运行项目依赖或脚本，从精确的已验证 commit 以禁用脚本方式重新生成 tarball，要求字节一致，并且只能把该 tarball 传给 `npm stage publish`。

```powershell
# Correct: publishes from the current clean package root and runs prepublishOnly.
npm publish --foreground-scripts --tag='next' --access='public'

# Forbidden for this repository: bypasses the intended prepublishOnly guard.
npm publish '.\session-analyzer-<version>.tgz' --tag='next' --access='public'
```

The tarball exception is implemented only by `.github/workflows/publish.yml`; it is not permission to stage or publish an arbitrary local tarball. / Tarball 例外只由 `.github/workflows/publish.yml` 实现；它不授权 staging 或发布任意本地 tarball。

### Dependency install-script safety invariant / 依赖 install-script 安全不变量

The repository uses npm 12's default-deny dependency install-script policy. Root `package.json#allowScripts` records an explicit decision for every locked package with `hasInstallScript`, while the project `.npmrc` sets `strict-allow-scripts=true` so an unreviewed script fails installation instead of being skipped with a warning. Approvals must name an exact reviewed version; intentional denials may be name-wide `false` entries. / 本仓库使用 npm 12 默认拒绝依赖 install script 的策略。根 `package.json#allowScripts` 会为 lockfile 中每个带 `hasInstallScript` 的 package 记录明确决策，项目 `.npmrc` 则设置 `strict-allow-scripts=true`，使未审查脚本导致安装失败，而不是仅被跳过并产生 warning。允许项必须指向经过审查的精确版本；有意拒绝的项目可以使用按名称生效的 `false` 条目。

This policy controls dependency install-time lifecycle scripts; it does not sandbox an approved script and does not govern the repository's own `prepublishOnly` release guard. CI and local release work must use the exact npm version required by `devEngines`; an older npm that does not enforce the policy is not an acceptable release toolchain. Never use `--dangerously-allow-all-scripts` to make a gate pass. / 该策略控制依赖在安装期间的 lifecycle script；它不会 sandbox 已批准脚本，也不管理仓库自身的 `prepublishOnly` 发布 guard。CI 与本地发布工作必须使用 `devEngines` 要求的精确 npm 版本；不会执行该策略的旧 npm 不能作为可接受的发布工具链。不得为了让 gate 通过而使用 `--dangerously-allow-all-scripts`。

`next` is a live public dist-tag, not a private staging area. For an established package it makes the exact version publicly installable without moving the existing `latest`; for an inaugural package, expect the registry to assign `latest` to the only published version as well. / `next` 是公开生效的 dist-tag，不是私有 staging area。对于已有 package，它会让精确版本可公开安装而不移动既有 `latest`；对于首次发布的 package，应预期 registry 也会把 `latest` 指向唯一已发布版本。

npm staged publishing is the private approval area. A staged artifact is not publicly installable, and its tag takes effect only when a maintainer approves it with 2FA. / npm staged publishing 才是私有审批区域。Staged artifact 不可公开安装，其 tag 只有在维护者通过 2FA approve 时才生效。

## Responsibilities and authority / 职责与权限

### Repository automation or an implementation agent / 仓库自动化或实现 agent

- May prepare release metadata, run read-only registry checks, add or update CI, execute tests and audits, generate and inspect a candidate tarball, and execute `npm publish --dry-run`. / 可以准备发布 metadata、执行只读 registry 检查、新增或更新 CI、运行测试与 audit、生成并检查候选 tarball，以及执行 `npm publish --dry-run`。
- The committed `publish.yml` may request a short-lived OIDC credential and create a private staged package only after a maintainer explicitly dispatches the workflow from `main` and any configured GitHub Environment protection passes. / 只有在维护者从 `main` 显式 dispatch workflow 且配置的 GitHub Environment protection 通过后，已提交的 `publish.yml` 才可请求短时 OIDC credential 并创建私有 staged package。
- Outside that exact workflow, must stop before npm authentication, any registry write, staged-package approval or rejection, dist-tag mutation, remote Git tag, or GitHub Release unless the maintainer explicitly authorizes the external mutation. / 在该精确 workflow 之外，除非维护者明确授权相应外部状态变更，否则必须在 npm 认证、任何 registry 写入、staged package approve/reject、dist-tag mutation、远端 Git tag或 GitHub Release 前停止。

### Maintainer / 维护者

- Reviews the release diff and the recorded evidence. / 审查发布 diff 与已记录证据。
- Owns workflow dispatch, GitHub Environment approval, staged artifact review and hash comparison, npm 2FA approval or rejection, any manual fallback authentication, remote tag creation, and GitHub Release publication. / 负责 workflow dispatch、GitHub Environment approval、staged artifact 审查与哈希比较、npm 2FA approve/reject、任何手动 fallback 认证、创建远端 tag 与发布 GitHub Release。
- Must stop if the working tree, CI result, package name, version, registry, or recorded manifest differs from the approved release plan. / 如果工作树、CI 结果、package 名、版本、registry 或已记录 manifest 与获批 release plan 不一致，必须停止。

## Required invariants / 必需不变量

Every release must satisfy all of the following before the first registry write. / 每次发布都必须在首次 registry 写入前满足以下全部条件。

1. `package.json`, `package-lock.json`, the bilingual changelog, package metadata tests, intended Git tag, and intended GitHub Release agree on one unused version. / `package.json`、`package-lock.json`、双语 changelog、package metadata 测试、预期 Git tag 与预期 GitHub Release 对同一个未使用版本保持一致。
2. The release source is a committed, pushed, CI-verified commit with an empty `git status --porcelain`. / 发布来源是已经 commit、push 并通过 CI 验证的 commit，且 `git status --porcelain` 为空。
3. The release toolchain uses the supported Node.js/npm versions named in the version-specific plan and the official `https://registry.npmjs.org/` registry. / 发布工具链使用版本专属计划中指定的受支持 Node.js/npm 版本，以及官方 `https://registry.npmjs.org/` registry。
4. Every locked dependency install script has an explicit allow-or-deny decision, strict mode reports no unreviewed script, and CI installs with the plan's exact supported npm version. / 每个已锁定的依赖 install script 都具有明确的允许或拒绝决策，strict mode 不报告未审查脚本，且 CI 使用计划指定的精确受支持 npm 版本执行安装。
5. Generated assets are current; Node, browser, installed-package smoke, and required cross-platform CI jobs pass. / 生成资产保持最新；Node、browser、安装后 package smoke 与要求的跨平台 CI job 均通过。
6. Production and full dependency audits have zero unresolved findings, or a reviewed exception is explicitly recorded before publication. / Production 与完整依赖 audit 不存在未解决 finding，或在发布前已明确记录经过审查的例外。
7. The inspection candidate contains only the approved runtime allowlist and documentation, preserves the complete license notice for every redistributed third-party asset, and contains no credentials, real transcripts, `.codex`, test fixtures, development plans, source maps, temporary output, personal absolute paths, or logs. / 检查候选制品只包含获批的运行时白名单与文档，为每个再分发的第三方资产保留完整许可证 notice，且不包含凭据、真实 transcript、`.codex`、测试 fixture、开发计划、source map、临时输出、个人绝对路径或日志。
8. The final directory dry run executes from the repository package root without a positional package spec or `--ignore-scripts`, and proves `prepublishOnly`. Direct manual publication follows the same directory rule. The automated OIDC job may stage a positional tarball only after it reproduces the exact verified SHA-256 from the same source commit while executing no project dependency or script. / 最终目录 dry run 从仓库 package root 执行，不带位置 package spec 或 `--ignore-scripts`，并证明 `prepublishOnly`。直接手动发布遵循相同目录规则。自动 OIDC job 只有在不执行项目依赖或脚本的情况下，从相同来源 commit 复现精确的已验证 SHA-256 后，才可以 staging 位置 tarball。
9. On the preferred path, the immutable staged artifact is reviewed and hash-checked before maintainer 2FA approval moves `latest`; public exact-version verification follows approval. On the manual fallback, an established-package candidate is published under `next`, verified publicly, and only then promoted to `latest`. / 在首选路径上，不可变 staged artifact 在维护者通过 2FA approve 并移动 `latest` 前接受审查与哈希检查；approve 后执行公共精确版本验证。在手动 fallback 上，已有 package 的候选版本先发布到 `next`，通过公共验证后才提升到 `latest`。
10. A published `name@version` is never reused, even if it is later unpublished. / 已发布的 `name@version` 永不复用，即使之后被 unpublish。
11. The durable public evidence is recorded in the version-specific plan before it is moved to `completed/`. A maintainer-local appendix may support that record but never replaces a missing public outcome. / 版本专属计划移动到 `completed/` 前，必须记录长期公开证据。维护者本地附录可以支撑该记录，但绝不能替代缺失的公开结论。

## Standard release workflow / 标准发布流程

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
- Confirm that `dependencies` contains only packages required by the installed runtime, keep build/test tooling in `devDependencies`, and enforce any version-specific exact-pin policy in package metadata tests. / 确认 `dependencies` 只包含安装后运行时必需的 package，把构建/测试工具保留在 `devDependencies`，并通过 package metadata 测试强制执行版本专属的精确锁定策略。
- Inventory every redistributed third-party asset, include its complete required copyright and license notice in the package, and make the package manifest test require that notice file. / 盘点每个再分发的第三方资产，在 package 中包含其要求的完整版权与许可证 notice，并让 package manifest 测试强制要求该 notice 文件。
- Review every lockfile `hasInstallScript` entry, record an exact approval or explicit denial in `allowScripts`, keep `strict-allow-scripts=true`, and pin the supported development npm through `devEngines`. / 审查 lockfile 中每个 `hasInstallScript` 条目，在 `allowScripts` 中记录精确允许或明确拒绝，保持 `strict-allow-scripts=true`，并通过 `devEngines` 固定受支持的开发 npm。
- Verify `publishConfig.registry` and public access. / 验证 `publishConfig.registry` 与 public access。

### 3. Commit, push, and obtain CI evidence / Commit、push 并取得 CI 证据

The release commit must contain every packed source change and generated asset. Push it through the normal review path and wait for all required Linux and Windows jobs. Each job must let `setup-node` select Node without invoking its package-manager cache, then install the exact approved npm version from `runner.temp` before any repository-local npm command, print that version, and only then run `npm ci --strict-allow-scripts`. This ordering matters because `setup-node` otherwise calls the npm bundled with Node to resolve its cache before the approved npm has been bootstrapped, and the repository's strict `devEngines` correctly rejects that npm. Record the commit SHA and CI run URL in the active plan. / Release commit 必须包含所有会被打包的源文件变更与生成资产。通过正常 review 路径推送，并等待所有要求的 Linux 与 Windows job。每个 job 必须先让 `setup-node` 在不调用 package-manager cache 的情况下选择 Node，再从 `runner.temp` 安装精确的获批 npm 版本；在此之前不得执行任何仓库内 npm 命令。随后打印版本，最后才运行 `npm ci --strict-allow-scripts`。这个顺序很重要：否则 `setup-node` 会在获批 npm 完成 bootstrap 前调用 Node 附带的 npm 来解析缓存，而仓库严格的 `devEngines` 会正确拒绝该 npm。把 commit SHA 与 CI run URL 记录到 active plan。

Before continuing locally:

本地继续前：

```powershell
git status --short
git rev-parse HEAD
git log -1 --oneline
```

`git status --short` must be empty. An inspection tarball must not remain as an untracked file inside the worktree during the final dry run or actual publish. / `git status --short` 必须为空。最终 dry run 或实际 publish 期间，检查用 tarball 不得作为 untracked file 留在工作树中。

### 4. Verify the release environment / 验证发布环境

After selecting the supported Node.js line, bootstrap the exact npm version named by the active plan from outside the package root, before running any repository-local npm install, CI, or script command. Running outside the checkout keeps the bootstrap itself outside the project's `devEngines` gate. For the current release contract: / 选择受支持的 Node.js 版本线后，从 package root 之外 bootstrap active plan 指定的精确 npm 版本，然后才能运行仓库内任何 npm install、CI 或 script 命令。从 checkout 之外执行可使 bootstrap 本身不进入项目的 `devEngines` gate。当前发布契约使用：

```powershell
npm install --global npm@12.0.2 --ignore-scripts --registry='https://registry.npmjs.org/'
```

This global operation updates the release toolchain; it is not the project dependency installation. / 该全局操作用于更新发布工具链，不是项目依赖安装。

Record the exact output:

记录精确输出：

```powershell
node --version
npm --version
npm config get registry
npm config get strict-allow-scripts
npm ping --registry='https://registry.npmjs.org/'
```

The registry must be exactly `https://registry.npmjs.org/`, npm must exactly match `devEngines.packageManager.version`, and strict allow-scripts must be `true`. Do not continue with an old Node.js/npm installation, a mirror registry, or a toolchain different from the one approved in the active plan. / Registry 必须精确为 `https://registry.npmjs.org/`，npm 必须与 `devEngines.packageManager.version` 完全一致，strict allow-scripts 必须为 `true`。如果 Node.js/npm 版本过旧、registry 指向镜像，或工具链与 active plan 获批版本不同，不得继续。

Verify the version contract:

验证版本契约：

```powershell
node -p 'require("./package.json").name'
node -p 'require("./package.json").version'
node -p 'JSON.stringify(require("./package.json").engines)'
node -p 'JSON.stringify(require("./package.json").devEngines)'
node -p 'JSON.stringify(require("./package.json").allowScripts)'
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
npm ci --strict-allow-scripts --registry='https://registry.npmjs.org/'
npm install-scripts ls --json
npm run release:check
npm run test:browser
npm audit --omit=dev --registry='https://registry.npmjs.org/'
npm audit --registry='https://registry.npmjs.org/'
git diff --check
git status --short
```

`npm install-scripts ls --json` must report no pending entries. `release:check` must include generated-asset verification, the full Node test suite, installed-package smoke, and package metadata coverage of every lockfile `hasInstallScript` entry, including platform-inert optional dependencies. The final `git status --short` must still be empty. / `npm install-scripts ls --json` 必须不报告 pending 条目。`release:check` 必须包含生成资产验证、完整 Node 测试、安装后 package smoke，以及对 lockfile 中每个 `hasInstallScript` 条目的 package metadata 覆盖，包括当前平台不生效的可选依赖。最后的 `git status --short` 仍必须为空。

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
- every redistributed third-party asset has its complete required copyright and license notice in the packed package / 每个再分发的第三方资产都在打包后的 package 中具有其要求的完整版权与许可证 notice
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

### 8A. Stage through Trusted Publishing and approve with phishing-resistant 2FA / 通过 Trusted Publishing staging 并使用抗钓鱼 2FA approve

This is the preferred path after the external trust relationship has been activated and successfully reviewed. Before the first dispatch, all of the following must already exist and agree exactly: / 外部 trust relationship 已启用并完成审查后，这是首选路径。首次 dispatch 前，以下配置必须已经存在且精确一致：

- GitHub Environment: `npm-release`, restricted to `main`, with administrator bypass disabled where available and an independent required reviewer when the maintainer model supports one. / GitHub Environment：`npm-release`，限制为 `main`，在可用时禁用管理员绕过，并在维护者模型支持时配置独立 required reviewer。
- npm Trusted Publisher: GitHub Actions, organization/user `Yijia-Zhou`, repository `session-analyzer`, workflow filename `publish.yml`, environment `npm-release`. / npm Trusted Publisher：GitHub Actions，organization/user `Yijia-Zhou`，repository `session-analyzer`，workflow filename `publish.yml`，environment `npm-release`。
- Allowed action: `npm stage publish` only; direct `npm publish` is disabled for the trust relationship. / Allowed action：只允许 `npm stage publish`；trust relationship 禁用直接 `npm publish`。
- No `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or npm publication secret exists in the repository, workflow, environment, or organization. / Repository、workflow、environment 与 organization 中不存在 `NPM_TOKEN`、`NODE_AUTH_TOKEN` 或 npm publication secret。

From the GitHub Actions page, select **Stage npm release**, choose the `main` ref, enter the exact stable version already recorded in `package.json`, and dispatch it. Do not choose a tag, development branch, already published version, or disposable test version. The staged version consumes npm's version-uniqueness slot until it is approved or rejected. / 在 GitHub Actions 页面选择 **Stage npm release**，选择 `main` ref，输入已经记录在 `package.json` 中的精确稳定版本并 dispatch。不得选择 tag、development branch、已发布版本或一次性测试版本。Staged version 在 approve 或 reject 前会占用 npm 的版本唯一性位置。

The workflow must prove all of the following: / Workflow 必须证明以下全部条件：

1. `verify` runs with `contents: read` and no OIDC permission, validates `main`, source identity, package/repository/version metadata, and registry `E404`, then passes strict install, `release:check`, browser, production/full audits, and the guarded directory publication dry run. / `verify` 使用 `contents: read` 且没有 OIDC permission，验证 `main`、来源身份、package/repository/version metadata 与 registry `E404`，随后通过 strict install、`release:check`、browser、production/full audit 与受 guard 保护的目录 publication dry run。
2. `verify` creates the inspection candidate outside the worktree with scripts disabled and records its SHA-256 and exact source commit. / `verify` 在工作树之外以禁用脚本方式创建检查候选制品，并记录其 SHA-256 与精确来源 commit。
3. `stage` starts only after `verify`, uses the protected `npm-release` Environment, and alone receives `id-token: write`. / `stage` 只在 `verify` 后启动，使用受保护的 `npm-release` Environment，并且只有它获得 `id-token: write`。
4. `stage` checks out the exact verified SHA, runs no project dependency or script, regenerates the candidate with `npm pack --ignore-scripts`, and requires byte identity with the recorded SHA-256. / `stage` checkout 精确的已验证 SHA，不运行项目依赖或脚本，通过 `npm pack --ignore-scripts` 重新生成候选制品，并要求与已记录 SHA-256 字节一致。
5. `stage` reconfirms registry `E404` immediately before its single OIDC mutation, `npm stage publish <verified-tarball> --tag=latest`. / `stage` 在唯一一次 OIDC mutation `npm stage publish <verified-tarball> --tag=latest` 前立即再次确认 registry `E404`。

Do not approve immediately. On npmjs.com, open the staged package and verify its package name, version, source repository, intended `latest` tag, provenance, file manifest, and workflow source. Download the staged tarball when available and compare its SHA-256 with the workflow summary. A mismatch, missing provenance, unexpected file, wrong source commit, or ambiguous workflow result requires rejection and investigation, not approval. / 不得立即 approve。在 npmjs.com 打开 staged package，验证 package 名、版本、来源 repository、预期 `latest` tag、provenance、文件 manifest 与 workflow 来源。在可用时下载 staged tarball，并将其 SHA-256 与 workflow summary 比较。哈希不一致、provenance 缺失、文件异常、来源 commit 错误或 workflow 结果含糊时，必须 reject 并调查，不得 approve。

Approval is the irreversible human-controlled publication boundary. Approve only through npmjs.com or `npm stage approve <stage-id>` in a maintainer-controlled interactive session, and complete the required npm 2FA challenge with a registered WebAuthn authenticator or hardware security key. Do not approve a release with a phishable TOTP code when the phishing-resistant factor is unavailable; stop and restore WebAuthn access first. Never send an OTP, recovery code, or authenticator output through chat, a workflow input, an environment variable, or a command-line argument. / Approve 是不可逆且由人工控制的公开发布边界。只能通过 npmjs.com，或在维护者控制的交互式 session 中执行 `npm stage approve <stage-id>`，并使用已注册的 WebAuthn authenticator 或硬件安全密钥完成 npm 2FA challenge。抗钓鱼认证因素不可用时，不得改用可能被钓鱼的 TOTP code 批准发布；必须停止并先恢复 WebAuthn 访问。不得通过聊天、workflow input、环境变量或命令行参数发送 OTP、恢复码或 authenticator 输出。

After the first real staged submission proves the trust relationship works, set npm Publishing access to **Require two-factor authentication and disallow tokens** and revoke obsolete automation tokens. Do not tighten this setting before the first successful stage, because npm does not validate a Trusted Publisher binding when it is saved. / 第一次真实 staged submission 证明 trust relationship 可用后，将 npm Publishing access 设置为 **Require two-factor authentication and disallow tokens**，并撤销不再使用的 automation token。在第一次 staging 成功前不得收紧该设置，因为 npm 保存 Trusted Publisher binding 时不会验证它。

After 2FA approval, continue to step 9. The staged `latest` takes effect on approval, so skip step 10. / 2FA approve 后继续第 9 步。Staged `latest` 会在 approve 时生效，因此跳过第 10 步。

### 8B. Authenticate and perform the direct manual fallback / 认证并执行直接手动 fallback

Use this fallback only when Trusted Publishing or staged publishing is unavailable and the version-specific plan explicitly records the reason. This is the first mandatory human-controlled boundary on the fallback path. / 只有 Trusted Publishing 或 staged publishing 不可用，且版本专属计划明确记录原因时，才使用此 fallback。这是 fallback 路径上的第一个强制人工边界。

Use a fresh, isolated npm user configuration for this single registry mutation. Do not reuse the maintainer's normal `~/.npmrc`, do not accept an inherited token, and do not display the temporary `.npmrc` or any credential value. The pre-login `npm whoami` must fail specifically with `ENEEDAUTH`; any other result means the session is not proven clean. / 为这一次 registry mutation 使用全新、隔离的 npm user configuration。不得复用维护者日常的 `~/.npmrc`，不得接受继承的 token，也不得显示临时 `.npmrc` 或任何凭据值。登录前的 `npm whoami` 必须明确以 `ENEEDAUTH` 失败；任何其他结果都表示该会话尚未证明为干净状态。

```powershell
foreach ($releaseTokenName in @('NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_CONFIG__AUTH', 'NPM_CONFIG__AUTH_TOKEN')) {
  if (Test-Path ('Env:' + $releaseTokenName)) {
    throw ('Remove inherited npm credential variable before release: ' + $releaseTokenName)
  }
}
if (Test-Path 'Env:NPM_CONFIG_USERCONFIG') {
  throw 'Start from a shell without an inherited NPM_CONFIG_USERCONFIG.'
}

$releaseRegistry = 'https://registry.npmjs.org/'
$releaseAuthDir = Join-Path ([IO.Path]::GetTempPath()) ('session-analyzer-npm-auth-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $releaseAuthDir
$env:NPM_CONFIG_USERCONFIG = Join-Path $releaseAuthDir '.npmrc'
$releaseLoginSucceeded = $false
$releaseOperationError = $null
$releaseCleanupError = $null

try {
  $preLoginOutput = (& npm whoami --registry=$releaseRegistry 2>&1 | Out-String)
  if ($LASTEXITCODE -eq 0 -or $preLoginOutput -notmatch '(?i)\bENEEDAUTH\b') {
    throw 'The isolated pre-login session did not fail with ENEEDAUTH.'
  }

  npm login --registry=$releaseRegistry
  if ($LASTEXITCODE -ne 0) { throw 'npm login failed.' }
  $releaseLoginSucceeded = $true

  npm whoami --registry=$releaseRegistry
  if ($LASTEXITCODE -ne 0) { throw 'Authenticated npm whoami failed.' }
  npm ping --registry=$releaseRegistry
  if ($LASTEXITCODE -ne 0) { throw 'Authenticated npm ping failed.' }

  npm publish --foreground-scripts --tag='next' --access='public'
  if ($LASTEXITCODE -ne 0) {
    throw 'npm publish failed or exited ambiguously; verify the registry before any retry.'
  }
}
catch {
  $releaseOperationError = $_
}
finally {
  $releaseCredentialWasPresent = Test-Path -LiteralPath $env:NPM_CONFIG_USERCONFIG
  if ($releaseLoginSucceeded -or $releaseCredentialWasPresent) {
    npm logout --registry=$releaseRegistry
    $releaseLogoutExitCode = $LASTEXITCODE
    $postLogoutOutput = (& npm whoami --registry=$releaseRegistry 2>&1 | Out-String)
    if ($releaseLogoutExitCode -ne 0 -or $LASTEXITCODE -eq 0 -or $postLogoutOutput -notmatch '(?i)\bENEEDAUTH\b') {
      $releaseCleanupError = 'Credential revocation was not confirmed. Delete the local credential, then revoke the newly created session token at npmjs.com before continuing.'
    }
  }

  if ((Split-Path -Leaf $releaseAuthDir) -like 'session-analyzer-npm-auth-*') {
    Remove-Item -LiteralPath $releaseAuthDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  else {
    $releaseCleanupError = 'Refused to remove an unexpected credential directory.'
  }
  Remove-Item 'Env:NPM_CONFIG_USERCONFIG' -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $releaseAuthDir) {
    $releaseCleanupError = 'The isolated local credential directory still exists; remove it before continuing.'
  }
}

if ($null -ne $releaseCleanupError) { throw $releaseCleanupError }
if ($null -ne $releaseOperationError) { throw $releaseOperationError }
```

Run this whole `try`/`catch`/`finally` block as one syntactic unit in an interactive terminal. Do not submit `finally` separately: PowerShell will reject it and credential cleanup will not run. Direct publication can require an interactive OTP or browser challenge; a non-interactive agent process must stop and hand control to the maintainer instead of asking for an OTP in chat or retrying with a credential on the command line. / 必须在交互式终端中把整个 `try`/`catch`/`finally` block 作为一个语法单元运行。不得单独提交 `finally`：PowerShell 会拒绝它，凭据清理也不会执行。直接发布可能要求交互式 OTP 或 browser challenge；非交互 agent 进程必须停止并把控制权交给维护者，不得要求在聊天中发送 OTP，也不得把凭据放到命令行后重试。

The publish command intentionally has no path argument. Confirm the package name, version, registry, public access, and `next` tag in npm's prompt/output before completing 2FA. / Publish 命令有意不带 path 参数。在完成 2FA 前，从 npm prompt/output 中确认 package 名、版本、registry、public access 与 `next` tag。

The `finally` cleanup is mandatory even if login, publication, 2FA, the terminal, or the network fails. `npm logout` invalidates the token at the registry; deleting the isolated directory additionally removes the local copy. If logout or the post-logout `ENEEDAUTH` proof fails, use the npm website's Access Tokens page to revoke the newly created session token, record the recovery action, and stop: publication is not operationally complete while a release credential may remain active. / 即使登录、发布、2FA、terminal 或网络失败，`finally` 清理仍是强制步骤。`npm logout` 会在 registry 端使 token 失效；删除隔离目录则额外移除本地副本。如果 logout 或 logout 后的 `ENEEDAUTH` 证明失败，必须通过 npm 网站的 Access Tokens 页面撤销刚创建的 session token，记录恢复动作并停止：只要发布凭据可能仍处于有效状态，发布在操作层面就不算完成。

If the CLI exits ambiguously because of a timeout, disconnect, or terminal failure, complete credential cleanup first and do not immediately retry. Query the exact version from the registry without authentication; the registry write may have succeeded even though the local command did not report success. / 如果 CLI 因 timeout、断线或 terminal failure 含糊退出，先完成凭据清理且不得立即重试。随后在无认证状态下从 registry 查询精确版本；即使本地命令没有报告成功，registry 写入也可能已经成功。

### 9. Verify the public exact version / 验证公共精确版本

Perform this phase without the publication credential. Use another empty temporary user configuration, prove that `npm whoami` returns `ENEEDAUTH`, run the public checks, and remove the temporary directory afterward. This both tests the real public path and prevents an ordinary user-level `.npmrc` from silently authenticating the verification. / 本阶段不得携带发布凭据。使用另一个空的临时 user configuration，证明 `npm whoami` 返回 `ENEEDAUTH`，执行公共检查，然后删除临时目录。这样既能测试真实公共路径，也能防止日常 user-level `.npmrc` 静默地为验证过程提供认证。

Record:

记录：

```powershell
if (Test-Path 'Env:NPM_CONFIG_USERCONFIG') {
  throw 'Start public verification without an inherited NPM_CONFIG_USERCONFIG.'
}
$publicVerifyDir = Join-Path ([IO.Path]::GetTempPath()) ('session-analyzer-npm-public-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $publicVerifyDir
$env:NPM_CONFIG_USERCONFIG = Join-Path $publicVerifyDir '.npmrc'
try {
  $publicWhoamiOutput = (& npm whoami --registry='https://registry.npmjs.org/' 2>&1 | Out-String)
  if ($LASTEXITCODE -eq 0 -or $publicWhoamiOutput -notmatch '(?i)\bENEEDAUTH\b') {
    throw 'Public verification is not demonstrably unauthenticated.'
  }
  npm view 'session-analyzer@<version>' --registry='https://registry.npmjs.org/'
  if ($LASTEXITCODE -ne 0) { throw 'Exact-version metadata verification failed.' }
  npm view 'session-analyzer' dist-tags --json --registry='https://registry.npmjs.org/'
  if ($LASTEXITCODE -ne 0) { throw 'Dist-tag verification failed.' }
  npm view 'session-analyzer' repository --json --registry='https://registry.npmjs.org/'
  if ($LASTEXITCODE -ne 0) { throw 'Repository metadata verification failed.' }
  npx --yes 'session-analyzer@<version>' --help
  if ($LASTEXITCODE -ne 0) { throw 'Exact-version npx verification failed.' }
}
finally {
  if ((Split-Path -Leaf $publicVerifyDir) -notlike 'session-analyzer-npm-public-*') {
    throw 'Refusing to remove an unexpected public-verification directory.'
  }
  Remove-Item -LiteralPath $publicVerifyDir -Recurse -Force
  Remove-Item 'Env:NPM_CONFIG_USERCONFIG' -ErrorAction SilentlyContinue
}
```

From clean Windows and Linux environments, verify: / 在干净 Windows 与 Linux 环境中验证：

- exact-version `npx` / 精确版本 `npx`
- global installation and CLI help / 全局安装与 CLI help
- packaged server startup against a test project and synthetic Codex home / 针对测试项目与合成 Codex home 启动 packaged server
- root HTML and `/api/state` / 根 HTML 与 `/api/state`
- registry metadata and expected dist-tags: the approved staged version at `latest`, unchanged prior `latest` while a manual `next` candidate is under verification, or the recorded automatic `latest` for an inaugural direct publication / registry metadata 与预期 dist-tag：approve 后 staged version 位于 `latest`；手动 `next` 候选验证期间既有 `latest` 保持不变；或首次直接发布已记录的自动 `latest`

Do not use real transcripts for public release verification. / 公共发布验证不得使用真实 transcript。

### 10. Promote a verified direct `next` publication / 提升已验证的直接 `next` 发布

This step applies only to the direct manual fallback. For an established package, continue only after Windows and Linux exact-version verification succeeds:

本步骤只适用于直接手动 fallback。对于已有 package，只有 Windows 与 Linux 精确版本验证成功后才能继续：

Start a second fresh isolated authentication session using step 8's setup, pre-login `ENEEDAUTH` proof, login, and `finally` cleanup control flow. Do **not** execute step 8's publish command again; replace its publish lines with the following single authenticated mutation before running the block: / 使用第 8 步的 setup、登录前 `ENEEDAUTH` 证明、登录与 `finally` 清理控制流，建立第二个全新的隔离认证会话。**不得**再次执行第 8 步的 publish 命令；运行该 block 前，必须把其中的 publish 行替换为以下唯一的认证 mutation：

```powershell
npm dist-tag add 'session-analyzer@<version>' 'latest' --registry=$releaseRegistry
if ($LASTEXITCODE -ne 0) { throw 'latest promotion failed or exited ambiguously.' }
```

After that session has logged out, removed its temporary `.npmrc`, and proved `ENEEDAUTH`, create a third isolated, empty user configuration for the final read-only check. Prove `ENEEDAUTH` again before reading the tags; otherwise the maintainer's ordinary `~/.npmrc` could silently authenticate this evidence. / 该会话完成 logout、删除临时 `.npmrc` 并证明 `ENEEDAUTH` 后，为最终只读检查创建第三个隔离、空白的 user configuration。读取 tag 前必须再次证明 `ENEEDAUTH`；否则维护者日常的 `~/.npmrc` 可能静默地为这份证据提供认证。

```powershell
foreach ($finalTagTokenName in @('NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_CONFIG__AUTH', 'NPM_CONFIG__AUTH_TOKEN')) {
  if (Test-Path ('Env:' + $finalTagTokenName)) {
    throw ('Remove inherited npm credential variable before final tag verification: ' + $finalTagTokenName)
  }
}
if (Test-Path 'Env:NPM_CONFIG_USERCONFIG') {
  throw 'Start final tag verification without an inherited NPM_CONFIG_USERCONFIG.'
}

$finalTagRegistry = 'https://registry.npmjs.org/'
$finalTagVerifyDir = Join-Path ([IO.Path]::GetTempPath()) ('session-analyzer-npm-tags-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $finalTagVerifyDir
$env:NPM_CONFIG_USERCONFIG = Join-Path $finalTagVerifyDir '.npmrc'
try {
  $finalTagWhoamiOutput = (& npm whoami --registry=$finalTagRegistry 2>&1 | Out-String)
  if ($LASTEXITCODE -eq 0 -or $finalTagWhoamiOutput -notmatch '(?i)\bENEEDAUTH\b') {
    throw 'Final dist-tag verification is not demonstrably unauthenticated.'
  }

  npm dist-tag ls 'session-analyzer' --registry=$finalTagRegistry
  if ($LASTEXITCODE -ne 0) { throw 'Final unauthenticated dist-tag verification failed.' }
}
finally {
  Remove-Item 'Env:NPM_CONFIG_USERCONFIG' -ErrorAction SilentlyContinue
  if ((Split-Path -Leaf $finalTagVerifyDir) -notlike 'session-analyzer-npm-tags-*') {
    throw 'Refusing to remove an unexpected final-tag-verification directory.'
  }
  Remove-Item -LiteralPath $finalTagVerifyDir -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $finalTagVerifyDir) {
    throw 'The isolated final-tag-verification directory still exists; remove it before continuing.'
  }
}
```

The promotion is another human-controlled registry mutation and may require 2FA; the final `dist-tag ls` is read-only and must be demonstrably unauthenticated. If the anonymous post-publication read already shows an inaugural package's automatic `latest` at the intended version, do **not** perform a redundant authenticated promotion: skip directly to the final anonymous tag evidence and record the first-publication exception. Otherwise confirm that promotion moved `latest` as intended. In either case, retain, remove, or update `next` according to the version-specific plan. / 提升是另一个由人工控制的 registry mutation，可能要求 2FA；最终 `dist-tag ls` 是只读操作，且必须可证明未认证。如果发布后的匿名读取已经显示首发 package 的自动 `latest` 指向预期版本，**不得**执行多余的认证提升：应直接进入最终匿名 tag 证据，并记录首发例外。否则应确认提升按预期移动了 `latest`。无论哪种情况，都应按版本专属计划保留、移除或更新 `next`。

### 11. Create the release tag and GitHub Release / 创建 release tag 与 GitHub Release

Tag the exact commit used as the clean publication source. Do not tag a rebuilt, amended, or later commit. / 对作为干净发布来源的精确 commit 打 tag。不得对重新构建、amend 后或更晚的 commit 打 tag。

```powershell
git tag -a 'v<version>' -m 'Release v<version>' '<release-commit>'
git push origin 'v<version>'
```

Create the GitHub Release from that tag and use the bilingual changelog entry as release notes. Verify that npm version, Git tag, GitHub Release, and release commit all agree. / 从该 tag 创建 GitHub Release，并使用双语 changelog 条目作为 release notes。验证 npm version、Git tag、GitHub Release 与 release commit 全部一致。

### 12. Close the version plan / 收尾版本计划

- Record all public verification outcomes, artifact hash continuity, and URLs in the version-specific plan. / 在版本专属计划中记录全部公共验证结论、制品哈希连续性与 URL。
- Record a sanitized public summary of any material warning, retry, exception, deprecation, or dist-tag correction. Put raw output and machine- or account-specific diagnostics only in the maintainer-local appendix. / 对任何实质性 warning、retry、exception、deprecation 或 dist-tag 修正记录脱敏后的公开摘要；原始输出及机器／账户特有诊断只进入维护者本地附录。
- Update the trusted-publishing debt status if automation changed. / 如果自动化发生变化，更新 trusted-publishing 技术债状态。
- Move the active plan to `completed/` only after staged review and 2FA approval (or a documented manual fallback), public verification, any required manual promotion, tag, and GitHub Release are all complete. / 只有 staged 审查与 2FA approve（或已记录的手动 fallback）、公共验证、任何必要的手动 promotion、tag 与 GitHub Release 全部完成后，才把 active plan 移到 `completed/`。

## Release evidence template / 发布证据模板

Copy the public record below into the version-specific plan. It must remain sufficient for a reviewer to establish what was released, from which commit, which gates passed, whether the staged and public artifacts preserved the approved bytes, and whether public verification completed. Do not include local absolute paths, maintainer identity, account screenshots, internal stage identifiers, ordinary npm configuration, or raw failure logs. / 把下面的公开记录复制到版本专属计划。它必须足以让 reviewer 判断发布了什么、来源 commit 是什么、哪些 gate 已通过、staged 与公开制品是否保持获批字节，以及公共验证是否完成。不得包含本地绝对路径、维护者身份、账户截图、内部 stage identifier、日常 npm 配置或原始失败日志。

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
- strict-allow-scripts:
- Publication path (staged OIDC / manual fallback):

Repository state:
- git status:
- package.json version:
- package-lock.json version:
- changelog entry:
- publishConfig:
- devEngines:
- allowScripts:

CI:
- Commit:
- Run URL:
- Linux Node 22:
- Linux Node 24:
- Windows Node 24:
- Browser:
- Package smoke:

Local gates:
- npm ci --strict-allow-scripts:
- pending install scripts:
- release:check:
- browser tests:
- production audit:
- full audit:
- git diff --check:
- final guarded publish dry-run:
- prepublishOnly observed:

Inspection candidate:
- Entry count:
- SHA-256:
- Allowlist result:
- Third-party notices result:
- Sensitive-path result:
- Installed CLI/server result:

Publication and public verification:
- Trusted Publisher and GitHub Environment review result:
- publish.yml run URL and source SHA:
- Verify-job candidate SHA-256:
- Stage-job reproduced SHA-256:
- Staged identity/manifest/provenance/source review result:
- Downloaded staged tarball SHA-256:
- Maintainer 2FA approval result; identity and factor details not recorded:
- Manual-fallback isolation and credential-cleanup result, if used:
- Exact-version registry metadata:
- Windows public smoke:
- Linux public smoke:
- Public-smoke exception and substitute evidence:
- Public tarball SHA-256:
- Promotion result, if used:
- Final dist-tags:

Exceptions and recovery actions:
- None / sanitized summary:

Maintainer-local appendix:
- Relative path:
- Completion status:
```

### Maintainer-local evidence appendix / 维护者本地证据附录

When raw or account-side evidence is useful, store it under `tmp/release-evidence/<version>.md`; `tmp/` is Git ignored. The appendix is optional supporting material, is not available to repository reviewers, and may not be the sole record of any fact required to approve or close a release. The public plan records only the relative path and completion status. / 当原始或账户侧证据有用时，将其保存在 `tmp/release-evidence/<version>.md`；`tmp/` 已被 Git 忽略。该附录只是可选支撑材料，仓库 reviewer 无法访问，也不得成为批准或完成发布所需事实的唯一记录。公开计划只记录其相对路径与完成状态。

The local appendix may retain raw command-output pointers, account-side configuration readback or screenshot locations, the internal staged-package identifier, exact authentication-session cleanup timestamps, machine-specific environment notes, integration-only candidate filename/size/SHA-1/integrity values, and unsanitized transient diagnostics. It must not contain any token, OTP, recovery code, authenticator output, credential-bearing URL, `.npmrc` contents, or other reusable secret. Maintainer identity and authenticator details are not release evidence and must not be recorded. / 本地附录可以保留原始命令输出指针、账户侧配置 readback 或截图位置、内部 staged-package identifier、认证 session 清理的精确时间、本机环境说明、仅属于 integration 的候选 filename／size／SHA-1／integrity 值，以及未脱敏的临时诊断。它不得包含 token、OTP、恢复码、authenticator 输出、携带凭据的 URL、`.npmrc` 内容或其他可复用秘密。维护者身份与 authenticator 细节不属于发布证据，不得记录。

If the appendix and public record disagree, stop and regenerate or re-review the evidence; never resolve the mismatch by weakening or deleting the public gate. / 如果本地附录与公开记录不一致，必须停止并重新生成或审查证据；不得通过削弱或删除公开 gate 来消除不一致。

## Failure and recovery / 失败与恢复

### Before any registry write / 在任何 registry 写入前

Discard the candidate evidence, correct the repository, commit the correction, rerun CI and every invalidated local phase, then generate a new candidate and dry run. Never waive a failed gate silently. / 丢弃候选证据，修正仓库，提交修正，重跑 CI 与所有已失效的本地阶段，然后生成新候选并重新 dry run。不得静默豁免失败 gate。

### Trusted Publisher authentication fails / Trusted Publisher 认证失败

Do not add an npm token as a workaround. Confirm that the workflow is running from `main` on a GitHub-hosted runner; the npm binding's organization/user, repository, case-sensitive workflow filename, and environment name exactly match; the stage job has `id-token: write`; and `package.json#repository.url` points to this repository. npm does not validate the binding when it is saved. / 不得通过添加 npm token 绕过。确认 workflow 从 `main` 在 GitHub-hosted runner 上运行；npm binding 的 organization/user、repository、区分大小写的 workflow filename 与 environment name 精确匹配；stage job 具有 `id-token: write`；并且 `package.json#repository.url` 指向本仓库。npm 保存 binding 时不会验证它。

### Ambiguous staging result / Staging 结果含糊

Do not dispatch again immediately. Inspect the workflow log and npmjs.com Staged Packages view, or use an isolated maintainer session to run `npm stage list 'session-analyzer'`. If the intended version is staged, treat that staged artifact as authoritative and review or reject it; if it is absent, diagnose OIDC or transport state before retrying. A public `npm view` `E404` cannot distinguish “not staged” from “privately staged.” / 不得立即再次 dispatch。检查 workflow log 与 npmjs.com Staged Packages 页面，或使用隔离的维护者 session 执行 `npm stage list 'session-analyzer'`。如果预期版本已经 staged，则把该 staged artifact 视为权威对象并审查或 reject；如果不存在，则在重试前诊断 OIDC 或 transport 状态。公共 `npm view` 的 `E404` 无法区分“尚未 staged”与“已私有 staging”。

### Staged artifact review fails / Staged artifact 审查失败

Do not approve it. Record the mismatch, use npmjs.com or an isolated interactive session with 2FA to reject the exact stage identifier, confirm the public `latest` remains unchanged, invalidate the workflow evidence, and correct the repository or workflow through normal review. Only a fresh workflow run from the newly approved exact commit may create the replacement stage. / 不得 approve。记录不一致，通过 npmjs.com 或带 2FA 的隔离交互式 session reject 精确 stage identifier，确认公共 `latest` 保持不变，使 workflow 证据失效，并通过正常 review 修正仓库或 workflow。只有从新获批精确 commit 执行的全新 workflow run 才能创建替代 stage。

### Ambiguous publication result / 发布结果含糊

Complete credential cleanup, then query `npm view <name>@<version>` without authentication before retrying. If the version exists, treat it as published and move to exact-version verification. If it does not exist, diagnose authentication or transport state before another attempt. / 先完成凭据清理，再以无认证方式查询 `npm view <name>@<version>`，然后才可考虑重试。如果版本存在，按已发布处理并进入精确版本验证。如果不存在，在再次尝试前诊断认证或传输状态。

### Credential cleanup failure / 凭据清理失败

Always delete the exact isolated credential directory and unset `NPM_CONFIG_USERCONFIG`, even if `npm logout` fails. Then open npmjs.com using a trusted browser session, revoke the newly created session token from Access Tokens, and confirm it no longer appears as active. Do not run another registry mutation, declare the release complete, paste the token into a command, or print the `.npmrc`. Record the failed logout, local deletion, server-side revocation, and confirmation in release evidence. / 即使 `npm logout` 失败，也必须删除精确的隔离凭据目录并清除 `NPM_CONFIG_USERCONFIG`。随后使用可信浏览器会话打开 npmjs.com，从 Access Tokens 撤销刚创建的 session token，并确认它不再显示为 active。不得继续执行其他 registry mutation，不得宣布发布完成，不得把 token 粘贴进命令，也不得打印 `.npmrc`。在发布证据中记录 logout 失败、本地删除、服务端撤销与确认结果。

### Unreviewed dependency install script / 未审查的依赖 install script

Do not bypass `ESTRICTALLOWSCRIPTS` with `--dangerously-allow-all-scripts`. First install or update metadata with scripts disabled in a disposable review state, inspect the exact locked tarball, integrity, lifecycle body, necessity, and platform scope, then record either an exact-version `true` approval or an intentional `false` denial. Recreate dependencies with `npm ci --strict-allow-scripts`, run `npm install-scripts ls --json`, and rerun all invalidated gates before committing. / 不得使用 `--dangerously-allow-all-scripts` 绕过 `ESTRICTALLOWSCRIPTS`。应先在一次性审查状态中禁用脚本，仅安装或更新 metadata；检查精确锁定 tarball、integrity、lifecycle 内容、必要性与平台范围，再记录精确版本的 `true` 允许或有意的 `false` 拒绝。提交前重新使用 `npm ci --strict-allow-scripts` 创建依赖，执行 `npm install-scripts ls --json`，并重跑全部已失效 gate。

### Published under `next` but verification fails / 已以 `next` 发布但验证失败

- For an established package, do not promote it to `latest`. For an inaugural package, first determine whether the registry already assigned automatic `latest`; if so, treat the failed version as already exposed by default and begin incident response immediately. / 对已有 package，不得把它提升到 `latest`。对于首发 package，应先确认 registry 是否已经自动分配 `latest`；如果是，则必须按该失败版本已经成为默认版本处理，并立即启动 incident response。
- Deprecate the exact version with a precise message when useful. / 必要时使用精确消息 deprecate 该版本。
- Fix the repository and publish a new patch version. / 修复仓库并发布新的 patch 版本。
- Do not attempt to overwrite or reuse the failed version. / 不得尝试覆盖或复用失败版本。

### Staged package was approved but public verification fails / Staged package approve 后公共验证失败

Treat the version as published and immutable. Move `latest` back to the last verified version when safe, record the incident, deprecate the failed exact version when useful, fix the repository, and release a new patch. Never attempt to approve, stage, or publish the same version again. / 按照该版本已经公开且不可变处理。在安全时把 `latest` 恢复到上一个已验证版本，记录 incident，必要时 deprecate 失败的精确版本，修复仓库并发布新的 patch。不得再次 approve、staging 或发布相同版本。

### Incorrect `latest` promotion / 错误提升到 `latest`

Move `latest` back to the last verified version, record the incident, and publish a corrected patch version if necessary. Do not move or recreate an already public release tag to disguise the mistake. / 把 `latest` 恢复到上一个已验证版本，记录 incident，并在必要时发布修正 patch 版本。不得移动或重建已公开 release tag 来掩盖错误。

### Unpublish / Unpublish

Unpublish is not the normal rollback mechanism. npm registry versions are immutable, and an unpublished `name@version` cannot be reused. Prefer leaving a failed version off `latest`, deprecating it, and releasing a new patch. / Unpublish 不是常规回滚机制。npm registry 版本不可变，已 unpublish 的 `name@version` 也不能复用。应优先让失败版本不进入 `latest`、将其 deprecate，并发布新的 patch。

## Known traps / 已知陷阱

- `npm publish <file.tgz>` bypasses this repository's intended `prepublishOnly` gate in the verified npm 12 workflow. / 在已验证的 npm 12 流程中，`npm publish <file.tgz>` 会绕过本仓库预期的 `prepublishOnly` gate。
- `npm stage publish <file.tgz>` also skips `prepublishOnly`; it is allowed only inside the repository's hash-gated OIDC job after the separate unprivileged directory dry run. / `npm stage publish <file.tgz>` 同样会跳过 `prepublishOnly`；只有在独立无特权目录 dry run 之后，才允许仓库的哈希 gate OIDC job 使用该路径。
- npm does not validate a Trusted Publisher binding when it is saved; an exact-name error appears only during a real stage attempt. / npm 保存 Trusted Publisher binding 时不会验证它；精确名称配置错误只会在真实 staging 尝试中出现。
- Running a workflow that references a nonexistent GitHub Environment can create it without protection rules. Create and protect `npm-release` before the first dispatch. / 运行引用不存在 GitHub Environment 的 workflow 可能会创建一个没有 protection rule 的 environment。首次 dispatch 前必须先创建并保护 `npm-release`。
- `id-token: write` is available to processes in the entire job. The stage job therefore installs no project dependency and executes no project script. / `id-token: write` 可供整个 job 中的进程使用。因此 stage job 不安装项目依赖，也不执行项目脚本。
- A staged package is private but still occupies the package/version uniqueness slot, and its tag cannot be changed. Review version and tag before dispatch; reject an incorrect stage instead of approving it. / Staged package 虽然私有，但仍占用 package/version 唯一性位置，且其 tag 不能更改。Dispatch 前审查版本与 tag；错误 stage 应 reject 而不是 approve。
- `npm publish` without `--tag='next'` assigns `latest` by default. / `npm publish` 不带 `--tag='next'` 时默认分配 `latest`。
- `next` is public and immediately installable; it is not npm staged publishing. / `next` 是公开且可立即安装的版本，不等同于 npm staged publishing。
- An inaugural registry package must have `latest`; the first direct publish can therefore create `latest` for the only version even when `--tag='next'` also creates `next`. Ordinary dist-tags cannot provide a non-default first-release holding area. / Registry 中首次建立的 package 必须存在 `latest`；因此第一次直接 publish 即使通过 `--tag='next'` 同时创建 `next`，仍可能把唯一版本创建为 `latest`。普通 dist-tag 无法为首发提供不影响默认安装的 holding area。
- `--ignore-scripts` disables the lifecycle protection. / `--ignore-scripts` 会禁用生命周期保护。
- npm 12 blocks unreviewed dependency install scripts by default, but only `strict-allow-scripts=true` turns a newly pending script into a failed install; warnings alone are not an accepted release gate. / npm 12 默认阻止未审查的依赖 install script，但只有 `strict-allow-scripts=true` 会让新的 pending script 导致安装失败；仅产生 warning 不能作为获接受的发布 gate。
- npm 10/11 must not be assumed to enforce npm 12's install-script policy. Pin and print npm 12.0.2 before every CI install and match the version-specific `devEngines` locally. / 不得假设 npm 10/11 会执行 npm 12 的 install-script 策略。每次 CI 安装前都必须固定并打印 npm 12.0.2，本地则必须匹配版本计划的 `devEngines`。
- `--dangerously-allow-all-scripts` bypasses explicit approvals and denials and is forbidden in release preparation. / `--dangerously-allow-all-scripts` 会绕过明确的允许与拒绝，因此禁止用于发布准备。
- `allowScripts` does not sandbox an approved script and does not constrain root-owned lifecycle scripts. / `allowScripts` 不会 sandbox 已批准脚本，也不约束根项目拥有的 lifecycle script。
- A user-level `.npmrc` can point installs and diagnostics at a mirror; always pass or verify the official registry. / 用户级 `.npmrc` 可能让安装与诊断指向镜像；始终显式传入或验证官方 registry。
- `npm login` writes a registry credential to the configured user `.npmrc`; using the normal userconfig leaves a reusable release credential behind. / `npm login` 会把 registry 凭据写入配置的 user `.npmrc`；使用日常 userconfig 会留下可复用的发布凭据。
- Deleting `.npmrc` removes only the local copy. A successful `npm logout` or explicit server-side token revocation is required to invalidate the registry credential. / 删除 `.npmrc` 只会移除本地副本；必须成功执行 `npm logout` 或显式进行服务端 token 撤销，才能使 registry 凭据失效。
- One login must not span publication, public verification, and `latest` promotion. Separate short-lived sessions reduce credential exposure and make the public check genuinely unauthenticated. / 一次登录不得横跨发布、公共验证与 `latest` 提升。分离的短时会话能够缩短凭据暴露时间，并让公共检查真正处于无认证状态。
- A PowerShell `finally` block is not a standalone command. Paste and run the complete authentication block at once; if cleanup syntax is split accidentally, stop, run explicit logout/`ENEEDAUTH`/directory-removal recovery, and record the incident before public verification. / PowerShell 的 `finally` block 不是独立命令。必须一次性粘贴并运行完整认证 block；如果误把 cleanup 语法拆开，立即停止，显式执行 logout、`ENEEDAUTH` 与目录删除恢复，并在公共验证前记录该事件。
- A candidate `.tgz` inside the worktree makes the tree dirty and can be overwritten or removed by later package-smoke runs. / 工作树内的候选 `.tgz` 会使工作树变脏，并可能被后续 package-smoke 覆盖或删除。
- npm 11 and npm 12 use different `npm pack --json` top-level shapes; repository package-smoke normalization supports both, but hand-written parsers must not assume one shape. / npm 11 与 npm 12 使用不同的 `npm pack --json` 顶层形态；仓库 package-smoke normalization 已兼容两者，但手写 parser 不得只假设其中一种。
- A package-name `E404` is not a reservation; recheck immediately before first publication. / Package 名 `E404` 不构成保留；首次发布前必须立即复查。
- A CLI timeout does not prove the registry write failed. / CLI timeout 不能证明 registry 写入失败。
- `name@version` cannot be reused after publication or unpublish. / `name@version` 在发布或 unpublish 后都不能复用。

## Alternatives considered / 已考虑的备选方案

### Publish the exact inspected tarball / 发布精确的已检查 tarball

- Advantage: the local bytes being uploaded are directly known. / 优点：直接知道上传的本地 bytes。
- Rejected for direct `npm publish`: npm treats the tarball as already prepared and does not execute its embedded `prepublishOnly`, so the irreversible path bypasses the repository release guard. Accepted only for private `npm stage publish` inside the minimal OIDC job after the unprivileged directory guard and exact cross-job SHA-256 reproduction. / 对直接 `npm publish` 已拒绝：npm 把 tarball 视为已准备制品，不执行其中的 `prepublishOnly`，因此不可逆路径会绕过仓库 release guard。只有在无特权目录 guard 与精确跨 job SHA-256 复现后，才允许最小 OIDC job 把它用于私有 `npm stage publish`。

### Add a custom publishing wrapper / 增加自定义发布 wrapper

- Advantage: a wrapper could rerun gates, verify a recorded hash, and then publish the same tarball. / 优点：wrapper 可以重跑 gate、验证已记录哈希，然后发布同一个 tarball。
- Rejected in favor of declarative workflow steps: custom repository code executed in the OIDC job would widen the credential-bearing execution surface. The workflow keeps comparison logic inline and executes no project module. / 已拒绝，改用声明式 workflow step：在 OIDC job 中执行自定义仓库代码会扩大携带 credential 的执行面。Workflow 将比较逻辑保持为 inline，且不执行项目 module。

### Publish directly to `latest` / 直接发布到 `latest`

- Advantage: fewer registry mutations. / 优点：registry mutation 更少。
- Rejected for direct publication. Accepted only as the immutable intended tag of a private staged artifact: the public `latest` moves only after maintainer review and 2FA approval. / 对直接发布已拒绝。只有作为私有 staged artifact 的不可变预期 tag 时才接受：公共 `latest` 只会在维护者审查与 2FA approve 后移动。

### Create the Git tag before npm publication / 在 npm 发布前创建 Git tag

- Advantage: the apparent release identity exists before publication. / 优点：发布前已有表面上的 release identity。
- Rejected: a failed or abandoned registry publication would leave a misleading public tag. The immutable release commit is recorded first; the public tag follows successful registry verification. / 已拒绝：registry 发布失败或放弃时会留下误导性的公开 tag。应先记录不可变 release commit，在 registry 验证成功后再创建公开 tag。

### Trusted Publishing or npm staged publishing / Trusted Publishing 或 npm staged publishing

- Accepted as the preferred path for existing packages: the exact trust relationship is stage-only, the workflow keeps OIDC out of the verification job, and public release requires maintainer 2FA approval. / 已接受为已有 package 的首选路径：精确 trust relationship 只允许 staging，workflow 不向验证 job 提供 OIDC，公开发布需要维护者 2FA approve。
- Direct manual publication remains a fallback until the external binding and first real staged release are proven, and afterward only when a version-specific plan records why staged publishing is unavailable. / 外部 binding 与第一次真实 staged release 得到验证前，直接手动发布继续作为 fallback；此后只有在版本专属计划记录 staged publishing 不可用原因时才使用。

## References / 参考

- npm scripts and lifecycle order: `https://docs.npmjs.com/cli/v11/using-npm/scripts/`
- npm publish: `https://docs.npmjs.com/cli/publish/`
- npm registry package metadata (`latest` requirement): `https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md`
- npm login: `https://docs.npmjs.com/cli/v12/commands/npm-login/`
- npm logout: `https://docs.npmjs.com/cli/v12/commands/npm-logout/`
- Revoking access tokens: `https://docs.npmjs.com/revoking-access-tokens/`
- npmrc configuration: `https://docs.npmjs.com/cli/v12/configuring-npm/npmrc/`
- npm install-script approvals: `https://docs.npmjs.com/cli/v12/commands/npm-install-scripts/`
- npm strict allow-scripts configuration: `https://docs.npmjs.com/cli/v12/using-npm/config/#strict-allow-scripts`
- npm development toolchain constraints: `https://docs.npmjs.com/cli/v12/configuring-npm/package-json/#devengines`
- Creating and publishing unscoped public packages: `https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/`
- Requiring 2FA for publishing: `https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/`
- Adding dist-tags: `https://docs.npmjs.com/adding-dist-tags-to-packages/`
- npm unpublish policy: `https://docs.npmjs.com/policies/unpublish/`
- Trusted Publishing: `https://docs.npmjs.com/trusted-publishers/`
- npm staged publishing: `https://docs.npmjs.com/staged-publishing/`
- npm stage CLI: `https://docs.npmjs.com/cli/v12/commands/npm-stage/`
- GitHub deployment environments: `https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment`

## Decision log / 决策日志

- 2026-07-31: Accepted clean-tree, directory-based manual publication as the only supported direct `npm publish` path. Candidate tarballs remain inspection evidence and must not be passed to the irreversible command. This decision followed a review finding and an npm 12.0.2 dry-run reproduction showing that positional tarball publication skipped `prepublishOnly`. / 2026-07-31：接受基于干净工作树、从目录执行的手动发布，作为唯一受支持的直接 `npm publish` 路径。候选 tarball 继续作为检查证据，不得传给不可逆命令。该决策源于一次 review finding，以及 npm 12.0.2 dry-run 复现：带位置 tarball 的发布会跳过 `prepublishOnly`。
- 2026-07-31: Retained `next` as the live pre-promotion dist-tag for established-package releases, with exact-version Windows/Linux verification required before moving the existing `latest`. / 2026-07-31：对于已有 package 的发布，保留 `next` 作为提升前的公开 dist-tag，并要求在移动既有 `latest` 前完成精确版本的 Windows/Linux 验证。
- 2026-07-31: Required isolated, short-lived manual authentication sessions for publication and promotion. Each session must begin with an unauthenticated `ENEEDAUTH` proof, perform one registry mutation, end with `npm logout`, remove its temporary userconfig, and prove `ENEEDAUTH` again; public verification runs between the two sessions without credentials. / 2026-07-31：要求发布与提升分别使用隔离、短时的手动认证会话。每个会话都必须以无认证的 `ENEEDAUTH` 证明开始，仅执行一次 registry mutation，以 `npm logout` 结束，删除临时 userconfig，并再次证明 `ENEEDAUTH`；两次会话之间的公共验证不携带凭据。
- 2026-08-01: Recorded the inaugural-package exception after `session-analyzer@0.1.2` was published with `--tag='next'` and the registry created both `next` and required `latest` at `0.1.2`. Future first-package direct releases must treat all pre-publication gates as the last blocking boundary, skip redundant promotion when anonymous evidence already shows the intended automatic `latest`, and use npm staged publishing when a true pre-default approval boundary is required. / 2026-08-01：记录首发 package 例外：`session-analyzer@0.1.2` 使用 `--tag='next'` 发布后，registry 同时把 `next` 与必需的 `latest` 创建为 `0.1.2`。今后首次直接发布 package 时，必须把全部发布前 gate 视为最后一道阻塞边界；如果匿名证据已显示预期的自动 `latest`，则跳过多余 promotion；若需要真正的默认发布前审批边界，则使用 npm staged publishing。
- 2026-08-01: Required npm 12.0.2 strict default-deny dependency install-script enforcement for source, CI, and release preparation. Every lockfile `hasInstallScript` entry must have an exact approval or explicit denial, CI must bootstrap the approved npm before `npm ci --strict-allow-scripts`, and `--dangerously-allow-all-scripts` is forbidden. / 2026-08-01：要求源码环境、CI 与发布准备使用 npm 12.0.2 strict 默认拒绝依赖 install-script 策略。Lockfile 中每个 `hasInstallScript` 条目都必须具有精确允许或明确拒绝；CI 必须在 `npm ci --strict-allow-scripts` 前 bootstrap 获批 npm；并禁止使用 `--dangerously-allow-all-scripts`。
- 2026-08-02: Accepted stage-only GitHub Actions Trusted Publishing as the preferred path for future established-package releases. The trust binding names `publish.yml` and protected environment `npm-release`, allows `npm stage publish` but not `npm publish`, stores no npm token, and leaves public release behind maintainer 2FA approval. The workflow separates unprivileged gates from the OIDC job; the OIDC job executes no project dependency or script and may stage only a tarball whose SHA-256 exactly reproduces the verified candidate from the same commit. / 2026-08-02：接受只允许 staging 的 GitHub Actions Trusted Publishing，作为未来已有 package 发布的首选路径。Trust binding 指定 `publish.yml` 与受保护 environment `npm-release`，允许 `npm stage publish` 但不允许 `npm publish`，不保存 npm token，并将公开发布保留在维护者 2FA approve 之后。Workflow 将无特权 gate 与 OIDC job 分离；OIDC job 不执行项目依赖或脚本，只能 staging 与同一 commit 已验证候选 SHA-256 精确一致的 tarball。
- 2026-08-03: Split release evidence into a durable public version record and an optional Git-ignored maintainer-local appendix. Public evidence retains release identity, gate outcomes, artifact hash continuity, review conclusions, URLs, and public verification; raw output, account-side readback, machine-specific details, internal stage identifiers, and transient diagnostics remain local. Secrets are prohibited in both layers. / 2026-08-03：将发布证据拆分为长期公开的版本记录与可选的 Git 忽略维护者本地附录。公开证据保留 release identity、gate 结论、制品哈希连续性、审查结论、URL 与公共验证；原始输出、账户侧 readback、本机特有信息、内部 stage identifier 与临时诊断保留在本地。两层均禁止记录秘密。
