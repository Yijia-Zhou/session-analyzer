# Trajectory Presentation / 轨迹呈现

## Metadata / 元数据

- Status: accepted for production implementation / 状态：已接受，进入正式实现
- Last updated: 2026-09-04 / 最近更新：2026-09-04
- Base: `origin/towards-0.2.0` at `3419a49ae2c1c9a6ff7e1e34ecb3b550ba1f9ec1`
- Related product spec: `docs/product-specs/session-transcript-analyzer.md`
- Related design docs: / 相关设计文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/timeline-loading-and-rendering-performance.md`
  - `docs/design-docs/indexed-materialized-session-lifecycle.md`
  - `docs/design-docs/cache-observation-and-discontinuity.md`
- Completed execution plan: `docs/exec-plans/completed/2026-09-03-trajectory-presentation.md`
- Read-only design evidence: disposable `tmp/worktrees/trajectory-demo` prototype and local DeepSeek Harness UI/source / 只读设计证据：一次性的 `tmp/worktrees/trajectory-demo` prototype 与本机 DeepSeek Harness UI/source

## Context / 背景

The existing Main Timeline is optimized for structured chronological inspection. The validated prototype showed that the same canonical Main Logical Events can also support a compact sequence overview and a narrative-first ledger, especially when tool-heavy work makes individual Timeline cards expensive to scan. Production Trajectory therefore becomes an alternate Main Presentation, not a fourth Event Layer and not a new interpretation of source history. / 现有主时间线针对结构化的时间顺序检查进行了优化。经过验证的 prototype 表明，同一批 canonical Main Logical Event 也可以支持紧凑的序列概览与 narrative-first ledger，尤其适用于大量工具活动使逐张 Timeline card 难以快速浏览的工作。因而正式 Trajectory 是另一种主时间线呈现，不是第四个事件层，也不是对来源历史的新解释。

The production implementation starts again from the accepted `towards-0.2.0` architecture. The prototype is evidence for interaction and projection ideas only; its branch, integration, DOM lifecycle, and source assumptions are not inherited. / 正式实现从已接受的 `towards-0.2.0` 架构重新开始。Prototype 只作为交互和 projection 思路的证据；其分支、集成方式、DOM 生命周期和来源假设均不继承。

## Decisions / 决策

1. Main, Protocol, and Raw remain the only Event Layers. / Main、Protocol 与 Raw 继续是仅有的三个事件层。
2. Main has two presentations: `Timeline` and `Trajectory`; `Timeline` remains the default. / Main 具有 `Timeline` 与 `Trajectory` 两种呈现；默认仍为 `Timeline`。
3. Protocol and Raw always use Timeline. Leaving Main does not overwrite the remembered Main Presentation, and returning to Main restores it. / Protocol 与 Raw 始终使用 Timeline。离开 Main 不会覆盖已记住的主时间线呈现；返回 Main 时恢复它。
4. The first production preference is browser-process state only. It adds no persisted setting or server contract. / 第一版正式 preference 只存在于 browser process state 中，不新增持久化设置或 server contract。
5. Trajectory consumes the existing timeline DTO, structured filters, free-text hit annotations, folding evaluation, selection, detail, Raw Reference, pagination, and navigation mechanisms. It does not own a second search/filter model. / Trajectory 消费既有 timeline DTO、结构化筛选、自由文本命中标注、折叠求值、选择、详情、原始引用、分页与导航机制；不拥有第二套搜索／筛选模型。
6. Sequence position is canonical order only. Trajectory does not infer request ownership, steps, causal arrows, concurrency, TTFT, or duration. / 序列位置只表示 canonical 顺序。Trajectory 不推断 request ownership、step、因果箭头、并发、TTFT 或 duration。
7. The browser receives all information required by this version from existing APIs. No server endpoint or DTO field is added. / 本版本所需信息均已由既有 API 提供给 browser；不新增 server endpoint 或 DTO 字段。

## Source-neutral projection / 来源中立 projection

`src/browser/trajectory-presentation.js` owns a pure projection before it owns DOM rendering. Its input is the ordered `state.currentEvents` array of currently committed and materialized canonical Main Logical Event DTOs. Presentation-only temporary reference reveals are deliberately excluded because their canonical position is not established by insertion beside a source card or at the loaded prefix tail. Source identity is deliberately absent from classification and grouping. / `src/browser/trajectory-presentation.js` 先拥有纯 projection，再拥有 DOM rendering。输入是 `state.currentEvents` 中当前已提交、已 materialize 且按顺序排列的 canonical Main Logical Event DTO 数组。仅用于呈现的临时引用 reveal 会被明确排除，因为插在 source card 之后或 loaded prefix 尾部都不能证明其 canonical 位置。分类与归组有意不读取来源 identity。

```text
ordered, materialized Main Logical Events
  -> validate unique event identity and canonical order
  -> classify each event as Input, Model, Tools, or visible Other
  -> preserve weak reliable-turn boundaries
  -> replace each adjacent Tools run with one reversible Tool Activity Group
  -> expose one overview sequence model over the same event IDs
```

Every projected event retains a direct reference to its canonical event, its stable event ID, canonical sequence index, lane, reliable turn ID or `null`, preview text, and the display state supplied by the existing folding evaluator. Projection never mutates the DTO. Duplicate or missing IDs fail closed in focused logic rather than silently producing ambiguous selection ownership. / 每条 projected event 保留其 canonical event 的直接引用、稳定 event ID、canonical sequence index、lane、可靠 turn ID 或 `null`、preview 文本，以及由既有折叠求值器提供的 display state。Projection 不修改 DTO。重复或缺失 ID 会在 focused logic 中 fail closed，而不是静默产生有歧义的选择 ownership。

### Lane classification / Lane 分类

Classification uses canonical `kind` first, then source-neutral semantic fields such as `role` and a non-empty canonical `toolName` as a conservative fallback. It never branches on `sourceKind`. / 分类优先使用 canonical `kind`，再把 `role` 与非空 canonical `toolName` 等来源中立 semantic field 作为保守回退；绝不按 `sourceKind` 分支。

| Lane / 泳道 | Canonical meaning / Canonical 含义 | Initial kinds / 首版 kinds |
| --- | --- | --- |
| Input | Human/developer-authored input / 人类或 developer 发出的输入 | `user_message`, `developer_message`, `user_shell_command` |
| Model | Model-authored narrative or durable model work state / 模型输出的叙事或持久模型工作状态 | `assistant_message`, `reasoning`, `proposed_plan`, `plan_update`, `goal` |
| Tools | Tool-like execution activity suitable for adjacency grouping / 适合按相邻关系归组的工具式执行活动 | `command`, `read`, `patch`, `web_search`, `mcp_call`, `js_repl`, `other_tool_call`, `code_mode_operation`, `agent_coordination`, `background_command`, `async_agent`, `async_workflow`, `hook`, `subagent` |
| Other | A visible fail-safe for every remaining Main kind / 所有其余 Main kind 的可见 fail-safe | warnings, errors, review/lifecycle boundaries, future unknown kinds / warning、error、review／lifecycle 边界与未来未知 kind |

Explicit known kinds win over fallback fields, so a user-initiated shell command remains Input and Goal/Plan state remains Model even if another semantic field differs. For an unknown kind, human/developer role wins first, then a canonical `toolName` or tool/function role wins before assistant/model role. Unknown Main events always remain in the projection and render as an Other row plus a cross-lane overview mark; they are never dropped because a source or kind is unfamiliar. A user-selected Folding Strategy may still make an event hidden through the existing contract. / 显式 known kind 优先于 fallback field，因此用户发起的 shell command 保持为 Input，Goal／Plan state 即使其它 semantic field 不同也保持为 Model。对于 unknown kind，human／developer role 最先优先；随后 canonical `toolName` 或 tool／function role 优先于 assistant／model role。未知 Main event 始终保留在 projection 中，并渲染为 Other row 与跨 lane overview mark；不会因为来源或 kind 不熟悉而被丢弃。用户选择的折叠策略仍可按既有契约把 event 设为 hidden。

### Reliable turn boundaries / 可靠 turn 边界

A non-empty canonical `turnId` is used only after rejecting known empty, unknown, redacted, or omitted sentinels. A subtle boundary appears when a reliable ID begins or changes in canonical order. Missing evidence creates no prominent “No reliable turn” section and never causes time- or adjacency-based turn inference. / 非空 canonical `turnId` 只有在排除已知 empty、unknown、redacted 或 omitted sentinel 后才使用。当可靠 ID 在 canonical 顺序中开始或发生变化时，展示一个弱化边界。证据缺失时不显示醒目的 “No reliable turn” section，也绝不依据时间或相邻关系推断 turn。

### Tool Activity Group / 工具活动组

A Tool Activity Group replaces one maximal canonically adjacent run of Tools-lane projected events, split by any intervening non-Tools event—even one hidden by Folding Strategy—or a newly observed reliable turn boundary. It is display-only, reversible, and non-causal. The group records ordered individual event IDs and projected event references; it does not create a Logical Event, parent ID, request, step, ownership edge, status, duration, search target, metric owner, or Raw Reference owner. / 工具活动组替代 Tools lane 中一段 canonical 最大相邻 projected event 序列；任何插入其中的非 Tools event（即使被折叠策略隐藏），或新出现的可靠 turn boundary，都会把它切开。它仅用于展示、可逆且不表达因果。Group 记录有序的 individual event ID 与 projected event reference；不创建逻辑事件、parent ID、request、step、ownership edge、status、duration、search target、metric owner 或原始引用 owner。

The collapsed summary may report the number of canonical member events, representative tool names, and failure count derived directly from member fields. Expanding materializes selectable individual event rows in canonical order. A selected event or an existing search-transient expansion forces its containing group open; closing or regrouping never changes the underlying event identity. / 折叠摘要可以报告 canonical member event 数量、代表性工具名称，以及直接由成员字段得出的失败数量。展开后按 canonical 顺序 materialize 可选择的 individual event row。已选 event 或既有 search-transient expansion 会强制打开其所在 group；关闭或重新归组绝不改变底层 event identity。

Collapsed groups do not retain all member DOM nodes. Member buttons are materialized on demand and discarded safely with the containing Trajectory render. This bounds the ordinary narrative DOM near the number of narrative rows plus tool groups while keeping complete identity in the pure projection. / 折叠 group 不长期保留所有 member DOM node。Member button 按需 materialize，并随所属 Trajectory render 安全丢弃。这样普通 narrative DOM 接近 narrative row 加 tool group 的数量，同时完整 identity 仍保留在纯 projection 中。

## UI state and Event Layer contract / UI state 与事件层契约

The center reading header adds a compact `Timeline | Trajectory` segmented Main Presentation selector, visually and semantically distinct from the existing global Layer selector in the top bar. It is shown only when a Main session reading surface is active. The Layer selector and its `Main timeline | Protocol layer | Raw records` values remain authoritative and unchanged. / 中心阅读区 header 增加紧凑的 `Timeline | Trajectory` 分段主时间线呈现选择器；它与顶栏中的既有 global Layer selector 在视觉和语义上保持独立。只有 Main session reading surface 生效时才显示。Layer selector 及其 `Main timeline | Protocol layer | Raw records` 值继续保持权威且不变。

The effective presentation is: / 实际呈现规则为：

```text
project-result surface                         -> existing project result view
Main + remembered Timeline                     -> existing keyed Main Timeline
Main + remembered Trajectory                   -> Trajectory Presentation
Protocol or Raw, regardless of remembered Main -> existing Timeline presentation
```

Changing presentation does not fetch data, rewrite the timeline data context, clear structured filters, change folding rules, or close a selected-event Inspector. It replaces only the center presentation, resets stale DOM search bindings, and binds the same canonical target identities to the new surface. / 切换呈现不会获取数据、改写 timeline data context、清空结构化筛选、改变折叠规则或关闭已选 event 的 Inspector。它只替换中心呈现、重置过期 DOM 搜索 binding，并把相同 canonical target identity 绑定到新 surface。

## Narrative, folding, search, and navigation / Narrative、折叠、搜索与导航

Trajectory asks the existing `displayState(event)` owner for each event. `hidden` members remain present in projection and overview but do not become searchable narrative DOM owners. `collapsed`, `summary`, and `expanded` remain distinct CSS/presentation states without importing Timeline detail bodies into the compact ledger. Structured filters remain server-owned membership filters and therefore change the input event array exactly as they do for Timeline. / Trajectory 向既有 `displayState(event)` owner 请求每个 event 的状态。`hidden` member 保留在 projection 与 overview 中，但不会成为可搜索的 narrative DOM owner。`collapsed`、`summary` 与 `expanded` 继续是不同的 CSS／呈现状态，同时不会把 Timeline detail body 导入紧凑 ledger。结构化筛选继续由 server 拥有 membership，因此会像 Timeline 一样改变输入 event 数组。

Every materialized visible individual row has exactly one `data-event-id` owner. The overview never creates a second canonical search owner. Free-text target discovery therefore continues to use `state.currentEvents` and one canonical target per logical event; highlighting binds only to the currently materialized narrative/Inspector DOM. / 每个已 materialize 且可见的 individual row 恰好有一个 `data-event-id` owner。Overview 不创建第二个 canonical search owner。因而自由文本 target discovery 继续使用 `state.currentEvents`，每条 logical event 只有一个 canonical target；highlight 只绑定当前已 materialize 的 narrative／Inspector DOM。

If search navigation targets an event inside a closed group, the existing detail-backed transient reveal makes the event visible, Trajectory opens and materializes that group, then the existing target registry binds and scrolls to the individual row. Manual group expansion never changes saved Folding Strategy rules or event overrides. / 如果搜索导航的目标位于关闭的 group 内，既有 detail-backed transient reveal 会使该 event 可见；Trajectory 随后打开并 materialize 该 group，再由既有 target registry 绑定并滚动到 individual row。手动展开 group 绝不改变已保存的折叠策略规则或 event override。

An event-envelope target absent from committed `state.currentEvents` remains selectable through a labeled detached reference card outside the Trajectory sequence. It retains the existing temporary-reveal identity, Inspector, Detail, and Raw Reference behavior, but owns no overview position, turn boundary, or Tool Activity Group membership. If later pagination materializes that event canonically, the temporary reveal is removed and the same selected ID rejoins the sequence at its committed index. / Event-envelope target 若不在已提交的 `state.currentEvents` 中，会通过 Trajectory sequence 外带明确标签的 detached reference card 保持可选择。它继续复用既有 temporary-reveal identity、Inspector、Detail 与原始引用行为，但不拥有 overview position、turn boundary 或工具活动组 membership。若后续 pagination 把该 event canonical materialize，temporary reveal 会被移除，同一个 selected ID 会在已提交 index 上重新进入序列。

Inspector selection, previous/next navigation, project-search drill-down, `Read from here`, Main↔Protocol Cache links, and Raw Reference navigation continue to call the existing event-envelope and contiguous-prefix loading paths. Once an event is loaded, selection synchronization opens its group and locates the same ID. / Inspector 选择、previous／next 导航、project-search drill-down、`Read from here`、Main↔Protocol Cache link 与原始引用导航继续调用既有 event-envelope 和连续 prefix loading 路径。Event 加载后，selection synchronization 打开其 group 并定位同一个 ID。

## Trajectory Overview / 轨迹概览

The overview has exactly three labeled rows: Input, Model, and Tools. It covers only the ordered Main events currently committed and materialized in the browser; detached temporary references are excluded. When `offset < timelineTotal`, copy and accessible state explicitly say that the display is a loaded prefix and report loaded/total result counts; it never implies that the complete Session is visible. / Overview 恰好有三条标注行：Input、Model 与 Tools。它只覆盖 browser 当前已提交且已 materialize 的有序 Main event；detached temporary reference 不进入其中。当 `offset < timelineTotal` 时，文案与无障碍状态会明确说明当前是 loaded prefix，并报告 loaded／total result count；绝不暗示完整 Session 已全部可见。

The overview uses a bounded canvas plus a constant-size selected-event locator rather than one permanent DOM marker per event. The canvas width is bounded by the viewport and the supported zoom range, not by event count. Unknown/Other events draw a cross-lane fail-safe mark. The selected locator spans lanes lightly, remains visible at Fit even for 1,000+ events, and carries the canonical selected event ID. / Overview 使用有界 canvas 与固定数量的 selected-event locator，而不是为每条 event 长期保留一个 DOM marker。Canvas 宽度由 viewport 和受支持 zoom range 限定，而不随 event 数增长。Unknown／Other event 绘制跨 lane fail-safe mark。Selected locator 轻量跨越 lanes，即使在 1000+ event 的 Fit 状态也保持可见，并携带 canonical selected event ID。

Rendering mode depends on available horizontal pixels per event: / Rendering mode 取决于每个 event 可用的横向像素：

- At low zoom, events are accumulated into lane/pixel bins and rendered as density. A bin is aggregate presence/intensity, not an individual marker. / 低 zoom 下，event 按 lane／pixel bin 聚合并渲染为 density。Bin 表示聚合存在性／强度，不是 individual marker。
- At medium/high zoom, sufficient pixel separation allows individual canvas markers. These remain canvas marks, not persistent DOM nodes. / 中高 zoom 下，当像素间隔足够时绘制 individual canvas marker；它们仍是 canvas mark，而不是持久 DOM node。

Pointer selection maps the click to the nearest canonical sequence event, preferring a globally nearest Other event because its fallback marker spans all three rows; otherwise it prefers the clicked Input／Model／Tools lane when possible. The narrative remains the accessible, identity-complete event list. / Pointer selection 把点击映射到最近的 canonical sequence event；由于 Other fallback marker 贯穿三行，全局最近 event 若为 Other 则优先选择它，否则在可能时优先选择被点击的 Input／Model／Tools lane。Narrative 继续作为具备无障碍能力且 identity 完整的 event list。

## Sequence Zoom / 序列缩放

Sequence Zoom is bounded presentation state with Fit, zoom-out, zoom-in, horizontal wheel/trackpad pan, pointer drag pan, selected-event anchoring, and an explicit return to Fit. The UI emphasizes `−`, `+`, and `Fit all`／`全览`; any multiplier is secondary status copy. / 序列缩放是有界的呈现状态，支持 Fit、缩小、放大、横向 wheel／trackpad pan、pointer drag pan、selected-event anchor，以及显式回到 Fit。UI 强调 `−`、`+` 与 `Fit all`／`全览`；倍率只作为次级状态文案。

The first zoom from Fit anchors around the selected event when one exists, otherwise around the viewport center. Subsequent zooms preserve the current viewport center. Selection changes may bring an off-screen selected locator into view. User pan changes only the viewport; it never forces the viewport back to selection until a later explicit selection change or zoom action. / 第一次从 Fit 放大时，如存在已选 event，则围绕它 anchor；否则围绕 viewport center。后续 zoom 保持当前 viewport center。Selection 变化可以把 viewport 外的 selected locator 带入可视范围。用户 pan 只改变 viewport；在后续显式 selection change 或 zoom action 前，绝不强制吸回 selection。

Fit means the complete loaded sequence, not the complete Session when more data remains. View state is reset for a new timeline data context and may be retained across presentation switches and same-context Load more. / Fit 指完整 loaded sequence；当仍有数据未加载时，并不表示完整 Session。新 timeline data context 会重置 view state；presentation switch 与同 context Load more 之间可以保留该状态。

## Timeline lifecycle and stale ownership / Timeline 生命周期与过期 ownership

Trajectory is a non-Timeline center-root presentation. Entering it retires every Wave 1C Main Timeline card owner before replacing the center root. Returning to Timeline performs the existing full Main reconciliation. This deliberately avoids pretending that removed Timeline DOM remains mounted, while preserving the accepted keyed append behavior whenever Timeline is active. / Trajectory 是非 Timeline 的中心 root 呈现。进入它时，会在替换中心 root 前 retire 所有 Wave 1C Main Timeline card owner。返回 Timeline 时执行既有完整 Main reconciliation。这样不会假装已移除的 Timeline DOM 仍然 mounted，同时在 Timeline 生效期间保持已接受的 keyed append 行为。

When a same-context page append commits while Trajectory is active, canonical timeline state remains authoritative and Trajectory performs a bounded full projection/render over the newly loaded prefix. It must not call the keyed Main append path against a retired owner registry. When Timeline is active, the existing incremental suffix preparation, registration, search binding, and fallback behavior remain byte-for-byte on their current branch. / 当 Trajectory 生效时，同 context page append 提交后仍以 canonical timeline state 为权威，并对新 loaded prefix 执行有界的完整 projection／render；绝不能对已 retired owner registry 调用 keyed Main append path。当 Timeline 生效时，既有增量 suffix preparation、registration、search binding 与 fallback behavior 保持在当前分支中，不被改写。

Presentation switching never changes request ownership. Session, layer, source, repository, locale, filters, query, replacement generation, detail selection, and revision recovery continue to invalidate or accept work through their current owners and context guards. A stale request cannot choose a presentation or paint into the current root because rendering still happens only after the existing context commit. / Presentation switch 不改变 request ownership。Session、layer、source、repository、locale、filter、query、replacement generation、detail selection 与 revision recovery 继续通过当前 owner 和 context guard 使工作失效或接纳工作。过期 request 无法选择 presentation 或绘制到当前 root，因为 rendering 仍只会在既有 context commit 后发生。

## Prototype to production differences / Prototype 到 production 的差异

| Prototype evidence / Prototype 证据 | Production decision / 正式决定 |
| --- | --- |
| Layout A Swimlanes and Layout B selector | Remove Layout A and the layout selector; Overview + narrative is Trajectory. / 移除 Layout A 与 layout selector；Overview + narrative 即 Trajectory。 |
| `Trajectory demo` as a generic view, including a non-Main notice | Main-only presentation selector; Protocol/Raw always render Timeline while remembered Main state is retained. / Main-only presentation selector；Protocol／Raw 始终渲染 Timeline，同时保留 remembered Main state。 |
| One overview button per event | Bounded canvas density/marker rendering plus one selected locator. / 有界 canvas density／marker rendering，加一个 selected locator。 |
| Tool groups attached beneath the preceding model row | Standalone adjacency groups with no assistant/tool ownership field or causal copy. / 独立的相邻 group，不设置 assistant／tool ownership field，也不使用因果文案。 |
| Positive `outputStats.durationMs` displayed when present | Omit duration entirely; sequence is not elapsed time. / 完全不展示 duration；sequence 不表示经过时间。 |
| Prominent “No reliable turn” section | No section when reliable turn evidence is absent. / 没有可靠 turn 证据时不创建 section。 |
| Full render on Trajectory append without explicit lifecycle contract | Explicit non-Main owner retirement and Trajectory-only append branch; existing Timeline keyed branch stays intact. / 显式 non-Main owner retirement与 Trajectory-only append branch；既有 Timeline keyed branch 保持不变。 |
| Minimal integration coverage | Production coverage includes Load more, search reveal, Inspector navigation, project drill-down, filters, folding, context changes, stale requests, locale, and long-session shapes. / 正式覆盖 Load more、search reveal、Inspector navigation、project drill-down、filter、folding、context change、stale request、locale 与长 Session shape。 |

## Performance expectations / 性能预期

Focused projection tests cover approximately 300, 1,000, and 1,800 Main-event shapes and assert exact identity recovery. Browser evidence records projection time, view-switch work, overview DOM/node count, canvas rendering mode and bin/marker count, narrative row/group count, zoom/pan behavior, and same-context Load more. These are characterization results for this feature, not permanent latency gates. / Focused projection test 覆盖约 300、1,000 与 1,800 条 Main event 的 shape，并断言精确 identity recovery。Browser 证据记录 projection time、view switch work、overview DOM／node count、canvas rendering mode 与 bin／marker count、narrative row／group count、zoom／pan behavior，以及同 context Load more。这些是本 feature 的 characterization result，不是永久 latency gate。

The existing Timeline profile and Wave 1C tests remain release gates. Trajectory may add work only while it is the active Main Presentation; default Timeline startup and Timeline append must not pay a projection or canvas-render cost. / 既有 Timeline profile 与 Wave 1C test 继续作为 release gate。Trajectory 只能在自身为 active Main Presentation 时增加工作；默认 Timeline startup 与 Timeline append 不得承担 projection 或 canvas-render cost。

## Risks and containment / 风险与约束

- **Causal overstatement:** standalone groups, neutral wording, and the absence of parent/request fields keep adjacency from becoming ownership. / **因果过度表达：** 独立 group、中性文案，以及不设置 parent／request field，避免把相邻关系变成 ownership。
- **Unknown event loss:** projection identity invariants and visible Other fallback make omissions test failures. / **未知 event 丢失：** projection identity invariant 与可见 Other fallback 让遗漏直接成为 test failure。
- **Search divergence:** one `data-event-id` owner per materialized narrative event and reuse of the canonical registry prevent a second target model. / **搜索分叉：** 每个已 materialize narrative event 只有一个 `data-event-id` owner，并复用 canonical registry，从而避免第二套 target model。
- **Long-session DOM growth:** canvas overview and lazy group members bound non-reading DOM; the ledger retains only one row or one collapsed group per canonical run. / **长 Session DOM 增长：** canvas overview 与 lazy group member 限制非阅读 DOM；ledger 对每个 canonical run 只保留一个 row 或一个 collapsed group。
- **Timeline lifecycle regression:** the active-presentation branch sits outside existing keyed append preparation, and Wave 1C lifecycle tests run unchanged plus a presentation round-trip test. / **Timeline 生命周期回归：** active-presentation branch 位于既有 keyed append preparation 之外；保持 Wave 1C lifecycle test 不变，并增加 presentation round-trip test。
- **Misleading completeness:** loaded-prefix copy is derived from committed `offset` and `timelineTotal`, not guessed from DOM. / **误导完整性：** loaded-prefix 文案来自已提交的 `offset` 与 `timelineTotal`，不从 DOM 猜测。

## Validation / 验证

- Focused pure projection, lane, turn-boundary, reversible-group, overview-density, click mapping, and zoom tests. / Focused 纯 projection、lane、turn boundary、可逆 group、overview density、click mapping 与 zoom test。
- Browser tests for selector/Layer memory, selection and Inspector, Raw refs, search reveal inside a group, folding/filter refresh, project drill-down, previous/next, Load more, zoom/pan/free-pan behavior, loaded-prefix copy, locale, and stale context changes. / Browser test 覆盖 selector／Layer memory、selection 与 Inspector、Raw refs、group 内 search reveal、folding／filter refresh、project drill-down、previous／next、Load more、zoom／pan／free-pan behavior、loaded-prefix 文案、locale 与 stale context change。
- Existing `build:client`, `build:check`, Node, browser, installed-package, and release gates. / 既有 `build:client`、`build:check`、Node、browser、installed-package 与 release gate。
- Read-only manual acceptance against ordinary Codex, tool-heavy/Code Mode Codex, Claude Code, and DeepSeek Harness transcripts. / 对 ordinary Codex、tool-heavy／Code Mode Codex、Claude Code 与 DeepSeek Harness transcript 进行只读手工验收。

## Decision log / 决策日志

- 2026-09-03: Accepted Trajectory as the sole alternate Main Presentation, using source-neutral browser projection, reversible non-causal adjacency groups, a bounded canvas overview, and no server API change. / 2026-09-03：接受 Trajectory 作为唯一的 alternate Main Presentation，采用来源中立 browser projection、可逆且非因果的相邻 group、有界 canvas overview，并且不改变 server API。
