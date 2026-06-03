# Tech Debt Tracker / 技术债跟踪器

## Open items / 未关闭条目

### 1. Protocol label quality / 协议标签质量
- Status: open / 状态：开放
- Problem: some future protocol event labels can still be generic or mechanically derived / 问题：一些未来协议事件标签仍可能很泛化，或是机械派生出来的
- Residual risk: current high-value protocol events now have focused labels and fixtures, but future Codex protocol payloads can still fall back to mechanically derived labels until new subtype display metadata is added. / 残余风险：当前高价值协议事件已有聚焦标签和 fixture，但未来 Codex 协议载荷仍可能回退到机械派生标签，直到为新的子类型补充展示元数据。
- Deferred lifecycle-label rule: grouped Main timeline tool events currently derive their label from the first protocol `event_msg`. For unobserved families such as dynamic tool, approval, hook, and image generation, a grouped `*_begin` + `*_end` operation may therefore keep a `Begin` label after completion. Once real payloads appear, prefer `*_declined`, then `*_end`, then the latest update row, and finally `*_begin`; keep Raw records unchanged because their one-row labels intentionally expose the original protocol subtype. / 已推迟的生命周期标签规则：归并后的 Main timeline 工具事件目前从第一条协议 `event_msg` 派生 label。对于尚未观察到的 dynamic tool、approval、hook 和图像生成类型，一个已归并的 `*_begin` + `*_end` 操作可能因此在完成后仍保留 `Begin` 标签。真实 payload 出现后，应依次优先使用 `*_declined`、`*_end`、最后一条 update 行，最后才回退到 `*_begin`；Raw records 保持不变，因为其逐行 label 有意暴露原始协议 subtype。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 2. Historical transcript coverage / 历史转录覆盖
- Status: open / 状态：开放
- Problem: many older transcript shapes are only partially represented in fixtures / 问题：许多较旧的转录形态在 fixture 中只有部分表示
- Residual risk: fixture coverage is targeted rather than exhaustive; current incomplete tool begin/declined rows are covered, but sparse metadata, malformed JSONL, and new MCP, collaboration, hook, approval, dynamic tool, or image generation shapes may still need new fixtures as they appear. / 残余风险：fixture 覆盖是针对性的而非穷尽式的；当前不完整工具 begin/declined 行已有覆盖，但稀疏 metadata、格式异常 JSONL，以及新的 MCP、协作、hook、approval、dynamic tool 或图像生成形态出现时仍可能需要新增 fixture。
- Current observation: the local corpus contains collaboration lifecycle variants but no dynamic tool, approval, hook, or image-generation protocol rows. Those unobserved families intentionally retain bounded generic summaries until real payloads are available. / 当前观察：本地语料包含协作生命周期 variant，但没有 dynamic tool、approval、hook 或图像生成协议行。这些尚未观察到的类型会有意保留受限通用摘要，直到出现真实 payload。
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
