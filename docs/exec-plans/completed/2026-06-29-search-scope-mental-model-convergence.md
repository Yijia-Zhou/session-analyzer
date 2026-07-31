# Search scope mental-model convergence / 搜索范围心智模型收敛

## Goal / 目标

Replace the top search bar's implicit mixture of project-wide session filtering, selected-session find, and cross-surface DOM navigation with two explicit scopes: `Current session` and `Entire project`. Preserve the useful in-session phrase-find and materialization behavior, add explainable project results, and make every count, filter, transition, and keyboard action belong to one visible scope. / 将顶部搜索栏目前隐式混合的项目级 session 筛选、当前 session 查找和跨界面 DOM 导航，替换为两个显式范围：`当前 session` 与 `整个项目`。保留有价值的 session 内短语查找和物化行为，增加可解释的项目搜索结果，并让每个计数、过滤器、状态转换和键盘操作都归属于一个可见范围。

The work is complete only when the implementation, generated browser assets, bilingual product/design contracts, focused and full regression coverage, and final browser verification all agree with this plan. / 只有实现、生成的浏览器资产、双语产品/设计契约、聚焦及全量回归覆盖和最终浏览器验证全部与本计划一致时，本工作才算完成。

## Current state and problem / 当前状态与问题

- Plain free text `q` is deliberately omitted from browser `/api/sessions` requests and sent to the selected session's `/timeline` request, where it marks hits without filtering the timeline. / 普通自由文本 `q` 被浏览器有意从 `/api/sessions` 请求中省略，并发送到所选 session 的 `/timeline` 请求；它只标记命中而不筛掉 timeline 事件。
- `file:`, `kind:`, `status:`, and `layer:` are serialized into the same input string but are sent to both session-list and timeline requests. Selecting a file suggestion can therefore reload the project session list, remove the current session, and leave a non-empty result list beside a misleading no-session state. / `file:`、`kind:`、`status:` 和 `layer:` 被序列化到同一个输入字符串，却同时发送给 session 列表和 timeline 请求。因此，选择文件候选可能重载项目 session 列表、移除当前 session，并让非空结果列表旁出现误导性的无 session 状态。
- The frontend jump-target registry currently discovers visible session rows, timeline events, and the selected-event Inspector together. Its count is stable for one semantic key, but it combines surfaces whose product scopes are different. / 前端跳转目标注册表目前会一起发现可见 session 行、timeline 事件和选中事件 Inspector。它在同一语义 key 下保持稳定，但混合了产品范围不同的界面。
- The backend can filter sessions by `q`, but the response exposes only ordinary session summaries. It does not explain which events matched, how many events matched, or which match should be opened. / 后端能够按 `q` 筛选 sessions，但响应只提供普通 session 摘要，无法解释哪些事件命中、命中多少事件，或应打开哪个命中。
- Existing project-level `q` and structured-filter checks are independent at session level: the phrase may match one event while `file` or `kind` matches another. That is not a valid project search result under the new model. / 现有项目级 `q` 与结构化过滤在 session 层分别判断：短语可能命中一个事件，而 `file` 或 `kind` 命中另一个事件。在新模型下，这不构成合法的项目搜索结果。
- Search-result counts currently place project session totals, selected-session event totals, materialized jump targets, and selected-session full-text occurrences in one summary without an explicit scope model. / 当前搜索结果摘要把项目 session 总数、所选 session 的事件总数、已物化跳转目标和所选 session 的全文 occurrence 放在一起，但没有显式范围模型。

## Product model and invariants / 产品模型与不变量

### Explicit scope and context / 显式范围与上下文

- Search has one visible scope state: `session` or `project`. A segmented control beside the search input exposes and changes it; syntax never changes scope implicitly. / 搜索只有一个可见范围状态：`session` 或 `project`。搜索框旁的分段控件展示并修改该状态；任何语法都不能隐式改变范围。
- With a selected session, a fresh page starts in `session` scope. Without a selectable session, scope is `project` and the session choice is disabled. Scope is not persisted across page reloads. / 存在所选 session 时，新页面从 `session` 范围开始；没有可选 session 时使用 `project` 范围，并禁用 session 选项。范围不跨页面重载持久化。
- Layer remains the single existing application layer state. It is always visible as a non-removable context chip, follows the current layer in both scopes, and is not duplicated inside the query/filter model. / Layer 继续使用应用现有的唯一事件层状态。它在两个范围中都始终以不可移除的上下文 chip 显示并跟随当前事件层，不能在 query/filter 模型中再保存一份。
- Query, `file`, `kind`, and `status` survive scope changes, result drill-down, returning to project results, and manual session changes. Changing layer reruns the active scope with the same query and filters. / Query、`file`、`kind` 和 `status` 在范围切换、结果下钻、返回项目结果和手动切换 session 时保持不变。切换 Layer 会用相同 query 和过滤器重新执行当前范围。
- `Clear all` clears only query plus `file`/`kind`/`status`; it preserves scope and layer. `Read from here` remains a distinct reading action and may intentionally clear event filters and return to Main timeline. / `全部清除`只清除 query 及 `file`/`kind`/`status`，保留范围和 Layer。`从这里继续阅读`仍是独立阅读动作，可以有意清除事件过滤并返回 Main timeline。

### Query and filter representation / Query 与过滤器表示

- The text input displays free text only. `file`, `kind`, and `status` are authoritative structured state rendered as persistent chips; the DOM input value is not the source of truth for the complete search state. / 文本输入框只显示自由文本。`file`、`kind` 和 `status` 是权威结构化状态，并渲染为常驻 chips；DOM 输入值不再是完整搜索状态的事实来源。
- A valid typed `file:`, `kind:`, `status:`, or `layer:` token is converted into structured state and removed from the free-text input. A recognized operator with an invalid value remains editable with an inline validation error; an unknown operator-like token remains literal free text. / 手输的合法 `file:`、`kind:`、`status:` 或 `layer:` token 会转换为结构化状态并从自由文本框移除。已知操作符的非法值保持可编辑并显示行内校验错误；未知的类操作符 token 继续作为普通文本。
- Suggestions are scope-aware and layer-aware. Session scope uses the selected session and current layer; project scope uses every session in the current layer. File and event-kind suggestion counts mean matching event counts, not raw occurrence counts. / 候选同时感知范围与 Layer。Session 范围使用所选 session 和当前层；项目范围使用当前层中的全部 sessions。文件和事件类型候选计数表示匹配事件数，不是原始 occurrence 数。
- Search controls have one canonical rendered action/chip region. The assist owns editors and suggestions but does not render hidden duplicate clear controls; result summaries contain counts and contextual actions only. / 搜索控件只有一个权威渲染的 action/chip 区域。辅助面板负责编辑器和候选，但不渲染隐藏的重复清除控件；结果摘要只包含计数和上下文动作。

### Current-session scope / 当前 session 范围

- The left session list remains the ordinary project session browser and is never filtered by the session-scope query or event filters. Selecting another session retains and reruns the same query and filters. / 左侧 session 列表继续作为普通项目 session 浏览器，绝不能被 session 范围的 query 或事件过滤器筛选。选择另一个 session 时保留并重新执行相同 query 和过滤器。
- Free text is find-in-timeline, not an event filter. The structurally filtered timeline stays continuous; phrase hits are highlighted and navigated with previous/next and Enter/Shift+Enter. / 自由文本是 timeline 内查找，不是事件过滤器。经过结构化过滤的 timeline 保持连续；短语命中会高亮，并可通过上一个/下一个和 Enter/Shift+Enter 导航。
- The jump-target registry contains timeline and Inspector targets only. Session rows, search UI, summaries, folding controls, and Raw refs are never session-find targets. / 跳转目标注册表只包含 timeline 和 Inspector 目标。Session 行、搜索 UI、摘要、折叠控件和 Raw refs 绝不成为 session 查找目标。
- Existing stable descriptor identity, non-shrinking denominator, serialized navigation, transient expansion, persisted-fold priority, committed-context gating, and stale-response rejection remain required. / 现有稳定 descriptor 身份、非递减分母、串行导航、临时展开、持久折叠优先级、已提交上下文门控和过期响应拒绝仍是必须保持的不变量。
- Visible count copy distinguishes `discovered jump targets` from backend full-text occurrences and states that loading or expanding content can increase the target denominator. / 可见计数文案区分“已发现跳转目标”和后端全文 occurrence，并明确加载或展开内容可能增加目标分母。
- After a committed response, an active expression with zero matching events shows a prominent `Search entire project` action. Backend matches that are not yet materialized do not trigger the zero-result action. / 已提交响应后，生效表达式若匹配事件数为零，则显示醒目的“在整个项目搜索”动作。后端仍有命中但尚未物化时，不得显示零结果动作。

### Entire-project scope / 整个项目范围

- Project search evaluates the current layer event by event. Free text and every active structured filter must match the same event before its session can be returned. / 项目搜索在当前 Layer 中逐事件判断。自由文本和所有生效结构化过滤器必须命中同一个事件，该事件所属 session 才能返回。
- An active project expression is free text or at least one of `file`/`kind`/`status`; the layer chip alone does not activate search-result cards. With no active expression, the left pane is the ordinary session browser and the center pane prompts the user to enter a search. / 生效的项目表达式是自由文本或至少一个 `file`/`kind`/`status`；只有 Layer chip 不会激活搜索结果卡。没有生效表达式时，左栏显示普通 session 浏览器，中栏提示用户输入搜索。
- Active project results are session cards showing ordinary session identity, matching event count, and one representative latest-match row containing localized event label, event timestamp, and a highlighted plain-text snippet. / 生效的项目结果以 session 卡片展示，包含普通 session 身份、匹配事件数，以及一条代表性的最新命中行；该行包含本地化事件 label、事件时间和高亮的纯文本 snippet。
- Cards sort by latest matching-event time descending. The summary shows matching session count and total matching event count. Full-text occurrence totals are not a project-card metric. / 卡片按最新匹配事件时间倒序。摘要显示匹配 session 数和匹配事件总数。全文 occurrence 总数不是项目结果卡指标。
- Project scope has no phrase previous/next controls and does not register search targets. Enter commits the latest input and focuses the first result card; Enter on a focused card drills down. / 项目范围没有短语上一个/下一个控件，也不注册搜索目标。在输入框按 Enter 会提交最新输入并聚焦第一张结果卡；在已聚焦卡片上按 Enter 会下钻。
- While project results are visible, the center pane shows the project summary and `Choose a session result` guidance. The previous selected session is retained in state but its timeline and detail are not presented as part of project search. / 项目结果可见时，中栏显示项目摘要和“选择一个 session 结果”引导。之前所选 session 保留在状态中，但其 timeline 和 detail 不作为项目搜索的一部分展示。
- Activating a project result preserves the expression, changes scope explicitly to `session`, loads the card's latest matching event even when it is beyond the initial page, selects it, materializes its first concrete phrase target when query text exists, and exposes a `Back to project results` action. / 激活项目结果时保留表达式，显式切换到 `session` 范围；即使卡片对应的最新匹配事件不在首屏，也要加载并选中它；存在 query 时物化该事件的第一个具体短语目标，并提供“返回项目结果”动作。
- On narrow screens, result activation moves to Events and returning to project results moves to Sessions. / 在窄屏上，激活结果后进入 Events；返回项目结果时进入 Sessions。

## API and state contracts / API 与状态契约

### Project session results / 项目 session 结果

- Keep `GET /api/sessions` as the project-result endpoint. When an active project expression is supplied, evaluate event-level intersection and return additive metadata: / 继续使用 `GET /api/sessions` 作为项目结果端点。当传入生效的项目表达式时，执行事件级交集并返回增量 metadata：

```json
{
  "total": 2,
  "matchingEventTotal": 7,
  "sessions": [
    {
      "id": "session-id",
      "title": "...",
      "searchMatch": {
        "eventCount": 4,
        "latestEvent": {
          "id": "event-id",
          "timestamp": "2026-06-29T10:00:00.000Z",
          "label": "Command",
          "snippet": "...matching text...",
          "timelineIndex": 219
        }
      }
    }
  ]
}
```

- `timelineIndex` is zero-based within the selected layer after structural filters but before free-text filtering. It lets the client load a contiguous timeline prefix and preserve normal pagination/order. / `timelineIndex` 是所选 Layer 应用结构化过滤之后、应用自由文本过滤之前的零基下标。客户端用它加载连续 timeline 前缀，并保持普通分页与顺序。
- With query text, the representative snippet uses the existing phrase-snippet semantics around the first occurrence in the latest matching event. With filters only, use the event preview. All values remain sanitized and localized through existing DTO boundaries. / 存在 query 时，代表性 snippet 使用现有短语摘要语义，截取最新匹配事件中的第一个 occurrence；只有过滤器时使用事件 preview。所有值继续通过现有 DTO 边界进行清理和本地化。
- Add a project-search sort value for latest match descending. Keep existing ordinary session sorts unchanged and preserve their state separately from the project-result default. / 增加按最新命中倒序的项目搜索排序值。现有普通 session 排序保持不变，其状态与项目结果默认排序分开保存。
- New response fields are additive. Existing direct callers without an active project expression continue receiving ordinary session summaries and existing sort behavior. / 新响应字段为增量字段。没有生效项目表达式的现有直接调用方继续获得普通 session 摘要和现有排序行为。

### Timeline and suggestions / Timeline 与候选

- Add `searchEventCount` to `/api/sessions/:id/timeline`: the number of structurally included events whose preview or canonical search text matches `q`. Keep occurrence-level `searchMatchCount` unchanged. / 在 `/api/sessions/:id/timeline` 中增加 `searchEventCount`：结构化结果中 preview 或规范化 search text 命中 `q` 的事件数。Occurrence 级 `searchMatchCount` 保持不变。
- Extend `/api/file-suggestions` with `layer` and optional `sessionId`. Omit `sessionId` for project scope; include it for session scope. Return event-based counts for files touched in the requested boundary. / 扩展 `/api/file-suggestions`，接受 `layer` 和可选 `sessionId`。项目范围省略 `sessionId`，session 范围传入它。对请求边界内触达的文件返回基于事件的计数。
- Use project-level `eventKinds` for project scope and selected-session timeline `eventKinds` for session scope, always selecting the current layer's catalog. / 项目范围使用项目级 `eventKinds`，session 范围使用所选 session timeline 的 `eventKinds`，并始终选择当前 Layer 的 catalog。

### Frontend state boundaries / 前端状态边界

- Introduce authoritative `searchScope`, `searchQuery`, and `searchFilters = { file, kind, status }`; keep `layerId` authoritative for layer. `currentSearchState()` may expose a composed read model but must not reparse the input as canonical state. / 引入权威 `searchScope`、`searchQuery` 和 `searchFilters = { file, kind, status }`；`layerId` 继续作为 Layer 权威状态。`currentSearchState()` 可以暴露组合后的只读模型，但不得再通过重新解析输入框获得权威状态。
- Keep ordinary sessions and project search results in separate collections with separate request generations and committed context keys. Switching scope cannot reinterpret stale rows or targets from the other collection. / 普通 sessions 与项目搜索结果保存在不同集合中，分别具有请求 generation 和已提交 context key。切换范围时不能把另一集合的过期行或目标重新解释为当前状态。
- Session-scope query changes refresh timeline find state only. Session-scope structured-filter changes reload only the selected timeline. Project-scope expression changes reload only project results and never select a result automatically. / Session 范围 query 变化只刷新 timeline 查找状态；session 范围结构化过滤变化只重载所选 timeline。项目范围表达式变化只重载项目结果，绝不能自动选择结果。
- Scope, expression, selected session, layer, profile-rule revision, sort, and locale remain part of the relevant request/target context so stale async work cannot commit after a transition. / 范围、表达式、所选 session、Layer、profile 规则 revision、排序和 locale 继续纳入相关请求/目标 context，防止过期异步工作在状态转换后提交。
- Deep result drill-down loads the continuous prefix through `timelineIndex + 1` in chunks no larger than 500, under one request context. It must stop if scope, query, filters, layer, session, or locale changes. / 深层结果下钻在同一个请求 context 下，以不超过 500 条的 chunk 连续加载到 `timelineIndex + 1`。若范围、query、过滤器、Layer、session 或 locale 变化，必须停止。

## Milestones / 里程碑

### Phase 1: backend search contracts / 第一阶段：后端搜索契约

- [x] Add focused failing tests for event-level project intersection, filter-only results, phrase semantics, layer isolation, aggregate counts, latest-match ordering, snippet selection, and timeline index. / 为事件级项目交集、纯过滤结果、短语语义、Layer 隔离、聚合计数、最新命中排序、snippet 选择和 timeline index 增加聚焦失败测试。
- [x] Refactor session filtering so ordinary session browsing and active project search share sanitization/sorting infrastructure without sharing incompatible match semantics. / 重构 session 过滤，使普通 session 浏览和生效项目搜索共享清理/排序基础设施，但不共享不兼容的匹配语义。
- [x] Implement the additive project result DTO and latest-match sort. / 实现增量项目结果 DTO 和最新命中排序。
- [x] Add `searchEventCount` to timeline responses without changing timeline membership or `searchMatchCount`. / 在不改变 timeline 成员关系或 `searchMatchCount` 的前提下，增加 `searchEventCount`。
- [x] Make file suggestions scope/layer aware with event-based counts. / 让文件候选感知范围/Layer，并使用事件计数。

### Phase 2: authoritative frontend search state / 第二阶段：权威前端搜索状态

- [x] Introduce explicit scope/query/filter state and migrate request builders, context keys, chip rendering, clear actions, layer changes, and `Read from here` off input-string authority. / 引入显式范围/query/filter 状态，并把请求构建、context key、chip 渲染、清除动作、Layer 切换和 `从这里继续阅读` 从输入字符串权威状态迁移出去。
- [x] Preserve typed-operator convenience by converting valid tokens to structured state and surfacing invalid known values without treating them as phrase text. / 保留手输操作符便利性：把合法 token 转为结构化状态，并展示已知非法值，而不是把它们当作短语文本。
- [x] Split ordinary session and project-result collections, requests, rendering, and committed context. / 拆分普通 session 与项目结果的集合、请求、渲染和已提交 context。
- [x] Add the visible scope control, persistent layer/filter chips, scope-aware placeholders and suggestions, and one canonical clear-action region in English and Simplified Chinese. / 增加显式范围控件、常驻 Layer/过滤 chip、范围感知 placeholder 与候选，以及中英文单一权威清除 action 区域。

### Phase 3: session-scope convergence / 第三阶段：Session 范围收敛

- [x] Stop session-scope filters from reloading or filtering the left session list; keep session selection stable and preserve the expression when selecting another session. / 阻止 session 范围过滤器重载或筛选左侧 session 列表；保持 session 选择稳定，并在选择另一个 session 时保留表达式。
- [x] Restrict descriptor discovery and navigation to timeline and Inspector owners while preserving all stable-registry and serialized-materialization guarantees. / 将 descriptor 发现与导航限制在 timeline 和 Inspector owner，同时保持稳定注册表与串行物化的全部保证。
- [x] Add committed zero-result detection using `searchEventCount` and the one-click project fallback; do not confuse zero live marks with zero backend hits. / 使用 `searchEventCount` 增加已提交零结果检测和一键项目回退；不能把零实时 mark 误认为零后端命中。
- [x] Update visible jump-target wording and responsive layout without reintroducing count truncation or input hit-testing regressions. / 更新可见跳转目标文案和响应式布局，不得重新引入计数截断或输入框点击命中回归。

### Phase 4: project results and drill-down / 第四阶段：项目结果与下钻

- [x] Render project result cards, aggregate summary, empty-expression browsing state, zero-results state, and center guidance without rendering a stale selected timeline. / 渲染项目结果卡、聚合摘要、空表达式浏览状态、零结果状态和中栏引导，不得渲染过期的所选 timeline。
- [x] Implement project keyboard behavior: Enter commits/focuses the first card; card activation drills down; project scope has no previous/next target navigation. / 实现项目键盘行为：Enter 提交并聚焦第一张卡；激活卡片执行下钻；项目范围没有上一个/下一个目标导航。
- [x] Implement deep latest-event loading, selection, expansion/highlighting, back-to-results state, and narrow-screen view transitions under stale-context guards. / 在过期 context guard 下实现深层最新事件加载、选择、展开/高亮、返回结果状态和窄屏视图转换。
- [x] Verify project result text and chips never enter the session jump-target registry. / 验证项目结果文本与 chips 绝不进入 session 跳转目标注册表。

### Phase 5: documentation and completion / 第五阶段：文档与完成

- [x] Update the bilingual product spec with the two-scope user contract, counts, empty states, keyboard behavior, drill-down, clear semantics, and acceptance criteria. / 更新双语产品规格，写入双范围用户契约、计数、空状态、键盘行为、下钻、清除语义和验收标准。
- [x] Reconcile the bilingual design doc with authoritative search state, event-level project matching, API DTOs, request contexts, descriptor boundaries, and deep drill-down data flow. / 更新双语设计文档，使其与权威搜索状态、事件级项目匹配、API DTO、请求 context、descriptor 边界和深层下钻数据流一致。
- [x] Rebuild generated client assets and run every validation gate. / 重新构建生成的客户端资产并运行全部验证门禁。
- [x] Perform final browser acceptance in English and Simplified Chinese at desktop and narrow widths; restart the local server when needed for user acceptance. / 在桌面和窄屏宽度下，以英文和简体中文执行最终浏览器验收；需要用户验收时重启本地服务器。
- [x] Move this plan to `completed/` and update `AGENTS.md` only after implementation, docs, generated assets, focused/full tests, and browser acceptance are complete. / 只有实现、文档、生成资产、聚焦/全量测试和浏览器验收全部完成后，才将本计划移动到 `completed/` 并更新 `AGENTS.md`。

## Verification / 验证

### Unit and API coverage / 单元与 API 覆盖

- Project query and every structured filter must match the same event; separate-event matches must be rejected. / 项目 query 与每个结构化过滤器必须命中同一事件；分散在不同事件的命中必须拒绝。
- Query-only, filter-only, query-plus-filter, every layer, no-result, and multiple-session fixtures produce correct session/event totals. / 纯 query、纯过滤器、query 加过滤器、每个 Layer、零结果和多 session fixture 都产生正确的 session/event 总数。
- Latest-event selection, localized label, snippet, timeline index, and latest-match order remain deterministic. / 最新事件选择、本地化 label、snippet、timeline index 和最新命中顺序保持确定性。
- `searchEventCount` counts matching events while `searchMatchCount` continues counting non-overlapping occurrences. / `searchEventCount` 统计匹配事件，而 `searchMatchCount` 继续统计非重叠 occurrence。
- Scope-aware file/kind suggestions use the requested layer and event-count semantics. / 范围感知的文件/kind 候选使用请求的 Layer 和事件计数语义。
- Search-query helpers cover valid conversion, quoted file values, last-value replacement, invalid known values, and unknown literal tokens. / 搜索 query helper 覆盖合法转换、带引号文件值、后值替换、已知非法值和未知字面 token。

### Browser coverage / 浏览器覆盖

- A fresh selected session starts in explicit session scope with a visible current-layer chip. No-session state uses project scope. / 新鲜的已选 session 从显式 session 范围开始并显示当前 Layer chip；无 session 状态使用项目范围。
- Session typing refreshes the timeline without session-list requests or selection loss; session filters reload only the timeline. / Session 范围输入只刷新 timeline，不发起 session 列表请求也不丢失选择；session 过滤只重载 timeline。
- Switching sessions preserves expression state and correctly reruns zero/nonzero match state. / 切换 sessions 时保留表达式状态，并正确重新执行零/非零命中状态。
- Zero-match project fallback appears only after a committed zero matching-event count; unmaterialized backend hits keep navigation available and do not show the fallback. / 项目回退只在已提交匹配事件数为零后出现；未物化后端命中继续允许导航且不显示回退。
- Project cards show correct counts/latest snippets/order; summary totals agree with cards; center timeline/detail are absent. / 项目卡显示正确计数/最新 snippet/顺序；摘要总数与卡片一致；中栏 timeline/detail 不出现。
- Empty project expression restores ordinary session rows; active filters alone produce valid result cards. / 空项目表达式恢复普通 session 行；只有生效过滤器也能产生合法结果卡。
- Project Enter focuses the first card; card Enter/click drills down to the same latest event; returning restores the project result set and focus context. / 项目 Enter 聚焦第一张卡；卡片 Enter/点击下钻到同一最新事件；返回后恢复项目结果集和焦点 context。
- A latest event beyond initial pagination is loaded through a contiguous prefix, selected, expanded when allowed, and highlighted without stale requests committing. / 首屏分页之外的最新事件通过连续前缀加载、被选中、在允许时展开并高亮，且过期请求不能提交。
- Session target IDs and denominators exclude session rows and project cards while retaining non-decreasing materialization, inspector reacquisition, persisted-fold skips, and serialized rapid navigation. / Session 目标 ID 与分母排除 session 行和项目卡，同时保持非递减物化、Inspector 重获、持久折叠跳过和快速导航串行化。
- Typed operators convert to chips; `Clear all` preserves scope/layer; the assist and summary expose exactly one accessible clear action and no duplicate action nodes. / 手输操作符转换为 chips；`全部清除`保留范围/Layer；辅助面板和摘要只暴露一个可访问清除动作，且不存在重复 action 节点。
- English and Simplified Chinese copy, focus order, ARIA names, responsive control layout, and mobile Sessions/Events transitions remain usable. / 中英文文案、焦点顺序、ARIA 名称、响应式控件布局和移动端 Sessions/Events 转换保持可用。
- Delayed project, timeline, suggestion, locale, scope, layer, profile, and session transitions cannot commit stale results or targets. / 延迟的项目、timeline、候选、locale、范围、Layer、profile 和 session 转换不能提交过期结果或目标。

### Full gates / 全量门禁

- [x] `npm run build`
- [x] `npm run build:check`
- [x] `npm test`
- [x] `npm run test:browser`
- [x] `npm run test:package`
- [x] `git diff --check`

## Risks and guardrails / 风险与护栏

- The current search implementation is concentrated in `src/browser/app.js`; do not replace one implicit DOM-derived state model with another set of loosely coupled booleans. Keep scope/query/filter transitions centralized and test them through observable requests and committed views. / 当前搜索实现集中在 `src/browser/app.js`；不要用另一组松散布尔值替换隐式 DOM 派生状态。范围/query/filter 转换必须集中，并通过可观察请求和已提交视图进行测试。
- Project matching scans indexed events in memory. Keep the current no-pagination assumption for this project size, but avoid repeated detail construction or raw-row decoding during each keystroke. Use indexed logical/raw DTO fields already available to filtering. / 项目匹配会扫描内存中的索引事件。按当前项目规模保持无分页假设，但避免每次按键都重复构建 detail 或解码 raw row；使用过滤流程已有的索引 logical/raw DTO 字段。
- Do not introduce fuzzy search, relevance scoring, cross-session previous/next, URL persistence, or a second independent layer state. / 不引入模糊搜索、相关度评分、跨 session 上一个/下一个、URL 持久化或第二份独立 Layer 状态。
- Existing non-search session browsing, folding profiles, detail provenance, Raw refs, reading anchors, pagination, localization, package boundaries, and project selection remain compatibility requirements. / 现有非搜索 session 浏览、折叠 profile、detail 来源、Raw refs、阅读锚点、分页、本地化、package 边界和项目选择仍是兼容性要求。
- If implementation reveals a new product decision rather than a code-level detail, stop and record the unresolved branch instead of silently choosing a third search model. / 如果实现过程中出现新的产品决策而非代码层细节，应停止并记录未解决分支，而不是静默选择第三种搜索模型。

## Goal execution contract / Goal 执行契约

This plan is suitable for one durable `/goal`, with the phases above used as checkpoints rather than separate goals. The objective is the complete two-scope convergence, not merely an API or UI subset. Each checkpoint should record changed behavior, focused validation, and remaining work in the progress log. The goal must not be marked complete until every checkbox in Phase 5 and Full gates is complete. / 本计划适合用一个长期 `/goal` 推进，以上阶段作为 checkpoints，而不是拆成多个 goals。目标是完整的双范围收敛，而不只是 API 或 UI 子集。每个 checkpoint 都应在进度日志中记录行为变化、聚焦验证和剩余工作。在第五阶段和全量门禁中的每个复选框完成前，不得把 goal 标记为完成。

Recommended objective / 推荐 objective：

> Implement `docs/exec-plans/active/2026-06-29-search-scope-mental-model-convergence.md` completely. Work phase by phase, preserve the stated compatibility boundaries, update the bilingual contracts and generated assets, and stop only after every focused/full validation gate passes and the finished plan is archived. Pause for user direction if a new product decision is required. / 完整实施 `docs/exec-plans/active/2026-06-29-search-scope-mental-model-convergence.md`。按阶段推进，保持计划规定的兼容边界，更新双语契约和生成资产；只有所有聚焦/全量验证门禁通过且完成计划已归档后才停止。若需要新的产品决策，则暂停并请求用户指示。

## Progress / 进度

- 2026-06-29: Reviewed browser findings and current product/design/code contracts. Confirmed that one input mixes selected-session find, project-wide structured filtering, and cross-surface navigation. / 2026-06-29：审阅浏览器发现以及当前产品/设计/代码契约，确认同一个输入框混合了所选 session 查找、项目级结构化过滤和跨界面导航。
- 2026-06-29: Completed a grill-style product interview and fixed the two-scope model, default scope, explicit switch, result-card shape, event-level intersection, counts, ordering, drill-down, layer/filter/query persistence, suggestions, clear semantics, keyboard behavior, and completion gates. / 2026-06-29：完成 grill 风格产品访谈，确定双范围模型、默认范围、显式切换、结果卡形态、事件级交集、计数、排序、下钻、Layer/过滤器/query 保留、候选、清除语义、键盘行为和完成门禁。
- 2026-06-29: Opened this active exec plan and updated the repository plan index. No runtime implementation has started. / 2026-06-29：新建本 active exec plan 并更新仓库计划索引。尚未开始运行时代码实现。
- 2026-06-29: Checkpoint 1 complete. Extracted the pure `src/codex-search.js` boundary; implemented event-level project intersection, additive latest-match result metadata and totals, `searchEventCount`, and scope/layer-aware event-count file suggestions. Focused backend, boundary, compatibility, and package tests passed (`78/78`). Independent read-only review reported no blocking findings; its non-blocking test-specificity findings were resolved by adding combined-filter, canonical-search-text, HTTP timeline-count, exact zh-CN label, and DTO sanitization assertions. Remaining work starts with authoritative frontend search state. / 2026-06-29：Checkpoint 1 已完成。抽取纯 `src/codex-search.js` 边界；实现事件级项目交集、增量 latest-match 结果 metadata 与总计、`searchEventCount`，以及感知 scope/Layer 且按事件计数的文件候选。后端、边界、兼容性和 package 聚焦测试通过（`78/78`）。独立只读审查未发现 blocking finding；其测试精度类 non-blocking finding 已通过补充组合过滤器、仅规范搜索文本命中、HTTP timeline 计数、精确 zh-CN label 和 DTO 清理断言解决。剩余工作从权威前端搜索状态开始。
- 2026-06-29: Checkpoint 2 implementation ready for review. Added authoritative `searchScope`, `searchQuery`, and `searchFilters` state; split ordinary-session, project-result, timeline, and suggestion generations/contexts; stopped session expressions from reloading the ordinary session collection; converted valid typed operators into state while retaining known invalid operators as editable validation and unknown operators as literal phrase text; made Layer a persistent non-removable context chip; and moved clear actions into one canonical region while preserving Layer and scope. Focused query/i18n tests (`18/18`) and all browser test groups affected by the state migration passed, including the new no-session-list-request assertion. The visible scope switch, project-card rendering, and drill-down remain for Checkpoint 3. / 2026-06-29：Checkpoint 2 实现已准备审查。增加权威 `searchScope`、`searchQuery` 和 `searchFilters` 状态；拆分普通 session、项目结果、timeline 和候选的 generation/context；阻止 session 表达式重载普通 session 集合；把合法手输操作符转入状态，同时把已知非法操作符保留为可编辑校验、把未知操作符保留为字面 phrase；让 Layer 成为常驻且不可移除的上下文 chip；并把清除 action 移入唯一权威区域，同时保留 Layer 与 scope。聚焦 query/i18n 测试（`18/18`）以及受状态迁移影响的全部浏览器测试组均通过，包括新增的不发 session-list 请求断言。显式 scope switch、项目卡渲染和下钻留给 Checkpoint 3。
- 2026-06-29: Checkpoint 2 complete after independent read-only review. The reviewer found one blocking transition bug: assist/Layer/`Read from here` structural changes did not synchronize `searchStructureKey`, so the next query-only edit could reset the loaded prefix. The fix synchronizes every non-input transition and adds an assist-filter → 180 loaded events → query-only regression that proves `limit=180` and no session-list request. Re-review confirmed the blocking issue resolved with no new blocking findings. The reviewer’s profile-context and invalid-token lifecycle non-blocking findings were also resolved by separating API data context from profile/sort render context and clearing corrected operator validation. / 2026-06-29：Checkpoint 2 在独立只读审查后完成。Reviewer 发现一个 blocking transition bug：assist/Layer/`从这里继续阅读` 的结构状态变更未同步 `searchStructureKey`，导致下一次纯 query 编辑可能重置已加载前缀。修复会同步所有非输入 transition，并新增 assist filter → 已加载 180 个事件 → 纯 query 回归，证明请求使用 `limit=180` 且不发 session-list 请求。复审确认 blocking 已解决且无新增 blocking finding。Reviewer 提出的 profile context 与非法 token 生命周期 non-blocking finding 也已通过分离 API data context 与 profile/sort 渲染 context、清理已纠正 operator 的校验状态而解决。
- 2026-06-30: Checkpoint 3 implementation ready for final re-review after blocking reviewer follow-ups. Added the visible current-session/project scope control, scope-aware placeholders and event-kind labels, project-result card rendering, aggregate project summaries, empty/zero-result project center states, one-click session zero-result fallback, project Enter/card activation behavior, deep latest-event drill-down with contiguous prefix loading, and a back-to-project-results path that works on narrow screens. Session-scope target discovery remains limited to timeline and Inspector owners; project cards use separate highlight markup and never register jump targets. Reviewer blocking follow-ups were addressed by invalidating stale selected-session analysis while returning to project results, removing folding profile state from the project-result data context, and keeping folding profile UI refreshes from repopulating the detail pane in project scope. Rebuilt `public/assets/app.js`. Validation passed: `npm run build`, `npm run build:check`, `node --check src\browser\app.js`, `npm test` (`166/166`), `npm run test:browser` (`42/42`), `npm run test:package` (rerun outside sandbox because the smoke install needs registry access), and `git diff --check`. / 2026-06-30：Checkpoint 3 在处理审查阻塞项后已准备最终复审。增加显式当前 session/整个项目范围控件、范围感知 placeholder 和事件类型标签、项目结果卡、项目聚合摘要、项目空表达式/零结果中栏状态、session 零结果一键项目回退、项目范围 Enter/卡片激活行为、通过连续前缀加载的深层最新事件下钻，以及在窄屏可用的返回项目结果路径。Session 范围目标发现继续限制在 timeline 和 Inspector owner；项目卡使用独立高亮标记，绝不注册为跳转目标。已处理审查阻塞项：返回项目结果时阻断过期 selected-session analysis、从项目结果数据 context 中移除 folding profile 状态，并阻止 folding profile UI 刷新在项目范围内重新填充详情栏。已重新构建 `public/assets/app.js`。验证通过：`npm run build`、`npm run build:check`、`node --check src\browser\app.js`、`npm test`（`166/166`）、`npm run test:browser`（`42/42`）、`npm run test:package`（因 smoke install 需要 registry 访问，在 sandbox 外复跑）、`git diff --check`。
- 2026-06-30: Checkpoint 3 complete after independent read-only re-review. The reviewer confirmed the stale analysis, project data context, and project-scope profile/detail blockers are resolved, with no remaining blocking findings and no non-blocking notes. / 2026-06-30：Checkpoint 3 经独立只读复审后完成。Reviewer 确认过期 analysis、项目数据 context、以及项目范围 profile/detail 阻塞项均已解决，没有剩余 blocking finding，也没有 non-blocking note。
- 2026-06-30: Final completion checkpoint passed. Updated bilingual product and design docs, rebuilt generated assets, passed full gates (`npm run build`, `npm run build:check`, `npm test` `166/166`, `npm run test:browser` `42/42`, `npm run test:package`, and `git diff --check`), and performed browser acceptance against the served app in English and Simplified Chinese at 1365×900 and 390×820. / 2026-06-30：最终完成 checkpoint 已通过。已更新双语产品与设计文档，重新构建生成资产，通过全量门禁（`npm run build`、`npm run build:check`、`npm test` `166/166`、`npm run test:browser` `42/42`、`npm run test:package` 和 `git diff --check`），并在已启动应用上完成英文和简体中文、1365×900 与 390×820 的浏览器验收。
