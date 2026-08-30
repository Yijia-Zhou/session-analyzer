# Performance Wave 1D-A: ordinary detail-body settlement and visible-detail scan narrowing / 性能 Wave 1D-A：普通 detail body settlement 与 visible-detail scan 收窄

## 1. Status, identity, and authorization / 状态、身份与授权

```text
Technical design: FORMAL PLAN — ACCEPTED; M0 AND M1 EXECUTOR COMPLETE
Repository: Yijia-Zhou/session-analyzer
Target branch: towards-0.2.0
Accepted inspected base: b7ca3bff12fd5061410aaa3483341023498b23d4
Accepted inspected tree: cad8ff765804bbc0b5c4d2bbec48784da98814e7
Live target: b7ca3bff12fd5061410aaa3483341023498b23d4
Live target tree: cad8ff765804bbc0b5c4d2bbec48784da98814e7
Implementation branch: perf/wave-1d-a-ordinary-detail-body-patch
Formal plan: docs/exec-plans/active/2026-08-30-performance-wave-1d-a-ordinary-detail-body-patch.md

Primary decision: RECOMMEND_SMALL_WAVE_1D_THEN_SERVER_CHECKPOINT
Independent plan review: PLAN_1D_A — ACCEPTED; NORMATIVE_BLOCKERS — CLOSED; ARCHITECTURAL_BLOCKERS — NONE
Implementation authorization: M1 ONLY — COMPLETE; R1/M2 NOT AUTHORIZED
M0 authorization: GRANTED 2026-08-30 — PASS
M1 authorization: GRANTED 2026-08-30; EXECUTOR COMPLETED 2026-08-31 — PASS_M1_EXECUTOR
Active-plan registration in AGENTS.md: PERFORMED
Product/test changes: BOUNDED M1 IMPLEMENTATION — SEE SECTION 31
Generated asset changes: NONE
Profiling/evidence capture: NONE
```

M0 and M1 were separately authorized. Section 30 records the accepted M0 contract freeze; Section 31 records the bounded M1 implementation and focused executor validation. R1 and M2 remain unauthorized. No generated-asset update, formal profiling, evidence capture, candidate commit, push, PR, merge, publish, or release is authorized or performed. / M0 与 M1 均获另行授权。第 30 节记录 accepted M0 contract freeze；第 31 节记录 bounded M1 implementation 与 focused executor validation。R1 与 M2 仍未授权。未授权或执行 generated asset 更新、formal profiling、evidence capture、candidate commit、push、PR、merge、publish 或 release。

This plan is bounded to Wave 1D-A and now stops after passed M1 executor validation, before fresh independent R1. It does not authorize Wave 1D-B or a server wave. / 本计划仅覆盖 Wave 1D-A，现于 M1 executor validation 通过后、fresh independent R1 前停止。它不授权 Wave 1D-B 或 server wave。

---

## 2. Goal-ready objective / 可直接用于执行目标的目标

Remove the demonstrated post-Wave-1C whole-prefix presentation amplification caused by accepted ordinary Main detail settlements, while preserving the exact mounted article and context-slot identities and retaining full-render fallback for Code Mode and every incompatible transaction. Also narrow visible-detail geometry reads from all mounted cards to actual detail-loading candidates. / 消除已证明的 Wave 1C 后普通 Main detail settlement 所导致的整段前缀 presentation amplification，同时保留 mounted article 与 context slot 的精确 identity，并对 Code Mode 与所有不兼容 transaction 保留 full-render fallback；同时将 visible-detail geometry read 从全部 mounted card 收窄到实际 detail-loading candidate。

The preferred production primitive is deliberately body-local: / 首选 production primitive 有意限定为 body-local：

```text
patchOrdinaryTimelineDetailBody(event)
```

It is not: / 它不是：

```text
replaceTimelineArticle(event)
generic owner-local renderer
generic component diff
virtual DOM
```

One newly accepted detail state mutation owns exactly one Timeline presentation settlement. Repeated callers may await one request, but caller promises never become independent Timeline presentation owners. / 每个新接受的 detail state mutation 精确拥有一次 Timeline presentation settlement。重复 caller 可 await 同一个 request，但 caller promise 永不成为独立 Timeline presentation owner。

---

## 3. Governing authority and inherited contracts / 权威文档与继承合同

At future M0, reread the implementation-ref versions of at least: / 未来 M0 至少复读以下 implementation-ref 版本：

```text
README.md
AGENTS.md
CONTEXT.md
docs/product-specs/session-transcript-analyzer.md
docs/design-docs/timeline-loading-and-rendering-performance.md
docs/design-docs/indexed-materialized-session-lifecycle.md
docs/design-docs/logical-event-timeline.md
docs/exec-plans/completed/2026-08-24-performance-wave-0-baseline.md
docs/exec-plans/completed/2026-08-27-performance-wave-1a-browser-hot-path.md
docs/exec-plans/completed/2026-08-29-performance-wave-1b-search-render-coalescing.md
docs/exec-plans/completed/2026-08-30-performance-wave-1c-keyed-main-append.md

src/browser/app.js
src/browser/timeline-card-lifecycle.js
src/browser/search-targets.js
src/browser/highlight.js
src/browser/timeline-event-state.js
src/browser/timeline-search-batch.js
src/browser/transition-safety.js

e2e/browser.test.js
test/timeline-card-lifecycle.test.js
test/search-targets.test.js
test/highlight.test.js

scripts/build-client.js
scripts/timeline-profile.js
scripts/performance-wave-0-runner.js
scripts/performance-wave-1b-validator.js
package.json
```

Wave 1A remains authoritative for canonical Timeline ownership: / Wave 1A 继续权威定义 canonical Timeline ownership：

```text
currentEvents
currentEventsById
offset
timelineDataContext
```

Wave 1B remains authoritative for search-owned batch accumulation, invocation/generation ownership, stale/abort behavior, and one accepted canonical publication. Wave 1D-A must not change batch policy. / Wave 1B 继续权威定义 search-owned batch accumulation、invocation／generation ownership、stale／abort behavior 与一次 accepted canonical publication。Wave 1D-A 不得改变 batch policy。

Wave 1C remains authoritative for keyed canonical Main owners, the unified Timeline-root writer, the fixed-width presentation token, same-context suffix append, suffix-only search work, canonical-context retirement, and fail-closed fallback. Wave 1D-A extends that presentation lifecycle only for the closed ordinary-detail transaction defined here. / Wave 1C 继续权威定义 keyed canonical Main owner、统一 Timeline-root writer、固定宽度 presentation token、同 context suffix append、suffix-only search work、canonical-context retirement 与 fail-closed fallback。Wave 1D-A 仅针对本文封闭定义的 ordinary-detail transaction 扩展该 presentation lifecycle。

---

## 4. Accepted baseline and evidence boundary / 已接受 baseline 与 evidence boundary

The accepted starting point is: / 已接受起点为：

```text
merge commit: b7ca3bff12fd5061410aaa3483341023498b23d4
tree:         cad8ff765804bbc0b5c4d2bbec48784da98814e7
merged PR:    #29 — perf(browser): add keyed Main timeline append
```

Accepted Wave 1C late-hit raw evidence: / 已接受 Wave 1C late-hit raw evidence：

```text
Timeline-root mutation rows: 13 / 14 / 14
card generations:             22,800 / 24,600 / 24,600
timeline requests:            8 / 8 / 8
detail requests:              8 / 8 / 8
Long Task total:              5,348 / 5,440 / 5,478 ms
```

The accepted keyed suffix publication creates 1,200 cards. Therefore: / 已接受 keyed suffix publication 创建 1,200 个 card，因此：

```text
22,800 = 1,200 + 12 × 1,800
24,600 = 1,200 + 13 × 1,800
```

This is strong structural evidence of repeated post-publication whole-prefix presentation amplification. Raw schema-4 root rows do not independently classify every record as append or replacement and do not timestamp individual detail-to-root causality. The formal plan therefore treats operation-level focused observation as the causal seam and keeps generic timing descriptive. / 这是 repeated post-publication whole-prefix presentation amplification 的强结构证据。Raw schema-4 root row 不能独立将每条 record 分类为 append 或 replacement，也不记录逐个 detail 到 root 的 timestamp causality。因此，本正式计划以 operation-level focused observation 作为 causal seam，并继续把 generic timing 仅作描述。

No duration, Long Task, percentage-improvement, or throughput number is an acceptance gate. / 任何 duration、Long Task、百分比改进或 throughput 数值都不是验收 gate。

---

## 5. Confirmed current source facts / 已确认的当前源码事实

At the accepted tree: / 在 accepted tree 中：

1. `renderEventBody(event, display)` returns no body unless `display === 'expanded'`.
2. Expanded ordinary loading, success, and error states are all represented by one `.eventBody` wrapper.
3. For `event.kind !== 'code_mode_operation'`, accepted detail state does not drive the article label, chips, external preview, toggle, article classes, context slot, enclosing-operation relationship, or footer.
4. The expanded footer depends on display state, not detail success/error.
5. `codeModeEventPresentation()` is explicitly kind-gated, while `compactCodeModeWebLifecycleIds()` consumes cached details whose detail kind is `code_mode_operation`.
6. `loadEventDetail()` deduplicates network requests with `detailPending[key]`, but every `ensureEventDetail()` caller currently attaches its own `.then(renderTimeline)` continuation.
7. `showInspector()` separately awaits the same request and reconstructs Inspector; `renderDetailShell()` currently owns a complete `refreshSearchHighlights()`.
8. `loadVisibleExpandedDetails()` queries every mounted article and reads geometry before checking expanded/Code Mode candidacy.
9. Timeline and Inspector retry handlers and `resetSessionDetailCache()` also advance `detailPresentationRevision`; they are not automatically the same eligible accepted-settlement transaction.
10. `loadEventDetail()` currently uses a fulfillment handler followed by a request/detail-error `catch`; inserting presentation into that fulfillment chain without a new boundary would allow presentation exceptions to be misclassified as request failures.

1. `renderEventBody(event, display)` 仅在 `display === 'expanded'` 时返回 body；
2. 展开状态下的普通 loading、success 与 error 均由一个 `.eventBody` wrapper 表示；
3. 对 `event.kind !== 'code_mode_operation'`，accepted detail state 不驱动 article label、chip、body 外 preview、toggle、article class、context slot、enclosing-operation relationship 或 footer；
4. expanded footer 依赖 display state，而不依赖 detail success／error；
5. `codeModeEventPresentation()` 有显式 kind gate，`compactCodeModeWebLifecycleIds()` 只消费 detail kind 为 `code_mode_operation` 的 cached detail；
6. `loadEventDetail()` 通过 `detailPending[key]` 去重 network request，但当前每个 `ensureEventDetail()` caller 都会各自附加 `.then(renderTimeline)` continuation；
7. `showInspector()` 独立 await 同一 request 并重建 Inspector；`renderDetailShell()` 当前负责一次完整 `refreshSearchHighlights()`；
8. `loadVisibleExpandedDetails()` 查询全部 mounted article，并在判断 expanded／Code Mode candidacy前读取 geometry；
9. Timeline／Inspector retry handler 与 `resetSessionDetailCache()` 也会推进 `detailPresentationRevision`；它们不会自动成为同一个 eligible accepted-settlement transaction。
10. `loadEventDetail()` 当前使用 fulfillment handler 后接 request／detail-error `catch`；如果没有新 boundary 就把 presentation 插入该 fulfillment chain，会使 presentation exception 被错误分类为 request failure。

Any M0 descendant drift that invalidates one of these facts requires plan review before implementation. / 任何使上述事实失效的 M0 descendant drift 都要求在实现前重新评审本计划。

---

## 6. Included scope / 包含范围

Wave 1D-A contains only: / Wave 1D-A 仅包含：

1. one request-owned Timeline presentation settlement for each newly accepted detail success/error mutation;
2. an explicit one-way request-error/presentation-error boundary and a shared closed settlement outcome;
3. body-only local presentation for eligible expanded ordinary canonical Main owners;
4. no-DOM token reconciliation for eligible ordinary owners whose detail is not mounted in their current presentation;
5. lifecycle-wide mounted-token adoption with internally consistent owner token metadata;
6. owner-scoped Timeline mark pruning, rehighlighting, and binding restoration;
7. selected-Inspector scoped reconstruction/highlighting only as part of the request-owned local outcome;
8. candidate-first visible-detail scanning with fixed-small scrollport geometry reads;
9. focused Chromium-only, content-free causal observation;
10. explicit transaction-wide full-render fallback for every ineligible or uncertain local outcome.

1. 每个新接受的 detail success／error mutation 仅有一个 request-owned Timeline presentation settlement；
2. 显式 one-way request-error／presentation-error boundary 与 shared closed settlement outcome；
3. 对 eligible expanded ordinary canonical Main owner 仅做 body-local presentation；
4. 对 detail 未出现在当前 mounted presentation 中的 eligible ordinary owner 做 no-DOM token reconciliation；
5. lifecycle-wide mounted token adoption，并保持 owner token metadata 内部一致；
6. owner-scoped Timeline mark pruning、rehighlight 与 binding restoration；
7. 仅作为 request-owned local outcome 的一部分，对 selected Inspector 做 scoped reconstruction／highlight；
8. candidate-first visible-detail scan，并将 scrollport geometry read 限定为固定小常数；
9. 仅限 focused Chromium、content-free causal observation；
10. 对所有 ineligible 或不确定 local outcome 显式保留 transaction-wide full-render fallback。

---

## 7. Explicit non-goals / 明确非目标

Wave 1D-A must not implement: / Wave 1D-A 不得实施：

```text
article replacement for ordinary detail settlement
generic keyed-owner article reconstruction
generic component diff or virtual DOM

Code Mode local detail fanout
web_search compact-fanout dependency graph

single-event fold/override patching
search transient-expansion local patching
navigation-reveal local patching
temporary-event local ownership
selection-only global-scan removal except detail correctness needs

global Folding Strategy/profile local patching
locale local patching
Layer local patching
query/filter replacement local patching

Protocol/Raw incremental presentation
virtualization or render windows
IntersectionObserver architecture

server/query/cache/index changes
generic profiler schema evolution
Wave 0 runner changes
Wave 1B validator changes
canonical Timeline ownership changes
Wave 1B batch-policy changes
```

A possible Wave 1D-B is not authorized. After accepted Wave 1D-A evidence, the default is a server checkpoint unless exact browser evidence proves another dominant repeated warm residual. / 不授权可能的 Wave 1D-B。Wave 1D-A evidence 接受后，默认进入 server checkpoint；只有精确 browser evidence 证明另一个占主导的 repeated warm residual 时才例外。

---

## 8. Detail request and mutation ownership / Detail request 与 mutation ownership

### 8.1 One request, one Timeline presentation owner / 一个 request、一个 Timeline presentation owner

Future M1 must move Timeline presentation ownership to the boundary that creates a new `detailPending[key]` request, or an equivalent unique request-owned boundary. Conceptually: / 未来 M1 必须把 Timeline presentation ownership 移到创建新 `detailPending[key]` request 的 boundary，或等价的唯一 request-owned boundary：

```text
new detail request created
→ one accepted success or error state mutation
→ one detailPresentationRevision advance
→ one request-owned Timeline presentation reconciliation
→ one final settlement outcome is selected
→ shared promise resolves that outcome for non-Timeline callers
```

Existing callers may continue to await the shared promise for their own current-context work. They may not schedule Timeline presentation. `ensureEventDetail()` must cease owning `renderTimeline()` or any equivalent Timeline settlement continuation. / 现有 caller 可继续 await shared promise 以完成自身 current-context 工作，但不得安排 Timeline presentation。`ensureEventDetail()` 必须不再拥有 `renderTimeline()` 或任何等价 Timeline settlement continuation。

Hard focused contract: / 硬 focused contract：

```text
N ensureEventDetail() calls while one request is pending
→ one network request
→ at most one accepted detail state mutation
→ exactly one detail revision advance when accepted
→ exactly one Timeline presentation settlement when accepted
```

Intentional abort or stale response produces zero accepted mutation, zero detail revision advance, and zero Timeline presentation settlement. / Intentional abort 或 stale response 产生零 accepted mutation、零 detail revision advance 与零 Timeline presentation settlement。

### 8.2 Closed detail-state mutation inventory / 封闭 detail-state mutation inventory

M0 must inventory every current mutation of: / M0 必须 inventory 以下状态的每个当前 mutation：

```text
state.detailCache
state.detailErrors
state.detailPending
state.detailCacheGeneration
detailPresentationRevision
detailRequestControllers
```

The accepted success/error writes inside a newly created request are the only initially eligible local transactions. Session cache reset, Timeline retry deletion, Inspector retry deletion, abort cleanup, and any new descendant write remain non-eligible until individually proven. / 新创建 request 内的 accepted success／error write 是初始唯一 eligible local transaction。Session cache reset、Timeline retry deletion、Inspector retry deletion、abort cleanup 与任何 descendant 新写点，在逐一证明前继续为 non-eligible。

Retry currently deletes error/cache and independently advances `detailPresentationRevision`. Wave 1D-A must not merge that mutation silently into a later accepted response transaction. If the mounted token no longer matches the response transaction's `beforeToken`, the response uses full-render fallback. Changing retry loading presentation or revision semantics requires scope review. / Retry 当前会删除 error／cache 并独立推进 `detailPresentationRevision`。Wave 1D-A 不得把该 mutation 静默合并进后续 accepted response transaction。如果 mounted token 不再匹配 response transaction 的 `beforeToken`，该 response 使用 full-render fallback。修改 retry loading presentation 或 revision 语义需要 scope review。

### 8.3 Request-error and presentation-error boundary / Request error 与 presentation error boundary

Request classification and presentation classification are separate, one-way phases. The future implementation must use an explicit semantic boundary equivalent to: / Request classification 与 presentation classification 是分离的单向 phase。未来实现必须使用等价于以下形式的显式语义 boundary：

```text
transportPromise.then(
  acceptedSuccessHandler,
  acceptedRequestFailureHandler,
)
→ separately protected request-owned presentation settlement
```

Exact promise syntax is not mandated. The mandatory property is that an exception thrown by accepted-success presentation, accepted-error presentation, local body work, lifecycle adoption, search refresh, Inspector refresh, or full-render fallback can never flow into the request/detail-error classifier. / 不强制精确 promise syntax。强制属性是：accepted-success presentation、accepted-error presentation、local body work、lifecycle adoption、search refresh、Inspector refresh 或 full-render fallback 抛出的 exception 永远不能流入 request／detail-error classifier。

After an accepted success performs: / Accepted success 执行以下写入后：

```text
detailCache write
detailErrors cleanup
one detailPresentationRevision advance
```

that success classification is final. A later presentation exception must not write `detailErrors`, delete or replace the accepted detail, advance `detailPresentationRevision` again, create a second accepted mutation, or create a second Timeline settlement. The same rule applies after an accepted request-error mutation: its original `detailErrors` state remains authoritative through any presentation failure. / 该 success classification 已最终确定。后续 presentation exception 不得写入 `detailErrors`、删除或替换 accepted detail、再次推进 `detailPresentationRevision`、创建第二次 accepted mutation，或创建第二次 Timeline settlement。Accepted request-error mutation 同样适用：无论 presentation 如何失败，原始 `detailErrors` state 继续具有 authority。

Presentation failure after an accepted mutation first attempts one coherent full-render fallback within the same request-owned settlement. If that fallback also fails, propagate or surface a presentation failure while retaining the accepted detail state and the same single settlement identity. Never reinterpret it as transport/detail failure. / Accepted mutation 后的 presentation failure 首先在同一个 request-owned settlement 内尝试一次 coherent full-render fallback。如果 fallback 也失败，则在保留 accepted detail state 与同一 single settlement identity 的同时 propagate／surface presentation failure；绝不得重新解释为 transport／detail failure。

The shared request result must expose a closed request-owned outcome to non-owning continuations: / Shared request result 必须向 non-owning continuation 暴露封闭的 request-owned outcome：

```text
bodyPatch
noDomAdoption
fullRenderFallback
stale
abort
```

If the selected `fullRenderFallback` itself fails, the result may additionally carry or throw a presentation-error status without changing the selected outcome. The accepted state remains authoritative, and no second mutation or settlement exists. Inspector and other callers may observe the outcome/error; they may not schedule another Timeline presentation. / 如果 selected `fullRenderFallback` 本身失败，result 可额外携带或抛出 presentation-error status，但不得改变 selected outcome。Accepted state 继续具有 authority，且不存在第二次 mutation 或 settlement。Inspector 与其它 caller 可观察 outcome／error，但不得安排另一轮 Timeline presentation。

---

## 9. Exact before/after token transaction / 精确 before／after token transaction

For every newly accepted detail success/error mutation, the unique request owner performs synchronously: / 对每个新接受的 detail success／error mutation，唯一 request owner 同步执行：

```text
beforeToken = currentTimelinePresentationToken()

write accepted detail or detail error
advance detailPresentationRevision exactly once

afterToken = currentTimelinePresentationToken()
presentAcceptedDetailMutation(transaction)
```

The transaction carries enough runtime identity to validate Session, Layer, detail generation, request/controller ownership, canonical event, canonical context, and selection context. Test evidence must use serials and closed classifications rather than literal event IDs. / Transaction 在 runtime 中携带足够 identity，以验证 Session、Layer、detail generation、request／controller ownership、canonical event、canonical context 与 selection context。Test evidence 必须使用 serial 与封闭 classification，而非 literal event ID。

Local settlement is eligible only when: / 仅在以下全部条件满足时 local settlement 才 eligible：

```text
beforeToken.valid == true
afterToken.valid == true

localePresentationRevision unchanged
foldingPresentationRevision unchanged
overridesRevision unchanged
navigationRevealRevision unchanged
searchTransientRevision unchanged
temporaryRevealRevision unchanged

after.detailPresentationRevision
  == before.detailPresentationRevision + 1

mounted canonical context unchanged
mounted lifecycle-wide token == beforeToken
```

Comparison is fixed-width and must not serialize, hash, sort, or scan owners, DOM, detail caches, overrides, transient IDs, canonical events, or any other variable-sized presentation state. Overflow or any unexpected extra mutation makes the token invalid or incompatible and selects full-render fallback. / 比较为 fixed-width，不得序列化、hash、sort 或扫描 owner、DOM、detail cache、override、transient ID、canonical event 或其它 variable-sized presentation state。Overflow 或任何意外额外 mutation 均使 token invalid／incompatible，并选择 full-render fallback。

Concurrent detail responses remain safe because JavaScript accepts and presents each mutation synchronously in sequence. Each transaction captures its own immediate pre-write token; the previous accepted transaction must finish local adoption or full fallback before the next transaction can become eligible. / 并发 detail response 仍然安全，因为 JavaScript 按顺序同步接受并展示每次 mutation。每个 transaction 捕获自身 write 前的即时 token；前一个 accepted transaction 必须完成 local adoption 或 full fallback，后一个 transaction 才可能 eligible。

---

## 10. Closed ordinary-detail eligibility matrix / 封闭 ordinary-detail eligibility matrix

Every row is required. Missing proof selects the full-render fallback. / 每一行均为必需条件；缺少任一证明即选择 full-render fallback。

| Dimension / 维度 | Eligible requirement / Eligible 要求 | Failure behavior / 失败行为 |
| --- | --- | --- |
| Search scope | Exact Session Scope | Full render or existing non-Session path |
| Layer | Exact Main Layer | Existing full-render behavior |
| Session | Response Session equals current selected Session | Zero stale presentation |
| Detail generation | Response generation equals current `detailCacheGeneration` | Zero accepted mutation/presentation when stale |
| Request ownership | Current controller/pending owner is the accepting request | Zero duplicate settlement |
| Canonical event | Current `currentEventsById` entry exists and is the transaction event | Full render if accepted state is current but identity is uncertain |
| Lifecycle owner | Exact owner exists for canonical event | Full render; owner absence is never locally eligible |
| Event kind | `event.kind !== 'code_mode_operation'` and accepted detail is not Code Mode | Full render |
| Canonical context | `timelineDataContext` and lifecycle mounted context are exact/current | Full render |
| Token | Lifecycle token equals `beforeToken`; only expected detail field differs in `afterToken` | Full render |
| Temporary state | No temporary reveal, replacement retry, project selection, or incompatible transition | Full render |
| Owner identity | Owner article is connected, under current Timeline root, exact dataset ID, and current lifecycle reference | Full render |
| Context slot | Current lifecycle context-slot reference remains connected/exact when non-null | Full render |
| Search context | Search key/query and Timeline surface context are unchanged/current | The request-owned transaction selects one full-render fallback; no local outcome is recorded |
| Body shape | Expanded case has exactly one expected direct `.eventBody`; prepared result has exactly one body | Full render |
| Inspector unaffected | No current selected Inspector depends on this event | Local outcome may proceed if every other row passes |
| Inspector affected | Exact scoped reconstruction/highlighting is preflighted and can complete inside the request-owned transaction | The complete transaction selects one full-render fallback; no local outcome is recorded |
| Outcome ownership | Shared request result exposes the request-owned final outcome | Inspector/callers must not schedule a second Timeline presentation |

The eligibility implementation must be a closed predicate with focused negative tests. It must not grow into heuristic compatibility. / Eligibility implementation 必须是带 focused negative test 的封闭 predicate，不得发展为 heuristic compatibility。

---

## 11. Expanded ordinary-owner body patch / Expanded ordinary owner 的 body patch

When the canonical ordinary event is currently expanded and the exact mounted body represents loading/detail/error presentation: / 当 canonical ordinary event 当前为 expanded，且精确 mounted body 表示 loading／detail／error presentation 时：

```text
validate transaction and owner
→ prepare exact next renderEventBody(event, 'expanded') off-DOM
→ prove one expected .eventBody root and no sibling/card markup
→ preflight selected-Inspector scoped work when affected
→ snapshot affected-owner search state
→ replace/update only the current .eventBody subtree
→ refresh only affected-owner Timeline highlighting/bindings
→ complete selected-Inspector scoped refresh when affected
→ adopt mounted presentation token
→ only now classify the transaction as bodyPatch
```

The exact existing identities that must survive are: / 必须存活的精确现有 identity：

```text
article node
context slot node
eventHeader node
eventToggle node
external eventPreview node, when present
enclosing-operation affordance node
eventFooterActions node and controls
selected/article class state
every unrelated article and context slot
scroll position
```

Only `.eventBody` may be replaced or updated. The old and new `.eventBody` node identities need not match. The article must match exactly. / 仅允许 replacement／update `.eventBody`。旧、新 `.eventBody` node identity 无需一致；article 必须精确一致。

Owner-scoped rehighlighting is the sole narrow exception to descendant mark/text-node identity inside the affected article: affected-owner mark nodes may be recreated across the complete article, while structural header/toggle/preview/footer elements remain identical. Marks in every unrelated owner must retain exact identity. / Owner-scoped rehighlight 是 affected article 内 descendant mark／text-node identity 的唯一窄例外：可在完整 article 内重建 affected-owner mark node，但结构性 header／toggle／preview／footer element 必须保持精确 identity。每个 unrelated owner 中的 mark 必须保持精确 identity。

If off-DOM preparation, body lookup, search refresh, Inspector refresh, or lifecycle adoption is unsafe or fails after accepted state mutation, the entire request-owned transaction selects `fullRenderFallback`; it must not remain classified as `bodyPatch`. Synchronously attempt the existing coherent full `renderTimeline()`/global-safe path. Do not leave a partially adopted token. A fallback exception is surfaced only as presentation failure under Section 8.3 and cannot reclassify accepted detail state. / 如果 off-DOM preparation、body lookup、search refresh、Inspector refresh 或 lifecycle adoption 不安全，或在 accepted state mutation 后失败，则整个 request-owned transaction 选择 `fullRenderFallback`；不得继续分类为 `bodyPatch`。同步尝试现有 coherent full `renderTimeline()`／global-safe path。不得留下 partially adopted token。Fallback exception 仅按第 8.3 节作为 presentation failure 暴露，不能重新分类 accepted detail state。

---

## 12. Ordinary owner whose detail is not rendered / Detail 未渲染的 ordinary owner

For a non-Code-Mode canonical event whose accepted detail does not affect current mounted Timeline markup, Wave 1D-A may perform no Timeline DOM mutation. The primary example is an event that became collapsed before its pending detail settled. / 对 accepted detail 不影响当前 mounted Timeline markup 的 non-Code-Mode canonical event，Wave 1D-A 可不执行 Timeline DOM mutation。主要例子是 pending detail settle 前已变为 collapsed 的 event。

No-DOM adoption requires proof that: / No-DOM adoption 要求证明：

```text
current displayState(event) != expanded
article has no mounted .eventBody detail presentation
event is not Code Mode
accepted detail cannot affect compact web lifecycle
header/chips/preview/footer/classes/context/affordance are detail-independent
exact context/token transaction is otherwise eligible
selected Inspector is absent/unaffected, or exact scoped work is preflighted
```

Then: / 然后：

```text
Timeline DOM mutations = 0
Timeline search mutations = 0
lifecycle mounted token is adopted safely
affected Inspector completes through its scoped contract before noDomAdoption is classified
```

If independence or affected-Inspector scoped work cannot be proven or completed, the complete request-owned transaction selects one `fullRenderFallback`; it is not a `noDomAdoption`. Do not infer independence merely because `.eventBody` is absent. / 如果无法证明或完成 independence／affected-Inspector scoped work，则完整 request-owned transaction 选择一次 `fullRenderFallback`；它不是 `noDomAdoption`。不得仅因 `.eventBody` 缺失而推断 independence。

---

## 13. Code Mode and multi-owner presentation remain fail-closed / Code Mode 与 multi-owner presentation 继续 fail-closed

For `event.kind === 'code_mode_operation'`, accepted detail may alter: / 对 `event.kind === 'code_mode_operation'`，accepted detail 可能改变：

```text
own label
chips
collapsed preview
expanded presentation
detail body
Inspector
referenced canonical web_search card presentation
```

Wave 1D-A must not implement before/after compact-ID sets, reference counting, dependency tracking, or multi-owner patching. Every accepted Code Mode success/error mutation uses the existing full-render fallback. / Wave 1D-A 不得实现 before／after compact-ID set、reference count、dependency tracking 或 multi-owner patch。每个 accepted Code Mode success／error mutation 均使用现有 full-render fallback。

Likewise, no referenced `web_search` card is patched locally. Code Mode affected-owner work is a possible later decision only after the Wave 1D-A stopping checkpoint. / 同样，不对任何 referenced `web_search` card 做 local patch。Code Mode affected-owner work 仅可在 Wave 1D-A stopping checkpoint 后另行决策。

Focused controls must prove Code Mode still advances the detail token once, performs exactly one request-owned Timeline settlement, and chooses one honest full-render fallback rather than duplicate renders. / Focused control 必须证明 Code Mode 仍推进一次 detail token、执行精确一次 request-owned Timeline settlement，并选择一次诚实 full-render fallback，而非 duplicate render。

---

## 14. Lifecycle mounted-token adoption / Lifecycle mounted token adoption

Add the smallest lifecycle API, conceptually: / 增加最小 lifecycle API，概念上为：

```text
adoptMountedPresentationToken({
  canonicalContext,
  expectedPreviousToken,
  nextToken,
})
```

Required behavior: / 必需 behavior：

1. validate and capture both fixed-width tokens;
2. require valid tokens and exact mounted canonical context;
3. require lifecycle-wide mounted token equals `expectedPreviousToken`;
4. preflight every retained owner's canonical-context/token metadata before mutating any owner;
5. update lifecycle-wide mounted token to `nextToken`;
6. update every retained owner's mounted token metadata to `nextToken`;
7. return a content-free adoption result including owner count;
8. throw before partial adoption when preflight fails.

1. 验证并 capture 两个 fixed-width token；
2. 要求 token valid 且 mounted canonical context 精确匹配；
3. 要求 lifecycle-wide mounted token 等于 `expectedPreviousToken`；
4. 修改任何 owner 前，preflight 每个 retained owner 的 canonical-context／token metadata；
5. 将 lifecycle-wide mounted token 更新为 `nextToken`；
6. 将每个 retained owner 的 mounted token metadata 更新为 `nextToken`；
7. 返回包含 owner count 的 content-free adoption result；
8. preflight 失败时在 partial adoption 前 throw。

O(number of mounted owners) in-memory metadata validation/update is accepted in Wave 1D-A. Adoption must not: / Wave 1D-A 接受 O(mounted owner 数量) 的 in-memory metadata validation／update。Adoption 不得：

```text
read or traverse DOM
query DOM
regenerate markup
touch search marks or bindings
scan canonical event arrays for presentation work
serialize/hash presentation state
introduce per-owner dependency revisions
```

This preserves Wave 1C's fail-closed global compatibility token. If metadata adoption itself later proves material, record it at the checkpoint; do not redesign lifecycle ownership in Wave 1D-A. / 这保留 Wave 1C fail-closed global compatibility token。如果 metadata adoption 后续证明有显著成本，在 checkpoint 记录；不得在 Wave 1D-A 中 redesign lifecycle ownership。

---

## 15. Owner-scoped Timeline search/highlight contract / Owner-scoped Timeline search／highlight contract

An eligible body patch must not call complete `refreshSearchHighlights()`. / Eligible body patch 不得调用完整 `refreshSearchHighlights()`。

Conceptually: / 概念上：

```text
capture unchanged search key/query and activeTargetId
capture old mark nodes inside affected article
preserve state.searchTargetRegistry.targets objects and order
preserve all unrelated bindings

remove old affected-article marks from state.searchHighlight.marks
clear only affected article marks
prune only affected target's Timeline-surface bindings

replace .eventBody
apply existing highlight terms to the complete affected article
bind new marks to the existing canonical target, when present
append new affected marks to preserved unrelated marks
restore activeSearchMark when active target is the owner
```

`src/browser/search-targets.js` may add a narrowly scoped surface-binding reset/prune primitive. `src/browser/highlight.js` already supplies root-scoped `clear()` and `apply()` and is expected to remain unchanged. If source proves a missing highlighter primitive, stop for scope review before changing it. / `src/browser/search-targets.js` 可增加窄的 surface-binding reset／prune primitive。`src/browser/highlight.js` 已提供 root-scoped `clear()` 与 `apply()`，预期保持不变。如果源码证明缺少 highlighter primitive，修改前停止并进行 scope review。

Hard invariants: / 硬 invariant：

```text
unrelated target object identity preserved
target ordering preserved
activeTargetId preserved when target remains valid
unrelated mark node identity preserved
unrelated Timeline and Inspector bindings preserved
affected-owner marks may be recreated
```

Visual phrase occurrences remain distinct from canonical navigation targets. Detail-derived text may create visual marks, including unbound marks, but it must not add a canonical target unless `event.hasSearchHit` already supplies one. Missing expected canonical target/binding state makes the complete request-owned transaction select `fullRenderFallback`; no local outcome is recorded and no descriptor is invented. / Visual phrase occurrence 继续区别于 canonical navigation target。Detail-derived text 可创建 visual mark，包括 unbound mark，但除非 `event.hasSearchHit` 已提供 target，否则不得新增 canonical target。缺失预期 canonical target／binding state 时，完整 request-owned transaction 选择 `fullRenderFallback`；不记录 local outcome，也不发明 descriptor。

---

## 16. Selected Inspector settlement and closed outcome / Selected Inspector settlement 与封闭 outcome

An accepted ordinary detail mutation may also affect the currently selected Inspector. Inspector dependency is part of the one request-owned presentation transaction, not an independent after-effect. The transaction may be classified as `bodyPatch` or `noDomAdoption` only after every required scoped Inspector operation succeeds. / Accepted ordinary detail mutation 也可能影响 currently selected Inspector。Inspector dependency 是单一 request-owned presentation transaction 的一部分，而非独立 after-effect。只有每个必需 scoped Inspector operation 成功后，transaction 才可分类为 `bodyPatch` 或 `noDomAdoption`。

Wave 1D-A may add a scoped Inspector search-refresh mode to `renderDetailShell()` or an equivalent narrow seam. A local outcome is eligible only when: / Wave 1D-A 可为 `renderDetailShell()` 增加 scoped Inspector search-refresh mode，或等价窄 seam。Local outcome 仅在以下条件满足时 eligible：

```text
search key/query unchanged
Timeline search surface context already current
Inspector type/event/selection context exact
detail generation exact
Inspector root after reconstruction belongs to selected owner
canonical target registry remains current
```

The scoped operation removes/prunes only old Inspector marks/bindings for that owner, reconstructs current Inspector content, applies highlighting only inside the new Inspector owner root, and restores the existing active target state without clearing Timeline marks. / Scoped operation 仅删除／prune 该 owner 的旧 Inspector mark／binding，重建 current Inspector content，仅在新 Inspector owner root 内 apply highlight，并在不 clear Timeline mark 的前提下恢复现有 active target state。

The two classifications are closed: / 两类 classification 是封闭的：

```text
Local outcome:
  bodyPatch | noDomAdoption
  → affected Inspector scoped work completed
  → unrelated Timeline marks/bindings retain exact identity
  → no complete Timeline highlight refresh

Unsafe/failed Inspector outcome:
  complete detail transaction → fullRenderFallback
  → one coherent Timeline/Inspector global-safe presentation
  → no bodyPatch/noDomAdoption classification
```

The implementation must not allow: / 实现不得允许：

```text
successful local Timeline body patch
→ shared promise resolves without final outcome
→ later Inspector caller performs complete Timeline refresh
→ transaction still reported as bodyPatch
```

The shared request result exposes the already selected request-owned outcome (`bodyPatch`, `noDomAdoption`, `fullRenderFallback`, `stale`, or `abort`) or an equivalent closed representation. Inspector callers remain non-owners: they may render only work explicitly delegated by the request-owned transaction and must not schedule a second global Timeline presentation. If scoped Inspector work is uncertain or fails, the request-owned transaction itself performs the single global-safe fallback. / Shared request result 暴露已选择的 request-owned outcome（`bodyPatch`、`noDomAdoption`、`fullRenderFallback`、`stale` 或 `abort`），或等价封闭 representation。Inspector caller 继续为 non-owner：仅可执行 request-owned transaction 显式委派的工作，不得安排第二次 global Timeline presentation。如果 scoped Inspector work 不确定或失败，由 request-owned transaction 自身执行唯一 global-safe fallback。

Do not redesign Inspector history, navigation, Raw view, selection ownership, or mobile view. / 不得 redesign Inspector history、navigation、Raw view、selection ownership 或 mobile view。

---

## 17. Candidate-first visible-detail scan / Candidate-first visible-detail scan

Retain every current trigger and detail-loading semantic. Change only candidate selection and geometry ownership. / 保留每个当前 trigger 与 detail-loading semantic，仅修改 candidate selection 与 geometry ownership。

Current triggers to inventory and preserve: / 需要 inventory 并保留的当前 trigger：

```text
Events mobile-view activation
successful Main suffix append
full render
Timeline scroll
window resize
```

Required algorithm: / 必需 algorithm：

```text
if search/Timeline context not ready: stop

identify candidates before geometry:
  expanded visible-capable event articles
  plus visible-capable Main code_mode_operation articles
  exclude hidden-by-profile cards when they cannot request visible detail

deduplicate candidate articles
resolve timelinePane/scrollport once
read scrollport bounds once, or another fixed small constant

for each candidate:
  validate current canonical event
  read article geometry once
  preserve current viewport-intersection semantics
  ensureEventDetail(event) when intersecting
```

Collapsed visible Main Code Mode operation cards must remain candidates. The scan optimization must not change detail request count, request deduplication, viewport intersection, hidden-card semantics, abort behavior, or scheduling through the existing animation-frame coalescer. / Collapsed visible Main Code Mode operation card 必须继续作为 candidate。Scan 优化不得改变 detail request count、request deduplication、viewport intersection、hidden-card semantics、abort behavior 或现有 animation-frame coalescer 的 scheduling。

Do not add `IntersectionObserver`, virtualization, render windows, or new persistent card observation state unless the simple candidate-first algorithm is proven incorrect. Such proof is a mandatory scope stop, not permission to broaden M1. / 不得增加 `IntersectionObserver`、virtualization、render window 或新的 persistent card observation state，除非 simple candidate-first algorithm 被证明不正确。此类证明触发强制 scope stop，而非授权扩大 M1。

---

## 18. Two-layer evidence contract / 双层 evidence contract

Wave 1D-A evidence has two explicit, non-interchangeable layers. Focused Chromium owns new causal fields. Unchanged schema-4 profiling owns only existing generic fields. No summary may imply that schema-4 raw artifacts contain the focused settlement/body/scan ledger. / Wave 1D-A evidence 有两个显式、不可互换的 layer。Focused Chromium 负责新的 causal field；不变 schema-4 profiling 仅负责现有 generic field。任何 summary 均不得暗示 schema-4 raw artifact 包含 focused settlement／body／scan ledger。

### 18.1 Focused Chromium causal evidence / Focused Chromium causal evidence

The exact candidate's focused Chromium tests may extend the existing optional, failure-isolated browser lifecycle observer with content-free records. At minimum: / 精确 candidate 的 focused Chromium test 可扩展现有 optional、failure-isolated browser lifecycle observer，并记录 content-free row。至少包括：

```text
Detail request lifecycle:
  requestSerial
  requestCreated
  requestReused
  acceptedMutation: success | error | none
  presentationSettlement
  settlementOutcome: bodyPatch | noDomAdoption | fullRenderFallback | stale | abort
  presentationErrorStage: none | local | fallback
  acceptedStateReclassified: false

Body patch:
  ordinary/codeMode classification
  expanded/body-present classification
  articleIdentityPreserved boolean
  contextSlotIdentityPreserved boolean

Direct Timeline-root MutationRecord ledger (separate):
  operation-local direct-root mutation rows
  append/replacement/clear/initial-mount classification
  removed/added/final canonical-card counts

Visible scan:
  scanSerial
  mountedArticleCount
  candidateArticleCount
  articleGeometryReadCount
  scrollportGeometryReadCount
  ensuredDetailCount
```

No record may retain transcript content, event IDs, detail bodies, search text, DOM serialization, file paths, repository paths, Session IDs, request URLs containing IDs, or source payloads. Serial numbers and closed classifications are sufficient. Observer access/getters/methods must remain failure-isolated and non-authoritative. / 任何 record 均不得保留 transcript content、event ID、detail body、search text、DOM serialization、file path、repository path、Session ID、包含 ID 的 request URL 或 source payload。Serial number 与封闭 classification 足够。Observer access／getter／method 必须继续 failure-isolated 且不具 authority。

The existing focused per-MutationRecord Timeline-root ledger remains authoritative for root append/replacement classification. Owner body mutation observation is separate and must not be mislabeled as a Timeline-root replacement. / 现有 focused per-MutationRecord Timeline-root ledger 继续权威负责 root append／replacement classification。Owner body mutation observation为独立记录，不得误标为 Timeline-root replacement。

This focused layer is authoritative for: / 该 focused layer 权威证明：

```text
one accepted mutation → one request-owned settlement
local Inspector work completes before a local outcome is classified
eligible ordinary detail → zero whole-Timeline replacement
body/article/context/mark identity facts
candidate-first geometry-read behavior
request failure never absorbs presentation failure
```

### 18.2 Unchanged schema-4 formal evidence / 不变 schema-4 formal evidence

Generic `scripts/timeline-profile.js` remains schema 4. Wave 0 runner and Wave 1B validator remain unchanged. Each smoke/formal run records only fields already available in schema 4, including where present: / Generic `scripts/timeline-profile.js` 保持 schema 4。Wave 0 runner 与 Wave 1B validator 保持不变。每个 smoke／formal run 仅记录 schema 4 已存在的 field，包括（在已有时）：

```text
cardGenerations
existing Timeline-root mutation observations
highlight passes / marks / highlighted-owner count
timeline/detail request counts and existing request constraints
Long Task count/max/total
duration
Resource Timing
final functional state
existing generic acceptance fields
```

Schema-4 artifacts do not emit or prove request serials, request reuse, accepted mutation count, presentation settlement count/outcome/error stage, accepted-state reclassification guards, body-patch identity, no-DOM adoption, or visible-scan candidate/geometry counts. Those facts must come from the exact candidate's focused Chromium evidence. / Schema-4 artifact 不 emit 或证明 request serial、request reuse、accepted mutation count、presentation settlement count／outcome／error stage、accepted-state reclassification guard、body-patch identity、no-DOM adoption 或 visible-scan candidate／geometry count。这些事实必须来自精确 candidate 的 focused Chromium evidence。

Do not create a wave-specific generic validator unless a concrete closed requirement cannot be reviewed from the two layers above. That condition requires scope review; it does not authorize schema evolution. / 除非具体封闭 requirement 无法通过上述双层 evidence 评审，否则不得创建 wave-specific generic validator。该条件触发 scope review，而不授权 schema evolution。

---

## 19. Hard structural acceptance / 硬结构验收

### 19.1 Eligible expanded ordinary settlement / Eligible expanded ordinary settlement

```text
article identity:                         preserved exactly
context-slot identity:                    preserved exactly
header/toggle/external-preview identity:  preserved exactly
footer/control identity:                  preserved exactly
unrelated article identity:               preserved exactly
unrelated search-mark identity:           preserved exactly
currentEvents/currentEventsById:           unchanged
Timeline-root replacement:                zero
accepted state mutations:                 one
detail revision advances:                 one
Timeline presentation settlements:        one
eventBody presentation:                   exact current success/error body
mounted presentation token:               afterToken
affected Inspector:                       scoped completion before bodyPatch classification
complete Timeline highlight refresh:      zero
```

### 19.2 Eligible ordinary settlement with no rendered body / 无 rendered body 的 eligible ordinary settlement

```text
Timeline DOM mutation:                    zero
Timeline highlight mutation:              zero
accepted state mutations:                 one
Timeline presentation settlements:        one
mounted presentation token:               afterToken
affected Inspector:                       scoped completion before noDomAdoption classification
complete Timeline highlight refresh:      zero
```

### 19.3 Repeated callers / 重复 caller

```text
N repeated ensureEventDetail calls
→ one network request
→ one accepted mutation
→ one detail revision advance
→ one Timeline presentation settlement
```

### 19.4 Code Mode/incompatible controls / Code Mode／不兼容 control

```text
local body patch:                         zero
request-owned presentation settlements:   one per accepted mutation
full-render fallback:                     preserved and honestly observed
duplicate full render from callers:       zero
```

### 19.5 Visible scan / Visible scan

```text
scrollport bounds reads:                  one or fixed small constant per scan
article geometry reads:                   bounded by candidate count
mounted non-candidate geometry reads:      zero
detail request semantics:                 unchanged
collapsed visible Main Code Mode request: preserved
```

### 19.6 Request/presentation failure separation / Request／presentation failure separation

```text
accepted success + local presentation failure:
  accepted detailCache remains authoritative
  detailErrors unchanged
  one detail revision advance
  one request-owned settlement
  final selected outcome fullRenderFallback

accepted success + fallback-render failure:
  no success-to-error reclassification
  no second detail revision advance
  no second settlement
  presentation failure surfaced separately

accepted request error + presentation/fallback failure:
  original detailErrors entry remains authoritative
  one detail revision advance
  one settlement
  no second error mutation
```

### 19.7 Affected Inspector outcome closure / Affected Inspector outcome closure

```text
bodyPatch or noDomAdoption:
  affected Inspector scoped update completed
  unrelated Timeline marks/bindings preserved exactly
  complete Timeline refresh zero

fullRenderFallback:
  selected before final local classification, or after local attempt failure
  one coherent global-safe presentation attempt
  bodyPatch/noDomAdoption not recorded
  Inspector continuation schedules no second Timeline presentation
```

Sections 19.1–19.7 are proved by focused Chromium causal evidence. Schema-4 formal evidence supplies only its existing generic checkpoint fields and does not claim these new settlement/identity records. / 第 19.1–19.7 节由 focused Chromium causal evidence 证明。Schema-4 formal evidence 仅提供其现有 generic checkpoint field，不声称包含这些新的 settlement／identity record。

No milliseconds or percentage gate may be added later without a new design review. / 未经新 design review，不得在后续增加 milliseconds 或 percentage gate。

---

## 20. Focused test matrix / 聚焦测试矩阵

### 20.1 Lifecycle Node tests / Lifecycle Node test

At minimum: / 至少：

1. exact context plus expected previous token adopts the next token;
2. every retained owner token metadata becomes the exact next token;
3. invalid previous/next token rejects;
4. wrong context rejects;
5. stale lifecycle-wide token rejects;
6. inconsistent owner context/token metadata rejects before partial mutation;
7. failed adoption leaves lifecycle-wide and owner tokens unchanged;
8. owner count zero is well-defined;
9. adoption performs no DOM access and does not require event arrays;
10. later Main suffix registration accepts the adopted token;
11. overflowed token remains fail-closed.

1. 精确 context 与 expected previous token 可 adopt next token；
2. 每个 retained owner token metadata 均成为精确 next token；
3. invalid previous／next token reject；
4. wrong context reject；
5. stale lifecycle-wide token reject；
6. 不一致 owner context／token metadata 在 partial mutation 前 reject；
7. failed adoption 不改变 lifecycle-wide／owner token；
8. owner count 为零时行为有定义；
9. adoption 不访问 DOM，也不要求 event array；
10. 后续 Main suffix registration 接受 adopted token；
11. overflowed token 继续 fail-closed。

### 20.2 Search-target Node tests / Search-target Node test

At minimum: / 至少：

1. reset/prune one target's Timeline bindings only;
2. Inspector bindings for the same target survive Timeline prune;
3. unrelated target binding arrays and objects retain identity;
4. rebinding preserves target object/order;
5. unknown target/surface fails safely;
6. global reset behavior remains unchanged.

### 20.3 Focused Chromium tests / 聚焦 Chromium test

At minimum: / 至少：

1. ordinary expanded loading → success patches only `.eventBody`;
2. ordinary expanded loading → error patches only `.eventBody`;
3. article, context slot, header, toggle, preview, footer, selection, and unrelated cards retain identity;
4. ordinary collapsed-before-settlement performs no Timeline DOM mutation and adopts token;
5. stale Session/Layer/generation/controller response performs no accepted mutation/presentation;
6. missing, duplicate, disconnected, or unexpected `.eventBody` selects full fallback;
7. wrong owner/article/context-slot identity selects full fallback;
8. another presentation revision between before/after selects full fallback;
9. repeated `ensureEventDetail()` calls share one request and one Timeline settlement;
10. eight independently accepted ordinary details yield eight settlements, not caller-amplified settlements;
11. accepted success plus forced local-presentation failure keeps accepted cache success, leaves `detailErrors` unchanged, and records one revision/settlement with `fullRenderFallback` outcome;
12. accepted success plus forced fallback-render failure cannot flow into request-error classification, cannot create a second revision/settlement, and surfaces presentation failure separately;
13. accepted request error plus forced local/fallback presentation failure retains the original detail error with one revision/settlement and no second error mutation;
14. Code Mode success/error uses one full fallback and no local body patch;
15. Timeline and Inspector retry revision behavior remains fail-closed;
16. ordinary body phrase addition/removal recreates only affected-owner marks;
17. unrelated marks, target objects, target order, and bindings retain identity;
18. active target in patched owner regains active mark without programmatic scroll;
19. detail text without canonical `hasSearchHit` does not create a target;
20. affected selected Inspector completes scoped reconstruction/highlighting before `bodyPatch` or `noDomAdoption` is classified;
21. unsafe or failed affected-Inspector scoped work selects one transaction-wide `fullRenderFallback`, not a local outcome followed by global refresh;
22. Inspector continuation observes the shared request-owned outcome and cannot schedule a second Timeline presentation;
23. next eligible Main suffix append succeeds after local token adoption;
24. scan after append/render/scroll/resize/view activation preserves scheduling semantics;
25. geometry reads equal candidate count plus fixed-small scrollport reads;
26. hidden-by-profile non-candidates incur no geometry read;
27. visible collapsed Main Code Mode still starts existing detail hydration;
28. Query, profile, locale, Layer, Session, Protocol, Raw, temporary reveal, and replacement controls remain full-render behavior;
29. observer failure cannot change production behavior.

---

## 21. Two-layer late-hit checkpoint / 双层 late-hit checkpoint

After a reviewed immutable candidate exists, evaluate the accepted Wave 1C fixture through both evidence layers. They bind to the same exact candidate but answer different questions. / Reviewed immutable candidate 形成后，通过两个 evidence layer 评估 accepted Wave 1C fixture。二者绑定同一精确 candidate，但回答不同问题。

### 21.1 Focused Chromium causal checkpoint / Focused Chromium causal checkpoint

Focused candidate tests/observer record the Wave 1D-A-specific facts: / Focused candidate test／observer 记录 Wave 1D-A-specific fact：

```text
detail request created/reused
accepted success/error mutation
one request-owned presentation settlement
selected outcome:
  bodyPatch
  noDomAdoption
  fullRenderFallback
  stale
  abort
body/article/context/mark identity facts
affected-Inspector scoped/fallback classification
request-error versus presentation-error separation
mounted/candidate article counts
article and scrollport geometry reads
```

This layer is the hard causal proof that eligible ordinary detail settlements do not generate whole-prefix Timeline cards and that candidate-first geometry remains candidate-count bounded. / 该 layer 是硬 causal proof：eligible ordinary detail settlement 不生成 whole-prefix Timeline card，且 candidate-first geometry 受 candidate count 限制。

### 21.2 Unchanged schema-4 smoke/formal checkpoint / 不变 schema-4 smoke／formal checkpoint

Use unchanged schema-4 `scripts/timeline-profile.js`. Each raw run and summary may record only existing generic fields: / 使用不变 schema-4 `scripts/timeline-profile.js`。每个 raw run 与 summary 仅可记录现有 generic field：

```text
cardGenerations
existing Timeline-root mutation observations
highlight passes / marks / highlighted-owner count where available
timeline/detail request counts and request constraints
Long Task count/max/total
duration
Resource Timing
final functional state
existing generic acceptance fields
```

Do not claim that schema-4 runs contain accepted-mutation, presentation-settlement/outcome/error-stage, state-reclassification, body-patch, no-DOM-adoption, Inspector-classification, or scan-geometry records. Reviewers correlate the generic residual shape with the separate focused causal proof; they do not synthesize missing schema fields. / 不得声称 schema-4 run 包含 accepted-mutation、presentation-settlement／outcome／error-stage、state-reclassification、body-patch、no-DOM-adoption、Inspector-classification 或 scan-geometry record。Reviewer 将 generic residual shape 与独立 focused causal proof 对照，不得合成不存在的 schema field。

Do not freeze `cardGenerations == 1,200` in advance. The plan may later freeze that exact schema-4 fact only if focused candidate evidence proves that the accepted late-hit fixture has no other legitimate whole-prefix generation path. Until then, hard acceptance remains: / 不得预先冻结 `cardGenerations == 1,200`。仅当 focused candidate evidence 证明 accepted late-hit fixture 不存在其它合法 whole-prefix generation path 时，本计划后续才可冻结该精确 schema-4 fact。在此之前，hard acceptance 继续为：

```text
focused causal evidence proves eligible ordinary detail settlements
do not generate whole-prefix Timeline cards
```

Duration and Long Tasks remain descriptive. A timing regression may trigger diagnosis but cannot by itself fail structural acceptance. / Duration 与 Long Task 继续仅作描述。Timing regression 可触发 diagnosis，但不能单独导致 structural acceptance fail。

---

## 22. Expected changed-path envelope / 预期 changed-path envelope

### 22.1 M0–candidate executable path envelope / M0 到 candidate 的 executable path envelope

Expected candidate-time paths: / 预期 candidate-time path：

```text
AGENTS.md
docs/exec-plans/active/2026-08-30-performance-wave-1d-a-ordinary-detail-body-patch.md
src/browser/app.js
src/browser/timeline-card-lifecycle.js
src/browser/search-targets.js
test/timeline-card-lifecycle.test.js
test/search-targets.test.js
e2e/browser.test.js
public/assets/app.js
```

`public/assets/app.js` appears only at the future build/candidate gate. / `public/assets/app.js` 仅在未来 build／candidate gate 出现。

Expected unchanged through executable candidate: / executable candidate 期间预期不变：

```text
src/browser/highlight.js
src/browser/timeline-event-state.js
src/browser/timeline-search-batch.js
src/browser/transition-safety.js

test/highlight.test.js
scripts/timeline-profile.js
test/timeline-profile.test.js
scripts/performance-wave-0-runner.js
scripts/performance-wave-1b-validator.js

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

Any required change to an expected-unchanged architectural, executable, generated-tooling, package, workflow, or product-spec path is a mandatory scope-review stop before editing. In particular, `src/browser/highlight.js` changes require proof that its existing root-scoped `clear()`/`apply()` contract is insufficient. / 若必须修改 expected-unchanged architectural、executable、generated-tooling、package、workflow 或 product-spec path，编辑前强制 scope-review stop。尤其是修改 `src/browser/highlight.js` 前，必须证明其现有 root-scoped `clear()`／`apply()` contract 不足。

### 22.2 Documentation-only closeout envelope / Documentation-only closeout envelope

Only after final candidate/evidence acceptance may a separately authorized closeout: / 仅在 final candidate／evidence 接受后，另行授权的 closeout 才可：

```text
update AGENTS.md registration
update docs/design-docs/timeline-loading-and-rendering-performance.md bilingually
move this plan from active/ to completed/
record accepted structural evidence and descriptive timing
record the server checkpoint decision
```

No executable/generated change or evidence recapture belongs to closeout. / Closeout 不包含 executable／generated change 或 evidence recapture。

---

## 23. Milestones and review gates / Milestone 与评审 gate

### M0 — Revalidation and contract freeze / 重新核验与 contract freeze

M0 was separately authorized and completed on 2026-08-30; Section 30 records the actual findings. Its frozen requirements were: / M0 已获另行授权，并于 2026-08-30 完成；第 30 节记录实际 findings。其冻结 requirement 为：

```text
resolve live towards-0.2.0
require b7ca3bff12fd5061410aaa3483341023498b23d4 ancestry
inspect relevant descendant drift
inspect worktree and toolchain

create perf/wave-1d-a-ordinary-detail-body-patch
register this exact active plan in AGENTS.md

inventory every:
  detail request creation path
  ensureEventDetail caller
  detail cache/error/generation mutation
  detailPresentationRevision write
  Inspector settlement callback
  renderTimeline call reachable from accepted detail settlement
  visible-detail scan trigger

freeze:
  ordinary-detail eligibility matrix
  Code Mode fallback
  retry/reset fallback classification
  request-error/presentation-error boundary
  before/after token transaction
  one-request/one-settlement ownership
  shared closed settlement-outcome contract
  body-only DOM identity contract
  owner-local search contract
  Inspector scoped-refresh contract
  focused causal ledger schema
```

M0 made no product, test, generated-asset, or profiling change beyond the authorized branch/plan registration and execution-record documentation. Gate result: `PASS_M0`. / 除已授权 branch／plan registration 与 execution-record documentation 外，M0 未修改 product、test、generated asset，也未 profiling。Gate 结果：`PASS_M0`。

### M1 — Smallest implementation / 最小实现

M1 was separately authorized on 2026-08-30 and completed on 2026-08-31; Section 31 records the actual implementation and focused executor results. Its bounded implementation list was: / M1 于 2026-08-30 获另行授权，并于 2026-08-31 完成；第 31 节记录实际 implementation 与 focused executor 结果。其 bounded implementation list 为：

```text
one-request/one-detail-presentation settlement ownership
request-error/presentation-error semantic separation
shared closed settlement-outcome result
ordinary non-Code-Mode detail-body patch
eligible no-DOM ordinary-detail token adoption
lifecycle mounted-token adoption
owner-scoped Timeline rehighlight/rebinding
scoped selected-Inspector refresh where safe
candidate-first visible-detail scan
focused content-free causal observation
```

Every formal fallback was retained. Focused Node and Chromium tests passed. Gate result: `PASS_M1_EXECUTOR`; stop for fresh independent R1 before generated-asset update, formal profiling, candidate freeze, or broader implementation. / 已保留每个正式 fallback。Focused Node 与 Chromium test 均通过。Gate 结果：`PASS_M1_EXECUTOR`；在 generated asset 更新、formal profiling、candidate freeze 或扩大实现前，停止并等待 fresh independent R1。

### R1 — Fresh implementation review / Fresh implementation review

An independent reviewer must prove: / 独立 reviewer 必须证明：

```text
detail state/request ownership remains exact
stale response cannot mutate/present current DOM
duplicate callers cannot duplicate Timeline presentation
presentation failure cannot enter request/detail-error classification
accepted success/error state remains final through fallback failure
ordinary accepted detail dependency is body-local
article/context/header/preview/footer identity survives
Code Mode remains fail-closed
retry/reset mutations cannot masquerade as eligible settlement
before/after token comparison is fixed-width
mounted-token adoption is internally consistent and DOM-free
unrelated targets/marks/bindings remain identical
local outcome requires completed scoped Inspector work
unsafe Inspector work selects transaction-wide full fallback
Inspector continuation cannot schedule second Timeline presentation
visible scan preserves request semantics
no Wave 1D-B/server/virtualization scope entered
changed-path envelope and focused tests pass
```

Proceed only after `PASS_R1`. Any executable repair after review requires a fresh R1 over the repaired diff. / 仅在 `PASS_R1` 后继续。Review 后任何 executable repair 都要求对 repaired diff 重新进行 fresh R1。

### M2 — Full validation, bundle, and immutable candidate / 完整验证、bundle 与 immutable candidate

After accepted R1: / R1 接受后：

```text
npm run build:client
node --check src/browser/app.js
node --check src/browser/timeline-card-lifecycle.js
node --check src/browser/search-targets.js
focused Node tests
focused Wave 1D-A Chromium tests
npm test
npm run test:browser
npm run release:check
git diff --check
exact changed-path audit
generated-bundle currentness/diff audit
```

Inspect and own every generated diff. Freeze one immutable candidate commit and require a clean worktree. No push/PR/merge is implied. / 检查并负责每项 generated diff。冻结一个 immutable candidate commit，并要求 clean worktree。不隐含 push／PR／merge 授权。

### M3 — Two-layer lean checkpoint evidence / 双层精简 checkpoint evidence

#### M3a — Focused Chromium causal evidence / Focused Chromium causal evidence

Run the exact candidate's focused Chromium cases first and export/review only the content-free causal facts defined in Sections 18.1 and 21.1. This layer must prove request/presentation error separation, one mutation→one settlement, closed Inspector outcome ownership, body/no-DOM identity, zero whole-Timeline replacement for eligible ordinary detail, and candidate-bounded geometry. / 先运行精确 candidate 的 focused Chromium case，并仅 export／review 第 18.1 与 21.1 节定义的 content-free causal fact。该 layer 必须证明 request／presentation error separation、one mutation→one settlement、封闭 Inspector outcome ownership、body／no-DOM identity、eligible ordinary detail 的 zero whole-Timeline replacement 与 candidate-bounded geometry。

#### M3b — Unchanged schema-4 smoke/formal evidence / 不变 schema-4 smoke／formal evidence

Only after M3a passes, use unchanged schema-4 `timeline-profile.js`. First run one fresh smoke. Only after smoke generic functional/identity acceptance may the plan run a small repeated formal group; default is exactly three fresh independent processes to match the accepted Wave 1C evidence shape. No calibration. Schema-4 artifacts contain only the existing fields in Sections 18.2 and 21.2. / 仅在 M3a pass 后，使用不变 schema-4 `timeline-profile.js`。先运行一次 fresh smoke。仅在 smoke generic functional／identity acceptance 后，才运行小规模 repeated formal group；默认精确三个 fresh independent process，以匹配 accepted Wave 1C evidence shape。不做 calibration。Schema-4 artifact 仅包含第 18.2 与 21.2 节的现有 field。

Both layers must be immutable and candidate-bound, but their artifacts and claims remain distinct. Schema-4 raw runs remain primary for generic profiler facts; focused Chromium records remain primary for Wave 1D-A causal facts. Summary/manifest text must not copy focused-only fields into schema-4 run records. Timing is descriptive. A failed M3a or smoke returns to repair plus fresh R1/M2 candidate freeze and does not authorize later evidence steps. / 两个 layer 都必须 immutable 且绑定 candidate，但其 artifact 与 claim 保持分离。Schema-4 raw run 是 generic profiler fact 的 primary；focused Chromium record 是 Wave 1D-A causal fact 的 primary。Summary／manifest text 不得把 focused-only field 复制进 schema-4 run record。Timing 仅作描述。M3a 或 smoke fail 均返回 repair 加 fresh R1／M2 candidate freeze，并不授权后续 evidence step。

### R2 — Fresh final candidate/evidence review / Fresh final candidate／evidence review

An independent reviewer verifies target-to-candidate diff, request/presentation error separation, detail ownership, ordinary body-local proof, token transaction/adoption, closed Inspector outcome ownership, search scoping, scan counts, unchanged generic tooling, full gates, generated bundle, evidence identities/hashes, hard structural facts, descriptive timing, and the absence of unauthorized scope. The reviewer must inspect focused causal evidence and schema-4 raw evidence as separate layers and reject any claim that schema 4 contains Wave 1D-A settlement/body/scan fields. / 独立 reviewer 验证 target-to-candidate diff、request／presentation error separation、detail ownership、ordinary body-local proof、token transaction／adoption、封闭 Inspector outcome ownership、search scoping、scan count、不变 generic tooling、full gate、generated bundle、evidence identity／hash、hard structural fact、描述性 timing 与无 unauthorized scope。Reviewer 必须把 focused causal evidence 与 schema-4 raw evidence 作为独立 layer 检查，并拒绝任何声称 schema 4 包含 Wave 1D-A settlement／body／scan field 的说法。

Acceptance language must be explicit, for example: / Acceptance language 必须显式，例如：

```text
ACCEPTED_FOR_CANDIDATE
INTEGRATION_READY
SERVER_CHECKPOINT_NEXT
```

### M4 — Documentation-only closeout / 仅文档收口

Only after accepted R2 and separate authorization: archive this plan, remove active registration, update the bilingual performance design, record evidence, and record the post-wave server checkpoint. Do not change executable/generated files or recapture evidence. / 仅在 R2 接受且另行授权后：archive 本计划、删除 active registration、更新双语 performance design、记录 evidence 与 post-wave server checkpoint。不得修改 executable／generated file 或 recapture evidence。

---

## 24. Independent review and CI responsibility / 独立评审与 CI 责任

Executor responsibilities: / Executor 责任：

- preserve milestone boundaries and stop conditions;
- run the required local focused/full gates;
- own every changed path and generated diff;
- freeze candidate identity before evidence;
- never reinterpret descriptive timing as acceptance.

- 保持 milestone boundary 与 stop condition；
- 运行必需 local focused／full gate；
- 负责每个 changed path 与 generated diff；
- evidence 前冻结 candidate identity；
- 绝不把描述性 timing 重新解释为 acceptance。

Independent reviewer responsibilities: / 独立 reviewer 责任：

- inspect source call chains, not only summaries;
- verify no duplicate Timeline settlement remains;
- verify presentation exceptions cannot enter request-error classification;
- prove body-only dependency and Code Mode fallback;
- prove affected Inspector is scoped before local outcome or selects full fallback;
- verify exact DOM/mark/token identities from focused evidence;
- inspect focused causal records and raw schema-4 artifacts as separate layers;
- verify evidence hashes and reject schema-4 claims for focused-only fields;
- reject scope leakage or self-authored acceptance.

- 检查 source call chain，而非仅 summary；
- 验证不存在 duplicate Timeline settlement；
- 验证 presentation exception 不会进入 request-error classification；
- 证明 body-only dependency 与 Code Mode fallback；
- 证明 affected Inspector 在 local outcome 前完成 scoped work，否则选择 full fallback；
- 从 focused evidence 验证精确 DOM／mark／token identity；
- 将 focused causal record 与 raw schema-4 artifact 作为独立 layer 检查；
- 验证 evidence hash，并拒绝 schema 4 对 focused-only field 的 claim；
- 拒绝 scope leakage 或 self-authored acceptance。

GitHub CI is an integration gate after a separately authorized PR; it does not replace R1/R2 and is not authorized by this plan. / GitHub CI 是另行授权 PR 后的 integration gate；它不替代 R1／R2，且本计划不授权 CI／PR 操作。

---

## 25. Mandatory stop conditions / 强制停止条件

Stop and return to design review if any of the following appears: / 出现以下任一情况必须停止并返回 design review：

1. ordinary non-Code-Mode detail changes card presentation outside `.eventBody`;
2. eligible settlement requires replacing the article, header, preview, footer, context slot, or affordance;
3. body shape cannot be validated as one closed subtree;
4. duplicate Timeline presentation ownership cannot be removed from callers;
5. accepted mutation and presentation cannot remain one synchronous request-owned transaction;
6. token compatibility requires variable-sized state serialization/scanning;
7. lifecycle token adoption requires DOM or canonical-event scanning;
8. owner token metadata cannot be updated atomically and fail-closed;
9. Code Mode or `web_search` fanout must become local for ordinary correctness;
10. owner-scoped search requires global target recreation;
11. `src/browser/highlight.js` requires a new global model;
12. Inspector scoped refresh requires Inspector lifecycle redesign;
13. candidate-first scan changes detail request semantics;
14. simple scan correctness requires IntersectionObserver or persistent observation;
15. generic profiler schema must change;
16. Wave 0 runner or Wave 1B validator must change;
17. canonical ownership, Wave 1B batch policy, or Wave 1C append semantics must change;
18. Protocol/Raw must become incremental;
19. server/API/cache/index work becomes necessary;
20. package/lockfile/workflow/product-spec changes appear;
21. any expected-unchanged architectural/tooling path must change without prior scope review;
22. timing is proposed as a hard acceptance threshold;
23. M1 begins to include folds, navigation reveal, temporary ownership, virtualization, or Wave 1D-B work.
24. a presentation exception can reach the request/detail-error classifier;
25. accepted success/error state can be rewritten or its revision/settlement repeated after presentation failure;
26. a local Timeline outcome can be followed by an independent Inspector-owned global Timeline refresh;
27. schema-4 artifacts or summaries are required to contain focused-only settlement/body/scan fields.

1. ordinary non-Code-Mode detail 改变 `.eventBody` 外 card presentation；
2. eligible settlement 需要替换 article、header、preview、footer、context slot 或 affordance；
3. 无法把 body shape 验证为一个封闭 subtree；
4. 无法从 caller 移除 duplicate Timeline presentation ownership；
5. accepted mutation 与 presentation 无法保持单一同步 request-owned transaction；
6. token compatibility 需要 variable-sized state serialization／scan；
7. lifecycle token adoption 需要 DOM 或 canonical-event scan；
8. owner token metadata 无法 atomic／fail-closed 更新；
9. ordinary correctness 要求 Code Mode 或 `web_search` fanout local 化；
10. owner-scoped search 要求 global target recreation；
11. `src/browser/highlight.js` 要求新的 global model；
12. Inspector scoped refresh 要求 Inspector lifecycle redesign；
13. candidate-first scan 改变 detail request semantics；
14. simple scan correctness 要求 IntersectionObserver／persistent observation；
15. generic profiler schema 必须改变；
16. Wave 0 runner 或 Wave 1B validator 必须改变；
17. canonical ownership、Wave 1B batch policy 或 Wave 1C append semantics 必须改变；
18. Protocol／Raw 必须 incremental；
19. server／API／cache／index work 成为必要；
20. 出现 package／lockfile／workflow／product-spec change；
21. expected-unchanged architectural／tooling path 需修改但未先 scope review；
22. 提议把 timing 作为 hard acceptance threshold；
23. M1 开始包含 fold、navigation reveal、temporary ownership、virtualization 或 Wave 1D-B work。
24. presentation exception 可到达 request／detail-error classifier；
25. accepted success／error state 可在 presentation failure 后被重写，或重复其 revision／settlement；
26. local Timeline outcome 后可由独立 Inspector owner 执行 global Timeline refresh；
27. 要求 schema-4 artifact 或 summary 包含 focused-only settlement／body／scan field。

---

## 26. Failure diagnosis / 失败诊断

| Symptom / 现象 | Likely cause / 可能原因 | Required response / 必需响应 |
| --- | --- | --- |
| One network request produces multiple settlements | Caller-owned `.then` continuation remains | Centralize settlement at unique request owner |
| Accepted success becomes `detailErrors` after local/fallback exception | Presentation exception flowed into request-error handler | Separate request classification from presentation with one-way handlers |
| Presentation/fallback failure advances detail revision again | Accepted state was reclassified or presentation retried as mutation | Preserve accepted state; surface presentation error without a second mutation/settlement |
| Article identity changes | Implementation generated/replaced whole card | Stop; restore body-only primitive |
| Header/footer mark descendants change unexpectedly | Global or overly broad highlight refresh | Audit affected-owner root and explicit mark exception |
| Unrelated marks detach | Global clear/reset still runs | Restore scoped mark/binding pruning |
| Active target loses live mark | Affected owner was not rebound/restored | Restore target-local active presentation |
| Canonical target count grows from detail-only phrase | Scoped refresh invented descriptor | Retain visual mark without target |
| Later append falls back after local body patch | Lifecycle token not adopted consistently | Inspect expected/next token and all owner metadata |
| Partial token adoption | Owner metadata validation occurred during write | Preflight all owners before mutation |
| Collapsed ordinary settlement mutates DOM | Independence/no-DOM branch missing | Restore no-DOM adoption or full fallback |
| Code Mode card patched locally | Kind gate missing or stale event classification | Hard scope failure; restore full fallback |
| `bodyPatch`/`noDomAdoption` later rebuilds Timeline marks from Inspector | Inspector continuation acted as a second presentation owner | Make Inspector part of request-owned outcome; reclassify whole transaction as one full fallback when unsafe |
| Schema-4 run is expected to report settlement/body/scan rows | Focused and generic evidence layers were conflated | Remove the claim; prove causality in focused Chromium and keep schema 4 unchanged |
| Geometry reads equal mounted count | Candidate selection happens after geometry | Select/deduplicate candidates first |
| Collapsed visible Code Mode stops hydrating | Scan narrowed semantics, not just candidates | Restore Code Mode candidate rule |
| Retry settlement unexpectedly local | Retry revision mutation was ignored | Preserve token mismatch/full fallback |
| Late card generations remain amplified | Another full-render callsite remains | Use causal ledger; identify exact callsite before new scope |
| Timing remains high without whole-prefix generation | Residual is no longer this wave's target | Finish checkpoint and pivot to server unless new proof exists |

---

## 27. Rollback boundary / 回滚边界

Wave 1D-A has no persistent data, API, storage, query, or index migration. Rollback reverts together: / Wave 1D-A 没有 persistent data、API、storage、query 或 index migration。Rollback 一并 revert：

```text
request-owned detail presentation settlement
ordinary body-local patch/no-DOM adoption
lifecycle token adoption API
scoped search-target binding changes
scoped Inspector refresh
candidate-first visible scan
focused causal tests/observation
generated client bundle
Wave 1D-A documentation
```

Wave 1A canonical Maps, Wave 1B batching, and Wave 1C keyed append/lifecycle remain independently valid. / Wave 1A canonical Map、Wave 1B batching 与 Wave 1C keyed append／lifecycle 继续独立有效。

---

## 28. Post-Wave stopping checkpoint / Wave 后 stopping checkpoint

After accepted candidate/evidence review, ask exactly: / Accepted candidate／evidence review 后，精确询问：

```text
Did ordinary detail settlement cease to produce
whole-prefix Timeline generation in the accepted late-hit path?
```

If yes: / 如果 YES：

```text
pivot to the cold/server checkpoint
```

This remains the default even if smaller browser O(N) paths remain. Do not automatically authorize Wave 1D-B, Code Mode fanout, fold localization, selection localization, or virtualization. / 即使仍存在较小 browser O(N) path，也保持该默认结论。不得自动授权 Wave 1D-B、Code Mode fanout、fold localization、selection localization 或 virtualization。

If whole-prefix generation materially persists: / 如果 whole-prefix generation 仍显著存在：

```text
identify the exact remaining request/mutation/callsite first
→ perform a new planning decision
→ do not broaden this plan retroactively
```

The candidate server direction remains a separate planning decision and receives no plan or branch here. / Candidate server direction 继续是独立 planning decision；本文不为其创建 plan 或 branch。

---

## 29. Decision log / 决策日志

- 2026-08-30: PR #29 merged accepted Wave 1C keyed Main append into `towards-0.2.0` as `b7ca3bff12fd5061410aaa3483341023498b23d4`, tree `cad8ff765804bbc0b5c4d2bbec48784da98814e7`. / 2026-08-30：PR #29 以 `b7ca3bff12fd5061410aaa3483341023498b23d4`、tree `cad8ff765804bbc0b5c4d2bbec48784da98814e7` 将 accepted Wave 1C keyed Main append merge 到 `towards-0.2.0`。
- 2026-08-30: Accepted post-Wave-1C assessment selected a small Wave 1D-A followed by an immediate server checkpoint. / 2026-08-30：Accepted post-Wave-1C assessment 选择 small Wave 1D-A，随后立即进行 server checkpoint。
- 2026-08-30: Formal scope narrows the earlier article-replacement hypothesis to ordinary `.eventBody` replacement/update while preserving article/header/preview/footer/context identities. / 2026-08-30：Formal scope 将早期 article-replacement hypothesis 收窄为 ordinary `.eventBody` replacement／update，同时保留 article／header／preview／footer／context identity。
- 2026-08-30: Code Mode detail and referenced `web_search` presentation remain full-render-only because their affected-owner dependency is multi-owner. / 2026-08-30：Code Mode detail 与 referenced `web_search` presentation 继续仅允许 full render，因为其 affected-owner dependency 为 multi-owner。
- 2026-08-30: One request-owned accepted mutation owns exactly one Timeline settlement; `ensureEventDetail()` callers may not own presentation. / 2026-08-30：一个 request-owned accepted mutation 精确拥有一次 Timeline settlement；`ensureEventDetail()` caller 不得拥有 presentation。
- 2026-08-30: Mounted-token adoption may update all owner metadata in memory; removing O(N) DOM reconstruction/highlighting/layout is the wave objective, not theoretical O(1) metadata. / 2026-08-30：Mounted-token adoption 可在内存中更新全部 owner metadata；本 wave 目标是移除 O(N) DOM reconstruction／highlighting／layout，而非追求理论 O(1) metadata。
- 2026-08-30: Generic Timeline profiling remains schema 4; focused Chromium owns content-free causal settlement/body/scan proof. / 2026-08-30：Generic Timeline profiling 保持 schema 4；focused Chromium 负责 content-free causal settlement／body／scan proof。
- 2026-08-30: Timing remains descriptive; structural causality and identity are acceptance. / 2026-08-30：Timing 继续仅作描述；structural causality 与 identity 才是 acceptance。
- 2026-08-30: Independent review returned `BLOCKED_FOR_NORMATIVE_REPAIR`. The documentation-only repair separates request errors from presentation errors, closes Inspector outcome ownership at the request transaction, and separates focused causal evidence from unchanged schema-4 formal evidence. Product scope and M0 authorization remain unchanged. / 2026-08-30：Independent review 返回 `BLOCKED_FOR_NORMATIVE_REPAIR`。本次 documentation-only repair 分离 request error 与 presentation error、在 request transaction 内封闭 Inspector outcome ownership，并分离 focused causal evidence 与不变 schema-4 formal evidence。Product scope 与 M0 authorization 保持不变。
- 2026-08-30: Fresh independent review accepted the repaired plan: `PLAN_1D_A: ACCEPTED`, `NORMATIVE_BLOCKERS: CLOSED`, `ARCHITECTURAL_BLOCKERS: NONE`. / 2026-08-30：Fresh independent review 接受修复后的计划：`PLAN_1D_A: ACCEPTED`、`NORMATIVE_BLOCKERS: CLOSED`、`ARCHITECTURAL_BLOCKERS: NONE`。
- 2026-08-30: M0 was separately authorized, revalidated the exact live target with no descendant drift, froze the contracts below, created the implementation branch at the live target, registered this plan, and stopped before M1. / 2026-08-30：M0 获另行授权，重新核验无 descendant drift 的精确 live target，冻结下述 contract，在 live target 创建 implementation branch，登记本计划，并于 M1 前停止。
- 2026-08-31: The separately authorized M1 completed only ordinary body/no-DOM detail settlement, request-owned presentation/error separation, lifecycle token adoption, scoped search/Inspector work, candidate-first visible scanning, and focused content-free observation. Focused executor validation passed and stopped before R1/M2. / 2026-08-31：另行授权的 M1 仅完成 ordinary body／no-DOM detail settlement、request-owned presentation／error separation、lifecycle token adoption、scoped search／Inspector work、candidate-first visible scan 与 focused content-free observation。Focused executor validation 已通过，并于 R1／M2 前停止。

---

## 30. M0 execution record and frozen implementation contract / M0 execution record 与冻结的 implementation contract

### 30.1 Live target, drift, branch point, and toolchain / Live target、drift、branch point 与 toolchain

M0 resolved the public integration ref directly and then fetched that exact object for local ancestry/source inspection. / M0 直接解析 public integration ref，随后 fetch 该精确 object，以进行本地 ancestry／source inspection。

```text
Resolved ref: refs/heads/towards-0.2.0
Live target SHA: b7ca3bff12fd5061410aaa3483341023498b23d4
Live target tree: cad8ff765804bbc0b5c4d2bbec48784da98814e7
Required ancestor: b7ca3bff12fd5061410aaa3483341023498b23d4
Ancestor result: PASS — live target is the required commit itself
Branch point: b7ca3bff12fd5061410aaa3483341023498b23d4
Relevant descendant drift: NONE
Implementation branch: perf/wave-1d-a-ordinary-detail-body-patch

Node: v24.18.1
npm: 12.0.2
Git: 2.43.0.windows.1
PowerShell: 7.6.5
```

At M0 entry, the local checkout was `perf/wave-1c-keyed-main-append` at `0791f70208caf8183f627ea0bc4f590a6b7f5213`, whose tracked tree was already the accepted tree. Tracked files were clean; this active plan was the sole untracked planning artifact. The merge commit has parents `a329777…` and `0791f702…`; its tracked tree and the local pre-M0 tracked tree were identical. Because the live target equals the accepted inspected base, there is no descendant commit to classify and no implementation-envelope or governing-contract drift. The M0 branch was created only after those checks, and its `HEAD` and tree are the live target values above. / M0 开始时，本地 checkout 为 `perf/wave-1c-keyed-main-append`，位于 `0791f70208caf8183f627ea0bc4f590a6b7f5213`，其 tracked tree 已是 accepted tree。Tracked file clean；本 active plan 是唯一 untracked planning artifact。Merge commit 的 parent 为 `a329777…` 与 `0791f702…`；其 tracked tree 与 M0 前本地 tracked tree 完全相同。由于 live target 等于 accepted inspected base，不存在需要分类的 descendant commit，也不存在 implementation envelope 或 governing contract drift。仅在这些检查通过后才创建 M0 branch；其 `HEAD` 与 tree 即为上述 live target 值。

### 30.2 Governing-reference revalidation / Governing reference 重新核验

M0 reread every implementation-ref path in Section 3 from the exact live tree, including product/design authority, all completed performance plans, the relevant browser source and focused tests, build tooling, generic profiler, Wave 0 runner, Wave 1B validator, and package scripts. The resulting contract findings are: / M0 从精确 live tree 复读第 3 节的每个 implementation-ref path，包括 product／design authority、全部 completed performance plan、相关 browser source 与 focused test、build tooling、generic profiler、Wave 0 runner、Wave 1B validator 与 package script。Contract 结论如下：

```text
Wave 1A canonical Timeline ownership: UNCHANGED
  currentEvents / currentEventsById / offset / timelineDataContext

Wave 1B batch ownership and policy: UNCHANGED
  invocation/generation ownership, stale/abort handling,
  accumulated canonical publication, and one accepted search batch policy

Wave 1C lifecycle/root/token/append contracts: UNCHANGED
  unified root writer, keyed Main owners, fixed seven-field token,
  fail-closed context/token checks, suffix append, suffix-only search work

scripts/timeline-profile.js: UNCHANGED; PROFILE_SCHEMA_VERSION = 4
scripts/performance-wave-0-runner.js: UNCHANGED and compatible
scripts/performance-wave-1b-validator.js: UNCHANGED and compatible
Product specification/user-visible behavior: UNCHANGED
```

The exact live-tree blobs used for the most drift-sensitive seams were `src/browser/app.js` `3e277…`, `src/browser/timeline-card-lifecycle.js` `0de3…`, `src/browser/search-targets.js` `6099…`, `src/browser/highlight.js` `7fe7…`, `scripts/timeline-profile.js` `9582…`, the Wave 0 runner `54e8…`, the Wave 1B validator `95183…`, and the completed Wave 1C plan `2a554…`. These identifiers are audit aids, not implementation gates; the full SHA/tree above is authoritative. / 最易受 drift 影响的 seam 所使用的精确 live-tree blob 为：`src/browser/app.js` `3e277…`、`src/browser/timeline-card-lifecycle.js` `0de3…`、`src/browser/search-targets.js` `6099…`、`src/browser/highlight.js` `7fe7…`、`scripts/timeline-profile.js` `9582…`、Wave 0 runner `54e8…`、Wave 1B validator `95183…` 与 completed Wave 1C plan `2a554…`。这些 identifier 仅用于 audit，不是 implementation gate；以上完整 SHA／tree 才是权威值。

No confirmed source fact in Section 5 was invalidated. / 第 5 节的 confirmed source fact 均未失效。

### 30.3 Complete detail-state ownership inventory / 完整 detail-state ownership inventory

The current direct writers, resetters, deleters, aborters, and significant read owners are frozen as follows. Function names identify the source boundary; M1 must rerun this inventory before editing if any source changes. / 当前 direct writer、resetter、deleter、aborter 与重要 read owner 冻结如下。Function name 用于标识 source boundary；若 source 发生任何变化，M1 必须在编辑前重跑该 inventory。

| State / 状态 | Current writers and lifetime owners / 当前 writer 与 lifetime owner | Current read/observation owners / 当前 read／observation owner |
| --- | --- | --- |
| `state.detailCache` | `loadEventDetail()` writes accepted success and deletes the prior error; `resetSessionDetailCache()` replaces the object; Timeline and Inspector `retry-detail` handlers delete one keyed value | `timelineEventDetail()`, `compactCodeModeWebLifecycleIds()`, `renderInspectorDetail()`, `renderEventBody()`, `loadEventDetail()`/`ensureEventDetail()` guards, `showInspector()` presentation and request guard |
| `state.detailErrors` | `loadEventDetail()` writes one accepted request failure and success deletes the prior error; reset replaces the object; both retry handlers delete one keyed value | `renderInspectorDetail()`, `renderEventBody()`, load/ensure guards, `showInspector()` request guard |
| `state.detailPending` | `loadEventDetail()` creates exactly one keyed promise, returns/reuses it, and deletes it in owner-checked cleanup; reset replaces the object | `loadEventDetail()` dedupe and return; `ensureNavigationEvents()` awaits the selected keyed promise only as a background-handoff delay |
| `state.detailCacheGeneration` | `resetSessionDetailCache()` is the sole incrementer | `loadEventDetail()` captures/checks it for stale acceptance; detail search/selection/context-reveal keys capture/check it |
| `state.presentationRevisions.detailPresentationRevision` | accepted success and accepted request failure each advance it once; cache reset and the two explicit retry handlers also advance it | `currentTimelinePresentationToken()` captures it; lifecycle fixed-width token validation/equality consumes it |
| `detailRequestControllers` | `loadEventDetail()` creates/sets and owner-checks/deletes a controller; `invalidateDetailSelection()` aborts the selected detail key; `resetSessionDetailCache()` aborts all and clears the Map | `loadEventDetail()` success/error stale checks and owner-checked cleanup |

The complete mutation/lifetime paths are therefore: / 因此完整 mutation／lifetime path 为：

```text
new loadEventDetail request:
  create controller
  → set detailRequestControllers[key]
  → create and publish detailPending[key]
  → accepted success OR accepted request failure OR stale/abort
  → owner-checked controller/pending cleanup

shared loadEventDetail request:
  reuse exact detailPending[key]
  → no new controller/request/mutation owner

resetSessionDetailCache:
  clear context reveal
  → abort all detail controllers
  → clear controller Map
  → replace cache/error/pending objects
  → increment detailCacheGeneration
  → advance detailPresentationRevision

selection invalidation:
  abort only the selected detail controller
  → intentional abort resolves as non-accepted
  → owner cleanup removes controller/pending

Timeline retry-detail:
  delete keyed error/cache
  → advance detailPresentationRevision
  → ensureEventDetail

Inspector retry-detail:
  delete keyed error/cache
  → advance detailPresentationRevision
  → showInspector
```

Retry/reset revision changes are incompatible pre-transaction mutations for the ordinary accepted-settlement fast path and remain fail-closed; M1 must not absorb them into a newly accepted mutation. / Retry／reset revision change 是 ordinary accepted-settlement fast path 的 incompatible pre-transaction mutation，继续 fail-closed；M1 不得把它们并入 newly accepted mutation。

### 30.4 Detail callers, return compatibility, and one-settlement ownership / Detail caller、return compatibility 与 one-settlement ownership

Direct `loadEventDetail()` callers and the separate shared-promise observer are: / Direct `loadEventDetail()` caller 与独立 shared-promise observer 为：

| Caller / caller | Can create or reuse / 可 create／reuse | Current result expectation / 当前 result expectation | Current presentation ownership / 当前 presentation ownership | Frozen M1 compatibility rule / 冻结的 M1 compatibility rule |
| --- | --- | --- | --- | --- |
| `materializeSearchEvent()` | Yes | `await`; ignores boolean | Performs a later full render for search transient expansion/materialization, not a caller-attached detail `.then` | Await the request-owned final outcome; retain only its independently justified search-state render; never use object truthiness |
| `resolveSearchTargetNode()` | Yes | `await`; ignores boolean | Performs a later full render when target markup needs transient expansion | Same as above |
| `ensureEventDetail()` | Yes | `.then(settled)` expects boolean | Currently owns `renderTimeline()` for each caller | Must lose all Timeline presentation ownership; repeated callers only receive/reuse the request-owned outcome |
| `showInspector()` | Yes | `.then(settled)` expects boolean | Currently reruns `showInspector()`, whose `renderDetailShell()` can globally refresh Timeline highlights | Must lose independent settlement/presentation ownership; may observe the closed outcome but must not schedule another Timeline/global highlight presentation |
| `ensureNavigationEvents()` selected-detail handoff | No; directly awaits existing `detailPending[key]` | Ignores value | None | Continue to await only; never rely on truthiness |

Direct `ensureEventDetail()` callers are `loadVisibleExpandedDetails()`, the single-card expand toggle, Timeline `retry-detail`, and inspect-on-collapsed expansion. None consumes its current return value. / Direct `ensureEventDetail()` caller 为 `loadVisibleExpandedDetails()`、single-card expand toggle、Timeline `retry-detail` 与 inspect-on-collapsed expansion。它们均不消费当前 return value。

The complete current whole-Timeline/global-search presentation paths reachable after awaiting an accepted detail are also frozen: / 当前 await accepted detail 后可达的完整 whole-Timeline／global-search presentation path 也冻结如下：

```text
materializeSearchEvent()
  → await loadEventDetail()
  → optional search transient expansion
  → renderTimeline()

resolveSearchTargetNode()
  → await loadEventDetail()
  → optional search transient expansion
  → renderTimeline()

ensureEventDetail()
  → loadEventDetail().then(settled)
  → renderTimeline()

showInspector()
  → loadEventDetail().then(settled)
  → showInspector({ replace: true })
  → possible renderTimeline() if replacement clears temporary reveal
  → renderDetailShell()
  → complete refreshSearchHighlights()
```

No other current `.then`, `await`, or direct `detailPending` observer owns Timeline presentation. The navigation handoff await has no presentation continuation. Search-owned renders remain outside the ordinary detail settlement and are not localized in Wave 1D-A; M1 must keep that distinction explicit in focused causality. / 当前不存在其它拥有 Timeline presentation 的 `.then`、`await` 或 direct `detailPending` observer。Navigation handoff await 没有 presentation continuation。Search-owned render 位于 ordinary detail settlement 之外，Wave 1D-A 不对其 localize；M1 必须在 focused causality 中显式保持该区别。

The current `loadEventDetail()` promise is boolean-valued: cached/error-already-present, stale, and intentional-abort paths resolve `false`; accepted success/error paths resolve `true`. A future shared closed result is therefore **not** a drop-in replacement. M1 must adapt every caller explicitly and must not write `if (result)` for an object. The frozen semantic result boundary is: / 当前 `loadEventDetail()` promise 返回 boolean：cache／error 已存在、stale 与 intentional abort path resolve `false`；accepted success／error path resolve `true`。因此未来 shared closed result **不能**直接替换。M1 必须显式适配每个 caller，且不得对 object 写 `if (result)`。冻结的 semantic result boundary 为：

```text
requestOutcome:
  alreadyAvailable | success | error | stale | abort

acceptedMutation:
  true only for newly accepted success/error

settlementOutcome:
  bodyPatch | noDomAdoption | fullRenderFallback | stale | abort | none

presentationFailed:
  explicit; never reclassified as request error
```

The exact JavaScript representation may be chosen in M1, but every consumer must inspect a named field/enum or deliberately ignore the value. If a final fallback throws, the shared transaction may surface a dedicated presentation failure, but it must retain the frozen accepted request outcome for diagnostics and must never enter request classification. / 精确 JavaScript representation 可由 M1 选择，但每个 consumer 必须检查 named field／enum 或有意忽略该值。若最终 fallback 抛错，shared transaction 可暴露专门的 presentation failure，但必须为诊断保留冻结的 accepted request outcome，且永不进入 request classification。

The unique presentation owner is frozen at the branch that creates a new `detailPending[key]`. A reused promise cannot attach a new Timeline settlement. The current continuations that must lose Timeline ownership are `ensureEventDetail()`'s `.then(renderTimeline)` and `showInspector()`'s `.then(showInspector)`; search callers retain only their separate search-state work after the request-owned result. This permits: / 唯一 presentation owner 冻结在创建新 `detailPending[key]` 的 branch。复用 promise 不得附加新的 Timeline settlement。必须失去 Timeline ownership 的当前 continuation 为 `ensureEventDetail()` 的 `.then(renderTimeline)` 与 `showInspector()` 的 `.then(showInspector)`；search caller 仅保留其在 request-owned result 后独立的 search-state work。这可实现：

```text
N callers
→ one detailPending owner
→ one transport request
→ at most one accepted state mutation
→ one detailPresentationRevision advance for that accepted mutation
→ exactly one request-owned Timeline presentation settlement
```

### 30.5 Request/presentation error seam / Request／presentation error seam

The exact current chain is `api(...).then(acceptedSuccess).catch(requestFailure).finally(ownerCleanup)`. A viable local one-way seam exists inside `src/browser/app.js` without server/API, canonical detail-state, request-family, retry, or reset changes. M1 must classify transport/request failure with two-way promise handlers before any request-owned presentation executes, conceptually: / 当前精确 chain 为 `api(...).then(acceptedSuccess).catch(requestFailure).finally(ownerCleanup)`。在 `src/browser/app.js` 内存在 viable local one-way seam，无需修改 server／API、canonical detail state、request family、retry 或 reset。M1 必须在任何 request-owned presentation 执行前，用 two-way promise handler 完成 transport／request failure classification，概念上为：

```text
transportPromise.then(
  acceptedSuccessMutation,
  acceptedRequestFailureMutation,
)
→ requestOwnedPresentation
→ ownerCheckedCleanup
```

Presentation work is downstream of both accepted handlers and has no request-error classifier after it. Accepted cache/error state and its single revision advance are final before presentation. Local failure attempts one coherent full-render fallback; fallback failure surfaces as presentation failure without writing `detailErrors`, deleting success, advancing a second revision, or creating a second settlement. This seam passed M0 and is mandatory; reintroducing a catch that can absorb presentation exceptions is a stop condition. / Presentation work 位于两个 accepted handler 之后，其后不存在 request-error classifier。Accepted cache／error state 与单次 revision advance 在 presentation 前即为最终状态。Local failure 尝试一次 coherent full-render fallback；fallback failure 作为 presentation failure 暴露，不写 `detailErrors`、不删除 success、不推进第二次 revision、也不创建第二次 settlement。该 seam 已通过 M0，属于 mandatory contract；重新引入可吸收 presentation exception 的 catch 是 stop condition。

### 30.6 Ordinary body-only proof and Code Mode exclusion / Ordinary body-only proof 与 Code Mode exclusion

For an eligible canonical Main event, `displayState()` is computed from navigation reveal, persisted override, search transient expansion, profile state, and structured-filter behavior, not ordinary detail. `renderEventBody()` returns no body unless expanded; expanded loading, success, and error each produce exactly one `.eventBody`. The success body consumes `detail.timelineSections`; the error body consumes `renderDetailFailure()`; the loading body contains only the existing loading snippet/notice. / 对 eligible canonical Main event，`displayState()` 由 navigation reveal、persisted override、search transient expansion、profile state 与 structured-filter behavior 计算，而非 ordinary detail。`renderEventBody()` 仅在 expanded 时返回 body；expanded loading、success 与 error 各产生精确一个 `.eventBody`。Success body 消费 `detail.timelineSections`；error body 消费 `renderDetailFailure()`；loading body 仅包含现有 loading snippet／notice。

For `event.kind !== 'code_mode_operation'` with an accepted non-Code-Mode detail, M0 found no detail dependency in article classes, header, toggle, external preview, chips, context slot, enclosing-operation affordance/relation, or footer. The footer depends only on expanded display state. If the owner collapsed before settlement, no `.eventBody` is mounted and ordinary accepted detail changes no Timeline card markup. These facts validate body-only patch/no-DOM adoption subject to the full eligibility matrix, exact body shape, and closed Inspector outcome. Any runtime kind mismatch or outside-body dependency selects fallback. / 对 `event.kind !== 'code_mode_operation'` 且 accepted detail 亦非 Code Mode 的情况，M0 未发现 article class、header、toggle、external preview、chip、context slot、enclosing-operation affordance／relation 或 footer 对 detail 的依赖。Footer 仅依赖 expanded display state。若 owner 在 settlement 前 collapsed，则没有 mounted `.eventBody`，ordinary accepted detail 不改变任何 Timeline card markup。这些事实在完整 eligibility matrix、精确 body shape 与封闭 Inspector outcome 的约束下，验证 body-only patch／no-DOM adoption。任何 runtime kind mismatch 或 body 外 dependency 均选择 fallback。

Code Mode remains excluded because `codeModeEventPresentation()` affects its own label, chips, collapsed preview, expanded presentation, body, and Inspector, while `compactCodeModeWebLifecycleIds()` scans cached Code Mode details, reads `event_refs`, and changes referenced canonical `web_search` presentation. Accepted Code Mode success/error therefore receives exactly one request-owned `fullRenderFallback`; M0 defines no before/after compact-ID set or dependency graph. / Code Mode 继续排除，因为 `codeModeEventPresentation()` 影响其 own label、chip、collapsed preview、expanded presentation、body 与 Inspector，而 `compactCodeModeWebLifecycleIds()` 扫描 cached Code Mode detail、读取 `event_refs`，并改变 referenced canonical `web_search` presentation。因此 accepted Code Mode success／error 执行精确一次 request-owned `fullRenderFallback`；M0 不定义 before／after compact-ID set 或 dependency graph。

### 30.7 Token transaction and lifecycle adoption seam / Token transaction 与 lifecycle adoption seam

`currentTimelinePresentationToken()` and `timeline-card-lifecycle.js` still use the fixed seven-field token ending in `detailPresentationRevision`. The lifecycle retains one lifecycle-wide mounted token plus the same token snapshot on every keyed owner. M0 freezes this exact M1 helper boundary: / `currentTimelinePresentationToken()` 与 `timeline-card-lifecycle.js` 继续使用以 `detailPresentationRevision` 结尾的固定七字段 token。Lifecycle 保留一个 lifecycle-wide mounted token，并在每个 keyed owner 上保留相同 token snapshot。M0 冻结以下精确 M1 helper boundary：

```text
adoptMountedPresentationToken({
  canonicalContext,
  expectedPreviousToken,
  nextToken,
})
```

The helper must first capture/validate both fixed-width tokens, validate exact lifecycle-wide canonical context/token, and preflight every owner in the in-memory owner Map for exact context/previous-token metadata. Only after the complete preflight may it assign the lifecycle-wide token and every owner token to the captured `nextToken`. The preflight and write phases may each be O(mounted owners), but they must use only lifecycle metadata. They may not traverse/query DOM, scan `currentEvents`/`currentEventsById`, inspect canonical arrays, serialize variable-sized state, or partially adopt. The existing Map exposes all metadata necessary, so this seam passed M0. / Helper 必须先 capture／validate 两个 fixed-width token，验证精确 lifecycle-wide canonical context／token，并对 in-memory owner Map 中每个 owner 的精确 context／previous-token metadata 完成 preflight。仅在完整 preflight 后，才可把 lifecycle-wide token 与每个 owner token 赋为 captured `nextToken`。Preflight 与 write phase 均可为 O(mounted owners)，但只能使用 lifecycle metadata。不得 traverse／query DOM、scan `currentEvents`／`currentEventsById`、检查 canonical array、serialize variable-sized state 或 partial adopt。现有 Map 已暴露全部必要 metadata，因此该 seam 通过 M0。

The transaction remains: valid `beforeToken` captured immediately before one accepted detail write; exactly one detail revision advance; valid `afterToken`; synchronous local work or one fallback; and mounted-token adoption only after all affected local presentation is coherent. Any other token field change, invalid token, owner mismatch, or concurrent incompatible presentation selects fallback. / Transaction 继续为：在一次 accepted detail write 紧前 capture valid `beforeToken`；精确一次 detail revision advance；valid `afterToken`；同步 local work 或一次 fallback；仅在全部 affected local presentation coherent 后执行 mounted-token adoption。任何其它 token field change、invalid token、owner mismatch 或 concurrent incompatible presentation 均选择 fallback。

### 30.8 Owner-scoped search and selected-Inspector seams / Owner-scoped search 与 selected Inspector seam

`src/browser/highlight.js` already supplies sufficient root-scoped `clear(root)` and `apply(root, terms)` primitives. It remains expected-unchanged. `src/browser/search-targets.js` currently has global `resetBindings(targets)`, plus `bind()` and `liveBinding()`. The smallest missing M1 primitive is frozen as `resetSurfaceBindings(target, surface)` or a semantically identical target-local API. It replaces only the named target's named binding array and returns/remembers only that removed set; it must preserve target object identity, registry order, the other surface's binding-array identity/content, unrelated bindings, and `activeTargetId`. / `src/browser/highlight.js` 已提供足够的 root-scoped `clear(root)` 与 `apply(root, terms)` primitive，继续 expected-unchanged。`src/browser/search-targets.js` 当前提供 global `resetBindings(targets)`、`bind()` 与 `liveBinding()`。最小缺失的 M1 primitive 冻结为 `resetSurfaceBindings(target, surface)` 或语义完全相同的 target-local API。它仅替换 named target 的 named binding array，并仅返回／记住该 removed set；必须保留 target object identity、registry order、另一 surface 的 binding-array identity／content、unrelated binding 与 `activeTargetId`。

The app can snapshot/prune affected-owner Timeline marks, call the existing highlighter only on the affected article, rebind marks to the existing canonical target when one exists, and restore the active mark when owned there. It must not recreate canonical targets from detail-only text. No global highlighter model is required, so this seam passed M0. / App 可 snapshot／prune affected-owner Timeline mark，仅对 affected article 调用现有 highlighter，在已有 canonical target 时把 mark rebind 到该 target，并在 active mark 属于该 owner 时恢复它。不得从 detail-only text 创建 canonical target。不需要 global highlighter model，因此该 seam 通过 M0。

The selected Inspector dependency is synchronous for the accepted detail mutation itself. `showInspector()` currently computes detail-derived presentation and rebuilds Inspector synchronously; its navigation request, when present, is independently owned and can render current cached/pending navigation state without awaiting a new detail dependency. Current selection safety is available through the exact detail key, `detailSelectionContextKey()`, and `isCurrentDetailSelection()`. M1 must freeze three request-owned cases: / 对 accepted detail mutation 本身，selected Inspector dependency 是 synchronous。`showInspector()` 当前同步计算 detail-derived presentation 并重建 Inspector；其 navigation request（若存在）由独立 owner 管理，可在不 await 新 detail dependency 的情况下渲染当前 cached／pending navigation state。当前 selection safety 可通过精确 detail key、`detailSelectionContextKey()` 与 `isCurrentDetailSelection()` 获得。M1 必须冻结三个 request-owned case：

```text
Inspector unaffected:
  no Inspector work

Inspector safely scoped:
  exact selection/context preflight
  → synchronous Inspector reconstruction using current navigation state
  → Inspector-surface-only highlight/binding refresh
  → classify bodyPatch/noDomAdoption only after completion

Inspector unsafe, stale, or scoped work fails:
  entire transaction selects one coherent fullRenderFallback
```

The scoped path must not change detail history, mobile-view ownership, selection ownership, raw-reference ownership, or create/await a new navigation dependency. The current `showInspector()` shared-detail `.then(showInspector)` must be removed as an independent presentation owner. Raw-reference view is unaffected unless the exact current selected Inspector contract says otherwise. No Inspector lifecycle redesign is required; if M1 cannot isolate this synchronous mode, it must stop rather than weakening the closed outcome. / Scoped path 不得改变 detail history、mobile-view ownership、selection ownership、raw-reference ownership，也不得创建／await 新 navigation dependency。当前 `showInspector()` 的 shared-detail `.then(showInspector)` 必须失去独立 presentation ownership。Raw-reference view 不受影响，除非精确 current selected Inspector contract 另有证明。不需要 Inspector lifecycle redesign；若 M1 无法隔离该 synchronous mode，必须停止，不得弱化 closed outcome。

### 30.9 Visible-detail scan triggers and frozen semantics / Visible-detail scan trigger 与冻结 semantics

Every current `queueVisibleDetailLoad()` trigger was inventoried: / 已 inventory 每个当前 `queueVisibleDetailLoad()` trigger：

```text
Events mobile-view activation: setMobileView('events')
successful Main suffix append: appendCurrentMainTimelineSuffix() finalization
full Timeline render: renderTimeline()
Timeline scroll: el.timelinePane scroll listener
window resize: window resize listener
```

`queueVisibleDetailLoad()` cancels the prior animation frame and schedules one new scan. The current scan checks `searchDiscoveryContextReady()`, queries every mounted `.event[data-event-id]`, reads each article and its closest scrollport geometry, then tests candidacy. The frozen candidate-first equivalent is: / `queueVisibleDetailLoad()` cancel 前一个 animation frame 并调度一次新 scan。当前 scan 检查 `searchDiscoveryContextReady()`、查询每个 mounted `.event[data-event-id]`、读取每个 article 及其 closest scrollport geometry，然后测试 candidacy。冻结的 candidate-first 等价语义为：

```text
candidate set:
  all currently expanded visible-capable canonical events
  plus collapsed or expanded code_mode_operation only when active Layer is Main

exclude before geometry:
  .hiddenByProfile cards, because current CSS is display:none
  any non-candidate article

geometry:
  deduplicate candidate articles
  read Timeline-pane/scrollport bounds once or a fixed-small number
  read each candidate article rect once
  preserve zero-size rejection
  preserve rect.bottom >= bounds.top && rect.top <= bounds.bottom

request behavior:
  resolve the same current canonical event
  preserve ensureEventDetail request dedupe
  preserve animation-frame coalescing
  preserve collapsed visible Main Code Mode hydration
```

Filtering before geometry does not alter request semantics. `display:none` hidden cards currently have zero geometry and cannot intersect; expanded status and Main Code Mode kind are available without geometry. The simple refinement therefore passed M0; IntersectionObserver, persistent observation, and virtualization remain out of scope. / Geometry 前过滤不改变 request semantics。`display:none` hidden card 当前具有 zero geometry，不能 intersect；expanded status 与 Main Code Mode kind 无需 geometry 即可获得。因此 simple refinement 通过 M0；IntersectionObserver、persistent observation 与 virtualization 继续 out of scope。

### 30.10 Focused causal observation and evidence-layer separation / Focused causal observation 与 evidence-layer separation

The existing lifecycle observer seam is optional and failure-isolated through lazy `notifyObserverSafely()` payload construction. M1 may extend that focused Chromium-only seam; when the observer is absent, no payload, count-only DOM query, serial allocation solely for evidence, or other production observation work may occur. The exact content-free records remain those in Section 18.1: / 现有 lifecycle observer seam 通过 lazy `notifyObserverSafely()` payload construction 保持 optional／failure-isolated。M1 可扩展该 focused Chromium-only seam；observer 不存在时，不得发生 payload、仅为计数的 DOM query、仅为 evidence 的 serial allocation 或其它 production observation work。精确 content-free record 继续采用第 18.1 节定义：

```text
detail request:
  observer-local requestSerial
  created/reused phase
  acceptedMutation = success | error | none
  one presentationSettlement flag/count
  settlementOutcome = bodyPatch | noDomAdoption | fullRenderFallback | stale | abort
  presentationErrorStage = none | local | fallback
  acceptedStateReclassified = false

body transaction:
  ordinary/CodeMode classification only
  expanded/body-present classification only
  article/context-slot identity booleans

direct Timeline-root MutationRecord ledger (separate):
  operation-local direct-root mutation rows
  append/replacement/clear/initial-mount classification

visible scan:
  observer-local scanSerial
  mountedArticleCount
  candidateArticleCount
  articleGeometryReadCount
  scrollportGeometryReadCount
  ensuredDetailCount
```

Observer-local serials are opaque counters and cannot encode an event or Session identity. Records must never contain event/Session IDs, search text, detail/body content, paths, repository paths, ID-bearing URLs, DOM serialization, source payload, or transcript content. Observer method access, payload creation, invocation, and promise-return handling remain isolated from product authority and failure. / Observer-local serial 是 opaque counter，不得编码 event 或 Session identity。Record 永不得包含 event／Session ID、search text、detail／body content、path、repository path、包含 ID 的 URL、DOM serialization、source payload 或 transcript content。Observer method access、payload creation、invocation 与 promise-return handling 继续与 product authority／failure 隔离。

Evidence ownership is frozen and non-interchangeable: / Evidence ownership 冻结且不可互换：

```text
Focused Chromium:
  Wave 1D-A request/mutation/settlement/body/Inspector/geometry causality

Unchanged schema-4 profiler:
  existing generic card generation, Timeline-root mutation observation,
  highlight, timeline/detail request, Long Task, duration,
  Resource Timing, final-state, and generic acceptance fields only
```

Schema 4 does not gain the focused ledger. `scripts/timeline-profile.js`, `test/timeline-profile.test.js`, `scripts/performance-wave-0-runner.js`, and `scripts/performance-wave-1b-validator.js` remain unchanged in M0 and expected-unchanged in M1. Timing remains descriptive. / Schema 4 不增加 focused ledger。`scripts/timeline-profile.js`、`test/timeline-profile.test.js`、`scripts/performance-wave-0-runner.js` 与 `scripts/performance-wave-1b-validator.js` 在 M0 中保持 unchanged，并在 M1 中继续 expected-unchanged。Timing 继续仅作描述。

### 30.11 M0 gate result / M0 gate 结果

All M0 stop conditions were checked against the exact live tree. No accepted source fact was invalidated; every required local seam exists without Wave 1D-B, server, virtualization, profiler, API, canonical-ownership, or lifecycle-redesign scope. M0 therefore passes. This is a contract freeze only: none of the proposed functions/result objects/observer rows has been implemented. / 已针对精确 live tree 检查全部 M0 stop condition。Accepted source fact 均未失效；每个必需 local seam 均存在，且无需进入 Wave 1D-B、server、virtualization、profiler、API、canonical ownership 或 lifecycle redesign scope。因此 M0 通过。本节仅冻结 contract：尚未实现任何 proposed function／result object／observer row。

```text
git diff --check: PASS
exact changed-path audit: PASS
  AGENTS.md
  docs/exec-plans/active/2026-08-30-performance-wave-1d-a-ordinary-detail-body-patch.md
active-plan registration uniqueness: PASS — exactly one AGENTS.md entry
source inventory completeness/text audit: PASS
Markdown fence/UTF-8 consistency audit: PASS
product/test/generated/tooling changed-path count: 0
```

Git emitted the existing Windows working-copy LF→CRLF notice for `AGENTS.md`; it reported no whitespace error. / Git 对 `AGENTS.md` 发出已有的 Windows working-copy LF→CRLF notice；未报告 whitespace error。

---

## 31. M1 execution record / M1 execution record

### 31.1 Implemented boundary / 已实现 boundary

M1 changed only the accepted explicit mechanisms: / M1 仅修改 accepted explicit mechanism：

1. `loadEventDetail()` now creates one request-owned transaction at the unique `detailPending[key]` creation branch. The pending promise carries a private transaction identity; reuse observes the same promise and cannot create another Timeline presentation owner. / `loadEventDetail()` 现于唯一 `detailPending[key]` creation branch 创建一个 request-owned transaction。Pending promise 携带 private transaction identity；reuse 观察同一 promise，不能创建另一个 Timeline presentation owner。
2. Transport success/failure classification uses a two-way promise boundary before request-owned presentation. Accepted success/error state plus its one detail revision is final before presentation; local/fallback presentation failure cannot enter the request-error handler. / Transport success／failure classification 在 request-owned presentation 前使用 two-way promise boundary。Accepted success／error state 与其单次 detail revision 在 presentation 前即为最终状态；local／fallback presentation failure 不能进入 request-error handler。
3. Shared results expose named `requestOutcome`, `acceptedMutation`, `settlementOutcome`, and `presentationFailed` fields. Direct search/handoff callers deliberately ignore or await named results; no caller relies on object truthiness. `ensureEventDetail()` retains its cached fast return and owns no `.then(renderTimeline)` continuation. `showInspector()` owns no shared-detail `.then(showInspector)` continuation. / Shared result 暴露 named `requestOutcome`、`acceptedMutation`、`settlementOutcome` 与 `presentationFailed` field。Direct search／handoff caller 有意忽略或 await named result；无 caller 依赖 object truthiness。`ensureEventDetail()` 保留 cached fast return，且不再拥有 `.then(renderTimeline)` continuation。`showInspector()` 不再拥有 shared-detail `.then(showInspector)` continuation。
4. Eligible expanded ordinary canonical Main detail settles by preparing exact `renderEventBody(event, 'expanded')` markup off-DOM, validating one direct old/new `.eventBody`, capturing the exact mounted `.timelinePane` ancestor and its scroll position, refreshing only affected-owner search state, synchronously refreshing affected Inspector scope when safe, validating identities/currentness/scroller identity, restoring the captured scroll position on that same scroller, and replacing only the body subtree before mounted-token adoption. / Eligible expanded ordinary canonical Main detail 通过以下步骤 settle：off-DOM 准备精确 `renderEventBody(event, 'expanded')` markup，验证精确一个 direct old／new `.eventBody`，capture 精确 mounted `.timelinePane` ancestor 及其 scroll position，仅刷新 affected-owner search state，在安全时同步刷新 affected Inspector scope，验证 identity／currentness／scroller identity，在同一 scroller 上恢复 captured scroll position，并仅替换 body subtree，随后执行 mounted-token adoption。
5. Eligible ordinary collapsed/no-body settlement performs no Timeline DOM or Timeline highlight mutation; affected Inspector scope, when present, completes before token adoption and `noDomAdoption` classification. / Eligible ordinary collapsed／no-body settlement 不执行 Timeline DOM 或 Timeline highlight mutation；affected Inspector scope（若存在）在 token adoption 与 `noDomAdoption` classification 前完成。
6. Code Mode, incompatible kind/context/token/search/body/owner state, retry mismatch, temporary/replacement/project state, unsafe Inspector scope, and local failure select exactly one request-owned full-render fallback. No Code Mode/web lifecycle dependency graph was introduced. / Code Mode、incompatible kind／context／token／search／body／owner state、retry mismatch、temporary／replacement／project state、unsafe Inspector scope 与 local failure 均选择精确一次 request-owned full-render fallback。未引入 Code Mode／web lifecycle dependency graph。
7. `timeline-card-lifecycle.js` now exposes the bounded `adoptMountedPresentationToken()` seam. It validates fixed-width tokens and complete in-memory owner context/token metadata before any write, then updates lifecycle-wide and owner token metadata together. It performs no DOM or canonical-event scan. / `timeline-card-lifecycle.js` 现暴露 bounded `adoptMountedPresentationToken()` seam。它在任何 write 前验证 fixed-width token 与完整 in-memory owner context／token metadata，随后共同更新 lifecycle-wide 与 owner token metadata。它不执行 DOM 或 canonical-event scan。
8. `search-targets.js` now exposes only `resetSurfaceBindings(target, surface)`. The app uses existing root-scoped highlighter APIs on one Timeline owner and, when affected, one Inspector owner; target objects/order, unrelated marks/bindings, other-surface bindings, and active target identity remain retained. Detail-only visual text never creates a canonical target. `src/browser/highlight.js` remains unchanged. / `search-targets.js` 仅新增 `resetSurfaceBindings(target, surface)`。App 对一个 Timeline owner 与（affected 时）一个 Inspector owner 使用现有 root-scoped highlighter API；target object／order、unrelated mark／binding、other-surface binding 与 active target identity 均保留。Detail-only visual text 永不创建 canonical target。`src/browser/highlight.js` 保持 unchanged。
9. `loadVisibleExpandedDetails()` now selects/deduplicates expanded candidates plus Main Code Mode candidates before geometry, excludes `hiddenByProfile` before geometry, reads scrollport bounds once, and reads one rect per candidate. Existing rAF coalescing and all five scheduling triggers remain unchanged. / `loadVisibleExpandedDetails()` 现于 geometry 前选择／deduplicate expanded candidate 与 Main Code Mode candidate，在 geometry 前排除 `hiddenByProfile`，读取一次 scrollport bounds，并为每个 candidate 读取一次 rect。现有 rAF coalescing 与五个 scheduling trigger 均保持 unchanged。
10. The existing optional lifecycle observer gained lazy content-free detail/body/scan records. Observer-local serials allocate only inside lazy payload creation; fallback-only canonical/display/DOM facts are constructed only inside the callable body-observer payload closure. Product transactions own no observer-only active pointer or root-replacement counter. The existing focused direct-root MutationRecord ledger, not product state, owns root replacement causality. Absent or failing observers cannot affect product behavior. Generic schema-4 tooling remains untouched. / 现有 optional lifecycle observer 新增 lazy content-free detail／body／scan record。Observer-local serial 仅在 lazy payload creation 内分配；fallback-only canonical／display／DOM fact 仅在 callable body-observer payload closure 内构造。Product transaction 不持有 observer-only active pointer 或 root-replacement counter。Root replacement causality 由现有 focused direct-root MutationRecord ledger 而非 product state 负责。Observer 缺失或失败不能影响 product behavior。Generic schema-4 tooling保持 untouched。

No article replacement, generic keyed-owner renderer, generic diff, fold/navigation localization, Code Mode fanout, virtualization, IntersectionObserver, server work, canonical ownership change, or Wave 1B policy change was implemented. / 未实现 article replacement、generic keyed-owner renderer、generic diff、fold／navigation localization、Code Mode fanout、virtualization、IntersectionObserver、server work、canonical ownership change 或 Wave 1B policy change。

### 31.2 Changed paths / Changed path

```text
M1 executable/test changes:
  src/browser/app.js
  src/browser/timeline-card-lifecycle.js
  src/browser/search-targets.js
  test/timeline-card-lifecycle.test.js
  test/search-targets.test.js
  e2e/browser.test.js

M1 execution record:
  docs/exec-plans/active/2026-08-30-performance-wave-1d-a-ordinary-detail-body-patch.md

M0 registration retained without substantive M1 change:
  AGENTS.md
```

All mandatory expected-unchanged paths in Sections 14 and 16 have zero diff, including `src/browser/highlight.js`, Timeline state/batch/transition modules, generic profiler/tests/runners/validator, server/query/store modules, package/lockfile/workflows, design/product docs, and `public/assets/app.js`. / 第 14、16 节的全部 mandatory expected-unchanged path 均为 zero diff，包括 `src/browser/highlight.js`、Timeline state／batch／transition module、generic profiler／test／runner／validator、server／query／store module、package／lockfile／workflow、design／product doc 与 `public/assets/app.js`。

### 31.3 Focused structural findings / Focused 结构 findings

The focused executor cases established: / Focused executor case 已证明：

```text
ordinary loading → success:
  one request / one accepted mutation / one revision / one settlement
  outcome bodyPatch
  Timeline-root replacement 0
  article/header/toggle/preview/footer/context/selection identities preserved
  affected Timeline + Inspector search only
  unrelated target/mark/binding identities preserved
  exact mounted Timeline scroller identity retained
  explicitly non-zero Timeline scrollTop restored after material body-height change

ordinary loading → request error:
  one accepted error mutation / one revision / one settlement
  outcome bodyPatch
  Timeline-root replacement 0

collapsed before settlement:
  outcome noDomAdoption
  Timeline DOM mutation 0
  Timeline highlight mutation 0
  affected Inspector completes synchronously when selected

eight held ordinary requests:
  8 transport requests
  8 accepted mutations
  8 detail revisions
  8 request-owned settlements
  0 direct Timeline-root mutations during settlement

Code Mode success and error controls:
  one accepted mutation
  one settlement
  one fullRenderFallback
  zero local body patch

forced local failure:
  accepted state remains authoritative
  one fullRenderFallback settlement
  no second revision/mutation/settlement

forced fallback-render failure after success/error:
  presentationFailed true and failure surfaced
  accepted success/error remains authoritative
  no request reclassification or second settlement

stale and abort controls:
  accepted mutation 0
  presentation settlement 0

visible scan:
  articleGeometryReadCount == candidateArticleCount
  scrollportGeometryReadCount == 1
  hidden mounted non-candidates == 0 article geometry reads
  collapsed visible Main Code Mode hydration retained

post-adoption Main append:
  append-only publication retained
  prefix article identity retained
  replacement count 0
```

Focused controls also cover duplicate/missing/disconnected body/owner state, stale context-slot ownership, an extra presentation revision between tokens, Timeline and Inspector retry revisions, detail-only phrase addition, phrase removal, active-mark restoration, unsafe Inspector fallback, observer failure isolation, and Query/profile/locale full-render transitions. Inherited Wave 1C controls retain temporary-reveal/replacement/Session/Protocol/Raw behavior, and the Wave 1B late-target activation path remains functional with the closed result. / Focused control 还覆盖 duplicate／missing／disconnected body／owner state、stale context-slot ownership、token 间的额外 presentation revision、Timeline／Inspector retry revision、detail-only phrase addition、phrase removal、active-mark restoration、unsafe Inspector fallback、observer failure isolation 与 Query／profile／locale full-render transition。Inherited Wave 1C control 保留 temporary reveal／replacement／Session／Protocol／Raw behavior；Wave 1B late-target activation path 在 closed result 下继续 functional。

The bounded post-R1 repair additionally proves that an absent detail/body observer causes no fallback-only canonical lookup on `bodyPatch`, no fallback-only owner DOM read on `fullRenderFallback`, and no detail/body/revision record construction. With the observer enabled, content-free request/body facts remain available and direct Timeline-root replacement facts are derived from the authoritative focused MutationRecord ledger. / Bounded post-R1 repair 还证明：detail／body observer 缺失时，`bodyPatch` 不执行 fallback-only canonical lookup，`fullRenderFallback` 不执行 fallback-only owner DOM read，且不构造 detail／body／revision record。Observer 启用时，content-free request／body fact 继续可用，direct Timeline-root replacement fact 从权威 focused MutationRecord ledger 推导。

These are executor-test facts, not formal candidate evidence. No schema-4 or performance artifact was captured, and no timing value is an acceptance claim. / 以上为 executor test fact，不是 formal candidate evidence。未 capture schema-4 或 performance artifact，且任何 timing 值均不构成 acceptance claim。

### 31.4 M1 executor validation / M1 executor validation

```text
Changed-JavaScript syntax checks:
  PASS — 6 files

Focused Node:
  node --test test/timeline-card-lifecycle.test.js test/search-targets.test.js
  PASS — 21 tests, 0 failures

Focused Wave 1D-A Chromium:
  node --test --test-name-pattern='browser Wave 1D-A M1' e2e/browser.test.js
  PASS — 27 tests, 0 failures

Inherited browser controls on the source bundle:
  Wave 1B late-target activation
  Wave 1C lifecycle/context/append/search/Code Mode/fallback/temporary/control cases
  PASS — 13 tests, 0 failures

git diff --check:
  PASS

exact changed-path audit:
  PASS — only the eight paths listed in Section 31.2/M0 registration

active-plan registration uniqueness:
  PASS — exactly one AGENTS.md entry

mandatory expected-unchanged-path audit:
  PASS — zero diff
```

Git emitted only the existing Windows working-copy LF→CRLF notices; it reported no whitespace error. No full browser suite, generated bundle build, profiler, Wave 0 runner, Wave 1B validator, formal evidence, candidate freeze, or release command was run. / Git 仅发出已有 Windows working-copy LF→CRLF notice；未报告 whitespace error。未运行 full browser suite、generated bundle build、profiler、Wave 0 runner、Wave 1B validator、formal evidence、candidate freeze 或 release command。

---

## 32. M1 progress and current stop / M1 进度与当前停止点

```text
Formal plan and normative repair: ACCEPTED
M0: PASS
M1 authorized: YES — M1 ONLY
M1 bounded implementation: COMPLETE
M1 focused executor validation: PASS
Initial independent R1: BLOCKED_M1 — two bounded repair findings
Bounded M1 repair authorized/executed: COMPLETE
Bounded M1 repair executor validation: PASS
Second independent R1: BLOCKED_M1 — unconditional evidence-only pending-Promise pointer
Final bounded M1 observer repair authorized/executed: COMPLETE
Final bounded M1 observer repair executor validation: PASS

Implementation branch: perf/wave-1d-a-ordinary-detail-body-patch
Branch HEAD: b7ca3bff12fd5061410aaa3483341023498b23d4
Working tree: uncommitted authorized M0/M1 changes

Next fresh independent R1 performed: NO — awaiting review
M2 authorized/performed: NO
Generated assets changed: NO
Formal profiling/evidence captured: NO
Candidate commit/freeze: NO
Commit/push/PR/merge/publish/release: NO
```

The bounded M1 repair stops here. The next possible action is fresh independent R1 implementation review. Do not infer R1 or M2 authorization from the passed repair executor gate. / Bounded M1 repair 在此停止。下一项可能 action 是 fresh independent R1 implementation review。不得从已通过的 repair executor gate 推断 R1 或 M2 authorization。

---

## 33. Bounded M1 repair record / Bounded M1 repair 记录

### 33.1 Repaired findings / 已修复 finding

The accepted architecture and product boundary did not change. The repair changed only the two independently reported implementation defects: / Accepted architecture 与 product boundary 未改变。Repair 仅修改 independent review 报告的两个 implementation defect：

1. `captureOrdinaryOwnerIdentity()` now resolves the exact mounted Timeline scroller through `el.timeline.closest('.timelinePane')`, requires that node to be connected, and captures that exact node plus its `scrollTop`. After body/search/Inspector local work, identity validation requires the same connected scroller, restores its captured `scrollTop`, and verifies the final value. No persistent scrolling state or new app-global element was introduced. / `captureOrdinaryOwnerIdentity()` 现通过 `el.timeline.closest('.timelinePane')` 解析精确 mounted Timeline scroller，要求该 node connected，并 capture 该精确 node 与其 `scrollTop`。Body／search／Inspector local work 完成后，identity validation 要求仍为同一 connected scroller，恢复 captured `scrollTop` 并验证最终值。未引入 persistent scrolling state 或新 app-global element。
2. Product-owned `activeDetailPresentationTransaction` and `timelineRootReplacementCount` state was removed. The detail/body observer no longer reports a product-maintained root count; direct Timeline-root replacement causality comes from the existing focused per-MutationRecord ledger. Observer request serial state is created only during callable lazy payload construction, and fallback canonical/lifecycle/display/DOM facts are now inside the lazy body-observer payload closure. When that callback is absent, those facts are not computed. / 已移除 product-owned `activeDetailPresentationTransaction` 与 `timelineRootReplacementCount` state。Detail／body observer 不再报告 product-maintained root count；direct Timeline-root replacement causality 来自现有 focused per-MutationRecord ledger。Observer request serial state 仅在 callable lazy payload construction 中创建；fallback canonical／lifecycle／display／DOM fact 现位于 lazy body-observer payload closure 内。该 callback 缺失时，不计算这些 fact。

Request ownership, request/presentation error separation, body-only ordinary settlement, no-DOM adoption, Code Mode full fallback, fixed-width token adoption, scoped Timeline/Inspector search, candidate-first visibility semantics, and schema-4 tooling remain unchanged. / Request ownership、request／presentation error separation、body-only ordinary settlement、no-DOM adoption、Code Mode full fallback、fixed-width token adoption、scoped Timeline／Inspector search、candidate-first visibility semantics 与 schema-4 tooling 均保持 unchanged。

### 33.2 Added adversarial coverage / 新增 adversarial coverage

The repair added three focused Chromium cases: / Repair 新增三个 focused Chromium case：

```text
real Timeline scroller:
  explicitly non-zero scrollTop
  ordinary expanded detail settlement
  materially taller replacement body
  deterministic local-search scroll perturbation
  same scroller/article/header/toggle/preview/footer/context identities
  restored exact scrollTop
  zero direct Timeline-root mutation rows

observer absent — bodyPatch:
  no detail/body/revision observer rows
  no fallback-only canonical lookup after token adoption
  successful bodyPatch
  zero direct Timeline-root mutation rows

observer absent — fullRenderFallback:
  no detail/body/revision observer rows
  no fallback-only owner children/DOM read
  one full-render root replacement derived from MutationRecord ledger

observer enabled:
  existing focused request/body causality remains available
  root replacement facts are derived from the authoritative MutationRecord ledger
```

The scroller test deliberately perturbs the real `.timelinePane` during affected-owner search work, so an implementation that reads the nonexistent `el.timelinePane` cannot satisfy the final exact `scrollTop` assertion. The no-observer probes are armed only across the exact post-adoption or post-root-replacement interval and therefore distinguish the removed fallback-only evidence work from product-required local/fallback work. The stale context-slot control lets prior MutationObserver delivery drain before opening its settlement operation window, so its authoritative root ledger cannot attribute an earlier fault-setup mutation to the request-owned fallback. / Scroller test 在 affected-owner search work 期间有意扰动真实 `.timelinePane`，因此读取不存在 `el.timelinePane` 的 implementation 无法满足最终精确 `scrollTop` assertion。No-observer probe 仅在精确 post-adoption 或 post-root-replacement interval 内 armed，从而将已移除的 fallback-only evidence work 与 product-required local／fallback work 区分开。Stale context-slot control 在打开 settlement operation window 前先让此前 MutationObserver delivery drain，因此其权威 root ledger 不会把更早的 fault-setup mutation 归因于 request-owned fallback。

### 33.3 Final repair executor validation / 最终 repair executor validation

```text
Changed-JavaScript syntax checks:
  PASS — 6 files

Focused Node:
  node --test test/timeline-card-lifecycle.test.js test/search-targets.test.js
  PASS — 21 tests, 0 failures

Focused Wave 1D-A Chromium:
  node --test --test-name-pattern='browser Wave 1D-A M1' e2e/browser.test.js
  PASS — 27 tests, 0 failures

Inherited source-bundle controls:
  node --test --test-name-pattern='browser Wave 1C|browser Wave 1B M2 forward late-target navigation' e2e/browser.test.js
  PASS — 13 tests, 0 failures

git diff --check:
  PASS

exact changed-path audit:
  PASS — only the eight paths listed in Section 31.2/M0 registration

active-plan registration uniqueness:
  PASS — exactly one AGENTS.md entry

mandatory expected-unchanged-path audit:
  PASS — zero diff

focused forbidden production-pattern audit:
  PASS — src/browser/app.js contains no el.timelinePane,
         activeDetailPresentationTransaction, or
         timelineRootReplacementCount production reference
```

Git emitted only the existing Windows working-copy LF→CRLF notices; it reported no whitespace error. No generated bundle, formal profiler, evidence capture, candidate commit, push, PR, merge, publish, or release action occurred. / Git 仅发出已有 Windows working-copy LF→CRLF notice；未报告 whitespace error。未执行 generated bundle、formal profiler、evidence capture、candidate commit、push、PR、merge、publish 或 release action。

### 33.4 Repair stop / Repair 停止点

```text
Initial R1 result: BLOCKED_M1
Authorized bounded repair: COMPLETE
Repair executor validation: PASS
Fresh independent R1: NOT YET PERFORMED
M2: NOT AUTHORIZED / NOT PERFORMED
```

Stop before fresh R1 and M2. / 在 fresh R1 与 M2 前停止。

---

## 34. Final bounded M1 observer-boundary repair / 最终 bounded M1 observer-boundary repair

### 34.1 Repaired boundary / 已修复 boundary

The second independent R1 accepted all product architecture and found one remaining observer-boundary defect: `DETAIL_REQUEST_TRANSACTION` was attached to every pending detail Promise even though product ownership never read that property. The final bounded repair changes only that evidence association. / 第二次 independent R1 接受全部 product architecture，并发现一个剩余 observer-boundary defect：`DETAIL_REQUEST_TRANSACTION` 会附加到每个 pending detail Promise，尽管 product ownership 从不读取该 property。最终 bounded repair 仅修改该 evidence association。

The exact implemented flow is: / 精确 implemented flow 为：

```text
create the same pending product Promise
store it unchanged in state.detailPending[key]
emit requestCreated through the optional recordDetailRequest boundary

if that boundary reports a callable observer:
  attach DETAIL_REQUEST_TRANSACTION as an evidence-only Symbol property
else:
  attach nothing

on reuse:
  first test the normal optional recordDetailRequest observer boundary
  only when callable, look for the evidence Symbol
  if present, emit requestReused with the original transaction/serial
  if absent, emit no reuse record
```

`notifyTimelineLifecycleObserver()` now returns the existing `notifyObserverSafely()` boolean. That boolean is `true` for an installed callable observer even when its payload/callback throws, because failure remains isolated; it is `false` for absent, non-callable, or access-failing observers. The pending Promise shape, `detailPending` value, request controller, local transaction closure, accepted mutation, presentation settlement, cleanup, and closed result are unchanged. No WeakMap, request wrapper, request registry, or second product ownership mechanism was introduced. / `notifyTimelineLifecycleObserver()` 现返回现有 `notifyObserverSafely()` boolean。对于 installed callable observer，即使 payload／callback throw，该 boolean 仍为 `true`，因为 failure 继续 isolated；对于 absent、non-callable 或 access-failing observer 则为 `false`。Pending Promise shape、`detailPending` value、request controller、local transaction closure、accepted mutation、presentation settlement、cleanup 与 closed result 均保持 unchanged。未引入 WeakMap、request wrapper、request registry 或第二套 product ownership mechanism。

If `recordDetailRequest` is installed after an in-flight request was created without it, that request has no Symbol association and therefore emits no `requestReused` row. This is the explicitly accepted behavior; focused causal evidence installs its observer before request creation. / 若 `recordDetailRequest` 在某个 in-flight request 无 observer 创建后才安装，该 request 不具有 Symbol association，因此不 emit `requestReused` row。这是显式 accepted behavior；focused causal evidence 会在 request creation 前安装 observer。

### 34.2 Focused proof / Focused proof

The Chromium seam counts only `Object.defineProperty()` calls that attach a Symbol described as `detailRequestTransaction` to a Promise. It retains no product identity or content. Focused cases prove: / Chromium seam 仅统计把 description 为 `detailRequestTransaction` 的 Symbol 附加到 Promise 的 `Object.defineProperty()` call。它不保留 product identity 或 content。Focused case 证明：

```text
observer absent at request creation:
  association count 0
  a second Inspector caller reuses the in-flight request
  network request count 1
  ordinary body and scoped Inspector settle successfully
  mounted-token adoption count 1
  direct Timeline-root mutation rows 0

recordDetailRequest installed at request creation:
  association count 1
  requestCreated count 1
  requestReused count >= 1
  every reused row retains the requestCreated requestSerial
  network request / mutation / revision / settlement counts remain 1

recordDetailRequest throws from request creation onward:
  association count 1
  bodyPatch completes
  presentationFailed false
  product error state remains clear
```

The source audit confirms that `Object.defineProperty(pending, DETAIL_REQUEST_TRANSACTION, ...)` is inside `if (detailRequestObservationActive)`, and the reuse Symbol lookup is behind `timelineLifecycleObserverMethodIsCallable('recordDetailRequest')`. There is no unconditional evidence-only transaction-pointer assignment or absent-observer reuse lookup. / Source audit 确认 `Object.defineProperty(pending, DETAIL_REQUEST_TRANSACTION, ...)` 位于 `if (detailRequestObservationActive)` 内，且 reuse Symbol lookup 位于 `timelineLifecycleObserverMethodIsCallable('recordDetailRequest')` 之后。不存在 unconditional evidence-only transaction-pointer assignment，也不存在 absent-observer reuse lookup。

### 34.3 Final executor validation / 最终 executor validation

```text
Changed-JavaScript syntax checks:
  PASS — 6 files

Focused Node:
  node --test test/timeline-card-lifecycle.test.js test/search-targets.test.js
  PASS — 21 tests, 0 failures

Complete Wave 1D-A Chromium:
  node --test --test-name-pattern='browser Wave 1D-A M1' e2e/browser.test.js
  PASS — 27 tests, 0 failures

Directly relevant inherited source-bundle controls:
  node --test --test-name-pattern='browser Wave 1C|browser Wave 1B M2 forward late-target navigation' e2e/browser.test.js
  PASS — 13 tests, 0 failures

git diff --check:
  PASS

exact changed-path audit:
  PASS — only the eight paths listed in Section 31.2/M0 registration

active-plan registration uniqueness:
  PASS — exactly one AGENTS.md entry

mandatory expected-unchanged-path audit:
  PASS — zero diff

unconditional evidence-pointer source audit:
  PASS — association and reuse lookup are observer-gated
```

Git emitted only the existing Windows working-copy LF→CRLF notices; no whitespace error was reported. No generated bundle build, profiler, evidence capture, candidate freeze/commit, push, PR, merge, publish, or release action occurred. / Git 仅发出已有 Windows working-copy LF→CRLF notice；未报告 whitespace error。未执行 generated bundle build、profiler、evidence capture、candidate freeze／commit、push、PR、merge、publish 或 release action。

### 34.4 Stop / 停止点

```text
Second R1 result: BLOCKED_M1
Final authorized observer-boundary repair: COMPLETE
Final repair executor validation: PASS
Next fresh independent R1: NOT YET PERFORMED
M2: NOT AUTHORIZED / NOT PERFORMED
```

STOP before fresh independent R1 and M2. / 在 fresh independent R1 与 M2 前 STOP。

---

## 35. M2 validation and candidate-freeze record / M2 validation 与 candidate-freeze 记录

### 35.1 Preflight identity and scope / Preflight identity 与 scope

Fresh independent R1 returned `PASS_M1`. M2 resolved the following immutable parent facts before building: / Fresh independent R1 返回 `PASS_M1`。M2 在 build 前解析出以下 immutable parent fact：

```text
implementation branch:
  perf/wave-1d-a-ordinary-detail-body-patch

branch HEAD / candidate parent / accepted integration base:
  b7ca3bff12fd5061410aaa3483341023498b23d4

accepted base tree:
  cad8ff765804bbc0b5c4d2bbec48784da98814e7

origin/towards-0.2.0:
  b7ca3bff12fd5061410aaa3483341023498b23d4

local towards-0.2.0:
  a3297774e35eec57a40a40a47953f743435c27ed
  stale ancestor one merge behind the accepted base; not used as M2 parent

Node:
  v24.18.1

npm:
  12.0.2
```

The accepted base is the implementation branch ancestor and direct pre-candidate HEAD. There was no descendant executable drift and no post-R1 executable repair. Before bundle generation, the worktree contained exactly the eight reviewed M0/M1 paths. After bundle generation it contained exactly the accepted nine-path candidate envelope: / Accepted base 是 implementation branch ancestor 与 direct pre-candidate HEAD。不存在 descendant executable drift，也不存在 post-R1 executable repair。Bundle generation 前，worktree 精确包含八个 reviewed M0／M1 path；bundle generation 后，精确包含 accepted nine-path candidate envelope：

```text
AGENTS.md
docs/exec-plans/active/2026-08-30-performance-wave-1d-a-ordinary-detail-body-patch.md
e2e/browser.test.js
public/assets/app.js
src/browser/app.js
src/browser/search-targets.js
src/browser/timeline-card-lifecycle.js
test/search-targets.test.js
test/timeline-card-lifecycle.test.js
```

Every mandatory expected-unchanged path in Sections 14, 16, and 22.1 remained zero-diff. In particular, the highlighter/state/batch/transition modules, generic profiler/test/runners/validator, server/query/store modules, package/lockfile/workflows, design docs, and product specs did not change. / 第 14、16 与 22.1 节的全部 mandatory expected-unchanged path 均保持 zero diff。尤其是 highlighter／state／batch／transition module、generic profiler／test／runner／validator、server／query／store module、package／lockfile／workflow、design doc 与 product spec 均未改变。

### 35.2 Generated browser asset / Generated browser asset

`npm run build:client` regenerated the browser assets. The vendor highlight asset was byte-identical and remained unchanged; only the authorized app bundle entered the candidate diff. / `npm run build:client` 重新生成 browser asset。Vendor highlight asset byte-identical 且保持 unchanged；仅 authorized app bundle 进入 candidate diff。

```text
generated path:
  public/assets/app.js

byte size:
  325513

SHA-256:
  900f083ff0874c200ee13c6f87310a46140d08885256a0daa185288b214b929e
```

Direct generated-code inspection found the reviewed request-owned settlement, two-way request classification, ordinary `.eventBody` shape/identity path, exact mounted Timeline scroller preservation, lifecycle token adoption, scoped target reset/rebind, candidate-first scan counters, Code Mode fallback gate, and observer-gated `requestCreated` Symbol association plus reuse lookup. The minified gate is structurally `requestCreated && Object.defineProperty(...)`; reuse checks `recordDetailRequest` callability before the evidence lookup. `npm run build:check` and the release gate independently rebuilt to temporary paths and reported `Generated assets are current`; the tracked bytes and SHA-256 remained unchanged. / Direct generated-code inspection 找到 reviewed request-owned settlement、two-way request classification、ordinary `.eventBody` shape／identity path、精确 mounted Timeline scroller preservation、lifecycle token adoption、scoped target reset／rebind、candidate-first scan counter、Code Mode fallback gate，以及 observer-gated `requestCreated` Symbol association 与 reuse lookup。Minified gate 的结构为 `requestCreated && Object.defineProperty(...)`；reuse 在 evidence lookup 前检查 `recordDetailRequest` callability。`npm run build:check` 与 release gate 分别在 temporary path 重建并报告 `Generated assets are current`；tracked byte 与 SHA-256 保持不变。

### 35.3 M2 validation results / M2 validation 结果

```text
Changed executable/test JavaScript syntax:
  node --check on 7 files, including public/assets/app.js
  PASS — 7 files

Focused Node:
  node --test test/timeline-card-lifecycle.test.js test/search-targets.test.js
  PASS — 21 tests, 0 failures

Focused Wave 1D-A Chromium:
  node --test --test-name-pattern='browser Wave 1D-A M1' e2e/browser.test.js
  PASS — 27 tests, 0 failures

Inherited Wave 1B / Wave 1C controls:
  node --test --test-name-pattern='browser Wave 1C|browser Wave 1B M2 forward late-target navigation' e2e/browser.test.js
  PASS — 13 tests, 0 failures

Full Node:
  npm test
  PASS — 826 tests, 0 failures

Full browser:
  npm run test:browser
  PASS — 190 tests, 0 failures

Release gate:
  npm run release:check
  PASS
  build/currentness: PASS
  release Node: 826 tests, 0 failures
  package smoke: PASS
    Codex: PASS
    Claude Code: PASS
    DeepSeek Harness: PASS
```

No failure was skipped, reclassified, or repaired under M2. No profiling, calibration, evidence export/capture, schema-4 smoke/formal run, or timing gate was executed. / M2 中未 skip、reclassify 或 repair 任何 failure。未执行 profiling、calibration、evidence export／capture、schema-4 smoke／formal run 或 timing gate。

### 35.4 Diff, currentness, and root-writer audits / Diff、currentness 与 root-writer audit

```text
git diff --check:
  PASS

exact candidate path audit:
  PASS — exactly nine accepted paths

mandatory expected-unchanged audit:
  PASS — zero diff

package/workflow/server/query/profiler/highlighter drift:
  NONE

generated-currentness:
  PASS — build:check and release:check

generated hash stability:
  PASS — 325513 bytes / 900f083f...b929e before and after checks
```

Actual source inspection retains exactly three presentation write sites with distinct ownership: / Actual source inspection 保留精确三个 presentation write site，且 ownership 各自独立：

```text
replaceTimelineRoot():
  the only el.timeline.innerHTML writer

commitTimelineAppend():
  the only el.timeline.append writer for eligible keyed Main suffix publication

presentOrdinaryDetailLocally():
  bodies[0].replaceWith(nextBody)
  replaces only the direct .eventBody subtree
```

The ordinary detail path creates no Timeline-root writer and no article replacement. No Wave 1D-B folding/navigation/temporary-owner localization, Code Mode local fanout, dependency graph, virtualization, IntersectionObserver, server/query/cache/index work, generic profiler evolution, or canonical Timeline ownership change entered the diff. / Ordinary detail path 不创建 Timeline-root writer，也不替换 article。Diff 未进入 Wave 1D-B folding／navigation／temporary-owner localization、Code Mode local fanout、dependency graph、virtualization、IntersectionObserver、server／query／cache／index work、generic profiler evolution 或 canonical Timeline ownership change。

### 35.5 Candidate-freeze transaction and stop / Candidate-freeze transaction 与停止点

All M2 validation gates passed. This plan version is included in the one authorized candidate commit together with accepted source/tests, AGENTS registration, and the inspected generated app bundle. A commit cannot embed its own SHA/tree without a circular identity; therefore the authoritative candidate SHA/tree are recorded by the immediate post-freeze read-only verification and M2 handoff report, while this committed plan records the parent, exact envelope, bundle identity, validation totals, and freeze contract. / 全部 M2 validation gate 已通过。本 plan version 将与 accepted source／test、AGENTS registration 与已检查 generated app bundle 一起纳入唯一 authorized candidate commit。Commit 无法在自身内容中嵌入自己的 SHA／tree 而不形成 circular identity；因此 authoritative candidate SHA／tree 由紧随 freeze 的 read-only verification 与 M2 handoff report 记录，而本 committed plan 记录 parent、精确 envelope、bundle identity、validation total 与 freeze contract。

```text
candidate parent / direct target:
  b7ca3bff12fd5061410aaa3483341023498b23d4

candidate commits authorized:
  exactly one; no amend

M2 gates:
  PASS

M3:
  NOT AUTHORIZED / NOT PERFORMED

push / PR / merge / publish / release:
  NOT AUTHORIZED / NOT PERFORMED
```

After the single commit, perform only the read-only post-freeze checks in M2 and stop before M3. / 单次 commit 后，仅执行 M2 的 read-only post-freeze check，并在 M3 前停止。
