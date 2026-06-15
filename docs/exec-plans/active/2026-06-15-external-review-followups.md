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

## Milestones / 里程碑

- [ ] Fix locale correctness: zh-CN catalogs, raw labels, POST/project-job locale propagation, and locale tests. / 修复 locale 正确性：zh-CN catalog、raw label、POST/project-job locale 传递和 locale 测试。
- [ ] Fix cross-platform golden stability and locator naming docs. / 修复跨平台 golden 稳定性和 locator 命名文档。
- [ ] Harden package artifacts and smoke coverage: minified app bundle, source-map policy, stronger package smoke, and build script coverage. / 加固 package artifact 和 smoke 覆盖：压缩 app bundle、source-map 策略、更强 package smoke 和 build script 覆盖。
- [ ] Tackle low-risk cleanup: remove unused local variables, avoid duplicate raw locator work if it keeps the code clearer, and consolidate fallback label registries where tests show no behavior loss. / 处理低风险清理：移除未使用局部变量，在保持代码清晰时避免重复 raw locator 计算，并在测试证明无行为损失时合并 fallback label 注册表。
- [ ] Revisit `codex-detail` DI grouping only as a scoped refactor that preserves the pure boundary or intentionally updates that boundary. / 仅以保留纯边界或有意更新边界为前提，作为受限重构重新审视 `codex-detail` DI 分组。

## Validation / 验证

- `npm test`
- `npm run test:browser`
- `npm run build:check`
- `npm run test:package`
- Targeted cross-platform path tests should not assert OS-specific separators unless the source data itself intentionally contains them. / 定向跨平台路径测试不应断言 OS 特定分隔符，除非源数据本身有意包含这些分隔符。

## Progress log / 进度记录

- 2026-06-15: Created this follow-up plan from the external review triage and documented corrected conclusions, Stage 2 audit results, and validation expectations. / 2026-06-15：根据外部评审评估创建本后续计划，并记录修正后的结论、阶段 2 核查结果和验证预期。
