# npm Trusted Publishing and staged releases / npm Trusted Publishing 与 staged release

## Objective / 目标

Replace reusable npm publication credentials with a GitHub Actions OIDC trust relationship that can only submit an already verified `session-analyzer` tarball to npm staged publishing. Keep the final public release behind maintainer review and npm 2FA approval, then retain the existing anonymous public verification, Git tag, and GitHub Release sequence. / 使用 GitHub Actions OIDC trust relationship 替代可复用的 npm 发布凭据，并限制它只能把已经验证的 `session-analyzer` tarball 提交到 npm staged publishing。最终公开发布继续由维护者审查并通过 npm 2FA approve，之后保留现有的匿名公共验证、Git tag 与 GitHub Release 顺序。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed 2026-08-03; stage-only trust accepted by the live v0.1.3 release, WebAuthn approval, public provenance, and final release verification / 状态：已于 2026-08-03 完成；stage-only trust 已通过真实 v0.1.3 发布、WebAuthn approval、公共 provenance 与最终发布验证完成验收
- Started: 2026-08-02 / 开始日期：2026-08-02
- Package: `session-analyzer`
- Workflow: `.github/workflows/publish.yml`
- GitHub Environment: `npm-release`
- Related runbook: `docs/design-docs/npm-release-runbook.md`
- Related version plan: `docs/exec-plans/completed/2026-08-02-v0.1.3-release.md`
- Related debt: `docs/exec-plans/tech-debt-tracker.md#10-release-workflow-and-trusted-publishing--发布流程与-trusted-publishing`

## Accepted design / 已接受设计

1. Use `workflow_dispatch` from `main`; do not stage automatically on a push, tag, pull request, or GitHub Release event. / 只允许从 `main` 手动执行 `workflow_dispatch`；不得在 push、tag、pull request 或 GitHub Release event 上自动 staging。
2. Configure the npm Trusted Publisher for GitHub Actions with organization/user `Yijia-Zhou`, repository `session-analyzer`, workflow filename `publish.yml`, environment `npm-release`, and only the `npm stage publish` allowed action. Direct `npm publish` permission remains disabled. / npm Trusted Publisher 使用 GitHub Actions，配置 organization/user `Yijia-Zhou`、repository `session-analyzer`、workflow filename `publish.yml`、environment `npm-release`，且 allowed action 只允许 `npm stage publish`；继续禁用直接 `npm publish` 权限。
3. The unprivileged `verify` job installs dependencies with strict allow-scripts, runs release, browser, audit, and guarded directory dry-run gates, then records a candidate SHA-256. / 无特权的 `verify` job 使用 strict allow-scripts 安装依赖，执行 release、browser、audit 与受 guard 保护的目录 dry-run gate，然后记录候选制品 SHA-256。
4. The `stage` job alone receives `id-token: write`. It uses pinned official actions, installs no project dependency, executes no project script, checks out the exact verified commit, regenerates the tarball with scripts disabled, and requires byte identity with the verified SHA-256 before calling `npm stage publish`. / 只有 `stage` job 获得 `id-token: write`。它使用固定到 commit 的官方 action，不安装项目依赖、不执行项目脚本，checkout 精确的已验证 commit，以禁用脚本的方式重新生成 tarball，并在调用 `npm stage publish` 前要求其与已验证 SHA-256 字节一致。
5. The positional tarball is allowed only for private staging under this cross-job hash contract. It remains forbidden for direct `npm publish`, where it bypasses `prepublishOnly`. / 只有在上述跨 job 哈希契约下，才允许把位置 tarball 用于私有 staging。直接 `npm publish` 仍禁止使用位置 tarball，因为该路径会绕过 `prepublishOnly`。
6. Stable releases stage with immutable tag `latest`. The existing public `latest` does not move until a maintainer approves the staged package with npm 2FA. / 稳定版以不可变的 `latest` tag staging；维护者通过 npm 2FA approve staged package 前，现有公共 `latest` 不会移动。
7. No `NPM_TOKEN`, `NODE_AUTH_TOKEN`, publish token, or npm credential is stored in GitHub Actions. Public dependencies require no read token. / GitHub Actions 中不保存 `NPM_TOKEN`、`NODE_AUTH_TOKEN`、publish token 或 npm credential；公共依赖不需要 read token。
8. GitHub actions used by the privileged path are pinned to full commit SHA. The npm release toolchain remains exact Node.js 24 and npm 12.0.2. / 特权路径使用的 GitHub action 固定到完整 commit SHA；npm 发布工具链继续使用精确的 Node.js 24 与 npm 12.0.2。

## Human-controlled external configuration / 人工控制的外部配置

These settings cannot be completed by a repository commit and must be performed by a package/repository administrator after `publish.yml` is present on `main`. / 以下设置不能通过仓库 commit 完成，必须在 `publish.yml` 进入 `main` 后由 package/repository 管理员执行。

1. Create the GitHub Environment `npm-release` before the workflow is ever dispatched. Restrict deployment branches to `main`, disable administrator bypass where available, and add required reviewers when a second trusted maintainer exists. Do not enable prevent-self-review when no independent reviewer exists. / 在首次 dispatch workflow 前创建 GitHub Environment `npm-release`。将 deployment branch 限制为 `main`，在可用时禁止管理员绕过；存在第二位可信维护者时添加 required reviewer。没有独立 reviewer 时不得启用 prevent-self-review。
2. On the npm package settings page, add the exact Trusted Publisher binding recorded above and allow only `npm stage publish`. npm does not validate the binding when it is saved, so spelling and case must be checked manually. / 在 npm package 设置页添加上述精确 Trusted Publisher 绑定，并且只允许 `npm stage publish`。npm 保存时不会验证绑定，因此必须人工核对拼写与大小写。
3. After the first real workflow successfully creates a staged package, set package publishing access to `Require two-factor authentication and disallow tokens`, then revoke obsolete automation tokens. / 第一次真实 workflow 成功创建 staged package 后，将 package publishing access 设置为 `Require two-factor authentication and disallow tokens`，随后撤销不再使用的 automation token。
4. For each release, inspect `npm stage view`, download the staged tarball or inspect it on npmjs.com, compare its identity and hash to the workflow evidence, and only then approve it with npm 2FA using a registered WebAuthn authenticator or hardware security key. Do not fall back to TOTP for release approval. / 每次发布都要检查 `npm stage view`，下载 staged tarball 或在 npmjs.com 检查，对照 workflow 证据核验其身份与哈希，之后才使用已注册的 WebAuthn authenticator 或硬件安全密钥完成 npm 2FA approve。发布审批不得回退到 TOTP。

## Work phases / 工作阶段

### Phase 1: Repository workflow / 仓库 workflow

- Add the manual `publish.yml` with separate `verify` and `stage` jobs. / 添加包含独立 `verify` 与 `stage` job 的手动 `publish.yml`。
- Pin every official action in both CI and release workflows to a reviewed full commit SHA, together with exact npm, registry, source identity, stable version syntax, concurrency, timeouts, and minimal permissions. / 将 CI 与发布 workflow 中的每个官方 action 固定到经过审查的完整 commit SHA，并固定精确 npm、registry、来源身份、稳定版本语法、concurrency、timeout 与最小权限。
- Add tests that reject automatic triggers, direct OIDC publication, stored npm tokens, floating official action tags, project scripts in the OIDC job, and candidate hash mismatches. / 添加测试，拒绝自动 trigger、OIDC 直接发布、保存 npm token、浮动官方 action tag、OIDC job 中的项目脚本，以及候选哈希不一致。

### Phase 2: Durable documentation / 长期文档

- Update the release model and lifecycle invariant for the staged artifact state and the tightly bounded positional-tarball exception. / 更新发布模型与 lifecycle invariant，纳入 staged artifact 状态与严格限定的位置 tarball 例外。
- Record the preferred staged path, manual fallback, human approval boundary, public verification, failure recovery, and evidence fields. / 记录首选 staged 路径、手动 fallback、人工审批边界、公共验证、失败恢复与证据字段。
- Update the trusted-publishing debt without declaring it resolved before the external binding and a real staging run succeed. / 更新 trusted-publishing 技术债；外部 binding 与真实 staging run 成功前不得宣称已解决。

### Phase 3: External activation / 外部启用

- Merge `publish.yml` to `main`. / 将 `publish.yml` 合入 `main`。
- Configure and review the GitHub Environment and npm Trusted Publisher. / 配置并审查 GitHub Environment 与 npm Trusted Publisher。
- Do not dispatch against `0.1.2`; staged versions share the registry semver uniqueness constraint, and `0.1.2` is already published. / 不得针对 `0.1.2` dispatch；staged version 与公开版本共享 registry semver 唯一性约束，而 `0.1.2` 已经发布。

### Phase 4: First live acceptance / 首次真实验收

- Use the next approved unused stable version from an exact release commit on `main`. / 使用 `main` 上精确 release commit 中下一个获批且未使用的稳定版本。
- Confirm `verify` passes without OIDC and `stage` receives OIDC only after its environment boundary. / 确认 `verify` 在没有 OIDC 的情况下通过，并且 `stage` 只在 environment 边界之后获得 OIDC。
- Review the staged package and compare the downloaded tarball hash before approving with a registered WebAuthn authenticator or hardware security key; do not use TOTP for release approval. / 使用已注册的 WebAuthn authenticator 或硬件安全密钥 approve 前，审查 staged package 并比较下载 tarball 的哈希；发布审批不得使用 TOTP。
- Run anonymous public verification after approval, then create the exact Git tag and GitHub Release. v0.1.3 completed the full Windows path; the unavailable Linux post-public run received an explicit maintainer exception backed by exact Ubuntu pre-stage gates, byte-continuous staged/public hashes, public provenance/signatures, and Windows public smoke, and was not reported as passed. / approve 后执行匿名公共验证，然后创建精确 Git tag 与 GitHub Release。v0.1.3 完成完整 Windows 路径；不可用的 Linux 发布后运行通过精确 Ubuntu staging 前 gate、连续一致的 staged/public hash、公共 provenance/signature 与 Windows public smoke 获得维护者明确例外，且未被表述为通过。

## Acceptance criteria / 验收标准

1. `publish.yml` is valid GitHub Actions YAML and is available only through manual dispatch. / `publish.yml` 是有效的 GitHub Actions YAML，且只能手动 dispatch。
2. Only the `stage` job has `id-token: write`; no npm credential secret exists. / 只有 `stage` job 具有 `id-token: write`；不存在 npm credential secret。
3. The stage job runs no `npm ci`, project npm script, Playwright command, or direct `npm publish`. / Stage job 不执行 `npm ci`、项目 npm script、Playwright 命令或直接 `npm publish`。
4. The staged tarball SHA-256 exactly matches the candidate produced after all unprivileged gates. / Staged tarball SHA-256 与全部无特权 gate 后生成的候选制品完全一致。
5. npm grants the trust relationship only `npm stage publish`; final publication requires maintainer 2FA approval. / npm 只授予 trust relationship `npm stage publish`；最终公开发布需要维护者 2FA approve。
6. Direct token publishing is disabled only after the OIDC stage path has succeeded once. / OIDC staging 路径成功一次后，才禁用直接 token publishing。
7. Runbook, completed plans, tests, and technical-debt status agree; repeated operational reads are consolidated into non-publishing scripts and a read-only Windows/Ubuntu public-verification workflow. / Runbook、completed plan、测试与技术债状态保持一致；重复操作读取已收敛到不具备发布能力的脚本与只读 Windows/Ubuntu 公共验证 workflow。

## Validation / 验证

- Parse `.github/workflows/publish.yml` with a YAML parser. / 使用 YAML parser 解析 `.github/workflows/publish.yml`。
- Run `npm test`. / 运行 `npm test`。
- Run focused package metadata tests and `git diff --check`. / 运行聚焦的 package metadata 测试与 `git diff --check`。
- Scan the workflow for secrets, token references, automatic triggers, floating action versions, and project commands in the OIDC job. / 扫描 workflow 中的 secret、token 引用、自动 trigger、浮动 action 版本与 OIDC job 中的项目命令。

## Progress log / 进度日志

- 2026-08-02: Confirmed current npm requirements from official documentation: Trusted Publishing requires npm 11.5.1+ and Node.js 22.14.0+; staged publishing requires npm 11.15.0+ and an existing registry package; GitHub Actions support requires GitHub-hosted runners and `id-token: write`; stage-only trust plus token disallow and 2FA approval is npm's maximum-security recommendation. / 2026-08-02：从 npm 官方文档确认当前要求：Trusted Publishing 需要 npm 11.5.1+ 与 Node.js 22.14.0+；staged publishing 需要 npm 11.15.0+ 且 package 已存在；GitHub Actions 支持需要 GitHub-hosted runner 与 `id-token: write`；stage-only trust、禁止 token 与 2FA approve 是 npm 推荐的最高安全配置。
- 2026-08-02: Confirmed npm 12.0.2 implements `npm stage publish` by extending the ordinary publish command. Directory staging runs `prepublishOnly`; positional tarball staging does not, so the workflow uses a separate unprivileged guarded directory dry run and permits tarball staging only after cross-job byte-identity verification. / 2026-08-02：确认 npm 12.0.2 通过继承普通 publish command 实现 `npm stage publish`。目录 staging 会运行 `prepublishOnly`；位置 tarball staging 不会，因此 workflow 在独立无特权 job 中执行受 guard 保护的目录 dry run，并且只在跨 job 字节一致性验证后允许 tarball staging。
- 2026-08-02: Added `publish.yml` with pinned `actions/checkout@v6.1.0` and `actions/setup-node@v6.5.0` commits, exact npm 12.0.2, manual stable-version input, `main` and metadata checks, serialized staging, unprivileged release/browser/audit gates, a protected `npm-release` OIDC job, and a single stage-only registry mutation. / 2026-08-02：新增 `publish.yml`，固定 `actions/checkout@v6.1.0` 与 `actions/setup-node@v6.5.0` commit，使用精确 npm 12.0.2、手动稳定版本输入、`main` 与 metadata 检查、串行 staging、无特权 release/browser/audit gate、受保护的 `npm-release` OIDC job，以及唯一一次 stage-only registry mutation。
- 2026-08-02: Repository validation passed YAML parsing, syntax checks for all 18 Ubuntu shell bodies, the focused package/workflow contract, all 327 Node tests, installed-package CLI/server smoke, and a repeated local pack proof whose two SHA-256 values were identical. External GitHub/npm settings and the first live staged version remain intentionally pending. / 2026-08-02：仓库验证通过 YAML 解析、全部 18 个 Ubuntu shell body 的语法检查、聚焦 package/workflow 契约、全部 327 项 Node 测试、安装后 CLI/server smoke，以及两次 SHA-256 完全一致的本地重复 pack 证明。外部 GitHub/npm 设置与第一次真实 staged version 仍有意保持待完成。
- 2026-08-02: Extended immutable action pinning to the existing CI workflow and made a registered WebAuthn authenticator or hardware security key mandatory for staged-release approval; TOTP is not an accepted release-approval fallback. / 2026-08-02：将不可变 action 固定扩展到现有 CI workflow，并规定 staged release approve 必须使用已注册的 WebAuthn authenticator 或硬件安全密钥；TOTP 不作为发布审批 fallback。
- 2026-08-02: PR #5 exposed that the workflow contract test assumed LF line endings and failed after a Windows checkout converted the YAML to CRLF. The test now normalizes line endings before separating the `verify` and `stage` jobs; the workflow security contract itself is unchanged. / 2026-08-02：PR #5 暴露出 workflow 契约测试假设 LF 换行；Windows checkout 将 YAML 转为 CRLF 后测试失败。测试现在会先规范化换行，再分隔 `verify` 与 `stage` job；workflow 安全契约本身未改变。
- 2026-08-02: PR #5 merged to `main` as `770d0e213b7d42a66f666a080aa38023702e5f6a` after CI run 13 passed every Node, package, browser, and aggregate `ci` job. The maintainer confirmed that the external GitHub/npm configuration matches this plan's public security contract; operational acceptance remains pending until the next real unused release version is staged. Detailed account-side evidence is retained only in the Git-ignored maintainer-local record `tmp/release-evidence/npm-trusted-publishing.md`. / 2026-08-02：PR #5 在 CI run 13 的全部 Node、package、browser 与聚合 `ci` job 通过后，以 `770d0e213b7d42a66f666a080aa38023702e5f6a` 合入 `main`。维护者确认外部 GitHub/npm 配置符合本计划公开的安全契约；运行时验收仍等待下一个真实且未使用的 release version 完成 staging。账户侧详细证据只保留在 Git 忽略的维护者本地记录 `tmp/release-evidence/npm-trusted-publishing.md` 中。
- 2026-08-03: Selected the real `session-analyzer@0.1.3` release as the first live staged acceptance. Its version-specific release plan owns source freeze, exact-main CI, artifact evidence, staged review, public verification, tag, and GitHub Release evidence; this trust-activation plan remains active until that acceptance completes. / 2026-08-03：选择真实的 `session-analyzer@0.1.3` 发布作为首次 staged 实际验收。其版本专属发布计划负责源码冻结、精确 main CI、制品证据、staged 审查、公共验证、tag 与 GitHub Release 证据；本 trust activation 计划在该验收完成前继续保持 active。
- 2026-08-03: The maintainer reconfirmed the protected `npm-release` Environment, exact stage-only Trusted Publisher binding, absence of npm publication tokens, usable WebAuthn factor, and no ambiguous existing stage. `publish.yml` run `30782433455` verified `main@7ac436205b38de058099fda8bdef0577bbfa5e31`, recorded candidate SHA-256 `43e49993cee93c27d8b869691eba7a83831c36c6f4025c0665904a61755bd514`, crossed the approved Environment boundary, reproduced the same bytes, and completed the first OIDC stage without a project dependency or script in the privileged job. / 2026-08-03：维护者重新确认受保护的 `npm-release` Environment、精确 stage-only Trusted Publisher binding、不存在 npm publication token、WebAuthn factor 可用且不存在含糊的既有 stage。`publish.yml` run `30782433455` 验证 `main@7ac436205b38de058099fda8bdef0577bbfa5e31`，记录候选 SHA-256 `43e49993cee93c27d8b869691eba7a83831c36c6f4025c0665904a61755bd514`，通过获批 Environment 边界，复现相同 bytes，并在特权 job 不执行项目依赖或脚本的情况下完成首次 OIDC stage。
- 2026-08-03: Read-only stage review confirmed trusted automation, public access, immutable `latest`, the expected 43-file manifest, and downloaded SHA-1/SHA-256 continuity. npm did not expose provenance in pre-approval staged metadata; after maintainer WebAuthn-only approval, public SLSA provenance and `npm audit signatures` verified the exact repository, workflow, main ref, source commit, run, and artifact. The temporary npm session was logged out and `ENEEDAUTH` reconfirmed. / 2026-08-03：只读 stage review 确认 trusted automation、public access、不可变 `latest`、预期 43 文件 manifest 与下载 SHA-1/SHA-256 连续性。npm 未在 approve 前 staged metadata 中暴露 provenance；维护者仅使用 WebAuthn approve 后，公共 SLSA provenance 与 `npm audit signatures` 验证精确 repository、workflow、main ref、source commit、run 与 artifact。临时 npm session 已 logout，并重新确认 `ENEEDAUTH`。
- 2026-08-03: `session-analyzer@0.1.3`, annotated `v0.1.3`, and the bilingual GitHub Release completed with `latest=0.1.3`. Complete anonymous Windows public smoke passed; the maintainer explicitly excepted the unavailable Linux post-public run with recorded substitute evidence and did not label it passed. The package Publishing access uses npm's current **Require two-factor authentication and disallow bypass 2FA tokens (recommended)** wording, no obsolete publication token existed to revoke, and the stage-only trust is operationally accepted. / 2026-08-03：`session-analyzer@0.1.3`、annotated `v0.1.3` 与双语 GitHub Release 已完成，`latest=0.1.3`。完整匿名 Windows public smoke 通过；维护者以已记录替代证据明确例外跳过不可用的 Linux 发布后运行，且未将其标记为通过。Package Publishing access 使用 npm 当前 **Require two-factor authentication and disallow bypass 2FA tokens (recommended)** 文案，不存在需要撤销的旧 publication token，stage-only trust 已完成运行验收。
- 2026-08-03: Closeout consolidated future read-only evidence collection into `release:preflight`, `release:review-stage`, and `release:verify-public`, added a no-secret Windows/Ubuntu `verify-published.yml` matrix, and documented mechanical stop/go and risk-trigger rules. This reduces repeated agent command synthesis and exact-main gate duplication without delegating any external mutation or authentication factor to automation. / 2026-08-03：收尾将未来只读证据收集收敛为 `release:preflight`、`release:review-stage` 与 `release:verify-public`，新增无 secret 的 Windows/Ubuntu `verify-published.yml` matrix，并记录机械 stop/go 与风险触发规则。这减少 agent 重复拼装命令与 exact-main gate 重复运行，同时不把任何外部 mutation 或认证因素委托给自动化。
