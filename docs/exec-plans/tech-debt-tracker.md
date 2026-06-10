# Tech Debt Tracker / 技术债跟踪器

## Open items / 未关闭条目

### 1. Protocol label quality / 协议标签质量
- Status: open / 状态：开放
- Problem: some future protocol event labels can still be generic or mechanically derived / 问题：一些未来协议事件标签仍可能很泛化，或是机械派生出来的
- Residual risk: current high-value protocol events now have focused labels and fixtures, and grouped generic tool-family lifecycle labels prefer terminal rows, but future Codex protocol payloads can still fall back to mechanically derived labels until new subtype display metadata is added. / 残余风险：当前高价值协议事件已有聚焦标签和 fixture，分组后的 generic 工具族生命周期 label 也会优先使用终态行，但未来 Codex 协议载荷仍可能回退到机械派生标签，直到为新的子类型补充展示元数据。
- Completed lifecycle-label rule: grouped Main timeline generic tool events now prefer `*_declined`, then `*_end`, then the latest update/delta row, and finally `*_begin`; Raw records remain unchanged because their one-row labels intentionally expose the original protocol subtype. / 已完成的生命周期标签规则：归并后的 Main timeline generic 工具事件现会依次优先选择 `*_declined`、`*_end`、最新 update/delta 行，最后才回退到 `*_begin`；Raw records 保持不变，因为其逐行 label 有意暴露原始协议 subtype。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 2. Historical transcript coverage / 历史转录覆盖
- Status: open / 状态：开放
- Problem: many older transcript shapes are only partially represented in fixtures / 问题：许多较旧的转录形态在 fixture 中只有部分表示
- Residual risk: fixture coverage is targeted rather than exhaustive; current incomplete tool begin/declined rows are covered, but sparse metadata, malformed JSONL, and new MCP, collaboration, hook, approval, dynamic tool, or image generation shapes may still need new fixtures as they appear. / 残余风险：fixture 覆盖是针对性的而非穷尽式的；当前不完整工具 begin/declined 行已有覆盖，但稀疏 metadata、格式异常 JSONL，以及新的 MCP、协作、hook、approval、dynamic tool 或图像生成形态出现时仍可能需要新增 fixture。
- Current observation: the local corpus contains collaboration lifecycle variants but no dynamic tool, approval, hook, or image-generation protocol rows. Synthetic lifecycle coverage now protects grouped labels and status for these families, while field-specific presentation intentionally remains bounded until real payloads are available. / 当前观察：本地语料包含协作生命周期 variant，但没有 dynamic tool、approval、hook 或图像生成协议行。Synthetic 生命周期覆盖现已保护这些事件族的分组 label 和 status，而字段级呈现仍有意保持受限，直到出现真实 payload。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 3. Session title inference / 会话标题推断
- Status: open / 状态：开放
- Problem: fallback titles can still be noisy when indexed or configured thread naming is missing / 问题：缺少索引或 configured thread naming 时，回退标题仍可能有噪声
- Residual risk: `session_configured.thread_name` now improves current transcripts, but sessions without indexed/configured thread names and without a clean main-layer user task line can still fall back to generic or noisy text. / 残余风险：`session_configured.thread_name` 已改进当前转录，但没有索引/configured 线程名且缺少干净 main 层用户任务文本的 session 仍可能回退到泛化或带噪声的文本。
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 4. Optional persistent index / 可选持久索引
- Status: deferred / 状态：已推迟
- Problem: startup cost may grow once the local transcript corpus becomes much larger / 问题：一旦本地转录语料变得大得多，启动成本可能增长
- Residual risk: startup remains in-memory, though repository selection now skips transcript files known to belong to other repositories and reports progress while indexing. Larger transcript corpora may still need a local cache with invalidation, versioning, and migration rules. / 残余风险：启动仍基于内存，不过仓库选择现在会跳过已知属于其他仓库的转录文件，并在索引时报告进度。更大的转录语料仍可能需要带失效、版本和迁移规则的本地缓存。
- Add browser-level regression coverage for project chooser two-phase loading: stale `/api/projects` full-scan responses must not overwrite a user selection or trigger old auto-restore after summary rows are rendered. / 为项目选择器两阶段加载添加浏览器级回归覆盖：过期的 `/api/projects` 完整扫描响应不得覆盖用户选择，也不得在 summary 行渲染后触发旧的自动恢复。
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/design-docs/logical-event-timeline.md`

### 5. Review finding real-data validation / Review finding 真实数据验证
- Status: open / 状态：开放
- Problem: review lifecycle parsing is covered by official core protocol schema and artificial fixtures, but local real-world transcripts observed so far only include empty `review_output.findings` arrays. / 问题：review 生命周期解析已有官方 core protocol schema 和人工 fixture 覆盖，但目前观察到的本地真实转录只包含空的 `review_output.findings` 数组。
- Residual risk: rendering of non-empty `review_output.findings[]` may need adjustment once a real transcript with findings is available, especially for field presence, priority/confidence formatting, and code location shapes. / 残余风险：一旦拿到包含 findings 的真实转录，非空 `review_output.findings[]` 的渲染可能仍需调整，尤其是字段存在性、priority/confidence 格式和代码位置形态。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/product-specs/session-transcript-analyzer.md`

### 6. Browser automation coverage series / 浏览器自动化覆盖系列
- Status: open / 状态：开放
- Problem: several high-value viewer behaviors are only partially covered by Node unit tests and manual browser spot checks; they are best validated by a full browser automation framework that can exercise DOM state, scrolling, localStorage, and event inspector interactions together. / 问题：若干高价值 viewer 行为目前只被 Node 单元测试和手动浏览器抽查部分覆盖；这些行为最好通过完整浏览器自动化测试框架验证，因为它们需要一起检查 DOM 状态、滚动、localStorage 和事件检查器交互。
- Residual risk: pure-function tests now cover search structural-key decisions and search-hit navigation category matching, but regressions can still appear in the composed browser flow, especially after rendering, async timeline refresh, preload, or detail-panel changes. / 残余风险：纯函数测试现在已覆盖搜索结构化 key 判定和搜索命中导航类别匹配，但组合后的浏览器流程仍可能回归，尤其是在渲染、异步时间线刷新、预加载或详情面板变更之后。
- Candidate browser tests: / 候选浏览器测试：
  - Free-text find keeps the currently loaded timeline range when the user has loaded additional pages. / 用户已加载更多时间线页后，自由文本查找应保留当前已加载范围。
  - Clearing the `Find:` chip removes highlights and match navigation without reloading the selected session back to the first page. / 清除 `Find:` chip 应移除高亮和命中导航，但不把当前 session 重新加载回第一页。
  - `Search hits` appears in selected-event quick navigation only when free-text search is active and the selected event is a hit, then Prev/Next moves between hit events. / `Search hits` 只应在自由文本搜索生效且选中事件命中时出现在选中事件快速跳转中，并且 Prev/Next 会在命中事件之间移动。
  - Inspector search navigation reacquires the live active mark after detail-panel redraw, opens closed raw JSON `<details>` ancestors only when navigating to that target, and scrolls the concrete mark into the right-side viewport. / Inspector 搜索导航应在详情面板重绘后重新获取实际存在的 active mark，只在导航到该目标时展开关闭的 raw JSON `<details>` 祖先，并将具体 mark 滚动到右侧视口内。
  - `Read from here` clears structured filters, switches to Main timeline, preserves free-text find text, and restores the focused event position. / `Read from here` 应清除结构化筛选、切回 Main timeline、保留自由文本查找文本，并恢复焦点事件位置。
  - Folding profile edits preview immediately, survive Save through browser-local storage, and Cancel restores the saved profile without leaking protocol/raw-layer rules. / 折叠策略编辑应即时预览，Save 后通过浏览器本地存储保留，Cancel 会恢复已保存策略，并且不会泄漏 protocol/raw layer 规则。
  - A removed or renamed built-in folding profile stored in `localStorage` falls back to `narrative`, persists the repaired selection, and does not leave the profile picker in an invalid state. / 当 `localStorage` 中保存的内置折叠策略已被移除或重命名时，应用应回退到 `narrative`、持久化修复后的选择，并且不让策略选择器停留在无效状态。
  - The folding profile info control remains a single movable slot that follows the currently visible profile picker between the detail pane and topbar, disappears on layers where folding profiles do not apply, and keeps its comparison popover within the visible detail pane or viewport. / 折叠策略信息控件应保持为单个可移动 slot，在 detail pane 与 topbar 之间跟随当前可见的策略选择器，在不适用折叠策略的 layer 上消失，并让对比 popover 保持在可见 detail pane 或 viewport 内。
  - The nonzero Issues metric reflects broad Main-timeline issue counts and toggles the error-focus profile without adding search filters or losing the selected session. / 非零 Issues 指标应反映广义 Main timeline 问题计数，并切换到错误聚焦策略，同时不添加搜索筛选或丢失当前选中 session。
  - Expanded-event bottom collapse control coverage: mouse and keyboard activation, natural `summary` versus `collapsed` fallback, non-flow layout without added body whitespace, focused-control geometry, short-message events, code/terminal events, and narrow viewport placement. / 展开事件底部收起控件覆盖：鼠标和键盘触发、自然 `summary` 与 `collapsed` 回退、不会增加正文空白的非文档流布局、聚焦控件几何位置、短消息事件、代码/terminal 事件，以及窄视口位置。
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md`

### 7. Generic large-section deferred loading / 通用大型 section 延迟加载
- Status: deferred / 状态：已推迟
- Problem: supported raster image payloads are now externalized before long-lived indexing and loaded through controlled preview URLs, but non-image large fields still use the regular retained model and detail-response path. / 问题：受支持的 raster 图片 payload 现在会在长期索引前外置，并通过受控预览 URL 加载，但非图片大型字段仍使用常规的常驻模型和 detail 响应路径。
- Current measurement: after image externalization, the 2026-05-31 development corpus retained no supported inline image data URLs, built its repository-scoped index in approximately `8.2 s`, retained approximately `304 MB` of serialized session-model proxy data, and produced approximately `74.3 MB` when all logical details were serialized. A separate pre-change classification found `30` non-image logical details above `64 KiB`: `27` shell-command events and `3` patch events. / 当前测量：完成图片外置后，2026-05-31 开发语料中不再保留受支持的内联图片 data URL；仓库范围索引构建约耗时 `8.2 s`，序列化 session-model 代理数据约为 `304 MB`，序列化全部 logical detail 时约为 `74.3 MB`。独立的变更前分类发现 `30` 个超过 `64 KiB` 的非图片 logical detail：其中 `27` 个 shell-command event，`3` 个 patch event。
- Residual risk: ordinary text output, diffs, and compacted or protocol payloads can still dominate memory or detail-response size as the corpus grows. A future generic mechanism should start with measured section-level truncation, paging, or load-on-demand semantics rather than moving every event behind a deferred loader. / 残余风险：随着语料增长，普通文本输出、diff 以及 compacted 或协议 payload 仍可能主导内存或 detail 响应体积。未来的通用机制应从经过测量支持的 section 级截断、分页或按需加载语义开始，而不是把所有 event 都放到 deferred loader 后面。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/completed/2026-05-31-lazy-image-preview-payload-externalization.md`

### 8. Core module responsibility concentration / 核心模块职责集中
- Status: open / 状态：开放
- Problem: several core files now own multiple independent change axes. `src/codex.js` combines project discovery, raw parsing, protocol interpretation, logical-event construction, detail extraction, search, image handling, and index assembly; `public/app.js` combines project selection, timeline loading, search highlighting, detail navigation, folding-profile editing, caches, and DOM event wiring; `server.js` combines project-job state, API route dispatch, parameter handling, and static serving. / 问题：若干核心文件已经承担多个彼此独立的变化轴。`src/codex.js` 同时负责项目发现、原始解析、协议解释、逻辑事件构建、详情提取、搜索、图片处理和索引组装；`public/app.js` 同时负责项目选择、时间线加载、搜索高亮、详情导航、折叠策略编辑、缓存和 DOM 事件绑定；`server.js` 同时负责项目 job 状态、API 路由分发、参数处理和静态文件服务。
- Current observation: after the 2026-06-04 folding-profile and issue-visibility change, `src/codex.js` is approximately `4,549` lines, `public/app.js` approximately `3,019` lines, `server.js` approximately `559` lines, and the coupled `test/codex.test.js` approximately `2,269` lines. High-change functions such as `makeRawEvent`, `buildToolLogicalEvent`, `buildLogicalEvents`, `buildIndex`, and `createServer` remain concentrated in those files. / 当前观察：在 2026-06-04 的折叠策略与问题可见性变更后，`src/codex.js` 约为 `4,549` 行，`public/app.js` 约为 `3,019` 行，`server.js` 约为 `559` 行，与其耦合的 `test/codex.test.js` 约为 `2,269` 行。`makeRawEvent`、`buildToolLogicalEvent`、`buildLogicalEvents`、`buildIndex` 和 `createServer` 等高频变化函数仍集中在这些文件中。
- Stage 2 first increment: Codex source constants, typed locator/raw ref helpers, raw matching helpers, and raw event parsing have moved to `src/codex-source.js` with focused `test/codex-source.test.js` coverage. Logical construction, detail extraction, index/search assembly, frontend state, and route/job handling remain intentionally open for later incremental boundaries. / 阶段 2 第一增量：Codex source 常量、typed locator/raw ref helper、raw matching helper 和 raw event 解析已移动到 `src/codex-source.js`，并由聚焦的 `test/codex-source.test.js` 覆盖。逻辑事件构建、详情提取、索引/搜索组装、前端状态以及 route/job 处理仍有意保留给后续渐进边界。
- Residual risk: small feature changes can cross parsing, DTO, UI-state, route, and test concerns in one patch; review scope, merge-conflict probability, and test placement ambiguity will increase as transcript and viewer behavior continue to evolve. / 残余风险：小型功能变更也可能在同一补丁中跨越解析、DTO、UI 状态、路由和测试关注点；随着转录和查看器行为继续演进，审查范围、合并冲突概率和测试放置歧义都会增加。
- Preferred direction: extract incrementally behind the current public APIs instead of performing a broad rewrite. Stable candidate boundaries include indexing, raw-event parsing, logical-event construction, detail-section extraction, frontend project selection, timeline find, detail-stack navigation, folding-profile editing, route handlers, and project-job management. Split tests along the same responsibility boundaries as code moves. / 建议方向：在保持当前公开 API 的前提下渐进提取，而不是进行大范围重写。较稳定的候选边界包括索引、原始事件解析、逻辑事件构建、详情 section 提取、前端项目选择、时间线查找、详情栈导航、折叠策略编辑、路由 handler 和项目 job 管理。代码移动时，测试也应按相同职责边界拆分。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/documentation-system.md`

### 9. Shared browser-and-Node module ownership boundary / 浏览器与 Node 共享模块归属边界
- Status: deferred / 状态：已推迟
- Problem: `public/folding.js` is intentionally both a browser static asset and a Node runtime dependency through `src/folding.js`, so the `public/` tree is no longer only a delivery surface. Browser correctness also depends on manual script ordering in `public/index.html`. / 问题：`public/folding.js` 被有意同时用作浏览器静态资源，并通过 `src/folding.js` 成为 Node 运行时依赖，因此 `public/` 目录不再只是交付表面。浏览器正确性还依赖 `public/index.html` 中的手动脚本顺序。
- Residual risk: if more domain logic follows this pattern, source ownership, dependency direction, UMD wrapper maintenance, and future build or module migration work will become less clear. / 残余风险：如果更多领域逻辑沿用这一模式，源码归属、依赖方向、UMD 包装维护，以及未来构建或模块迁移工作都会变得更不清晰。
- Trigger for action: decide a canonical shared-source location and browser publication strategy before adding another substantial browser-and-Node shared domain module or introducing a frontend build step. Avoid moving the existing small module only for cosmetic directory purity. / 行动触发条件：在新增另一个重要的浏览器与 Node 共享领域模块，或引入前端构建步骤之前，确定规范的共享源码位置和浏览器发布策略。不要仅为了目录表面纯净而移动现有的小模块。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/completed/2026-05-31-folding-rule-priority-governance.md`
