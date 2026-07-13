# Tech Debt Tracker / 技术债跟踪器

## Tracked items / 跟踪条目

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
- Residual risk: fixture coverage is targeted rather than exhaustive; current incomplete tool begin/declined rows are covered, but sparse metadata, malformed JSONL, new MCP, collaboration, hook, approval, dynamic tool, or image generation shapes, and paginated rollout rows with optional ordinals may still need new fixtures as they appear. / 残余风险：fixture 覆盖是针对性的而非穷尽式的；当前不完整工具 begin/declined 行已有覆盖，但稀疏 metadata、格式异常 JSONL、新的 MCP、协作、hook、approval、dynamic tool 或图像生成形态，以及带可选 ordinal 的分页 rollout 行出现时仍可能需要新增 fixture。
- Current observation: the local corpus contains collaboration lifecycle variants and many tool-call traces of approval and multi-agent behavior, but no dynamic tool, request-permissions approval, explicit hook lifecycle, or path-based `sub_agent_activity` protocol rows. Hook-like startup stdout has been observed as unwrapped developer messages, so the analyzer labels it as possible hook output without asserting a precise hook source. Approval is observed through escalated `shell_command` calls, and multi-agent activity is observed through tools such as `spawn_agent`, `wait_agent`, `send_input`, and `close_agent`; do not treat missing protocol rows as proof that those user-visible behaviors never happened. A separate real transcript has now confirmed image generation as paired `event_msg.image_generation_end` and `response_item.image_generation_call` rows whose `result` is a bare base64 PNG payload; minimized fixture coverage protects externalizing that payload and grouping those pairs into Main timeline `image_generation` tool events with preview support. The 2026-07-13 upstream pass additionally found optional paginated `RolloutLine.ordinal` plus terminal error/timing/source/process fields that are not yet represented by focused local fixtures. Field-specific protocol-event presentation remains intentionally bounded for the still-unobserved protocol payloads. / 当前观察：本地语料包含协作生命周期 variant，也有大量 approval 和 multi-agent 行为的工具调用痕迹，但没有 dynamic tool、request-permissions approval、明确 hook lifecycle 或基于路径的 `sub_agent_activity` 协议行。类似 hook 的 startup stdout 已通过未包装 developer message 观察到，因此 analyzer 只把它标为 possible hook output，而不声称精确 hook 来源。Approval 可通过 escalated `shell_command` 调用观察到，multi-agent 活动可通过 `spawn_agent`、`wait_agent`、`send_input` 和 `close_agent` 等工具观察到；不要把缺少协议行误判为这些用户可见行为从未发生。另一个真实 transcript 现已确认图像生成会以配对的 `event_msg.image_generation_end` 与 `response_item.image_generation_call` 行出现，且 `result` 是裸 base64 PNG payload；最小化 fixture 已保护该 payload 的外部化，并保护这些配对合并为带预览支持的 Main timeline `image_generation` tool 事件。2026-07-13 上游检查还发现可选的分页 `RolloutLine.ordinal` 以及尚未由聚焦本地 fixture 覆盖的终态 error/timing/source/process 字段。对仍未观察到的协议 payload，字段级协议事件呈现继续有意保持受限。
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

### 5. Review finding fixture strengthening / Review finding fixture 加强
- Status: closed / 状态：已关闭
- Closure note: a 2026-06-19 local-corpus validation found real non-empty `review_output.findings[]` rows using the same field family already covered by committed fixtures: `title`, `body`, `priority`, `confidence_score`, and `code_location.absolute_file_path` with `line_range.start/end`. The current index and detail pipeline generated `Review result` and `Findings` sections for all observed review completion rows without `[object Object]` output, including priority, confidence, and line-range rendering. / 关闭说明：2026-06-19 本地语料验证发现，真实非空 `review_output.findings[]` 行使用的字段族已被已提交 fixture 覆盖：`title`、`body`、`priority`、`confidence_score`，以及带 `line_range.start/end` 的 `code_location.absolute_file_path`。当前索引和详情管线能为所有观察到的 review 完成行生成 `Review result` 和 `Findings` section，没有出现 `[object Object]` 输出，并能渲染 priority、confidence 和行号范围。
- Residual risk: future Codex versions may introduce new finding field shapes; handle those through the normal schema-review and fixture-update process when they appear, rather than tracking the current real-data case as an open debt. / 残余风险：未来 Codex 版本可能引入新的 finding 字段形态；等它们出现时，通过常规 schema review 和 fixture 更新流程处理，而不要继续把当前真实数据 case 作为开放技术债跟踪。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/product-specs/session-transcript-analyzer.md`

### 6. Browser automation coverage series / 浏览器自动化覆盖系列
- Status: open / 状态：开放
- Problem: several high-value viewer behaviors are only partially covered by Node unit tests and manual browser spot checks; they are best validated by a full browser automation framework that can exercise DOM state, scrolling, localStorage, and event inspector interactions together. / 问题：若干高价值 viewer 行为目前只被 Node 单元测试和手动浏览器抽查部分覆盖；这些行为最好通过完整浏览器自动化测试框架验证，因为它们需要一起检查 DOM 状态、滚动、localStorage 和事件检查器交互。
- Current P0 coverage: `npm run test:browser` now runs Playwright coverage for timeline find pagination, Search HUD scope/count behavior, direct fixed-filter editing and Layer handoff in the parameter popover, literal operator-like text, project drill-down/return, inspector search redraws, `Read from here`, folding profile localStorage save/cancel/fallback, Issues metric profile toggling, expanded-event collapse controls, and narrow HUD geometry. / 当前 P0 覆盖：`npm run test:browser` 现通过 Playwright 覆盖 timeline find 分页、搜索 HUD 范围/计数行为、参数弹层固定筛选的直接编辑与层级交接、类似操作符的字面文本、项目下钻/返回、inspector search 重绘、`Read from here`、folding profile localStorage 保存/取消/回退、Issues 指标切换策略、展开事件收起控件，以及窄屏 HUD 几何。
- Residual risk: the browser suite covers the P0 release flows, but the broader coverage series remains open for project chooser race coverage, profile info popover geometry, narrow viewport placement, and future flows found during i18n and packaging. / 残余风险：浏览器套件已覆盖 P0 发布流程，但更广的覆盖系列仍开放，包括项目选择器竞态、策略说明 popover 几何、窄视口位置，以及 i18n 和打包期间发现的后续流程。
- Candidate browser tests: / 候选浏览器测试：
  - Free-text find keeps the currently loaded timeline range when the user has loaded additional pages. / 用户已加载更多时间线页后，自由文本查找应保留当前已加载范围。
  - Clear all removes free-text highlights, match navigation, and GUI event filters without reloading the selected session back to the first page or changing scope/Layer. / 全部清除应移除自由文本高亮、命中导航和 GUI 事件筛选，但不把当前 session 重新加载回第一页，也不改变范围/层级。
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
- Problem: several core files now own multiple independent change axes. `src/codex.js` combines project discovery, raw parsing, protocol interpretation, logical-event construction, detail extraction, search, image handling, and index assembly; `src/browser/app.js` combines project selection, timeline loading, search highlighting, detail navigation, folding-profile editing, caches, and DOM event wiring; `server.js` combines project-job state, API route dispatch, parameter handling, and static serving. / 问题：若干核心文件已经承担多个彼此独立的变化轴。`src/codex.js` 同时负责项目发现、原始解析、协议解释、逻辑事件构建、详情提取、搜索、图片处理和索引组装；`src/browser/app.js` 同时负责项目选择、时间线加载、搜索高亮、详情导航、折叠策略编辑、缓存和 DOM 事件绑定；`server.js` 同时负责项目 job 状态、API 路由分发、参数处理和静态文件服务。
- Current observation: after the Stage 2 raw-source, logical-event, and detail DTO/section increments plus the Stage 6 browser source split, `src/codex.js` still owns project discovery, protocol interpretation helpers, search, image handling, and index assembly; `src/browser/app.js` still owns project selection, timeline loading, search highlighting, detail navigation, folding-profile editing, caches, and DOM event wiring; `server.js` still owns project-job state, API route dispatch, parameter handling, and static serving. The Search HUD increment extracted structural keys, ordered filter metadata, summaries, and scope metrics into the pure `src/browser/search-controls.js` boundary, but DOM orchestration and asynchronous search transitions intentionally remain in `app.js`. High-change functions such as `buildIndex`, browser project-selection handlers, and `createServer` remain concentrated in those files. / 当前观察：完成 Stage 2 的 raw-source、logical-event、detail DTO/section 增量以及 Stage 6 浏览器源码拆分后，`src/codex.js` 仍负责项目发现、协议解释 helper、搜索、图片处理和索引组装；`src/browser/app.js` 仍负责项目选择、时间线加载、搜索高亮、详情导航、折叠策略编辑、缓存和 DOM 事件绑定；`server.js` 仍负责项目 job 状态、API 路由分发、参数处理和静态文件服务。搜索 HUD 增量已将结构 key、有序筛选 metadata、摘要和范围计数提取到纯 `src/browser/search-controls.js` 边界，但 DOM 编排与异步搜索转换有意继续留在 `app.js`。`buildIndex`、浏览器项目选择 handler 和 `createServer` 等高频变化函数仍集中在这些文件中。
- Stage 2 increments: Codex source constants, typed locator/raw ref helpers, raw matching helpers, and raw event parsing have moved to `src/codex-source.js` with focused `test/codex-source.test.js` coverage. Stage 2A moved Codex logical-event construction to `src/codex-logical.js` behind `createCodexLogicalBuilder(deps)`, preserving `src/codex.js` as the public assembly layer and adding focused `test/codex-logical.test.js` coverage. Stage 2B moved detail DTO assembly plus timeline/inspector section selection and splitting orchestration to `src/codex-detail.js` behind `createCodexDetailBuilder(deps)`, preserving the public `buildEventDetail` API and adding focused `test/codex-detail.test.js` coverage. Guardrail: `src/codex-logical.js` may export only `createCodexLogicalBuilder`, and `src/codex-detail.js` may export only `createCodexDetailBuilder`; these boundary modules must not import from `server.js`, browser modules, generated assets, or filesystem APIs. Index/search assembly, frontend state, and route/job handling remain intentionally open for later incremental boundaries. / 阶段 2 增量：Codex source 常量、typed locator/raw ref helper、raw matching helper 和 raw event 解析已移动到 `src/codex-source.js`，并由聚焦的 `test/codex-source.test.js` 覆盖。Stage 2A 已将 Codex 逻辑事件构建移动到 `src/codex-logical.js`，通过 `createCodexLogicalBuilder(deps)` 接入，同时保留 `src/codex.js` 作为公开组装层，并新增聚焦的 `test/codex-logical.test.js` 覆盖。Stage 2B 已将 detail DTO 组装，以及 timeline/inspector section 的选择和拆分编排移动到 `src/codex-detail.js`，通过 `createCodexDetailBuilder(deps)` 接入，保留公开 `buildEventDetail` API，并新增聚焦的 `test/codex-detail.test.js` 覆盖。护栏：`src/codex-logical.js` 只能导出 `createCodexLogicalBuilder`，`src/codex-detail.js` 只能导出 `createCodexDetailBuilder`；这些边界模块不得从 `server.js`、浏览器模块、生成资产或文件系统 API 导入。索引/搜索组装、前端状态以及 route/job 处理仍有意保留给后续渐进边界。
- The goal lifecycle increment keeps snapshot and response-envelope extraction, camelCase/snake_case field and status normalization, semantic-transition comparison, and explicit tool/snapshot signatures in the pure `src/codex-goal.js` boundary with focused `test/codex-goal.test.js` coverage. `src/codex-logical.js` and goal detail extraction consume that canonical projection instead of decoding aliases independently; tool cards and merge signatures share one effective state, including request-objective and response-envelope-status fallbacks. Tool/snapshot merging additionally requires local source-line causality, compatible known turns, and single consumption so signature equality cannot collapse unrelated lifecycle events. Goal-specific state comparison must not spread into browser folding or search code. / Goal 生命周期增量将快照与 response envelope 提取、camelCase/snake_case 字段与 status 规范化、语义 transition 比较以及明确的工具/快照签名保留在纯 `src/codex-goal.js` 边界，并由聚焦的 `test/codex-goal.test.js` 覆盖。`src/codex-logical.js` 与 goal detail 提取使用同一 canonical projection，不再独立解码 alias；工具卡片与合并签名共享同一份有效状态，包括请求 objective 与响应信封 status 的回退。工具/快照合并还要求局部源行因果关系、已知 turn 一致以及单次消费，避免仅凭签名相等折叠无关生命周期事件。Goal 专属状态比较不得扩散到浏览器 folding 或搜索代码。
- Residual risk: small feature changes can cross parsing, DTO, UI-state, route, and test concerns in one patch; review scope, merge-conflict probability, and test placement ambiguity will increase as transcript and viewer behavior continue to evolve. / 残余风险：小型功能变更也可能在同一补丁中跨越解析、DTO、UI 状态、路由和测试关注点；随着转录和查看器行为继续演进，审查范围、合并冲突概率和测试放置歧义都会增加。
- Preferred direction: extract incrementally behind the current public APIs instead of performing a broad rewrite. Stable candidate boundaries include indexing, search assembly, raw-event parsing, logical-event construction, detail-section extraction, frontend project selection, timeline find, detail-stack navigation, folding-profile editing, route handlers, and project-job management. Split tests along the same responsibility boundaries as code moves. / 建议方向：在保持当前公开 API 的前提下渐进提取，而不是进行大范围重写。较稳定的候选边界包括索引、搜索组装、原始事件解析、逻辑事件构建、详情 section 提取、前端项目选择、时间线查找、详情栈导航、折叠策略编辑、路由 handler 和项目 job 管理。代码移动时，测试也应按相同职责边界拆分。
- Future-session working rule: when a change materially touches one of the open candidate areas, prefer extracting that area on the way if the extraction can stay small and covered by focused tests. Do not keep adding substantial new logic to `src/codex.js`, `src/browser/app.js`, or `server.js` by default; if a feature deliberately leaves logic in those files to control scope, record the reason in the session closeout or this tracker. / 后续 session 工作规则：当一次变更实质触及上述开放候选区域时，如果提取可以保持小范围并用聚焦测试覆盖，应优先顺手提取该区域。不要默认继续把大量新逻辑堆进 `src/codex.js`、`src/browser/app.js` 或 `server.js`；如果某个功能为了控制范围而有意把逻辑留在这些文件中，应在 session closeout 或本跟踪器中记录原因。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/documentation-system.md`

### 9. Shared browser-and-Node module ownership boundary / 浏览器与 Node 共享模块归属边界
- Status: resolved for v0.1 build boundary / 状态：已针对 v0.1 构建边界解决
- Problem: `public/folding.js` was intentionally both a browser static asset and a Node runtime dependency through `src/folding.js`, so the `public/` tree was no longer only a delivery surface. Browser correctness also depended on manual script ordering in `public/index.html`. / 问题：`public/folding.js` 曾被有意同时用作浏览器静态资源，并通过 `src/folding.js` 成为 Node 运行时依赖，因此 `public/` 目录不再只是交付表面。浏览器正确性也依赖 `public/index.html` 中的手动脚本顺序。
- Resolution: Stage 6A moved shared browser-and-Node logic to `src/shared/`, browser source to `src/browser/`, and browser delivery to checked-in generated assets under `public/assets/`; `npm run build:check` now guards against stale generated bundles. / 解决方式：阶段 6A 已将浏览器与 Node 共用逻辑移到 `src/shared/`，将浏览器源码移到 `src/browser/`，并通过 `public/assets/` 下已提交的生成资产进行浏览器交付；`npm run build:check` 现在会防止生成 bundle 过期。
- Residual risk: the browser bundle is intentionally minimal and UMD-compatible for v0.1; a future broader frontend module migration may still be useful, but new shared display resources should follow the `src/shared/` plus generated bundle boundary. / 残余风险：v0.1 的浏览器 bundle 有意保持最小且兼容 UMD；未来更完整的前端模块迁移仍可能有价值，但新的共享展示资源应沿用 `src/shared/` 加生成 bundle 的边界。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/completed/2026-05-31-folding-rule-priority-governance.md`

### 10. Release workflow and trusted publishing / 发布流程与 trusted publishing
- Status: deferred / 状态：已推迟
- Problem: Stage 7 makes the package pack-ready and smoke-verified, but it intentionally does not decide how maintainers publish to npm. Adding a CI publish workflow later needs an authentication model, provenance expectations, package-name availability check, and release approval boundary. / 问题：阶段 7 只让 package 达到可打包并通过 smoke 验证的状态，但有意不决定维护者如何发布到 npm。后续添加 CI 发布流程时，需要决定认证模型、provenance 预期、包名可用性检查和发布审批边界。
- Preferred direction: evaluate npm trusted publishing/OIDC for CI-based npm releases before introducing any long-lived npm automation token; if manual publish remains the first release path, document the exact `npm pack` smoke, `npm publish` command, 2FA expectations, and rollback/deprecate policy. / 建议方向：在为 npm 发布引入任何长期自动化 token 前，先评估 npm trusted publishing/OIDC；如果首个发布路径仍采用手动发布，则记录精确的 `npm pack` smoke、`npm publish` 命令、2FA 预期，以及回滚/deprecate 策略。
- Reference: npm trusted publishing documentation, `https://docs.npmjs.com/trusted-publishers/`. / 参考：npm trusted publishing 文档，`https://docs.npmjs.com/trusted-publishers/`。
- Related docs: / 相关文档：
  - `docs/exec-plans/completed/2026-06-10-v0.1-release-hardening.md`
  - `CHANGELOG.md`

### 11. Locale display completeness and propagation / Locale 展示完整性与传递
- Status: resolved 2026-06-15 / 状态：已解决 2026-06-15
- Resolution: zh-CN catalog completeness is guarded by allowlist-based tests, raw DTO display labels now follow locale without changing machine fields, and project-selection POST plus state-returning project job responses propagate the browser-selected locale. / 解决方式：zh-CN catalog 完整性已由基于 allowlist 的测试保护，raw DTO 展示 label 现在会跟随 locale 且不改变机器字段，project-selection POST 和会返回 state 的 project job 响应会传递浏览器选择的 locale。
- Residual risk: future catalog additions can still choose awkward Chinese wording or overuse allowlisted English terms, but new disallowed English tokens fail tests instead of silently shipping. / 残余风险：后续 catalog 新增项仍可能选择不自然的中文文案或过度使用 allowlist 中的英文术语，但新的未允许英文 token 会让测试失败，不会静默发布。
- Follow-up direction: keep the allowlist narrow during future catalog changes; shared fallback humanization now covers the first cleanup pass. / 后续方向：未来修改 catalog 时保持 allowlist 收窄；共享兜底 humanization 已覆盖第一轮清理。
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/completed/2026-06-15-external-review-followups.md`

### 12. Cross-platform locator and golden stability / 跨平台 locator 与 golden 稳定性
- Status: resolved 2026-06-17 / 状态：已解决 2026-06-17
- Resolution: Codex JSONL `sourceLocator.file` values are normalized to forward slashes at the locator-generation boundary, golden expectations use that convention, and tests verify legacy raw source paths plus path-like transcript text stay unchanged. / 解决方式：Codex JSONL `sourceLocator.file` 在 locator 生成边界归一化为前斜杠，golden 期望使用该约定，并且测试验证 legacy raw source path 与 transcript 中类似 path 的文本保持原样。
- Residual risk: future non-Codex source adapters may need their own locator conventions rather than assuming file/line semantics. / 残余风险：未来非 Codex source adapter 可能需要自己的 locator 约定，而不能假设 file/line 语义。
- Follow-up direction: keep new locator examples typed and normalize only generated locator fields, not original transcript content. / 后续方向：新增 locator 示例保持 typed 形态，并且只归一化生成的 locator 字段，不改写原始 transcript 内容。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/external-source-mapping-pressure-tests.md`
  - `docs/exec-plans/completed/2026-06-15-external-review-followups.md`

### 13. Package artifact and smoke hardening / Package artifact 与 smoke 加固
- Status: resolved 2026-06-17 / 状态：已解决 2026-06-17
- Resolution: release browser delivery is minified without generated source maps, `npm run build:check` verifies generated assets, pack manifest tests reject `.map` files, and package smoke verifies installed-package `/api/state` JSON plus root HTML bundle references. / 解决方式：发布浏览器交付资产已压缩且不生成 sourcemap，`npm run build:check` 会验证生成资产，pack manifest 测试会拒绝 `.map` 文件，package smoke 会验证已安装 package 的 `/api/state` JSON 与根 HTML bundle 引用。
- Residual risk: future package surface changes still need matching smoke coverage so the installed tarball remains the tested artifact. / 残余风险：未来 package 表面变化仍需要同步 smoke 覆盖，确保测试对象始终是已安装 tarball。
- Follow-up direction: keep release artifact checks broad and policy-oriented rather than tied to exact generated byte counts. / 后续方向：release artifact 检查保持宽松且面向策略，不绑定精确生成字节数。
- Related docs: / 相关文档：
  - `docs/exec-plans/completed/2026-06-15-external-review-followups.md`
  - `docs/exec-plans/completed/2026-06-10-v0.1-release-hardening.md`

### 14. Paginated rollout ordering and terminal lifecycle metadata / 分页 rollout 排序与终态生命周期 metadata
- Status: open / 状态：开放
- Problem: current Codex rollout storage may add a zero-based top-level `RolloutLine.ordinal` for paginated history, while `task_started` / `task_complete` and command lifecycle payloads now expose terminal errors, timing, process, source, and interaction metadata. The analyzer currently preserves these values in parsed raw JSON but indexes events in physical JSONL line order and does not expose them as typed fields. / 问题：当前 Codex rollout storage 可能为分页 history 增加顶层零基 `RolloutLine.ordinal`，而 `task_started` / `task_complete` 和 command 生命周期 payload 现在暴露终态错误、计时、process、source 及 interaction metadata。Analyzer 当前会在 parsed raw JSON 中保留这些值，但仍按物理 JSONL 行顺序建立索引，也没有把它们暴露为 typed field。
- Residual risk: paginated suffixes with gaps or resumed tails may need durable ordinal-aware ordering, and terminal errors or timing may eventually affect failure indicators, metrics, or detail sections. `safety_buffering` and newer item/review/collaboration fields remain generic protocol fallback until their user-visible semantics are fixture-backed. / 残余风险：带 gap 或恢复尾部的分页 suffix 可能需要基于持久 ordinal 的排序；终态错误或计时未来也可能影响失败指示器、指标或 detail section。`safety_buffering` 以及更新的 item/review/collaboration 字段在有 fixture 支持其用户可见语义前，继续使用 generic protocol fallback。
- Next step: add a synthetic, sanitized fixture covering ordinal-present and legacy rows, a gap/resume case, terminal-error completion, command timing/source fields, and raw/source-locator preservation; then make a separate parser decision only if product semantics require it. / 下一步：增加合成且脱敏的 fixture，覆盖带 ordinal 与 legacy 行、gap/resume 场景、带终态错误的 completion、command 计时/source 字段以及 raw/source-locator 保留；之后只有在产品语义确实需要时，才单独做 parser 决策。
- Related docs: / 相关文档：
  - `docs/design-docs/schema-update-runbook.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/exec-plans/completed/2026-07-13-codex-event-schema-review.md`
