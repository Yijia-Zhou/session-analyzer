# Search jump-target canonicalization / 搜索跳转目标规范化

## Goal-ready objective / 可直接用于 `/goal` 的目标

Eliminate search jump-target inflation and incorrect Inspector-heavy navigation by replacing presentation-surface occurrence membership with a canonical target model. Initial search, automatic preload, explicit `Load more`, forward/backward boundary navigation, folded-event materialization, timeline pagination, and Inspector rendering must all discover and navigate the same semantic targets without treating every rendered full-text occurrence or stale Inspector mark as a new target. The goal is complete only after the full reproduction matrix proves that no presentation redraw, detail transition, pagination path, or interaction interleaving can reintroduce count convergence, stale descriptors, duplicate surface targets, active-target movement during discovery, or unintended detail navigation. / 通过以 canonical target 模型替代基于展示 surface occurrence 的成员关系，彻底消除搜索跳转目标膨胀和大量错误进入 Inspector 的导航。首次搜索、自动预加载、显式“加载更多”、前后边界导航、折叠事件物化、时间线分页和 Inspector 渲染必须发现并导航同一组语义目标，不能把每个已渲染全文 occurrence 或陈旧 Inspector mark 当成新 target。只有完整复现矩阵证明任何展示重绘、详情转换、分页路径或交互交错都不会重新引入计数趋同、陈旧 descriptor、跨 surface 重复 target、发现期间活动 target 移动或非预期详情导航时，本目标才算完成。

Suggested `/goal` invocation: / 建议的 `/goal` 调用：

```text
/goal Execute docs/exec-plans/active/2026-07-12-search-jump-target-canonicalization.md completely. Do not mark the goal complete until every invariant and reproduction scenario passes, the contradictory search-target contract is reconciled in bilingual product/design docs, generated assets are current, and the full validation gates pass.
```

## Status and ownership / 状态与负责人

- Status: completed; all automated and real-project acceptance gates passed / 状态：已完成；全部自动化与真实项目验收门禁通过
- Owner: goal executor / 负责人：goal 执行者
- Opened: 2026-07-12 / 建立日期：2026-07-12
- Product spec: `docs/product-specs/session-transcript-analyzer.md` / 产品规格：`docs/product-specs/session-transcript-analyzer.md`
- Design doc: `docs/design-docs/logical-event-timeline.md` / 设计文档：`docs/design-docs/logical-event-timeline.md`
- Supersedes the current surface-membership decisions recorded by `docs/exec-plans/completed/2026-06-28-search-navigation-state-convergence.md`; that completed plan remains historical and must not be rewritten as if it never shipped. / 取代 `docs/exec-plans/completed/2026-06-28-search-navigation-state-convergence.md` 中当前基于 surface 成员关系的决策；该 completed plan 是历史记录，不得改写成仿佛从未发布。

## Confirmed failure / 已确认问题

The defect is reproduced in the live project, not inferred only from code. Searching `patch` in one current session produced the following sequence: / 该缺陷已在真实项目中复现，并非仅从代码推断。某个当前 session 搜索 `patch` 得到以下序列：

| Stage / 阶段 | Jump targets / 跳转目标 | Full-text hits / 全文命中 | Live target surfaces / 实时 target surface |
|---|---:|---:|---|
| Initial search / 首次搜索 | 5 | 45 | timeline 5, Inspector 0 |
| One `Load more` / 点击一次“加载更多” | 11 | 45 | timeline 5, Inspector 6 |
| One subsequent Next / 再点击一次下一项 | 43 | 45 | timeline 5, Inspector 32, plus 6 stale descriptors / 另有 6 个陈旧 descriptor |

The second transition did not add a timeline target. `Load more` called `refreshSearchHighlights({ preserveActive: true, allowPreload: false, syncDetail: true })`, reopened the current target's Inspector, registered all six Inspector phrase marks, and treated registry growth as successful discovery. The next navigation opened another Inspector with 32 phrase marks. The append-only registry retained the preceding six Inspector descriptors, so the displayed denominator became 43 while the current DOM had only 37 live marks. / 第二次转换没有增加 timeline target。“加载更多”调用 `refreshSearchHighlights({ preserveActive: true, allowPreload: false, syncDetail: true })`，重新打开当前 target 的 Inspector，注册其中全部 6 个短语 mark，并把 registry 增长视为发现成功。下一次导航又打开带 32 个短语 mark 的 Inspector。只增不减的 registry 保留了前一个 Inspector 的 6 个 descriptor，因此显示分母达到 43，而当前 DOM 只有 37 个 live mark。

## Root-cause chain / 根因链路

1. `searchHighlighter.apply()` creates one mark for every accepted DOM phrase occurrence. / `searchHighlighter.apply()` 为每个被接受的 DOM 短语 occurrence 创建一个 mark。
2. `searchableHighlightOwners()` exposes both visible timeline events and the selected-event Inspector as discovery owners. / `searchableHighlightOwners()` 同时把可见 timeline event 和选中事件 Inspector 暴露为发现 owner。
3. `bindSearchTarget()` makes every mark a registry member identified by search key, surface, owner ID, and occurrence index. Timeline and Inspector projections of the same logical content are therefore different targets. / `bindSearchTarget()` 把每个 mark 都变成 registry 成员，其身份由 search key、surface、owner ID 和 occurrence index 构成。因此，同一逻辑内容在 timeline 与 Inspector 中的投影会成为不同 target。
4. `refreshSearchHighlights()` nulls old node bindings but never removes descriptors for an unchanged search key. Replacing Inspector A with Inspector B appends B while retaining A. / `refreshSearchHighlights()` 会清空旧 node 绑定，但对未变化 search key 永不删除 descriptor。用 Inspector B 替换 Inspector A 时会追加 B 并保留 A。
5. Resolving a stale Inspector descriptor intentionally reopens its owner, so stale presentation membership becomes an actionable detail-navigation path instead of being skipped. / 解析陈旧 Inspector descriptor 时会有意重新打开其 owner，因此陈旧展示成员关系会成为可执行详情导航路径，而不是被跳过。
6. Timeline target activation uses `syncDetail` and opens an Inspector; that render refreshes highlights and mutates the target set during navigation. / 激活 timeline target 时使用 `syncDetail` 并打开 Inspector；该渲染会刷新高亮并在导航过程中修改 target 集合。
7. `Load more` currently uses total registry growth as its success condition, so Inspector-only growth is indistinguishable from discovery of a new canonical target. / “加载更多”当前以 registry 总量增长作为成功条件，因此无法区分 Inspector-only 增长和真正发现新 canonical target。

## Non-negotiable invariants / 不可妥协的不变量

Implementation decisions may vary, but all of the following must hold simultaneously. Passing only the common path is insufficient. / 实现决策可以变化，但以下条件必须同时成立。只通过常见路径不够。

### Membership and identity / 成员关系与身份

- DOM marks are disposable bindings and never authoritative membership, identity, ordering, or denominator state. / DOM mark 是可丢弃绑定，绝不作为权威成员关系、身份、顺序或分母状态。
- A canonical target is independent of whether its current projection is in timeline, Inspector, or temporarily absent. `surface` may describe a binding preference but must not create a second semantic target. / canonical target 独立于其当前投影位于 timeline、Inspector 或暂时不存在；`surface` 可以描述绑定偏好，但不能创建第二个语义 target。
- Opening, closing, loading, retrying, redrawing, or switching an Inspector changes the canonical target count by exactly zero unless the operation also materializes genuinely new canonical search content under the chosen contract. / 打开、关闭、加载、重试、重绘或切换 Inspector 时 canonical target 数必须精确变化 0，除非该操作同时按选定 contract 物化了真正新的 canonical 搜索内容。
- Timeline and Inspector renderings of the same logical occurrence cannot both contribute membership. / 同一逻辑 occurrence 的 timeline 与 Inspector 渲染不能同时贡献成员关系。
- A target identity cannot silently rebind to a different phrase occurrence when loading placeholders are replaced, detail sections reorder, locale changes, or a card changes from summary to expanded. / 当加载占位被替换、详情区段重排、locale 变化或卡片从 summary 变为 expanded 时，target 身份不能静默重绑到不同短语 occurrence。
- Canonical ordering is deterministic and independent of the order in which Inspectors happened to be opened. / canonical 顺序必须确定，且不依赖 Inspector 偶然打开的先后顺序。

### Count semantics / 计数语义

- `Full-text hits` remains the backend occurrence count and must not be rewritten merely to make the two numbers look different. / `Full-text hits` 继续表示后端 occurrence 数，不能为了让两个数字看起来不同而改写。
- `Jump targets` equals the canonical registry size, never the number of current DOM marks and never the sum of historical surface marks. / `Jump targets` 等于 canonical registry 大小，绝不等于当前 DOM mark 数，也不等于历史 surface mark 之和。
- Numerical equality between jump targets and full-text hits is allowed only when the canonical model genuinely yields one navigable target for every backend occurrence; no test may require inequality as a cosmetic invariant. / 只有 canonical 模型确实为每个后端 occurrence 产生一个可导航 target 时，跳转目标与全文命中才允许数值相等；测试不得把“不相等”作为纯视觉不变量。
- Count growth must be attributable to concrete newly discovered canonical IDs. A presentation redraw with no new canonical ID must produce zero growth. / 计数增长必须可归因于具体新增 canonical ID；没有新 canonical ID 的展示重绘必须产生零增长。
- Once discovery is exhausted, repeated `Load more`, Next at the boundary, Inspector redraw, and navigation wrap are idempotent with respect to membership and denominator. / 发现耗尽后，重复“加载更多”、边界 Next、Inspector 重绘和导航回绕在成员关系与分母上必须幂等。

### Navigation behavior / 导航行为

- Initial search, automatic preload, explicit `Load more`, Next/Previous boundary materialization, and direct navigation all call one canonical discovery service and cannot apply different membership rules. / 首次搜索、自动预加载、显式“加载更多”、Next/Previous 边界物化和直接导航必须调用同一个 canonical 发现服务，不能应用不同成员规则。
- `Load more` never changes `activeTargetId`, selected event, scroll position, or detail view solely as a side effect of discovery. / “加载更多”绝不能仅因发现过程改变 `activeTargetId`、选中事件、滚动位置或详情视图。
- Next/Previous activates exactly one canonical target per action. Rapid queued input preserves order without duplicate activation or skipped canonical IDs. / 每次 Next/Previous 操作只激活一个 canonical target；快速排队输入必须保持顺序，不重复激活或跳过 canonical ID。
- Timeline is the primary reading surface. The executor must explicitly decide and document whether any Inspector-only canonical targets remain valid. If they remain, they require a stable non-duplicated locator and must be a deliberate fallback, not a side effect of opening every Inspector. / Timeline 是主要阅读 surface。执行者必须明确决定并记录是否保留任何 Inspector-only canonical target；如保留，必须具备稳定、去重的 locator，并作为有意 fallback，而不能是打开每个 Inspector 的副作用。
- Persisted user folds remain authoritative. Temporarily unavailable canonical targets may be skipped for one transition without corrupting membership, ordering, or the active identity. / 持久化用户折叠保持权威；暂时不可用的 canonical target 可以在一次转换中跳过，但不能破坏成员关系、顺序或活动身份。
- Search-transient detail and user-confirmed Inspector/Raw refs provenance rules remain intact. The fix cannot close user-confirmed detail merely to avoid target registration. / 搜索临时详情与用户确认 Inspector/Raw refs 的来源规则必须保持；修复不能仅为避免 target 注册而关闭用户确认详情。

### Concurrency and context / 并发与上下文

- Discovery and navigation are serialized or otherwise proven race-safe across timeline requests, detail requests, highlight refreshes, profile edits, locale changes, session switches, Layer switches, filter changes, and query edits. / 发现与导航必须串行化或被证明在 timeline 请求、detail 请求、高亮刷新、profile 编辑、locale 变化、session 切换、Layer 切换、筛选变化和 query 编辑之间无竞态。
- Late responses and stale DOM cannot add, reactivate, reorder, or bind canonical targets for a previous search key. / 延迟响应与陈旧 DOM 不能为旧 search key 添加、重新激活、重排或绑定 canonical target。
- Automatic preload remains bounded; explicit user discovery may continue until it finds a new canonical target or proves exhaustion, but must not issue duplicate page requests. / 自动预加载保持有界；显式用户发现可以继续到找到新 canonical target 或证明耗尽，但不得发出重复分页请求。

## Required decision checkpoint / 必须完成的决策检查点

Before changing registry code, write and approve the canonical target contract in the product spec and design doc. Do not start from the existing `{ searchKey, surface, ownerId, occurrence }` tuple and merely filter Inspector marks; that may hide the immediate symptom while leaving unstable occurrence identity. / 修改 registry 代码前，先在产品规格和设计文档中写明并确认 canonical target contract。不得从现有 `{ searchKey, surface, ownerId, occurrence }` tuple 出发仅过滤 Inspector mark；这可能隐藏直接症状，却保留不稳定 occurrence 身份。

The decision must choose one of these models, or justify a stricter equivalent: / 决策必须选择以下模型之一，或论证一个更严格的等价方案：

1. **Event-anchor model:** one canonical jump target per matching logical event, with full-text occurrences retained only as secondary count/highlight context. This is simplest and most stable but removes within-event occurrence navigation. / **事件锚点模型：**每个匹配逻辑事件只有一个 canonical jump target，全文 occurrence 只保留为次级计数/高亮上下文。该模型最简单稳定，但会移除事件内 occurrence 导航。
2. **Canonical-occurrence model:** backend or shared search construction emits stable per-event occurrence descriptors independent of rendered surface; timeline and Inspector bind to those descriptors without creating membership. This preserves within-event navigation but may require additive API/schema work and canonical field/section locators. / **规范 occurrence 模型：**后端或共享搜索构造输出独立于渲染 surface 的稳定事件内 occurrence descriptor；timeline 与 Inspector 只绑定这些 descriptor，不创建成员关系。该模型保留事件内导航，但可能需要增量 API/schema 工作及规范字段/区段 locator。

Default recommendation: use the event-anchor model unless product evidence requires multiple within-event jumps and the canonical-occurrence model can be implemented without deriving identity from DOM order. / 默认建议：除非产品证据要求事件内多次跳转，且 canonical-occurrence 模型能在不依赖 DOM 顺序的情况下实现，否则采用事件锚点模型。

## Execution phases / 执行阶段

### Phase 0: freeze the failure with red tests / 第零阶段：用红灯测试冻结问题

- Add a browser fixture that reproduces Inspector inflation with distinct counts: initial timeline targets, a current Inspector with several occurrences, and a second Inspector with a different occurrence count. / 增加浏览器 fixture，以不同计数复现 Inspector 膨胀：初始 timeline target、带多个 occurrence 的当前 Inspector，以及 occurrence 数不同的第二个 Inspector。
- Record canonical-registry snapshots in tests through a narrow test helper or DOM-observable contract: IDs, owners, binding surfaces, live/stale state, active ID, and denominator. Do not expose unrestricted production debug state. / 通过窄测试 helper 或 DOM 可观察 contract 记录 canonical registry 快照：ID、owner、绑定 surface、live/stale 状态、active ID 和分母；不得暴露不受限的生产调试状态。
- Add failing assertions that `Load more` does not open Inspector, Inspector open/close has zero membership delta, switching Inspector has zero membership delta, and stale detail descriptors do not remain navigable. / 增加失败断言：“加载更多”不打开 Inspector，Inspector 打开/关闭成员变化为 0，切换 Inspector 成员变化为 0，陈旧详情 descriptor 不再可导航。
- Preserve the original `5 jump targets / 45 full-text hits -> 11 -> 43` shape or an equivalent deterministic fixture so a superficial count-label patch cannot pass. / 保留原始 `5 个跳转目标 / 45 个全文命中 -> 11 -> 43` 形态或等价确定 fixture，避免仅修改计数文案的表面修复通过。

### Phase 1: immediate containment, without declaring completion / 第一阶段：立即止血，但不得宣告完成

- Remove detail synchronization from `Load more`; its success result must be based on canonical IDs returned by discovery, not total registry length. / 从“加载更多”中移除详情同步；其成功结果必须基于发现返回的 canonical ID，而不是 registry 总长度。
- Separate highlight rendering owners from navigation discovery owners. Inspector may remain highlighted while being prevented from creating presentation-only membership. / 分离高亮渲染 owner 与导航发现 owner；Inspector 可以继续高亮，但不能创建仅用于展示的成员。
- Prevent target activation from implicitly changing membership. Any required Inspector render must bind existing canonical descriptors only. / 防止 target 激活隐式改变成员关系；任何必要的 Inspector 渲染只能绑定已有 canonical descriptor。
- Keep all red tests. This phase is containment only and cannot satisfy the goal while identity still depends on DOM occurrence order. / 保留全部红灯测试。本阶段仅止血；只要身份仍依赖 DOM occurrence 顺序，就不能满足目标。

### Phase 2: canonical registry and binding model / 第二阶段：canonical registry 与绑定模型

- Implement the approved event-anchor or canonical-occurrence descriptor. Remove presentation `surface` from semantic membership identity. / 实现已批准的事件锚点或规范 occurrence descriptor；从语义成员身份中移除展示 `surface`。
- Split registry membership from zero-or-more live bindings. Timeline/Inspector redraws replace bindings for an ID; they do not append membership. / 将 registry 成员关系与零个或多个 live binding 分离；timeline/Inspector 重绘只替换某个 ID 的绑定，不追加成员。
- Define deterministic ordering from logical timeline order plus the approved within-event key. Opening order, DOM traversal order, and async response order cannot affect it. / 用逻辑 timeline 顺序加已批准的事件内 key 定义确定顺序；打开顺序、DOM 遍历顺序和异步响应顺序不能影响它。
- Reconcile the previous non-shrinking rule: canonical membership may grow only through discovery for the same key; ephemeral bindings may appear/disappear freely; descriptors proven invalid for the current committed canonical corpus must not linger merely for numerical stability. / 调整以前的只增不减规则：同一 key 的 canonical 成员只能通过发现增长；短生命周期 binding 可以自由出现/消失；已证明不属于当前已提交规范语料的 descriptor 不能仅为数字稳定而残留。
- Make active-target preservation explicit when new canonical IDs are inserted before or after it. Current position derives from ID lookup after deterministic ordering, never mutable DOM index. / 新 canonical ID 插入活动目标前后时要明确保留活动 target；当前位置必须在确定顺序后通过 ID 查找得出，绝不来自可变 DOM index。

### Phase 3: one discovery service for every path / 第三阶段：所有路径共用一个发现服务

- Replace divergent initial refresh, automatic preload, `Load more`, forward boundary, and backward boundary discovery with one service returning structured results such as `{ newTargetIds, exhausted, loadedPages, expandedEventIds }`. / 用一个返回 `{ newTargetIds, exhausted, loadedPages, expandedEventIds }` 等结构化结果的服务替代分叉的首次刷新、自动预加载、“加载更多”、前向边界和后向边界发现。
- `Load more` requests discovery only and preserves active target, selection, detail, focus, and scroll. / “加载更多”只请求发现，并保留活动 target、选择、详情、焦点和滚动。
- Next/Previous asks the same service when no known canonical target exists in the requested direction, then activates exactly the returned next canonical ID. / 指定方向没有已知 canonical target 时，Next/Previous 请求同一服务，然后只激活返回的下一个 canonical ID。
- Automatic preload uses the same membership rules with explicit page/target limits and never marks the user-confirmed exhausted state unless the complete canonical corpus was actually exhausted. / 自动预加载使用相同成员规则和明确页面/target 上限；除非完整 canonical 语料确实耗尽，否则不得标记用户确认的 exhausted 状态。
- Forward and backward exhaustion/wrap rules must be symmetric and must not load the same page twice. / 前向与后向耗尽/回绕规则必须对称，且不得重复加载同一页。

### Phase 4: remove contradictory behavior and tests / 第四阶段：移除矛盾行为与测试

- Rewrite the browser test that currently requires varied Inspector match counts to append stable targets. Replace it with assertions that Inspector count variation does not change canonical membership or order. / 重写当前要求不同 Inspector 命中数追加稳定 target 的浏览器测试，改为断言 Inspector 计数变化不改变 canonical 成员或顺序。
- Rewrite `Load more` coverage so success requires concrete new canonical IDs from timeline/event discovery, not any denominator increase. / 重写“加载更多”覆盖，使成功必须来自 timeline/event 发现的具体新 canonical ID，而不是任意分母增长。
- Keep coverage for Raw refs exclusion, user-confirmed detail persistence, search-transient detail cleanup, manual folds, delayed responses, and rapid navigation. / 保留 Raw refs 排除、用户确认详情保持、搜索临时详情清理、手动折叠、延迟响应和快速导航覆盖。
- Remove or rename helpers whose names imply that all DOM marks are targets. / 移除或重命名暗示所有 DOM mark 都是 target 的 helper。

### Phase 5: documentation and migration / 第五阶段：文档与迁移

- Update the bilingual product spec to define canonical jump targets, Full-text hits, Inspector behavior, `Load more`, and the allowed growth/exhaustion rules. / 更新双语产品规格，定义 canonical jump target、Full-text hits、Inspector 行为、“加载更多”以及允许的增长/耗尽规则。
- Update the bilingual design doc with descriptor schema, ordering, binding lifecycle, discovery service, concurrency guards, and supersession of the surface-occurrence registry. / 更新双语设计文档，记录 descriptor schema、顺序、binding 生命周期、发现服务、并发 guard，以及对 surface-occurrence registry 的取代。
- Add a decision-log entry identifying the old contract as superseded. Do not rewrite completed plans; link this plan as the correction. / 增加 decision log 条目，把旧 contract 标为已取代；不得改写 completed plan，应链接本计划作为纠正。
- Remove temporary diagnostics and test-only exposure before completion. / 完成前移除临时诊断与测试专用暴露。

## Mandatory reproduction matrix / 强制复现矩阵

Every row must have an automated browser assertion where feasible. Manual browser evidence alone is insufficient; unit-only evidence is insufficient for DOM/Inspector behavior. / 每一行在可行时都必须有自动化浏览器断言。只有手动浏览器证据不够；涉及 DOM/Inspector 行为时只有单元测试证据也不够。

| Scenario / 场景 | Required result / 必须结果 |
|---|---|
| Initial current-session search with summary cards / 当前 session summary 卡首次搜索 | Canonical count is deterministic; no Inspector membership / canonical 计数确定；无 Inspector 成员 |
| Search while a user-confirmed Inspector is already open / 用户确认 Inspector 已打开时搜索 | Inspector highlights may render; canonical count/order matches the same search with Inspector closed / 可显示 Inspector 高亮；canonical 计数/顺序与 Inspector 关闭时一致 |
| Search-transient Inspector opened by navigation / 导航打开搜索临时 Inspector | Opening and loaded-detail rerender add zero canonical IDs / 打开及详情加载重绘新增 0 个 canonical ID |
| Switch between Inspectors with different occurrence counts / 在 occurrence 数不同的 Inspector 间切换 | Zero membership delta; no stale detail navigation / 成员变化 0；无陈旧详情导航 |
| Close Inspector, open profile rules, open Raw refs, return / 关闭 Inspector、打开 profile rules、打开 Raw refs、返回 | Count/order/active ID remain valid; Raw refs never contributes / 计数/顺序/活动 ID 有效；Raw refs 永不贡献 |
| Explicit `Load more` with a new target in loaded events / 已加载事件中存在新 target 时点击“加载更多” | Exactly the expected canonical ID(s) append; active/selection/detail/scroll unchanged / 只追加预期 canonical ID；活动/选择/详情/滚动不变 |
| `Load more` requiring one or multiple later pages / “加载更多”需要一页或多页 | No duplicate requests; stop after contract-defined discovery; no Inspector opening / 无重复请求；按 contract 停止；不打开 Inspector |
| Repeated `Load more` to exhaustion and after exhaustion / 重复“加载更多”直到耗尽及耗尽后 | Stable idempotent denominator; link disappears; no hidden growth / 分母稳定幂等；链接消失；无隐藏增长 |
| Next from first/middle/last known target / 从首个/中间/最后已知 target 点击 Next | One canonical activation per click; materialize before wrap only at boundary / 每次只激活一个 canonical target；只在边界且回绕前物化 |
| Previous from first known target with unloaded later pages / 从首个已知 target 点击 Previous 且后续页未加载 | Exhaust required pages once, then activate deterministic previous/wrapped ID / 每页最多加载一次，然后激活确定的 previous/回绕 ID |
| Many Full-text hits in one event / 单事件含大量全文 occurrence | Behavior matches chosen event-anchor/canonical-occurrence contract; no surface multiplication / 符合选定 contract；无 surface 倍增 |
| Same phrase rendered in timeline and Inspector / 同一短语同时渲染于 timeline 与 Inspector | One canonical membership at most / 最多一个 canonical 成员 |
| Inspector-only supplemental phrase / 仅 Inspector 补充区包含短语 | Explicit approved fallback behavior; never accidental bulk detail targets / 执行明确批准的 fallback；绝不意外生成大量详情 target |
| Hidden/collapsed matching event / 隐藏或折叠的匹配事件 | Transient materialization respects user fold and canonical identity / 临时物化尊重用户折叠和 canonical 身份 |
| Manual fold after registration / 注册后手动折叠 | Temporarily unavailable binding does not corrupt membership/order / 暂不可用 binding 不破坏成员/顺序 |
| Detail loading placeholder replaced by full detail / 详情加载占位替换为完整详情 | Existing ID cannot rebind to different text; no new membership unless canonical corpus truly adds it / 旧 ID 不得重绑到不同文本；除非规范语料确有新增，否则不增成员 |
| Rapid Next/Previous/Load more interleaving / 快速交错点击 Next/Previous/加载更多 | Serialized deterministic result; no duplicates, skipped IDs, or stuck pending state / 串行且确定；无重复、跳过或 pending 卡死 |
| User scroll during programmatic navigation / 程序化导航期间用户滚动 | Existing scroll/pagination guard behavior remains correct / 现有滚动/分页 guard 行为保持正确 |
| Query edit during discovery / 发现期间编辑 query | Old operation commits nothing to new key / 旧操作不向新 key 提交任何内容 |
| Structured filter, profile draft/save/cancel, Layer, locale, session, repo changes / 筛选、profile 草稿/保存/取消、Layer、locale、session、repo 变化 | Correct reset boundary; stale response/DOM adds zero IDs / 正确重置边界；陈旧响应/DOM 新增 0 个 ID |
| Main, protocol, and raw layers / Main、protocol、raw 层 | Same canonical rules; layer-specific rendering cannot create chrome targets / 相同 canonical 规则；层特定渲染不能创建 chrome target |
| Desktop three-pane, two-pane, and narrow mobile detail tab / 桌面三栏、双栏和窄屏详情 tab | Membership independent of whether detail surface is visible / 成员与详情 surface 是否可见无关 |

## Test requirements / 测试要求

- Unit tests for descriptor identity, deterministic ordering, deduplication, binding replacement, active-position preservation, exhaustion, and context reset. / 为 descriptor 身份、确定顺序、去重、binding 替换、活动位置保持、耗尽及上下文重置增加单元测试。
- Browser tests for every matrix row that involves DOM, pagination, detail rendering, focus, scroll, or async interleaving. / 对矩阵中涉及 DOM、分页、详情渲染、焦点、滚动或异步交错的每一行增加浏览器测试。
- At least one regression must assert surface composition or canonical IDs directly enough that Inspector-only growth cannot satisfy “target count increased.” / 至少一个回归必须足够直接地断言 surface 构成或 canonical ID，使 Inspector-only 增长无法满足“target 数增加”。
- At least one regression must reproduce different Inspector occurrence counts and prove identical canonical membership before, during, and after both Inspectors. / 至少一个回归必须复现 Inspector occurrence 数不同，并证明两个 Inspector 前、中、后的 canonical 成员完全一致。
- At least one long-timeline test must assert exact requested offsets and prove no duplicate initial-page or pagination request. / 至少一个长时间线测试必须断言精确请求 offset，并证明没有重复初始页或分页请求。
- Keep English and Simplified Chinese UI assertions for count and loading/exhaustion copy. / 保留英文和简体中文计数及加载/耗尽文案断言。

## Execution evidence / 执行证据

The approved decision is the event-anchor model: `[completeSemanticSearchKey, logicalEventId]` is membership identity; timeline/Inspector occurrences are replaceable bindings; Inspector-only supplemental text has no target fallback. The following browser regressions cover the mandatory matrix. / 已批准决策为事件锚点模型：`[完整语义搜索 key, 逻辑事件 ID]` 是成员身份；timeline/Inspector occurrence 是可替换 binding；仅 Inspector 补充文本不存在 target fallback。以下浏览器回归覆盖强制矩阵。

| Matrix coverage / 矩阵覆盖 | Evidence / 证据 |
|---|---|
| Initial search, many occurrences, timeline/Inspector duplicate projection, user-open and search-transient Inspectors, different Inspector counts, close/profile/Raw refs/return, detail redraw / 首次搜索、多 occurrence、双 surface 投影、两类 Inspector、不同 Inspector 计数、关闭/profile/Raw refs/返回、详情重绘 | `browser search count separates discovered jump targets from full-text occurrences`; `browser search target identities and denominator stay stable across inspector redraws`; `browser search navigation preserves inspector marks while ignoring raw-detail chrome`; `browser inspector search reacquires live marks after redraw`; `browser inspector navigation failure clears loading and explicit click retries` |
| Loaded/later-page discovery, multi-page scan, exhaustion, exact offsets, no duplicates, active/selection/detail/scroll preservation / 已加载/后续页发现、多页扫描、耗尽、精确 offset、无重复及状态保持 | In the event-anchor model a committed loaded matching DTO is synchronously discovered, so “already loaded but still undiscovered” is impossible; the equivalent append boundary is the committing page. `browser canonical Load more scans multiple pages once and becomes idempotent at exhaustion` proves exact discovery offsets `150, 300, 450`, exhaustion offset `600`, one new ID, stable active/selection/detail/scroll, hidden link, and no duplicate discovery request. / 在事件锚点模型中，已提交且匹配的 DTO 会同步被发现，因此“不加载新页但已加载事件仍未发现”不可能；等价追加边界是页面提交时刻。该回归证明精确 offset、新 ID、状态保持、入口隐藏与无重复发现请求。 |
| Next/Previous first/middle/boundary/wrap, unloaded pages, rapid input and Load-more interleaving / Next/Previous 各位置、边界/回绕、未加载页、快速输入与加载交错 | `browser rapid search navigation is serialized without skips or duplicates`; `browser search navigation loads only the next hit page before wrapping`; `browser previous search navigation scans backward wrap through UI pages`; `browser rapid navigation and Load more interleaving commits one ordered activation` |
| Hidden/collapsed events and manual fold / 隐藏/折叠事件与手动折叠 | `browser search navigation temporarily expands hidden command detail targets`; `browser manual fold replaces occurrence bindings without changing event-anchor membership`. A manual fold retains the backend search snippet as a summary binding, so the old occurrence-level “second body descriptor becomes unavailable” shape is impossible; the test instead proves binding replacement with unchanged canonical IDs/order. / 手动折叠仍保留后端搜索 snippet 作为 summary binding，因此旧 occurrence 模型中“第二个正文 descriptor 不可用”的形态不可能；测试改为证明 binding 替换时 canonical ID/顺序不变。 |
| Query/filter/profile/layer/locale/session context races and stale DOM / Query、筛选、profile、layer、locale、session context 竞态与陈旧 DOM | `browser query edits invalidate an in-flight canonical discovery`; `browser search discovery waits for a structured result view to commit`; `browser search registry follows folding profile rule revisions`; `browser search discovery waits for localized timeline content to commit`; `browser search discovery excludes the previous timeline while switching sessions`; `browser project search commits after folding profile changes during an in-flight request` |
| Main/protocol/raw and three-pane/two-pane/mobile detail visibility / 三层与三栏/双栏/移动详情可见性 | `browser canonical membership is independent of responsive detail visibility and event layer chrome` |
| Programmatic/user scroll guard and bilingual large counts/copy / 程序化/用户滚动 guard 与双语大计数文案 | `browser user scroll during the search-scroll guard still loads the next page`; `browser large full-text counts stay unabridged beside canonical event targets in both locales` |

Pure unit coverage in `test/search-targets.test.js` proves descriptor identity, deterministic ordering, deduplication, binding replacement, active-ID position lookup after insertion, exhaustion, and context-key reset. / `test/search-targets.test.js` 的纯单元覆盖证明 descriptor 身份、确定顺序、去重、binding 替换、插入后的活动 ID 位置查找、耗尽和 context-key reset。

## Completion gates / 完成门禁

The goal executor must not mark this plan complete, archive it, or report success until all gates pass in the final implementation state. / 在最终实现状态下所有门禁通过前，goal 执行者不得把本计划标为完成、归档或报告成功。

1. The canonical target decision is recorded bilingually in product and design docs, including Inspector-only behavior. / canonical target 决策已在产品与设计文档中双语记录，包括 Inspector-only 行为。
2. Every mandatory reproduction row is covered or explicitly justified as impossible; no row may be silently omitted. / 每个强制复现行都有覆盖，或明确论证不可能；不得静默省略。
3. The original inflation regression stays fixed: opening/materializing Inspectors cannot change the denominator, and `Load more` cannot succeed on Inspector-only growth. / 原始膨胀回归持续修复：打开/物化 Inspector 不能改变分母，“加载更多”不能因 Inspector-only 增长成功。
4. Repeated discovery and navigation reach exhaustion with stable canonical IDs, stable ordering, no stale presentation descriptors, and no unintended detail jumps. / 重复发现与导航达到耗尽时 canonical ID 与顺序稳定，无陈旧展示 descriptor，无非预期详情跳转。
5. No debug-only production API, global state exposure, fixture shortcut, count clamp, or UI-only masking remains. / 不残留仅调试用生产 API、全局状态暴露、fixture 捷径、计数 clamp 或仅 UI 掩盖。
6. Generated assets are rebuilt and current. / 生成资源已重建且为最新。
7. `npm run build`, `npm run build:check`, `npm test`, full `npm run test:browser`, and `git diff --check` all pass. / `npm run build`、`npm run build:check`、`npm test`、完整 `npm run test:browser` 和 `git diff --check` 全部通过。
8. Run the focused canonical-target browser group at least twice after the full suite to detect ordering or async flakiness. / 完整套件后至少再运行两次 canonical-target 聚焦浏览器组，以发现顺序或异步 flaky。
9. Perform an in-app browser acceptance on the real project using a query with many Inspector occurrences and record before/after target IDs or equivalent surface-independent evidence. / 在真实项目中使用含大量 Inspector occurrence 的 query 进行内置浏览器验收，记录前后 target ID 或等价的 surface-independent 证据。
10. Review all changed product/design/exec-plan bilingual sections together and confirm they describe the same final behavior. / 一并审查所有变更的产品/设计/执行计划双语区段，确认其描述同一最终行为。
11. Only then move this file to `docs/exec-plans/completed/`, update `AGENTS.md`, and add a completion summary with exact test counts and any consciously retained limitations. / 只有此后才能把本文件移动到 `docs/exec-plans/completed/`、更新 `AGENTS.md`，并添加包含精确测试数量和任何有意保留限制的完成总结。

## Completion summary / 完成总结

- Final automated gates passed in the final implementation state: `npm run build`, `npm run build:check`, `npm test` with **177/177**, full `npm run test:browser` with **50/50**, and `git diff --check`. After the full browser suite, the focused canonical-target group passed twice at **15/15** and **15/15**. / 最终实现状态下自动化门禁全部通过：`npm run build`、`npm run build:check`、`npm test` **177/177**、完整 `npm run test:browser` **50/50** 以及 `git diff --check`。完整浏览器套件后，canonical-target 聚焦组连续两轮均通过，分别为 **15/15** 与 **15/15**。
- Real-project in-app-browser acceptance used an anonymized local session, Main-layer query `patch`, and the Chinese locale. Initial evidence was **28 canonical event IDs / 696 Full-text hits / 63 timeline marks / 32 Inspector marks**. One Next action switched to an Inspector with **2 marks** and changed the active owner while the ordered 28-ID array stayed byte-for-byte identical. Local repository paths, session identity, and event-owner IDs are intentionally omitted from the public record. / 真实项目内置浏览器验收使用匿名化的本地 session、Main 层 query `patch` 与中文 locale。初始证据为 **28 个 canonical 事件 ID / 696 个全文命中 / 63 个 timeline mark / 32 个 Inspector mark**。一次 Next 切换到含 **2 个 mark** 的 Inspector 并改变活动 owner，同时有序 28-ID 数组逐字节保持一致。公开记录有意省略本地 repository 路径、session identity 与 event-owner ID。
- In the same anonymized session, explicit `Load more` changed canonical membership from **28 to 45** by appending **17 concrete event-owner IDs** while preserving the original 28-ID prefix, active ID, selected event, detail view, timeline scroll position, and Inspector mark count; pending cleared normally. This directly rejects the original Inspector-only `5 -> 11 -> 43` inflation path. / 在同一匿名化 session 中，显式“加载更多”通过追加 **17 个具体 event-owner ID** 把 canonical 成员从 **28 增至 45**，同时保持原 28-ID 前缀、活动 ID、所选事件、详情视图、timeline 滚动位置与 Inspector mark 数不变；pending 正常清除。这直接排除了原始 Inspector-only `5 -> 11 -> 43` 膨胀路径。
- Consciously retained limitation: the approved event-anchor model intentionally provides one navigation stop per matching logical event, not one stop per phrase occurrence. Inspector-only supplemental phrases are highlighted but never navigable members. The narrow `data-search-target-ids` and `data-search-active-target-id` DOM attributes are the documented observable contract used for regression and acceptance evidence; no unrestricted global debug API exists. / 有意保留的限制：已批准事件锚点模型刻意让每个匹配逻辑事件只有一个导航停靠点，而不是每个短语 occurrence 一个。仅 Inspector 补充短语会高亮，但绝不成为可导航成员。窄化的 `data-search-target-ids` 与 `data-search-active-target-id` DOM 属性是用于回归和验收证据的已记录可观察 contract；不存在不受限全局 debug API。

## Files likely to change / 可能变更的文件

- `src/browser/app.js`: registry, discovery, materialization, navigation, highlight binding, `Load more`, Inspector synchronization. / registry、发现、物化、导航、高亮绑定、“加载更多”、Inspector 同步。
- `src/browser/highlight.js`: only if stable canonical binding requires richer mark metadata; it must not become the membership owner. / 仅当稳定 canonical binding 需要更丰富 mark metadata 时修改；它不能成为成员关系 owner。
- `src/browser/search-controls.js` and tests: pure count/control models if the chosen contract benefits from extraction. / 如选定 contract 适合抽取，则修改纯计数/控件模型及测试。
- Backend search/timeline DTO builders and tests if canonical-occurrence descriptors are chosen. / 如选择规范 occurrence descriptor，则修改后端搜索/timeline DTO builder 与测试。
- `e2e/browser.test.js`: complete reproduction matrix and regression replacement. / 完整复现矩阵与回归替换。
- `src/shared/i18n.js`: only for final user-visible loading/exhaustion terminology changes. / 仅在最终用户可见加载/耗尽术语变化时修改。
- `public/assets/app.js`: generated only through the build. / 仅通过构建生成。
- Bilingual product and design docs plus this plan. / 双语产品、设计文档及本计划。

## Risks and prohibited shortcuts / 风险与禁止捷径

- **Prohibited:** clamp Jump targets to Full-text hits, hide Inspector targets only in the UI, or alter copy so inflated targets look intentional. / **禁止：**把 Jump targets clamp 到 Full-text hits、仅在 UI 隐藏 Inspector target，或修改文案让膨胀看似合理。
- **Prohibited:** clear the entire registry on every Inspector redraw. That hides accumulation but reintroduces denominator oscillation and active-index regression. / **禁止：**每次 Inspector 重绘都清空整个 registry；这会隐藏累积，却重新引入分母震荡和活动索引倒退。
- **Prohibited:** close or disable Inspector/Raw refs during search. User-confirmed detail persistence is an independent contract. / **禁止：**搜索期间关闭或禁用 Inspector/Raw refs；用户确认详情保持是独立 contract。
- **Prohibited:** make `Load more` load a fixed arbitrary page and call any mark growth success. / **禁止：**让“加载更多”固定加载任意一页并把任意 mark 增长视为成功。
- **Prohibited:** weaken tests to accept monotonic inflation, or assert only that navigation eventually moves somewhere. / **禁止：**弱化测试以接受单调膨胀，或只断言导航最终移动到某处。
- **Risk:** choosing canonical occurrences may expand API scope. Stop and update the plan/design decision rather than smuggling DOM order back in as a shortcut. / **风险：**选择 canonical occurrence 可能扩大 API 范围；应暂停并更新计划/设计决策，不得把 DOM 顺序作为捷径偷偷带回。
- **Risk:** event-anchor semantics may be a user-visible reduction in within-event navigation. Update the product spec and obtain explicit acceptance through the plan's decision checkpoint. / **风险：**事件锚点语义可能减少事件内导航；必须更新产品规格，并通过计划决策检查点明确接受。

## Progress log / 进度日志

- 2026-07-12: Reproduced the live failure (`5 / 45` -> `11 / 45` after `Load more` -> `43 / 45` after one Next), identified Inspector-only registration and stale append-only descriptors, audited the contradictory tests and docs, and opened this active plan. No runtime fix has been applied under this plan. / 2026-07-12：在真实页面复现问题（`5 / 45` -> “加载更多”后 `11 / 45` -> 再点击一次 Next 后 `43 / 45`），定位 Inspector-only 注册与陈旧只增不减 descriptor，审查矛盾测试和文档，并建立本 active plan。本计划尚未应用运行时修复。
- 2026-07-12: Implemented the event-anchor registry and separate timeline/Inspector bindings, removed detail synchronization from `Load more`, added canonical unit coverage and the full browser evidence matrix, reconciled the bilingual product/design contract including the deliberate absence of Inspector-only targets, and rebuilt generated assets. Automated final gates and real-project in-app acceptance remain to be recorded before archival. / 2026-07-12：实现事件锚点 registry 与分离的 timeline/Inspector binding，从“加载更多”移除详情同步，增加 canonical 单元覆盖与完整浏览器证据矩阵，同步调整双语产品/设计 contract（包括明确不保留 Inspector-only target），并重建生成资产。归档前仍需记录自动化最终门禁与真实项目内置浏览器验收。
- 2026-07-12: Passed all final automated gates, two focused reruns, and real-project in-app-browser acceptance; recorded exact surface-independent evidence and completion limitations, then archived this plan. / 2026-07-12：通过全部最终自动化门禁、两轮聚焦复跑与真实项目内置浏览器验收；记录精确的 surface-independent 证据及完成限制，随后归档本计划。
