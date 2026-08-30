# Performance Wave 1C: keyed Main-timeline append and incremental highlighting / 性能 Wave 1C：Main Timeline keyed append 与增量高亮

## 1. Status, identity, and authorization / 状态、身份与授权

```text
Technical design: ACCEPTED
Repository: Yijia-Zhou/session-analyzer
Target branch: towards-0.2.0
Inspected base: a3297774e35eec57a40a40a47953f743435c27ed
Inspected tree: af09ea4a01c217599ce57ee8b09975b1b0076595
Proposed branch: perf/wave-1c-keyed-main-append
Formal plan: docs/exec-plans/active/2026-08-30-performance-wave-1c-keyed-main-append.md

Implementation authorization: M2 ONLY — EXECUTOR COMPLETE
Implementation branch: perf/wave-1c-keyed-main-append
Active-plan registration: performed in M0
M0: PASS
M1 executor: PASS — OBSERVER-ISOLATION REPAIR COMPLETE
Fresh R1: PASS_M1 — ACCEPTED
M2 executor: PASS
Fresh R2: PASS_M2 — ACCEPTED
M3 gates: PASS — CANDIDATE FREEZE PENDING
```

This is the formal reviewed execution plan. Creating it does not authorize M0 or implementation. M0 owns feature-branch creation and `AGENTS.md` registration and requires separate authorization. This plan alone authorizes no profiling, generated-asset update, commit, push, PR, merge, publish, or release. / 本文是经评审的正式执行计划。创建本文不授权 M0 或实现。Feature branch 创建与 `AGENTS.md` 登记归 M0 所有，且需要另行授权。本计划本身不授权 profiling、生成资产更新、commit、push、PR、merge、publish 或 release。

Before implementation, M0 must resolve live `towards-0.2.0`, require the inspected base to remain an ancestor, and inspect relevant descendant drift. Relevant drift includes Timeline-root writes, browser rendering, search/highlight ownership, detail/folding presentation, Wave 1B batching, browser tests, generated-client semantics, profiling compatibility, and performance documentation. / 实现前，M0 必须解析 live `towards-0.2.0`，要求 inspected base 仍为其祖先，并检查相关 descendant drift。相关 drift 包括 Timeline-root 写入、browser rendering、search／highlight ownership、detail／folding presentation、Wave 1B batching、browser test、生成 client 语义、profiling compatibility 与性能文档。

---

## 2. Objective / 目标

Reduce the remaining warm-browser whole-prefix presentation work after accepted Wave 1B by introducing keyed presentation ownership for mounted canonical Main Timeline cards and using it for safe same-context canonical suffix append. / 在已接受 Wave 1B 的基础上，为已挂载 canonical Main Timeline card 建立 keyed presentation ownership，并用于安全展示同 context canonical suffix，从而减少 warm browser 中剩余的整段前缀 presentation 工作。

A successful eligible Main append must: / 成功的 eligible Main append 必须：

- preserve the exact DOM object identity of every valid pre-existing canonical Main article;
- create article DOM only for newly appended canonical events;
- preserve valid existing search target objects, bindings, and mark nodes;
- discover descriptors only for the suffix, using canonical Timeline indices;
- highlight and bind only newly appended searchable owners;
- preserve valid focus, selection, scroll, loaded detail DOM, context-reveal DOM, and other mounted presentation;
- retain explicit full-root replacement as fallback for replacements, incompatible contexts, parity failure, or presentation failure.

- 保留每个有效旧 canonical Main article 的精确 DOM object identity；
- 只为新增 canonical event 创建 article DOM；
- 保留有效旧 search target object、binding 与 mark node；
- 只为 suffix discovery descriptor，并使用 canonical Timeline index；
- 只 highlight／bind 新增 searchable owner；
- 在有效时保留 focus、selection、scroll、已加载 detail DOM、context-reveal DOM 与其它 mounted presentation；
- 对 replacement、不兼容 context、parity failure 或 presentation failure 保留显式完整 root replacement fallback。

Wave 1C also removes the immediately redundant explicit `refreshSearchHighlights()` after `renderTimeline()` in the two search-target detail-materialization paths because `renderTimeline()` already owns one complete refresh. / Wave 1C 同时删除两个 search-target detail-materialization 路径中紧跟 `renderTimeline()` 的冗余显式 `refreshSearchHighlights()`，因为 `renderTimeline()` 已负责一次完整 refresh。

Wave 1C does **not** implement owner-local detail, fold, selection, or presentation patching. Existing transitions that currently require a full `renderTimeline()` may continue to replace DOM. Within the exact same mounted canonical context, retained owner objects may survive such a full render while their node references are replaced. Local patching remains Wave 1D. / Wave 1C **不实施** owner-local detail、fold、selection 或 presentation patch。现有 transition 若当前需要完整 `renderTimeline()`，仍可替换 DOM。在精确相同的 mounted canonical context 内，保留的 owner object 可跨该 full render 存活，但其 node reference 必须更新。局部 patch 继续归 Wave 1D。

---

## 3. Governing authority and inherited contracts / 权威文档与继承合同

At M0 reread the implementation-ref versions of: / M0 复读以下 implementation-ref 版本：

```text
README.md
AGENTS.md
CONTEXT.md
docs/product-specs/session-transcript-analyzer.md
docs/design-docs/timeline-loading-and-rendering-performance.md
docs/design-docs/logical-event-timeline.md
docs/design-docs/indexed-materialized-session-lifecycle.md
docs/exec-plans/completed/2026-08-24-performance-wave-0-baseline.md
docs/exec-plans/completed/2026-08-27-performance-wave-1a-browser-hot-path.md
docs/exec-plans/completed/2026-08-29-performance-wave-1b-search-render-coalescing.md
package.json
scripts/build-client.js
scripts/timeline-profile.js
scripts/performance-wave-0-runner.js
scripts/performance-wave-1b-validator.js
```

Wave 1A remains authoritative for canonical Timeline data ownership: / Wave 1A 继续权威定义 canonical Timeline data ownership：

```text
currentEvents
currentEventsById
offset
timelineDataContext
```

Wave 1B remains authoritative for search-owned batch-local accumulation, one canonical append publication per accepted batch, invocation/generation ownership, stale/abort zero-publication behavior, the three preload/navigation/load-more policies, and the current full-render fallback. Wave 1C must not change canonical ownership or Wave 1B batch semantics. / Wave 1B 继续权威定义 search-owned batch-local accumulation、每个 accepted batch 精确一次 canonical append publication、invocation／generation ownership、stale／abort zero-publication、三种 preload／navigation／load-more policy 与当前 full-render fallback。Wave 1C 不得改变 canonical ownership 或 Wave 1B batch 语义。

Wave 1C adds a separate presentation-ownership layer. DOM, card owners, context rows, marks, and bindings never become canonical data writers. / Wave 1C 新增独立 presentation-ownership layer。DOM、card owner、context row、mark 与 binding 永不成为 canonical data writer。

---

## 4. Motivation and current residual / 动机与当前剩余工作

Accepted descriptive medians show that Wave 1B reduced search paging amplification but left browser presentation as the dominant late-hit residual: / 已接受的描述性中位数表明 Wave 1B 降低了 search paging amplification，但 browser presentation 仍是 late-hit 的主要剩余工作：

```text
Wave 1A
  warmSearchPreload: duration 1351 ms; Long Task total 456 ms
  warmJumpToLateHit: duration 9615 ms; Long Task total 9093 ms

Wave 1B
  warmSearchPreload: duration 1087 ms; Long Task total 189 ms
  warmJumpToLateHit: duration 6573 ms; Long Task total 5895 ms

Wave 1B late-hit Resource Timing
  timeline ~107 ms
  detail   ~319 ms
```

Wave 1B changed repeated page-by-page whole-prefix renders into one accepted batch publication followed by one whole-prefix render. A same-context append still ends with `renderTimeline()`, which rebuilds every mounted card, synchronizes presentation, queues visible detail, and globally clears/discovers/highlights/rebinds search. Wave 1C targets that final whole-prefix presentation only when a Main suffix append is provably compatible. / Wave 1B 将逐页重复整段前缀 render 改为一次 accepted batch publication 加一次整段前缀 render。同 context append 目前仍以 `renderTimeline()` 结束；该函数重建全部 mounted card、同步 presentation、排队 visible detail，并全局 clear／discover／highlight／rebind search。Wave 1C 只在 Main suffix append 可证明兼容时优化这次最终整段 presentation。

---

## 5. Included changes and explicit non-goals / 包含改动与明确非目标

Wave 1C contains these bounded runtime changes: / Wave 1C 包含以下有界 runtime 改动：

1. one app-owned boundary for every Timeline-root replacement or clear;
2. a Main-only keyed card-owner registry integrated into production full renders in M1;
3. a fixed-width O(1) mounted presentation compatibility token;
4. eligible same-context Main suffix append through one atomic `DocumentFragment` insertion;
5. suffix-only descriptor discovery and root-scoped highlighting/binding;
6. safe full-render fallback after eligibility uncertainty or append failure;
7. removal of the two redundant explicit post-render highlight refreshes.

1. 由一个 app-owned boundary 负责每次 Timeline-root replacement 或 clear；
2. 只属于 Main 的 keyed card-owner registry，并在 M1 接入 production full render；
3. 固定宽度、O(1) 的 mounted presentation compatibility token；
4. 通过一次原子 `DocumentFragment` insertion 实施 eligible 同 context Main suffix append；
5. suffix-only descriptor discovery 与 root-scoped highlighting／binding；
6. 对 eligibility 不确定或 append failure 使用安全 full-render fallback；
7. 删除两处冗余显式 post-render highlight refresh。

Wave 1C must not implement: / Wave 1C 不得实施：

```text
owner-local detail arrival patch
owner-local expand/collapse or Folding Strategy patch
owner-local Code Mode presentation refinement
selection-specific card reconstruction
visible-detail geometry-scan redesign
Raw or Protocol incremental append
Raw fork-heading incremental ownership
virtualization or render windows
sparse loading or cursor transport
API/server/query/cache/index changes
Materialized Session derived indexes
timeline-event-state redesign
Wave 1B batch-policy changes
package/lockfile/workflow/product-spec changes
generic Timeline profiler schema evolution
```

Wave 1D owns owner-local detail/fold/presentation patching, selection-local presentation refinement, and visible-detail scan refinement. Virtualization remains deferred until keyed append and Wave 1D residuals have been measured. / Wave 1D 负责 owner-local detail／fold／presentation patch、selection-local presentation refinement 与 visible-detail scan refinement。Virtualization 继续推迟，直至 keyed append 与 Wave 1D residual 得到测量。

---

## 6. Unified Timeline-root ownership boundary / 统一 Timeline-root ownership boundary

Wave 1C must not manage owners only around `renderTimeline()`. All direct replacement or clearing of `#timeline` must pass through one app-owned presentation boundary. After M1, no raw `el.timeline.innerHTML = ...`, `el.timeline.replaceChildren(...)`, equivalent root clear, or root replacement may remain outside that boundary, except the separately controlled atomic suffix insertion operation. / Wave 1C 不得只在 `renderTimeline()` 周围管理 owner。所有 `#timeline` 的直接 replacement 或 clear 必须通过同一个 app-owned presentation boundary。M1 后，不得在该 boundary 之外保留原始 `el.timeline.innerHTML = ...`、`el.timeline.replaceChildren(...)`、等效 root clear 或 replacement；唯一例外是受单独控制的原子 suffix insertion operation。

The boundary must own at least: / 该 boundary 至少覆盖：

```text
normal Session Timeline full rendering
renderProjectSearchView()
resetProjectViewState()
empty-Session rendering
Project Scope transitions
return from Project Scope to Session Scope
index-revision recovery
Layer transitions
```

Conceptually: / 概念上：

```text
replaceTimelineRoot(..., mode)

mode = main
  replace root DOM
  reconcile canonical Main owners under canonical-context rules
  record mounted canonical context
  record mounted fixed-width presentation token

mode = non-main
  synchronously retire every Main owner
  release all stored node references
  replace or clear root DOM
  registry remains empty

appendMainTimelineSuffix(...)
  the only controlled live-root append operation
```

`timelineCardOwnersById` exists only for mounted canonical Main Timeline cards: / `timelineCardOwnersById` 只属于已挂载 canonical Main Timeline card：

```text
Main Session Timeline  -> registry may be populated
Protocol               -> registry empty
Raw                    -> registry empty
Project Scope          -> registry empty
Project chooser/reset  -> registry empty
empty Session          -> registry empty
```

Switching away from Main must retire owners synchronously even if canonical Session data has not yet been reset. Root replacement must never leave a registry claiming nodes outside its mounted Main root. M0 records the complete current root-write inventory; M1 proves the final source contains no unowned root writer. / 离开 Main 时，即使 canonical Session data 尚未 reset，也必须同步 retire owner。Root replacement 不得留下继续声称拥有 mounted Main root 之外 node 的 registry。M0 记录当前完整 root-write inventory；M1 证明最终源码不存在无 owner 的 root writer。

---

## 7. Main card lifecycle module and owner shape / Main card lifecycle module 与 owner 形状

Add a browser-compatible, DOM-light module and direct Node tests: / 新增 browser-compatible、DOM-light module 与直接 Node test：

```text
src/browser/timeline-card-lifecycle.js
test/timeline-card-lifecycle.test.js
```

The module may store opaque node references but must not depend directly on `window`, application `state`, fetch, timers, localization, search parsing, canonical arrays, or transcript content. / 模块可存储 opaque node reference，但不得直接依赖 `window`、application `state`、fetch、timer、localization、search parsing、canonical array 或 transcript content。

Each owner contains at least: / 每个 owner 至少包含：

```text
eventId
articleNode
contextSlotNode | null
mountedCanonicalContext
mountedPresentationToken
```

`contextSlotNode` is nullable. An event without an enclosing-operation context slot is valid and must not fail parity. Owner identity is stable only while retained within one exact mounted canonical context. / `contextSlotNode` 可为 null。没有 enclosing-operation context slot 的 event 仍然有效，不得导致 parity failure。Owner identity 只在同一个精确 mounted canonical context 内被保留时稳定。

Required lifecycle operations: / 必需 lifecycle operation：

1. retire/reset all owners and release references;
2. reconcile a successful Main full render;
3. register an atomically appended suffix;
4. exact owner lookup by event ID;
5. retire missing owners without retaining stale nodes;
6. content-free parity/snapshot validation;
7. fixed-cost mounted-context/token equality without scanning owners.

1. retire／reset 全部 owner 并释放 reference；
2. reconcile 成功的 Main full render；
3. 注册原子 append 的 suffix；
4. 按 event ID 精确查找 owner；
5. retire 缺失 owner，且不保留 stale node；
6. content-free parity／snapshot validation；
7. 不扫描 owner 即可进行 fixed-cost mounted context／token equality。

The registry never owns temporary event reveals, project-return banners, inherited-context cards, context parent rows as separate canonical owners, Protocol cards, Raw structures, or other noncanonical presentation. A context slot belongs to its canonical event owner and is not a second owner. / Registry 永不拥有 temporary event reveal、project-return banner、inherited-context card、作为独立 canonical owner 的 context parent row、Protocol card、Raw structure 或其它 noncanonical presentation。Context slot 属于其 canonical event owner，不是第二个 owner。

---

## 8. Canonical-context-scoped owner reuse / 仅限 canonical context 的 owner 复用

Event ID equality alone is never sufficient to reuse a presentation owner. Main full-render reconciliation first compares the previous `mountedCanonicalContext` with the newly mounted committed canonical context. / 仅 event ID 相等永远不足以复用 presentation owner。Main full-render reconciliation 必须先比较之前的 `mountedCanonicalContext` 与新挂载的 committed canonical context。

### 8.1 Same canonical context / 相同 canonical context

If the exact canonical context is unchanged, reconciliation may reuse an existing owner object by event ID. For each reused owner: / 若精确 canonical context 未变化，reconciliation 可按 event ID 复用已有 owner object。对每个复用 owner：

```text
owner object identity may remain stable
articleNode/contextSlotNode references update to the new mount
old detached DOM references are released
mountedPresentationToken becomes the newly rendered token
```

A presentation-token change inside the same canonical context does not force owner retirement. The full render replaces DOM and re-establishes retained owners under the new token. Owners missing from the new canonical Main mount are retired. / 同 canonical context 内 presentation token 变化不强制 retire owner。Full render 替换 DOM，并在新 token 下重新建立 retained owner。新 canonical Main mount 中缺失的 owner 必须 retire。

### 8.2 Different canonical context / 不同 canonical context

If the canonical context differs, reconciliation must retire every previous owner, release every previous node reference, create a fresh registry, and create fresh owners for the new Main mount. No owner object crosses this boundary, even when an event ID is byte-for-byte equal in both contexts. / 若 canonical context 不同，reconciliation 必须 retire 全部旧 owner、释放全部旧 node reference、创建全新 registry，并为新 Main mount 创建全新 owner。任何 owner object 都不得跨越该 boundary，即使两个 context 中存在 byte-for-byte 相同的 event ID。

This covers different Sessions, committed Timeline data contexts, query/filter replacements represented by a new canonical context, and Layer/context transitions that later return to Main under a different committed context. / 该规则覆盖不同 Session、不同 committed Timeline data context、由新 canonical context 表示的 query／filter replacement，以及离开后在不同 committed context 下返回 Main 的 Layer／context transition。

A focused test deliberately mounts two distinct canonical contexts containing the same event ID and proves: / focused test 故意在两个不同 canonical context 中使用相同 event ID，并证明：

```text
oldOwner !== newOwner
oldOwner.articleNode is not retained
newOwner.articleNode belongs to the new mount
```

---

## 9. Fixed-width O(1) presentation compatibility token / 固定宽度 O(1) presentation compatibility token

Incremental eligibility must not serialize, hash, sort, scan, or compare event-sized/application-sized presentation state. It must not enumerate the full overrides object, transient-expansion IDs, owner registry, detail/error cache, DOM, or mounted cards merely to decide compatibility. / Incremental eligibility 不得 serialize、hash、sort、scan 或 compare event-sized／application-sized presentation state。不得仅为判断 compatibility 而枚举完整 overrides object、transient-expansion ID、owner registry、detail／error cache、DOM 或 mounted card。

The app owns a fixed-width tuple of content-free scalar revisions/tokens. Comparison cost is O(1) with respect to Session size, mounted-card count, detail-cache size, transient-expansion count, and override count. / App 拥有固定宽度的 content-free scalar revision／token tuple。其比较成本相对于 Session size、mounted-card count、detail-cache size、transient-expansion count 与 override count 均为 O(1)。

Conceptually: / 概念上：

```text
mountedPresentationToken = {
  localePresentationToken,
  foldingPresentationRevision,
  overridesRevision,
  navigationRevealRevision,
  searchTransientRevision,
  temporaryRevealRevision,
  detailPresentationRevision
}
```

Equivalent fixed-width scalar naming is allowed. The registry stores a scalar snapshot; eligibility compares the tuple field-by-field or through an equivalent fixed-width primitive. It must not create equality by serializing variable-sized state. Revisions are content-free safe integers, monotonic for the application lifetime, and never decremented or restored when logical state returns to an earlier value. Overflow fails closed into full render rather than wrapping. / 允许使用等价 fixed-width scalar 命名。Registry 存储 scalar snapshot；eligibility 逐字段比较 tuple，或使用等价 fixed-width primitive。不得通过序列化 variable-sized state 构造 equality。Revision 是 content-free safe integer，在 application lifetime 内单调递增；逻辑状态回到旧值时也不递减或恢复旧 revision。Overflow 必须 fail closed 到 full render，不得 wrap。

All revision advancement is app-owned, synchronous with the corresponding state mutation, and centralized through named helpers or equivalently auditable mutation boundaries. M1 inventories every direct write and routes it through its revision-owning boundary. / 所有 revision advancement 均由 app 所有，与对应 state mutation 同步，并通过命名 helper 或等价、可审计的 mutation boundary 集中管理。M1 inventory 每个直接写点，并接入其 revision-owning boundary。

### 9.1 Locale presentation token / Locale presentation token

The fixed tuple includes the resolved locale scalar or an app-owned monotonic locale revision. It changes synchronously through app-state locale application and the locale-change transition. Locale remains in canonical Timeline context as well; duplicate coverage is conservative. No translated content enters the token. / 固定 tuple 包含 resolved locale scalar，或 app-owned monotonic locale revision。通过 app-state locale application 与 locale-change transition 改变 locale 时，它同步变化。Locale 同时继续属于 canonical Timeline context；重复覆盖属于保守失效。Token 不包含翻译内容。

### 9.2 `foldingPresentationRevision`

Advance synchronously whenever active Folding Strategy state capable of changing Main card folding/presentation changes, including: / 只要可能改变 Main card folding／presentation 的 active Folding Strategy state 变化，就同步递增：

```text
active profile / Folding Strategy change
active draft rule edit: fallback, kind, Code Mode request, condition
save of active profile rules
cancel/discard/reset transition whose rendered rules may differ
profile-draft replacement that changes the active rendered rule source
```

The semantic write points include the active-profile transition, every active profile-rule input handler, save, cancel, and future reset/discard paths that change rules used by `activeProfileRules()`. Initial cloning with no rendered-state change need not advance; uncertainty advances conservatively. Returning to previous rules never restores an earlier revision. / 语义写点包括 active-profile transition、每个 active profile-rule input handler、save、cancel，以及未来改变 `activeProfileRules()` 所用规则的 reset／discard path。仅初始 clone 且 rendered state 不变时可不递增；不确定时保守递增。回到旧规则永不恢复旧 revision。

### 9.3 `overridesRevision`

Advance synchronously whenever persisted display overrides relevant to the selected Session are added, changed, removed, normalized into a different rendered value, or reset. Write points include `setOverride()`, current-Session override clearing, reset-folds behavior, profile transitions that clear current-Session overrides, and future selected-Session override mutations. Callers know whether they perform a semantic mutation; eligibility never inspects or serializes the overrides map. / Selected Session 相关 persisted display override 被新增、修改、删除、normalize 成不同 rendered value 或 reset 时同步递增。写点包括 `setOverride()`、当前 Session override clear、reset-folds 行为、会 clear 当前 Session override 的 profile transition，以及未来 selected-Session override mutation。Caller 知道自己是否执行语义 mutation；eligibility 永不检查或序列化 overrides map。

### 9.4 `navigationRevealRevision`

Advance whenever navigation-event reveal state is created, replaced, or cleared. Creation/replacement and `clearNavigationEventReveal()` are the auditable write boundaries. A proven no-op clear need not advance; uncertainty may advance conservatively. / navigation-event reveal state 被创建、替换或 clear 时递增。Creation／replacement 与 `clearNavigationEventReveal()` 是可审计写点。已证明的 no-op clear 可不递增；不确定时可保守递增。

### 9.5 `searchTransientRevision`

Advance whenever search transient-expansion state is added, removed, replaced, reconciled to a different value, or reset. `addSearchTransientExpansion()`, `clearSearchTransientExpansion()`, `resetSearchTransientExpansions()`, and every state-object replacement own these writes. Eligibility never compares or serializes the expansion-ID collection. / search transient-expansion state 被 add、remove、replace、reconcile 成不同值或 reset 时递增。`addSearchTransientExpansion()`、`clearSearchTransientExpansion()`、`resetSearchTransientExpansions()` 与每次 state-object replacement 负责这些写点。Eligibility 永不比较或序列化 expansion-ID collection。

### 9.6 `temporaryRevealRevision`

Advance whenever temporary-event reveal state is created, replaced, promoted to canonical and cleared, reconciled to a different value, explicitly cleared, or reset during replacement/transition. Every direct `temporaryEventReveal` assignment moves behind auditable mutation helpers or advances the revision at the exact write. / temporary-event reveal state 被创建、替换、promote 为 canonical 后 clear、reconcile 成不同值、显式 clear 或在 replacement／transition 中 reset 时递增。每个直接 `temporaryEventReveal` assignment 必须移入可审计 mutation helper，或在精确写点递增 revision。

### 9.7 `detailPresentationRevision`

Advance synchronously for every mutation that may change Timeline-card presentation derived from detail/error state. At minimum: / 每次可能改变由 detail／error state 派生的 Timeline-card presentation 的 mutation 都同步递增。至少包括：

```text
successful detail-cache write
detail-error write
deletion of detail and/or error state before retry
complete detail/error cache reset
Session/detail-generation reset
```

Semantic write points are the ownership-validated success and error branches of `loadEventDetail()`, both Timeline and Inspector retry/delete actions, `resetSessionDetailCache()`, and every future path mutating timeline-relevant detail/error state. A retry action may advance once for its atomic semantic deletion even when deleting both cache and error entries. A complete reset advances even when caches were empty because it establishes a new detail generation. / 语义写点包括 `loadEventDetail()` 通过 ownership validation 的 success 与 error branch、Timeline 与 Inspector 的 retry／delete action、`resetSessionDetailCache()`，以及未来每个修改 timeline-relevant detail／error state 的路径。一次 retry action 即使同时删除 cache 与 error entry，也可按一次原子语义 deletion 递增一次。完整 reset 即使旧 cache 为空也必须递增，因为它建立新的 detail generation。

This revision conservatively covers Code Mode/web-search compact presentation derived from detail projections. False-negative eligibility is acceptable; stale presentation is not. It never scans detail caches to determine relevance. / 该 revision 保守覆盖由 detail projection 派生的 Code Mode／web-search compact presentation。False-negative eligibility 可接受，stale presentation 不可接受。不得通过扫描 detail cache 判断 relevance。

### 9.8 Eligibility comparison and O(1) proof / Eligibility 比较与 O(1) 证明

Eligibility performs only fixed-cost comparisons: / Eligibility 只执行 fixed-cost comparison：

```text
registry.mountedCanonicalContext
  === current committed canonical context

and fixed-width scalar equality for

registry.mountedPresentationToken
  === current presentation token
```

Owner/card prefix parity is a separate correctness validation; presentation compatibility determination itself never enumerates variable-sized presentation state. Focused tests install throwing/counting iteration/serialization traps on relevant collections at multiple sizes and prove token capture/comparison performs zero collection enumeration. / Owner／card prefix parity 是独立 correctness validation；presentation compatibility determination 本身永不枚举 variable-sized presentation state。Focused test 在多个 size 下为相关 collection 安装 throwing／counting iteration／serialization trap，并证明 token capture／comparison 的 collection enumeration 为零。

---

## 10. Owner/card parity and mounted-prefix proof / Owner/card parity 与 mounted-prefix 证明

For a mounted canonical Main Timeline: / 对已挂载 canonical Main Timeline：

```text
ownerCount === mounted canonical Main article count

owner.eventId === article.dataset.eventId
owner.articleNode === exact mounted article
owner.articleNode.isConnected === true

if an enclosing context slot exists:
  owner.contextSlotNode === exact mounted slot
  owner.contextSlotNode.isConnected === true
otherwise:
  owner.contextSlotNode === null
```

Append eligibility also proves mounted article order corresponds exactly to the pre-append canonical prefix and each prefix owner points to the exact mounted node. The append call receives or captures the pre-commit prefix length/identity boundary; it never guesses after partial presentation mutation. Parity failure selects one full-render fallback rather than partial repair. / Append eligibility 还证明 mounted article order 与 pre-append canonical prefix 精确对应，且每个 prefix owner 指向精确 mounted node。Append call 接收或捕获 pre-commit prefix length／identity boundary；永不在 partial presentation mutation 后猜测。Parity failure 选择一次 full-render fallback，而非 partial repair。

---

## 11. Shared Main card markup and adjacency boundary / 共享 Main card markup 与 adjacency boundary

Do not maintain separate full-render and append templates. Refactor the current inline event-card rendering into one shared presentation helper used by Main full render and Main suffix fragment creation for classes, chips, timestamps, previews, enclosing-operation affordance, nullable context slot, body/detail loading state, footer actions, and Code Mode presentation. / 不得维护独立 full-render 与 append template。将当前 inline event-card rendering 重构为共享 presentation helper，供 Main full render 与 Main suffix fragment creation 共同生成 class、chip、timestamp、preview、enclosing-operation affordance、nullable context slot、body／detail loading state、footer action 与 Code Mode presentation。

The inspected Main markup does not depend on the next Main event. Raw fork-segment headings are adjacency-sensitive and remain in the Raw full-render path. Main compact Code Mode/web-search lifecycle presentation derives from detail-cache projection references rather than append adjacency and is protected by `detailPresentationRevision`. Therefore no tail-card reconstruction exception is permitted: every pre-existing canonical Main article must survive an eligible append. / 经检查，Main markup 不依赖下一个 Main event。Raw fork-segment heading 对 adjacency 敏感，继续留在 Raw full-render path。Main compact Code Mode／web-search lifecycle presentation 来自 detail-cache projection reference，而非 append adjacency，并由 `detailPresentationRevision` 保护。因此不得引入 tail-card reconstruction 例外：eligible append 必须保留每个旧 canonical Main article。

If implementation discovers another Main prefix card whose required markup depends on newly appended suffix data, stop for design review rather than weakening node-identity acceptance. / 若实现发现另一个 Main prefix card 的必需 markup 依赖新增 suffix data，必须停止并进行设计评审，不得削弱 node-identity acceptance。

---

## 12. Incremental Main append eligibility / 增量 Main append eligibility

Use incremental append only when every condition holds: / 仅当以下每项条件均成立时使用 incremental append：

```text
search scope == session
active Layer == Main
canonical operation == append
timelineDataContext remains committed/current
append is a true contiguous suffix

registry.mountedCanonicalContext
  == current committed canonical context

registry.mountedPresentationToken
  == current fixed-width presentation token

existing Main owner/card/order parity passes
mounted prefix exactly matches the pre-append canonical prefix
no temporary reveal or incompatible presentation condition
no known root transition/replacement in progress
```

Mandatory full-render fallback includes Session replacement, canonical-context change, Layer change, structured-filter replacement, free-text query replacement, locale change, incompatible renderer context, Protocol, Raw, Project Scope, empty Session, temporary canonical-reference reveal whose ordering is ambiguous, owner/card/order parity failure, presentation-token mismatch, fragment/markup failure, registration failure, and any uncertainty. / 强制 full-render fallback 包括 Session replacement、canonical-context change、Layer change、structured-filter replacement、free-text query replacement、locale change、不兼容 renderer context、Protocol、Raw、Project Scope、empty Session、ordering 模糊的 temporary canonical-reference reveal、owner／card／order parity failure、presentation-token mismatch、fragment／markup failure、registration failure 与任何不确定状态。

Correct fallback is preferable to an unsafe incremental path. Eligibility is not mandatory merely to improve metrics. / 正确 fallback 优先于不安全 incremental path。不得仅为改善指标而强制 eligibility。

---

## 13. Canonical commit, detached preparation, and atomic publication / Canonical commit、detached preparation 与原子 publication

Canonical state remains authoritative. Order: / Canonical state 继续权威。顺序为：

```text
1. validate request/generation ownership as today
2. capture the accepted pre-append canonical boundary
3. commit canonical suffix through the existing timeline-event-state boundary
4. attempt compatible incremental presentation
5. on success, finalize append presentation
6. on uncertainty/failure, execute one full-render fallback
```

Never roll canonical data back because presentation failed. / 永不因 presentation failure 回滚 canonical data。

Before touching the live root, the append operation must: / 接触 live root 前，append operation 必须：

```text
build the complete suffix DocumentFragment detached from #timeline
validate exact expected suffix IDs and order
prevalidate lifecycle ownership conflicts and registration inputs
capture all node/slot references needed for registration
prepare narrowed synchronization and descriptor inputs
```

No live-root mutation occurs during detached preparation. A successful eligible publication performs exactly one live insertion of the complete `DocumentFragment`. It may not append one card at a time or perform a second operation-owned root insertion. / Detached preparation 期间不得 mutation live root。成功 eligible publication 只对完整 `DocumentFragment` 执行一次 live insertion。不得逐 card append，也不得执行第二次 operation-owned root insertion。

### Presentation failure semantics / Presentation failure 语义

```text
detached preparation failure:
  no root mutation
  canonical suffix remains committed
  → one full-render fallback

unexpected post-insertion failure:
  canonical suffix remains committed
  discard/reconcile failed presentation state
  → one full-render fallback
  → owner/card parity restored
```

If fallback itself throws, surface the existing presentation error rather than inventing canonical rollback. / 若 fallback 自身 throw，则 surface 现有 presentation error，不发明 canonical rollback。

---

## 14. Closed append-finalization contract / 封闭 append-finalization contract

Successful live publication follows this complete contract: / 成功 live publication 遵循以下完整合同：

```text
atomic suffix DocumentFragment insertion
→ register newly mounted owners
→ narrowed context-slot synchronization
→ narrowed enclosing-affordance synchronization
→ establish/confirm Timeline search-surface readiness
→ suffix-only descriptor discovery
→ suffix-owner highlighting and live binding
→ preserve/reconcile active target
→ update relevant search controls
→ queueVisibleDetailLoad()
```

`queueVisibleDetailLoad()` is mandatory. Wave 1C intentionally retains its existing all-card geometry scan; optimizing that scan belongs to Wave 1D. No new eager detail-request family may be introduced. / `queueVisibleDetailLoad()` 是强制步骤。Wave 1C 有意保留现有 all-card geometry scan；优化该 scan 属于 Wave 1D。不得新增 eager detail-request family。

After successful finalization, existing callers continue current post-presentation work such as `convergeSelectedEventDetailView(...)`, pagination settlement, result-summary update, and existing preload/navigation control flow. The ordering must make suffix marks synchronously bindable before navigation activation/reveal. / 成功 finalization 后，现有 caller 继续当前 post-presentation work，例如 `convergeSelectedEventDetailView(...)`、pagination settlement、result-summary update 与既有 preload／navigation control flow。该顺序必须使 suffix mark 在 navigation activation／reveal 前可同步 bind。

A focused Chromium case appends a newly visible expanded event or Code Mode operation and proves the existing detail hydration request begins after incremental append. / focused Chromium case 必须 append 一个新 visible expanded event 或 Code Mode operation，并证明既有 detail hydration request 在 incremental append 后开始。

---

## 15. Search descriptor discovery and canonical suffix indices / Search descriptor discovery 与 canonical suffix index

Extend the existing API: / 扩展现有 API：

```text
searchTargets.discover(
  existingTargets,
  searchKey,
  suffixEvents,
  { baseTimelineIndex }
)
```

For each event: / 对每个 event：

```text
timelineIndex =
  explicit finite event.timelineIndex
  if present
  else baseTimelineIndex + suffixLocalIndex
```

Default behavior without options remains equivalent to today with `baseTimelineIndex = 0`, including existing numeric coercion semantics unless separately reviewed. / 不传 options 时保持与当前等价，`baseTimelineIndex = 0`；除非另行评审，也保持现有 numeric coercion 语义。

Hard equivalence for real timeline-style DTOs without `timelineIndex`: / 对没有 `timelineIndex` 的真实 timeline-style DTO，硬等价为：

```text
discover(allEvents once)

==

discover(prefix)
then discover(suffix, baseTimelineIndex = prefix.length)
```

Equivalence covers target IDs, order, canonical indices, duplicate suppression, and existing target object identity. Explicit finite `event.timelineIndex` continues to win. / 等价覆盖 target ID、order、canonical index、duplicate suppression 与 existing target object identity。显式 finite `event.timelineIndex` 继续优先。

---

## 16. Root-scoped incremental highlighting and navigation / Root-scoped 增量高亮与 navigation

`src/browser/highlight.js` already supports root-scoped `clear(root)` and `apply(root, terms)` and remains expected unchanged. / `src/browser/highlight.js` 已支持 root-scoped `clear(root)` 与 `apply(root, terms)`，预期保持不变。

For an eligible append under a stable search key: / 对 stable search key 下的 eligible append：

```text
preserve existing target objects
preserve existing binding arrays and live nodes
preserve existing mark DOM nodes
preserve state.searchHighlight existing marks

discover only suffix descriptors
apply highlighter only to new searchable owner.articleNode roots
bind only newly created marks
append new marks to searchHighlight state
```

Do not globally `resetBindings(all)`, `clear(all)`, `discover(all currentEvents)`, or highlight every owner during successful append. / 成功 append 期间不得全局 `resetBindings(all)`、`clear(all)`、`discover(all currentEvents)` 或 highlight 全部 owner。

If the active target belongs to the preserved prefix, preserve `activeTargetId`, target object identity, live binding, mark node identity, and active class. If navigation selects a new suffix target, its owner must already be mounted and its mark synchronously bindable before reveal/scroll. Wave 1B generation/invocation ownership remains unchanged. / 若 active target 属于保留 prefix，则保留 `activeTargetId`、target object identity、live binding、mark node identity 与 active class。若 navigation 选择新 suffix target，其 owner 必须已挂载，且 mark 必须在 reveal／scroll 前可同步 bind。Wave 1B generation／invocation ownership 保持不变。

---

## 17. Context, selection, focus, scroll, and detail / Context、selection、focus、scroll 与 detail

An eligible append preserves existing prefix context-reveal slots and active context-row DOM. Context-slot and enclosing-affordance synchronization narrows to new owners; a full-render fallback may retain global synchronization. Context-reveal pending state may remain locally synchronized rather than invalidating the presentation token. / Eligible append 保留 prefix 现有 context-reveal slot 与 active context-row DOM。Context-slot 与 enclosing-affordance synchronization 缩小到新 owner；full-render fallback 可继续全局同步。Context-reveal pending state 可继续局部同步，不必 invalidate presentation token。

`updateSelectedTimelineEvent()` remains the selection-local path. Selection does not invalidate the presentation token. New suffix markup reflects current selection if the selected ID is newly mounted. / `updateSelectedTimelineEvent()` 继续作为 selection-local path。Selection 不 invalidate presentation token。若 selected ID 在 suffix 中新挂载，新 markup 反映当前 selection。

Hard preservation on successful append: / 成功 append 的硬保留要求：

```text
beforeArticle[eventId] === afterArticle[eventId]
document.activeElement before === document.activeElement after
selected prefix article is the same object
valid existing detail/body subtree remains the same DOM
valid context reveal slot/row remains the same DOM
existing mark node remains the same DOM
scrollTop is not manually reset
```

Browser-native scroll-height/anchoring effects and explicit existing navigation behavior remain allowed; Wave 1C introduces no app-owned append scroll reset. / 允许 browser-native scroll-height／anchoring effect 与显式既有 navigation 行为；Wave 1C 不引入 app-owned append scroll reset。

Existing detail settlement may still call `renderTimeline()` and replace card DOM. Full-render lifecycle reconciles owners under Sections 8–9. Wave 1C acceptance does not require detail arrival to preserve article node identity; that is Wave 1D. Stale detail ownership and final detail content remain unchanged. / 现有 detail settlement 仍可调用 `renderTimeline()` 并替换 card DOM。Full-render lifecycle 按第 8–9 节 reconcile owner。Wave 1C acceptance 不要求 detail arrival 保留 article node identity；该要求属于 Wave 1D。Stale detail ownership 与最终 detail content 保持不变。

---

## 18. Duplicate post-render refresh cleanup / 重复 post-render refresh 清理

In `materializeSearchEvent()` and `resolveSearchTargetNode()`, remove only the immediately redundant explicit full refresh: / 在 `materializeSearchEvent()` 与 `resolveSearchTargetNode()` 中，仅删除紧邻的冗余显式 full refresh：

```text
before:
  renderTimeline()
  refreshSearchHighlights({ ... })

after:
  renderTimeline()
  // renderTimeline already owns one complete refresh
```

Do not remove `refreshSearchHighlights()` from `renderTimeline()` in Wave 1C. Focused Chromium proves unchanged descriptor, live mark, active target, navigation result, and Inspector/detail result, with no preload recursion or invocation-ownership regression. This cleanup does not authorize owner-local detail rendering. / Wave 1C 不得从 `renderTimeline()` 移除 `refreshSearchHighlights()`。Focused Chromium 证明 descriptor、live mark、active target、navigation result 与 Inspector／detail result 不变，且无 preload recursion 或 invocation-ownership regression。该 cleanup 不授权 owner-local detail rendering。

---

## 19. Optional content-free lifecycle test observation / 可选 content-free lifecycle test observation

Focused Chromium may use an optional lifecycle observer to expose counts, closed context classes/revisions, parity booleans, reuse/retirement counts, and failure categories. The production path performs no observer-owned traversal or snapshot work when no callable observer method is installed; observer failures cannot affect product behavior. / Focused Chromium 可使用 optional lifecycle observer 暴露 count、closed context class／revision、parity boolean、reuse／retirement count 与 failure category。未安装 callable observer method 时，production path 不执行 observer-owned traversal 或 snapshot work；observer failure 不得影响产品行为。

Observer evidence never contains event IDs, transcript/search text, detail contents, file paths, DOM serialization, or node references. Exact node/owner identity assertions remain inside focused test execution and emit only content-free pass/fail/count evidence. / Observer evidence 永不包含 event ID、transcript／search text、detail content、file path、DOM serialization 或 node reference。精确 node／owner identity assertion 保留在 focused test execution 内，只输出 content-free pass／fail／count evidence。

---

## 20. Closed per-MutationRecord focused-Chromium ledger / 封闭逐 MutationRecord focused-Chromium ledger

Append-vs-replacement semantics are focused-test evidence, not generic profiler schema. One ledger row corresponds to one direct-root `MutationRecord`; records in one observer callback are processed sequentially and never merged. The test reconstructs canonical-card node state immediately before/after each record by applying removed/added nodes in order rather than reading only the callback's final live DOM. / Append-vs-replacement 语义属于 focused-test evidence，不属于 generic profiler schema。每个 direct-root `MutationRecord` 对应一条 ledger row；同一 observer callback 中的 record 按顺序处理且绝不合并。Test 按顺序应用 removed／added node，重建每条 record 前后的 canonical-card node state，而不是只读取 callback 结束时的 live DOM。

Closed `commitKind`: / 封闭 `commitKind`：

```text
initialMount
appendOnly
replacement
clear
other
```

### `initialMount`

```text
preCanonicalCount == 0
removedCanonicalCount == 0
addedCanonicalCount > 0
finalCanonicalCount == addedCanonicalCount
```

### `appendOnly`

Requires all: / 必须全部满足：

```text
preCanonicalCount > 0
removedCanonicalCount == 0
addedCanonicalCount > 0
every added canonical ID was absent from reconstructed pre-state
every pre-existing canonical node remains the exact same DOM object
finalCanonicalCount == preCanonicalCount + addedCanonicalCount
```

A moved/reinserted existing canonical card cannot classify as append. / 移动／重新插入已有 canonical card 不得分类为 append。

### `clear`

```text
preCanonicalCount > 0
removedCanonicalCount > 0
addedCanonicalCount == 0
finalCanonicalCount == 0
```

### `replacement`

Canonical removals together with a resulting new canonical mount that is neither pure clear nor append. / Canonical removal 与 resulting new canonical mount 同时存在，且不属于 pure clear 或 append。

### `other`

All remaining/ambiguous shapes, including direct-root mutations with zero canonical additions and removals. Never infer append from additions alone. / 所有剩余／模糊形状，包括 canonical addition 与 removal 均为零的 direct-root mutation。永不只根据 addition 推断 append。

A successful eligible append performs one `DocumentFragment` insertion and produces exactly one operation-owned `appendOnly` row and zero operation-owned replacement rows. Operation markers remain active until relevant observer records drain and expose only closed phase/sequence metadata. / 成功 eligible append 执行一次 `DocumentFragment` insertion，并产生精确一条 operation-owned `appendOnly` row 与零条 operation-owned replacement row。Operation marker 保持到相关 observer record drain，且只暴露 closed phase／sequence metadata。

Failure and fallback records are never collapsed: / Failure 与 fallback record 永不合并：

```text
failure before insertion:
  no append record
  → fallback replacement record

failure after insertion:
  appendOnly/other record
  → later fallback replacement record
```

The retained ledger contains only classifications, counts, booleans, and operation sequence/phase. IDs may be used transiently inside tests to establish identity but do not enter retained evidence. / 保留 ledger 只包含 classification、count、boolean 与 operation sequence／phase。Test 内部可临时使用 ID 建立 identity，但 ID 不进入保留 evidence。

---

## 21. Generic profiler remains schema 4 / Generic profiler 保持 schema 4

Wave 1C withdraws profiler schema evolution. Keep unchanged: / Wave 1C 撤回 profiler schema evolution。以下保持不变：

```text
scripts/timeline-profile.js
test/timeline-profile.test.js
scripts/performance-wave-0-runner.js
scripts/performance-wave-1b-validator.js
```

The generic Timeline profile remains schema 4. `work.fullRenders` retains its current instrumentation meaning: qualifying direct Timeline-root mutations. Once append exists, it is not an exact count of semantic whole-timeline replacements and must not be cited as one. / Generic Timeline profile 继续为 schema 4。`work.fullRenders` 保持当前 instrumentation 语义：符合条件的直接 Timeline-root mutation。出现 append 后，它不是 semantic whole-timeline replacement 的精确 count，不得这样引用。

The unchanged profiler remains authoritative for generic functional acceptance, final card state, `cardGenerations`, request observations, duration, Long Tasks, and Resource Timing. Focused Chromium owns append/replacement semantics. The Wave 0 runner remains executable; the Wave 1B validator remains a frozen schema-4 historical validator. Wave 1C runs neither and creates no Wave 1C validator. / 不变 profiler 继续权威提供 generic functional acceptance、final card state、`cardGenerations`、request observation、duration、Long Task 与 Resource Timing。Focused Chromium 负责 append／replacement 语义。Wave 0 runner 保持 executable；Wave 1B validator 保持 frozen schema-4 historical validator。Wave 1C 不运行二者，也不创建 Wave 1C validator。

Any need to change generic profiling schema, Wave 0 runner, or Wave 1B validator is a mandatory scope-review stop. / 若需要修改 generic profiling schema、Wave 0 runner 或 Wave 1B validator，必须触发 scope-review stop。

---

## 22. Hard structural scenario acceptance / 硬结构场景验收

### 22.1 `warmSearchPreload`

```text
initial query replacement creates 150 cards
search-owned append creates 450 new cards
original 150 article nodes preserved 150/150

schema-4 profiler:
  final canonical cards = 600
  cardGenerations = 600

focused ledger:
  publication appendOnly rows = 1
  publication replacement rows = 0
```

`cardGenerations == 600` is required in every accepted formal run. `fullRenders` is observational only. / 每次 accepted formal run 均要求 `cardGenerations == 600`。`fullRenders` 仅作 observation。

### 22.2 `warmJumpToLateHit`

```text
pre-publication canonical cards = 600
accepted batch publication reaches 1800
new publication cards = 1200
prefix article nodes preserved = 600/600
publication appendOnly rows = 1
publication replacement rows = 0
```

Subsequent target/detail materialization may still invoke a same-context full-render fallback; the entire scenario's final card-generation count is descriptive. Publication-phase identity is proved in focused Chromium. / 后续 target／detail materialization 仍可能触发 same-context full-render fallback；整场 scenario 的 final card-generation count 只作描述。Publication-phase identity 由 focused Chromium 证明。

### 22.3 Manual Main pagination / 手动 Main pagination

For normal 150 → 300 pagination: / 对普通 150 → 300 pagination：

```text
old articles preserved = 150/150
new articles = 150
operation-owned appendOnly rows = 1
operation-owned replacement rows = 0
focus/selection/scroll preserved
visible appended detail hydration preserved
```

### 22.4 Existing-prefix search marks / 已有 prefix search mark

Under a deterministic query with prefix hits: / 在 prefix 有命中的确定性 query 下：

```text
old mark nodes remain exact objects and connected
old target objects remain exact objects
old live bindings resolve the same marks
active target and active mark remain unchanged
new suffix target indices are canonical
only new owner roots are highlighted
```

### 22.5 Replacement/retirement controls / Replacement／retirement control

These remain full replacement or non-Main root ownership: / 以下继续使用 full replacement 或 non-Main root ownership：

```text
structured-filter replacement
query replacement
Session switch
Project Scope
Protocol
Raw
empty Session
project reset/chooser
index-revision recovery
temporary-reveal incompatible append
```

No incremental claim applies to them. / 不对它们提出 incremental claim。

---

## 23. Focused Node acceptance / 聚焦 Node 验收

### Lifecycle module / Lifecycle 模块

At minimum: / 至少包括：

- create/register/lookup owner;
- nullable context slot accepted;
- duplicate event ID rejected;
- append registration;
- same canonical context full reconcile preserves owner object identity and replaces node refs;
- old detached refs released;
- presentation-token change inside same canonical context may reuse owner after full render;
- different canonical contexts retire all owners;
- deliberately colliding event ID across two contexts creates a fresh owner and retains no old node;
- non-Main reset empties registry;
- missing/extra/disconnected/order parity detected;
- registration failure can be reconciled by full mount;
- mounted token/context comparison is fixed-cost.

### O(1) presentation token / O(1) presentation token 验收

At multiple small/large synthetic sizes, install traps/counters on overrides, transient IDs, owner state, detail cache, and DOM-like collections. Prove current-token capture/equality: / 在多个 small／large synthetic size 下，为 overrides、transient ID、owner state、detail cache 与 DOM-like collection 安装 trap／counter。证明 current-token capture／equality：

```text
perform a fixed number of scalar reads/comparisons
perform zero iteration, serialization, hashing, sorting, or DOM traversal
remain independent of collection sizes
change after every required semantic revision write point
```

### Search targets / Search target 验收

- legacy one-shot behavior unchanged;
- offset default zero;
- prefix + suffix/base index equals one-shot;
- explicit finite Timeline index wins;
- existing target object identity preserved;
- canonical ordering stable;
- duplicates suppressed.

---

## 24. Memory and retention boundary / Memory 与 retention boundary

Hard requirements: / 硬要求：

```text
non-Main/root retirement clears every Main owner reference
canonical-context change creates a fresh registry
same-context full render replaces old node references
detached old articles/context slots are not retained
owner count tracks the current Main mount only
owner count does not grow monotonically across replacements
```

No heap threshold or heap-snapshot acceptance is required. If easy to collect, DOM-node/JS-heap observations are descriptive only and contain no transcript identity/content. / 不要求 heap threshold 或 heap-snapshot acceptance。若容易采集，DOM-node／JS-heap observation 仅作描述，且不包含 transcript identity／content。

---

## 25. Evidence philosophy / Evidence 原则

Wave 1C evidence relies on: / Wave 1C evidence依赖：

1. focused Node and Chromium hard invariants;
2. unchanged schema-4 generic profile correctness;
3. one smoke;
4. exactly three fresh formal profile processes;
5. repository-external raw artifacts, simple summary, and manifest;
6. fresh independent reviewer recomputation.

No calibration and no numerical latency gate. Duration, Long Task count/max/total, Resource Timing, heap, and late-hit final card generation after detail fallback remain descriptive. / 不做 calibration，不设 numerical latency gate。Duration、Long Task count／max／total、Resource Timing、heap，以及 detail fallback 后 late-hit final card generation 继续只作描述。

Repository-external evidence contains at least: / Repository-external evidence 至少包含：

```text
smoke.json
run-01.json
run-02.json
run-03.json
summary.json
manifest.json
```

`manifest.json` excludes itself and records raw byte length plus SHA-256. Summary records generic acceptance, required `cardGenerations`, duration, Long Tasks, and Resource Timing. Focused Chromium results bind the immutable candidate and report only content-free structural outcomes. / `manifest.json` 排除自身，并记录 raw byte length 与 SHA-256。Summary 记录 generic acceptance、必需 `cardGenerations`、duration、Long Task 与 Resource Timing。Focused Chromium result 绑定 immutable candidate，并只报告 content-free structural outcome。

---

## 26. Changed-path envelopes / Changed-path envelope

### 26.1 M0–M3 implementation candidate / M0–M3 implementation candidate

Expected candidate-time paths: / 预期 candidate-time path：

```text
AGENTS.md
docs/exec-plans/active/2026-08-30-performance-wave-1c-keyed-main-append.md
src/browser/app.js
src/browser/timeline-card-lifecycle.js
src/browser/search-targets.js
test/timeline-card-lifecycle.test.js
test/search-targets.test.js
e2e/browser.test.js
public/assets/app.js
```

`public/assets/app.js` appears only after M3 build. / `public/assets/app.js` 只在 M3 build 后出现。

Expected unchanged through the executable candidate: / executable candidate 期间预期不变：

```text
src/browser/highlight.js
src/browser/timeline-event-state.js
src/browser/timeline-search-batch.js
src/browser/transition-safety.js
scripts/timeline-profile.js
test/timeline-profile.test.js
scripts/performance-wave-0-runner.js
scripts/performance-wave-1b-validator.js
server.js
src/session-query.js
package.json
package-lock.json
.github/workflows/**
docs/product-specs/**
docs/design-docs/timeline-loading-and-rendering-performance.md
```

Any required change to an expected-unchanged executable/tooling path is a mandatory scope-review stop before editing. / 若必须修改 expected-unchanged executable／tooling path，编辑前强制 scope-review stop。

### 26.2 M6 documentation-only closeout / M6 documentation-only closeout

M6 owns exactly: / M6 精确拥有：

```text
AGENTS.md
docs/design-docs/timeline-loading-and-rendering-performance.md

delete:
docs/exec-plans/active/2026-08-30-performance-wave-1c-keyed-main-append.md

add:
docs/exec-plans/completed/2026-08-30-performance-wave-1c-keyed-main-append.md
```

No executable/generated change or evidence recapture is allowed in M6. Candidate and final post-M6 branch deliberately have different documentation path sets. / M6 不允许 executable／generated change 或 evidence recapture。Candidate 与最终 post-M6 branch 有意具有不同 documentation path set。

---

## 27. Focused Chromium acceptance / 聚焦 Chromium 验收

At minimum: / 至少包括：

1. Main full render establishes exact owner/card parity.
2. Same-context full render preserves owner objects but replaces/releases node refs.
3. Distinct canonical contexts with intentionally colliding event ID prove `oldOwner !== newOwner` and no old-node retention.
4. Main → Project Scope retires owners while canonical Session data may still exist.
5. Project Scope → Session Main creates fresh exact owners.
6. Main → Protocol leaves registry empty.
7. Main → Raw leaves registry empty.
8. Empty Session leaves registry empty.
9. Project reset/chooser leaves registry empty.
10. Index-revision recovery retains no retired owner.
11. Repeated Session switching does not monotonically grow owners or retain prior detached nodes.
12. Each required presentation revision change makes a stale mounted token ineligible without enumerating variable-sized state.
13. M1 ordinary append still performs the existing whole render; incremental append is not enabled.
14. Manual Main append preserves every old article and creates exactly the suffix count.
15. Successful append produces one operation-owned `appendOnly` record and zero replacement records.
16. Main append preserves focused control, selected prefix article, and scroll.
17. Main append preserves expanded/loaded detail DOM and active context reveal slot/row.
18. Newly visible appended expanded/Code Mode owner begins existing detail hydration.
19. Search append preserves existing mark, target object, and live-binding identities.
20. Suffix targets receive correct canonical indices; active prefix target/mark remains active.
21. `warmSearchPreload` reaches 600 with 600 card generations and preserves 150/150 prefix nodes.
22. Late-hit batch preserves 600 prefix nodes while publishing 1200 new cards.
23. Query/structured-filter replacements remain full replacement.
24. Protocol/Raw append remains full-render/non-Main behavior.
25. Temporary-reveal incompatible append falls back.
26. Forced detached-preparation failure yields no append record and one fallback replacement.
27. Forced post-insertion failure records insertion separately, then fallback replacement, restoring parity.
28. Search materialization removes duplicate explicit refresh while preserving descriptor/mark/navigation/Inspector behavior.
29. Wave 1B stale generation/invocation cases remain passing.
30. Direct Timeline-root writer audit finds no unowned clear/replacement.

The same cases are normative in Chinese: / 上述 case 的中文规范含义为：

- 覆盖 Main full render parity、同 context owner object 存活与 node ref 替换；
- 使用故意 colliding event ID 证明 owner 不跨 canonical context；
- 覆盖 Project／Protocol／Raw／empty／reset／index recovery／重复 Session switch retirement；
- 证明每个 revision 写点均以 O(1) 方式使 stale token ineligible；
- 证明 M1 未启用 append，M2 append 只产生一次原子 `appendOnly` record；
- 保留 focus、selection、scroll、detail、context、mark、target 与 binding identity；
- 保留 appended visible detail hydration；
- 证明 preload 600 generation、late-hit 600 prefix preservation、full replacement control 与诚实 failure ledger；
- 保持 Wave 1B stale ownership 与 search materialization 最终行为。

---

## 28. Milestones and review gates / 里程碑与评审 gate

### M0 — Revalidate and register / 重新核验并登记

Work: / 工作：

- resolve live target and prove inspected-base ancestry;
- inspect relevant descendant drift, worktree, and toolchain;
- reread governing docs;
- confirm schema-4 profiler, Wave 0 runner, and Wave 1B validator remain intentionally unchanged and compatible;
- create `perf/wave-1c-keyed-main-append`;
- register this exact active plan in `AGENTS.md`;
- record the complete Timeline-root replacement/clear inventory;
- record the complete presentation-state direct-write/revision inventory.

- 解析 live target 并证明 inspected-base ancestry；
- 检查相关 descendant drift、worktree 与 toolchain；
- 复读 governing docs；
- 确认 schema-4 profiler、Wave 0 runner 与 Wave 1B validator 有意保持不变且兼容；
- 创建 `perf/wave-1c-keyed-main-append`；
- 在 `AGENTS.md` 登记本精确 active plan；
- 记录完整 Timeline-root replacement／clear inventory；
- 记录完整 presentation-state 直接写点／revision inventory。

No product source change or profiling. Gate: `PASS_M0`. / 不修改 product source，不 profiling。Gate：`PASS_M0`。

### M1 — Production lifecycle seam, no incremental append / Production lifecycle seam，不启用增量 append

Implement: / 实施：

```text
timeline-card-lifecycle module
unified Timeline-root replacement/retirement boundary
Main full-render owner reconciliation
non-Main/Project/reset owner retirement
same-vs-different canonical-context reuse rules
fixed-width mounted presentation token and all revision write points
detailPresentationRevision
baseTimelineIndex search discovery
optional content-free focused-test observation
```

Do **not** enable incremental append. Ordinary append and search batch publication still perform canonical append followed by the existing whole render. M1 tests prove production retirement/reconciliation and O(1) compatibility while proving append remains pre-optimization. / **不得**启用 incremental append。Ordinary append 与 search batch publication 仍执行 canonical append 加现有 whole render。M1 test 证明 production retirement／reconciliation 与 O(1) compatibility，同时证明 append 仍为优化前行为。

### R1 — Independent lifecycle-seam review / 独立 lifecycle-seam 评审

Fresh reviewer verifies: / Fresh reviewer 验证：

- canonical and presentation ownership remain separate;
- every root writer is centralized;
- non-Main registry is always empty;
- same-context reuse and cross-context retirement are exact;
- colliding event IDs cannot cross canonical context;
- revision write points cover every inspected mutation;
- token capture/comparison performs no variable-sized enumeration;
- old nodes cannot be retained;
- base-index discovery is correct;
- production incremental append is not enabled;
- M1 path envelope, focused tests, and `git diff --check` pass.

Proceed only after `PASS_M1`. / 仅在 `PASS_M1` 后继续。

### M2 — Enable incremental Main suffix presentation / 启用增量 Main suffix presentation

Implement shared markup, eligibility, detached fragment preparation, one atomic root insertion, owner registration, complete append finalization, suffix discovery, suffix highlighting/binding, active-target preservation, full fallback, and duplicate post-render refresh cleanup. Focused Chromium covers every Section 27 invariant. / 实施 shared markup、eligibility、detached fragment preparation、一次原子 root insertion、owner registration、完整 append finalization、suffix discovery、suffix highlighting／binding、active-target preservation、full fallback 与 duplicate post-render refresh cleanup。Focused Chromium 覆盖第 27 节全部 invariant。

### R2 — Independent integration review / 独立 integration 评审

Fresh reviewer inspects the complete M1+M2 diff and surrounding call chains. It verifies old articles/marks survive, suffix indices are canonical, compatibility is O(1), no cross-context owner survives, every root write is owned, append is one atomic insertion, finalization preserves detail hydration, fallback is honest in the ledger, replacement controls remain full, Wave 1B ownership is unchanged, and no Wave 1D/server/virtualization work entered scope. / Fresh reviewer 检查完整 M1+M2 diff 与周边 call chain。验证旧 article／mark 存活、suffix index 为 canonical、compatibility 为 O(1)、无跨 context owner 存活、每个 root write 有 owner、append 为一次原子 insertion、finalization 保留 detail hydration、fallback 在 ledger 中诚实记录、replacement control 继续 full、Wave 1B ownership 不变，且无 Wave 1D／server／virtualization scope leak。

Proceed only after `PASS_M2`. Any executable fix after R2 requires a fresh R2 pass. / 仅在 `PASS_M2` 后继续。R2 后任何 executable fix 都要求 fresh R2 pass。

### M3 — Bundle, full gates, and immutable candidate / Bundle、完整 gate 与 immutable candidate

Run: / 运行：

```text
npm run build:client
node --check src/browser/app.js
node --check src/browser/timeline-card-lifecycle.js
node --check src/browser/search-targets.js
focused Node tests
focused Wave 1C Chromium tests
npm run test:browser
npm run release:check
git diff --check
exact changed-path audit
generated-bundle diff/currentness audit
```

Inspect the generated bundle diff, own every change, create one candidate commit, and require a clean worktree. / 检查 generated bundle diff，确认每项 change owner，创建一个 candidate commit，并要求 clean worktree。

### M4 — Lean evidence / 精简 evidence

Use unchanged schema-4 `timeline-profile.js`. Run exactly one fresh smoke, then exactly three fresh independent formal processes if smoke passes. No calibration, Wave 0 runner, Wave 1B validator, or Wave 1C validator. / 使用不变 schema-4 `timeline-profile.js`。精确运行一次 fresh smoke；仅在 smoke 通过后运行精确三个 fresh independent formal process。不做 calibration，不运行 Wave 0 runner、Wave 1B validator 或 Wave 1C validator。

Require correct candidate/runtime/fixture identity, generic acceptance, final functional state, and `warmSearchPreload.cardGenerations == 600` in each formal run. Timing remains descriptive. A failed smoke returns to candidate repair/review and does not authorize formal runs. / 每个 formal run 均要求正确 candidate／runtime／fixture identity、generic acceptance、final functional state 与 `warmSearchPreload.cardGenerations == 600`。Timing 继续只作描述。Smoke failure 返回 candidate repair／review，不授权 formal run。

### M5 — Fresh independent candidate/evidence review / Fresh independent candidate／evidence 评审

Reviewer independently verifies target→candidate diff, root mutation ownership, owner retirement/reconciliation, presentation-token O(1) compatibility, colliding-ID context isolation, atomic append, DOM/mark/target identity, detail hydration, fallback ledger, unchanged schema-4 tooling, focused tests, build currentness, evidence hashes, card generations, and descriptive timing. / Reviewer 独立验证 target→candidate diff、root mutation ownership、owner retirement／reconciliation、presentation-token O(1) compatibility、colliding-ID context isolation、atomic append、DOM／mark／target identity、detail hydration、fallback ledger、不变 schema-4 tooling、focused test、build currentness、evidence hash、card generation 与描述性 timing。

Acceptance requires exactly: / Acceptance 精确要求：

```text
ACCEPTED_FOR_CANDIDATE
INTEGRATION_READY
```

### M6 — Documentation-only closeout / 仅文档收口

Only after acceptance: archive the plan, update the bilingual performance design, remove active registration, record structural results and descriptive timing, and record the Wave 1D/cold-server checkpoint. Do not recapture evidence or change executable/generated files. Create one docs-only closeout commit and stop before push/PR/merge unless separately authorized. / 仅在 acceptance 后：archive plan、更新双语 performance design、删除 active registration、记录 structural result 与描述性 timing，并记录 Wave 1D／cold-server checkpoint。不得 recapture evidence，也不得修改 executable／generated file。创建一个 docs-only closeout commit；除非另行授权，在 push／PR／merge 前停止。

---

## 29. Hard evidence versus observations / 硬证据与 observation

Hard: / 硬证据：

```text
exact final functional state
root-write ownership
registry empty outside Main Session Timeline
owner/card/order parity
same-context owner reuse and cross-context nonreuse
O(1) fixed-width presentation compatibility
node/mark/target/binding identity preservation
canonical suffix target ordering/index
one atomic append mutation
closed ledger classification
exact appended-card count
visible appended detail hydration
fallback correctness
no stale commit
schema-4 tooling and generated-asset currentness
```

Descriptive only: / 仅描述：

```text
duration
Long Task count/max/total
Resource Timing
heap/DOM totals
late-hit final card-generation work after detail fallback
legacy work.fullRenders
```

No percentage or absolute latency threshold is allowed. / 不允许百分比或绝对 latency threshold。

---

## 30. Mandatory stop conditions / 强制停止条件

Stop and return to design review if: / 以下任一情况必须停止并返回设计评审：

1. not all Timeline-root clear/replacement paths can be centralized safely;
2. Project/Protocol/Raw/empty/reset paths can retain Main owners;
3. presentation compatibility requires serialization, hashing, scanning, sorting, or comparison of variable-sized application/owner/detail/override/transient/DOM state;
4. Main suffix data changes required markup of an existing prefix card;
5. successful append cannot be one atomic root insertion;
6. append finalization cannot preserve visible expanded/Code Mode detail hydration;
7. generic profiler schema evolution becomes necessary;
8. Wave 0 runner or Wave 1B validator must change;
9. eligible append requires owner-local detail/fold reconstruction;
10. canonical event ownership or `timeline-event-state.js` must be redesigned;
11. Wave 1B batch/invocation policies must change;
12. `highlight.js` requires a new global model;
13. Protocol/Raw must become incremental for Main correctness;
14. server/API/cache/index changes become necessary;
15. virtualization or cursor transport becomes necessary;
16. product-visible behavior or product-spec changes become necessary;
17. stale detached nodes cannot be reliably retired;
18. registry parity cannot be maintained through current replacement paths;
19. package/lockfile/workflow changes appear;
20. any expected-unchanged executable/tooling path must change.

---

## 31. Failure diagnosis / 失败诊断

| Symptom / 现象 | Likely cause / 可能原因 | Response / 响应 |
| --- | --- | --- |
| Existing nodes replaced on eligible append | append fell through full render or token/parity was stale | inspect eligibility and publication ownership |
| Token comparison grows with Session size | variable-sized state was serialized/scanned | stop; replace with revision write points |
| Owner survives colliding ID across context | reconciliation keyed before canonical-context comparison | retire registry before new-context mount |
| Owners remain in Project/Protocol/Raw | unowned root path or late retirement | centralize writer and retire synchronously |
| Card generation remains 750 in preload | whole-prefix publication render remains | do not weaken 600 expectation |
| Target order wrong | missing/wrong `baseTimelineIndex` | compare suffix vs one-shot discovery |
| Old marks disappear | global clear/reset still runs | inspect append highlight finalization |
| Focus/detail/context row disappears | prefix node or slot was replaced | restore exact node preservation |
| New visible suffix detail never loads | `queueVisibleDetailLoad()` omitted/reordered | restore mandatory finalization step |
| Detached nodes retained | registry reset/reconcile leak | hard lifecycle failure |
| Multiple append records | per-card/root insertion escaped atomic fragment | restore one fragment insertion |
| Failed append appears as one success | observer records were merged/laundered | retain per-record failure and fallback rows |
| Detail arrival recreates cards | expected Wave 1C residual | defer to Wave 1D |
| Timing remains high | likely detail/fold/global-render residual | use evidence for Wave 1D/server checkpoint |

---

## 32. Rollback and post-Wave decision / 回滚与 Wave 后决策

Wave 1C has no persistent data/API migration. Rollback reverts together the lifecycle boundary, presentation revisions/token, Main incremental append, suffix discovery/highlighting, tests, generated bundle, and Wave 1C documentation. Wave 1B canonical batching remains independently valid. / Wave 1C 没有 persistent data／API migration。Rollback 一起 revert lifecycle boundary、presentation revision／token、Main incremental append、suffix discovery／highlighting、test、generated bundle 与 Wave 1C 文档。Wave 1B canonical batching 保持独立有效。

After accepted evidence, do not automatically begin Wave 1D. Compare residual browser detail/fold/global-render work against cold/server costs. Proceed to Wave 1D only if owner-local browser work remains dominant; otherwise pivot to the reviewed cold/server track. Virtualization remains deferred. / Accepted evidence 后不得自动开始 Wave 1D。比较 browser detail／fold／global-render residual 与 cold／server cost。仅当 owner-local browser work 继续占主导时进入 Wave 1D；否则转向已评审 cold／server track。Virtualization 继续推迟。

---

## 33. Decision log / 决策日志

- 2026-08-30: PR #28 merged Wave 1B into `towards-0.2.0` as `a3297774e35eec57a40a40a47953f743435c27ed`. Wave 1B reduced search-owned page amplification while retaining one final whole-timeline presentation. / 2026-08-30：PR #28 以 `a3297774e35eec57a40a40a47953f743435c27ed` 将 Wave 1B merge 到 `towards-0.2.0`。Wave 1B 降低 search-owned page amplification，同时保留一次最终 whole-timeline presentation。
- 2026-08-30: Wave 1C is bounded to Main keyed append and appended-owner search work. Owner-local detail/fold/presentation patching is Wave 1D. / 2026-08-30：Wave 1C 限定为 Main keyed append 与 appended-owner search work。Owner-local detail／fold／presentation patch 属于 Wave 1D。
- 2026-08-30: Review requires one unified Timeline-root writer, empty owner registry outside mounted Main Session Timeline, production lifecycle integration in M1, and one atomic suffix insertion in M2. / 2026-08-30：评审要求统一 Timeline-root writer、mounted Main Session Timeline 之外 owner registry 为空、M1 接入 production lifecycle，并在 M2 使用一次原子 suffix insertion。
- 2026-08-30: Review withdrew profiler schema 5. Generic schema 4, Wave 0 runner, and frozen Wave 1B validator remain unchanged; focused Chromium owns append/replacement semantics. / 2026-08-30：评审撤回 profiler schema 5。Generic schema 4、Wave 0 runner 与 frozen Wave 1B validator 保持不变；focused Chromium 负责 append／replacement 语义。
- 2026-08-30: Presentation compatibility is a fixed-width O(1) tuple of content-free monotonic revisions/tokens. No eligibility check may serialize or scan variable-sized overrides, transient IDs, owners, detail caches, or DOM. / 2026-08-30：Presentation compatibility 使用固定宽度 O(1) content-free monotonic revision／token tuple。Eligibility check 不得序列化或扫描 variable-sized override、transient ID、owner、detail cache 或 DOM。
- 2026-08-30: Owner reuse by event ID is scoped strictly to the exact same mounted canonical context. Canonical-context change retires all owners even if IDs collide. / 2026-08-30：按 event ID 复用 owner 严格限制在精确相同 mounted canonical context。Canonical-context change 必须 retire 全部 owner，即使 ID collide。
- 2026-08-30: Main markup has no accepted prefix-neighbour exception. Raw adjacency stays full-render-only; detail-derived compact presentation is guarded by `detailPresentationRevision`. / 2026-08-30：Main markup 不接受 prefix-neighbour 例外。Raw adjacency 继续只使用 full render；detail-derived compact presentation 由 `detailPresentationRevision` guard。

---

## 34. M0 execution record / M0 执行记录

### 34.1 Ref, ancestry, drift, branch, and worktree / Ref、ancestry、drift、branch 与 worktree

```text
repository: Yijia-Zhou/session-analyzer
target branch: towards-0.2.0
remote resolution: origin refs/heads/towards-0.2.0
live target SHA: a3297774e35eec57a40a40a47953f743435c27ed
live target tree: af09ea4a01c217599ce57ee8b09975b1b0076595
local towards-0.2.0 SHA/tree: exact live-target equality
local origin/towards-0.2.0 SHA/tree: exact live-target equality
inspected base ancestor verdict: PASS — exact equality with live target
relevant descendant drift: none
implementation branch: perf/wave-1c-keyed-main-append
branch point: exact live target a3297774e35eec57a40a40a47953f743435c27ed
```

The read-only remote resolution initially encountered the sandbox network boundary and then succeeded with approved read-only `git ls-remote`; no fetch or target mutation was needed because all refs were already exact. Before M0 edits, the only worktree path was the reviewed untracked formal plan; tracked diff was empty. That path is owned by this authorization. Branch creation preserved it. M0 then changed only the formal plan and `AGENTS.md`. / 只读 remote resolution 首次遇到 sandbox network boundary，随后通过已批准的只读 `git ls-remote` 成功；由于全部 ref 已精确一致，无需 fetch 或 target mutation。M0 编辑前，worktree 唯一路径是经评审、尚未跟踪的 formal plan；tracked diff 为空。该 path 由本次授权所有。Branch 创建保留了该文件。随后 M0 只修改 formal plan 与 `AGENTS.md`。

Because live target equals the inspected base, there is no descendant path set to classify. The reviewed candidate/expected-unchanged envelopes remain viable; no stop condition was triggered. / 由于 live target 与 inspected base 精确相等，没有 descendant path set 需要分类。经评审的 candidate／expected-unchanged envelope 继续可行；未触发 stop condition。

### 34.2 Source-development toolchain / Source-development toolchain

```text
Node: v24.18.1
npm: 12.0.2
package engines: node >=22
package devEngines runtime: ^22.22.2 || ^24.15.0
package devEngines package manager: npm 12.0.2
installed esbuild: 0.28.1
installed Playwright: 1.60.0
npm strict-allow-scripts: true
npm install-scripts pending list: []
```

The installed runtime/package-manager/dependency versions satisfy the source-development contract. The environment's configured registry was observed as `https://registry.npmmirror.com/`; M0 performed no install. Before any future dependency installation, the executor must use the official registry required by `README.md`. This observation does not block M1 because the locked dependencies are already installed, exact required versions were resolved locally, and M1 authorizes no dependency change. / 已安装 runtime／package-manager／dependency version 满足 source-development contract。环境当前 configured registry 为 `https://registry.npmmirror.com/`；M0 未执行 install。未来如需安装 dependency，executor 必须按 `README.md` 使用官方 registry。该 observation 不阻塞 M1，因为 locked dependency 已安装、精确所需版本可本地解析，且 M1 不授权 dependency change。

### 34.3 Governing implementation refs reread / Governing implementation ref 复读

The following exact live-tree files were reopened as implementation refs and checked against the Wave 1C boundary: / 以下 live tree 精确文件已作为 implementation ref 重新打开，并按 Wave 1C boundary 核对：

```text
README.md
AGENTS.md
CONTEXT.md
docs/product-specs/session-transcript-analyzer.md
docs/design-docs/timeline-loading-and-rendering-performance.md
docs/design-docs/logical-event-timeline.md
docs/design-docs/indexed-materialized-session-lifecycle.md
docs/exec-plans/completed/2026-08-24-performance-wave-0-baseline.md
docs/exec-plans/completed/2026-08-27-performance-wave-1a-browser-hot-path.md
docs/exec-plans/completed/2026-08-29-performance-wave-1b-search-render-coalescing.md
package.json
scripts/build-client.js
scripts/timeline-profile.js
scripts/performance-wave-0-runner.js
scripts/performance-wave-1b-validator.js
```

Reread verdict: domain language keeps Main Timeline, Protocol Layer, Raw Layer, Folding Strategy, Current Session Scope, Project Scope, Logical Event, and Structured Detail distinct; product behavior keeps context-only rows outside canonical events/search ownership; Wave 1A keeps canonical array/Map/context/offset ownership separate from presentation; Wave 1B keeps one accepted append publication plus one current full render and unchanged stale/invocation authority; Stage 2 reserves keyed presentation and owner-scoped highlight work. No governing conflict or required product-spec/design change exists at M0. / 复读结论：领域语言继续区分 Main Timeline、Protocol Layer、Raw Layer、Folding Strategy、Current Session Scope、Project Scope、Logical Event 与 Structured Detail；产品行为继续让 context-only row 位于 canonical event／search ownership 之外；Wave 1A 继续把 canonical array／Map／context／offset ownership 与 presentation 分离；Wave 1B 继续保持一次 accepted append publication 加一次当前 full render，以及不变 stale／invocation authority；Stage 2 保留 keyed presentation 与 owner-scoped highlight work。M0 未发现 governing conflict，也不需要 product-spec／design change。

### 34.4 Schema-4 profiler and historical-tool compatibility / Schema-4 profiler 与历史工具 compatibility

```text
scripts/timeline-profile.js:25
  PROFILE_SCHEMA_VERSION = 4
artifact kind:
  timeline-browser-run

scripts/performance-wave-0-runner.js:430-442
  synthetic-browser worker launches current scripts/timeline-profile.js
scripts/performance-wave-0-runner.js:722-730
  validateTimelineArtifact requires schemaVersion === 4

scripts/performance-wave-1b-validator.js:7-11
  imports validateTimelineArtifact from the Wave 0 runner
scripts/performance-wave-1b-validator.js:263-271
  validates each raw artifact through that schema-4 validator
```

Compatibility verdict: PASS. The current profiler emits the version the Wave 0 runner requires; the Wave 1B validator remains a frozen v4 overlay. Live target equals inspected base, so all three blobs are unchanged. M0 ran none of these tools and made no profiling/test/tooling edit. / Compatibility 结论：PASS。当前 profiler 输出 Wave 0 runner 所要求的版本；Wave 1B validator 继续是 frozen v4 overlay。Live target 与 inspected base 精确相等，因此三者 blob 均未变化。M0 未运行这些工具，也未执行 profiling／test／tooling edit。

### 34.5 Direct Timeline-root replacement/clear inventory / 直接 Timeline-root replacement／clear inventory

M0 found exactly three direct `#timeline` root writers in `src/browser/app.js`; searches for direct `replaceChildren`, `textContent`, append/prepend, `appendChild`, and `insertAdjacentHTML` root writes found no additional writer. M1 must centralize these exact statements: / M0 在 `src/browser/app.js` 中找到精确三个直接 `#timeline` root writer；对直接 `replaceChildren`、`textContent`、append／prepend、`appendChild` 与 `insertAdjacentHTML` root 写入的搜索未发现额外 writer。M1 必须集中以下精确 statement：

| Direct writer | Current statement | Current entry paths and required M1 mode |
| --- | --- | --- |
| `resetProjectViewState()` at `src/browser/app.js:3704-3760` | `el.timeline.innerHTML = ''` at line 3745 | Called by authoritative source reset (`695`), source switch/home change (`837`, `859`), project chooser (`3842`), successful project selection reset (`3921`), and restored in-progress project job (`4072`). M1 mode: `non-main`; retire every Main owner synchronously before clear. |
| `renderProjectSearchView()` at `src/browser/app.js:4522-4539` | project-state `el.timeline.innerHTML = ...` at line 4531 | Reached by empty Session (`4128`), project-search pending (`4176`), project-result empty/loading/final settlement (`4192`, `4202`, `4225`), index-revision recovery (`4247`), and `renderTimeline()`'s Project-Scope early branch (`5568`). M1 mode: `non-main`; registry empty even while prior Session canonical data may still exist. |
| `renderTimeline()` at `src/browser/app.js:5565-5626` | complete Timeline `el.timeline.innerHTML = ...` at line 5574 | Session Main full render uses `main` reconcile. Session Protocol/Raw uses `non-main` retirement even though those layers render event-shaped DOM. Call sites cover project refresh/bootstrap (`1126`, `4245`), search materialization (`1873`, `1896`), context/transient reconciliation (`2207`, `3534`, `7371`, `7392`), locale restore (`3949`), project drill-down/inherited/read-from-here/layer transitions (`4422`, `4631`, `4676`), Wave 1B batch and ordinary/deep/find publication (`4972`, `5154`, `5238`, `5309`), detail settlement (`5679`), temporary/context/detail transitions (`6142`, `6149`, `6290`, `6299`, `6385`, `6661`, `6731`), profile/Folding Strategy changes (`6806`, `6921`, `6928`, `7151`, `7163`, `7175`, `7187`, `7212`), and event expansion/retry (`7054`, `7066`). |

`renderTimeline()` currently delegates Project Scope to `renderProjectSearchView()` before its own root assignment. M1 must preserve that delegation behavior while ensuring both functions enter the unified boundary with the correct mode. The future `appendMainTimelineSuffix()` is the only accepted root-write exception and is not implemented until M2. / `renderTimeline()` 当前在自身 root assignment 前把 Project Scope 委托给 `renderProjectSearchView()`。M1 必须保持该 delegation 行为，同时确保两个函数以正确 mode 进入统一 boundary。未来 `appendMainTimelineSuffix()` 是唯一可接受的 root-write 例外，且直到 M2 才实现。

### 34.6 Fixed-width presentation revision/token write inventory / 固定宽度 presentation revision／token 写点 inventory

All current presentation state is initialized in the `state` literal at `src/browser/app.js:133-247`. M1 must add content-free scalar revision ownership there and route the following direct writes through auditable advancement helpers. Eligibility may read only the resulting fixed-width tuple; it may not enumerate the listed collections. / 当前全部 presentation state 初始化位于 `src/browser/app.js:133-247` 的 `state` literal。M1 必须在此增加 content-free scalar revision ownership，并将以下直接写点接入可审计 advancement helper。Eligibility 只能读取最终 fixed-width tuple；不得枚举下列 collection。

#### Locale presentation / Locale presentation

| Source write | Required revision/token ownership |
| --- | --- |
| Initial `state.locale = browserLocale()` at `133-134` | Establish initial locale token/revision without content. |
| `applyAppState()` assignment at `3879` | Advance/change locale token when resolved locale differs; this path also reloads profiles and resets presentation. |
| `changeLocale()` assignment at `3936` | Advance synchronously before locale-dependent reset/reload. Dirty draft restoration at `3947-3948` is also a folding-presentation write. |

#### Folding Strategy/profile presentation / Folding Strategy／profile presentation

| Source write boundary | Required `foldingPresentationRevision` ownership |
| --- | --- |
| Initial `profiles`/`builtinProfiles`/`customProfiles`/`profileId`/`profileDraft` at `206-215` | Initialize one scalar revision. |
| `resetProfileDraft()` at `2361-2363` | Advance only when replacing the active rendered rule source can change card presentation; proven initialization-only clone may remain no-op. |
| `saveCustomProfiles()` at `2374-2377` | Advance when the active profile/rules used for rendering change. |
| `applyAppState()` profile catalog/fallback writes at `3884-3901` | Advance for changed active rendered rules/profile; this includes fallback to `narrative`. |
| Dirty-draft locale restoration at `3947-3948` | Advance when restored rules become the rendered active rule source. |
| `setProfileId()` / `changeProfile()` at `6796-6825` | Advance synchronously for accepted active Folding Strategy change; discard/cancel no-op paths advance only if rendered rules actually change. |
| `saveProfileDraft()` at `6891-6923` | Advance for active saved-rule/profile replacement, including built-in→custom ID and custom-profile update. |
| `cancelProfileDraft()` at `6925-6930` | Advance when reset to stored active rules changes rendered card state. |
| Active rule input handlers at `7145-7188` | Advance once for each semantic fallback/kind/Code Mode request/condition rule mutation before full render. |

The inventory includes catalog/profile assignments because `activeProfileRules()` reads the active draft or active profile, and `displayState()` uses those rules for Main card classes/body. M1 may conservatively advance but must never serialize the rules/owners/events to decide append compatibility. / Inventory 包含 catalog／profile assignment，因为 `activeProfileRules()` 读取 active draft 或 active profile，而 `displayState()` 使用这些规则生成 Main card class／body。M1 可保守递增，但不得为判断 append compatibility 而序列化 rule／owner／event。

#### Selected-Session persisted overrides / Selected-Session persisted override

| Source write | Required `overridesRevision` ownership |
| --- | --- |
| Initial normalized persisted map at `215` | Initialize scalar revision without enumerating during eligibility. |
| `clearCurrentSessionOverrides()` delete + `saveOverrides()` normalization at `3624-3633` | Advance once for semantic selected-Session clear; normalization that changes rendered values is also owned. |
| `setOverride()` creation/update at `5627-5634` | Advance once for add/change after navigation/transient reveal cleanup. |
| Reset-folds handler delete/save at `7207-7212` | Advance once for selected-Session reset. |

Profile changes call `clearCurrentSessionOverrides()` and therefore use the same owned write boundary. Session selection without an override-map mutation is protected by canonical-context replacement and does not require scanning the map. / Profile change 会调用 `clearCurrentSessionOverrides()`，因此使用同一个 owned write boundary。Session selection 若不 mutation override map，则由 canonical-context replacement 保护，不要求扫描 map。

#### Navigation-event reveal / Navigation-event reveal

| Source write | Required `navigationRevealRevision` ownership |
| --- | --- |
| Initial `null` at `194` | Initialize scalar revision. |
| Reveal creation in `openInheritedSourceSession()` at `4626-4630` | Advance synchronously before full render. |
| `clearNavigationEventReveal()` at `5348-5351` | Advance on actual clear; proven no-op clear may remain no-op. All callers, including Session/profile/override transitions, use this boundary. |

#### Search transient expansion / Search transient expansion

| Source write | Required `searchTransientRevision` ownership |
| --- | --- |
| Initial `{ key: '', eventIds: [] }` at `243` | Initialize scalar revision. |
| `resetSearchTransientExpansions()` replacement at `1511-1514` | Advance when reset/replacement changes state; proven already-empty no-op may remain no-op. |
| `addSearchTransientExpansion()` key replacement/push at `1533-1542` | Advance for key replacement and for each newly added ID; one semantic call may advance once after its final mutation. |
| `clearSearchTransientExpansion()` filter/key clear at `1545-1549` | Advance once when an ID is removed or state becomes empty. |
| `reconcileSearchTransientExpansions()` at `1524-1530` | Uses the reset boundary and inherits its revision ownership. |

Eligibility must not inspect, sort, serialize, or hash the `eventIds` collection. / Eligibility 不得检查、sort、serialize 或 hash `eventIds` collection。

#### Temporary event reveal / Temporary event reveal

| Source write | Required `temporaryRevealRevision` ownership |
| --- | --- |
| Initial `null` at `195` | Initialize scalar revision. |
| Canonical promotion clear in Wave 1B batch publication at `4959-4962` | Advance on actual clear. |
| Replacement reset at `5116` | Advance on actual clear; no-op may remain no-op. |
| Ordinary append/replacement canonical promotion clear at `5143-5146` | Advance on actual clear. |
| Creation in `inspectAndRevealEvent()` at `6137-6142` | Advance synchronously before full render. |
| `reconcileDetailViewState()` replacement at `6268-6277` | Advance if reconciliation changes reveal state. |
| `closeDetailView()` clear at `6286-6290` | Advance on actual clear. Other detail transitions call reconciliation and inherit its ownership. |

M1 must remove unaudited direct assignment or place the exact revision advancement at each listed write. Eligibility never serializes the reveal event or its IDs. / M1 必须移除未经审计的直接 assignment，或在每个列出的写点执行精确 revision advancement。Eligibility 永不序列化 reveal event 或其 ID。

#### Timeline-relevant detail/error presentation / Timeline-relevant detail／error presentation

Timeline cards read detail/error state through `codeModeEventPresentation()` (`960-970`), compact web projection discovery (`982-993`), and `renderEventBody()` (`5384-5399`). Therefore every accepted mutation below advances `detailPresentationRevision`: / Timeline card 通过 `codeModeEventPresentation()`（`960-970`）、compact web projection discovery（`982-993`）与 `renderEventBody()`（`5384-5399`）读取 detail／error state。因此以下每个 accepted mutation 都必须递增 `detailPresentationRevision`：

| Source write | Required revision ownership |
| --- | --- |
| Initial `detailCache`/`detailErrors`/`detailCacheGeneration` at `216-219` | Initialize scalar revision. |
| `resetSessionDetailCache()` complete cache/error reset and generation advance at `3814-3821` | Always advance once, including an already-empty reset, because a new detail generation is established. |
| Ownership-validated successful cache write plus old-error deletion at `5654-5655` | Advance synchronously once after the accepted semantic write. |
| Ownership-validated detail-error write at `5663` | Advance synchronously once. Intentional abort/stale branches do not mutate and do not advance. |
| Timeline retry deletes at `7058-7059` | Advance once for the atomic retry deletion before `ensureEventDetail()`. |
| Inspector retry deletes at `7133-7134` | Advance once for the atomic retry deletion before `showInspector()`. |

`detailPending` bookkeeping does not currently change Timeline-card markup and is not a token component. Any future direct mutation of timeline-relevant detail/error state must join the same revision boundary. Compatibility determination must never enumerate `detailCache` or `detailErrors`; `detailPresentationRevision` conservatively covers all entries, including Code Mode/web-search projection effects. / `detailPending` bookkeeping 当前不改变 Timeline-card markup，因此不是 token component。未来任何 timeline-relevant detail／error state 直接 mutation 都必须接入同一 revision boundary。Compatibility determination 永不枚举 `detailCache` 或 `detailErrors`；`detailPresentationRevision` 保守覆盖全部 entry，包括 Code Mode／web-search projection effect。

### 34.7 M0 gate / M0 gate

```text
ref/ancestry: PASS
relevant drift: NONE
worktree ownership: PASS
source-development toolchain: PASS
governing refs reread: PASS
schema-4 profiler/runner/validator compatibility: PASS
feature branch: CREATED FROM EXACT LIVE TARGET
active-plan registration: COMPLETE
Timeline-root inventory: COMPLETE — 3 direct writers
presentation revision/token inventory: COMPLETE
changed-path/expected-unchanged viability: PASS
M0 result: PASS
```

No product/runtime implementation, lifecycle module, source/search/test/profiler/runner/validator/canonical-state/package/workflow/server/product-spec change, profiling, evidence capture, asset generation, candidate commit, push, PR, merge, publish, or release occurred. M0 stops here. M1 requires separate authorization. / 未发生 product／runtime implementation、lifecycle module、source／search／test／profiler／runner／validator／canonical-state／package／workflow／server／product-spec change、profiling、evidence capture、asset generation、candidate commit、push、PR、merge、publish 或 release。M0 在此停止。M1 需要另行授权。

---

## 35. M1 executor record / M1 executor 执行记录

### 35.1 Implemented production seam, without incremental append / 已实施 production seam，未启用增量 append

M1 added `src/browser/timeline-card-lifecycle.js` as a presentation-only CommonJS/browser-bundle module and integrated it into `src/browser/app.js`. The lifecycle owns mounted canonical Main article/context-slot references only; `contextSlotNode` is nullable. It has no dependency on app-global state, fetch, timers, localization, search parsing, canonical arrays, or transcript content. / M1 新增 `src/browser/timeline-card-lifecycle.js`，作为 presentation-only CommonJS／browser-bundle module，并接入 `src/browser/app.js`。Lifecycle 仅拥有 mounted canonical Main article／context-slot reference；`contextSlotNode` 可为 null。它不依赖 app-global state、fetch、timer、localization、search parsing、canonical array 或 transcript content。

Full Main rendering now reconciles owners only after root replacement. Exact same mounted canonical context permits event-ID owner-object reuse while replacing node references and mounted token. Any different canonical context first retires every old owner/reference and creates fresh owners, including deliberately colliding IDs. Project Scope, Protocol, Raw, empty Session, chooser/reset, and every other non-Main root replacement synchronously retire the registry. / Main full render 现在仅在 root replacement 后 reconcile owner。只有精确相同 mounted canonical context 才允许按 event ID 复用 owner object，同时替换 node reference 与 mounted token。任何不同 canonical context 都先 retire 全部旧 owner／reference，再创建 fresh owner，包括故意 collision 的 ID。Project Scope、Protocol、Raw、empty Session、chooser／reset 与其它所有 non-Main root replacement 均同步 retire registry。

The fixed-width mounted presentation snapshot contains exactly `valid` plus seven content-free scalar revisions: locale, Folding Strategy/profile, selected-Session overrides, navigation reveal, search transient expansion, temporary reveal, and detail presentation. `currentTimelinePresentationToken()` reads those seven scalar fields directly. It performs no serialization, hashing, sorting, collection iteration, owner/detail/override/transient traversal, or DOM traversal. Monotonic revision advancement uses a checked safe-integer helper; `Number.MAX_SAFE_INTEGER` never wraps and sets the app overflow latch, making captured compatibility tokens invalid and therefore fail-closed. / Fixed-width mounted presentation snapshot 精确包含 `valid` 与七个 content-free scalar revision：locale、Folding Strategy／profile、selected-Session override、navigation reveal、search transient expansion、temporary reveal 与 detail presentation。`currentTimelinePresentationToken()` 直接读取这七个 scalar field，不执行 serialization、hashing、sorting、collection iteration、owner／detail／override／transient traversal 或 DOM traversal。Monotonic revision 通过 checked safe-integer helper 递增；`Number.MAX_SAFE_INTEGER` 永不 wrap，并设置 app overflow latch，使 captured compatibility token invalid，从而 fail closed。

All M0-audited write points are owned: locale apply/change; active profile catalog/fallback/draft reset/save/cancel/profile/rule edits; selected-Session override save/clear/set/reset; navigation reveal set/clear; search transient reset/add/remove/reconcile; temporary reveal create/promote/reset/reconcile/clear; accepted detail success/error, Timeline retry deletion, Inspector retry deletion, and complete detail/error/generation reset. / M0 审计的全部写点均已纳入 ownership：locale apply／change；active profile catalog／fallback／draft reset／save／cancel／profile／rule edit；selected-Session override save／clear／set／reset；navigation reveal set／clear；search transient reset／add／remove／reconcile；temporary reveal create／promote／reset／reconcile／clear；accepted detail success／error、Timeline retry deletion、Inspector retry deletion，以及完整 detail／error／generation reset。

`searchTargets.discover()` now accepts optional `{ baseTimelineIndex }`; default behavior remains zero-based and an explicit finite `event.timelineIndex` still wins. Prefix-plus-offset-suffix discovery is directly tested against one-shot discovery with real timeline-style DTOs that omit `timelineIndex`, including order, indices, duplicates, and existing target-object identity. / `searchTargets.discover()` 现接受可选 `{ baseTimelineIndex }`；默认行为继续从零开始，显式 finite `event.timelineIndex` 仍优先。使用不含 `timelineIndex` 的真实 timeline-style DTO，直接测试 prefix 加 offset suffix discovery 与 one-shot discovery 等价，包括 order、index、duplicate 与旧 target-object identity。

M1 did not add `appendMainTimelineSuffix()` or any other live append-only root operation. Ordinary Main pagination and Wave 1B batch publication still commit the canonical suffix and then replace the whole Timeline root before lifecycle reconciliation; focused Chromium holds prefix article references and proves they become detached. / M1 未新增 `appendMainTimelineSuffix()` 或其它 live append-only root operation。普通 Main pagination 与 Wave 1B batch publication 仍先 commit canonical suffix，再替换整个 Timeline root，之后执行 lifecycle reconciliation；focused Chromium 持有 prefix article reference 并证明其变为 detached。

### 35.2 Unified Timeline-root source audit / 统一 Timeline-root source audit

Post-M1 source audit found exactly one direct Timeline-root replacement statement in `src/browser/**`: / M1 后 source audit 在 `src/browser/**` 中只发现一个直接 Timeline-root replacement statement：

```text
src/browser/app.js:399
  el.timeline.innerHTML = markup
```

That statement is inside `replaceTimelineRoot(markup, mode)`. The three M0 writer families now call the boundary at: / 该 statement 位于 `replaceTimelineRoot(markup, mode)` 内。M0 的三个 writer family 现从以下位置调用 boundary：

```text
resetProjectViewState():   src/browser/app.js:3865  mode non-main
renderProjectSearchView(): src/browser/app.js:4662  mode non-main
renderTimeline():          src/browser/app.js:5766  mode main/non-main by mounted surface
```

Searches for direct Timeline `innerHTML`, `outerHTML`, `textContent` clear, `replaceChildren`, `replaceWith`, `remove`, append/prepend, `appendChild`, and `insertAdjacentHTML` found no unowned writer. Search for `appendMainTimelineSuffix` found no implementation. / 对直接 Timeline `innerHTML`、`outerHTML`、`textContent` clear、`replaceChildren`、`replaceWith`、`remove`、append／prepend、`appendChild` 与 `insertAdjacentHTML` 的搜索未发现未归属 writer。对 `appendMainTimelineSuffix` 的搜索未发现实现。

### 35.3 Focused validation totals / 聚焦验证总数

Final executor validation: / 最终 executor validation：

```text
syntax checks: 6/6 PASS
  src/browser/app.js
  src/browser/timeline-card-lifecycle.js
  src/browser/search-targets.js
  e2e/browser.test.js
  test/timeline-card-lifecycle.test.js
  test/search-targets.test.js

focused Node: 16/16 PASS
  lifecycle: 9
  search targets: 7

focused Chromium: 10/10 PASS
  production Main reconcile + Project/Protocol/Raw/chooser retirement
  colliding-ID cross-context nonreuse + repeated Session switching
  empty Session + project reset
  ordinary append remains whole render
  Wave 1B batch append remains whole render
  navigation reveal revision
  temporary reveal revision
  search transient revision
  index-revision recovery retirement
  throwing observer isolation across revision/detail/render/parity/highlight

git diff --check: PASS
```

The lifecycle Node set includes nullable slot, duplicate rejection, same-context node replacement, cross-context colliding-ID retirement, disconnected/missing/extra/order parity, multiple-size hostile collection traps proving fixed-width token capture/equality performs no variable-sized enumeration, invalid-token incompatibility, safe-integer overflow fail-closed behavior, and observer access/payload/synchronous-throw/thenable-rejection isolation. Chromium additionally proves the exact eight-field token shape (`valid` plus seven revisions), observes locale, folding, override, navigation, search-transient, temporary-reveal, and detail revisions through production transitions, and proves a throwing observer cannot stop detail success, Main render completion, registry/card parity, or post-render highlighting. / Lifecycle Node 集覆盖 nullable slot、duplicate rejection、same-context node replacement、cross-context colliding-ID retirement、disconnected／missing／extra／order parity、multiple-size hostile collection trap（证明 fixed-width token capture／equality 不枚举 variable-sized state）、invalid-token incompatibility、safe-integer overflow fail-closed，以及 observer access／payload／同步 throw／thenable rejection isolation。Chromium 还证明精确八字段 token shape（`valid` 加七个 revision），通过 production transition 观察 locale、folding、override、navigation、search-transient、temporary-reveal 与 detail revision，并证明 throwing observer 无法中止 detail success、Main render completion、registry／card parity 或 post-render highlighting。

### 35.4 Changed-path and stop audit / Changed-path 与 stop audit

The exact M1 worktree path set is: / 精确 M1 worktree path set 为：

```text
AGENTS.md
docs/exec-plans/active/2026-08-30-performance-wave-1c-keyed-main-append.md
src/browser/app.js
src/browser/timeline-card-lifecycle.js
src/browser/search-targets.js
test/timeline-card-lifecycle.test.js
test/search-targets.test.js
e2e/browser.test.js
```

`AGENTS.md` contains only the accepted M0 active-plan registration. Every expected-unchanged executable/tooling/design/product/generated path remains unchanged, including `public/assets/app.js`, `highlight.js`, canonical Timeline/search-batch/transition-safety code, schema-4 profiler/tests, Wave 0 runner, Wave 1B validator, server/query code, package/lockfile, workflows, product specs, and performance design. No stop condition was triggered. No profiling, evidence capture, bundle generation, candidate commit, push, PR, merge, publish, or release occurred. / `AGENTS.md` 仅包含已接受的 M0 active-plan 登记。全部 expected-unchanged executable／tooling／design／product／generated path 保持不变，包括 `public/assets/app.js`、`highlight.js`、canonical Timeline／search-batch／transition-safety code、schema-4 profiler／test、Wave 0 runner、Wave 1B validator、server／query code、package／lockfile、workflow、product spec 与 performance design。未触发 stop condition。未执行 profiling、evidence capture、bundle generation、candidate commit、push、PR、merge、publish 或 release。

### 35.5 Bounded observer-isolation repair / 受限 observer-isolation 修复

The first R1 gate returned `BLOCKED_M1` because optional observer callbacks could throw through production control flow. The authorized repair added one small `notifyObserverSafely()` boundary and changed only the two existing diagnostic notifications. The boundary safely reads the optional method, constructs its payload only after finding a callable method, invokes it inside isolation, ignores its return value, safely inspects a possible `then`, and attaches a rejection handler to returned thenables/Promises. Missing/malformed observers, accessor throws, payload throws, synchronous callback throws, hostile then getters, and asynchronous rejection cannot escape. No retry, logging, telemetry, or product-visible error behavior was added. / 首次 R1 gate 因 optional observer callback 可将异常传播进 production control flow 而返回 `BLOCKED_M1`。本次授权 repair 新增一个小型 `notifyObserverSafely()` boundary，并且只修改两个既有 diagnostic notification。该 boundary 安全读取 optional method，仅在找到 callable method 后构造 payload，在隔离区内调用，忽略返回值，安全检查潜在 `then`，并为返回的 thenable／Promise 安装 rejection handler。Missing／malformed observer、accessor throw、payload throw、同步 callback throw、hostile then getter 与异步 rejection 均无法逃逸。未新增 retry、logging、telemetry 或 product-visible error behavior。

`advancePresentationRevision()` completes the semantic revision mutation before fire-and-forget `recordRevision` notification. `recordTimelineLifecycle()` lazily constructs content-free observation only for a callable `recordLifecycle`; no-observer production execution still performs no observer-owned owner traversal/snapshot work. Root replacement, Main reconciliation, and all later synchronization continue regardless of observer outcome. Direct tests prove throw/rejection isolation; focused Chromium installs callbacks that record then synchronously throw and proves override revision, successful detail cache/presentation, Main full render, owner/card parity, search highlighting, and absence of observer-derived user-visible error. / `advancePresentationRevision()` 先完成 semantic revision mutation，再 fire-and-forget 通知 `recordRevision`。`recordTimelineLifecycle()` 仅对 callable `recordLifecycle` 延迟构造 content-free observation；无 observer 的 production execution 仍不执行 observer-owned owner traversal／snapshot work。Root replacement、Main reconciliation 与全部后续 synchronization 不受 observer outcome 影响。Direct test 证明 throw／rejection isolation；focused Chromium 安装“先记录、再同步 throw”的 callback，并证明 override revision、成功 detail cache／presentation、Main full render、owner／card parity、search highlighting，以及不存在 observer 导致的 user-visible error。

Bounded M1 repair result was `PASS_M1_REPAIR_AWAITING_FRESH_R1`; the subsequently authorized fresh independent R1 returned `PASS_M1` and was accepted before M2 authorization. / 受限 M1 repair 的结果为 `PASS_M1_REPAIR_AWAITING_FRESH_R1`；之后获授权的 fresh independent R1 返回 `PASS_M1`，并在 M2 获授权前被接受。

---

## 36. M2 executor record / M2 executor 执行记录

### 36.1 Main-only incremental suffix presentation / Main-only 增量 suffix presentation

M2 refactored the existing Main event-card markup into one shared `renderTimelineCardMarkup()` implementation used by both full Main rendering and detached suffix preparation. The shared implementation continues to own display classes, selected state, Code Mode projection, chips, preview, timestamp, enclosing-operation affordance, nullable context slot, expanded/detail/loading body, and footer actions. Raw fork-segment headings remain in the full-render-only path and no prefix-neighbour exception was introduced. / M2 将既有 Main event-card markup 重构为一个共享的 `renderTimelineCardMarkup()` implementation，由 full Main rendering 与 detached suffix preparation 共同使用。共享 implementation 继续负责 display class、selected state、Code Mode projection、chip、preview、timestamp、enclosing-operation affordance、nullable context slot、expanded／detail／loading body 与 footer action。Raw fork-segment heading 仍位于 full-render-only path，且未引入 prefix-neighbour 例外。

Both ordinary pagination and Wave 1B batch publication now capture the accepted pre-append boundary before the unchanged canonical append commit. Incremental eligibility then proves Session Scope/Main Layer, a non-empty true contiguous suffix, current committed canonical context, exact mounted canonical-context and fixed-width presentation-token matches, stable search context, exact prefix owner/card/order parity, unchanged accepted prefix IDs, exact committed suffix object positions, and absence of temporary or conflicting replacement presentation. Uncertain or failed eligibility enters one full `renderTimeline()` fallback; canonical state is never rolled back. / 普通 pagination 与 Wave 1B batch publication 现在都在 unchanged canonical append commit 前 capture accepted pre-append boundary。增量 eligibility 随后证明 Session Scope／Main Layer、非空 true contiguous suffix、current committed canonical context、精确 mounted canonical-context 与 fixed-width presentation-token match、稳定 search context、精确 prefix owner／card／order parity、未变化的 accepted prefix ID、精确 committed suffix object position，以及不存在 temporary 或冲突 replacement presentation。任何不确定或失败 eligibility 都进入一次完整 `renderTimeline()` fallback；canonical state 永不 rollback。

Preparation renders the complete suffix into one detached `DocumentFragment`, validates suffix count/ID/order/direct-root shape, captures article and nullable context-slot references, and prevalidates batch lifecycle conflicts without touching the live root. Successful publication performs exactly one `el.timeline.append(prepared.fragment)` operation. Finalization then registers the new Main owners as one prevalidated batch, synchronizes only new context slots and enclosing affordances, establishes Timeline search-surface readiness, discovers suffix descriptors with `baseTimelineIndex = accepted prefix length`, highlights and binds only new owner roots, preserves/reconciles the active target and controls, and calls the unchanged `queueVisibleDetailLoad()` all-card scan. Existing caller-level selected-detail convergence, pagination settlement, result summary, preload, navigation, and Wave 1B invocation/generation behavior remain in place. / Preparation 将完整 suffix 渲染进一个 detached `DocumentFragment`，在不触碰 live root 的前提下验证 suffix count／ID／order／direct-root shape，capture article 与 nullable context-slot reference，并预验证 batch lifecycle conflict。成功 publication 精确执行一次 `el.timeline.append(prepared.fragment)` operation。Finalization 随后以一个预验证 batch 注册新 Main owner，仅同步新 context slot 与 enclosing affordance，建立 Timeline search-surface readiness，以 `baseTimelineIndex = accepted prefix length` discovery suffix descriptor，仅 highlight／bind 新 owner root，保留／reconcile active target 与 control，并调用 unchanged `queueVisibleDetailLoad()` all-card scan。既有 caller-level selected-detail convergence、pagination settlement、result summary、preload、navigation 与 Wave 1B invocation／generation behavior 均保持原位。

Suffix search presentation preserves existing target objects, live bindings, mark DOM nodes, active target, and active mark. It does not reset all bindings, clear all marks, rediscover all canonical events, or re-highlight prefix owners. The immediately redundant explicit `refreshSearchHighlights()` calls after `renderTimeline()` were removed only from `materializeSearchEvent()` and `resolveSearchTargetNode()`; `renderTimeline()` remains the complete full-refresh authority. / Suffix search presentation 保留既有 target object、live binding、mark DOM node、active target 与 active mark。它不会 reset 全部 binding、clear 全部 mark、rediscover 全部 canonical event 或重新 highlight prefix owner。仅从 `materializeSearchEvent()` 与 `resolveSearchTargetNode()` 移除了 `renderTimeline()` 后立即重复的显式 `refreshSearchHighlights()`；`renderTimeline()` 继续作为完整 full-refresh authority。

If detached preparation fails, no append mutation occurs and one full replacement follows. If any unexpected post-insertion finalization step fails, the already-observed append/other mutation remains visible and a later full replacement restores exact owner/card parity. The lifecycle batch registration prevalidates every owner before mutation, releases/reconciles failed presentation through the existing full-render boundary, and does not change M1 observer isolation, fixed-width O(1) token comparison, or cross-canonical-context retirement. No owner-local detail/fold/presentation patch, Protocol/Raw append, profiler/tooling, canonical-state, Wave 1B policy, server/API, or generated-asset work entered M2. / 若 detached preparation 失败，则不发生 append mutation，并随后执行一次 full replacement。若 insertion 后任一意外 finalization step 失败，已经观察到的 append／other mutation 仍保留在证据中，后续 full replacement 恢复精确 owner／card parity。Lifecycle batch registration 在 mutation 前预验证全部 owner，通过既有 full-render boundary release／reconcile 失败 presentation，且不改变 M1 observer isolation、fixed-width O(1) token comparison 或 cross-canonical-context retirement。M2 未引入 owner-local detail／fold／presentation patch、Protocol／Raw append、profiler／tooling、canonical-state、Wave 1B policy、server／API 或 generated-asset 工作。

### 36.2 Closed per-record mutation evidence and hard invariants / 封闭 per-record mutation evidence 与硬不变量

Focused Chromium installs a content-free direct-root MutationObserver ledger. It emits one row per `MutationRecord`, processes records sequentially from the immediately preceding canonical node map, and uses only the closed `initialMount`, `appendOnly`, `replacement`, `clear`, and `other` classifications. `appendOnly` requires absent added IDs, zero removals, exact preservation of every prior DOM object, and exact additive final count; moved/reinserted nodes cannot qualify. Operation IDs scope test observation only and records from one callback are never merged. / Focused Chromium 安装 content-free direct-root MutationObserver ledger。它对每个 `MutationRecord` 产生一行，从紧邻的前一 canonical node map 顺序处理 record，并且只使用封闭的 `initialMount`、`appendOnly`、`replacement`、`clear` 与 `other` classification。`appendOnly` 要求新增 ID 原先不存在、零 removal、精确保留每个旧 DOM object，并且 final count 精确相加；move／reinsert node 无法合格。Operation ID 仅用于界定测试观察，同一 callback 的 record 永不合并。

The accepted focused cases prove: manual Main 150→300 preserves 150/150 articles, creates exactly 150 articles, preserves focus/selection/scroll/loaded expanded detail DOM, and produces one append-only record with zero replacement; active prefix context slot/row survives; a visible appended Code Mode owner starts the existing detail request; existing prefix target object/live binding/mark/active identity survive while exactly 150 new roots are highlighted and suffix indices are 150–299; preload reaches 600 through 150-card replacement plus one 450-card append while preserving 150/150 prefix nodes; late-hit publication preserves 600/600 prefix nodes and creates exactly 1200 suffix cards in one append-only record. / 已接受 focused case 证明：manual Main 150→300 保留 150/150 article、精确创建 150 个 article、保留 focus／selection／scroll／loaded expanded detail DOM，并产生一个 append-only record 且零 replacement；active prefix context slot／row 存活；可见 appended Code Mode owner 启动既有 detail request；既有 prefix target object／live binding／mark／active identity 存活，同时仅 highlight 150 个新 root，suffix index 为 150–299；preload 通过 150-card replacement 加一次 450-card append 达到 600，并保留 150/150 prefix node；late-hit publication 保留 600/600 prefix node，并在一个 append-only record 中精确创建 1200 个 suffix card。

Control cases prove query and structured-filter replacements stay full, Session switch retires the prior context, Protocol and Raw registries remain empty and Raw pagination remains a full replacement, and an active temporary reveal forces full-render fallback. Forced detached-preparation failure records no append plus one replacement; forced post-insertion failure records append first and replacement later, without collapsing them. Existing detail-materialization search tests prove descriptor/mark/navigation/Inspector behavior after duplicate-refresh removal. The accepted observer-failure test still proves throwing diagnostics cannot interrupt revision, detail success, Main render, parity, or highlighting. / Control case 证明 query 与 structured-filter replacement 继续 full、Session switch retire 旧 context、Protocol 与 Raw registry 保持为空且 Raw pagination 继续 full replacement，并且 active temporary reveal 强制进入 full-render fallback。强制 detached-preparation failure 记录零 append 加一次 replacement；强制 post-insertion failure 先记录 append、后记录 replacement，二者不会被折叠。既有 detail-materialization search test 证明移除 duplicate refresh 后 descriptor／mark／navigation／Inspector behavior 不变。已接受 observer-failure test 继续证明 throwing diagnostic 无法中断 revision、detail success、Main render、parity 或 highlighting。

### 36.3 M2 executor validation totals / M2 executor validation 总数

Final accepted executor reruns, excluding earlier diagnostic reruns: / 最终 accepted executor rerun（不计入更早的 diagnostic rerun）：

```text
syntax checks: 6/6 PASS
  src/browser/app.js
  src/browser/timeline-card-lifecycle.js
  src/browser/search-targets.js
  test/timeline-card-lifecycle.test.js
  test/search-targets.test.js
  e2e/browser.test.js

focused Node: 17/17 PASS
  lifecycle: 10
  search targets: 7

focused Chromium Wave 1C + Wave 1B batch/stale controls: 27/27 PASS
  Wave 1C M1+M2 lifecycle/append/fallback/identity cases: 12
  Wave 1B M2 batch/stale/generation/invocation controls: 15

focused search materialization/duplicate-refresh controls: 3/3 PASS

focused Chromium total: 30/30 PASS
git diff --check: PASS
```

No profiling, evidence capture, Wave 0 runner, Wave 1B validator, client build, generated-asset regeneration, candidate commit, push, PR, merge, publish, or release was run. / 未运行 profiling、evidence capture、Wave 0 runner、Wave 1B validator、client build、generated-asset regeneration、candidate commit、push、PR、merge、publish 或 release。

### 36.4 Timeline-root writer and exact-path audit / Timeline-root writer 与精确路径审计

Post-M2 source audit finds exactly two direct Timeline-root mutations in `src/browser/**`: / M2 后 source audit 在 `src/browser/**` 中精确找到两个直接 Timeline-root mutation：

```text
src/browser/app.js:399
  el.timeline.innerHTML = markup
  ownership: replaceTimelineRoot(markup, mode)

src/browser/app.js:5951
  el.timeline.append(prepared.fragment)
  ownership: presentCommittedTimelineAppend(boundary, suffixEvents)
```

The first remains the unified replacement/clear boundary for the three M0 writer families. The second is the separately controlled M2 Main-suffix operation and is reached only after detached preparation and eligibility; it inserts the complete fragment once. Searches for direct Timeline `outerHTML`, `textContent`, `replaceChildren`, `appendChild`, `prepend`, `insertBefore`, `insertAdjacent*`, `remove`, and other append writers found no unowned mutation. / 第一处继续作为 M0 三个 writer family 的统一 replacement／clear boundary。第二处是单独受控的 M2 Main-suffix operation，仅在 detached preparation 与 eligibility 后到达，并一次插入完整 fragment。对直接 Timeline `outerHTML`、`textContent`、`replaceChildren`、`appendChild`、`prepend`、`insertBefore`、`insertAdjacent*`、`remove` 与其它 append writer 的搜索未发现 unowned mutation。

The exact implementation worktree path set remains the authorized eight paths: / 精确 implementation worktree path set 仍为已授权的八个 path：

```text
AGENTS.md
docs/exec-plans/active/2026-08-30-performance-wave-1c-keyed-main-append.md
src/browser/app.js
src/browser/timeline-card-lifecycle.js
src/browser/search-targets.js
test/timeline-card-lifecycle.test.js
test/search-targets.test.js
e2e/browser.test.js
```

`AGENTS.md` remains only the M0 registration. Every expected-unchanged path remains unchanged, including `public/assets/app.js`, `highlight.js`, canonical Timeline/search-batch/transition-safety modules, schema-4 profiler/tests, Wave 0 runner, Wave 1B validator, server/query code, package/lockfile, workflows, product specs, and performance design. No M2 stop condition was triggered. / `AGENTS.md` 仍仅包含 M0 registration。全部 expected-unchanged path 保持 unchanged，包括 `public/assets/app.js`、`highlight.js`、canonical Timeline／search-batch／transition-safety module、schema-4 profiler／test、Wave 0 runner、Wave 1B validator、server／query code、package／lockfile、workflow、product spec 与 performance design。未触发 M2 stop condition。

---

## 37. Progress / 进度

```text
Formal plan rewrite: COMPLETE
Technical design: ACCEPTED
M0: PASS
Branch creation: COMPLETE — perf/wave-1c-keyed-main-append
AGENTS.md registration: COMPLETE
M1 executor: PASS — OBSERVER-ISOLATION REPAIR COMPLETE
Prior R1 gate: BLOCKED_M1 — observer failure isolation
Fresh R1: PASS_M1 — ACCEPTED
M2 executor: PASS
Fresh R2: PASS_M2 — ACCEPTED
M3 gates: PASS — CANDIDATE FREEZE PENDING
Product/runtime source changes: M1 LIFECYCLE SEAM + M2 MAIN-ONLY INCREMENTAL APPEND
Profiling/evidence: NONE
Generated assets: UNCHANGED
Candidate commit: NONE
Push/PR/merge/publish/release: NONE
Current stop: M3 CANDIDATE FREEZE PENDING
```

---

## 38. M3 executor record before candidate freeze / M3 candidate freeze 前执行记录

### 38.1 Accepted target and generated asset / 已接受 target 与 generated asset

Fresh independent R2 returned `PASS_M2` before M3 began. The implementation branch remains `perf/wave-1c-keyed-main-append`, with exact target/base commit `a3297774e35eec57a40a40a47953f743435c27ed` and target tree `af09ea4a01c217599ce57ee8b09975b1b0076595`. No descendant drift or post-R2 product implementation change was introduced in M3. / Fresh independent R2 在 M3 开始前返回 `PASS_M2`。Implementation branch 仍为 `perf/wave-1c-keyed-main-append`，精确 target／base commit 为 `a3297774e35eec57a40a40a47953f743435c27ed`，target tree 为 `af09ea4a01c217599ce57ee8b09975b1b0076595`。M3 未引入 descendant drift 或 R2 后 product implementation change。

`npm run build:client` regenerated only the reviewed client asset. The old target asset was 296,098 bytes with SHA-256 `93ef86006fbcc6a1f7c985cb990ad47437fe26d675c23dc77a0204defa90b318`; the candidate asset is 310,988 bytes with SHA-256 `1c08f9eee89f5717b5aad3245cb2cf63171fefd9e3c3e2e681d91cb88527cea8`. Its target diff is 182 inserted and 182 removed generated lines. Inspection found the lifecycle module, fixed-width token, `baseTimelineIndex`, shared Main markup, detached preparation, one fragment append, suffix highlight/finalization, fallback, and duplicate-refresh cleanup represented in the generated bundle. `npm run build:check` independently regenerated into a temporary directory and reported `Generated assets are current`; no source map or second generated path appeared. / `npm run build:client` 仅重新生成 reviewed client asset。旧 target asset 为 296,098 bytes，SHA-256 为 `93ef86006fbcc6a1f7c985cb990ad47437fe26d675c23dc77a0204defa90b318`；candidate asset 为 310,988 bytes，SHA-256 为 `1c08f9eee89f5717b5aad3245cb2cf63171fefd9e3c3e2e681d91cb88527cea8`。其 target diff 为 182 行 inserted、182 行 removed 的 generated line。检查确认 generated bundle 包含 lifecycle module、fixed-width token、`baseTimelineIndex`、共享 Main markup、detached preparation、一次 fragment append、suffix highlight／finalization、fallback 与 duplicate-refresh cleanup。`npm run build:check` 在 temporary directory 独立重新生成并报告 `Generated assets are current`；未出现 source map 或第二个 generated path。

### 38.2 M3 validation totals / M3 validation 总数

Final accepted M3 gates: / 最终接受的 M3 gate：

```text
build:client: PASS
syntax checks: 6/6 PASS
focused Node lifecycle/search: 17/17 PASS
focused Chromium Wave 1C + Wave 1B batch/stale: 27/27 PASS
focused search materialization controls: 3/3 PASS
focused Chromium total: 30/30 PASS
full browser final run: 163/163 PASS
release build:check: PASS — generated assets current
release Node suite: 822/822 PASS
release package smoke: PASS — Codex, Claude Code, DeepSeek Harness
git diff --check: PASS
exact changed-path audit: PASS
Timeline-root writer audit: PASS — exactly 2 owned mutations
generated-bundle currentness/diff audit: PASS
```

The first focused post-build run exposed a test synchronization race in the Raw/Protocol full-render control: its wait condition could observe the newly selected Layer and an unchanged 150-card count before the lifecycle retirement observation completed. M3 made one non-substantive test-only stabilization by adding the already-required non-Main/zero-owner condition to the Raw and Protocol waits; no product/source/generated behavior changed. The exact test then passed 1/1 and the complete focused set passed from scratch 27/27. Substantive repair cycles used: `0/2`. / 第一次 build 后 focused run 暴露了 Raw／Protocol full-render control 的测试同步竞态：wait condition 可能在 lifecycle retirement observation 完成前观察到新选 Layer 与尚未变化的 150-card count。M3 进行了一次 non-substantive test-only stabilization，在 Raw 与 Protocol wait 中加入本来就要求的 non-Main／zero-owner condition；product／source／generated behavior 均未改变。该精确 test 随后通过 1/1，完整 focused set 从头通过 27/27。已使用 substantive repair cycle：`0/2`。

The first full-browser attempt reported two unrelated nondeterministic fixture/environment failures (`home directory edits preserve or drop Return` timeout and a temporary fixture `ENOENT`). Both passed together on immediate exact rerun 2/2 without any code change. The required fresh complete rerun then passed 163/163 and is the accepted M3 full-browser result. / 第一次 full-browser attempt 报告两个无关的 nondeterministic fixture／environment failure（`home directory edits preserve or drop Return` timeout 与 temporary fixture `ENOENT`）。二者在未修改代码的情况下立即精确重跑并通过 2/2。随后要求的 fresh complete rerun 通过 163/163，并作为 accepted M3 full-browser result。

### 38.3 Candidate path and root-writer audit / Candidate path 与 root-writer 审计

The exact candidate-time changed-path set is the reviewed nine paths: / 精确 candidate-time changed-path set 为 reviewed 九个 path：

```text
AGENTS.md
docs/exec-plans/active/2026-08-30-performance-wave-1c-keyed-main-append.md
src/browser/app.js
src/browser/timeline-card-lifecycle.js
src/browser/search-targets.js
test/timeline-card-lifecycle.test.js
test/search-targets.test.js
e2e/browser.test.js
public/assets/app.js
```

`AGENTS.md` still contains only the M0 active-plan registration. Every expected-unchanged executable/tooling/design/product path remains unchanged, including `highlight.js`, canonical Timeline/search-batch/transition-safety modules, schema-4 profiler/tests, Wave 0 runner, Wave 1B validator, server/query code, package/lockfile, workflows, product specs, and performance design. / `AGENTS.md` 仍只包含 M0 active-plan registration。全部 expected-unchanged executable／tooling／design／product path 保持 unchanged，包括 `highlight.js`、canonical Timeline／search-batch／transition-safety module、schema-4 profiler／test、Wave 0 runner、Wave 1B validator、server／query code、package／lockfile、workflow、product spec 与 performance design。

The final direct Timeline-root writer audit remains closed: / 最终直接 Timeline-root writer 审计继续封闭：

```text
src/browser/app.js:399
  el.timeline.innerHTML = markup
  owner: replaceTimelineRoot(markup, mode)

src/browser/app.js:5951
  el.timeline.append(prepared.fragment)
  owner: presentCommittedTimelineAppend(boundary, suffixEvents)
```

No other direct root clear/replacement/append writer exists in `src/browser/**`. Candidate SHA/tree are intentionally recorded only after the immutable commit exists; no evidence capture begins before that identity is written into this active plan. / `src/browser/**` 中不存在其它直接 root clear／replacement／append writer。Candidate SHA／tree 仅能在 immutable commit 存在后记录；在该 identity 写入本 active plan 前不会开始 evidence capture。
