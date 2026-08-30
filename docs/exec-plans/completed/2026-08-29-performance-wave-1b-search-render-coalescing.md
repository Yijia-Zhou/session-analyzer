# Performance Wave 1B: search-owned multi-page render coalescing / 性能 Wave 1B：搜索拥有的多页渲染合并

## 1. Goal-ready objective / 可直接用于 `/goal` 的目标

Reduce the remaining warm-browser main-thread amplification after accepted Performance Wave 1A by coalescing search-owned multi-page timeline appends into one canonical append and one presentation flush per logical batch, while preserving current search, paging, cancellation, error, Session/Layer/filter/locale, detail-ownership, and final-state behavior.

Wave 1B applies only to the three search-owned repeated-append flows that still call `loadTimeline(true)` page by page:

1. automatic search-target preload;
2. late-target search navigation;
3. explicit “load more search targets”.

Fetched pages remain batch-local until an accepted flush. The committed `currentEvents` / `currentEventsById` pair and mounted timeline remain at the last committed prefix while the batch is pending. Each accepted page is validated against both the committed prefix and earlier local pages before entering the batch. At flush, all locally accepted events are appended once through the existing Wave 1A canonical timeline-state boundary, followed by one normal full timeline render/highlight pass.

Wave 1B does **not** perform batch-local semantic search-target discovery. Current production target discovery runs once, against the complete newly committed prefix, after flush. This deliberately avoids changing `search-targets.js` or introducing synthetic `timelineIndex` semantics.

在已接受的 Performance Wave 1A 基础上，通过把 search-owned 多页 timeline append 合并为每个逻辑 batch 一次 canonical append 与一次 presentation flush，减少剩余的 warm-browser 主线程放大，同时保留当前搜索、分页、取消、错误、Session／Layer／filter／locale、detail ownership 与最终状态语义。

Wave 1B 只处理仍逐页调用 `loadTimeline(true)` 的三条 search-owned repeated-append 路径：

1. 自动 search-target preload；
2. 靠后目标 search navigation；
3. 显式 “load more search targets”。

Batch pending 期间，已取得的 page 只存在于 batch-local state；已提交的 `currentEvents`／`currentEventsById` pair 与 mounted timeline 继续停留在最后一次 committed prefix。每个 page 在进入 batch 前都必须针对 committed prefix 和此前 local page 完成校验。Flush 时，全部已接受的 local event 通过 Wave 1A 现有 canonical timeline-state boundary 一次 append，然后只执行一次正常完整 timeline render／highlight。

Wave 1B **不实施 batch-local semantic search-target discovery**。Flush 后继续使用当前 production discovery，对完整的新 committed prefix 一次完成 target discovery。这样有意避免修改 `search-targets.js` 或人为制造 `timelineIndex` 语义。

Completed M0 invocation record; do not rerun it without a concrete M0 repair need: / 已完成的 M0 invocation 记录；除非出现具体 M0 修复需要，否则不得重跑：

```text
/goal Execute M0 only from docs/exec-plans/active/2026-08-29-performance-wave-1b-search-render-coalescing.md. Revalidate the live towards-0.2.0 ref and relevant-path drift, verify the formal plan/current schema/toolchain/worktree, create the dedicated feature branch, register the active plan, and record the exact generic profile and descriptive-metric schema paths. Then stop before M1. Do not edit product source, generate assets, capture profiling evidence, create a candidate commit, push, open a PR, or merge.
```

Technical design is accepted and implementation authorization is limited to M0. M0 authorization covers only target/drift/schema/toolchain/worktree revalidation, branch creation, and active-plan registration. It does not authorize M1/M2 product implementation, generated-asset regeneration, profiling/evidence capture, candidate commits, pushes, pull requests, or merges. / 技术设计已获接受，实施授权仅限 M0。M0 授权只覆盖 target／drift／schema／toolchain／worktree 重新核验、创建分支与登记 active plan；不授权 M1／M2 产品实现、生成资产重建、profiling／evidence capture、candidate commit、push、PR 或 merge。

M0 is now complete. There is no currently authorized `/goal` invocation for M1 or later milestones. / M0 现已完成；当前不存在获授权执行 M1 或后续里程碑的 `/goal` invocation。

------

## 2. Planning-finalization prerequisite / 规划定稿前置条件

Before implementation authorization, the current draft must exist at exactly:

```text
docs/exec-plans/active/2026-08-29-performance-wave-1b-search-render-coalescing.md
```

If the reviewed draft currently exists as:

```text
docs/exec-plans/active/tmp.md
```

move/rename it to the formal path **before** invoking `/goal`.

This rename is planning finalization, not M0 implementation work.

Before authorization verify:

- `tmp.md` no longer exists;
- the formal path exists exactly once;
- the suggested `/goal` command resolves to the formal path;
- all self-references use the formal path.

------

## 3. Status, repository, target, and ownership / 状态、仓库、目标与 ownership

- Status: `COMPLETED_M6_STOPPED_BEFORE_PUSH`; exact candidate `0bb1a8a5049e7335392ff75c9b0a9ccc18c03866` passed M4 evidence and independent M5 acceptance. The user then authorized documentation-only M6 through the local closeout commit, with an explicit stop before push. This plan is archived under `completed/`, the performance design points to the completed path and records exact evidence, the active `AGENTS.md` registration is removed, and Wave 1C remains explicitly separate. / 状态：`COMPLETED_M6_STOPPED_BEFORE_PUSH`；精确 candidate `0bb1a8a5049e7335392ff75c9b0a9ccc18c03866` 已通过 M4 evidence 与独立 M5 接受。随后用户授权执行 documentation-only M6 至本地 closeout commit，并明确要求在 push 前停止。本计划已归档至 `completed/`，performance design 指向 completed path 并记录精确 evidence，`AGENTS.md` 的 active 登记已移除，且 Wave 1C 继续明确分离。
- Repository: exactly `Yijia-Zhou/session-analyzer`.
- Target branch: `towards-0.2.0`.
- Inspected target SHA: `a19c2321d14f1815b29c38e9937166d75f194750`.
- Inspected target tree: `8a4a4df9fbba4ccf8dec28ae9555513fd53d6810`.
- The inspected target is the merge commit of PR #27, `perf(browser): optimize Wave 1A timeline hot paths`.
- Suggested implementation branch after authorization: `perf/wave-1b-search-render-coalescing`.
- Owner: implementation executor followed by one independent focused implementation/evidence reviewer.

Before source edits, resolve the then-live `towards-0.2.0`, require the inspected target to remain an ancestor, and classify relevant descendant changes.

A moving remote target alone is not a stop condition. Renew source/design review only when descendant changes affect:

- browser timeline loading/rendering;
- search preload/navigation;
- event-state invariants;
- relevant browser tests;
- `timeline-profile`;
- generated browser inputs;
- package/build semantics;
- governing timeline-performance design.

------

## 4. Governing repository authority / 仓库权威文档

At M0 the executor must reread the implementation-ref versions of:

```text
README.md
AGENTS.md
CONTEXT.md
docs/product-specs/session-transcript-analyzer.md
docs/design-docs/timeline-loading-and-rendering-performance.md
docs/design-docs/indexed-materialized-session-lifecycle.md
docs/exec-plans/completed/2026-08-24-performance-wave-0-baseline.md
docs/exec-plans/completed/2026-08-27-performance-wave-1a-browser-hot-path.md
package.json
scripts/build-client.js
```

Wave 0 remains authoritative for:

- the strict production-path synthetic fixture;
- warm/cold scenario taxonomy;
- request normalization;
- functional final state;
- causal stale-commit protection;
- Long Tasks;
- Resource Timing;
- timing-as-observation rather than a pass/fail threshold.

Wave 1A remains authoritative for:

- `currentEvents` as the canonical ordered contiguous prefix;
- `currentEventsById` as its derived exact-ID Map;
- duplicate/empty-ID fail-before-publish behavior;
- exact object identity between array and Map;
- committed context/offset parity;
- request-owner/context/revision protections;
- temporary reveal remaining outside the canonical Map;
- accepted duplicate Session-suggestion elimination.

Wave 1B extends these boundaries only for search-owned multi-page presentation batching.

------

## 5. Confirmed current state and evidence boundary / 已确认现状与证据边界

### 5.1 Remaining warm-browser bottleneck / 剩余 warm-browser bottleneck

Accepted Wave 1A evidence still shows the late-target path as overwhelmingly browser-main-thread work rather than network time.

Historical Wave 1A descriptive observations were approximately:

```text
warmSearchPreload:
  duration             1.351 s
  Long Task total      0.456 s

warmJumpToLateHit:
  duration             9.615 s
  Long Task total      9.093 s
  Long Task count      32
  timeline network     ~0.121 s
  detail network       ~0.345 s

warmDeepStructuredFilter:
  duration             1.601 s
  Long Task total      0.331 s

warmContextReveal:
  duration             0.602 s
  Long Tasks           0

coldSessionSwitchDuringQuery:
  duration             1.035 s
  Long Tasks           0
```

These are historical observations, not Wave 1B latency thresholds.

### 5.2 Current repeated-append amplification / 当前 repeated-append 放大

Ordinary `loadTimeline(true)` currently performs:

```text
fetch one page
→ validate owner / generation / Session / context
→ commitTimelineEventAppend(data.events)
→ update timeline/search metadata
→ renderTimeline()
→ selected/detail reconciliation
→ renderResultSummary()
```

`renderTimeline()` still performs a whole-prefix presentation:

```text
renderedTimelineEvents()
→ generate HTML for the entire mounted prefix
→ replace timeline.innerHTML
→ sync context reveal
→ sync enclosing-operation affordances
→ queue visible detail loading
→ refresh search highlights
```

Therefore one programmatic paging chain may repeatedly rebuild all previously loaded cards.

### 5.3 Existing multi-page batching already present / 已存在的多页 batching

`loadTimelineThroughIndex()` and `refreshTimelineFindState()` already:

```text
fetch several pages into a local array
→ publish once
→ render once
```

Wave 1B must not rewrite these paths merely to share a new abstraction.

They are implementation examples and regression boundaries.

### 5.4 Wave 1A structural baseline relevant to Wave 1B / 直接相关的 Wave 1A structural baseline

Accepted Wave 1A evidence recorded:

```text
warmSearchPreload:
  fullRenders       = 4
  cardGenerations   = 1500

warmDeepStructuredFilter:
  fullRenders       = 1
  cardGenerations   = 150

warmContextReveal:
  fullRenders       = 0
  cardGenerations   = 0
  highlight work    = 0
  target discovery  = 0
```

For preload:

```text
150 + 300 + 450 + 600 = 1500
```

is consistent with the 150-card query replacement plus three separately rendered 150-event appends.

Wave 1B preserves the initial 150-card query replacement and coalesces only the three subsequent automatic append attempts.

Predeclared successful-path expectation:

```text
warmSearchPreload:
  fullRenders       = 2
  cardGenerations   = 750

render 1 = initial 150-card query replacement
render 2 = one final 600-card coalesced prefix
```

No calibration is needed to decide this.

### 5.5 Timeline DTOs do not contain canonical timeline indices / Timeline DTO 不包含 canonical timeline index

The production timeline API returns paged event DTOs without a `timelineIndex` field.

`searchTargets.discover()` falls back to the input-array-local index when a DTO lacks `timelineIndex`.

Therefore invoking discovery separately on page chunks is not equivalent to one discovery over the committed concatenated prefix.

Wave 1B resolves this by **not doing target discovery on uncommitted page chunks**.

Batch-local logic may inspect only content-free/event-level facts already present on DTOs and needed for paging policy, especially:

```text
event.id
event.hasSearchHit
```

After one accepted canonical flush, the existing normal full-prefix discovery path runs unchanged.

------

## 6. Included scope / 包含范围

Wave 1B contains exactly two closely related implementation changes.

### 6.1 Search-owned page accumulation / Search-owned page accumulation

Introduce a narrow browser batch/state-policy helper for:

```text
search-preload
search-navigation
search-load-more
```

The helper owns only local batch state and decisions.

It does not own:

- network requests;
- browser request cancellation;
- canonical timeline state;
- DOM;
- search target registry;
- detail requests.

### 6.2 Page-level canonical-ID prevalidation / Page-level canonical-ID prevalidation

Expose/reuse a narrow pure event-state validation seam so each successful page is validated before local batch admission against:

1. the already committed `currentEventsById`;
2. all previously accepted local pages in the same batch;
3. duplicates inside the new page;
4. missing/empty IDs.

The failing page never enters the batch.

Earlier accepted local pages remain eligible for one partial-progress flush according to the per-kind error policy below.

------

## 7. Explicit non-goals / 明确非目标

Wave 1B must not implement or opportunistically prototype:

```text
batch-local search target descriptors
baseTimelineIndex additions to searchTargets.discover()
changes to src/browser/search-targets.js

keyed card owners
incremental DOM append
stable per-card DOM identity
owner-local detail patching
owner-local expand/collapse patching
owner-scoped highlighting
profile-wide incremental folding
Raw/Protocol incremental renderer

virtualization
render windows
sparse timeline loading
cursor transport
API changes

Materialized Session derived query indexes
server-side event/raw ID Maps
server search/query caches
Raw page-before-DTO redesign

private-validator/fingerprint optimization
relationship-only scanner
ProjectQueryStore commit-proof optimization

package/lockfile/workflow changes
numerical latency or memory thresholds
```

Keyed rendering, semantic descriptor/live-binding refinement, owner-local detail patching, and owner-scoped highlighting are explicitly deferred to Wave 1C.

Cold/server optimization remains a separate track.

------

## 8. Architecture and responsibility split / 架构与职责划分

### 8.1 New pure batch-policy helper / 新纯 batch-policy helper

Add:

```text
src/browser/timeline-search-batch.js
```

with direct Node coverage in:

```text
test/timeline-search-batch.test.js
```

The module must be browser-compatible CommonJS and contain no DOM, fetch, timer, localization, or global application state dependency.

It owns:

- closed batch kind;
- immutable captured batch identity values supplied by `app.js`;
- base committed offset;
- attempt accounting;
- local accepted events;
- local accepted event-ID Map;
- most-recent accepted timeline metadata;
- local `hasSearchHit` owner facts required by stop policy;
- page-growth/end observations;
- continue / flush / stop decisions.

It does **not** mutate production state directly.

### 8.2 `app.js` retains asynchronous authority / `app.js` 保留异步 authority

`src/browser/app.js` continues to own:

- current Session;
- search/context keys;
- request owners;
- request IDs;
- index-revision acceptance;
- pagination/search-navigation pending state;
- API calls;
- current error surface;
- canonical timeline commit;
- render and final highlight/discovery.

The orchestration should be approximately:

```text
capture one search-batch identity
→ start one current timeline request owner/generation
→ request page
→ revalidate owner/context
→ page-level invariant validation
→ feed accepted page into pure batch helper
→ obey batch decision
→ optionally request next page
→ on accepted flush:
     one canonical append
     one normal render/highlight/discovery
→ settle existing caller state
```

This is a deliberate responsibility boundary consistent with the governing design: asynchronous browser authority stays in `app.js`, while multi-page batch policy/state is extracted rather than further embedding a state machine into the application file.

### 8.3 Narrow event-state validation seam / 窄 event-state validation seam

`src/browser/timeline-event-state.js` may add one pure reusable page-validation function.

Its contract should be equivalent to:

```text
validateTimelineEventAdditions(nextEvents, existingMaps)
  -> additionsById
```

where:

- `nextEvents` must be an array;
- each event must be an object with a non-empty string ID;
- IDs must be unique within the page;
- no ID may appear in any supplied existing Map;
- it returns a Map holding the exact event objects;
- it mutates nothing.

Existing `appendTimelineEvents()` should reuse this helper rather than maintaining a second duplicate-check implementation.

During a search batch:

```text
existingMaps =
  [state.currentEventsById, batch.localAcceptedById]
```

At final canonical append, existing Wave 1A append validation runs again. Redundant final validation is acceptable because it protects the actual publication boundary.

------

## 9. Canonical data and presentation invariant / Canonical data 与 presentation invariant

### 9.1 Canonical state must not run ahead of mounted DOM

Do not implement:

```text
commit each page
+
suppress render
```

During a pending batch:

```text
state.currentEvents
state.currentEventsById
state.offset
state.timelineDataContext
mounted timeline DOM
```

remain the last committed/rendered prefix.

Fetched pages exist only in batch-local storage.

This avoids a hidden state in which:

```text
canonical data says event is loaded
but the event has no mounted canonical card
```

### 9.2 One accepted flush publishes all local progress once

An accepted flush performs, in order: / 一次 accepted flush 按以下顺序执行：

```text
1. final current-owner / Session / context / search-key check
2. one commitTimelineEventAppend(allAcceptedEvents)
3. apply metadata from the latest accepted page
4. sync search-assist controls where currently required
5. call renderTimeline() exactly once
6. renderTimeline() itself performs the existing
   refreshSearchHighlights() / full-prefix discovery and live binding
7. do not call refreshSearchHighlights() again merely because this was
   a batch flush
8. perform the remaining selected/detail/result-summary caller
   reconciliation exactly where required by the current flow
```

The exact local code ordering may follow existing dependencies, but canonical append must precede the render that exposes it.

`renderTimeline()` is the single presentation-flush authority in Wave 1B. A successful batch must not perform a second explicit `refreshSearchHighlights()` immediately after that render unless a pre-existing caller-specific transition independently requires it and focused tests prove that requirement. / `renderTimeline()` 是 Wave 1B 唯一的 presentation-flush authority。成功 batch 在该 render 后不得仅因其属于 batch flush 而再次显式调用 `refreshSearchHighlights()`；只有既存 caller-specific transition 独立需要且 focused test 证明该需求时才允许例外。

### 9.3 No uncommitted target descriptors

Batch-local state never writes:

```text
state.searchTargetRegistry
target.bindings
state.searchHighlight
```

and never calls `searchTargets.discover()` for an uncommitted page.

A stale batch therefore has no target-descriptor cleanup problem.

------

## 10. Exact meaning of “request semantics preserved” / “request semantics 不变”的精确定义

For Wave 1B, exact request semantics means the following remain equivalent:

### Hard/exact

For `/timeline` requests:

- Session owner;
- Layer;
- query;
- structured filters;
- locale;
- offset sequence;
- limit;
- page-attempt budget where one exists;
- normal stop conditions;
- request-owner/stale/cancellation authority;
- successful final canonical state.

### Not required to remain exact

Detail request:

- start time;
- relative order;
- count;
- whether an intermediate briefly visible card triggered a detail request.

Suppressing intermediate whole-timeline renders is expected to remove or delay some detail fetches.

Detail acceptance instead requires:

- existing detail owner/generation guards remain unchanged;
- no retired-context detail response may commit;
- final visible expanded owners obtain required detail;
- final card/Inspector presentation is equivalent;
- no new eager-detail or request family is introduced.

Resource Timing/detail counts remain observational.

------

## 11. Batch identity and common invariants / Batch identity 与共同不变量

Each batch captures at least:

```text
kind
selectedSessionId
timelineDataContextKey()
searchTargetPreloadKey()
baseOffset
baseTimelineTotal
request owner/generation
```

Closed kinds:

```text
search-preload
search-navigation
search-load-more
```

The batch may not cross:

```text
Session
scope
Layer
query
structured filters
locale
index revision
timeline replacement
search target context
```

Every requested page uses:

```text
offset = baseOffset + acceptedLocalEventCount
```

unless a successful empty/no-growth page means the current per-kind policy deliberately repeats/stops as specified below.

The batch stores the latest successfully accepted:

```text
total
searchMatchCount
searchEventCount
eventKinds
codeModeRequests
```

for use if/when accepted local progress is flushed.

------

## 12. Page acceptance pipeline / Page 接受流程

For every returned page:

```text
1. request resolves
2. verify current request owner
3. verify request generation
4. verify selected Session
5. verify timeline context
6. verify search key / batch identity
7. validate page IDs against:
     committed Map
     prior local page Map
     same page
8. only now admit page into batch-local events
9. record page metadata
10. update batch attempt/growth/hit facts
11. compute per-kind continue/flush/stop decision
```

A page that fails step 2–6 is stale and is discarded.

A page that fails step 7 is an invariant/error page:

- the failing page is not admitted;
- earlier accepted local pages remain known;
- current per-kind error policy applies.

No silent deduplication or last-write-wins behavior is allowed.

------

## 13. Per-kind behavior policy / 三类 batch 的独立行为 policy

The three current flows do not share identical retry/stop/error semantics. Wave 1B must preserve those differences.

### 13.1 `search-preload`

Current purpose:

```text
automatically acquire more discovered search targets
up to SEARCH_TARGET_PRELOAD_MAX_PAGES (= 3)
```

#### Attempt accounting

- preserve the existing three-attempt budget;
- an attempt is consumed **before** its page request begins;
- a failed attempt still consumes budget;
- if the current `searchTargetPreload.pages` already consumed part of the budget before this batch begins, only the remaining budget is available.

#### Projected target-count signal

Do not create descriptors batch-locally.

At batch start capture the currently known target owner IDs.

For each accepted local event with:

```text
event.hasSearchHit === true
```

add its event ID to a local projected-hit-owner Set.

Because canonical event IDs are unique, projected unique hit owners provide the same stop signal needed for automatic preload without constructing descriptors or relying on `timelineIndex`.

#### Successful continuation / stop

Continue while all are true:

```text
projected discovered target-owner count < SEARCH_TARGET_PRELOAD_MIN
committed base + accepted local events < latest total
remaining attempt budget > 0
batch remains current
```

Stop and flush when:

- projected target count reaches the minimum; or
- latest total is reached; or
- all remaining attempts are consumed.

#### Successful empty/no-growth page

A successful empty/no-growth page:

- still consumes its attempt;
- if `offset < total` and attempts remain, preload may issue the next attempt from the same effective offset, preserving current bounded retry behavior;
- after budget exhaustion, flush any previously accepted progress and stop.

#### Transport/server/invariant error

If the failing attempt is still current:

1. the attempt was already consumed immediately before its request started and remains consumed; failure does not increment the page-attempt counter again;
2. do not admit the failing page;
3. if earlier local pages were accepted, flush them once;
4. surface the error through existing `showError` behavior;
5. after that attempt settles, the existing preload continuation policy may start a successor attempt only if:
   - the same search/preload ownership is still current;
   - projected target count remains below the minimum;
   - committed offset remains below the latest total; and
   - the three-attempt budget still has capacity.

The page-attempt counter has exactly one increment point: immediately before the corresponding request starts. / Page-attempt counter 只有一个递增点：对应 request 开始前立即递增。

Thus one abnormal preload chain may contain more than one flush, but **the normal successful three-page fixture path must use one coalesced append flush**.

A stale or intentional-abort result does not display an error and does not continue the retired batch.

#### Pending state

`searchTargetPreload.pending` remains true for the active attempt/chain according to current UI semantics and is cleared when the current chain settles or is superseded.

No stuck pending state is permitted.

### 13.2 `search-navigation`

This path has no three-page attempt budget.

Errors stop navigation and propagate through the existing navigation error path.

#### Forward navigation

After scanning the already committed prefix:

- request additional pages as needed;
- admit pages locally;
- stop page accumulation at the first accepted page containing at least one `hasSearchHit` candidate;
- flush all accepted pages once;
- then let the existing full-prefix discovery/binding/navigation logic resolve the real target.

If no accepted page contains a hit:

- continue until total/end/no-growth;
- flush accumulated progress once;
- complete existing wrap/no-target logic.

#### Reverse wrap navigation

Preserve current semantics:

- if no prior loaded target resolves, continue loading the remaining suffix to the end;
- intermediate pages stay local;
- flush once at the end;
- then perform the existing reverse wrap scan/discovery.

Do not change reverse navigation into “stop at first future hit” unless separately reviewed.

#### Empty/no-growth

A successful empty/no-growth page terminates this batch attempt.

Flush previous accepted progress once, if any, then continue the existing no-progress/no-target path.

#### Transport/server/invariant error

If current:

1. exclude the failing page;
2. flush previous accepted pages once, if any;
3. propagate the error;
4. stop navigation.

Do not automatically start a successor navigation batch.

### 13.3 `search-load-more`

Current purpose:

```text
explicitly load until at least one new search target is discoverable,
or until the loaded range is exhausted/no-progress
```

At invocation start capture the currently known target owner IDs.

#### Successful stop

Continue page requests until:

- the first accepted page contains a `hasSearchHit` event whose owner was not present in the invocation-start known-target owner Set; or
- total/end/no-growth is reached.

On the first page with a new hit candidate:

```text
flush all accepted pages once
run normal full-prefix discovery
set exhausted = false
return true if the expected new target is now present
```

If end/no-growth is reached without a new target:

```text
flush accepted progress once if non-empty
set exhausted = (committed offset >= latest total)
return false
```

#### Pending state

`searchTargetPreload.pending` remains true for the explicit load-more invocation and is cleared in the existing `finally`-equivalent cleanup only if the same search key still owns it.

#### Transport/server/invariant error

If current:

1. exclude the failing page;
2. flush previously accepted pages once, if any;
3. propagate error;
4. stop;
5. preserve the previous `exhausted` value;
6. clear `pending` through normal cleanup.

No automatic successor load-more batch starts.

------

## 14. Stale and intentional-abort semantics / Stale 与 intentional-abort 语义

If any batch is superseded by:

```text
query change
structured filter
Layer change
Session change
scope change
locale change
revision replacement/recovery
newer current timeline owner
```

then any uncommitted local state is discarded:

```text
local events discarded
local event-ID Map discarded
local hit-owner facts discarded
local metadata discarded
no canonical append
no render flush
no target mutation
```

Intentional abort is control flow, not an error.

A stale/aborted batch may not perform a partial flush merely because it had earlier successful local pages.

This is intentionally stricter than current-owner transport failure: once ownership is retired, old local progress is no longer eligible to publish.

------

## 15. Presentation/render error semantics / Presentation／render error 语义

Canonical append and DOM presentation are not transactionally rollbackable as one browser operation.

If an accepted flush:

```text
successfully commits canonical events
then throws during render/highlight/presentation
```

the canonical progress remains committed.

Existing error handling surfaces the presentation failure.

Per-kind continuation remains:

- preload: may continue later if current ownership and remaining budget permit;
- navigation: stops and propagates;
- explicit load-more: stops and propagates.

Do not attempt to roll the canonical array/Map back after a render exception.

Focused tests should simulate the controllable boundaries needed to prove no duplicate append or stuck pending state; they do not need to monkey-patch every renderer internal.

------

## 16. Search target discovery contract / Search target discovery 契约

Wave 1B deliberately does not alter `src/browser/search-targets.js`.

### During batch

Allowed local facts:

```text
event.id
event.hasSearchHit
```

used only to decide whether more pages are likely needed.

Forbidden before canonical flush:

```text
searchTargets.discover()
state.searchTargetRegistry mutation
target.bindings mutation
DOM mark creation
```

### At accepted flush

After all accepted events are canonically appended and rendered:

```text
existing refreshSearchHighlights()
→ existing full-prefix discover()
→ existing target ordering
→ existing live binding
```

runs normally.

This preserves production descriptor ordering/index semantics and avoids chunk-local index ambiguity.

A focused regression test must use real timeline-style DTOs **without `timelineIndex`** to prove the batching implementation does not depend on synthetic indexed test objects.

------

## 17. Detail request policy / Detail request policy

Removing intermediate full renders may legitimately change detail-request timing/count.

Therefore:

### Hard requirements

- no stale detail commit;
- detail cache/generation semantics unchanged;
- final visible expanded/code-mode owners obtain required detail;
- final selected Inspector/card content equivalent;
- Session/Layer/context ownership remains exact.

### Observational only

- detail request count;
- detail request ordering;
- detail request start time;
- whether an owner transiently visible only in an intermediate prefix ever requested detail.

Do not write tests requiring old detail request counts merely because they existed before batching.

------

## 18. Required focused behavior tests / 必需聚焦行为测试

### 18.1 Pure batch-policy tests

`test/timeline-search-batch.test.js` must cover at least:

#### Preload

- remaining attempt budget from 0/1/2/3 consumed pages;
- failed attempts consume budget;
- projected hit-owner count stops at minimum;
- successful empty page consumes attempt and may continue;
- total reached stops;
- current error permits successor attempt only when budget/current conditions allow.

#### Forward navigation

- already-loaded hit requires no batch;
- first locally accepted hit page causes flush decision;
- multiple no-hit pages accumulate before first hit;
- end/no-growth stops;
- error flushes previous accepted pages and stops.

#### Reverse navigation

- remaining suffix accumulates to end;
- no early stop merely because an intermediate future page contains a hit;
- end flush occurs once.

#### Explicit load-more

- first page with new hit causes flush/true;
- no-hit pages accumulate;
- end/no-growth produces false and correct exhausted decision;
- error preserves prior exhausted state and stops.

#### Common

- stale identity prevents publish eligibility;
- local events do not mutate committed inputs;
- local metadata reflects latest accepted page;
- closed batch kinds only.

### 18.2 Timeline-event-state tests

`test/timeline-event-state.test.js` must add coverage for the new pure page-validation seam:

- real event object identity preserved;
- duplicate inside page rejected;
- duplicate against committed Map rejected;
- duplicate against earlier local batch Map rejected;
- empty/missing ID rejected;
- validation mutates neither existing Map;
- existing `appendTimelineEvents()` still has identical fail-before-publish behavior.

### 18.3 Browser tests

Add focused named Playwright tests selectable through `--test-name-pattern`.

At minimum:

1. successful automatic preload coalesces three append pages;
2. forward late-target navigation has no intermediate full render;
3. reverse navigation preserves load-to-end semantics;
4. explicit load-more coalesces no-hit pages until first new hit;
5. preload page failure consumes budget and current preload can continue;
6. navigation later-page failure flushes previous progress once then stops;
7. load-more later-page failure flushes previous progress, preserves exhausted, clears pending;
8. later-page duplicate/empty-ID failure excludes failing page while preserving prior eligible progress;
9. query supersession discards old local pages;
10. Session supersession discards old local pages;
11. final visible detail/Inspector state remains correct despite fewer intermediate detail requests.

The browser seams should use Playwright request interception/init-script MutationObserver evidence where possible.

Do not add permanent user-visible diagnostics for these tests.

------

## 19. Scenario acceptance / 场景验收

The existing deterministic fixture remains:

```text
primary Main events = 1800
late hit ordinal    = 1650
secondary events    = 40
initial page         = 150
```

### 19.1 `warmSearchPreload`

Hard final state remains unchanged:

```text
selected Session = primary
loaded canonical cards = 600
late target not selected
correct search totals
no context row
zero materializer calls
```

Hard Wave 1B operation expectation:

```text
fullRenders       = 2
cardGenerations   = 750
```

Normal successful fixture page/request semantics must remain equivalent.

### 19.2 `warmJumpToLateHit`

Hard final state:

```text
primary remains selected
active target = ordinal 1650
canonical prefix contains target
no stale target/binding
no visible error
timeline offset/limit/query semantics preserved
```

Focused browser evidence must prove:

```text
one logical multi-page navigation batch
zero intermediate-page timeline full render
one canonical append flush for that batch
```

Total final:

```text
fullRenders
cardGenerations
highlightMarksCreated
highlight passes
detail-triggered renders
```

remain observational because target materialization/detail can still perform additional whole-prefix work.

### 19.3 `warmDeepStructuredFilter`

Control expectation remains exact:

```text
fullRenders       = 1
cardGenerations   = 150
```

Wave 1B must not route this through batching.

### 19.4 `warmContextReveal`

Existing exact zero-work contract remains:

```text
timeline requests          = 0
fullRenders                = 0
cardGenerations            = 0
highlightPasses            = 0
highlightMarksCreated      = 0
highlightedOwnerCount      = 0
targetDiscoveryPasses      = 0
materializerCalls          = 0
canonical timeline mutation= 0
```

### 19.5 `coldSessionSwitchDuringQuery`

Hard final state remains:

```text
selected Session = secondary
canonical cards = 40
loaded count = 40
no primary/unknown post-selection card commit
exactly one secondary cold materialization
no visible error
```

Any old search batch local pages must be discarded after Session ownership changes.

------

## 20. Wave 1B overlay validator / Wave 1B overlay validator

The existing generic `timeline-profile.js` acceptance is intentionally not changed to encode one historical wave's render counts.

Add:

```text
scripts/performance-wave-1b-validator.js
test/performance-wave-1b-validator.test.js
```

This is a validator/aggregator only.

It must not:

- spawn browser workers;
- collect private data;
- run the Wave 0 runner;
- modify raw artifacts;
- implement calibration;
- impose latency thresholds.

### 20.1 Two mutually exclusive closed CLI modes / 两种互斥的封闭 CLI 模式

Use one validator implementation with exactly two invocation modes. Do not create separate smoke and formal validators. / 使用同一个 validator implementation，并只提供两种 invocation mode；不得建立两套 smoke／formal validator。

#### Smoke-only preflight / Smoke-only 预检

```text
node scripts/performance-wave-1b-validator.js \
  --smoke-only \
  --output-dir <external-candidate-evidence-root>/smoke \
  --candidate-sha <40-char-sha> \
  --target-sync-sha <40-char-sha> \
  --smoke <external-candidate-evidence-root>/smoke/run.json
```

Smoke-only mode requires exactly:

```text
one --smoke-only flag
one --smoke
zero --run
zero --smoke-validation
```

It:

- validates generic raw-artifact acceptance;
- validates the same per-run Wave 1B overlay hard checks required of a formal run;
- validates expected candidate/target/runtime/fixture identity;
- writes `smoke-validation.json` beside the smoke artifact;
- does not compute cross-run distributions;
- does not write the final formal-group `summary.json` or `manifest.json`.

#### Formal candidate group / 正式 candidate group

```text
node scripts/performance-wave-1b-validator.js \
  --output-dir <external-candidate-evidence-root> \
  --candidate-sha <40-char-sha> \
  --target-sync-sha <40-char-sha> \
  --smoke <external-candidate-evidence-root>/smoke/run.json \
  --smoke-validation <external-candidate-evidence-root>/smoke/smoke-validation.json \
  --run <external-candidate-evidence-root>/runs/run-01.json \
  --run <external-candidate-evidence-root>/runs/run-02.json \
  --run <external-candidate-evidence-root>/runs/run-03.json
```

Formal mode requires exactly:

```text
no --smoke-only flag
one --smoke
one --smoke-validation
three --run arguments
```

It revalidates the raw smoke rather than trusting the prior verdict, verifies that `smoke-validation.json` binds that exact smoke byte hash and candidate/target identity, validates all three formal runs, checks group identity, computes the closed descriptive summary, writes `summary.json`, and writes `manifest.json` last. / Formal mode 必须重新验证 raw smoke，而不是信任之前的 verdict；还必须验证 `smoke-validation.json` 绑定同一 smoke byte hash 与 candidate／target identity，验证三次 formal run、检查 group identity、计算封闭 descriptive summary，先写 `summary.json`，最后写 `manifest.json`。

For both modes:

- the output directory must be repository-external and under one common candidate evidence root;
- every input must be a regular file under that same candidate evidence root;
- symbolic links and root escapes fail;
- duplicate or unknown CLI options fail;
- a validation pass exits `0`; any CLI, identity, schema, generic-acceptance, or overlay failure exits non-zero.

### 20.2 Generic plus per-run overlay acceptance / Generic 与 per-run overlay 验收

For the smoke and every formal run require:

```text
artifact.acceptance.passed === true

artifact.scenarios.warmSearchPreload.work.fullRenders === 2
artifact.scenarios.warmSearchPreload.work.cardGenerations === 750

artifact.scenarios.warmDeepStructuredFilter.work.fullRenders === 1
artifact.scenarios.warmDeepStructuredFilter.work.cardGenerations === 150

artifact.scenarios.warmContextReveal.work.fullRenders === 0
artifact.scenarios.warmContextReveal.work.cardGenerations === 0
artifact.scenarios.warmContextReveal.work.highlightPasses === 0
artifact.scenarios.warmContextReveal.work.highlightMarksCreated === 0
artifact.scenarios.warmContextReveal.work.highlightedOwnerCount === 0
artifact.scenarios.warmContextReveal.work.targetDiscoveryPasses === 0
```

The generic acceptance retains the Wave 1A structural, functional, causal, suggestion, Map, stale-owner, privacy, and cleanup contracts without duplicating them into a second schema. The overlay contains no latency threshold field or latency pass/fail comparison. / Generic acceptance 继续承载 Wave 1A 的 structural、functional、causal、suggestion、Map、stale-owner、privacy 与 cleanup contract；overlay 不重复定义这些 schema，也不包含 latency threshold 或 latency pass/fail comparison。

At M0 record/revalidate the exact current schema paths before validator implementation. Do not silently infer acceptance or guess field spelling from prose. / M0 必须在 validator 实现前记录／重新核验当前精确 schema path；不得从场景内容静默推断 acceptance，也不得凭自然语言猜测字段拼写。

### 20.3 Identity and smoke-preflight binding / Identity 与 smoke 预检绑定

The smoke and all formal runs must match the CLI-provided candidate SHA and target-sync SHA and must share the candidate/tree, runtime asset, semantic fixture, browser/profile schema, and applicable environment identity exposed by the current profile contract. Smoke-only repetition identity may remain `1/1`; the formal runs must be exactly repetition count `3` with indices `1`, `2`, and `3`. / Smoke 与全部 formal run 必须匹配 CLI 提供的 candidate SHA 与 target-sync SHA，并共享当前 profile contract 暴露的 candidate／tree、runtime asset、semantic fixture、browser／profile schema 与适用 environment identity。Smoke-only repetition identity 可保持 `1/1`；formal run 必须精确为 repetition count `3`、index `1`／`2`／`3`。

`smoke-validation.json` must include at least:

```text
artifactKind
schemaVersion
validatedAt
smoke relative path
smoke raw byte length
smoke SHA-256
candidate SHA
target sync SHA
runtime/fixture identity
genericAcceptancePassed
overlayAcceptancePassed
passed
failures
```

It is written for both pass and validation-failure outcomes when the input is readable enough to produce a diagnostic record. Formal mode requires its `passed` verdict to be true, rechecks all underlying conditions, and requires its `validatedAt` to precede the three formal run `recordedAt` values. / 只要 input 可读到足以形成诊断记录，smoke validation 无论 pass／failure 都写出该文件。Formal mode 要求其 `passed` 为 true，同时重新检查所有底层条件，并要求其 `validatedAt` 早于三次 formal run 的 `recordedAt`。

Where current raw artifacts expose process identity, formal process identities must be distinct. Otherwise, three separately launched CLI processes plus exact repetition identity and retained launch logs are the procedural evidence. / 当前 raw artifact 暴露 process identity 时，formal process identity 必须互异；否则，以三个独立启动的 CLI process、精确 repetition identity 与保留的 launch log 作为程序性 evidence。

### 20.4 Closed descriptive summary / 封闭 descriptive summary

Distributions use the three formal runs only; the smoke is not a fourth sample. / Distribution 只使用三次 formal run；smoke 不作为第四个样本。

For each of the existing five scenarios, aggregate exactly:

```text
scenario.work.durationMs
scenario.work.longTasks.count
scenario.work.longTasks.totalMs
scenario.work.longTasks.maxMs
```

For Resource Timing, aggregate exactly:

```text
scenario.requests.resourceTimingByFamily[family].durationTotal
```

for the union of normalized `(scenario, family)` keys present across the three formal runs. If a family is absent from one run's closed `resourceTimingByFamily` object, that run contributes observed `durationTotal = 0` for the series. Every descriptive series therefore has `repeatCount = 3` and reports exactly:

```text
repeatCount
median
min
max
```

This absent-family rule describes the observed Resource Timing section only; it does not convert missing hard request evidence into a successful request verdict. / 缺失 family 规则只描述已观测的 Resource Timing section；它不会把缺少 hard request evidence 的情况转换为成功 request verdict。

Do not aggregate other numeric fields merely because they exist. Request counts, loaded/card counts, and structural counters remain governed by generic/overlay hard acceptance rather than being duplicated as descriptive series. M0 records the exact inspected schema paths while keeping this semantic metric set fixed. / 不得仅因其它 numeric field 存在就顺带汇总。Request count、loaded／card count 与 structural counter 继续由 generic／overlay hard acceptance 管理，不重复成为 descriptive series。M0 记录 inspected schema 的精确 path，但该语义指标集合保持固定。

### 20.5 Non-self-referential output and status / 非自指 output 与状态

Smoke-only output order:

```text
1. read and hash the immutable smoke input
2. compute generic/overlay/identity verdicts
3. write smoke-validation.json
4. exit 0 only when passed; otherwise exit non-zero
```

Formal output order:

```text
1. read and hash immutable smoke/smoke-validation/run inputs
2. compute validation and group result
3. write summary.json
4. reopen summary.json and record its raw byte length + SHA-256
5. write manifest.json last
6. exit 0 only when the formal group passed; otherwise exit non-zero
```

When readable inputs permit diagnostic output, a failed formal group still writes `summary.json` and `manifest.json` with `passed = false` and explicit failures so the invalid group is preserved. Such output is diagnostic and never accepted evidence. / 只要 readable input 足以生成诊断 output，失败的 formal group 仍写出 `passed = false` 且包含明确 failures 的 `summary.json` 与 `manifest.json`，用于保留 invalid group；该 output 只能作为诊断，绝不属于 accepted evidence。

`manifest.json` indexes exactly:

```text
smoke input
smoke-validation.json
run-01 input
run-02 input
run-03 input
summary.json
```

For every indexed artifact it records canonical relative role/name, raw byte length, and SHA-256, plus candidate/target/environment identity. `manifest.json` must not index or hash itself. No second `reviewPacketHash` is created. / 每个 indexed artifact 记录规范 relative role／name、raw byte length 与 SHA-256，并绑定 candidate／target／environment identity。`manifest.json` 不得索引或 hash 自身，也不建立第二个 `reviewPacketHash`。

------

## 21. Profiling and repeatability protocol / Profiling 与重复协议

### 21.1 No calibration

Wave 1B has predeclared structural expectations.

Do not perform three-run calibration or freeze counters after observing results.

### 21.2 Candidate freeze

After implementation and executor gates:

1. every tracked/untracked change must be known and owned by Wave 1B;
2. exact changed-path audit must pass;
3. create one candidate commit;
4. after the candidate commit require a clean worktree;
5. only then capture smoke/evidence.

### 21.3 M4a smoke preflight / M4a smoke 预检

Run exactly one fresh-process `timeline-profile.js` smoke against the exact candidate, then immediately invoke the validator in `--smoke-only` mode. Require generic acceptance, the complete per-run Wave 1B overlay, and expected candidate/target/runtime/fixture identity. / 对精确 candidate 运行恰好一次 fresh-process `timeline-profile.js` smoke，随后立即以 `--smoke-only` mode 调用 validator。必须通过 generic acceptance、完整 per-run Wave 1B overlay 与预期 candidate／target／runtime／fixture identity。

If any requirement fails:

- preserve the smoke and `smoke-validation.json` as diagnostic evidence;
- do not start formal runs;
- diagnose and fix/re-candidate as required.

### 21.4 M4b exactly three formal runs / M4b 精确三次 formal run

Only after M4a passes, run exactly three fresh independent `timeline-profile.js` processes with:

```text
same candidate SHA
same target SHA
same fixture
same browser/headless mode
same viewport
same runtime/toolchain
repetition-count = 3
repetition-index = 1 / 2 / 3
```

Do not use `performance-wave-0-runner.js`.

After all three artifacts are captured, invoke the Wave 1B validator in formal mode with the accepted raw smoke, its bound `smoke-validation.json`, and all three formal runs. / 三次 artifact 全部采集后，以 formal mode 调用 Wave 1B validator，并传入 accepted raw smoke、与之绑定的 `smoke-validation.json` 和三次 formal run。

### 21.5 Invalid history

A run is invalid only for:

- candidate/ref mismatch;
- fixture/environment mismatch;
- generic acceptance failure;
- overlay hard failure;
- structural/causal stale-state failure;
- cleanup/profiler corruption.

Slow timing alone never invalidates a run.

Do not silently fill a missing ordinal.

If an invalid formal run occurs:

- preserve the whole group as diagnostic;
- diagnose;
- if implementation/expectation changes, create a new candidate;
- otherwise create a newly labeled three-run group after environmental diagnosis.

------

## 22. Durable evidence contract / Durable evidence 契约

Canonical evidence must be written directly to a durable repository-external non-Temp root such as:

```text
G:\vibe\session-analyzer-wave1b-evidence\<candidate-sha>\
```

Illustrative layout:

```text
smoke/
  run.json
  smoke-validation.json

runs/
  run-01.json
  run-02.json
  run-03.json

logs/

manifest.json
summary.json
```

The exact file count is not an acceptance contract.

Requirements:

- raw files never stage through `%TEMP%` as canonical evidence;
- raw profile artifacts remain byte-identical after capture;
- validator records raw byte length + SHA-256;
- smoke-only and formal validation use the same candidate evidence root;
- formal manifest indexes the bound smoke-validation record but never indexes itself;
- summary is independently recomputable from the three raw runs;
- no private transcript content is used.

Filesystem read-only/ACL protection is optional defense in depth.

A particular SDDL/ACL shape is not acceptance evidence.

Reviewer read access must be arranged before review begins.

Artifact hashes, not filesystem ACL topology, are the primary mutation-detection mechanism.

------

## 23. Expected changed-path envelope / 预期 changed-path envelope

Expected implementation paths:

```text
AGENTS.md

docs/design-docs/timeline-loading-and-rendering-performance.md
docs/exec-plans/active/2026-08-29-performance-wave-1b-search-render-coalescing.md

src/browser/app.js
src/browser/timeline-search-batch.js
src/browser/timeline-event-state.js

e2e/browser.test.js

test/timeline-search-batch.test.js
test/timeline-event-state.test.js

scripts/performance-wave-1b-validator.js
test/performance-wave-1b-validator.test.js

public/assets/app.js
```

Expected unchanged paths include:

```text
src/browser/search-targets.js
src/browser/highlight.js

scripts/timeline-profile.js
scripts/performance-wave-0-runner.js
test/timeline-profile.test.js
test/performance-wave-0-runner.test.js

server.js
src/session-query.js
src/source-adapters.js
src/materialized-session-owner.js
src/project-query-store.js

package.json
package-lock.json
.github/workflows/**

docs/product-specs/**
```

`public/assets/app.js` may only be generated through the normal client build.

Any need to change an expected-unchanged file is a mandatory scope-review stop before editing it.

The desire to generalize/refactor is not sufficient justification.

------

## 24. Milestones / 里程碑

### M0 — Revalidate and register / 重新核验并登记

Work:

- confirm formal plan path;
- reread repository authorities;
- resolve live target;
- prove inspected-target ancestry;
- classify relevant descendant drift;
- verify Node/npm toolchain;
- verify clean/known worktree;
- create `perf/wave-1b-search-render-coalescing`;
- register active plan in `AGENTS.md`;
- record the exact current generic-acceptance, per-run overlay, descriptive timing/Long-Task/Resource-Timing, identity, and `recordedAt` schema paths used by the Wave 1B validator.

Gate:

- no unresolved relevant drift;
- no unowned changes;
- active registration exact;
- changed-path envelope still viable.

No profiling or generated asset regeneration.

### M1 — Add pure seams and pre-optimization tests / 增加纯 seam 与优化前测试

Add:

```text
timeline-search-batch.js
timeline-search-batch.test.js
timeline-event-state page validation seam/tests
performance-wave-1b-validator.js/tests
```

Strengthen focused Playwright tests to establish current request/error/final-state semantics before production batching changes.

Production render behavior remains page-by-page at this milestone.

Gate:

- pure helper policies match section 13;
- real timeline DTO tests do not assume `timelineIndex`;
- smoke-only validator rejects any generic/overlay/identity failure, writes a bound diagnostic record, and exits non-zero on failure;
- formal validator fails a synthetic `4/1500` preload artifact and passes the planned `2/750` shape;
- formal validator rejects an unbound/failed/late smoke-validation record, uses the union of Resource Timing families with absent-family zero observations, and excludes its manifest from self-indexing;
- no product behavior changed yet except internal reusable validation seam with identical append semantics.

No mandatory independent reviewer stop unless M1 reveals scope expansion or a source-contract conflict.

### M2 — Implement production batching / 实施 production batching

Integrate the batch helper into exactly:

```text
automatic search preload
late-target search navigation
explicit load-more-search-targets
```

Keep ordinary `loadTimeline(true)` for non-batched/manual owners.

Implement:

- batch-local page storage;
- page-level event-ID validation;
- per-kind attempt/stop/error policy;
- current-owner partial flush;
- stale/abort zero commit;
- one accepted canonical append;
- one normal presentation flush.

Gate:

focused Node + focused Chromium tests pass, including all stale/error cases.

### M3 — Generate and run executor gates / 生成并运行 executor gate

Run:

```text
npm run build:client
```

Inspect generated diff.

Then run:

```text
node --check src/browser/app.js
node --check src/browser/timeline-search-batch.js
node --check src/browser/timeline-event-state.js
node --check scripts/performance-wave-1b-validator.js

node --test \
  test/timeline-search-batch.test.js \
  test/timeline-event-state.test.js \
  test/performance-wave-1b-validator.test.js

<focused Wave 1B browser tests by --test-name-pattern>

npm run test:browser
npm run release:check
git diff --check
```

`release:check` already covers:

```text
build:check
full Node suite
package smoke
```

Do not separately rerun those three merely for duplicate evidence unless diagnosing failure.

Before candidate commit:

- every worktree path must be known/owned;
- exact path audit passes.

Then create one candidate commit.

After candidate commit:

```text
git status
```

must be clean.

### M4a — Smoke / Smoke 预检

Against the exact clean candidate:

1. run exactly one fresh-process synthetic smoke;
2. immediately run `performance-wave-1b-validator.js --smoke-only`;
3. preserve `smoke-validation.json` beside the raw smoke.

Gate:

- generic raw-artifact acceptance passes;
- the complete Wave 1B per-run overlay passes, including preload `2/750`, deep filter `1/150`, and context zero-work;
- candidate/target/runtime/fixture identity is exact;
- smoke-only validator exits `0`.

If any requirement fails, preserve the smoke as diagnostic evidence, do not start formal runs, and diagnose/fix/re-candidate as required. / 任一要求失败时，保留 smoke 作为诊断 evidence，不得启动 formal run，并按需诊断、修复或重新建立 candidate。

### M4b — Formal three-run group / 正式三次 run group

Only after M4a passes:

1. run exactly three fresh independent profile processes;
2. invoke the validator in formal mode with the raw smoke, bound smoke-validation record, and all three runs;
3. independently reopen and hash all manifest inputs;
4. verify the closed summary recomputation.

Gate:

- smoke is revalidated rather than trusted;
- generic acceptance passes for smoke and 3/3 formal runs;
- overlay passes for smoke and 3/3 formal runs;
- three formal runs are valid and identities are exact;
- preload `2/750` passes 3/3;
- deep-filter `1/150` passes 3/3;
- context zero-work passes 3/3;
- every descriptive series has `repeatCount = 3`;
- manifest indexes smoke, smoke validation, three runs, and summary but not itself;
- no numerical latency gate exists;
- timing distributions are retained descriptively.

### M5 — Independent focused review / 独立聚焦 review

Use a fresh ordinary reviewer environment with read access to:

- candidate repository;
- durable Wave 1B evidence.

Reviewer independently inspects:

- target→candidate diff;
- all changed source;
- relevant unchanged call chains;
- batch ownership;
- three kind policies;
- event-ID page validation;
- detail-request semantic boundary;
- generated asset/currentness;
- changed-path scope.

Reviewer independently reruns:

```text
focused batch Node tests
focused timeline-event-state tests
overlay-validator tests
focused Wave 1B Chromium tests
npm run build:check
git diff --check
```

Reviewer independently:

- hashes manifest entries;
- verifies that manifest excludes itself and binds the accepted smoke-validation record;
- revalidates the raw smoke and its pre-formal validation timestamp/identity/hash binding;
- parses three raw run artifacts;
- recomputes preload/deep/context structural values;
- verifies generic acceptance plus overlay acceptance;
- verifies no latency gate;
- recomputes the closed duration/Long-Task series and the union/absent-zero Resource Timing series, including `repeatCount`, median, min, and max.

Reviewer need not rerun:

```text
full npm test
full browser suite
package smoke
release:check
three profile runs
```

unless reviewed evidence creates a concrete doubt.

Acceptance requires exactly:

```text
ACCEPTED_FOR_CANDIDATE
INTEGRATION_READY
```

and no unresolved blocker.

### M6 — Documentation-only closeout / Documentation-only 收口

Only after M5 acceptance:

- move plan from `active/` to `completed/`;
- update performance design active/completed link;
- remove Wave 1B active registration from `AGENTS.md`;
- record candidate/evidence/reviewer identities;
- record exact structural results;
- record timing only as descriptive observations;
- preserve explicit Wave 1C boundary.

Run:

```text
npm run build:check
git diff --check
documentation/link/path audit
```

No performance recapture for docs-only closeout.

Create one documentation-only closeout commit.

Stop before push/PR/merge unless separately authorized.

------

## 25. Independent review and CI division of responsibility / 独立 review 与 CI 职责划分

Three validation layers intentionally cover different failure modes.

### Executor

Owns:

```text
focused implementation tests
full local browser suite
release:check
candidate evidence capture
```

### Independent reviewer

Owns:

```text
source semantics
adversarial batching cases
focused reruns
evidence recomputation
scope review
```

### GitHub CI after PR

Owns:

```text
clean checkout
cross-platform Node/package coverage
clean browser job
exact PR-head validation
```

Do not multiply identical full-suite execution across all layers without a concrete reason.

------

## 26. GitHub integration gate / GitHub 集成 gate

After local closeout and separate authorization:

- push the feature branch, not directly to `towards-0.2.0`;
- open PR against `towards-0.2.0`;
- PR head must equal reviewed closeout head;
- require GitHub CI success on that exact head.

If target moves:

### Unrelated/documentation-only drift

Reinspect mergeability and affected docs.

### Relevant executable drift

Update branch against new target and rerun affected gates.

If executable candidate bytes change, M4/M5 evidence/review identity is replaced and must be renewed.

------

## 27. Mandatory stop conditions / 强制停止条件

Stop and request review before continuing if:

1. batching requires canonical state to advance page-by-page ahead of mounted DOM;
2. a server/API/cursor contract becomes necessary;
3. `search-targets.js` must change;
4. target ordering/count/navigation cannot remain correct using normal post-flush discovery;
5. ordinary/manual pagination must be rewritten;
6. `loadTimelineThroughIndex()` or `refreshTimelineFindState()` must be refactored merely for abstraction;
7. keyed DOM ownership becomes necessary;
8. current preload/navigation/load-more error semantics cannot be preserved;
9. partial progress cannot be flushed safely before propagating current-owner error;
10. profiling requires changing generic `timeline-profile.js` schema;
11. the Wave 0 runner must be modified;
12. package/lockfile/workflow/server/product-spec paths appear;
13. user-visible intermediate-page presentation is discovered to be an explicit product contract;
14. any expected-unchanged path becomes necessary.

------

## 28. Failure diagnosis / 失败诊断

| Symptom / 症状                                      | Likely cause / 可能原因                                  | Required response / 响应                                     |
| --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| Successful preload remains `4/1500`                 | automatic preload still flushes per page                 | inspect preload batch ownership; do not weaken expected value |
| Successful preload becomes `1/600` unexpectedly     | initial query replacement render was also suppressed     | restore explicit replacement render unless separately reviewed |
| Final preload count not 600                         | page budget/stop logic changed                           | compare three-attempt semantics                              |
| Old query pages appear                              | search identity gate missing                             | hard correctness failure                                     |
| Old Session pages appear                            | Session retirement does not discard batch                | hard correctness failure                                     |
| Duplicate ID only fails at final flush              | page prevalidation missing                               | restore per-page validation                                  |
| Previous accepted pages disappear after later error | partial-progress flush missing                           | implement kind-specific error flush                          |
| Preload failure no longer consumes page budget      | attempt accounting moved after request                   | restore pre-request accounting                               |
| Navigation retries after error                      | preload policy accidentally reused                       | stop navigation on error                                     |
| Load-more `exhausted` changes on error              | error path writes exhausted                              | preserve prior value                                         |
| Target order wrong                                  | chunk discovery accidentally introduced                  | remove pre-flush discovery                                   |
| Detail request count drops                          | expected effect of fewer intermediate renders            | verify final detail/ownership instead                        |
| Pending/loading stuck                               | cleanup/finally ownership incomplete                     | fix cleanup; no timeout workaround                           |
| Timing still slow after structural success          | remaining full-prefix final render/detail/highlight work | retain observation as Wave 1C input                          |
| One profile run is slow                             | environmental variance                                   | retain unless hard contract failed                           |

------

## 29. Rollback strategy / 回滚策略

Wave 1B introduces no:

```text
data migration
disk cache
API migration
server state
persistent browser schema
```

Rollback means reverting together:

- search batching orchestration;
- pure batch helper;
- page-validation seam changes if no longer needed;
- focused tests;
- overlay validator;
- generated bundle;
- Wave 1B design documentation.

Wave 1A canonical array/Map model remains valid.

If batching proves too coupled to search behavior, revert Wave 1B rather than expanding it into keyed rendering or cursor transport.

------

## 30. Documentation update requirements / 文档更新要求

On successful completion, update the bilingual timeline-performance design with:

- Wave 1B batch-local page ownership;
- canonical state remaining unchanged until flush;
- page-level duplicate/empty-ID prevalidation;
- three separate preload/navigation/load-more policies;
- current-owner partial-progress flush;
- stale/abort zero-commit rule;
- normal post-flush full-prefix search discovery;
- narrowed meaning of exact request semantics;
- detail request timing/count becoming observational;
- preload structural before/after;
- three-run descriptive timing results;
- lean evidence protocol;
- Wave 1C boundary.

Explicitly record:

```text
Wave 1C:
  keyed incremental card append
  semantic descriptor/live-binding refinement if still useful
  owner-local detail patch
  owner-scoped highlighting
```

Virtualization/cursor remains deferred until incremental rendering has been measured.

The product spec is expected to remain unchanged because final user-visible search/navigation behavior is preserved.

If implementation reveals a genuine user-visible contract change, stop and review product-spec impact before continuing.

------

## 31. Completion criteria / 完成标准

Wave 1B is complete only when all of the following are true.

1. Formal plan path exists and `tmp.md` is absent.
2. Live target ancestry and relevant drift are revalidated.
3. Active plan registration is exact.
4. Only the three authorized search-owned flows use the new batch mechanism.
5. Batch pages stay local before accepted flush.
6. Canonical `currentEvents` / `currentEventsById` / offset / DOM remain at the old committed prefix while batch is pending.
7. Every page is ID-validated before local admission.
8. Duplicate inside page fails before admission.
9. Duplicate against committed prefix fails before admission.
10. Duplicate against earlier local batch pages fails before admission.
11. Stale/aborted batches commit zero local pages.
12. Stale/aborted batches render zero post-retirement flushes.
13. Current-owner later-page errors preserve earlier accepted progress according to the correct kind policy.
14. Preload attempts remain bounded to the existing three-page budget.
15. Failed preload attempts still consume budget.
16. Preload may continue after current failure only when current ownership/budget/stop conditions allow.
17. Navigation stops and propagates after current failure.
18. Explicit load-more stops after current failure and preserves prior `exhausted`.
19. Pending/loading controls settle on success/error/stale/abort.
20. Batch-local search-target discovery does not exist.
21. Real timeline DTO tests do not require `timelineIndex`.
22. Post-flush target discovery/order/navigation remains equivalent.
23. Detail owner/stale/final-presentation behavior remains correct.
24. Detail request count/order is not treated as a hard invariant.
25. Successful `warmSearchPreload` is exactly `2` full renders / `750` card generations.
26. `warmDeepStructuredFilter` remains `1` / `150`.
27. `warmContextReveal` retains zero canonical work.
28. `warmJumpToLateHit` performs zero intermediate-page full timeline renders for its multi-page batch and reaches ordinal 1650.
29. Cold Session switch retains exact 40-card secondary final state and no stale primary batch commit.
30. Focused Node tests pass.
31. Focused Wave 1B browser tests pass.
32. Full `npm run test:browser` passes.
33. `npm run release:check` passes.
34. Generated asset currentness passes.
35. `git diff --check` passes.
36. Candidate changed paths remain within the reviewed envelope.
37. Candidate commit is followed by a clean worktree.
38. One smoke passes generic and overlay acceptance through `--smoke-only` before formal runs begin.
39. The smoke-validation record binds the raw smoke hash and expected identity and predates formal runs.
40. Exactly three fresh formal profile runs are captured only after smoke preflight passes.
41. All three share the required candidate/runtime/fixture identity and exact repetition indices.
42. Formal mode revalidates the smoke and generic profile acceptance passes for smoke plus 3/3 formal runs.
43. Wave 1B overlay acceptance passes for smoke plus 3/3 formal runs.
44. No numerical latency gate exists.
45. Timing/Long Tasks/Resource Timing remain a closed descriptive set with `repeatCount = 3`.
46. Resource Timing uses the union of normalized scenario/family keys and absent-family zero observations.
47. Durable external manifest records raw length/SHA-256 for smoke, smoke validation, three runs, and summary while excluding itself.
48. Summary is independently recomputable from the three raw runs.
49. Independent reviewer reruns focused checks and independently recomputes structural and descriptive evidence.
50. Independent reviewer returns exactly `ACCEPTED_FOR_CANDIDATE` and `INTEGRATION_READY`.
51. No unresolved blocker remains.
52. Documentation-only closeout archives the plan without executable recapture.

------

## 32. Initial decision log / 初始决策日志

- 2026-08-29: Wave 0/1A retrospective concluded that production-path identity, adversarial browser correctness, causal ownership, generated-currentness checks, and independent source review were high-value. Fixed packet topology, repeated full-suite reruns, per-stage ACL sealing, reviewer-SID ACL ceremony, and calibration-plus-five-run evidence for structural-only claims were excessive. Wave 1B therefore uses a durable raw-artifact manifest, one smoke, three formal runs, and focused independent review.
- 2026-08-29: The original performance investigation proposed browser optimization in three stages: programmatic multi-page render coalescing, keyed incremental append, then owner-local detail patching. Wave 1A implemented duplicate suggestion elimination and the browser exact-ID Map but did not change the whole-prefix rendering model. Wave 1B therefore implements the lower-risk coalescing stage before keyed rendering.
- 2026-08-29: `loadTimelineThroughIndex()` and `refreshTimelineFindState()` already locally accumulate pages and render once. Wave 1B targets only automatic preload, late-target navigation, and explicit load-more-search-targets rather than building a general timeline-loader abstraction.
- 2026-08-29: First Wave 1B draft proposed batch-local semantic target discovery. Review found this invalid for production DTOs because timeline responses do not contain `timelineIndex`, while `searchTargets.discover()` falls back to its input-array-local index. Wave 1B therefore removes all batch-local descriptor discovery instead of modifying `search-targets.js`; production full-prefix discovery remains after flush.
- 2026-08-29: Review found preload, navigation, and explicit load-more have materially different attempt/error/exhaustion semantics. Wave 1B therefore uses one shared batch-state helper with three closed policies rather than one generic partial-failure rule.
- 2026-08-29: Review found that generic `timeline-profile` acceptance would still pass an old `4/1500` preload artifact. Wave 1B therefore adds a narrow overlay validator that requires generic acceptance **and** the predeclared Wave 1B structural values. Generic profiler/runner semantics remain unchanged.
- 2026-08-29: `warmSearchPreload` before structure is fixed at `4` full renders / `1500` card generations. Wave 1B retains the initial 150-card query replacement and coalesces only its automatic append chain; the predeclared successful result is therefore `2` / `750`, not `1` / `600`.
- 2026-08-29: Suppressing intermediate whole-timeline renders can legitimately reduce or delay visible-detail requests. Exact request-semantic parity is therefore limited to timeline paging/query/ownership behavior; detail request count/order/timing is observational while stale ownership and final display remain hard correctness requirements.
- 2026-08-29: Keyed card ownership, incremental DOM append, owner-local detail patching, descriptor/live-binding refinement, and owner-scoped highlighting are deferred to Wave 1C. Server query reuse, validator narrowing, relationship-only indexing, and ProjectQueryStore proof remain a separate cold/server track.
- 2026-08-30: Final focused plan review found no remaining source-level or architectural blocker. The validator now supports smoke-only preflight before formal evidence capture; `renderTimeline()` is explicitly the single flush/highlight authority; manifest generation is non-self-referential with a closed descriptive metric set and explicit absent-family aggregation; and preload attempt accounting has one increment point before request start. Wave 1B is approved to begin M0 only. M0 approval does not authorize M1/M2 product implementation, evidence capture, generated-asset regeneration, candidate commit, push, PR, or merge. / 2026-08-30：最终 focused plan review 未发现剩余 source-level 或 architecture blocker。Validator 现支持 formal evidence capture 前的 smoke-only 预检；`renderTimeline()` 被明确为唯一 flush／highlight authority；manifest generation 使用非自指结构、封闭 descriptive metric set 与明确的 absent-family 聚合；preload attempt accounting 仅在 request 开始前递增一次。Wave 1B 只获准开始 M0；M0 授权不包括 M1／M2 产品实现、evidence capture、生成资产重建、candidate commit、push、PR 或 merge。
- 2026-08-30: M0 revalidated live `origin/towards-0.2.0` at `a19c2321d14f1815b29c38e9937166d75f194750` with tree `8a4a4df9fbba4ccf8dec28ae9555513fd53d6810`; it exactly matches the inspected target, so there is no descendant drift to classify. Repository authorities were reread, Node `v24.18.1` and npm `12.0.2` satisfy the source-development contract, the only pre-M0 worktree path was this owned formal plan, the reviewed changed-path envelope remains viable, branch `perf/wave-1b-search-render-coalescing` was created from the exact target, and `AGENTS.md` now registers this plan. The current profiler schema is recorded below. M0 is complete and execution stops before M1 pending separate authorization. / 2026-08-30：M0 重新核验 live `origin/towards-0.2.0` 为 `a19c2321d14f1815b29c38e9937166d75f194750`、tree 为 `8a4a4df9fbba4ccf8dec28ae9555513fd53d6810`；它与 inspected target 精确一致，因此没有 descendant drift 需要分类。已复读仓库权威文档；Node `v24.18.1` 与 npm `12.0.2` 满足源码开发 contract；M0 前 worktree 唯一路径是本计划这一已知且有 owner 的正式文件；reviewed changed-path envelope 继续可行；分支 `perf/wave-1b-search-render-coalescing` 已从精确 target 创建；`AGENTS.md` 已登记本计划。当前 profiler schema 记录如下。M0 已完成，执行停在 M1 前，等待另行授权。

------

## 33. Progress log / 进度日志

M0 completed and M1 implementation/tests were attempted. The unattended run stopped at the required R1 gate; production batching has not started. / M0 已完成，M1 implementation／test 已执行。无人值守执行停在必需的 R1 gate；production batching 尚未开始。

Current status: / 当前状态：

```text
Technical design: ACCEPTED
Remaining planning edits: NONE
Completed milestones: M0, M1, M2, M3, M4, M5, M6
Independent reviews: R1 / PASS_M1; R2 / PASS_M2; M5 / ACCEPTED_FOR_CANDIDATE + INTEGRATION_READY
Integration actions: PUSH/PR/MERGE/PUBLISH/RELEASE UNEXECUTED
Status: COMPLETED_M6_STOPPED_BEFORE_PUSH
```

### M0 execution record / M0 执行记录

```text
repository: Yijia-Zhou/session-analyzer
target branch: towards-0.2.0
live target SHA: a19c2321d14f1815b29c38e9937166d75f194750
live target tree: 8a4a4df9fbba4ccf8dec28ae9555513fd53d6810
inspected target ancestor: exact equality
relevant descendant drift: none
implementation branch: perf/wave-1b-search-render-coalescing
Node: v24.18.1
npm: 12.0.2
profile artifact schema: 4
profile artifact kind: timeline-browser-run
```

Current exact generic acceptance path: / 当前精确 generic acceptance path：

```text
artifact.acceptance.passed
```

Current exact per-run overlay paths: / 当前精确 per-run overlay path：

```text
artifact.scenarios.warmSearchPreload.work.fullRenders
artifact.scenarios.warmSearchPreload.work.cardGenerations
artifact.scenarios.warmDeepStructuredFilter.work.fullRenders
artifact.scenarios.warmDeepStructuredFilter.work.cardGenerations
artifact.scenarios.warmContextReveal.work.fullRenders
artifact.scenarios.warmContextReveal.work.cardGenerations
artifact.scenarios.warmContextReveal.work.highlightPasses
artifact.scenarios.warmContextReveal.work.highlightMarksCreated
artifact.scenarios.warmContextReveal.work.highlightedOwnerCount
artifact.scenarios.warmContextReveal.work.targetDiscoveryPasses
```

The closed scenario keys are: / 封闭 scenario key 为：

```text
warmSearchPreload
warmJumpToLateHit
warmDeepStructuredFilter
warmContextReveal
coldSessionSwitchDuringQuery
```

Current exact descriptive paths under each scenario are: / 每个 scenario 下当前精确 descriptive path 为：

```text
artifact.scenarios[scenario].work.durationMs
artifact.scenarios[scenario].work.longTasks.count
artifact.scenarios[scenario].work.longTasks.totalMs
artifact.scenarios[scenario].work.longTasks.maxMs
artifact.scenarios[scenario].requests.resourceTimingByFamily[family].durationTotal
```

Current exact identity/time binding paths are: / 当前精确 identity／time binding path 为：

```text
artifact.schemaVersion
artifact.artifactKind
artifact.identity.repository
artifact.identity.targetBranch
artifact.identity.currentBranch
artifact.identity.inspectedBaseSha
artifact.identity.preWave0Head
artifact.identity.head
artifact.identity.candidateCommitSha
artifact.identity.targetSyncSha
artifact.identity.targetToCandidateDiffAlgorithm
artifact.identity.targetToCandidateDiffSha256
artifact.identity.dirty
artifact.identity.profiledTrackedDiffSha256AtRun
artifact.identity.profiledImplementationTreeHash
artifact.identity.runLabel
artifact.identity.repetitionIndex
artifact.identity.repetitionCount
artifact.identity.recordedAt
artifact.environment.runtimeAssetSha256
artifact.fixture.parameters
artifact.fixture.roles
artifact.fixture.proofVersion
artifact.fixture.generatorSha256
artifact.fixture.semanticFixtureProof
```

The current synthetic group exact-environment paths are: / 当前 synthetic group 的精确 environment path 为：

```text
artifact.environment.node
artifact.environment.v8
artifact.environment.npm
artifact.environment.playwright
artifact.environment.chromium
artifact.environment.execArgv
artifact.environment.exposedGc
artifact.environment.heapLimitBytes
artifact.environment.platform
artifact.environment.osRelease
artifact.environment.architecture
artifact.environment.cpu
artifact.environment.cpuCount
artifact.environment.totalMemoryBytes
artifact.environment.ci
artifact.environment.headless
artifact.environment.locale
artifact.environment.timezone
artifact.environment.viewport
artifact.environment.runtimeAssetSha256
```

The current schema has no `candidateTreeSha` field. `artifact.identity.profiledImplementationTreeHash` is the existing implementation-tree identity, while candidate and target remain bound by their commit SHAs and the target-to-candidate diff identity. `runLabel`, `repetitionIndex`, and `recordedAt` are validated fields but are not required to be equal across formal runs; formal repetition indices must instead be exactly `1`, `2`, and `3`, and the smoke-validation timestamp must precede all three formal `recordedAt` values. / 当前 schema 没有 `candidateTreeSha` field。`artifact.identity.profiledImplementationTreeHash` 是既有 implementation-tree identity；candidate 与 target 继续由 commit SHA 与 target-to-candidate diff identity 绑定。`runLabel`、`repetitionIndex` 与 `recordedAt` 是受校验字段，但 formal run 之间不要求相等；formal repetition index 必须精确为 `1`、`2`、`3`，且 smoke-validation timestamp 必须早于三次 formal `recordedAt`。

M0 gate result: `PASS`. No M1/M2 source optimization, profiling, generated-asset regeneration, candidate commit, push, PR, or merge is authorized. A later explicit authorization is required to proceed beyond M0. / M0 gate 结果：`PASS`。当前不授权 M1／M2 source optimization、profiling、生成资产重建、candidate commit、push、PR 或 merge；超出 M0 必须另行获得明确授权。

### M1 unattended execution and R1 stop record / M1 无人值守执行与 R1 停止记录

The later unattended authorization allowed M1 through M5 subject to every mandatory review gate and at most two automatic repair/re-review cycles per checkpoint. M1 added the authorized pure batch-policy seam, timeline-event page-validation seam, Wave 1B validator, corresponding Node tests, and pre-optimization browser contract tests. It did not integrate production batching into `src/browser/app.js`, regenerate `public/assets/app.js`, capture profiling evidence, or start M2. / 后续无人值守授权允许在全部 mandatory review gate 与每个 checkpoint 最多两次 automatic repair／re-review cycle 的约束下执行 M1 至 M5。M1 增加了获授权的纯 batch-policy seam、timeline-event page-validation seam、Wave 1B validator、对应 Node test 与优化前 browser contract test；未在 `src/browser/app.js` 集成 production batching，未重建 `public/assets/app.js`，未采集 profiling evidence，也未开始 M2。

Final M1 executor checks before the last review: / 最后一次 review 前的 M1 executor check：

```text
node --check scripts/performance-wave-1b-validator.js
node --check src/browser/timeline-search-batch.js
node --check src/browser/timeline-event-state.js
result: PASS (3/3)

node --test test/timeline-search-batch.test.js test/timeline-event-state.test.js test/performance-wave-1b-validator.test.js
result: PASS (35/35)

node --test --test-name-pattern='browser Wave 1B' e2e/browser.test.js
result: PASS (2/2)

git diff --check
result: PASS (exit 0; line-ending warnings only)
```

R1 review history: / R1 review 历史：

1. Initial independent reviewer `/root/wave1b_r1_review` (Codex/GPT-5; exact runtime identifier unavailable) returned `BLOCKED_M1`. It found ancestor-symlink/common-root bypasses, raw-input/output collisions, permissive smoke-validation and numeric schema handling, non-guaranteed smoke/validation colocation, and missing safe preload partial-flush successor state transfer. It independently reran the focused Node tests (`28/28`), Wave 1B browser tests (`2/2`), and `git diff --check` (exit `0`). / 初始独立 reviewer `/root/wave1b_r1_review`（Codex／GPT-5；精确 runtime identifier 未暴露）返回 `BLOCKED_M1`。其发现 ancestor-symlink／common-root 绕过、raw-input／output 冲突、过宽的 smoke-validation 与 numeric schema、未保证 smoke／validation 同目录，以及 preload 部分 flush 后缺少安全 successor 状态转移；并独立重跑 focused Node test（`28/28`）、Wave 1B browser test（`2/2`）与 `git diff --check`（exit `0`）。
2. After repair cycle 1, fresh independent reviewer `/root/wave1b_r1_rereview_cycle1` (requested `gpt-5.6-luna`, maximum reasoning; reviewer reported Codex/GPT-5 with exact build unavailable) returned `BLOCKED_M1`. It found that an explicitly empty extra `--smoke-validation` escaped the zero-option smoke-only rule, non-object Resource Timing sections could be treated as an empty union, and preload could start a request when known target owners already met the minimum. It independently reran focused Node tests (`33/33`), browser tests (`2/2`), syntax checks, and `git diff --check`, all passing. / Repair cycle 1 后，全新独立 reviewer `/root/wave1b_r1_rereview_cycle1`（请求 `gpt-5.6-luna`、maximum reasoning；reviewer 报告 Codex／GPT-5，精确 build 未暴露）返回 `BLOCKED_M1`。其发现显式空值的额外 `--smoke-validation` 可绕过 smoke-only zero-option 规则、非 object Resource Timing section 可被当作空 union，以及 known target owner 已满足 minimum 时 preload 仍可启动 request；其独立重跑 focused Node test（`33/33`）、browser test（`2/2`）、syntax check 与 `git diff --check`，均通过。
3. After repair cycle 2, fresh independent reviewer `/root/wave1b_r1_rereview_cycle2` (requested `gpt-5.6-luna`, maximum reasoning; reviewer reported Codex/GPT-5) returned final `BLOCKED_M1`. It independently reran syntax checks (`3/3`), focused Node tests (`35/35`), browser tests (`2/2`), and `git diff --check`, all passing, but found one remaining high-severity §20.1 boundary bypass: in smoke-only mode, an output directory inside the repository can pass because only its parent `candidateRoot` is checked for repository externality. For example, `--output-dir G:\vibe\session-analyzer` makes `candidateRoot = G:\vibe`; a repository input can then cause diagnostic `smoke-validation.json` output inside the repository. / Repair cycle 2 后，全新独立 reviewer `/root/wave1b_r1_rereview_cycle2`（请求 `gpt-5.6-luna`、maximum reasoning；reviewer 报告 Codex／GPT-5）返回最终 `BLOCKED_M1`。其独立重跑 syntax check（`3/3`）、focused Node test（`35/35`）、browser test（`2/2`）与 `git diff --check`，均通过，但发现一个剩余的 high-severity §20.1 boundary 绕过：smoke-only mode 只检查 output directory 的父级 `candidateRoot` 是否在 repository 外，因此 repository 内 output directory 仍可通过。例如 `--output-dir G:\vibe\session-analyzer` 会得到 `candidateRoot = G:\vibe`；随后 repository input 可使诊断性 `smoke-validation.json` 写入 repository 内。

The two authorized automatic repair/re-review cycles are exhausted. Per the unattended failure policy, the executable source is preserved at the final reviewed state without a third repair. There is no `PASS_M1`; M2, R2, M3, candidate commit, M4 evidence capture, M5, M6, build regeneration, push, PR, merge, publish, and release remain unexecuted. / 两次获授权的 automatic repair／re-review cycle 已耗尽。依照无人值守 failure policy，可执行源码保留在最终 reviewed state，不进行第三次 repair。当前没有 `PASS_M1`；M2、R2、M3、candidate commit、M4 evidence capture、M5、M6、build regeneration、push、PR、merge、publish 与 release 均未执行。

Final unattended status: / 最终无人值守状态：

```text
STOPPED_BLOCKED_M1
```

### Exceptional M1 repair and recovery / M1 例外修复与恢复

The user explicitly authorized one exceptional third M1 repair cycle for the single remaining filesystem-boundary defect and one fresh R1 review. The general maximum-two-cycle rule remains unchanged for later checkpoints. The repair changed only `scripts/performance-wave-1b-validator.js` and `test/performance-wave-1b-validator.test.js`: `prepareEvidenceRoot()` now rejects both lexical `candidateRoot` and lexical `outputDir` when either is inside/equal to the repository before `mkdir`, and repeats both checks against canonical real paths after creation. Existing symlink, containment, regular-file, root-escape, and immutable-input protections remain in place. / 用户明确授权一次 exceptional third M1 repair cycle，仅处理最后一个 filesystem-boundary defect，并授权一次全新 R1 review；后续 checkpoint 的一般 maximum-two-cycle 规则保持不变。该 repair 只修改 `scripts/performance-wave-1b-validator.js` 与 `test/performance-wave-1b-validator.test.js`：`prepareEvidenceRoot()` 现会在 `mkdir` 前拒绝位于／等于 repository 的 lexical `candidateRoot` 与 lexical `outputDir`，并在创建后针对 canonical real path 重复检查二者；既有 symlink、containment、regular-file、root-escape 与 immutable-input protection 均保留。

Exceptional repair executor gates: / 例外修复 executor gate：

```text
node --check scripts/performance-wave-1b-validator.js
result: PASS

node --test test/timeline-search-batch.test.js test/timeline-event-state.test.js test/performance-wave-1b-validator.test.js
result: PASS (38/38)

node --test --test-name-pattern='browser Wave 1B' e2e/browser.test.js
result: PASS (2/2)

git diff --check
result: PASS (exit 0; line-ending warnings only)

exact changed-path audit
result: PASS (9/9 owned paths; zero unexpected paths; no boundary-test residue)
expected-unchanged audit
result: PASS (app.js, generated bundle, search-targets, profiler, Wave 0 runner, package/lockfile unchanged)
```

Fresh independent reviewer `/root/wave1b_r1_exceptional_cycle3` (requested `gpt-5.6-luna`, maximum reasoning; reviewer reported Codex/GPT-5) independently read the complete M1 diff and plan §§13/18/20, rechecked the complete validator filesystem boundary, batch helper, event-state seam, pre-optimization E2E, and exact changed paths, and reran validator syntax, focused Node (`38/38`), Wave 1B browser (`2/2`), and `git diff --check` (exit `0`). Verdict: `PASS_M1`; no unresolved blocker. Production batching and generated assets remained unchanged during M1. / 全新独立 reviewer `/root/wave1b_r1_exceptional_cycle3`（请求 `gpt-5.6-luna`、maximum reasoning；reviewer 报告 Codex／GPT-5）独立阅读完整 M1 diff 与计划 §§13/18/20，重新检查完整 validator filesystem boundary、batch helper、event-state seam、优化前 E2E 与精确 changed path，并重跑 validator syntax、focused Node（`38/38`）、Wave 1B browser（`2/2`）与 `git diff --check`（exit `0`）。Verdict：`PASS_M1`，无 unresolved blocker。M1 期间 production batching 与 generated asset 保持不变。

Current recovery status: / 当前恢复状态：

```text
PASS_M1_READY_FOR_M2
```

### M2 production batching and R2 record / M2 production batching 与 R2 记录

M2 integrated the pure batch helper into exactly automatic search preload, forward/reverse late-target navigation, and explicit search Load more. One batch invocation owns sequential page requests, validates every page before local admission, publishes accepted pages through one event-state append and one `renderTimeline()` presentation flush, preserves current-owner partial progress on eligible errors, and retires stale/aborted work without publication. Ordinary/manual timeline loading, replacement, find, through-index navigation, generated assets, profiler scripts, and package metadata remained unchanged. / M2 将纯 batch helper 精确集成到自动 search preload、正向／反向 late-target navigation 与显式 search Load more。单个 batch invocation 持有连续 page request，在本地接纳前验证每页，通过一次 event-state append 与一次 `renderTimeline()` presentation flush 发布已接受页面，在符合条件的 error 上保留 current-owner partial progress，并使 stale／aborted work 退出且不发布。普通／手动 timeline loading、replacement、find、through-index navigation、生成资产、profiler script 与 package metadata 均保持不变。

R2 review and repair history: / R2 review 与修复历史：

1. Initial independent reviewer `/root/wave1b_r2_integration_review` returned `BLOCKED_M2`. It found that stale same-key batch callers could pass key-only cleanup and post-processing checks, allowing an older preload, navigation, or Load-more invocation to clear or mutate newer replacement state. Repair cycle 1 introduced replacement generation plus per-invocation ownership, bound batch outcomes and preload pending ownership to that identity, and added same-key replacement tests for preload, batch-page navigation, and Load more. Executor gates then passed focused Node `38/38`, Chromium `14/14`, syntax, diff, and path audits. / 初始独立 reviewer `/root/wave1b_r2_integration_review` 返回 `BLOCKED_M2`。其发现 stale same-key batch caller 可通过仅检查 key 的 cleanup 与 post-processing，从而使较旧 preload、navigation 或 Load-more invocation 清理或修改较新的 replacement state。Repair cycle 1 引入 replacement generation 与 per-invocation ownership，将 batch outcome 与 preload pending ownership 绑定到该 identity，并增加 preload、batch-page navigation 与 Load more 的同键 replacement test。此后 executor gate 通过 focused Node `38/38`、Chromium `14/14`、syntax、diff 与 path audit。
2. Fresh reviewer `/root/wave1b_r2_rereview_cycle1` returned `BLOCKED_M2`. It found that the token covered the batch await but not the whole asynchronous navigation operation: a same-key replacement during `ensureEventLoaded()` or `loadEventDetail()` could still let the old scan/materialization/activation path mutate transient expansion, active target, selection, or detail state. Repair cycle 2, the final authorized R2 repair, propagated one invocation/generation token across the complete navigation operation, rechecked it after every asynchronous boundary, and deferred transient-expansion and active-target mutation until after the final current-operation check. A focused hidden-event test now pauses async detail activation, performs a same-key Session replacement, releases the old detail request, and proves the stale navigation cannot restore target activation, selection, or Inspector state. / 全新 reviewer `/root/wave1b_r2_rereview_cycle1` 返回 `BLOCKED_M2`。其发现 token 只覆盖 batch await，未覆盖完整异步 navigation operation：在 `ensureEventLoaded()` 或 `loadEventDetail()` 期间发生同键 replacement 时，旧 scan／materialization／activation path 仍可能修改 transient expansion、active target、selection 或 detail state。Repair cycle 2 是最后一次获授权的 R2 repair；它把同一个 invocation／generation token 贯穿完整 navigation operation，在每个异步边界后重新检查，并将 transient-expansion 与 active-target mutation 延后至最终 current-operation check 之后。新增 focused hidden-event test 会暂停 async detail activation、执行同键 Session replacement、释放旧 detail request，并证明 stale navigation 无法恢复 target activation、selection 或 Inspector state。
3. Final fresh independent reviewer `/root/wave1b_r2_rereview_cycle2` (requested `gpt-5.6-luna`, maximum reasoning) read the formal plan and complete current diff, rechecked the complete production batching integration and both prior stale-ownership findings, and returned `PASS_M2` with no unresolved blocker. It independently observed focused Node `38/38`, M2 Chromium `15/15`, syntax `5/5`, and `git diff --check` passing; exact changed-path audit also passed. It confirmed the M2 test bundle is built in memory with esbuild `write: false`, while `public/assets/app.js`, `src/browser/search-targets.js`, both profiler scripts, `package.json`, and `package-lock.json` remain byte-identical to HEAD. / 最终全新独立 reviewer `/root/wave1b_r2_rereview_cycle2`（请求 `gpt-5.6-luna`、maximum reasoning）阅读正式计划与完整当前 diff，重新检查完整 production batching integration 及前两项 stale-ownership finding，并在无 unresolved blocker 的情况下返回 `PASS_M2`。其独立观察到 focused Node `38/38`、M2 Chromium `15/15`、syntax `5/5` 与 `git diff --check` 全部通过；精确 changed-path audit 也通过。其确认 M2 test bundle 通过 esbuild `write: false` 在内存构建，而 `public/assets/app.js`、`src/browser/search-targets.js`、两项 profiler script、`package.json` 与 `package-lock.json` 均与 HEAD byte-identical。

Current M2 status: / 当前 M2 状态：

```text
PASS_M2_READY_FOR_M3
```

### M3 generated asset and executor-gate record / M3 生成资产与 executor-gate 记录

After `PASS_M2`, M3 ran the normal client build for the first time in Wave 1B. `public/assets/app.js` is the only generated path changed by that build; the generated diff is `154` insertions and `154` deletions, the bundle parses successfully, and the expected batching/invocation code is present. The Highlight.js vendor asset remained unchanged. / 在 `PASS_M2` 后，M3 首次为 Wave 1B 运行正常 client build。`public/assets/app.js` 是该 build 修改的唯一生成路径；生成 diff 为 `154` 行新增与 `154` 行删除，bundle 可成功解析，且包含预期 batching／invocation code。Highlight.js vendor asset 保持不变。

M3 executor gates: / M3 executor gate：

```text
npm run build:client
result: PASS (public/assets/app.js generated; 289.2 kB reported by esbuild)

node --check src/browser/app.js
node --check src/browser/timeline-search-batch.js
node --check src/browser/timeline-event-state.js
node --check scripts/performance-wave-1b-validator.js
node --check e2e/browser.test.js
node --check public/assets/app.js
result: PASS (6/6)

node --test test/timeline-search-batch.test.js test/timeline-event-state.test.js test/performance-wave-1b-validator.test.js
result: PASS (38/38)

node --test --test-name-pattern='browser Wave 1B' e2e/browser.test.js
result: PASS (15/15 actual matching tests)

npm run test:browser
result: PASS (151/151)

npm run release:check
result: PASS
  build:check: generated assets current
  full Node suite: 810/810
  package smoke: Codex, Claude Code, and DeepSeek Harness passed

git diff --check
result: PASS (exit 0; line-ending warnings only)

exact changed-path audit
result: PASS (11/11 owned paths; zero missing; zero unexpected)
```

This record is intentionally written before the single candidate commit so that evidence capture can begin from a clean immutable candidate without a post-commit documentation mutation. The commit SHA is bound by the M4 profiler and validator artifacts rather than self-referenced inside its own commit. / 本记录有意在唯一 candidate commit 前写入，使 evidence capture 可从干净、不可变的 candidate 开始，而无需 commit 后再修改文档。Commit SHA 由 M4 profiler 与 validator artifact 绑定，不在其自身 commit 中形成自引用。

Current M3 status: / 当前 M3 状态：

```text
PASS_M3_CANDIDATE_READY_FOR_M4
```

### M4 evidence and M5 independent acceptance / M4 evidence 与 M5 独立接受记录

The single clean candidate commit is `0bb1a8a5049e7335392ff75c9b0a9ccc18c03866`, based on target `a19c2321d14f1815b29c38e9937166d75f194750`. Evidence capture used the durable repository-external root `G:\vibe\session-analyzer-wave1b-evidence\0bb1a8a5049e7335392ff75c9b0a9ccc18c03866`. The worktree was clean before and throughout capture; every raw artifact reports `dirty: false`, the empty tracked-diff SHA-256, one implementation tree identity, and the exact candidate/target binding. / 唯一干净 candidate commit 为 `0bb1a8a5049e7335392ff75c9b0a9ccc18c03866`，基于 target `a19c2321d14f1815b29c38e9937166d75f194750`。Evidence capture 使用持久的仓库外 root `G:\vibe\session-analyzer-wave1b-evidence\0bb1a8a5049e7335392ff75c9b0a9ccc18c03866`。Capture 前及整个 capture 期间 worktree 均为 clean；每个 raw artifact 都记录 `dirty: false`、空 tracked-diff SHA-256、同一 implementation tree identity 与精确 candidate／target binding。

M4a ran exactly one fresh-process smoke. Its raw artifact is `73428` bytes with SHA-256 `ab5d7debd5f225c69a259e50b6ac0b420baacc643e5cce458af43e3a533316f1`; generic acceptance passed. The immediate smoke-only validator wrote a bound `smoke-validation.json` at `2026-08-30T03:14:33.063Z` with `genericAcceptancePassed: true`, `overlayAcceptancePassed: true`, `passed: true`, and no failures. / M4a 恰好运行一次 fresh-process smoke。其 raw artifact 为 `73428` bytes，SHA-256 为 `ab5d7debd5f225c69a259e50b6ac0b420baacc643e5cce458af43e3a533316f1`；generic acceptance 通过。紧随其后的 smoke-only validator 于 `2026-08-30T03:14:33.063Z` 写入绑定的 `smoke-validation.json`，其中 `genericAcceptancePassed: true`、`overlayAcceptancePassed: true`、`passed: true`，且无 failure。

M4b then ran exactly three fresh independent processes with repetition identities `1/3`, `2/3`, and `3/3`; all exited `0`. The formal validator revalidated the smoke and all runs, then wrote `summary.json` before the non-self-referential `manifest.json`. The summary reports generic acceptance `3/3`, overlay acceptance `3/3`, valid runs `3`, invalid runs `0`, and `numericalLatencyGate: false`. Preload is exactly `2` full renders / `750` card generations in `3/3`; deep structured filter is exactly `1` / `150` in `3/3`; every context zero-work field is zero in `3/3`. Every descriptive duration, Long Task, and union/absent-zero Resource Timing series has `repeatCount: 3`. / M4b 随后恰好运行三个 fresh independent process，repetition identity 分别为 `1/3`、`2/3` 与 `3/3`；全部 exit `0`。Formal validator 重新验证 smoke 与全部 run，随后先写 `summary.json`，再写非自指 `manifest.json`。Summary 报告 generic acceptance `3/3`、overlay acceptance `3/3`、valid run `3`、invalid run `0` 与 `numericalLatencyGate: false`。Preload 在 `3/3` 中精确为 `2` 次 full render／`750` 次 card generation；deep structured filter 在 `3/3` 中精确为 `1`／`150`；全部 context zero-work field 在 `3/3` 中均为零。每项 descriptive duration、Long Task 与 union／absent-zero Resource Timing series 的 `repeatCount` 均为 `3`。

Executor-side independent reopening found zero mismatch after recomputing all six manifest entry byte lengths/SHA-256 values, the closed structural fields for all three runs, and every descriptive series. The manifest indexes only smoke, accepted smoke validation, three formal runs, and summary; it explicitly excludes itself. / Executor 侧独立重开并重新计算全部六个 manifest entry 的 byte length／SHA-256、三次 run 的封闭 structural field 与每项 descriptive series 后，发现零 mismatch。Manifest 只索引 smoke、已接受 smoke validation、三次 formal run 与 summary，并明确排除自身。

Fresh independent M5 reviewer `/root/wave1b_m5_evidence_review` (requested `gpt-5.6-luna`, maximum reasoning) inspected the exact target-to-candidate diff and unchanged call chains, reran focused Node `38/38`, focused Chromium `15/15`, syntax `6/6`, `npm run build:check`, and `git diff --check`, and confirmed the exact 11-path scope with no M6/integration work. It independently rehashed all six entries, revalidated the smoke binding/timestamp/identity and generic/overlay acceptance, parsed formal `3/3`, and recomputed every required structural and descriptive series with zero mismatch. It found no blocker and returned exactly: / 全新独立 M5 reviewer `/root/wave1b_m5_evidence_review`（请求 `gpt-5.6-luna`、maximum reasoning）检查精确 target-to-candidate diff 与 unchanged call chain，重跑 focused Node `38/38`、focused Chromium `15/15`、syntax `6/6`、`npm run build:check` 与 `git diff --check`，并确认精确 11-path scope 且无 M6／integration work。其独立重新 hash 全部六个 entry，重新验证 smoke binding／timestamp／identity 与 generic／overlay acceptance，解析 formal `3/3`，并以零 mismatch 重算每项 required structural 与 descriptive series。其未发现 blocker，并精确返回：

```text
ACCEPTED_FOR_CANDIDATE
INTEGRATION_READY
```

At that M5 stop, M6 documentation closeout, plan archival, design-link updates, additional commits, push, PR, merge, publish, and release were not yet authorized and were not performed. The two post-candidate documentation status edits (`AGENTS.md` and the then-active plan) intentionally remained uncommitted at that stop and did not alter the immutable implementation candidate or its evidence identity. / 在该 M5 停止点，M6 documentation closeout、计划归档、design-link update、额外 commit、push、PR、merge、publish 与 release 尚未获授权且均未执行。两项 candidate 后的 documentation status edit（`AGENTS.md` 与当时的 active plan）在该停止点有意保持未提交，不改变不可变 implementation candidate 或其 evidence identity。

Current stop status: / 当前停止状态：

```text
STOPPED_AFTER_M5_INTEGRATION_READY
```

### M6 documentation-only closeout / M6 仅文档收口

After the user explicitly authorized M6 through the point immediately before push, the closeout changed documentation only. This plan moved from `docs/exec-plans/active/2026-08-29-performance-wave-1b-search-render-coalescing.md` to `docs/exec-plans/completed/2026-08-29-performance-wave-1b-search-render-coalescing.md`; `AGENTS.md` no longer registers Wave 1B as active; and `docs/design-docs/timeline-loading-and-rendering-performance.md` now links the completed plan, records the accepted candidate/evidence/reviewer identities, records the exact structural results, labels all timing as descriptive, and preserves Wave 1C as a separate unimplemented boundary. No executable source, generated asset, evidence artifact, product spec, package metadata, server path, or workflow changed, and no profiling was rerun. / 用户明确授权 M6 至 push 前一刻后，本次 closeout 只修改文档。本计划从 `docs/exec-plans/active/2026-08-29-performance-wave-1b-search-render-coalescing.md` 移至 `docs/exec-plans/completed/2026-08-29-performance-wave-1b-search-render-coalescing.md`；`AGENTS.md` 不再把 Wave 1B 登记为 active；`docs/design-docs/timeline-loading-and-rendering-performance.md` 现已链接 completed plan，记录已接受 candidate／evidence／reviewer identity 与精确 structural result，把全部 timing 标为 descriptive，并保留 Wave 1C 作为独立且尚未实施的 boundary。没有 executable source、生成资产、evidence artifact、product spec、package metadata、server path 或 workflow 变化，也没有重新运行 profiling。

The immutable implementation candidate remains commit `0bb1a8a5049e7335392ff75c9b0a9ccc18c03866`／tree `b3b613a6c9e0c47cb8a2121b307e9fac1bb00edb`, target `a19c2321d14f1815b29c38e9937166d75f194750`, profiled implementation tree hash `14ca40a1d20ad37cccd325b0d1cdd3783391fb06ed32a43b6dd5c48591c2c248`, and runtime asset `296098` bytes／`93ef86006fbcc6a1f7c985cb990ad47437fe26d675c23dc77a0204defa90b318`. Durable evidence root is `G:\vibe\session-analyzer-wave1b-evidence\0bb1a8a5049e7335392ff75c9b0a9ccc18c03866`; manifest is `4105` bytes／`702b2d3a7f7fd8a1dc96496c61630e84c538b6faf9346de22266086ee6d51264`; summary is `7770` bytes／`f4c2245676dcbcbc0b897d377db5b1a3d486cb2ffe1b2bbd353d952547615130`; accepted smoke validation is `3153` bytes／`51858a58b4c0f8050eab66caa4cf91d31e1613702a04b4eae3b396986217b5e7`. Fresh independent M5 reviewer `/root/wave1b_m5_evidence_review` (requested `gpt-5.6-luna`, maximum reasoning) returned exactly `ACCEPTED_FOR_CANDIDATE` then `INTEGRATION_READY`, with no blocker. / 不可变 implementation candidate 继续是 commit `0bb1a8a5049e7335392ff75c9b0a9ccc18c03866`／tree `b3b613a6c9e0c47cb8a2121b307e9fac1bb00edb`，target 为 `a19c2321d14f1815b29c38e9937166d75f194750`，profiled implementation tree hash 为 `14ca40a1d20ad37cccd325b0d1cdd3783391fb06ed32a43b6dd5c48591c2c248`，runtime asset 为 `296098` bytes／`93ef86006fbcc6a1f7c985cb990ad47437fe26d675c23dc77a0204defa90b318`。Durable evidence root 为 `G:\vibe\session-analyzer-wave1b-evidence\0bb1a8a5049e7335392ff75c9b0a9ccc18c03866`；manifest 为 `4105` bytes／`702b2d3a7f7fd8a1dc96496c61630e84c538b6faf9346de22266086ee6d51264`；summary 为 `7770` bytes／`f4c2245676dcbcbc0b897d377db5b1a3d486cb2ffe1b2bbd353d952547615130`；已接受 smoke validation 为 `3153` bytes／`51858a58b4c0f8050eab66caa4cf91d31e1613702a04b4eae3b396986217b5e7`。全新独立 M5 reviewer `/root/wave1b_m5_evidence_review`（请求 `gpt-5.6-luna`、maximum reasoning）精确依次返回 `ACCEPTED_FOR_CANDIDATE` 与 `INTEGRATION_READY`，且无 blocker。

Exact formal hard results remain generic acceptance `3/3`, overlay acceptance `3/3`, invalid runs `0`, preload `2` full renders／`750` card generations, deep filter `1`／`150`, and context reveal zero full renders, card generations, highlight passes, highlight marks, highlighted owners, and target-discovery passes in every run. The closed three-run descriptive observations are recorded in the performance design; every series has `repeatCount = 3` and `numericalLatencyGate = false`. Wave 1C continues to own keyed card lifecycle, incremental DOM append/highlighting, owner-local detail patching, and descriptor/live-binding refinement; M6 did not implement or authorize any of them. / 精确 formal hard result 继续为 generic acceptance `3/3`、overlay acceptance `3/3`、invalid run `0`、preload `2` 次 full render／`750` 次 card generation、deep filter `1`／`150`，以及 context reveal 在每次 run 中的 full render、card generation、highlight pass、highlight mark、highlighted owner 与 target-discovery pass 全为零。封闭三次 run 的 descriptive observation 已记录在 performance design 中；每项 series 的 `repeatCount = 3` 且 `numericalLatencyGate = false`。Wave 1C 继续负责 keyed card lifecycle、增量 DOM append／highlighting、owner-local detail patching 与 descriptor／live-binding refinement；M6 未实施或授权其中任何一项。

M6 closeout gates passed on the exact documentation diff: `npm run build:check` reported generated assets current; `git diff --check` exited `0`; and the documentation/link/path audit found exactly the four expected lifecycle paths (`AGENTS.md`, the performance design, removal of the active plan path, and creation of the completed plan path) with no extra path. The active path is absent, completed path present, active registration removed, completed design link and bilingual results present, final newlines/trailing whitespace valid, and the manifest, summary, and accepted smoke-validation length/SHA-256 records rehashed without drift. / M6 closeout gate 在精确 documentation diff 上通过：`npm run build:check` 报告 generated asset current；`git diff --check` exit `0`；documentation／link／path audit 只发现精确四条预期 lifecycle path（`AGENTS.md`、performance design、删除 active plan path、创建 completed plan path），没有额外 path。Active path 不存在、completed path 存在、active registration 已删除、completed design link 与双语结果均存在、final newline／trailing whitespace 合格，且 manifest、summary 与已接受 smoke-validation 的 length／SHA-256 记录重新 hash 后无漂移。

M6 finishes with one documentation-only closeout commit and an explicit stop before push. Push, PR, merge, publish, release, additional evidence capture, and M7/product implementation remain outside this authorization. / M6 以一个 documentation-only closeout commit 完成，并明确停在 push 前。Push、PR、merge、publish、release、额外 evidence capture 与 M7／product implementation 均不在本次授权范围内。
