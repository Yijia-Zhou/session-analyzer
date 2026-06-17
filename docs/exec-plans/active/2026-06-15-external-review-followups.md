# External Review Follow-ups / 外部评审后续

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: active / 状态：进行中
- Created: 2026-06-15 / 创建日期：2026-06-15
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design docs: / 相关设计文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/external-source-mapping-pressure-tests.md`
- Related debt tracker: / 相关技术债：
  - `docs/exec-plans/tech-debt-tracker.md`

## Summary / 摘要

This plan records the accepted findings from an external pre-merge review and turns them into a concrete follow-up sequence. The review found real gaps in locale consistency, Simplified Chinese catalog completeness, cross-platform golden expectations, package artifact hardening, and smoke coverage. Several claims were corrected during triage and should not be implemented as originally stated.

本计划记录外部合并前评审中已采纳的结论，并将其转化为具体后续执行顺序。评审发现 locale 一致性、简体中文 catalog 完整度、跨平台 golden 期望、package artifact 加固和 smoke 覆盖存在真实缺口。若干外部说法已在评估中被修正，不应按原始表述实现。

## Accepted fixes / 已采纳修复项

- Complete zh-CN display coverage for `kind`, `protocol`, `status`, `section`, `navigation`, `renderer`, remaining high-value `ui` strings, and folding condition names while preserving stable API/filter/storage identifiers. / 补全 `kind`、`protocol`、`status`、`section`、`navigation`、`renderer`、剩余高价值 `ui` 文案和 folding condition 名称的 zh-CN 展示文本，同时保持稳定 API/filter/storage 标识不变。
- Make raw-record display labels honor the selected locale wherever raw DTOs are returned, including raw timeline events and raw detail titles. / 让 raw-record 展示 label 在返回 raw DTO 的位置都遵循所选 locale，包括 raw timeline event 和 raw detail title。
- Propagate the browser-selected locale through project-selection POST and state-returning project job responses, not only through GET query parameters. / 将浏览器选择的 locale 传递到 project-selection POST 和会返回 state 的 project job 响应中，而不只依赖 GET query 参数。
- Make golden replay source-locator file expectations platform-stable; avoid direct Windows separator assumptions in DTO expectations. / 让 golden replay 的 source-locator file 期望保持跨平台稳定，避免在 DTO 期望中直接假设 Windows 分隔符。
- Minify `public/assets/app.js` for release packaging, but do not commit or package large source maps unless a source-map policy explicitly excludes them from the npm artifact. / 为发布打包压缩 `public/assets/app.js`，但除非明确 source-map 策略会将大体积 sourcemap 排除出 npm artifact，否则不要提交或打包大型 sourcemap。
- Strengthen package smoke verification beyond root HTTP liveness by checking valid `/api/state` JSON and that the HTML references the generated browser bundle. / 将 package smoke 验证从根路径 HTTP 存活扩展到有效 `/api/state` JSON，以及 HTML 是否引用生成后的浏览器 bundle。
- Add focused coverage for `scripts/build-client.js` behavior or equivalent checks for minification, stale-asset detection, and source-map/package policy. / 为 `scripts/build-client.js` 行为添加聚焦覆盖，或添加等价检查以覆盖压缩、生成资产过期检测和 source-map/package 策略。

## Corrected findings / 已修正评估结论

- `navigation.js` has English fallback labels, but the UI already looks up `i18n.navigation` before falling back; the actionable issue is the zh-CN navigation catalog remaining English. / `navigation.js` 有英文 fallback label，但 UI 已先查 `i18n.navigation` 再回退；可执行问题是 zh-CN navigation catalog 仍为英文。
- `codex-detail.js` has a large flat DI surface, but direct imports would violate the current pure boundary guardrails. Prefer grouped DI unless the boundary tests and architecture decision are intentionally changed. / `codex-detail.js` 的扁平 DI 表面较大，但直接 import 会违反当前纯边界护栏。除非有意修改边界测试和架构决策，否则优先采用分组 DI。
- `require('session-analyzer')` does not start the server because `server.js` is guarded by `require.main === module`; adding `exports` may clarify package surface area but is not a side-effect fix. / `require('session-analyzer')` 不会启动 server，因为 `server.js` 受 `require.main === module` 保护；添加 `exports` 可澄清 package 表面，但不是副作用修复。
- `canonicalEventType` is used internally by the raw parser. Do not remove it as an unused export without separately deciding whether the export surface should shrink. / `canonicalEventType` 被 raw parser 内部使用。不要把它当作未使用代码移除；是否收窄导出表面应单独决定。
- The CHANGELOG date mismatch was not proven: the release date can remain separate from later follow-up commits unless release notes are otherwise updated. / CHANGELOG 日期不一致未被证明：release 日期可以独立于后续提交，除非发布说明本身需要更新。

## Stage 2 audit / 阶段 2 核查

The completed v0.1 plan promised incremental responsibility boundaries, not a complete rewrite of index, search, frontend state, or server routes. Current code has moved Codex source/raw parsing to `src/codex-source.js`, logical event construction to `src/codex-logical.js`, and detail DTO plus section orchestration to `src/codex-detail.js`, with focused tests and boundary guardrails. Index/search assembly, frontend state, and route/job handling remain intentional future debt.

已完成的 v0.1 计划承诺的是渐进职责边界，而不是完整重写 index、search、frontend state 或 server routes。当前代码已将 Codex source/raw parsing 移至 `src/codex-source.js`，将 logical event construction 移至 `src/codex-logical.js`，将 detail DTO 和 section 编排移至 `src/codex-detail.js`，并配有聚焦测试和边界护栏。Index/search assembly、frontend state 和 route/job handling 仍是有意保留的后续技术债。

## WIP branch extraction strategy / WIP 分支拆取策略

Do not merge `origin/fix/v0.1-review-followups-wip` wholesale and do not trust its documentation status as completion evidence. The branch is useful as an implementation-material source only. Recreate or selectively port behavior by milestone from the clean `v0.1-release-hardening` baseline, and update this plan only after code, tests, generated artifacts, and documentation agree.

不要整支合并 `origin/fix/v0.1-review-followups-wip`，也不要把它的文档状态当作完成证据。该分支只可作为实现素材来源。从干净的 `v0.1-release-hardening` 基线按里程碑重做或选择性移植行为；只有当代码、测试、生成产物和文档四者一致后，才更新本计划状态。

## Milestones / 里程碑

### 1. Locale correctness / Locale 正确性

- Status: complete. Do not reopen locale propagation or zh-CN catalog work while extracting WIP material. / 状态：已完成。拆取 WIP 素材时不要重新打开 locale 传递或 zh-CN catalog 工作。
- Available resources: existing allowlist-based catalog coverage, locale-aware raw-record display labels, project job locale propagation, browser POST locale forwarding, rebuilt browser assets, and related product/design/debt docs. / 可用资源：现有基于 allowlist 的 catalog 覆盖、locale-aware raw-record 展示 label、project job locale 传递、browser POST locale 转发、已重建浏览器资产，以及相关 product/design/debt 文档。
- Guardrail: future cleanup may humanize English fallback labels, but canonical DTO fields, filter keys, storage keys, raw refs, and other machine identifiers must remain stable. / 护栏：后续清理可以 humanize 英文 fallback label，但 canonical DTO 字段、filter key、storage key、raw refs 和其他机器标识必须保持稳定。

### 2. Cross-platform golden stability and locator naming docs / 跨平台 golden 稳定性和 locator 命名文档

- Status: pending. / 状态：待完成。
- Available resources: WIP branch findings identify the target area, but its claimed fix is not trusted. / 可用资源：WIP 分支的发现可用于定位目标区域，但其声称的修复不可信。
- Implementation resources: normalize only project-generated Codex JSONL locator paths to forward slashes at the locator-generation boundary; do not rewrite original transcript text. / 实施资源：只在 locator 生成边界将项目生成的 Codex JSONL locator path 归一化为前斜杠；不要改写原始 transcript 文本。
- Test resources: add a Windows-style path test using `path.win32.relative(...)` or an equivalent helper, update golden expectations to forward slashes, and add a negative assertion that raw transcript path strings remain unchanged. / 测试资源：添加使用 `path.win32.relative(...)` 或等价 helper 的 Windows-style path 测试，将 golden 期望更新为 forward slash，并增加 raw transcript path 字符串保持原文的负向断言。
- File boundary: locator-generation code in `src/codex.js` or a focused helper, `test/golden-replay.test.js`, targeted path tests, and locator naming docs. / 文件边界：`src/codex.js` 中的 locator 生成代码或聚焦 helper、`test/golden-replay.test.js`、定向 path tests 和 locator 命名文档。
- Completion gate: `npm test` passes, generated locator paths are platform-stable, and original source text paths are unchanged. / 完成门槛：`npm test` 通过，生成 locator path 跨平台稳定，且原始 source text path 保持不变。

### 3. Package artifact and smoke hardening / Package artifact 与 smoke 加固

- Status: pending. / 状态：待完成。
- Available resources: WIP branch material for `scripts/build-client.js` minification, rebuilt `public/assets/app.js`, default-English `public/index.html`, `.gitattributes`, and build-boundary checks may be reused after review; WIP claims about `package-smoke.js` and pack manifest `.map` rejection are not trusted because the branch did not implement them. / 可用资源：WIP 分支中关于 `scripts/build-client.js` 压缩、重建 `public/assets/app.js`、默认英文 `public/index.html`、`.gitattributes` 和 build-boundary 检查的素材可在复审后复用；WIP 关于 `package-smoke.js` 和 pack manifest `.map` 拒绝的声明不可信，因为该分支没有实现。
- Bundle/static shell resources: make the static HTML shell default to English, verify catalog-owned shell/navigation/button/empty-state labels after switching to zh-CN, enable `public/assets/app.js` minification, rebuild the checked-in bundle, and keep generated source maps out of `public/` and the npm artifact. / Bundle/static shell 资源：将静态 HTML shell 默认改为英文，验证切换到 zh-CN 后由 catalog 接管的 shell/navigation/button/empty-state label 已本地化，启用 `public/assets/app.js` 压缩，重建已提交 bundle，并确保 generated source map 不进入 `public/` 或 npm artifact。
- Package smoke resources: preserve the existing consumer-path smoke flow (`npm pack --json`, install tarball into a temporary project, run the installed package), then add minimal `/api/state` JSON checks and `/` HTML bundle-reference checks without freezing extra internal API fields. / Package smoke 资源：保留现有 consumer-path smoke 流程（`npm pack --json`、将 tarball 安装到临时项目、运行安装后的 package），再添加最小 `/api/state` JSON 检查和 `/` HTML bundle-reference 检查，不固化额外内部 API 字段。
- Test resources: reject any `.map` file in the packed manifest; minification checks should use broad signals, not exact byte counts. / 测试资源：拒绝 packed manifest 中的任何 `.map` 文件；压缩检查应使用宽松信号，而不是精确 byte 数。
- File boundary: `public/index.html`, `scripts/build-client.js`, `public/assets/app.js`, `.gitattributes`, `scripts/package-smoke.js`, `test/package.test.js`, browser tests, build-boundary tests, and `package.json` only if needed. / 文件边界：`public/index.html`、`scripts/build-client.js`、`public/assets/app.js`、`.gitattributes`、`scripts/package-smoke.js`、`test/package.test.js`、browser tests、build-boundary tests，仅在必要时包含 `package.json`。
- Completion gate: `npm run build`, `npm run build:check`, `npm test`, `npm run test:browser`, `npm run test:package`, and `node --test test/package.test.js` pass. / 完成门槛：`npm run build`、`npm run build:check`、`npm test`、`npm run test:browser`、`npm run test:package` 和 `node --test test/package.test.js` 通过。

### 4. Low-risk cleanup / 低风险清理

- Status: pending. / 状态：待完成。
- Available resources: WIP branch material for shared `i18n.humanize`, English fallback-label consolidation, and raw-record label expectation updates may be reused after review. Do not reuse unrelated partial server method hardening or "all resolved" documentation edits. / 可用资源：WIP 分支中关于共享 `i18n.humanize`、英文 fallback-label 合并和 raw-record label 期望更新的素材可在复审后复用。不要复用无关的 partial server method hardening 或“全部 resolved”文档改动。
- Implementation resources: consolidate fallback label registries only where tests show no behavior loss, and do small raw-locator dedupe only if it stays clearer and preserves raw traceability. / 实施资源：仅在测试证明无行为损失时合并 fallback label 注册表；只有在保持代码更清晰且保留 raw traceability 时，才做小型 raw-locator 去重。
- File boundary: `src/shared/i18n.js`, `src/codex.js`, relevant tests, and docs only if behavior is actually completed. / 文件边界：`src/shared/i18n.js`、`src/codex.js`、相关 tests，以及仅在行为实际完成时更新 docs。
- Completion gate: `npm test` passes and no public machine identifiers change. / 完成门槛：`npm test` 通过，且 public machine identifiers 不变。

### 5. `codex-detail` DI grouping / `codex-detail` DI 分组

- Status: pending. / 状态：待完成。
- Available resources: WIP branch DI grouping shape may be reused after review, but documentation must not claim that still-used injections, such as `codexSourceLocator`, were removed. / 可用资源：WIP 分支中的 DI 分组形状可在复审后复用，但文档不得声称仍在使用的注入项（如 `codexSourceLocator`）已删除。
- Implementation resources: group dependencies into five traceable semantic groups only if the pure boundary remains intact; group names should follow stable responsibilities rather than visual neatness. / 实施资源：仅在保留 pure boundary 的前提下，将依赖分成五个可追溯语义组；分组名称应遵循稳定职责，而不是视觉整齐。
- Test resources: boundary tests must continue to show that `src/codex-detail.js` does not directly import dependencies that should be injected. / 测试资源：boundary tests 必须继续证明 `src/codex-detail.js` 不会直接 import 本应注入的依赖。
- File boundary: `src/codex.js`, `src/codex-detail.js`, `test/build-boundary.test.js`, and related detail tests. / 文件边界：`src/codex.js`、`src/codex-detail.js`、`test/build-boundary.test.js` 和相关 detail tests。
- Completion gate: `npm test` passes, five semantic groups are implemented, their responsibility is traceable in code or docs, and pure-boundary tests still pass. / 完成门槛：`npm test` 通过，五个语义组已实现，其职责可从代码或文档追溯，且 pure-boundary tests 仍通过。

## Validation / 验证

- `npm test`
- `npm run test:browser`
- `npm run build:check`
- `npm run test:package`
- Targeted cross-platform path tests should not assert OS-specific separators unless the source data itself intentionally contains them. / 定向跨平台路径测试不应断言 OS 特定分隔符，除非源数据本身有意包含这些分隔符。

## Progress log / 进度记录

- 2026-06-15: Created this follow-up plan from the external review triage and documented corrected conclusions, Stage 2 audit results, and validation expectations. / 2026-06-15：根据外部评审评估创建本后续计划，并记录修正后的结论、阶段 2 核查结果和验证预期。
- 2026-06-15: Completed the locale correctness milestone with allowlist-based zh-CN catalog coverage, locale-aware raw-record display labels, project job locale propagation, browser POST locale forwarding, rebuilt browser assets, and updated product/design/debt docs. / 2026-06-15：完成 locale 正确性里程碑，加入基于 allowlist 的 zh-CN catalog 覆盖、locale-aware raw-record 展示 label、project job locale 传递、浏览器 POST locale 转发，重建浏览器资产，并更新产品、设计和技术债文档。
- 2026-06-17: Reviewed `origin/fix/v0.1-review-followups-wip` and recorded a quality-first extraction strategy. The WIP branch contains useful implementation material, but its completion claims are not trusted; remaining work must be rebuilt by theme from the clean baseline and validated before milestones are checked off. / 2026-06-17：审阅 `origin/fix/v0.1-review-followups-wip` 并记录质量优先的拆取策略。该 WIP 分支包含有用实现素材，但其完成声明不可信；剩余工作必须从干净基线按主题重做并验证后，才能勾选里程碑。
