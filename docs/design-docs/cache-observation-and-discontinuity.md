# Cache Observation and Discontinuity / 缓存观测与缓存复用中断

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-09-03 / 最近更新：2026-09-03
- Related product spec: `docs/product-specs/session-transcript-analyzer.md` / 相关产品规格：`docs/product-specs/session-transcript-analyzer.md`
- Related timeline design: `docs/design-docs/logical-event-timeline.md` / 相关时间线设计：`docs/design-docs/logical-event-timeline.md`
- Related adapter design: `docs/design-docs/transcript-source-adapters.md` / 相关适配器设计：`docs/design-docs/transcript-source-adapters.md`
- Related lifecycle design: `docs/design-docs/indexed-materialized-session-lifecycle.md` / 相关生命周期设计：`docs/design-docs/indexed-materialized-session-lifecycle.md`
- Related Codex coverage: `docs/design-docs/codex-protocol-event-coverage.md` / 相关 Codex 覆盖：`docs/design-docs/codex-protocol-event-coverage.md`
- Completed execution plan: `docs/exec-plans/completed/2026-09-02-cache-observation-v1.md` / 已完成执行计划：`docs/exec-plans/completed/2026-09-02-cache-observation-v1.md`

## Scope and non-goals / 范围与非目标

Cache Observation is a source-neutral canonical seam for structured token-accounting facts attached to existing Logical Events. Cache Observation v1 has exactly one producer: Codex. Claude Code and DeepSeek Harness produce no observation, but their Materialized Sessions satisfy the same exact empty presentation-index shape. / 缓存观测是一个来源中立的 canonical seam，用于把结构化 token-accounting 事实附着到既有逻辑事件。缓存观测 v1 只有一个 producer：Codex。Claude Code 与 DeepSeek Harness 不产生观测，但它们的 Materialized Session 满足同一个精确的空 presentation-index shape。

V1 does not add project-wide Cache discovery, search or filters, Session-list summaries, analysis-panel metrics, a persisted derived Cache store, expiration or TTL prediction, causal diagnosis, health grading, charts, retention buckets, settings, or additional transcript-source producers. It does not create a Cache Logical Event or duplicate a `token_count` event onto Main. / V1 不增加项目范围 Cache discovery、搜索或筛选、Session 列表摘要、analysis panel 指标、持久化派生 Cache store、过期或 TTL 预测、原因诊断、健康度评级、图表、retention bucket、设置或其它转录来源 producer。它不创建 Cache 逻辑事件，也不把 `token_count` event 复制到 Main。

## Source-neutral observation contract / 来源中立观测契约

An existing owned Protocol event with `subtype === 'token_count'` may own one optional exact `cacheObservation`. Absence remains valid. Main and Raw events cannot own the fact, and its presence changes no Raw Record count, Logical Event count, event identity, `label`, `preview`, `searchText`, Raw Reference, analysis metric, or ProjectQueryStore input. The machine subtype remains `token_count`; “Token usage” is presentation copy only. / 一条既有且自有的 Protocol event 在 `subtype === 'token_count'` 时可以拥有一个可选且精确的 `cacheObservation`。缺少该字段仍然合法。Main 与 Raw event 不能拥有该事实；该字段的存在不会改变 Raw Record 数量、Logical Event 数量、event identity、`label`、`preview`、`searchText`、Raw Reference、analysis metric 或 ProjectQueryStore input。机器 subtype 继续是 `token_count`；“Token usage”只属于呈现文案。

The exact public v1 shape is: / Public v1 的精确 shape 为：

```text
cacheObservation {
  schemaVersion: 1
  inputTokens: non-negative safe integer
  cachedInputTokens: non-negative safe integer
  uncachedInputTokens: non-negative safe integer
  outputTokens: non-negative safe integer | null
  totalTokens: non-negative safe integer | null
  reuseBasisPoints: non-negative safe integer | null
  comparison {
    state: comparison state
    reasonCodes: ordered policy-gate reason codes[]
    previousEventId: string | null
    elapsedMs: non-negative safe integer | null
    previousInputTokens: non-negative safe integer | null
    inputDeltaTokens: safe integer | null
    inputDeltaBasisPoints: safe integer | null
    previousCachedInputTokens: non-negative safe integer | null
    cachedInputDeltaTokens: safe integer | null
    previousReuseBasisPoints: non-negative safe integer | null
  }
}
```

`comparison.state === 'cache_discontinuity'` is the only authoritative discontinuity semantic. The object has no redundant `isDiscontinuity` boolean. Event-local validation proves the exact nested shape, version, arithmetic consistency, vocabulary, nullability, safe-integer bounds, and deterministic reason-code form. Materialized Session validation additionally proves predecessor ownership/order and the ownership and exact inverse of presentation links. / `comparison.state === 'cache_discontinuity'` 是唯一 authoritative 的中断语义。Object 不含冗余的 `isDiscontinuity` boolean。Event-local validation 证明精确 nested shape、version、算术一致性、vocabulary、nullability、safe-integer boundary 与确定性 reason-code form；Materialized Session validation 还会证明 predecessor ownership／order，以及 presentation link 的 ownership 与精确互逆关系。

## Codex accounting extraction and normalization / Codex accounting 提取与归一化

For a Codex `token_count` payload, candidate precedence is exact: / 对 Codex `token_count` payload，candidate precedence 精确如下：

1. `payload.info.last_token_usage`;
2. direct token fields on `payload.info`;
3. direct token fields on `payload`.

A node is selectable only when it owns at least one of `input_tokens`, `cached_input_tokens`, `output_tokens`, or `total_tokens`. Once selected, it is authoritative for that row. Nested `total_token_usage` is cumulative accounting and never substitutes for a missing or incomplete per-request candidate. In particular, a selected `last_token_usage` with incomplete required accounting fails closed rather than falling through to cumulative data or another node. Usage-limit data is not token-accounting evidence. / 一个 node 只有在自身拥有 `input_tokens`、`cached_input_tokens`、`output_tokens` 或 `total_tokens` 至少一个字段时才可被选择；一旦选中，它就是该 row 的权威来源。Nested `total_token_usage` 属于 cumulative accounting，绝不替代缺失或不完整的单次请求 candidate。尤其是，已选中的 `last_token_usage` 若 required accounting 不完整，应 fail closed，而不是 fallback 到累计数据或其它 node。Usage-limit 数据不构成 token-accounting evidence。

`inputTokens` and `cachedInputTokens` are required non-negative safe integers, and cached input cannot exceed input. Missing, malformed, negative, fractional, non-finite, unsafe, or internally impossible required values produce no public observation and form a comparison barrier. Explicit cached input `0` is valid and differs from a missing field. `outputTokens` and `totalTokens` are optional display facts: a missing or malformed optional value independently normalizes to `null` and does not form a barrier. / `inputTokens` 与 `cachedInputTokens` 是必需的非负 safe integer，且 cached input 不能大于 input。Required value 缺失、畸形、为负数、小数、非有限数、不安全整数或内部不可能时，不产生 public observation，并形成 comparison barrier。显式 cached input `0` 有效，且不同于字段缺失。`outputTokens` 与 `totalTokens` 是可选 display fact：缺失或畸形的 optional value 独立归一化为 `null`，不形成 barrier。

All public token values remain validated JavaScript Numbers, while arithmetic that can overflow Number multiplication uses BigInt. Reuse is `trunc(cachedInputTokens * 10_000 / inputTokens)` basis points when input is positive, otherwise `null`. Input delta is `current.inputTokens - previous.inputTokens`; when previous input is positive its percentage is `BigInt(inputDeltaTokens) * 10_000n / BigInt(previous.inputTokens)`, with BigInt division truncating toward zero, otherwise `null`. / 所有 public token value 继续是经过校验的 JavaScript Number；可能使 Number 乘法溢出的算术使用 BigInt。Input 为正时，reuse 等于 `trunc(cachedInputTokens * 10_000 / inputTokens)` basis point，否则为 `null`。Input delta 等于 `current.inputTokens - previous.inputTokens`；previous input 为正时，其百分比使用 `BigInt(inputDeltaTokens) * 10_000n / BigInt(previous.inputTokens)`，由 BigInt 除法向零截断，否则为 `null`。

## Adjacent comparison and v1 policy / 相邻比较与 v1 policy

Valid observations are consumed in physical owned Raw order. A valid observation compares only with the immediately preceding valid observation; a required-invalid or missing token-accounting row clears the predecessor. A valid current observation always becomes the next predecessor, including after a timestamp, model, or compaction comparison boundary. / Valid observation 按自有 Raw 的物理顺序消费。每条 valid observation 只与紧邻的前一条 valid observation 比较；required-invalid 或 missing token-accounting row 会清除 predecessor。Valid current observation 始终成为下一 predecessor，包括当前 edge 位于 timestamp、model 或 compaction comparison boundary 之后的情况。

A pair is a Cache Discontinuity only when all five gates pass: / 只有以下五个 gate 全部通过时，一个 pair 才是缓存复用中断：

| Ordered gate / 有序 gate | Exact predicate / 精确条件 |
| --- | --- |
| Previous cache-read floor / 前次 cache-read 下限 | `previous.cachedInputTokens >= 8_192` |
| Previous reuse floor / 前次 reuse 下限 | `previous.reuseBasisPoints >= 7_500` basis points |
| Comparable input floor / 当前 input 可比下限 | `current.inputTokens * 4 >= previous.inputTokens * 3` |
| Cache-read halving / cache-read 至少减半 | `current.cachedInputTokens * 2 <= previous.cachedInputTokens` |
| Absolute cache-read drop / cache-read 绝对下降 | `previous.cachedInputTokens - current.cachedInputTokens >= 8_192` |

The cross-products use BigInt. Failed-gate reason codes are emitted in the same order: `previous_cache_read_below_minimum`, `previous_reuse_below_minimum`, `current_input_below_comparable_floor`, `current_cache_read_above_half`, `cache_read_drop_below_minimum`. Multiple failures retain that order. `comparable` means only that all comparability guards passed but not all five discontinuity gates passed; it does not assert that server-side cache state remains valid. / Cross-product 使用 BigInt。Failed-gate reason code 按同一顺序产生：`previous_cache_read_below_minimum`、`previous_reuse_below_minimum`、`current_input_below_comparable_floor`、`current_cache_read_above_half`、`cache_read_drop_below_minimum`。多个 failure 保持该顺序。`comparable` 只表示全部 comparability guard 通过但五项 discontinuity gate 未全部通过；它不声称服务端 cache state 仍然有效。

Comparison-state precedence is exact: / Comparison state 的优先级精确如下：

1. `no_previous_observation`;
2. `unknown_or_non_monotonic_timestamp`;
3. `model_change`;
4. `compaction_boundary`;
5. `cache_discontinuity` when every policy gate passes;
6. `comparable` otherwise.

Elapsed time is available only for parseable, strictly increasing timestamps with a safe-integer difference. It is comparison context, never a policy minimum, maximum, expiry signal, or ownership clue; the same token pair classifies identically at short and long elapsed intervals. Two known, different explicit models form `model_change`; one or both unknown models do not block comparison. Codex model evidence comes only from non-empty raw-order `payload.model` values on `session_meta`, `turn_context`, `session_configured`, or the current `token_count`; the latest preceding evidence wins and a token-local value is applied before its comparison. The final Session model is never backfilled. Explicit compaction increments a comparison generation, so an edge across generations is `compaction_boundary`; compaction is not an ordinary discontinuity and does not end turn ownership. / Elapsed 只在 timestamp 可解析、严格递增且差值为 safe integer 时可用。它只是 comparison context，绝不是 policy minimum／maximum、expiry signal 或 ownership clue；同一 token pair 在短、长 elapsed 下 classification 相同。两个已知且不同的显式 model 形成 `model_change`；一侧或两侧 model unknown 不阻断 comparison。Codex model evidence 只来自 `session_meta`、`turn_context`、`session_configured` 或当前 `token_count` 上按 Raw 顺序出现的 non-empty `payload.model`；最近的前序 evidence 胜出，token-local value 在该 token 比较前生效。绝不倒填最终 Session model。显式 compaction 增加 comparison generation，因此跨 generation edge 为 `compaction_boundary`；compaction 不是普通 discontinuity，也不结束 turn ownership。

## Raw-order turn ownership / Raw-order turn ownership

Codex attribution is a deterministic physical-Raw-order reducer with active owner, last closed owner, evidence tier, implicit-owner aliases, and rollback ambiguity. It never uses timestamp proximity. / Codex attribution 是一个确定性的 physical-Raw-order reducer，维护 active owner、last closed owner、evidence tier、implicit-owner alias 与 rollback ambiguity。它绝不使用 timestamp proximity。

- `turn_started`, or canonical `task_started`, with a reliable `turn_id` opens an explicit owner. A new trustworthy explicit start replaces the prior active owner; contradictions fail closed. / 带可靠 `turn_id` 的 `turn_started` 或 canonical `task_started` 开启 explicit owner。新的可信 explicit start 替换先前 active owner；矛盾时 fail closed。
- Without a compatible active explicit owner, a distinct legacy user-message boundary can open an implicit owner. Adjacent `response_item` and `event_msg` mirrors with identical normalized user text share one owner without timestamp matching. / 不存在 compatible active explicit owner 时，不同的 legacy user-message boundary 可以开启 implicit owner。Normalized user text 相同且相邻的 `response_item` 与 `event_msg` mirror 无需 timestamp matching 即共享一个 owner。
- `turn_context.turn_id` corroborates or aliases legacy ownership but is not a general segmentation algorithm. Contradiction with an explicit active owner fails closed. / `turn_context.turn_id` 用于 corroborate 或 alias legacy ownership，但不是通用 segmentation algorithm；与 explicit active owner 矛盾时 fail closed。
- Canonical Raw `turnId` is lower-priority evidence and cannot override an explicit contradiction or clear rollback ambiguity. / Canonical Raw `turnId` 是更低优先级 evidence，不能覆盖 explicit contradiction，也不能清除 rollback ambiguity。
- `turn_complete`, canonical `task_complete`, and `turn_aborted` close the active owner but retain it as the last owner for trailing TokenCount rows until a new trustworthy boundary. / `turn_complete`、canonical `task_complete` 与 `turn_aborted` 关闭 active owner，但会把它保留为 trailing TokenCount row 的 last owner，直到出现新的可信 boundary。
- Compaction leaves ownership active. Rollback clears active and last owners and keeps a fail-closed ambiguity until a new trustworthy lifecycle, user, or context boundary establishes ownership. / Compaction 保持 ownership active。Rollback 清除 active 与 last owner，并保持 fail-closed ambiguity，直到新的可信 lifecycle、user 或 context boundary 建立 ownership。

Evidence tiers are ordered `explicit_lifecycle` > `legacy_turn_context` > `canonical_raw_turn_id` > `implicit_user_turn`. Unknown evidence is not itself a conflict: zero known Raw-ref owners is unknown, one unique known owner plus unknown refs is accepted, and two distinct known owners conflict. Transient attribution outcomes are bounded audit diagnostics and are not retained in `cacheObservation` or exposed to the browser. / Evidence tier 顺序为 `explicit_lifecycle` > `legacy_turn_context` > `canonical_raw_turn_id` > `implicit_user_turn`。Unknown evidence 本身不等于 conflict：零个 known Raw-ref owner 为 unknown，一个唯一 known owner 加 unknown ref 可接受，两个不同 known owner 才冲突。Transient attribution outcome 是有界 audit diagnostic，不保留在 `cacheObservation`，也不暴露给 browser。

## Fork exclusion, Main anchoring, and links / Fork 排除、Main anchoring 与 link

For a proven Materialized Fork, Cache finalization consumes only fork metadata plus child continuation. Inherited-prefix token counts, observations, model state, compaction generations, lifecycle events, and user boundaries cannot become a child predecessor or owner and cannot produce child links. The first valid continuation observation is therefore `no_previous_observation` unless the continuation itself already has an earlier valid owned observation. Exclusion happens before reduction, not by deleting polluted links afterward. / 对已证明的 Materialized Fork，Cache finalization 只消费 fork metadata 与 child continuation。Inherited-prefix token count、observation、model state、compaction generation、lifecycle event 与 user boundary 不能成为 child predecessor 或 owner，也不能产生 child link。因而第一条 valid continuation observation 为 `no_previous_observation`，除非 continuation 自身已有更早的 valid owned observation。排除发生在 reduction 之前，不通过事后删除被污染 link 实现。

Protocol observation ownership comes from the reducer state at the physical token row. Main ownership first accepts an internally valid canonical `event.turnId`; otherwise it collects reconstructed owners from all Raw refs using the unknown-versus-conflict rule above. / Protocol observation ownership 来自物理 token row 位置的 reducer state。Main ownership 首先接受内部有效的 canonical `event.turnId`；否则按上述 unknown／conflict 规则收集全部 Raw ref 的 reconstructed owner。

Only `cache_discontinuity` observations are linked. Within one resolved owner, Protocol discontinuities are sorted by physical Raw order and the first is the primary navigation target. The Main anchor is the same-owner eligible Main event whose latest Raw ref is nearest at or before that first discontinuity; equal Raw order uses later Logical order as the tie-break. One owner produces at most one Main anchor, while its forward list retains every discontinuity ID in Raw order. Unknown/conflicting ownership, unreliable Raw order, no preceding eligible Main event, or anchor ambiguity yields no link. / 只有 `cache_discontinuity` observation 会建立 link。同一 resolved owner 内，Protocol discontinuity 按物理 Raw 顺序排序，第一条是 primary navigation target。Main anchor 是同 owner 且 latest Raw ref 位于第一条 discontinuity 之前或同位并最接近它的 eligible Main event；Raw order 相同时选择 Logical order 更后的 event。一个 owner 最多产生一个 Main anchor，其 forward list 则按 Raw 顺序保留全部 discontinuity ID。Owner unknown／conflict、Raw order 不可靠、没有前序 eligible Main event或 anchor 有歧义时都不建 link。

Every Materialized Session has the exact shape: / 每个 Materialized Session 都具有以下精确 shape：

```text
presentationIndexes {
  codeModeDeclaredRequests: Map
  cacheDiscontinuityLinks {
    protocolEventIdsByMainEventId: Map<MainEventId, ProtocolEventId[]>
    mainEventIdByProtocolEventId: Map<ProtocolEventId, MainEventId>
  }
}
```

The two maps are exact inverses. Forward lists are non-empty, duplicate-free, and strictly Raw ordered; every target is a real owned Protocol `token_count` discontinuity and every key is a real owned Main event. Unsupported sources and Sessions without reliable mappings use both empty maps. Main events are not mutated with Cache semantics and no synthetic event is created. / 两张 map 必须精确互逆。Forward list 非空、无重复且严格按 Raw 排序；每个 target 都是真实且自有的 Protocol `token_count` discontinuity，每个 key 都是真实且自有的 Main event。Unsupported source 与没有可靠 mapping 的 Session 使用两张空 map。Main event 不写入 Cache semantic，也不创建 synthetic event。

## Materialization and residency boundary / Materialization 与 residency 边界

Cache enrichment runs only during complete Codex Materialization, in this order: / Cache enrichment 只在完整 Codex Materialization 中运行，顺序如下：

```text
accepted-prefix parse with explicit bounded seed capture
  -> apply relationship and fork ownership
  -> exclude inherited materialized-fork prefix
  -> base finalizeSession() for counts, analysis, and base indexes
  -> finalizeCodexCacheObservation() over owned Raw history
  -> delete temporary seeds and transient attribution diagnostics
  -> project the public Materialized Session
  -> canonical and private-state validation
  -> fingerprint capture/recheck and query-projection digest equality
  -> Materialized Session cache admission
```

Seed capture defaults off and is enabled only by strict request-time Materialization and the test-only resident complete oracle. Seeds contain bounded scalar identity/model/accounting values rather than payload fragments or a second Raw graph, and they do not survive the adapter call. Relationship Pass A, source-backed Index construction, and ProjectQueryStore projection never capture or consume them. The Index retains no `cacheObservation`, Cache presentation graph, or owner diagnostics. / Seed capture 默认关闭，只由 strict request-time Materialization 与 test-only resident complete oracle 启用。Seed 只含有界 scalar identity／model／accounting value，不含 payload fragment 或第二份 Raw graph，并且不会在 adapter call 结束后保留。Relationship Pass A、source-backed Index construction 与 ProjectQueryStore projection 永不 capture 或消费它们。Index 不保留 `cacheObservation`、Cache presentation graph 或 owner diagnostic。

ProjectQueryStore remains schema version `2`, and its projection digest domain remains `project-query-projection-v1`. Materialized query projection must equal the committed Index projection exactly. Cache presentation therefore cannot rewrite canonical `token_count` label, preview, search text, or any other packed-query input. / ProjectQueryStore 继续使用 schema version `2`，projection digest domain 继续是 `project-query-projection-v1`。Materialized query projection 必须与 committed Index projection 精确相等。因此 Cache presentation 不能改写 canonical `token_count` label、preview、search text 或其它 packed-query input。

The existing `estimateMaterializedSessionBytes(indexedSession)` is a deterministic O(1) cache-weight proxy derived before Materialization from Indexed Session bytes and Raw/Logical counts. It is not a heap-size estimator and Cache v1 does not change it, the Indexed Session shape, Pass A, or prewarm admission. Cache facts are nevertheless owned, reused, evicted, cancelled, and retired with the same Materialized Session: concurrent cold callers coalesce, a same-revision warm hit performs no parse/seed/reducer/finalizer work, cancellation cannot admit a partial object, and revision replacement cannot reuse an old enriched object. Forced-GC acceptance separately characterizes actual retained memory. / 既有 `estimateMaterializedSessionBytes(indexedSession)` 是一个 Materialization 前根据 Indexed Session byte 与 Raw／Logical count 派生的 deterministic O(1) cache-weight proxy，不是 heap-size estimator。Cache v1 不修改该 estimator、Indexed Session shape、Pass A 或 prewarm admission。Cache fact 仍与同一个 Materialized Session 一起被 ownership、reuse、evict、cancel 与 retire：并发 cold caller 会合并；同 revision warm hit 不再执行 parse／seed／reducer／finalizer；cancellation 不能 admission partial object；revision replacement 不能复用旧 enriched object。Forced-GC acceptance 会独立刻画 actual retained memory。

## Timeline, detail, and navigation responsibility / Timeline、detail 与导航职责

Session-level Logical DTO projection merges shared Cache presentation facts with adapter-specific presentation facts without a browser source branch. Raw has no Cache presentation fact. The bounded DTO shapes are: / Session-level Logical DTO projection 会把 shared Cache presentation fact 与 adapter-specific presentation fact 合并，browser 无 source branch。Raw 不含 Cache presentation fact。有界 DTO shape 如下：

```js
// Protocol token_count with a valid observation
presentationFacts.cacheUsage = {
  inputTokens,
  cachedInputTokens,
  reuseBasisPoints,
  outputTokens,
  discontinuity: null | {
    elapsedMs,
    previousCachedInputTokens,
  },
  mainContextEventId: string | null,
};

// Reliable Main anchor
presentationFacts.cacheDiscontinuityLink = {
  protocolEventId,
  count,
};
```

The timeline fact omits the full observation, reason codes, prior-input values, deltas, and owner diagnostics. A valid ordinary Protocol card uses a quiet Token usage label and compact Input/Cached/reuse/optional Output line. Only a non-null discontinuity projection adds the informational marker and one compact elapsed/cache-read transition. Normal reuse receives no success badge, and a discontinuity is not styled as a failure. / Timeline fact 省略完整 observation、reason code、previous-input value、delta 与 owner diagnostic。普通 valid Protocol card 使用低噪声 Token usage label，以及紧凑的 Input／Cached／reuse／可选 Output line。只有 non-null discontinuity projection 才增加 informational marker 与一条紧凑 elapsed／cache-read transition。普通复用不显示 success badge，中断也不使用 failure style。

Selected-event detail reads the validated `cacheObservation`; it never reparses or reclassifies Raw accounting. Existing structured renderers present Primary Token Usage and Supplemental Comparison Context. The latter can include elapsed, previous→current input, absolute and basis-point input delta, previous→current cached input, cache-read delta, previous→current reuse, and neutral comparison-state copy. `no_previous_observation` does not create an empty comparison section. Existing Usage Limits stay separate. / Selected-event detail 读取已验证的 `cacheObservation`，绝不重新解析或分类 Raw accounting。既有 structured renderer 展示 Primary Token Usage 与 Supplemental Comparison Context。后者可包含 elapsed、previous→current input、absolute／basis-point input delta、previous→current cached input、cache-read delta、previous→current reuse 与中性的 comparison-state copy。`no_previous_observation` 不创建空 comparison section。既有 Usage Limits 保持独立。

Only an inferred discontinuity shows this fixed notice: / 只有 inferred discontinuity 显示以下固定 notice：

> This cache discontinuity is inferred from adjacent token accounting; the transcript does not provide explicit cache-expiry evidence.

> 该缓存复用中断由相邻的 token accounting 推断；转录中没有提供显式的缓存过期证据。

This negative statement is the only expiry wording owned by the feature. No UI or documentation may turn elapsed, model, compaction, or a policy result into an expiration or causal claim. / 该否定式说明是本 feature 唯一拥有的 expiry 文案。任何 UI 或文档都不得把 elapsed、model、compaction 或 policy result 转化为过期或因果断言。

Main renders one lightweight aggregated affordance inside the real anchor card. Main → Protocol uses the validated first Protocol ID; Protocol → Main exists only with the validated reverse ID. Both directions use the existing layer-aware exact-event envelope, request-generation safety, pagination, and temporary reveal, never browser-side turn/timestamp reconstruction. A reveal does not alter canonical membership, counts, offsets, filters, or saved folding preferences. Ordinary cross-layer filters keep existing behavior; the global layer contract clears Main-only `codeModeRequest` before Protocol or Raw requests and does not restore it on return. / Main 在真实 anchor card 内渲染一个轻量聚合 affordance。Main → Protocol 使用已验证的第一条 Protocol ID；Protocol → Main 只在存在已验证 reverse ID 时出现。两个方向都复用既有 layer-aware exact-event envelope、request-generation safety、分页与 temporary reveal，绝不在 browser 侧重建 turn／timestamp。Reveal 不改变 canonical membership、count、offset、filter 或已保存 folding preference。普通跨 layer filter 沿用既有行为；全局 layer contract 会在 Protocol 或 Raw request 前清除仅适用于 Main 的 `codeModeRequest`，返回时也不恢复它。

## Extension rules for future transcript sources / 未来转录来源扩展规则

Source-neutral shape does not imply source-neutral evidence. A future producer must independently establish the meaning and precedence of its per-request accounting, required/optional field validity, model/context boundaries, compaction or equivalent lifecycle, owner reconstruction, fork/inherited-history exclusion, Main anchoring, real-corpus behavior, performance, and language constraints. It must use empty facts when those claims cannot be proved, and it must not mechanically reuse the Codex reducer or add a browser `sourceKind` branch. / 来源中立 shape 不代表 evidence 来源中立。未来 producer 必须独立建立其单次请求 accounting 的含义与 precedence、required／optional field validity、model／context boundary、compaction 或等价 lifecycle、owner reconstruction、fork／inherited-history exclusion、Main anchoring、真实语料行为、性能与文案约束。无法证明这些 claim 时必须使用 empty fact，且不得机械复用 Codex reducer或增加 browser `sourceKind` branch。

## Alternatives considered / 已考虑的备选方案

- Create a synthetic Cache Logical Event or copy Token usage onto Main: rejected because it changes event identity/counts and makes presentation look like source history. / 创建 synthetic Cache Logical Event 或把 Token usage 复制到 Main：拒绝，因为这会改变 event identity／count，并让 presentation 看起来像 source history。
- Keep a demo-style server sidecar map: rejected because it bypasses canonical Materialized ownership, validation, fork exclusion, fingerprinting, and cache lifecycle. / 保留 demo 风格 server sidecar map：拒绝，因为它绕过 canonical Materialized ownership、validation、fork exclusion、fingerprint 与 cache lifecycle。
- Store Cache facts in ProjectQueryStore or Indexed Sessions: rejected because v1 has no project-scope Cache behavior and such storage would expand every index candidate and threaten the Pass-A boundary. / 把 Cache fact 存入 ProjectQueryStore 或 Indexed Session：拒绝，因为 v1 没有 project-scope Cache behavior，这种存储会扩大每个 index candidate 并威胁 Pass-A boundary。
- Map Main and Protocol events by timestamp proximity: rejected because lifecycle evidence is available and ambiguous ownership must fail closed. / 通过 timestamp proximity 映射 Main／Protocol event：拒绝，因为已有 lifecycle evidence，且 ambiguous ownership 必须 fail closed。

## Risks and validation / 风险与验证

The main risks are upstream accounting-shape drift, overclaiming internal cache state, wrong-turn mapping, inherited-fork leakage, duplicate retained graphs, and accidental expansion of indexing or project-query work. Exact shape validation, fail-closed extraction/ownership, real-event links, owned-only reduction, source-shaped fixtures, and Pass-A/ProjectQueryStore invariants contain those risks. / 主要风险是上游 accounting shape 漂移、过度声称内部 cache state、wrong-turn mapping、inherited-fork 泄漏、重复 retained graph，以及意外扩大 indexing／project-query work。Exact shape validation、fail-closed extraction／ownership、real-event link、owned-only reduction、source-shaped fixture 与 Pass-A／ProjectQueryStore invariant 用于约束这些风险。

Acceptance covered synthetic boundary fixtures, an independent frozen prototype oracle over a sealed real Codex corpus, deterministic owner spot checks, quiet-session browser checks, representative and high-density materialization performance, forced-GC retained-memory characterization, cache-owner lifecycle, and full build/unit/browser/package gates. Detailed aggregate counts and timings remain in the completed execution plan; they are evidence, not product guarantees. / Acceptance 覆盖 synthetic boundary fixture、在 sealed 真实 Codex corpus 上运行的独立冻结 prototype oracle、确定性 owner 抽查、quiet-session browser 检查、representative／high-density materialization performance、forced-GC retained-memory characterization、cache-owner lifecycle，以及完整 build／unit／browser／package gate。详细 aggregate count 与 timing 保留在 completed execution plan 中；它们属于 evidence，不是产品保证。

## Decision log / 决策日志

- 2026-09-03: Accepted Codex Cache Observation v1 as Materialized-Session-only enrichment with an optional Protocol fact, presentation-only Main links, conservative adjacent-accounting inference, and no Index or ProjectQueryStore expansion. / 2026-09-03：接受 Codex 缓存观测 v1：只在 Materialized Session 中 enrichment，使用 optional Protocol fact 与 presentation-only Main link，采用保守的相邻 accounting inference，且不扩展 Index 或 ProjectQueryStore。
