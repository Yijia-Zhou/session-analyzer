# Timeline Loading and Rendering Performance / 时间线加载与渲染性能

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: proposed / 状态：提议中
- Last updated: 2026-07-22 / 最近更新：2026-07-22
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design docs: / 相关设计文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/code-mode-operations.md`
  - `docs/design-docs/documentation-system.md`
- Related plans: / 相关计划：
  - `docs/exec-plans/completed/2026-07-20-timeline-transition-safety-and-profiling.md`
  - `docs/exec-plans/completed/2026-07-12-search-jump-target-canonicalization.md`
  - `docs/exec-plans/completed/2026-07-06-search-hud-integration.md`
  - `docs/exec-plans/completed/2026-07-22-code-mode-context-and-discoverability.md`

## Context / 背景

Long Session Transcripts expose an interactive-performance problem after the browser has materialized a deep prefix of the selected Session. Jumping to a late search target, editing free text, changing structured filters, changing Event Layer, or switching Session can keep the main thread continuously busy for several seconds. The application has not shown a reproducible permanent deadlock; the user-visible “freeze” is main-thread starvation that delays input handling and paint. / 较长的会话转录会在浏览器已物化所选会话的较深前缀后暴露交互性能问题。跳到靠后的搜索目标、修改自由文本、改变结构化筛选、切换事件层或切换会话，都可能让主线程连续忙碌数秒。当前没有稳定复现永久死锁；用户看到的“卡死”是主线程饥饿，它会延迟输入处理与绘制。

The problem is primarily in the shared timeline loading and rendering path rather than in network latency or repeated JSONL parsing. Search is the strongest amplifier because it can load many pages, expand hit owners, rebuild highlights, and navigate into detail, but the same timeline state and renderer are also used by ordinary paging, folding, project-result drill-down, focus restoration, and Inspector navigation. / 问题主要位于共享的时间线加载与渲染路径，而不是网络延迟或重复解析 JSONL。搜索之所以成为最强放大器，是因为它可以加载许多分页、展开命中 owner、重建高亮并导航到详情；但普通分页、折叠、项目结果下钻、焦点恢复和检查器导航也共用同一份时间线状态与 renderer。

### Profiling baseline / Profiling 基线

The 2026-07-17 baseline used a temporary synthetic transcript that was automatically removed after profiling: 1,800 Main Timeline Logical Events, about 3.7 KiB of searchable text per event, and a hit near event 1,650. Chromium CDP metrics, Long Tasks, and Resource Timing showed: / 2026-07-17 基线使用了 profiling 后自动移除的临时合成转录：1,800 个主时间线逻辑事件、每个事件约 3.7 KiB 可搜索文本，并在约第 1,650 个事件处放置命中。Chromium CDP 指标、Long Task 与 Resource Timing 显示：

| Interaction / 交互 | End-to-end / 端到端 | Main thread / 主线程 | Timeline network / 时间线网络 |
| --- | ---: | ---: | ---: |
| Search and bounded preload to 600 events / 搜索并有限预加载至 600 个事件 | 1.73 s | 1.45 s Long Tasks | Not dominant / 非主因 |
| Jump to the hit near event 1,650 / 跳到约第 1,650 个事件处的命中 | 8.22 s | 8.17 s Long Tasks; longest 1.40 s / Long Task 8.17 s；最长 1.40 s | Eight `/timeline` requests total about 0.33 s / 8 次请求合计约 0.33 s |
| Edit query, then immediately switch Session / 修改 query 后立即切换会话 | 6.30 s | 5.52 s main task / 主任务 5.52 s | Five requests total about 0.71 s / 5 次请求合计约 0.71 s |
| Change a filter from a deep position with a common term / 深位置下以常见词压力场景改变筛选 | 12.35 s | 12.23 s Long Tasks; longest 1.79 s / Long Task 12.23 s；最长 1.79 s | Two measured requests about 0.21 s / 两次已测请求约 0.21 s |

The baseline establishes priority, not a permanent benchmark contract. Future implementation plans should preserve the fixture shape and record comparable browser, request, DOM, and Long Task measurements. / 该基线用于确定优先级，不是永久的 benchmark contract。后续实现计划应保留 fixture 形态，并记录可比较的浏览器、请求、DOM 与 Long Task 测量。

## Goals and constraints / 目标与约束

- Describe the current end-to-end lifetime of indexed events, timeline DTOs, detail DTOs, browser data, and DOM nodes. / 描述已索引事件、时间线 DTO、详情 DTO、浏览器数据与 DOM 节点当前的端到端生命周期。
- Identify every consumer that depends on the current contiguous-prefix timeline model. / 识别依赖当前时间线连续前缀模型的全部消费者。
- Separate local performance protections from changes that alter the core loading or rendering model. / 区分局部性能保护与会改变核心加载或渲染模型的改动。
- Preserve current user-visible search, counting, folding, selection, detail, project drill-down, and Layer contracts unless a later product decision changes them explicitly. / 保留当前用户可见的搜索、计数、折叠、选择、详情、项目下钻与事件层 contract，除非后续产品决策明确改变它们。
- Prefer incremental responsibility boundaries and measurable stages over a broad rewrite. / 优先采用渐进式职责边界和可测量阶段，而不是大范围重写。

## Non-goals / 非目标

- Redesigning Logical Event normalization or Event Layer membership. / 重新设计逻辑事件归一化或事件层成员关系。
- Optimizing cold project indexing before evidence shows it dominates the affected interactions. / 在证据表明冷项目索引主导相关交互前优化它。
- Replacing all event-specific structured renderers. / 替换所有事件专属的结构化 renderer。
- Committing now to full virtualization, sparse timeline loading, or an exact global jump-target denominator. / 现在就承诺完整虚拟化、稀疏时间线加载或精确的全局跳转目标分母。
- Treating page size as a server-side performance boundary when the server still scans the full selected corpus. / 在服务端仍扫描完整所选语料时，把 page size 当作服务端性能边界。

## Current architecture / 当前架构

### Lifecycle layers / 生命周期层

```text
Project selection / 项目选择
  -> buildIndex: JSONL -> rawEvents -> logicalEvents (retained in memory)
  -> /timeline: choose Layer -> structural scan -> text counts -> slice -> DTO page
  -> browser currentEvents: contiguous committed prefix [0, offset)
  -> renderTimeline: all materialized events -> one timeline innerHTML replacement
       -> visible expanded detail requests -> detail cache -> renderTimeline again
       -> canonical search-target discovery -> DOM mark bindings
       -> clear and reapply timeline/Inspector highlighting
```

#### 1. Project index lifetime / 项目索引生命周期

`buildIndex` pre-scans transcript metadata to select repository candidates, parses each selected JSONL file once, retains `rawEvents`, builds `logicalEvents` once, and stores Sessions in an in-memory index. Search and timeline requests reuse that index and do not reparse the transcript files. Cancelling a new project-index job can stop index construction, while an already committed index remains available. / `buildIndex` 会预扫描转录 metadata 以选择仓库候选文件，对每个选中的 JSONL 文件解析一次，保留 `rawEvents`，构建一次 `logicalEvents`，并把会话存入内存索引。搜索和时间线请求复用该索引，不会重新解析转录文件。取消新的项目索引 job 可以停止索引构建，同时已提交的旧索引继续可用。

This lifetime is memory-heavy but is not the cause of the measured interaction freeze. It remains relevant to cache invalidation because every timeline/search cache must be scoped to a particular committed index revision. / 该生命周期占用较多内存，但不是已测交互卡顿的原因。它仍与缓存失效有关，因为任何时间线/搜索缓存都必须绑定到特定的已提交索引 revision。

#### 2. Timeline request lifetime / 时间线请求生命周期

`GET /api/sessions/:sessionId/timeline` accepts `offset`, `limit`, `layer`, `q`, `kind`, `status`, `tool`, `file`, and `locale`. For Main Timeline and Protocol Layer requests, `sourceEventsForLayer` selects the retained Logical Events. For Raw Layer requests, it first maps every Raw Record to a raw DTO. `getTimeline` then: / `GET /api/sessions/:sessionId/timeline` 接收 `offset`、`limit`、`layer`、`q`、`kind`、`status`、`tool`、`file` 与 `locale`。对主时间线和协议层请求，`sourceEventsForLayer` 从常驻逻辑事件中选择；对原始层请求，它会先把每条原始记录映射成 raw DTO。随后 `getTimeline` 会：

1. Apply Layer and structured filters to the full selected event sequence. / 对完整的所选事件序列应用事件层与结构化筛选。
2. Calculate full-corpus phrase occurrence and matching-event counts when `q` is active. / 当 `q` 生效时，计算完整语料范围的短语 occurrence 与命中事件数。
3. Slice the filtered sequence by `offset` and `limit`. / 按 `offset` 与 `limit` 切分筛选后的序列。
4. Map the page to timeline DTOs. / 把该页映射为时间线 DTO。
5. Recalculate the selected Session's complete event-kind catalog for the response. / 为响应重新计算所选会话的完整事件类型 catalog。

The page size bounds response size and page DTO mapping, but it does not bound structural filtering, text counting, Raw Layer DTO creation, or event-kind catalog work. / Page size 会限制响应体和分页 DTO 映射，但不会限制结构筛选、文本计数、原始层 DTO 创建或事件类型 catalog 的工作量。

For a non-empty logical response, public DTO composition may build a request-scoped reverse map for Code Mode presentation context. It performs one linear pass over the retained Session logical events and their existing `eventRefs`, records only uniquely proven `code_mode_operation` parents, and attaches an optional context only to matching DTOs on the requested page or layer-aware event envelope. The transient map is not retained in the canonical index, does not run for raw DTOs, and creates no additional timeline membership, target, count, or pagination work. Its cost is intentionally an explicit `O(E + R)` response-projection boundary, where `E` is Session logical-event count and `R` is the total examined `eventRefs` entries.

对于非空的逻辑响应，公开 DTO 组成可以为 Code Mode 呈现上下文构建一个请求范围的反向映射。它会对已保留的 Session 逻辑事件及其既有 `eventRefs` 做一次线性遍历，只记录唯一已证明的 `code_mode_operation` 父操作，并且只把可选上下文附加到请求页面或感知事件层 event envelope 中匹配的 DTO。该临时映射不会保留在规范索引中，不会用于 raw DTO，也不会产生额外时间线成员、目标、计数或分页工作。其成本有意作为显式的 `O(E + R)` 响应投影边界，其中 `E` 是 Session 逻辑事件数，`R` 是检查过的 `eventRefs` 条目总数。

#### 3. Detail request lifetime / 详情请求生命周期

Timeline DTOs contain stable identity, presentation metadata, previews, hit state, and traceability fields but not the full structured body. Expanded or selected cards request `GET /api/sessions/:sessionId/events/:eventId/detail?layer=...`. The server finds the retained event, resolves supporting Raw Records, builds timeline and Inspector sections, sanitizes the result, and returns a detail DTO. / 时间线 DTO 包含稳定 identity、展示 metadata、preview、命中状态与可追溯字段，但不包含完整结构化正文。展开或选中的卡片会请求 `GET /api/sessions/:sessionId/events/:eventId/detail?layer=...`。服务端查找常驻事件、解析其依据的原始记录、构建时间线与检查器 section、清洗结果并返回 detail DTO。

The browser caches detail by `(sessionId, layer, eventId)` and invalidates the whole cache generation when the Session, repository, or locale changes. Visible expanded events, plus visible Code Mode Operations that need presentation refinement, can trigger detail loading. Detail completion currently calls the full timeline renderer rather than updating only the owning card. / 浏览器按 `(sessionId, layer, eventId)` 缓存详情，并在会话、仓库或 locale 变化时让整个 cache generation 失效。可见的展开事件，以及需要细化 presentation 的可见 Code Mode 操作，可以触发详情加载。详情完成后当前会调用完整时间线 renderer，而不是只更新所属卡片。

Raw References use a separate evidence path: the browser requests each referenced source row from `/api/raw` rather than reusing the structured detail DTO. Event-reference navigation first resolves an event envelope through `/events/:eventId`, which is Layer-aware but independent of the active timeline filters, and may temporarily reveal that event without changing filtered membership. / 原始引用使用独立的证据路径：浏览器会从 `/api/raw` 请求每条引用的来源记录，而不是复用结构化详情 DTO。事件引用导航会先通过 `/events/:eventId` 解析事件 envelope；该端点感知事件层但独立于当前时间线筛选，并且可以临时展示该事件而不改变筛选成员关系。

#### 4. Browser materialization and DOM lifetime / 浏览器物化与 DOM 生命周期

The browser currently uses one data array and one numeric cursor for the committed selected timeline: / 浏览器当前使用一个数据数组和一个数字 cursor 表示已提交的所选时间线：

```text
currentEvents = filteredTimeline[0:offset]
offset = currentEvents.length
0 <= offset <= timelineTotal
```

Normal paging appends the next page to this contiguous prefix. Query refresh refetches a prefix at least as deep as the currently loaded count. Project-result drill-down refetches from offset zero through the latest matching event's filtered timeline index. `ensureEventLoaded` appends pages until a requested owner enters the prefix. / 普通分页会把下一页追加到该连续前缀。Query 刷新会重新请求至少与当前已加载数量一样深的前缀。项目结果下钻会从 offset 零重新请求，直到覆盖最新命中事件在筛选后时间线中的 index。`ensureEventLoaded` 会持续追加分页，直到请求的 owner 进入前缀。

Append currently concatenates pages without client-side overlap or duplicate-ID validation. Offset pagination has no snapshot or stability token, so correctness relies on the committed in-memory index and filtered ordering remaining immutable for the request sequence. A future cursor, live index refresh, or sparse loader must make this assumption explicit instead of silently mixing paging models. / 当前追加会直接拼接分页，没有客户端 overlap 或重复 ID 验证。Offset 分页没有 snapshot 或稳定性 token，因此正确性依赖已提交内存索引与筛选顺序在整段请求期间保持不可变。未来 cursor、实时索引刷新或稀疏 loader 必须显式处理该假设，不能静默混合分页模型。

`renderTimeline` maps the entire materialized sequence to HTML strings and replaces `timeline.innerHTML`. It then stamps the committed search surface, schedules visible-detail loading, clears timeline and Inspector marks, discovers canonical search targets from `currentEvents`, reapplies text highlighting, and binds the new marks to target descriptors. Events hidden by a Folding Strategy generally remain mounted with a hidden class; one temporary referenced event may additionally be inserted outside the committed prefix for event-reference navigation. / `renderTimeline` 会把整个已物化序列映射为 HTML 字符串，并替换 `timeline.innerHTML`。随后它会标记已提交搜索 surface、安排可见详情加载、清除时间线和检查器 mark、从 `currentEvents` 发现 canonical 搜索目标、重新应用文本高亮，并把新 mark 绑定到 target descriptor。被折叠策略隐藏的事件通常仍以隐藏 class 挂载；事件引用导航还可以在已提交前缀之外额外插入一个临时引用事件。

### Browser state and invalidation boundaries / 浏览器状态与失效边界

| State / 状态 | Current responsibility / 当前职责 | Important coupling / 重要耦合 |
| --- | --- | --- |
| `currentEvents`, `offset`, `timelineTotal` | Materialized contiguous filtered prefix and total / 已物化的连续筛选前缀与总数 | Paging, loaded count, search discovery, target materialization, focus restore / 分页、已加载计数、搜索发现、目标物化、焦点恢复 |
| `timelineDataContext` | Committed repository, scope, Session, Layer, query, filters, and locale / 已提交的仓库、范围、会话、事件层、query、筛选与 locale | Rejects stale data and gates target discovery / 拒绝过期数据并门控 target 发现 |
| `timelineRequestId`, `timelineLoading` | Latest-wins commit generation and one append-in-flight guard / 最新请求提交 generation 与单个 append 在途保护 | The timeline request owner best-effort aborts the superseded browser fetch; request ID and context still reject stale commits, while synchronous server work may continue / timeline 请求 owner 会尽力取消被取代的浏览器 fetch；request ID 与 context 仍负责拒绝过期提交，而同步服务端工作可能继续 |
| `detailCache`, `detailPending`, `detailCacheGeneration` | Per-event structured detail and stale-generation rejection / 逐事件结构化详情与过期 generation 拒绝 | Detail arrival redraws the whole timeline / 详情到达会重绘整段时间线 |
| `navigationCache` | Complete filtered event sequence for confirmed Inspector navigation / 用户确认的检查器导航所需完整筛选事件序列 | Independently refetches all `/timeline` pages in chunks of 500 / 以 500 条为 chunk 独立重取全部 `/timeline` 分页 |
| `searchTargetRegistry` | Semantic event-anchor descriptors and active identity / 语义事件锚 descriptor 与活动 identity | Descriptors survive redraw; live DOM bindings do not / Descriptor 跨重绘保留；实时 DOM binding 不保留 |
| `searchHighlight.marks` | Current disposable timeline/Inspector occurrence nodes / 当前可丢弃的时间线/检查器 occurrence 节点 | Cleared and rebuilt after every full render / 每次完整 render 后清除并重建 |
| `temporaryEventReveal` | One out-of-prefix event-reference presentation / 一个前缀外的事件引用展示 | Must not mutate filtered totals or prefix semantics / 不得改变筛选总数或前缀语义 |
| `codeModeContextRows`, `codeModeContextRequest` | Owner-scoped, presentation-only enclosing-operation rows and their generation/abort controller / owner 范围、只用于呈现的 enclosing-operation 行及其 generation/abort controller | Resolves a hidden, unloaded, or structurally excluded parent through envelope/detail without entering `currentEvents`; every row must clear with its committed context and never become ordinary event/search-owner DOM / 通过 envelope/detail 解析隐藏、未加载或结构化排除的父操作，但不进入 `currentEvents`；每条行都必须随其已提交 context 清除，且绝不成为普通事件/搜索 owner DOM |
| Folding Strategy plus per-event overrides | Computes `hidden`, `collapsed`, `summary`, or `expanded` presentation / 计算 `hidden`、`collapsed`、`summary` 或 `expanded` 展示 | Profile and draft edits currently cause full render / 策略与草稿编辑当前会触发完整 render |

Context keys and request generations protect correctness at commit time. They prevent an old query, Session, Layer, locale, or Folding Strategy surface from contributing targets after a newer context commits. The Code Mode context owner is keyed more narrowly by that committed context plus nested/parent IDs; its success, error, and `finally` paths also require current owner identity, and its rows clear on repository, scope, Session, Layer, query/filter, Folding Strategy, locale, selected detail/view, or detail-cache-generation transitions. Request owners additionally make a best-effort attempt to abort superseded browser fetches, but they do not guarantee that synchronous server or main-thread work stops before producing work that will later be discarded. / Context key 与请求 generation 会在提交时保护正确性，防止旧 query、会话、事件层、locale 或折叠策略 surface 在新 context 提交后贡献 target。Code Mode context owner 的 key 更细：它由该已提交 context 加 nested/parent ID 组成；其 success、error 和 `finally` 路径也必须验证当前 owner identity，并且其行会在仓库、范围、会话、事件层、query/filter、折叠策略、locale、选中详情/视图或 detail-cache-generation 转换时清除。Request owner 还会尽力取消被取代的浏览器 fetch，但不能保证同步服务端或主线程工作会在产生最终被丢弃的结果前停止。

### Timeline consumers / 时间线消费者

| Consumer / 消费者 | Current path / 当前路径 | Dependency on the contiguous prefix / 对连续前缀的依赖 |
| --- | --- | --- |
| Initial Session selection / 初始会话选择 | `selectSession` runs analysis, first timeline page, and file suggestions in parallel / `selectSession` 并行运行分析、首个时间线分页和文件候选 | Resets `currentEvents`, then commits page zero / 重置 `currentEvents` 后提交第零页 |
| Manual and scroll pagination / 手动与滚动分页 | `loadTimeline(true)` / `loadTimeline(true)` | Appends at `offset === currentEvents.length` / 在 `offset === currentEvents.length` 处追加 |
| Current-session query edit / 当前会话 query 修改 | `refreshTimelineFindState` refetches from zero to the prior loaded depth / `refreshTimelineFindState` 从零重新请求到之前已加载深度 | Preserves loaded range and reading continuity / 保留已加载范围与阅读连续性 |
| Structured filter edit / 结构化筛选修改 | `loadTimeline(false, { keepScroll: true, viewportPolicy: 'structured-filter' })` / `loadTimeline(false, { keepScroll: true, viewportPolicy: 'structured-filter' })` | Replaces with page zero; restores the exact selection only when it remains on that page, otherwise closes it and resets to top / 替换为第零页；只有精确所选事件仍位于该页时才恢复，否则关闭选择并回到顶部 |
| Layer edit / 事件层修改 | `changeLayer` captures focus, runs a page-zero replacement with `viewportPolicy: 'focus-restore'`, then restores the anchor when one existed / `changeLayer` 捕获焦点，以 `viewportPolicy: 'focus-restore'` 运行第零页替换，并在存在锚点时恢复它 | Keeps the existing scroll when no focus anchor exists; an anchored transition may explicitly load a deeper contiguous prefix and scroll to the restored event / 无焦点锚点时保留现有滚动；有锚点的转换可能显式加载更深的连续前缀并滚动到恢复的事件 |
| Project-result drill-down / 项目结果下钻 | `loadTimelineThroughIndex` fetches chunks from zero through the latest hit / `loadTimelineThroughIndex` 从零分 chunk 请求到最新命中 | Assumes project `timelineIndex` addresses the same filtered prefix / 假定项目 `timelineIndex` 指向同一个筛选前缀 |
| Search preload and Next/Previous / 搜索预加载与上一个/下一个 | Appends UI pages until a new hit owner is materialized or exhaustion is proven / 追加 UI 分页，直到物化新命中 owner 或证明耗尽 | Discovery is monotonic over loaded pages / 发现随已加载分页单调增长 |
| Focus restoration and `Read from here` / 焦点恢复与“从此处阅读” | Loads the complete navigation result, chooses an event, then appends until it is mounted / 加载完整导航结果、选择事件，再追加到它被挂载 | Uses prefix loading to restore a deep anchor / 使用前缀加载恢复深层锚点 |
| Confirmed Inspector navigation / 用户确认的检查器导航 | `ensureNavigationEvents` fetches all filtered pages in chunks of 500 / `ensureNavigationEvents` 以 500 条为 chunk 请求全部筛选分页 | Maintains a separate complete array, then asks the timeline prefix to reveal the chosen event / 维护独立完整数组，再要求时间线前缀展示所选事件 |
| Visible expanded detail / 可见展开详情 | Detail response enters cache and invokes `renderTimeline` / 详情响应进入缓存并调用 `renderTimeline` | Rebuilds every mounted prefix card for one owner's detail / 因一个 owner 的详情而重建全部已挂载前缀卡片 |
| Folding, selection, profile draft, and locale / 折叠、选择、策略草稿与 locale | Mix of class updates, full render, focus capture, and prefix reload / class 更新、完整 render、焦点捕获与前缀重载的组合 | DOM identity is not stable across most transitions / 大多数转换中 DOM identity 不稳定 |

## Search and count boundaries / 搜索与计数边界

Current-session free text does not filter timeline membership. After Layer and structured filters produce the selected timeline corpus: / 当前会话的自由文本不会过滤时间线成员。在事件层与结构化筛选得到所选时间线语料后：

- `timelineTotal` is the full structural event total. / `timelineTotal` 是完整结构化事件总数。
- `timelineSearchEventCount` is the full number of events containing the phrase. / `timelineSearchEventCount` 是包含短语的完整事件数。
- `timelineSearchMatchCount` is the full non-overlapping occurrence total. / `timelineSearchMatchCount` 是完整的非重叠 occurrence 总数。
- The jump-target denominator is the count of canonical hit-event anchors discovered from materialized events, not the number of occurrences or live DOM marks. / 跳转目标分母是从已物化事件发现的 canonical 命中事件锚数量，不是 occurrence 或实时 DOM mark 数量。
- `offset` is the materialized event count, not a text-match or mounted-visible count. / `offset` 是已物化事件数，不是文本命中数或已挂载可见数。
- A Code Mode context-only row is neither a materialized event nor a searchable owner: it contributes zero to `currentEvents`, offsets, event-card counts, exact totals, occurrence counts, canonical targets, and highlighting. / Code Mode context-only 行既不是已物化事件，也不是可搜索 owner：它对 `currentEvents`、offset、事件卡片计数、精确总数、occurrence 计数、规范目标和高亮的贡献均为零。

Project Scope uses a different model: query and all structured filters must match the same event; matching Session and event totals are exact project-result aggregates; project cards never become current-session jump targets. / 项目范围使用不同模型：query 与全部结构化筛选必须命中同一个事件；匹配会话和事件总数是精确的项目结果聚合；项目卡绝不会成为当前会话跳转目标。

These distinctions are architectural constraints for lazy highlighting, virtualization, server cursors, and caching. DOM mount state must never become the authority for exact counts or canonical target membership. / 这些区分是懒高亮、虚拟化、服务端 cursor 与缓存的架构约束。DOM 挂载状态绝不能成为精确计数或 canonical target 成员关系的权威来源。

## Performance cost model / 性能成本模型

Let `N` be the full selected Layer event count, `F` the structurally matched count, `L` the materialized prefix length, `K` the requested page size, and `T` the searchable text volume. / 令 `N` 为所选事件层的完整事件数，`F` 为结构化匹配数，`L` 为已物化前缀长度，`K` 为请求 page size，`T` 为可搜索文本量。

### Server / 服务端

- Main/Protocol `/timeline` work is approximately a full Layer scan plus structured filtering, optional phrase scans and counts, event-kind catalog scans, and `K` DTO mappings. / Main/Protocol `/timeline` 工作量近似为完整事件层扫描、结构筛选、可选的短语扫描与计数、事件类型 catalog 扫描，以及 `K` 个 DTO 映射。
- Raw `/timeline` additionally materializes DTOs for all Raw Records before filtering and slicing. / Raw `/timeline` 还会在筛选与切页前为全部原始记录物化 DTO。
- Repeated pages for the same context repeat the full scan and counts; smaller `K` increases request count without reducing most scan work. / 同一 context 的重复分页会重复完整扫描与计数；更小的 `K` 会增加请求数，却不会减少大多数扫描工作。
- Each non-empty logical response additionally has the explicit request-scoped Code Mode reverse-map pass `O(E + R)`. It replaces neither structural scanning nor catalog counting, is not retained as an index-wide cache, and must not be extended into a cross-session or text-inference pass without a new performance decision. / 每个非空逻辑响应还具有显式、请求范围的 Code Mode 反向映射遍历 `O(E + R)`。它既不取代结构扫描或目录计数，也不作为全索引缓存保留；若没有新的性能决策，不得把它扩展为跨 session 或文本推断遍历。
- Detail construction performs repeated event lookup and supporting-Raw-Record resolution per detail request. This is secondary to the measured timeline render path but can amplify visible-detail loading. / 详情构建会在每次详情请求中重复查找事件并解析其依据的原始记录。它不是已测时间线渲染路径的主因，但会放大可见详情加载。

### Browser / 浏览器

- One `renderTimeline` call is proportional to all materialized cards plus all rendered structured detail. / 一次 `renderTimeline` 调用的成本与全部已物化卡片及全部已渲染结构化详情成比例。
- The following highlight refresh clears old marks, normalizes affected text nodes, walks searchable owners, creates new marks, and rebuilds disposable bindings. Its cost grows with mounted searchable text and phrase frequency. / 随后的高亮刷新会清除旧 mark、normalize 受影响文本节点、遍历可搜索 owner、创建新 mark 并重建可丢弃 binding。其成本随已挂载可搜索文本量和短语频率增长。
- Loading a deep target page-by-page performs render work over prefixes `K`, `2K`, `3K`, and so on. The accumulated card-generation work is therefore quadratic in page count even though the final timeline contains only `L` events. / 逐页加载深层目标会依次对 `K`、`2K`、`3K` 等前缀执行 render。因此，即使最终时间线只有 `L` 个事件，累计卡片生成工作也会随页数呈二次增长。
- Refetching a loaded prefix on query edits repeats server scans and then performs another full DOM replacement and highlight pass. / Query 修改时重取已加载前缀，会重复服务端扫描，并再次执行完整 DOM 替换与高亮。
- A detail response or Folding Strategy edit can cause a full render even when the timeline data did not change. / 即使时间线数据没有变化，一个详情响应或折叠策略编辑也可以触发完整 render。
- A hidden-parent Code Mode context reveal may add only its owned layer-aware envelope/detail fetch and one owner-scoped presentation-slot update. It must not append a timeline page, rerun canonical target discovery, or place the context row in ordinary timeline/search DOM. / 隐藏父操作的 Code Mode context reveal 最多只能增加其 own 的感知事件层 envelope/detail fetch 和一次 owner 范围的呈现 slot 更新。它不得追加时间线分页、重新运行规范目标发现，或把 context 行放入普通 timeline/search DOM。

### Residual-scroll amplifier / 残留滚动放大器

A structured refresh intentionally keeps scroll. When a deep timeline is replaced by page zero, the browser can clamp the old `scrollTop` near the new bottom. The ordinary scroll handler then sees the pagination threshold and loads another page without new user scroll intent. This adds network and another full render/highlight pass precisely while the context is already transitioning. / 结构化刷新有意保留滚动。当深层时间线被第零页替换时，浏览器可能把旧 `scrollTop` clamp 到新内容底部附近。普通滚动 handler 随后会命中分页阈值，并在没有新用户滚动意图的情况下加载下一页。这会在 context 已经转换时额外增加网络请求和一次完整 render/highlight。

## Required invariants / 必须保持的不变量

1. JSONL parsing remains a project-index lifecycle concern; interactive search and paging operate on the committed in-memory index. / JSONL 解析继续属于项目索引生命周期；交互搜索与分页基于已提交的内存索引运行。
2. Current-session free text remains a find aid and does not remove non-hit events from timeline membership. / 当前会话自由文本继续作为查找辅助，不会从时间线成员中移除未命中事件。
3. Exact structural totals, matching-event totals, and occurrence totals remain independent of DOM mount state and page materialization. / 精确结构总数、命中事件总数与 occurrence 总数继续独立于 DOM 挂载状态和分页物化。
4. One canonical search target exists per discovered matching event. Redraw, Inspector visibility, folding, responsive layout, and occurrence count do not add, remove, or renumber descriptors for an unchanged semantic key. / 每个已发现的匹配事件只有一个 canonical 搜索目标。对未变化的语义 key，重绘、检查器可见性、折叠、响应式布局与 occurrence 数不会增加、移除或重新编号 descriptor。
5. User-confirmed Inspector and Raw Reference views keep their provenance and persistence rules across passive query refresh; search-opened detail remains transient. / 用户确认的检查器与原始引用视图在被动 query 刷新中保持来源和持久规则；搜索打开的详情继续是临时的。
6. Manual folds remain authoritative. Search may use transient expansion but must not persist or silently overwrite a user override. / 手动折叠继续保持权威。搜索可以使用临时展开，但不得持久化或静默覆盖用户 override。
7. Project-result drill-down, `Read from here`, event-reference navigation, and selected-event navigation preserve their current focus and return behavior. / 项目结果下钻、“从此处阅读”、事件引用导航与所选事件导航保持当前的焦点和返回行为。
8. Only data and surfaces committed for the current repository, scope, Session, Layer, expression, locale, and relevant Folding Strategy may update visible state or contribute search bindings. / 只有为当前仓库、范围、会话、事件层、表达式、locale 与相关折叠策略提交的数据和 surface，才能更新可见状态或贡献搜索 binding。
9. Cancellation is a resource-control mechanism, not a new zero-result state. Pending UI must not present stale or temporarily cleared counts as committed results. / 取消是资源控制机制，不是新的零结果状态。Pending UI 不得把过期或临时清空的计数呈现为已提交结果。
10. If a future renderer distinguishes materialized data from mounted DOM, `loaded` continues to describe data materialization unless the product contract and copy are explicitly revised. / 如果未来 renderer 区分已物化数据与已挂载 DOM，`loaded` 仍描述数据物化，除非产品 contract 与文案被明确修改。
11. Detail compatibility preserves the split between `timelineSections` and `inspectorSections`, Layer-specific event identity, `sourceLocator`, and `rawRefs`; transport paging and rendering caches do not redefine evidence ownership. / 详情兼容性会保留 `timelineSections` 与 `inspectorSections` 的分离、事件层专属事件 identity、`sourceLocator` 与 `rawRefs`；transport 分页和渲染 cache 不会重新定义证据 ownership。
12. Enclosing-Code-Mode context is an owner-scoped presentation slot, not an event materialization path. A visible parent uses direct navigation; a hidden, unloaded, or filtered parent may use only an envelope/detail request plus one distinct row before the nested event. The row never acquires event/search-owner DOM identity or alters canonical target discovery, counts, highlights, pagination, current prefix, Raw refs, or persisted folds. / Enclosing-Code-Mode context 是 owner 范围的呈现 slot，而不是事件物化路径。可见父操作使用直接导航；隐藏、未加载或被筛选的父操作最多只能使用 envelope/detail 请求加 nested event 前的一条不同的行。该行绝不获得事件/搜索 owner DOM identity，也不会改变规范目标发现、计数、高亮、分页、当前前缀、Raw refs 或持久化折叠。

## Coupling assessment / 耦合评估

| Candidate change / 候选改动 | Coupling / 耦合度 | Boundary and visible effect / 边界与可见影响 |
| --- | --- | --- |
| Suppress residual-scroll pagination after context replacement / context 替换后抑制残留滚动分页 | Low / 低 | Local to transition and scroll-intent state. Exact totals do not change; initial materialized and discovered counts may grow more slowly. / 局限于转换与滚动意图状态。精确总数不变；初始物化数与已发现数可能增长更慢。 |
| Abort and coalesce obsolete requests / 取消并合并过期请求 | Low to medium / 低至中 | Requires request ownership per consumer and context. Final committed behavior stays the same; pending behavior becomes more deterministic. / 需要按消费者与 context 管理请求所有权。最终提交行为不变；pending 行为更确定。 |
| Cache timeline match metadata and catalogs / 缓存时间线命中 metadata 与 catalog | Medium / 中 | Cache keys must include index revision, Session, Layer, expression, and locale where presentation depends on it. / Cache key 必须包含索引 revision、会话、事件层、表达式，以及展示依赖的 locale。 |
| Incremental append and targeted card updates / 增量追加与定向卡片更新 | High / 高 | Touches pagination, detail completion, folding, selection, Code Mode presentation, highlighting, and DOM identity, but can preserve the contiguous data prefix. / 会触及分页、详情完成、折叠、选择、Code Mode 展示、高亮与 DOM identity，但可以保留连续数据前缀。 |
| Owner-scoped or viewport highlighting / owner 或视口范围高亮 | Medium to high / 中至高 | Canonical descriptors must remain data-owned; a navigated owner must be highlighted synchronously even when ordinary offscreen owners are lazy. / Canonical descriptor 必须继续由数据拥有；即使普通屏外 owner 懒处理，被导航到的 owner 也必须同步高亮。 |
| Full timeline virtualization / 完整时间线虚拟化 | Very high / 很高 | Separates materialized events from mounted cards and changes scroll anchoring, visibility, detail prefetch, DOM bindings, and testing strategy. / 会分离已物化事件与已挂载卡片，并改变滚动锚点、可见性、详情预取、DOM binding 与测试策略。 |
| Server cursor or sparse direct jump / 服务端 cursor 或稀疏直接跳转 | Very high / 很高 | Breaks the current contiguous-prefix and numeric-offset assumptions unless introduced as a separate target projection. It may also change `loaded` and jump-target denominator semantics. / 会打破当前连续前缀和数字 offset 假设，除非作为独立目标投影引入；还可能改变 `loaded` 与跳转目标分母语义。 |

## Preferred staged direction / 建议的分阶段方向

### Stage 0: preserve evidence and stop accidental work / 阶段 0：保留证据并停止意外工作

- Keep the synthetic long-transcript profiling fixture reproducible and collect render count, highlighted-owner count, DOM node count, request count, Long Tasks, and end-to-end time. / 保持合成长转录 profiling fixture 可复现，并采集 render 次数、高亮 owner 数、DOM 节点数、请求数、Long Task 与端到端时间。
- Add an explicit post-replacement pagination suppression or user-scroll-intent gate so a preserved deep scroll position cannot silently append a page. / 增加显式的替换后分页抑制或用户滚动意图门，避免保留的深层滚动位置静默追加分页。
- Introduce abort ownership for timeline, project-result, suggestion, analysis, navigation-cache, and detail requests without treating abort as an error or zero result. / 为时间线、项目结果、候选、分析、导航 cache 与详情请求引入 abort ownership，同时不把 abort 当作错误或零结果。

Implemented Stage 0 boundary: the opt-in `profile:timeline` command creates and removes a deterministic temporary corpus, runs the four long-timeline interactions in Chromium, and records request families, full renders, card generations, highlight activity, DOM size, Resource Timing, and Long Tasks. It validates the fixed-scenario event-count minimum and accepts per-event searchable text sizes only as integers from 256 through 65,536 before creating temporary data. A pure browser helper owns monotonic pagination epochs, one-shot typed intent tokens, single-current request controllers, and typed intentional-abort classification. The application retains all request generation and context checks. Independent owners cover timeline, ordinary Session list, project results, analysis, file suggestions, navigation scans, event envelopes, and Code Mode context reveals; detail uses a per-key controller map and Raw References use one current-selection group controller. The Code Mode owner separately clears context rows when its captured committed context becomes stale and never shares its cancellation with ordinary event insertion. Project discovery/index-job polling retains its existing job identity and explicit server-side job cancellation because it is outside the selected-timeline transition boundary. / 已实现的第零阶段边界：opt-in `profile:timeline` 命令会创建并移除确定性的临时语料，在 Chromium 中运行四种长时间线交互，并记录请求族、完整 render、card 生成、高亮活动、DOM 大小、Resource Timing 与 Long Task。它会在创建临时数据前校验固定场景所需的事件数下限，并且只接受 256 到 65,536 之间的整数作为每事件可搜索文本大小。纯浏览器 helper 负责单调分页 epoch、一次性 typed intent token、单一 current request controller 与 typed intentional-abort 分类。应用继续保留全部请求 generation 与 context check。彼此独立的 owner 覆盖时间线、普通会话列表、项目结果、分析、文件候选、导航扫描、event envelope 与 Code Mode context reveal；详情使用逐 key controller map，原始引用使用一个当前选择组 controller。Code Mode owner 会在其捕获的已提交 context 过期时独立清除 context 行，且绝不与普通事件插入共享取消。项目发现/index job 轮询继续使用既有 job identity 与显式服务端 job 取消，因为它不属于所选时间线转换边界。

The accepted structured-filter viewport checkpoint is deterministic: preserve the exact selected event only when it exists in the newly committed first page; otherwise close that selection and reset to top. Layer and `Read from here` restoration remain explicit deep-prefix operations. Ordinary bottom pagination cannot run until the replacement epoch commits and then receives a new qualifying user-input token. The timeline pane is keyboard-focusable, and non-interactive pointer activation moves focus into it so scrolling keys reach the pane-owned intent listener; interactive descendants retain their own focus and remain excluded from pointer/keyboard scroll capture, so Load more activation cannot authorize a duplicate append. / 已接受的结构化筛选视口 checkpoint 是确定性的：只有精确所选事件存在于新提交的第一页时才保留，否则关闭该选择并回到顶部。事件层与“从此处阅读”恢复继续属于显式深前缀操作。普通底部分页必须等 replacement epoch 提交并收到新的合格用户输入 token 后才能运行。时间线面板可通过键盘聚焦，非交互指针激活会把焦点移入面板，使滚动键能够到达面板自己的意图监听器；交互式后代继续保留自身焦点，并从 pointer/keyboard scroll 捕获中排除，因此“加载更多”激活不能授权重复追加。

### Stage 1: separate timeline state commit from presentation / 阶段 1：分离时间线状态提交与展示

Create a focused browser boundary for timeline data/state transitions before changing rendering strategy. Candidate responsibilities are: / 在改变渲染策略前，为时间线数据/状态转换创建聚焦的浏览器边界。候选职责包括：

- Validate request generation and context before commit. / 提交前验证请求 generation 与 context。
- Commit replacement pages, append pages, totals, catalogs, and hit metadata through explicit operations. / 通过显式操作提交替换页、追加页、总数、catalog 与命中 metadata。
- Expose materialized-order lookup by ID without making DOM queries the data source. / 按 ID 暴露物化顺序查找，不把 DOM query 当作数据源。
- Centralize the current contiguous-prefix invariant and make future loaded-range changes explicit. / 集中维护当前连续前缀不变量，并让未来 loaded-range 改动显式化。

This boundary should be extracted behind current APIs rather than adding more asynchronous orchestration directly to `src/browser/app.js`. / 该边界应在保持当前 API 的前提下提取，而不是继续把异步编排直接增加到 `src/browser/app.js`。

### Stage 2: keyed card lifecycle and incremental highlighting / 阶段 2：带 key 的卡片生命周期与增量高亮

- Give each materialized event one keyed card owner independent of its current DOM node. / 为每个已物化事件提供一个独立于当前 DOM 节点的 keyed 卡片 owner。
- On append, create only new cards and preserve existing nodes, selection, focused controls, scroll, and detail DOM where valid. / 追加时只创建新卡片，并在有效时保留现有节点、选择、聚焦控件、滚动与详情 DOM。
- On detail arrival, fold change, selection, or presentation refinement, update only affected card owners and the detail pane. / 详情到达、折叠变化、选择或 presentation 细化时，只更新受影响的卡片 owner 与详情 pane。
- Rebind highlights only for changed owners. Preserve the semantic target registry independently and synchronously bind the active navigated owner. / 只为变化 owner 重新绑定高亮。独立保留语义 target registry，并同步绑定活动导航 owner。
- Keep descriptor discovery broader than live binding: matching materialized events may own canonical descriptors even when Folding Strategy rules or a future render window leave them without a mounted searchable owner. Navigation must explicitly mount or reveal the chosen row before resolving its mark. / 保持 descriptor 发现范围宽于实时 binding：即使折叠策略规则或未来 render window 让匹配的已物化事件没有已挂载可搜索 owner，它仍可以拥有 canonical descriptor。导航必须先显式挂载或展示所选行，再解析其 mark。
- Keep full replacement as the explicit path for a committed Session, Layer, structural-filter, locale, or incompatible renderer-context change. / 对已提交的会话、事件层、结构化筛选、locale 或不兼容 renderer context 变化，保留显式完整替换路径。

This stage directly attacks the measured quadratic page-render amplification while retaining the current data model and most behavior contracts. / 该阶段会直接解决已测的分页 render 二次放大，同时保留当前数据模型和大多数行为 contract。

### Stage 3: server reuse for repeated contexts / 阶段 3：服务端复用重复 context

- Cache or precompute structural membership, phrase hit metadata, counts, and event-kind catalogs per committed index and search context. / 按已提交索引和搜索 context 缓存或预计算结构成员关系、短语命中 metadata、计数与事件类型 catalog。
- Avoid Raw Layer DTO construction before paging where the filter and count contract permits using retained raw fields first. / 在筛选与计数 contract 允许时，先使用常驻 raw 字段，避免在分页前构建全部原始层 DTO。
- Add stable event-ID lookup maps for detail and referenced-event resolution if profiling confirms detail lookup cost. / 如果 profiling 确认详情查找成本，则为详情和引用事件解析增加稳定 event-ID lookup map。

Server optimization complements browser work but cannot by itself remove main-thread DOM and highlight starvation. / 服务端优化可以补充浏览器工作，但无法单独消除主线程 DOM 与高亮饥饿。

### Stage 4: decide whether virtualization is still necessary / 阶段 4：决定是否仍需虚拟化

Only after incremental card and highlight work is measured should the project decide whether to add a render window. If needed, the model must explicitly distinguish: / 只有在测量增量卡片与高亮工作后，项目才应决定是否增加 render window。如果需要，模型必须明确区分：

- Filtered corpus / 筛选语料
- Materialized data ranges / 已物化数据范围
- Mounted card window / 已挂载卡片窗口
- Cached detail owners / 已缓存详情 owner
- Canonical search descriptors / Canonical 搜索 descriptor
- Live occurrence bindings / 实时 occurrence binding

Variable card heights require measured scroll-anchor preservation, such as top-event ID plus intra-card offset or retained spacer heights. Mounted-card count must not replace materialized-event count in UI copy or APIs. / 可变卡片高度需要经过测量的滚动锚点保持方式，例如顶部事件 ID 加卡片内 offset，或保留 spacer 高度。已挂载卡片数不得在 UI 文案或 API 中取代已物化事件数。

### Stage 5: consider cursor and sparse direct navigation / 阶段 5：考虑 cursor 与稀疏直接导航

A server search cursor can locate the next matching event without materializing every preceding page, but the product must first choose one of two contracts: / 服务端搜索 cursor 可以在不物化所有前置分页的情况下定位下一匹配事件，但产品必须先选择两种 contract 之一：

1. Preserve the current discovered-target denominator and use cursor results only to materialize the next semantic owner. / 保留当前已发现目标分母，仅使用 cursor 结果物化下一个语义 owner。
2. Expose an exact event-level target total, changing the HUD denominator from discovered targets to global matching events. / 暴露精确事件级 target 总数，把 HUD 分母从已发现目标改为全局命中事件。

Direct sparse mounting also requires a product decision for `loaded`, reading continuity, project drill-down, and the relation between a distant target card and missing intermediate events. It should not be smuggled into the numeric `offset` model. / 直接稀疏挂载还需要针对 `loaded`、阅读连续性、项目下钻，以及远处目标卡片与缺失中间事件之间的关系作产品决策。它不应被隐式塞进数字 `offset` 模型。

## Alternatives considered / 已考虑的备选方案

### Patch only the residual-scroll bug / 只修残留滚动问题

- Pros: small, low-risk, and removes one severe multiplier. / 优点：范围小、风险低，并能移除一个严重放大器。
- Cons: deep search navigation, query refresh, detail completion, and folding still rebuild and re-highlight the full materialized prefix. / 缺点：深层搜索导航、query 刷新、详情完成与折叠仍会重建并重新高亮完整已物化前缀。
- Use as Stage 0 protection, not the final architecture. / 作为阶段 0 保护使用，不作为最终架构。

### Implement full virtualization immediately / 立即实现完整虚拟化

- Pros: bounds mounted DOM independently of loaded depth. / 优点：让已挂载 DOM 不再随已加载深度增长。
- Cons: simultaneously changes scrolling, focus, detail prefetch, folding, search binding, responsive behavior, and test assumptions before card ownership is isolated. / 缺点：会在卡片 ownership 尚未隔离时，同时改变滚动、焦点、详情预取、折叠、搜索 binding、响应式行为与测试假设。
- Deferred until incremental rendering is measured. / 推迟到增量渲染完成测量之后。

### Add a server cursor before changing rendering / 在改变渲染前先增加服务端 cursor

- Pros: avoids repeated page requests to find a late hit. / 优点：避免为了找到靠后命中而重复请求分页。
- Cons: direct target presentation still enters a renderer built around a full contiguous prefix and does not solve whole-DOM detail or highlight redraws. / 缺点：直接目标展示仍会进入围绕完整连续前缀构建的 renderer，也无法解决整段 DOM 的详情或高亮重绘。
- Deferred until the data/mount distinction is explicit. / 推迟到数据与挂载的区分被显式建模之后。

### Optimize only the server / 只优化服务端

- Pros: improves repeated query, count, Raw Layer, and navigation-cache requests. / 优点：改善重复 query、计数、原始层与导航 cache 请求。
- Cons: measured late-target time is overwhelmingly browser main-thread work. / 缺点：已测靠后目标耗时绝大部分来自浏览器主线程。
- Complementary, not sufficient. / 可作为补充，但不充分。

## Risks and open questions / 风险与开放问题

- Keyed incremental rendering can accidentally retain stale localized labels, Folding Strategy classes, or Code Mode presentation unless renderer-context invalidation is explicit. / 带 key 的增量渲染若没有显式 renderer-context 失效，可能保留过期本地化 label、折叠策略 class 或 Code Mode presentation。
- Preserving DOM nodes can retain large detail subtrees longer than necessary; memory and detached-node counts must be profiled alongside Long Tasks. / 保留 DOM 节点可能让大型详情子树停留更久；应同时 profiling 内存、detached node 与 Long Task。
- Offset append currently trusts non-overlapping immutable pages and does not deduplicate event IDs. Any cursor or refresh design must define snapshot stability, ordering, overlap handling, and duplicate rejection before changing the transport contract. / 当前 offset 追加信任分页互不重叠且保持不可变，不会对事件 ID 去重。任何 cursor 或刷新设计在改变 transport contract 前，都必须定义 snapshot 稳定性、顺序、overlap 处理与重复拒绝。
- UI materialization, search preload/navigation, project drill-down, and Inspector navigation use related but independent paging loops and page sizes. A shared cache or cursor must not merge their offsets, loading flags, exhaustion state, or cancellation ownership. / UI 物化、搜索预加载/导航、项目下钻与检查器导航使用相关但彼此独立的分页循环和 page size。共享 cache 或 cursor 不得混合它们的 offset、loading flag、耗尽状态或取消 ownership。
- Request abort must not leave `timelineLoading`, navigation pending state, disabled controls, or project-search pending context stuck. / 请求 abort 不得让 `timelineLoading`、导航 pending 状态、disabled 控件或项目搜索 pending context 卡住。
- Shared `/timeline` caching must not conflate Current Session Scope find semantics with Project Scope filtering semantics. / 共享 `/timeline` 缓存不得混淆当前会话范围查找语义与项目范围筛选语义。
- Raw Layer optimization must preserve full searchable text, labels, traceability, and count semantics while delaying DTO allocation. / 原始层优化在延迟 DTO 分配时必须保留完整可搜索文本、label、可追溯性与计数语义。
- Event and detail IDs remain Event-Layer identities, while Raw References and source locators remain evidence identities. Paging or cursor identifiers must not replace either contract. / 事件与详情 ID 继续是事件层 identity，而原始引用与 source locator 继续是证据 identity。分页或 cursor 标识不得取代其中任一 contract。
- Detail cache keys currently join `(sessionId, layer, eventId)` with raw colon separators. Existing Codex IDs fit that assumption, but a future source adapter or cursor-backed identity should move to typed tuple serialization before accepting identifiers that can collide at separator boundaries. / 详情 cache key 当前用原始冒号拼接 `(sessionId, layer, eventId)`。现有 Codex ID 符合该假设，但未来 source adapter 或 cursor-backed identity 在接受可能于分隔边界冲突的标识前，应改用 typed tuple 序列化。
- A future render window needs a deterministic policy for browser find, accessibility tree membership, copy/select behavior, and tests that currently count mounted cards. / 未来 render window 需要为浏览器查找、可访问性树成员、复制/选择行为，以及当前会统计已挂载卡片的测试制定确定性策略。
- Search navigation currently treats a missing live binding as a signal to load the event, transiently expand it, fetch detail, rerender, and retry the mark. Under virtualization, missing binding may mean only “offscreen”; the renderer must offer an explicit mount-and-reveal operation so navigation does not loop through unrelated loading work. / 搜索导航当前把缺少实时 binding 视为需要加载事件、临时展开、请求详情、重绘并重试 mark 的信号。在虚拟化下，缺少 binding 可能只表示“位于屏外”；renderer 必须提供显式的挂载并展示操作，避免导航循环执行无关加载工作。
- The target product contract for exact versus discovered jump-target totals remains open. / 精确与已发现跳转目标总数的目标产品 contract 仍未决定。
- Performance acceptance thresholds should be fixed in the implementation plan after the baseline harness is made reproducible on supported environments. / 性能验收阈值应在基线 harness 可于受支持环境复现后，由实现计划确定。

## Validation strategy / 验证策略

### Existing contract coverage to retain / 需要保留的既有 contract 覆盖

- Current-session query preserves loaded depth; clearing query does not reset pagination. / 当前会话 query 保留已加载深度；清除 query 不重置分页。
- Project-result drill-down loads a deep latest event and returns to the same project result context. / 项目结果下钻加载深层最新事件，并返回同一项目结果 context。
- Search-target membership and denominator survive Inspector redraw, folding, responsive detail visibility, and rapid navigation. / 搜索目标成员关系与分母跨检查器重绘、折叠、响应式详情可见性与快速导航保持稳定。
- Search navigation loads only the required UI page before wrapping, while explicit Load more remains ordered and idempotent at exhaustion. / 搜索导航在回绕前只加载所需 UI 分页；显式“加载更多”保持有序，并在耗尽后幂等。
- User scroll during programmatic-search scroll protection can still load the next page. / 程序化搜索滚动保护期间的用户滚动仍可加载下一页。
- User-confirmed detail persists across passive query refresh and closes only when structural membership or explicit action requires it. / 用户确认详情跨被动 query 刷新保持，并只在结构成员变化或显式操作要求时关闭。
- Folding Strategy drafts, manual overrides, `Read from here`, event references, locale changes, Raw Layer, and narrow layouts remain functional. / 折叠策略草稿、手动 override、“从此处阅读”、事件引用、locale 变化、原始层与窄布局继续正常。

### New focused coverage expected during implementation / 实现期间预期新增的聚焦覆盖

- Unit tests for replacement, append, stale-context rejection, duplicate-page rejection, and future loaded-range operations in the extracted timeline state boundary. / 为提取后的时间线状态边界增加替换、追加、过期 context 拒绝、重复分页拒绝与未来 loaded-range 操作单元测试。
- Renderer tests proving that append does not recreate old cards and that detail/fold/selection updates touch only intended owners. / Renderer 测试证明追加不会重建旧卡片，详情/折叠/选择更新只触达目标 owner。
- Highlight tests proving that unchanged owners keep descriptors, changed owners receive fresh bindings, offscreen laziness does not alter counts, and active navigation materializes a live binding. / 高亮测试证明未变化 owner 保留 descriptor、变化 owner 获得新 binding、屏外懒处理不改变计数，并且活动导航会物化实时 binding。
- Browser tests for residual-scroll suppression after query, filter, Layer, and Session transitions while preserving real wheel, touch, keyboard, and explicit Load more intent. / 浏览器测试覆盖 query、筛选、事件层与会话转换后的残留滚动抑制，同时保留真实 wheel、touch、keyboard 与显式加载更多意图。
- Cancellation tests for every request owner, including late success, abort, error, and immediate retry. / 为每个请求 owner 增加取消测试，覆盖晚到成功、abort、错误与立即重试。
- Performance regression runs at shallow, medium, and deep materialization depths, including common-term highlighting and visible-detail loading. / 在浅、中、深物化深度运行性能回归，包括常见词高亮与可见详情加载。
- Code Mode context coverage verifies the request-scoped reverse-map boundary, direct navigation for a mounted visible parent, owner-scoped envelope/detail reveal for hidden/unloaded/filtered parents, one distinct context row, cancellation on every committed transition, and zero changes to canonical final request/card/mark/target/count state. Stable scenarios require exact feature-off/on work counters. In an intentionally cancelled in-flight transition, transient render/card/highlight/discovery work may decrease but must not increase; final canonical state remains exact. / Code Mode context 覆盖验证请求范围反向映射边界、已挂载可见父操作的直接导航、隐藏/未加载/被筛选父操作的 owner 范围 envelope/detail reveal、一条不同的 context 行、每个已提交转换上的取消，以及规范最终 request/card/mark/target/count 状态零变化。稳定场景要求 feature-off/on 工作计数精确相等；在有意取消的进行中转换里，瞬态 render/card/highlight/discovery 工作可以减少但不得增加，最终规范状态仍须精确一致。

### Measurement dimensions / 测量维度

- End-to-end interaction latency / 端到端交互延迟
- Total and longest Long Task duration / Long Task 总时长与最长时长
- Number of full timeline renders and per-card renders / 完整时间线 render 与逐卡 render 次数
- Mounted card, section, text-node, and mark counts / 已挂载卡片、section、文本节点与 mark 数
- Timeline, detail, navigation, and cancelled request counts / 时间线、详情、导航与已取消请求数
- Server scan/count/cache-hit time by request context / 按请求 context 统计的服务端扫描、计数与 cache-hit 时间
- Heap and detached-node growth after repeated query/filter/session transitions / 重复 query、筛选、会话转换后的 heap 与 detached-node 增长

## Decision log / 决策日志

- 2026-07-20: Documented the current four-layer lifecycle—project indexing, timeline projection, lazy detail composition, and browser materialization/rendering—and the consumers that depend on the contiguous-prefix model. The preferred direction is residual-work protection followed by an extracted timeline state boundary, keyed incremental card rendering, incremental highlighting, measured server reuse, and only then a decision on virtualization or sparse cursor navigation. No user-visible behavior change is accepted by this document alone. / 2026-07-20：记录当前四层生命周期——项目索引、时间线投影、惰性详情组成、浏览器物化/渲染——以及依赖连续前缀模型的消费者。建议方向是先保护残余工作，再提取时间线状态边界、实现带 key 的增量卡片渲染与增量高亮、测量后复用服务端结果，最后再决定是否采用虚拟化或稀疏 cursor 导航。本文档本身不接受任何用户可见行为变化。
- 2026-07-20: Completed the residual-work protection stage with independent request owners, typed intentional-abort handling, committed pagination epochs, one-shot append intents, and deterministic structured-filter anchoring. In the fixed 1,800-event profile, the deep structured-filter path fell from six timeline requests, 116 full renders, and 84,900 card generations to one request, one render, and 150 card generations. The unchanged late-hit path still performs eight timeline requests, 20 full renders, and 31,800 card generations; this remains measured input for the next keyed card-lifecycle and owner-scoped highlighting stage. / 2026-07-20：完成残余工作保护阶段，引入独立 request owner、typed intentional-abort 处理、已提交分页 epoch、一次性 append intent 与确定性结构筛选锚点。在固定的 1,800 事件 profile 中，深层结构筛选路径从六次 timeline 请求、116 次完整 render 与 84,900 次 card 生成降为一次请求、一次 render 与 150 次 card 生成。未改变的靠后命中路径仍会发生八次 timeline 请求、20 次完整 render 与 31,800 次 card 生成；这些数据继续作为下一阶段带 key 的 card lifecycle 与 owner 范围高亮设计输入。
- 2026-07-22: Set the Code Mode presentation-context performance boundary: a logical response may pay one request-scoped linear reverse-map pass, while a hidden-parent reveal may pay only its owned envelope/detail fetch and one presentation-slot update. Neither path may append timeline pages, rerun canonical target discovery, or change request/render/card/mark/target/count ownership. / 2026-07-22：确定 Code Mode 呈现上下文的性能边界：逻辑响应可以承担一次请求范围的线性反向映射遍历，而隐藏父操作 reveal 最多只能承担其 own 的 envelope/detail fetch 和一次呈现 slot 更新。两条路径都不得追加时间线分页、重新运行规范目标发现，或改变 request/render/card/mark/target/count ownership。
- 2026-07-23: Completed the sanitized 1,800-event feature-off/on acceptance. Stable scenarios retain exact request/render/card/mark/target/count comparisons. The `switchDuringQuery` cancellation scenario compares requests and final canonical state exactly while allowing transient render/card/highlight/discovery work only to decrease, because aborted work is scheduling-dependent; latency and Long Task limits remain 110% of baseline. The accepted run recorded one context envelope request, zero timeline requests, zero full renders/card generations/highlight or target-discovery passes, one owner-slot insertion, and unchanged isolated canonical state. / 2026-07-23：完成脱敏 1,800 事件 feature-off/on 验收。稳定场景继续精确比较 request/render/card/mark/target/count；`switchDuringQuery` 取消场景精确比较请求和最终规范状态，同时只允许瞬态 render/card/highlight/discovery 工作减少，因为被取消工作取决于调度时序；延迟与 Long Task 上限仍为 baseline 的 110%。通过的运行记录为一次 context envelope 请求、零次 timeline 请求、零次完整 render/card generation/highlight 或 target-discovery pass、一次 owner-slot 插入，以及保持隔离且不变的规范状态。
