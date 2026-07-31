# Search HUD Integration / 搜索 HUD 整合

## Goal / 目标

Integrate the selected Concept A single-line search HUD and parameter popover into the existing viewer without changing HTTP, search-index, matching, navigation, or project-drill-down contracts. Replace typed search operators with GUI-only structured filters while keeping the input authoritative for free text. / 将选定的 Concept A 单行搜索 HUD 与参数弹层整合进现有查看器，同时不改变 HTTP、搜索索引、匹配、导航或项目下钻契约。取消手输搜索操作符，改用纯 GUI 结构化筛选，并让输入框只权威保存自由文本。

## Implementation / 实现

- Replace `src/browser/search-query.js` with a focused pure `search-controls.js` boundary for structural keys, ordered filter metadata/summaries, and scope-aware metrics. / 用聚焦的纯 `search-controls.js` 边界替换 `src/browser/search-query.js`，负责结构 key、有序筛选元数据/摘要和范围感知计数模型。
- Rebuild the top search surface as a single-line HUD showing scope, global layer, active-filter count, free-text input, compact scope metrics, and session navigation. Rebuild the assist as a non-modal parameter popover with scope switching, a shortcut to the existing global Layer selector, editable filter rows, suggestions, full metrics, and one authoritative Clear all. / 将顶部搜索表面重建为单行 HUD，显示范围、全局 Layer、生效筛选数、自由文本输入、紧凑范围计数和 session 导航。将辅助区重建为非模态参数弹层，包含范围切换、指向现有全局 Layer 选择器的快捷入口、可编辑筛选行、候选、完整计数和唯一权威的全部清除入口。
- Keep current search requests, phrase highlighting, target materialization, navigation serialization, project result cards, `Read from here`, and return-to-results behavior. Treat operator-like input literally. / 保留现有搜索请求、短语高亮、目标物化、导航串行化、项目结果卡、`Read from here` 和返回结果行为。类似操作符的输入一律按普通文本处理。
- Update responsive styling, English and Simplified Chinese UI text, product/design docs, README files, changelog, and technical-debt tracking. Regenerate checked-in browser assets from source. / 更新响应式样式、英文与简体中文 UI 文案、产品/设计文档、README、变更日志和技术债跟踪。从源码重新生成已提交的浏览器资产。

## Validation / 验证

- Focused unit coverage for the pure search-controls boundary. / 为纯 search-controls 边界提供聚焦单元测试。
- Browser coverage for scope/popover behavior, filter CRUD and suggestions, literal operator-like text, count ownership, Layer shortcut, project drill-down/return, `Read from here`, search navigation, localization, and desktop/narrow geometry. / 浏览器覆盖范围/弹层行为、筛选增删改与候选、类似操作符的普通文本语义、计数归属、Layer 快捷入口、项目下钻/返回、`Read from here`、搜索导航、本地化，以及桌面/窄屏几何。
- Run `npm run build`, `npm run build:check`, `npm test`, `npm run test:browser`, `npm run test:package`, and `git diff --check`; restart the documented local server for final visual verification. / 运行上述完整构建与测试命令，并重启文档规定的本地服务器完成最终视觉验收。

## Outcome / 结果

Completed on 2026-07-06 after code, generated assets, bilingual documentation, unit/browser checks, and manual browser verification at 1365×900, 900×900, and 390×820. Package smoke passed before the review follow-up; after that follow-up, the final `npm pack --json --dry-run` passed, while a repeated package-smoke run could not complete because the registry stalled. The existing user-owned `.gitignore` change was preserved, and no `tmp/` prototypes, screenshots, or real transcript data were added. / 已于 2026-07-06 完成代码、生成资产、双语文档、单元/浏览器检查，并在 1365×900、900×900 和 390×820 下完成人工浏览器验收。Package smoke 在 review 后续修改前曾通过；后续修改完成后，最终 `npm pack --json --dry-run` 通过，但再次运行 package smoke 时因 registry 卡住而未能完成。保留了用户已有的 `.gitignore` 修改，未添加 `tmp/` 原型、截图或真实转录数据。

Review follow-up aligned the visual treatment with the existing green design tokens, added an explicit stale-result-free project-search pending transition, normalized Clear all copy and internal search-control naming, and reconciled the current product/design/README contracts. / Review 后续将视觉处理对齐到现有绿色设计 token，新增不会暴露旧结果的项目搜索 pending 转换，统一了“全部清除”文案与内部搜索控件命名，并校准了当前产品、设计和 README 契约。
