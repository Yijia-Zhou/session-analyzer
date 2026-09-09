# Codex Cache Observation v1 productionization / Codex Cache Observation v1 正式产品化

## Status, authority, and review boundary / 状态、权威基线与评审边界

- Status: M0 through M4 were formally accepted by 2026-09-03, and M5 documentation/release closeout is complete pending final feature review. No commit, integration, publication, or release was performed or authorized. / 状态：截至 2026-09-03，M0 至 M4 均已正式 accepted；M5 documentation／release closeout 已完成，等待最终 feature review。未执行或授权 commit、integration、publication 或 release。
- Production worktree: `G:\vibe\session-analyzer\tmp\worktrees\cache-observation-production`; branch: `feature/cache-observation-v1`. / Production worktree：`G:\vibe\session-analyzer\tmp\worktrees\cache-observation-production`；分支：`feature/cache-observation-v1`。
- Production baseline: `origin/towards-0.2.0` at `66462708c4a2fa184f7b22054c53a87692ea1c24`. The fetched remote matched the expected SHA exactly. / Production baseline：`origin/towards-0.2.0` 的 `66462708c4a2fa184f7b22054c53a87692ea1c24`；fetch 后远端与预期 SHA 完全一致。
- The product authority for this work is, in order: the validated disposable prototype behavior, the architecture at the baseline above, and the explicit scope in the productionization request. Earlier Cache plans are not requirements or design authority. / 本工作的产品权威基线依次是：已验证的 disposable prototype 行为、上述 baseline 的现行架构，以及本次 productionization 请求明确冻结的 scope。任何旧 Cache 计划都不是需求或设计权威。
- The main checkout and `cache-observation-demo` worktree remain read-only references. Do not merge, cherry-pick, or mechanically copy the demo branch. / 主 checkout 与 `cache-observation-demo` worktree 继续仅作为只读参考；不得 merge、cherry-pick 或机械复制 demo branch。
- Every milestone ends at an explicit review boundary. Do not begin the next milestone until the preceding milestone is accepted. M2 ends with the Codex Materialized-Session producer, ownership/links, and lifecycle/performance proof; it contains no Timeline, Inspector, browser, or other M3 presentation work. / 每个 milestone 都在明确的评审边界停止；前一 milestone 未获接受前不得开始下一 milestone。M2 以 Codex Materialized-Session producer、ownership／link 与 lifecycle／performance proof 为终点，不包含 Timeline、Inspector、browser 或其它 M3 presentation 工作。

## M0 baseline record / M0 baseline 记录

| Item / 项目 | Result / 结果 |
| --- | --- |
| Main checkout safety / 主 checkout 安全性 | Clean `git status --short` before adding the worktree; main HEAD `7a18de7c07d64dd74172d4548205b5c24cc09682`; no main-checkout file was changed. / 创建 worktree 前 `git status --short` 为空；main HEAD 为 `7a18de7c07d64dd74172d4548205b5c24cc09682`；未修改主 checkout 文件。 |
| Worktree identity / Worktree 身份 | Root `G:/vibe/session-analyzer/tmp/worktrees/cache-observation-production`; branch `feature/cache-observation-v1`; HEAD `66462708c4a2fa184f7b22054c53a87692ea1c24`. |
| Runtime / 运行时 | Node `v24.18.1`; npm `12.0.2`. |
| Build / 构建 | `npm run build:check` passed; generated client assets were current. / 通过；生成的客户端产物保持最新。 |
| Unit/integration / 单元与集成 | `npm test`: 860 tests, 860 passed, 0 failed. / 860 项全部通过。 |
| Browser / 浏览器 | `npm run test:browser`: 190 tests, 190 passed, 0 failed. / 190 项全部通过。 |
| Package / 包验证 | `npm run test:package` passed for packaged Codex, Claude Code, and DeepSeek Harness startup/indexing. / 打包后的三种 source 启动与索引 smoke 均通过。 |
| Project query schema / Project query schema | `PROJECT_QUERY_STORE_SCHEMA_VERSION = 2`. |
| Projection digest domain / Projection digest domain | `project-query-projection-v1`. |
| Baseline status / Baseline 状态 | Clean before this plan was created. `node_modules` was installed from the lockfile only because the package test reads a worktree-local Highlight.js license path; it is ignored and changed no tracked file. / 创建本计划前工作区 clean。由于 package test 明确读取 worktree-local Highlight.js license，按 lockfile 执行了一次 `npm ci`；`node_modules` 被忽略，未改变 tracked 文件。 |

The first unit run, before worktree-local dependencies existed, produced 859 passes and one infrastructure-only `ENOENT` for `node_modules/highlight.js/LICENSE`. After `npm ci`, the complete suite passed 860/860. This prerequisite failure is not a source baseline failure and must not be hidden from the M0 record. / 首次 unit run 在 worktree-local dependency 不存在时得到 859 pass 与一个仅由环境导致的 `node_modules/highlight.js/LICENSE` `ENOENT`。执行 `npm ci` 后完整 860/860 通过。该 prerequisite failure 不是 source baseline failure，但不得从 M0 记录中省略。

The prototype-focused command `node --test test/cache-observation-demo.test.js` was also run read-only in the demo worktree and passed 17/17. It is prototype characterization evidence, not part of the production baseline count. / 还在 demo worktree 中只读执行了 prototype focused command `node --test test/cache-observation-demo.test.js`，17/17 通过；它属于 prototype characterization evidence，不计入 production baseline。

## M0 review acceptance and amendments / M0 review 接受结论与修订

The M0 review accepted the overall architecture: Codex is the only v1 producer; enrichment is owned request-time Materialized-Session work; relationship Pass A and ProjectQueryStore remain unchanged; `token_count` owns the optional Protocol fact; Main association is presentation-only; `presentationIndexes.cacheDiscontinuityLinks` is the preferred link seam; unsupported sources emit the uniform empty shape; no Logical Event, analysis metric, summary, project search, or threshold change is introduced. / M0 review 接受总体架构：Codex 是 v1 唯一 producer；enrichment 属于 request-time owned Materialized Session；relationship Pass A 与 ProjectQueryStore 不变；`token_count` 持有 optional Protocol fact；Main association 仅属于 presentation；`presentationIndexes.cacheDiscontinuityLinks` 是首选 link seam；unsupported source 产生统一 empty shape；不新增 Logical Event、analysis metric、summary、project search 或 threshold 变更。

The review also froze these amendments before M1 implementation: / Review 还在 M1 实现前冻结以下修订：

1. Public `cacheObservation` does not contain `isDiscontinuity`. The sole authoritative semantic is `comparison.state === 'cache_discontinuity'`; booleans needed by DTO/rendering are derived at projection time. / Public `cacheObservation` 不含 `isDiscontinuity`；唯一 authoritative semantic 是 `comparison.state === 'cache_discontinuity'`，DTO／rendering 所需 boolean 在 projection 时派生。
2. Cache presentation must not modify canonical `token_count` `label`, `preview`, `searchText`, or any other ProjectQueryStore/projection-digest input. “Token usage”, compact Input/Cached/Output copy, markers, and comparison summaries are Timeline/Detail DTO or renderer presentation only. Materialized project-query projection digests must remain exactly equal to the committed Index. / Cache presentation 不得修改 canonical `token_count` 的 `label`、`preview`、`searchText` 或任何 ProjectQueryStore／projection-digest input。“Token usage”、紧凑 Input／Cached／Output copy、marker 与 comparison summary 全部属于 Timeline／Detail DTO 或 renderer presentation。Materialized project-query projection digest 必须与 committed Index 完全相等。
3. M3 should generalize the existing Materialized-Session event presentation projection to `presentationFactsForEvent(session, eventId)` for all Logical layers without changing `projectQueryPresentation`: Main combines existing Code Mode facts with cache forward-link facts; Protocol exposes cache reverse-link facts; Raw and unsupported sources return empty/null. A detail-envelope reverse link is allowed only if later code audit proves it materially smaller while preserving validated-index ownership, no semantic embedding, no browser reconstruction, and no browser `sourceKind` branch. / M3 首选把既有 Materialized-Session event presentation projection 泛化为适用于全部 Logical layer 的 `presentationFactsForEvent(session, eventId)`，且不改变 `projectQueryPresentation`：Main 合并既有 Code Mode fact 与 cache forward-link fact；Protocol 暴露 cache reverse-link fact；Raw 与 unsupported source 返回 empty／null。只有后续 code audit 证明 Detail-envelope reverse link 明显更小时才可采用该备选，且必须保持 validated-index ownership、不嵌入 semantic、browser 不重建 association、browser 无 `sourceKind` branch。
4. Prototype code establishes the exact input-delta machine rule: `inputDeltaTokens = current.inputTokens - previous.inputTokens`; when previous input is positive, `inputDeltaBasisPoints = Number((BigInt(inputDeltaTokens) * 10_000n) / BigInt(previous.inputTokens))`, using BigInt division’s truncation toward zero; otherwise it is `null`. No JS floating-point rounding is permitted. / Prototype code 已建立精确 input-delta machine rule：`inputDeltaTokens = current.inputTokens - previous.inputTokens`；previous input 为正时，`inputDeltaBasisPoints = Number((BigInt(inputDeltaTokens) * 10_000n) / BigInt(previous.inputTokens))`，使用 BigInt 除法向零截断；否则为 `null`。禁止 JS floating-point rounding。
5. The prototype’s final code makes validity depend on required input/cache fields only: malformed or missing optional output/total fields independently normalize to `null`. The focused suite does not separately name malformed optionals, but the exported extraction/calculation code is unambiguous. M1 therefore preserves this behavior rather than adding a new barrier semantic. Required input/cache failures remain invalid/barriers, and the production normalization contract additionally rejects cached input greater than input as specified by the M1 acceptance matrix. / Prototype 最终代码只让 required input／cache field 决定 validity：malformed 或 missing optional output／total field 独立 normalize 为 `null`。Focused suite 未单独命名 malformed optional case，但 exported extraction／calculation code 含义明确。因此 M1 保持该行为，不新增 barrier semantic。Required input／cache failure 继续 invalid／barrier；production normalization contract 还按 M1 acceptance matrix 拒绝 cached input 大于 input。

## M1 implementation record / M1 实现记录

M1 added only the pure shared domain/canonical seam and its tests. There is no Codex extraction, seed capture, owner reducer, Main anchor, non-empty production link, Timeline/Inspector/server change, relationship Pass-A change, or ProjectQueryStore implementation change. / M1 只增加纯 shared domain／canonical seam 与对应测试；未实现 Codex extraction、seed capture、owner reducer、Main anchor、production non-empty link、Timeline／Inspector／server 变更、relationship Pass A 变更或 ProjectQueryStore implementation 变更。

### Frozen M1 machine vocabulary / M1 冻结 machine vocabulary

The canonical public comparison-state vocabulary and precedence are exactly: / Canonical public comparison-state vocabulary 与 precedence 精确为：

1. `no_previous_observation`;
2. `unknown_or_non_monotonic_timestamp`;
3. `model_change`;
4. `compaction_boundary`;
5. `cache_discontinuity` when all policy gates pass;
6. `comparable` otherwise.

Prototype-only `missing_token_accounting` is not a production public comparison state. Invalid required accounting produces no `cacheObservation` and exposes only transient normalization failure codes to its caller. / Prototype-only 的 `missing_token_accounting` 不是 production public comparison state；required accounting invalid 时不创建 `cacheObservation`，只向 caller 返回 transient normalization failure code。

Transient normalization failure codes have this exact deterministic order: / Transient normalization failure code 的精确确定性顺序为：

1. `missing_input_tokens`;
2. `invalid_input_tokens`;
3. `missing_cached_input_tokens`;
4. `invalid_cached_input_tokens`;
5. `cached_input_exceeds_input`.

Canonical `comparison.reasonCodes` contains only failed v1 policy gates, in this exact order: / Canonical `comparison.reasonCodes` 只包含失败的 v1 policy gate，精确顺序为：

1. `previous_cache_read_below_minimum`;
2. `previous_reuse_below_minimum`;
3. `current_input_below_comparable_floor`;
4. `current_cache_read_above_half`;
5. `cache_read_drop_below_minimum`.

`comparable` requires the exact non-empty ordered subset of failed gates. `cache_discontinuity` and every non-comparable state require an empty reason list because their state already expresses the outcome; there is deliberately no duplicate non-comparable reason-code vocabulary. `comparison.state === 'cache_discontinuity'` remains the sole discontinuity truth and `isDiscontinuity` is forbidden by exact-shape validation. / `comparable` 必须携带精确、非空且有序的 failed-gate subset。`cache_discontinuity` 与每个 non-comparable state 的 reason list 必须为空，因为 state 已充分表达结果；有意不另设冗余 non-comparable reason-code vocabulary。`comparison.state === 'cache_discontinuity'` 继续是唯一 discontinuity truth，exact-shape validation 禁止 `isDiscontinuity`。

### Frozen arithmetic and normalization / 冻结算术与 normalization

- `reuseBasisPoints = floor(cachedInputTokens * 10_000 / inputTokens)` for positive input, using BigInt; valid zero/zero yields `null`.
- `inputDeltaTokens = current.inputTokens - previous.inputTokens`.
- `inputDeltaBasisPoints = Number((BigInt(current.inputTokens) - BigInt(previous.inputTokens)) * 10_000n / BigInt(previous.inputTokens))` for positive previous input, with BigInt division truncating toward zero; zero previous input or an out-of-safe-range public result yields `null`.
- Every classifier cross multiplication uses BigInt while all public numeric values remain validated safe-integer Numbers or `null`.
- Required `inputTokens` and `cachedInputTokens` alone determine observation validity; missing/malformed required values or cached input greater than input produce no fact. Optional `outputTokens` and `totalTokens` independently degrade to `null`, matching the final prototype extraction/calculation authority rather than introducing a new comparison barrier. / Required field 决定 observation validity；optional field 独立降为 `null`，不新增 comparison barrier。

### Canonical responsibility split / Canonical validation 职责划分

Event-local validation owns the exact versioned nested shape, safe integer/null boundaries, normalized input/cache/reuse consistency, exact state/reason vocabulary, derived delta consistency, and the rule that only a Protocol `token_count` event may own the optional fact. Absence remains valid. / Event-local validation 负责 exact versioned nested shape、safe integer／null boundary、normalized input／cache／reuse consistency、exact state／reason vocabulary、derived delta consistency，以及只有 Protocol `token_count` 可持有 optional fact；字段缺席继续合法。

Materialized-Session validation owns facts requiring the complete event graph: `previousEventId` must resolve to an earlier owned cache-observed Protocol `token_count` event and the retained previous values must match it; presentation maps must use owned Main/discontinuity Protocol targets, strict Raw order, unique Protocol ownership, exact forward/reverse inversion, plain Maps without custom properties/accessors, and exact top/nested keys. / Materialized-Session validation 负责需要完整 event graph 的事实：`previousEventId` 必须指向 raw order 更早的 owned cache-observed Protocol `token_count`，previous value 必须一致；presentation map 必须满足 owned Main／discontinuity Protocol target、strict Raw order、Protocol 唯一归属、forward／reverse 精确互逆、plain Map 无 custom property／accessor，以及 top／nested exact keys。

The shared empty constructor now yields exactly: / Shared empty constructor 精确产生：

```text
presentationIndexes {
  codeModeDeclaredRequests: Map()
  cacheDiscontinuityLinks {
    protocolEventIdsByMainEventId: Map()
    mainEventIdByProtocolEventId: Map()
  }
}
```

Codex composes its existing Code Mode index over that constructor; Claude Code initializes and resets materialized-fork presentation state with it; DeepSeek Harness initializes with it. Synthetic tests accept the same empty shape for all three source kinds, and source/package integration exercises all three production finalizers. / Codex 在 shared constructor 上组合既有 Code Mode index；Claude Code 用它初始化并重置 materialized-fork presentation state；DeepSeek Harness 用它初始化。Synthetic test 对三个 source kind 接受同一 empty shape，source／package integration 覆盖三个 production finalizer。

### M1 invariants and validation evidence / M1 invariant 与验证证据

- `src/project-query-store.js`, relationship Pass A, server, browser, detail, i18n, and analysis code are unchanged.
- `PROJECT_QUERY_STORE_SCHEMA_VERSION` remains `2`; the digest domain remains exactly `project-query-projection-v1`; empty cache presentation indexes preserve fixture projection rows/digests and canonical `token_count` `label`/`preview`/`searchText`.
- Empty cache shapes take the ordinary fast path: canonical validation does not construct cache-specific Logical/Raw lookup Maps unless a previous-observation reference or a non-empty link map exists. / Empty cache shape 走 ordinary fast path；除非存在 previous-observation reference 或 non-empty link map，否则 canonical validation 不构造 cache-specific Logical／Raw lookup Map。
- `src/cache-observation.js` is in the explicit npm `files` allowlist and exact pack-manifest oracle; packaged Codex, Claude Code, and DeepSeek Harness startup/indexing smoke all passed.
- Focused domain/canonical/query/materialization invariants: 79 tests, 79 passed, 0 failed.
- Focused source-finalizer/search/package-manifest integration: 127 tests, 127 passed, 0 failed.
- `npm run build:check`: passed; generated browser assets remained current.
- `npm test`: 886 tests, 886 passed, 0 failed.
- `npm run test:package`: passed for all three sources.
- `git diff --check`: passed; separate no-index checks for the three untracked new files emitted no whitespace-error diagnostics (their exit status only reports that each file differs from the empty input).
- The full browser suite was not repeated because M1 changed no browser source or shared browser-bundle consumer; `build:check` and the browser-related unit tests inside `npm test` passed. / M1 未修改 browser source 或 shared browser-bundle consumer，因此未形式化重复 full browser suite；`build:check` 与 `npm test` 中 browser-related unit test 均通过。
- M1 review accepted this exact domain/canonical contract without reopening its vocabulary, arithmetic, optional-field behavior, empty-index shape, or ProjectQueryStore boundary. It authorized only the M2 Codex materialization producer and explicitly left all presentation work for a later review. / M1 review 接受上述 exact domain／canonical contract，不重新讨论 vocabulary、arithmetic、optional-field behavior、empty-index shape 或 ProjectQueryStore boundary；仅授权 M2 Codex materialization producer，所有 presentation 工作继续留待后续评审。

## M2 implementation record / M2 实现记录

M2 adds `src/codex-cache-observation.js` as a Codex-only producer. It owns source extraction, bounded seed validation, raw-order model/compaction state, turn-owner reconstruction, Protocol token association, comparison application, Main-owner resolution, nearest-preceding anchoring, and bidirectional link construction. It imports every normalized arithmetic/classification decision from `src/cache-observation.js`; it does not duplicate thresholds, delta math, state, or public reason vocabulary. / M2 新增 Codex-only producer `src/codex-cache-observation.js`，负责 source extraction、bounded seed validation、raw-order model／compaction state、turn-owner reconstruction、Protocol token association、comparison application、Main-owner resolution、nearest-preceding anchoring与双向 link 构造；所有 normalized arithmetic／classification 均从 `src/cache-observation.js` 导入，不复制 threshold、delta math、state 或 public reason vocabulary。

### Exact extraction and temporary seeds / 精确 extraction 与临时 seed

The exact token-accounting candidate precedence is: an `info.last_token_usage` object that owns at least one token field, then direct own token fields on `info`, then direct own token fields on the payload. The selectable fields are exactly `input_tokens`, `cached_input_tokens`, `output_tokens`, and `total_tokens`. Nested `total_token_usage` is cumulative accounting and is never selected. A selected candidate with missing/malformed required input or cached input fails closed, emits no public fact, and clears the predecessor; explicit cached zero remains valid; malformed/missing output or total independently becomes `null`. / Token-accounting candidate 的精确 precedence 是：自身拥有至少一个 token field 的 `info.last_token_usage` object、`info` 上的 direct own token field、payload 上的 direct own token field。可选字段只有 `input_tokens`、`cached_input_tokens`、`output_tokens`、`total_tokens`。Nested `total_token_usage` 属于 cumulative accounting，永不被选中。已选 candidate 的 required input／cached input missing 或 malformed 时 fail closed、不产生 public fact 并清除 predecessor；explicit cached zero 保持有效；output／total missing 或 malformed 独立变为 `null`。

The temporary seed exact shape is: / 临时 seed exact shape 为：

```text
{
  rawId: string,
  model: string,
  accountingSource: 'info.last_token_usage' | 'info' | 'payload' | 'missing' | null,
  candidate: {
    inputTokens?: safe integer | null,
    cachedInputTokens?: safe integer | null,
    outputTokens?: safe integer | null,
    totalTokens?: safe integer | null
  } | null
}
```

Only model-evidence and `token_count` rows create seeds. Existing compact Raw owns timestamp, physical order, lifecycle/canonical type, turn ID, role, message text, and source identity, so seeds do not duplicate them. Seeds retain no parsed payload, transcript object, preview/search text, arbitrary fragment, event graph, path, or debug content. The parse option defaults off; strict request-time materialization and the test-only complete resident oracle opt in explicitly. The seed array is deleted in `finally` before the Materialized object leaves the adapter. / 只有 model-evidence 与 `token_count` row 创建 seed。既有 compact Raw 已持有 timestamp、physical order、lifecycle／canonical type、turn ID、role、message text 与 source identity，因此 seed 不重复这些内容；seed 不保留 parsed payload、transcript object、preview／search text、arbitrary fragment、event graph、path 或 debug content。Parse option 默认关闭，只有 strict request-time materialization 与 test-only complete resident oracle 显式启用；seed array 在 Materialized object 离开 adapter 前由 `finally` 删除。

### Actual model, ownership, and attribution contract / 实际 model、ownership 与 attribution contract

Model state accepts only non-empty raw-order `payload.model` evidence from `session_meta`, `turn_context`, `session_configured`, or the current `token_count`. The latest preceding reliable value wins, and token-local model evidence is applied before comparing that token. No final Session model is backfilled, no UI/provider label is inferred, and one/both unknown models do not block comparison; only two known different values yield `model_change`. / Model state 只接受 `session_meta`、`turn_context`、`session_configured` 或当前 `token_count` 的 non-empty raw-order `payload.model` evidence。最近的前序可靠值胜出，token-local model evidence 在比较该 token 前生效。不倒填最终 Session model，不从 UI／provider label 推断；一侧或两侧 unknown 不阻断 comparison，只有两个 known 且不同的值产生 `model_change`。

The owner reducer maintains active owner, last closed owner, evidence tier, aliases for implicit legacy ownership, and rollback ambiguity. `turn_started`/canonical `task_started` with `turn_id` opens `explicit_lifecycle`; a distinct legacy user boundary opens `implicit_user_turn`; adjacent response-item/event-message mirrors with identical normalized message text share one implicit owner without timestamp matching; `turn_context.turn_id` corroborates or aliases an implicit owner as `legacy_turn_context` and conflicts fail closed; a canonical Raw turn ID is lower-priority `canonical_raw_turn_id` evidence and cannot clear rollback ambiguity. Completion/abort closes active ownership but preserves last owner for trailing rows; compaction changes comparison generation without closing the turn; rollback clears active/last ownership until a trustworthy lifecycle/user/context boundary re-establishes it. No timestamp fallback exists. / Owner reducer 维护 active owner、last closed owner、evidence tier、implicit legacy alias 与 rollback ambiguity。带 `turn_id` 的 `turn_started`／canonical `task_started` 开启 `explicit_lifecycle`；distinct legacy user boundary 开启 `implicit_user_turn`；normalized message text 相同且相邻的 response-item／event-message mirror 共享一个 implicit owner，不使用 timestamp matching；`turn_context.turn_id` 以 `legacy_turn_context` corroborate／alias implicit owner，冲突 fail closed；canonical Raw turn ID 是更低优先级 `canonical_raw_turn_id` evidence，且不能清除 rollback ambiguity。Completion／abort 关闭 active ownership但保留 last owner给 trailing row；compaction 只改变 comparison generation，不结束 turn；rollback 清除 active／last owner，直到可信 lifecycle／user／context boundary 重建 owner。不存在 timestamp fallback。

The bounded transient audit vocabulary is `explicit_lifecycle`, `legacy_turn_context`, `canonical_raw_turn_id`, `implicit_user_turn`, plus attribution outcomes `mapped`, `unknown_owner`, `conflicting_raw_ref_owners`, `rollback_boundary`, `conflicting_turn_context`, `conflicting_turn_completion`, `completion_without_active_turn`, `ambiguous_token_event`, `missing_token_seed`, `invalid_token_accounting`, `unknown_protocol_raw_order`, `duplicate_protocol_raw_order`, `no_main_event_for_owner`, and `no_main_anchor_before_discontinuity`. The existing materialization observer receives one `codex_cache_finalization_summary` event with only scalar totals and closed count objects, separated into discontinuity evidence tiers, producer barriers, Main-association outcomes, and per-discontinuity link outcomes. Source-level tests reject Session/path/model/content leakage. These diagnostics are never retained in `cacheObservation`, the browser, or public APIs. / Bounded transient audit vocabulary 如上。既有 materialization observer 接收一个 `codex_cache_finalization_summary` event，只含 scalar total 与 closed count object，并分别记录 discontinuity evidence tier、producer barrier、Main-association outcome 与 per-discontinuity link outcome；source-level test 拒绝 Session／path／model／content 泄漏。这些 diagnostic 永不保留在 `cacheObservation`、browser 或 public API。

Protocol ownership comes from the reconstructed owner at the token row, not timestamp or a convenient Logical field. Main ownership first accepts an internally valid canonical `event.turnId`; otherwise it collects reconstructed owners across Raw refs, accepts one known owner plus unknown refs, and rejects two different known owners or an explicit ambiguity. For each owner with real discontinuities, Protocol events are strictly physical-Raw ordered; the first is the navigation primary target; the anchor is the eligible same-owner Main event whose latest Raw ref is nearest at or before that first discontinuity, with later Logical order as the equal-Raw tie-break. One owner creates at most one Main entry, all same-owner discontinuity IDs remain ordered, and every unknown/conflict/no-preceding-anchor case emits no link. / Protocol ownership 来自 token row 位置的 reconstructed owner，不使用 timestamp 或方便的 Logical field。Main ownership 先接受 internally valid canonical `event.turnId`；否则收集 Raw ref 的 reconstructed owner，one known owner + unknown ref 可接受，两个不同 known owner 或 explicit ambiguity 被拒绝。每个含真实 discontinuity 的 owner 内，Protocol event 按 physical Raw 严格排序；第一条是 navigation primary target；anchor 选择同 owner、latest Raw ref 位于第一条 discontinuity 之前或同位且最近的 Main event，equal-Raw 时以更后 Logical order 决胜。每个 owner 最多一个 Main entry，全部同 owner discontinuity ID 保持有序；unknown／conflict／无前序 anchor 一律不建 link。

### Actual materialization seam and hard boundaries / 实际 materialization seam 与 hard boundary

The production order is now: complete accepted-prefix parse with explicit seed capture; apply existing relationship/fork evidence; remove the inherited materialized-fork Logical prefix and establish exact Raw segments; run existing `finalizeSession()` for counts/analysis/base indexes; run `finalizeCodexCacheObservation()` over owned Raw only; delete seeds; project the carried public Materialized Session; then let the existing source-adapter boundary perform canonical/private validation, fingerprint capture/recheck, committed query-projection digest equality, and weighted-owner admission. Cache facts therefore cannot change base counts/analysis/query inputs and are naturally covered by the existing whole-Session fingerprint and weighted admission. / Production 实际顺序为：complete accepted-prefix parse 并显式 capture seed；应用既有 relationship／fork evidence；删除 inherited materialized-fork Logical prefix并建立 exact Raw segment；运行既有 `finalizeSession()` 构造 count／analysis／base index；只对 owned Raw 运行 `finalizeCodexCacheObservation()`；删除 seed；投影 carried public Materialized Session；再由既有 source-adapter boundary 执行 canonical／private validation、fingerprint capture／recheck、committed query-projection digest equality与 weighted-owner admission。因此 Cache fact 无法改变 base count／analysis／query input，并自然受既有 whole-Session fingerprint 与 weighted admission 约束。

For a materialized fork, reducer input is exactly fork metadata plus continuation; `inherited_context` Raw rows and their token/model/compaction/lifecycle/user evidence never enter predecessor, owner, generation, anchor, or link state. The first valid continuation token is `no_previous_observation` unless an earlier valid owned continuation token exists. The strict source-backed path and resident complete oracle invoke the same finalizer after their existing ownership seam and have exact fact/link parity in source-level tests. / Materialized fork 的 reducer input 精确为 fork metadata + continuation；`inherited_context` Raw row 及其 token／model／compaction／lifecycle／user evidence 永不进入 predecessor、owner、generation、anchor 或 link state。第一条 valid continuation token 为 `no_previous_observation`，除非 continuation 自身已有更早 valid owned token。Strict source-backed path 与 resident complete oracle 在各自既有 ownership seam 后调用同一 finalizer，source-level test 证明 fact／link exact parity。

### M2 structural and preliminary performance evidence / M2 结构与 preliminary 性能证据

- Source-backed Index and relationship Pass A never opt into seed capture. Indexed Sessions retain no Raw/Logical/presentation graph; relationship evidence rejects cache seeds/facts/links and token-accounting fields. Existing exact relationship fixtures retain their LIGHT/FULL decisions and verification counts (`8/6` hybrid versus `0/14` forced-full with `30` verifications; all-ordinary `3/0` versus `0/3` with `6` verifications), including two cycle prerequisite parses and fourteen final parses in the comprehensive fixture. / Source-backed Index 与 Pass A 永不 opt in seed capture；Indexed Session 不保留 Raw／Logical／presentation graph；relationship evidence 明确拒绝 cache seed／fact／link 与 token-accounting field。既有 exact fixture 保持上述 LIGHT／FULL 与 verification count。
- A real-fact source fixture preserves every Raw ID and every Logical event except the sole optional fact, including token `id`/`kind`/`subtype`/`layer`/`rawRefs`/`label`/`preview`/`searchText`. Its Materialized projection digest equals the committed Indexed digest. Rebuilding packed ProjectQueryStore from base and enriched Sessions yields deep-equal schema-2 stores and identical accounted bytes; `src/project-query-store.js` and `project-query-projection-v1` remain unchanged. / Real-fact source fixture 保持全部 Raw ID 与除 sole optional fact 外的全部 Logical event，包括 token 的上述字段；Materialized projection digest 与 committed Indexed digest 相等；base／enriched Session 重建的 packed schema-2 ProjectQueryStore deep-equal 且 accounted bytes 相同；implementation 与 digest domain 不变。
- The revision-scoped owner coalesces concurrent cold requests into one parse/seed/reducer/finalizer, returns exact object identity on a later warm hit with zero additional observer event, and admits the enriched Session through the existing estimate. Focused tests also prove normal LRU eviction rematerializes, cancellation admits nothing, and revision retirement prevents reuse by the replacement owner. / Revision-scoped owner 合并 concurrent cold request；later warm hit 返回 exact object identity 且无新增 observer event；enriched Session 通过既有 estimate admission。Focused test 还证明普通 LRU eviction 会 rematerialize、cancellation 不 admission、revision retirement 阻止 replacement owner 复用旧对象。
- The preliminary selector is committed as `sealed-generated-codex-v1`: a fixed content-free ordinary-size Codex shape with 97 Raw records, 16 turns, 32 valid observations, one discontinuity/link, and no reported identity/path/model/content. Each of 24 fresh pair processes uses balanced ABBA/BAAB order, two independent cold owners per mode, and the per-mode mean as one pair sample; BASE is the identical strict path with only the test-only producer toggle disabled. Every cold owner still performs a real source read, verification, canonical/fingerprint path, and weighted admission. / Preliminary selector 固定为 content-free ordinary-size Codex shape；24 个 fresh pair process 使用 balanced ABBA／BAAB，每个 mode 两个 independent cold owner并以均值形成一个 pair sample；BASE 是同一 strict path，仅通过 test-only toggle 关闭 producer。每个 cold owner 仍执行真实 source read、verification、canonical／fingerprint path 与 weighted admission。
- On Node `v24.18.1`, the final 24-pair preliminary run produced BASE cold median/p95/max `37.938/40.748/41.770 ms` and CANDIDATE `42.828/46.911/51.479 ms`. Paired delta median was `5.201 ms` (`13.71%` of BASE median), below the 10 ms conjunct; paired delta p95 was `15.540 ms` (`38.14%` of BASE p95), below the 50 ms conjunct. Every materialization used one source read and one verification; BASE used zero seed/reducer/finalizer invocations and CANDIDATE exactly one each. Both retained `170,200` estimated bytes. CANDIDATE warm same-revision median/p95/max was `0.0322/0.0424/0.0427 ms` with zero additional adapter call or observer event. / 最终 24-pair preliminary 结果与 conjunctive guardrail 如上。
- Initial M2 profiling introduced a shared fingerprint-walker optimization, but M2R proved it was a general all-source materialization improvement rather than Cache semantic work and removed it completely from this feature diff. Cache facts remain fully covered by the unchanged baseline whole-graph fingerprint contract. Cache reason-code validation retains its exact bounded dense-array path, and policy comparison avoids duplicate validation only after the same domain validator has accepted normalized values. / 初始 M2 profile 曾引入 shared fingerprint-walker 优化；M2R 证明它属于全 source 的通用 materialization 优化而非 Cache semantic 工作，因此已从本 feature diff 完全撤回。Cache fact 继续完整进入未修改的 baseline whole-graph fingerprint contract。Cache reason-code validation 保留 exact bounded dense-array path；policy comparison 只在同一 domain validator 已接受 normalized value 后省略重复 validation。

These pre-M2R numbers are implementation-review evidence, not a product SLA or M4 acceptance. The 1,153-Raw/192-turn/384-observation result—BASE `268.428/276.660/280.513 ms`, CANDIDATE `299.529/309.347/317.426 ms`, paired median `+35.699 ms / +13.30%`—triggered M2R and must not be described as non-gating. It is superseded for the final feature diff by the M2R attribution/correction record below; M4 must still repeat balanced measurements on its sealed selector. / 这些 pre-M2R 数字只是 implementation-review evidence，不是 SLA 或 M4 acceptance。1,153 Raw／192 turn／384 observation 的上述结果触发了 M2R，不得称为 non-gating；最终 feature diff 的结果以随后 M2R attribution／correction record 为准，M4 仍须在 sealed selector 上重复 balanced measurement。

### M2 validation record / M2 验证记录

- Focused domain/canonical/Codex source/fork/Pass-A/query/source-adapter matrix: `145` tests, `145` passed, `0` failed. / Focused matrix 145／145。
- `npm run build:check`: passed; generated browser assets remained current and no browser source was changed. / 通过；generated browser asset 保持 current，且未修改 browser source。
- `npm test`: `908` tests, `908` passed, `0` failed. This includes Codex, Claude Code, DeepSeek Harness, strict materialization mutation/cancellation, server, query, and browser-module unit/integration coverage. / Full unit／integration 908／908。
- `npm run test:package`: passed for packaged Codex, Claude Code, and DeepSeek Harness startup/indexing; both new runtime modules are in the explicit npm `files` allowlist and exact manifest oracle. / 三 source package smoke 通过；两个新增 runtime module 已进入显式 npm `files` allowlist 与 exact manifest oracle。
- `git diff --check`: passed for tracked changes; separate `--no-index --check` runs for all six untracked M1/M2 files emitted no whitespace-error diagnostics. LF→CRLF notices reflect the existing Windows checkout policy and are not whitespace failures. / Tracked diff check 与六个 untracked file 的 separate check 均无 whitespace error；LF→CRLF notice 属于既有 Windows checkout policy。
- The full browser E2E suite was not rerun because M2 changed no browser, browser-bundled shared module, server timeline/detail DTO, style, or i18n source. Browser presentation remains exclusively M3. / 未重跑 full browser E2E，因为 M2 未修改 browser、browser-bundled shared module、server timeline／detail DTO、style 或 i18n；browser presentation 完全留在 M3。
- No commit, push, publish, merge, cherry-pick, ProjectQueryStore implementation change, or demo/main-checkout mutation occurred. / 未执行 commit、push、publish、merge、cherry-pick、ProjectQueryStore implementation 变更，也未修改 demo／main checkout。

## M2R review amendment and pre-change fingerprint record / M2R review 修订与改动前 fingerprint 记录

The M2 review provisionally accepted semantic/lifecycle behavior but rejected treating the 384-observation stress point as non-gating. Its paired median regression was `+35.699 ms / +13.30%`, exceeding both accepted median conjuncts (`+10 ms` and `+10%`). M2 therefore remains unaccepted and M2R addresses only performance attribution/correction. Classifier, extraction, owner, fork, anchor, link, UI, Index, Pass A, and ProjectQueryStore contracts stay frozen. / M2 review provisional 接受 semantic／lifecycle，但拒绝把 384-observation stress 视为 non-gating；其 paired median regression `+35.699 ms / +13.30%` 同时超过已接受的 `+10 ms` 与 `+10%`。因此 M2 仍未 accepted，M2R 只处理 performance attribution／correction；其它 semantic 与 architecture contract 保持冻结。

### Why `src/source-adapters.js` changed in M2 / M2 为什么修改 `src/source-adapters.js`

M2 introduced `createFingerprintWriter()` plus the async property-task/operation-accounting refactor only after profiling showed that retained cache facts enlarged the exact whole-Session graph traversed by three existing fingerprint operations: private-validator capture, private-validator recheck, and post-projection recheck. A representative pre-refactor 192-turn diagnostic run reported BASE/CANDIDATE total cold `735.578/815.642 ms`; private validation `433.146/471.176 ms`; final fingerprint recheck `220.292/242.101 ms`; while the cache finalizer itself was `12.549 ms`. This identified repeated fingerprint traversal as the largest observed hotspot, not a cache-classifier or owner-reducer bug. The refactor buffered identical SHA byte writes, represented each property descriptor as one async walker task, preserved approximate cancellation operation accounting, and added bounded encoded-segment reuse. It was a shared materialization optimization, not Cache semantic correctness work, and it affects Codex, Claude, and DSH. / M2 只有在 profile 显示 retained cache fact 扩大三次既有 whole-Session fingerprint traversal 后，才引入 `createFingerprintWriter()` 与 async property-task／operation-accounting refactor。一个 pre-refactor 192-turn diagnostic 的 BASE／CANDIDATE total cold 为 `735.578/815.642 ms`，private validation 为 `433.146/471.176 ms`，final fingerprint recheck 为 `220.292/242.101 ms`，而 cache finalizer 自身为 `12.549 ms`；因此最大 observed hotspot 是重复 fingerprint traversal，而不是 classifier／owner reducer。该改动属于 shared materialization optimization，不是 Cache semantic correctness 所必需，并影响 Codex、Claude 与 DSH。

### Existing before/after snapshots are not attribution evidence / 现有前后快照不能作为归因证据

Before M2R, the available measurements used different runner revisions and therefore must not be subtracted as if they formed four quadrants: / M2R 前已有 measurement 使用不同 runner revision，不能直接相减冒充四象限：

- Original fingerprint, separate fresh processes, ordinary 32-observation snapshot: BASE/CANDIDATE median `150.675/170.706 ms`.
- Original fingerprint, separate fresh processes, 384-observation snapshot: BASE/CANDIDATE median `723.439/800.077 ms`.
- Optimized fingerprint, final balanced ABBA/BAAB runner, ordinary 32-observation snapshot: BASE/CANDIDATE median `37.938/42.828 ms`.
- Optimized fingerprint, final balanced ABBA/BAAB runner, 384-observation snapshot: BASE/CANDIDATE median `268.428/299.529 ms`.

These values establish why the refactor exists but mix Cache effect, shared fingerprint effect, runner warm-up/order, and general Node noise. M2R must produce A/B/C/D under one runner: A=no Cache+original fingerprint, B=Cache+original fingerprint, C=no Cache+optimized fingerprint, D=Cache+optimized fingerprint. Any temporary runtime switch/reference implementation is test/profile-only and must be removed before M2R review. / 这些数值只说明 refactor 的来源，却混合 Cache effect、shared fingerprint effect、runner warm-up／order 与 Node noise。M2R 必须在同一 runner 下得到 A／B／C／D；任何临时 runtime switch／reference implementation 都只能存在于 test／profile，且必须在 M2R review 前删除。

## M2R performance attribution and correction record / M2R 性能归因与修正记录

M2R used the same 24-pair balanced ABBA/BAAB fresh-process runner for all four quadrants. The ordinary selector has 97 Raw records and 32 observations; the stress selector has 1,153 Raw records and 384 observations. Values below are milliseconds; paired deltas are calculated within each fresh pair, not by subtracting independent medians. / M2R 对四个象限使用同一个 24-pair balanced ABBA／BAAB fresh-process runner。Ordinary selector 含 97 Raw／32 observations；stress selector 含 1,153 Raw／384 observations。下表单位为毫秒；paired delta 在每个 fresh pair 内计算，不用独立 median 相减。

| Selector / 选择器 | A no Cache + original | B Cache + original | B−A paired median | C no Cache + optimized | D Cache + optimized | D−C paired median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary median / 普通 median | 75.758 | 83.141 | 9.335 (12.32%) | 33.988 | 39.744 | 7.005 (20.61%) |
| Ordinary p95 / 普通 p95 | 79.484 | 87.889 | 15.549 (19.56%) | 37.244 | 43.504 | 13.656 (36.67%) |
| Stress median / 压力 median | 725.394 | 796.370 | 69.131 (9.53%) | 273.452 | 305.801 | 28.500 (10.42%) |
| Stress p95 / 压力 p95 | 760.347 | 812.729 | 94.883 (12.48%) | 292.849 | 315.642 | 53.947 (18.42%) |

This isolates two facts. First, buffered writes/property tasks were a large general optimization even without Cache: the no-Cache median fell about 55% for ordinary and 62% for stress, so the change materially affects every source using the shared fingerprint path. Second, it reduced Cache’s incremental cost but still left the optimized 384 stress blocked. It therefore was neither Cache correctness work nor sufficient Cache-specific remediation. `src/source-adapters.js` was restored byte-semantically to the production baseline; the temporary profile switch/reference path was removed, and the final feature diff contains no fingerprint implementation change. Any future adoption must be reviewed as independent cross-source performance work. / 这隔离出两个事实：第一，即使没有 Cache，buffered write／property task 也分别让 ordinary 与 stress 的 no-Cache median 下降约 55%／62%，因此它是影响全部 source 的通用优化；第二，它虽降低 Cache 增量，却仍未让 optimized 384 stress 通过。故该改动既非 Cache correctness 所需，也不足以构成 Cache-specific 修复。`src/source-adapters.js` 已按 production baseline 恢复，临时 profile switch／reference path 已删除，最终 feature diff 不含 fingerprint implementation 变更；未来如采用，应作为独立 cross-source performance work 评审。

### Phase attribution / 分阶段归因

The observer now distinguishes source stream/record parsing, seed capture, relationship application, base finalization, Cache finalization and owner reduction, canonical validation, both private-validation fingerprint passes, project-query projection, final fingerprint recheck, and admission. Seed time is a subset of record-parse time; owner reduction is a subset of Cache finalization; private capture/recheck are subsets of private validation. These nested rows must not be summed twice. Weight estimation is the existing O(1) Indexed-count estimate; a 100,000-call profile measured about `0.000043 ms` per call and BASE/CANDIDATE retained estimates remain identical. / Observer 现可分别观测 source stream／record parse、seed capture、relationship application、base finalize、Cache finalizer／owner reduction、canonical validation、private-validation 的两次 fingerprint、project-query projection、最终 fingerprint recheck 与 admission。Seed 属于 record parse 子阶段，owner reduction 属于 Cache finalizer 子阶段，private capture／recheck 属于 private validation 子阶段，不能重复相加。Weight estimation 继续使用既有 O(1) Indexed-count estimate；十万次 profile 约为每次 `0.000043 ms`，BASE／CANDIDATE retained estimate 保持相同。

| Paired-median phase / paired-median 阶段 | Optimized-fingerprint stress attribution | Final original-fingerprint stress | Final ordinary |
| --- | ---: | ---: | ---: |
| Source record parse / source record 解析 | +3.252 | +2.679 | +0.695 |
| Seed capture (parse subset) / seed capture（parse 子集） | +1.800 | +1.773 | +0.422 |
| Relationship application / relationship 应用 | −0.005 | −0.002 | −0.003 |
| Base `finalizeSession()` | +0.020 | −0.078 | −0.058 |
| Cache finalizer / Cache finalizer | +7.295 | +6.065 | +1.755 |
| Owner reduction (finalizer subset) / owner reduction（finalizer 子集） | — | +1.824 | +0.460 |
| Canonical Materialized validation / canonical validation | +6.272 | +5.247 | +0.934 |
| Private validation including two fingerprints / 含两次 fingerprint 的 private validation | +11.305 | +35.764 | +4.291 |
| Project-query projection / project-query projection | +0.727 | +0.897 | +0.051 |
| Post-projection fingerprint recheck / projection 后 fingerprint recheck | +5.530 | +14.947 | +1.834 |
| Final admission check / 最终 admission check | ≈0 | ≈0 | ≈0 |
| Total cold materialization / cold materialization 总计 | +31.811 | +60.881 | +7.296 |

The original `+35.699 ms` blocker is therefore not an extraction or relationship regression. With the optimized walker used only for attribution, roughly 3.3 ms came from parse/seed work, 7.3 ms from the complete Cache finalizer, 6.3 ms from canonical cache validation, about 16.8 ms from the three existing whole-graph fingerprint traversals, under 1 ms from projection, and the remainder from paired-run noise/scheduling. Under the restored baseline walker, expanded public-object fingerprint traversal is the dominant absolute slope, while classifier/finalizer and canonical validation remain bounded linear work. / 原 `+35.699 ms` blocker并非 extraction 或 relationship regression。仅在归因阶段使用 optimized walker 时，约 3.3 ms 来自 parse／seed、7.3 ms 来自完整 Cache finalizer、6.3 ms 来自 canonical cache validation、约 16.8 ms 来自三次既有 whole-graph fingerprint traversal、不到 1 ms 来自 projection，其余属于 paired-run noise／scheduling。恢复 baseline walker 后，新增 public object 的 fingerprint traversal 成为主要绝对斜率；classifier／finalizer 与 canonical validation 仍是有界线性工作。

### Feature-specific correction / Feature-specific 修正

M2R changed no public fact, threshold, owner rule, fork rule, link rule, Index, Pass A, ProjectQueryStore, or UI behavior. It made only measured feature-path corrections: / M2R 未修改 public fact、threshold、owner／fork／link rule、Index、Pass A、ProjectQueryStore 或 UI；只做以下经测量的 feature-path 修正：

- Codex finalization builds the token/Main Logical lookup in one preparation pass instead of constructing a separate Logical-order map and rescanning all Logical events; link construction reuses those indexed Main entries and one Raw-order lookup. / Codex finalizer 在一个准备 pass 中构造 token／Main Logical lookup，不再另建 Logical-order map 并重复扫描全部 Logical event；link construction 复用 indexed Main entry 与单一 Raw-order lookup。
- Quiet Sessions still produce every valid observation but skip owner reduction and Main-link reconstruction when there is no discontinuity; the empty canonical link shape remains exact. / 无 discontinuity 的 quiet Session 仍产生全部 valid observation，但跳过不需要的 owner reduction／Main-link reconstruction；empty canonical link shape 保持精确。
- Materialized canonical validation reuses one Logical lookup and one cache-only Raw-ordinal lookup for `previousEventId` and bidirectional-link checks. Empty-link/no-observation sources do not build the cache Raw-ordinal lookup. / Materialized canonical validation 对 `previousEventId` 与双向 link validation 复用一个 Logical lookup 与一个仅 Cache Session 构造的 Raw-ordinal lookup；empty-link／no-observation source 不构造 cache Raw-ordinal lookup。

### Observation-density scaling and real-corpus context / Observation density scaling 与真实语料背景

The final repository-default/original-fingerprint curve holds the synthetic shape fixed at 1,153 Raw records and 384 physical `token_count` positions; only the number of valid retained observations changes. Non-critical points use eight balanced fresh pairs; the fixed-shape 32 point uses 16, and 384 uses 24. P95 at eight pairs is diagnostic only; the 32/384 critical points have the larger samples shown. / Final repository-default／original-fingerprint curve 固定 1,153 Raw 与 384 个 physical `token_count` position，只改变 valid retained observation 数。非关键档使用 8 个 balanced fresh pair，固定-shape 32 档使用 16 个，384 档使用 24 个；8-pair p95 仅作诊断，32／384 关键档采用更大样本。

| Valid observations | BASE median | CANDIDATE median | Paired median delta | Relative | Delta/observation diagnostic | Paired p95 delta |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 688.067 | 686.063 | −3.557 | −0.52% | — | 24.125 |
| 16 | 677.373 | 695.549 | 13.902 | 2.05% | 0.869 | 30.355 |
| 32 | 689.829 | 705.721 | 11.324 | 1.64% | 0.354 | 31.337 |
| 64 | 691.614 | 709.166 | 20.793 | 3.01% | 0.325 | 37.389 |
| 128 | 697.873 | 727.312 | 28.459 | 4.08% | 0.222 | 39.778 |
| 256 | 704.428 | 746.244 | 49.067 | 6.97% | 0.192 | 80.950 |
| 384 | 694.571 | 761.742 | 63.162 | 9.09% | 0.164 | 84.986 |

The curve is monotonic within run noise after the fixed-cost low-density region and shows no threshold blow-up; amortized delta per observation declines as fixed parse/finalizer work is spread across more facts. It is diagnostic, not a product SLA. / 除低 density 固定成本区的 run noise 外，curve 单调增长且无阈值式爆发；随着固定 parse／finalizer 成本被更多 fact 摊薄，per-observation amortized delta 下降。该曲线只作诊断，不是产品 SLA。

An aggregate-only audit then selected the latest 115 Sessions (stable updated-descending order) from 614 Indexed Codex Sessions in the current local project corpus and strict-materialized all 115 successfully. It emitted no path, Session/event identity, title, model, or transcript content. Type-7 quantiles were: / Aggregate-only audit 从当前本地项目 corpus 的 614 个 Indexed Codex Session 中按稳定 updated-descending 顺序选择最近 115 个，115 个全部 strict-materialize 成功；未输出 path、Session／event identity、title、model 或 transcript content。Type-7 quantile 如下：

| Aggregate / 聚合 | Min | Median | P75 | P90 | P95 | P99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Protocol `token_count` | 1 | 45 | 91.5 | 253.0 | 417.1 | 863.04 | 1,539 |
| Valid cache observations | 0 | 45 | 91.5 | 253.0 | 417.1 | 863.04 | 1,539 |
| Raw records | 10 | 273 | 676.5 | 1,900.2 | 3,053 | 6,346.74 | 10,398 |

Raw-record/observation Pearson correlation was `0.9956`. The 384-observation stress point is therefore high but plausible—between this corpus P90 and P95—not an out-of-corpus extreme. M2R did not relax or reinterpret the guardrail. / Raw-record／observation Pearson correlation 为 `0.9956`。384-observation stress 位于该 corpus P90 与 P95 之间，属于 high-but-plausible，而不是超出 corpus 的极端值；M2R 未放宽或重新解释 guardrail。

### Final M2R performance gate / 最终 M2R 性能 gate

On Node `v24.18.1`, after removing the shared fingerprint refactor and applying only feature-specific corrections: / 在 Node `v24.18.1` 上，撤回 shared fingerprint refactor、仅应用 feature-specific correction 后：

- Ordinary 24-pair selector: BASE median/p95/max `71.215/75.999/77.939 ms`; CANDIDATE `79.715/83.623/83.699 ms`; paired median `+7.988 ms` (`11.22%`) and p95 `+15.441 ms` (`20.32%`). Median is not blocked because the absolute conjunct is below 10 ms; p95 is not blocked because the absolute conjunct is below 50 ms. / Ordinary selector 的两个 gate 均未同时满足 blocking conjunct。
- Stress 24-pair selector: BASE median/p95/max `694.571/712.607/713.459 ms`; CANDIDATE `761.742/772.592/779.465 ms`; paired median `+63.162 ms` (`9.09%`) and p95 `+84.986 ms` (`11.93%`). Median and p95 are not blocked because their percentage conjuncts remain below 10% and 15%, respectively. / Stress selector 的 median／p95 percentage conjunct 分别低于 10%／15%，因此均不 blocking。
- Every cold run used one source read and one verification; BASE had zero seed/owner/finalizer invocations and CANDIDATE one each when the synthetic discontinuity required ownership. Stress BASE/CANDIDATE retained estimates were both `1,978,256` bytes. Candidate warm same-revision median was about `0.031 ms`, with zero additional adapter call, source read, seed capture, owner reduction, finalization, or observer event. / 每次 cold run 均为一次 source read／verification；有 synthetic discontinuity 时 CANDIDATE 各执行一次 seed／owner／finalizer，BASE 为零。Stress BASE／CANDIDATE retained estimate 同为 `1,978,256` bytes。Candidate warm same-revision median 约 `0.031 ms`，无新增 adapter call、source read、seed capture、owner reduction、finalization 或 observer event。

Both accepted conjunctive guardrails now pass without changing their definitions and without exempting canonical validation, fingerprinting, projection checks, or weight/admission. These measurements remain implementation-review evidence, not SLA or a replacement for M4 sealed-corpus acceptance. M2R stops here for human performance review and does not authorize M3. / 两条已接受 conjunctive guardrail 均在未修改定义、未豁免 canonical validation／fingerprint／projection check／weight admission 的情况下通过。这些数据仍只是 implementation-review evidence，不是 SLA，也不替代 M4 sealed-corpus acceptance。M2R 在此停止等待人工 performance review，不授权 M3。

### M2/M2R review acceptance and cache-weight correction / M2／M2R review 接受与 cache-weight 修正

The 2026-09-03 review formally accepted M2 and M2R and authorized M3. It also corrected one plan description: `estimateMaterializedSessionBytes(indexedSession)` is a deterministic O(1) pre-materialization cache-weight proxy derived only from `indexedSession.bytes`, `rawEventCount`, and `logicalEventCount`. It is not an actual heap-size estimator for the Materialized Session graph. BASE and CANDIDATE estimates remaining equal is therefore expected architecture behavior, not a missing post-materialization Cache accounting step. / 2026-09-03 review 正式接受 M2／M2R 并授权 M3，同时修正一项计划描述：`estimateMaterializedSessionBytes(indexedSession)` 是只由 `indexedSession.bytes`、`rawEventCount` 与 `logicalEventCount` 派生的 deterministic O(1) pre-materialization cache-weight proxy，并非 Materialized Session object graph 的实际 heap-size estimator。因此 BASE／CANDIDATE estimate 相同是现有架构的预期行为，不是遗漏了 post-materialization Cache accounting。

Cache Observation does not change IndexedSession shape, relationship Pass A, the materialized-session-owner estimator, or the prewarm admission model. Enriched facts remain governed by the same revision-scoped Materialized Session owner, coalescing, eviction, cancellation, and replacement lifecycle. M4 must measure aggregate actual retained-memory deltas after forced GC for representative and high-density Sessions. If that evidence exposes a material memory regression, stop for an independent cache-policy review; do not enlarge the Index or Pass A to compensate. / Cache Observation 不修改 IndexedSession shape、relationship Pass A、materialized-session-owner estimator 或 prewarm admission model。Enriched fact 继续受同一个 revision-scoped Materialized Session owner 的 coalescing／eviction／cancellation／replacement lifecycle 管理。M4 必须对 representative 与 high-density Session 测量 forced-GC 后的 aggregate actual retained-memory delta；若发现 material memory regression，应停止并进入独立 cache-policy review，不得通过扩大 Index 或 Pass A 补偿。

### M2R validation record / M2R 验证记录

- Focused domain/canonical/Codex source/fork/Pass-A/query/server matrix: `147` tests, `147` passed, `0` failed. This includes the new quiet-session fast-path characterization. / Focused matrix 147／147，含新增 quiet-session fast-path characterization。
- `npm run build:check`: passed; generated browser assets are current. / 通过；generated browser asset 保持 current。
- `npm test`: `909` tests, `909` passed, `0` failed. / Full unit／integration 909／909。
- `npm run test:package`: passed for packaged Codex, Claude Code, and DeepSeek Harness. / 三 source package smoke 通过。
- `git diff --check`: passed for tracked changes; separate no-index checks for all seven untracked plan/profile/domain/test files emitted only expected LF→CRLF checkout notices and no whitespace-error diagnostic. / Tracked diff check 通过；七个 untracked file 的 no-index check 只有预期 LF→CRLF notice，无 whitespace error。
- `src/source-adapters.js` worktree and baseline blobs both hash to `00a4a3f3235228fa2758107b5758166460fb1ee1`; its semantic diff is empty. / `src/source-adapters.js` worktree／baseline blob hash 完全相同，semantic diff 为空。
- The aggregate corpus audit strict-materialized 115/115 selected Sessions with zero failures and emitted only closed aggregate output. / Aggregate corpus audit 对选中 Session strict-materialize 115／115、零失败，且只输出 closed aggregate。
- M2R changed no browser/shared client source, server Timeline/Detail DTO, style, or i18n, so full browser E2E was not rerun. / M2R 未修改 browser／shared client source、server Timeline／Detail DTO、style 或 i18n，因此未重跑 full browser E2E。
- No commit, push, publish, merge, cherry-pick, ProjectQueryStore implementation change, or demo/main-checkout mutation occurred. / 未执行 commit、push、publish、merge、cherry-pick、ProjectQueryStore implementation 变更，也未修改 demo／main checkout。

## M3 implementation record / M3 实现记录

M3 projects the accepted Materialized-Session facts into the validated prototype UX without changing classifier, extraction, ownership, fork, link, event identity, ProjectQueryStore, Pass A, analysis, or project-search semantics. Browser code contains no Codex/source-kind cache branch. At the M3 review boundary, M4 had not yet started; the later M4 evidence is recorded separately below. / M3 将已接受的 Materialized-Session fact 投影为 prototype 已验证 UX；未改变 classifier、extraction、ownership、fork、link、event identity、ProjectQueryStore、Pass A、analysis 或 project-search semantic。Browser 不含 Codex／source-kind cache branch。M3 review boundary 当时尚未开始 M4；后续 M4 evidence 在下方单独记录。

### Presentation projection and DTO boundary / Presentation projection 与 DTO 边界

The new source-neutral `src/cache-observation-presentation.js` owns bounded timeline facts, exact display arithmetic, comparison-state copy, structured detail sections, and the fixed inference notice. `src/session-query.js` now projects shared cache facts for every Logical layer and merges them with the existing adapter-specific facts. Main therefore keeps existing Code Mode presentation while gaining an optional forward link; Protocol gains usage and reverse-link facts; Raw gains nothing. The project-query path is unchanged and does not invoke this projection. / 新增 source-neutral `src/cache-observation-presentation.js`，负责 bounded timeline fact、精确 display arithmetic、comparison-state copy、structured detail section 与固定 inference notice。`src/session-query.js` 对所有 Logical layer 投影 shared cache fact，并与既有 adapter-specific fact 合并：Main 保留 Code Mode presentation 并可获得 forward link，Protocol 获得 usage／reverse link，Raw 不获得 fact；project-query path 不变且不调用该 projection。

The exact list/event DTO facts are: / List／event DTO 的 exact fact 为：

```js
// Existing Protocol token_count with a valid observation
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
  protocolEventId, // first discontinuity in validated raw order
  count,
};
```

The list DTO never contains full `cacheObservation`, reason codes, previous input/delta detail, or transient owner diagnostics. Human “Token usage” copy, compact metrics, the marker, and comparison text are projection/rendering only; canonical `token_count` `label`, `preview`, and `searchText` remain unchanged. / List DTO 绝不包含完整 `cacheObservation`、reason code、previous input／delta detail 或 transient owner diagnostic。“Token usage”、紧凑 metric、marker 与 comparison text 只属于 projection／rendering；canonical `token_count` 的 `label`、`preview`、`searchText` 保持不变。

### Timeline and detail behavior / Timeline 与 detail 行为

- A valid ordinary Protocol observation renders a quiet human label “Token usage” / “Token 使用情况” and a compact Input · Cached (reuse when defined) · Output line. Explicit cached zero remains visible; zero/zero reuse and missing output are omitted rather than invented; ordinary reuse has no success badge. Invalid accounting retains baseline `token_count` presentation. / 普通 valid Protocol observation 使用低噪声人类标签与紧凑 metric；explicit cached zero 可见，zero／zero reuse 与 missing output 不伪造，普通 reuse 无 success badge；invalid accounting 保持 baseline presentation。
- Only a projected non-null discontinuity renders the informational “Cache discontinuity / 缓存复用中断” chip and one lower-emphasis line containing available elapsed context plus previous-cached → current-cached. It is not styled as an error and does not expose cause, model, reason codes, quota, or expiry claims. / 只有 non-null discontinuity 显示 informational marker 与一条低层级 elapsed／cached transition；不使用 error style，也不暴露 cause、model、reason code、quota 或 expiry claim。
- `src/codex-detail.js` consumes the selected, validated Logical Event fact rather than reparsing/reclassifying Raw accounting. The existing structured renderers produce Token Usage as primary content, optional Comparison Context as Inspector supplemental content, and the inference notice for discontinuities only. Usage Limits remain a separate existing section. `no_previous_observation` renders Token Usage without an empty comparison block; other states expose only applicable rows and neutral state copy. / Detail 直接消费 selected validated Logical Event fact，不重新解析／分类 Raw accounting；复用既有 renderer 生成 primary Token Usage、可选 Comparison Context，以及只属于 discontinuity 的 notice。Usage Limits 保持独立；`no_previous_observation` 不渲染空 comparison block，其它 state 只显示适用 row 与中性文案。
- The exact notice is: “This cache discontinuity is inferred from adjacent token accounting; the transcript does not provide explicit cache-expiry evidence.” / “该缓存复用中断由相邻的 token accounting 推断；转录中没有提供显式的缓存过期证据。” This is the only intentional expiry wording and is explicitly negative. / 这是唯一有意出现、且明确为否定式的 expiry 文案。

### Main affordance and exact cross-layer navigation / Main affordance 与精确跨 layer 导航

A validated Main forward fact renders one lightweight affordance: singular “Cache discontinuity · View protocol evidence” / “缓存复用中断 · 查看证据”, or plural “N cache discontinuities · View evidence” / “N 次缓存复用中断 · 查看证据”. It is an action inside the real Main card, not a Logical Event, and contains no copied token telemetry. / Validated Main forward fact 在真实 Main card 内渲染一个轻量 action；单数／复数使用上述 copy，不产生 Logical Event，也不复制 token telemetry。

Both directions use one generic exact-layer/event navigation helper layered over existing layer transition, event-envelope ownership, request-generation safety, and temporary reveal. Main → Protocol uses the projected real first Protocol ID, switches layer, resolves an unloaded or filtered target through its canonical envelope, selects it, and opens real detail. Protocol → Main exists only with the projected reverse ID and performs the symmetric exact transition. No timestamp/turn matching occurs in the browser. Ordinary cross-layer free text and `file`/`kind`/`status` filters plus saved folding overrides follow their existing preservation behavior, while the global layer-specific normalization remains authoritative: the Main-only `codeModeRequest` discriminator is cleared on every Protocol/Raw transition, whether initiated manually or by linked-event navigation, and is not secretly restored on reverse navigation. A target outside current membership is temporary only, does not alter pagination membership, and its reveal is cleaned when the reverse transition restores the real anchor. Session/project replacement and stale request ownership continue to use the existing transition machinery. / 双向导航复用一个 generic exact layer／event helper与既有 layer transition、event envelope、request-generation safety、temporary reveal；browser 不做 timestamp／turn matching。普通跨 layer free text、`file`／`kind`／`status` filter 与 saved folding override 沿用既有保留行为，但全局 layer-specific normalization 继续具有权威性：Main-only `codeModeRequest` discriminator 在任何进入 Protocol／Raw 的 transition 中都会清除，无论由用户手动切 layer 还是 linked-event navigation 发起；反向导航不会秘密恢复它。未加载或被 filter 排除的 target 只作 temporary reveal，不改变 pagination membership，反向返回真实 anchor 时清理 reveal；Session／project replacement 与 stale request 继续受既有 transition ownership 管理。

M3R removed the feature-added broad `preserveFilters` escape hatch entirely. `navigateToLayerEvent()` now requests only `restoreFocus: false`, so it suppresses restoration of the obsolete selection while still executing the same `changeLayer()` normalization as the Layer selector. This is reuse of the existing global Layer contract, not a Cache-specific filter rule or hidden filter snapshot. / M3R 完全删除了本 feature 新增的 broad `preserveFilters` escape hatch；`navigateToLayerEvent()` 现在只请求 `restoreFocus: false`，因此仅禁止恢复旧 selection，同时仍执行与 Layer selector 相同的 `changeLayer()` normalization。这是对既有全局 Layer contract 的复用，不是 Cache-specific filter rule，也不保存 hidden filter snapshot。

### M3 validation and local UX evidence / M3 验证与本地 UX 证据

- Focused presentation/query/detail/i18n/search/project-query/M2 semantic matrix: `138` tests, `138` passed, `0` failed. / Focused matrix 138／138。
- `npm run build:client` and `npm run build:check`: passed; `public/assets/app.js` was regenerated from source and is current. / Client build 与 build check 通过；generated artifact 保持 current。
- `npm test`: `917` tests, `917` passed, `0` failed. / Full unit／integration 917／917。
- `npm run test:package`: packaged Codex, Claude Code, and DeepSeek Harness all passed, including the new explicit runtime-module allowlist entry. / 三 source package smoke 与新增 runtime-module allowlist 均通过。
- M2 Pass-A/materialization smoke: `38` tests, `38` passed, `0` failed. A four-pair ordinary 32-observation profile remained non-blocking: BASE/CANDIDATE cold medians `71.140/77.908 ms`, paired median `+7.024 ms` (`9.874%`), paired p95 `+14.326 ms` (`18.340%`), one source read and verification per cold run, one candidate seed/reducer/finalizer, and zero extra work on a roughly `0.029 ms` same-revision warm hit. The unchanged deterministic proxy remained `170,200` bytes as expected. / M2 Pass-A／materialization smoke 38／38；四对 ordinary 32-observation profile 仍不 blocking，且 warm same-revision hit 不重跑 producer。
- `npm run test:browser`: the first full run passed 190/191 and hit one pre-existing Wave 1D-A stale context-slot ownership count flake; that case passed in isolation, and a clean full rerun passed `191/191` with zero failures. The new E2E begins from synthetic Codex rollout records and proves materialization → facts/links → paginated/filtered Main affordance → real Protocol selection/detail → reverse Main selection, plural aggregation, quiet ordinary behavior, EN/ZH copy, reveal cleanup, no saved filter/folding mutation, and zero console error/warning. / 首次 full browser run 因既有 Wave 1D-A flaky count 得到 190／191；isolated rerun 通过，随后 clean full rerun 191／191。新增 E2E 从 synthetic Codex rollout source 开始验证完整 source→browser 链路。
- M3R focused E2E passed `1/1`, and the clean full browser suite passed `191/191`. Its source-shaped Codex case proves that `kind=assistant_message` remains present in the Protocol timeline request while exact-event reveal selects the excluded token event; a real `exec_command` Code Mode request filter loses `codeModeRequest` before the Protocol request while retaining ordinary `kind=code_mode_operation`; reverse navigation selects the exact Main anchor without restoring the request discriminator; and the manual Layer selector applies the same clearing rule. The browser reports one ordinary active kind filter rather than a hidden declared-request constraint, and console errors/warnings remain zero. / M3R focused E2E 为 1／1，clean full browser suite 为 191／191。Source-shaped Codex case 证明：`kind=assistant_message` 继续出现在 Protocol timeline request 中，同时 exact-event reveal 选中被排除的 token event；真实 `exec_command` Code Mode request filter 在 Protocol request 发出前清除 `codeModeRequest`，但保留普通 `kind=code_mode_operation`；反向导航精确选中 Main anchor 且不恢复 request discriminator；手动 Layer selector 执行相同 clearing rule。Browser 只报告一个普通 kind filter，不声称存在 hidden declared-request constraint，console error／warning 仍为零。
- The corrected production-worktree server was restarted on `127.0.0.1:17893` and returned HTTP 200. A content-free Playwright audit scanned seven visible real-corpus Sessions before finding a Code Mode cache anchor, then observed all linked-target selection, temporary reveal, ordinary-kind preservation, Protocol request/UI clearing, exact reverse selection without restoration, and manual-selector clearing checks pass with zero console errors/warnings. It emitted no Session/event/path/title/model/transcript identity or content. / 修正后的 production-worktree server 已在 `127.0.0.1:17893` 重启并返回 HTTP 200。Content-free Playwright audit 扫描 7 个可见真实语料 Session 后找到 Code Mode cache anchor；linked-target selection、temporary reveal、普通 kind 保留、Protocol request／UI 清理、精确反向选择且不恢复，以及 manual selector 清理全部通过，console error／warning 为零；未输出任何 Session／event／path／title／model／transcript identity 或内容。
- `git diff --check`: passed; checkout emitted only expected LF→CRLF notices, with no whitespace error. / 通过；只有预期 line-ending notice。
- Aggregate-only local UX selection inspected the first 31 recent real Codex Sessions and found all requested categories: quiet ordinary usage, short- and long-elapsed discontinuities, same-owner aggregation, Code Mode and Assistant Main anchors, and a filtered/unloaded transition. Manual browser checks confirmed exact round trips, Comparison Context/notice, preserved filter/folding state, quiet analysis panel, narrow-width containment, visible keyboard focus, and exact key Chinese copy. No transcript content, path, or identity is recorded. / Aggregate-only local UX selection 检查最近 31 个真实 Codex Session，覆盖普通、短／长 elapsed、同 owner 聚合、Code Mode／Assistant anchor 与 filtered／unloaded transition；人工浏览器检查确认双向跳转、Comparison Context／notice、filter／folding 保持、analysis panel 安静、窄屏不溢出、keyboard focus 可见及关键中文 copy；未记录 transcript content、path 或 identity。
- The production-worktree server is running on `http://127.0.0.1:17893/` with `--repo G:\vibe\session-analyzer` for review. / Production worktree server 正在 17893 运行并使用原始 repository 作为只读 corpus source，供 review。

M3 changed no ProjectQueryStore implementation/schema/domain/row, no canonical query input, no source relationship/producer path, no analysis-panel metric, and no cache search/filter. It stops here for UX/browser review. / M3 未修改 ProjectQueryStore implementation／schema／domain／row、canonical query input、source relationship／producer path、analysis-panel metric 或 cache search／filter；在此停止等待 UX／browser review。

## M4 acceptance record / M4 验收记录

M4 made no production runtime, classifier, ownership, fork, canonical-fact, presentation, browser, Index, Pass-A, or ProjectQueryStore change. It added only aggregate-only local audit/profile harnesses and this execution-plan evidence. The real source remained read-only, all private identities stayed in an OS-temporary sealed manifest, and no transcript-derived artifact was added to the repository. / M4 未修改 production runtime、classifier、ownership、fork、canonical fact、presentation、browser、Index、Pass A 或 ProjectQueryStore；只新增 aggregate-only 的本地 audit／profile harness 与本执行计划证据。真实 source 始终只读，全部私有 identity 只存在于 OS 临时 sealed manifest，repository 中未加入 transcript derivative artifact。

### Sealed snapshot and independent oracle / Sealed snapshot 与独立 oracle

The snapshot was frozen once from the current Index by stable updated order as the most recent `min(115, available)` Codex Sessions; every later semantic, performance, memory, manual, quiet, and UX check used this same selection. The accepted source prefixes and their dependency closure were copied read-only to an OS-temporary private directory. / Snapshot 只封存一次：按当前 Index 的稳定 updated order 选择最近 `min(115, available)` 个 Codex Session；之后所有 semantic、performance、memory、manual、quiet 与 UX 检查均使用同一 selection。Accepted source prefix 及其 dependency closure 只读复制到 OS 临时私有目录。

| Snapshot aggregate / Snapshot aggregate | Result / 结果 |
| --- | --- |
| Selected / dependency closure / copied source files | `115 / 115 / 115` |
| Accepted-prefix bytes | `619,892,848` |
| Materialization | `115` succeeded, `0` failed |
| Raw / Logical | `89,928 / 78,013` |
| `token_count` / valid observations / invalid barriers | `12,142 / 12,141 / 1` |
| Observation-count distribution | min `0`; median `45`; p75 `91.5`; p90 `257.4`; p95 `459`; p99 `863.04`; max `1,539` |
| Raw-count distribution | min `10`; median `263`; p75 `676.5`; p90 `1,988.8`; p95 `3,208.7`; p99 `6,379.64`; max `10,398` |

The independent decision oracle loads the final demo module read-only and runs it over the same owned Raw/Logical evidence, sharing only source-row I/O. It does not call production `src/cache-observation.js` or production cache decision/finalization functions. A small audit-only wrapper applies only two previously approved production differences: M1 `cached_input_exceeds_input` fail-closed validation, and the M2 rule that lower-tier canonical Raw turn IDs cannot override explicit lifecycle ambiguity. / 独立 decision oracle 只读加载最终 demo module，并在同一份 owned Raw／Logical evidence 上运行，只共享 source-row I/O；它不调用 production `src/cache-observation.js` 或 production cache decision／finalization function。Audit-only wrapper 只应用两项此前已经批准的 production difference：M1 的 `cached_input_exceeds_input` fail-closed validation，以及 M2 的“低层级 canonical Raw turn ID 不得覆盖 explicit lifecycle ambiguity”规则。

The current sealed corpus contains no cached-input-greater-than-input case and therefore no M1 hardening edge. Before applying the already-recorded M2 ownership amendment, the demo assigned lower-tier `canonical_raw_turn_id` evidence to four completion rows for which production correctly retained `conflicting_turn_completion`; all four share that one bounded signature, affect no unrelated observation edge, and are counted separately as expected differences. After applying the approved amendment, exact parity is `115/115` Sessions with `0` unexplained mismatches. / 当前 sealed corpus 不含 cached input 大于 input 的样本，因此 M1 hardening edge 为 `0`。在应用已经写入本计划的 M2 ownership amendment 之前，demo 会在 `4` 个 completion row 上采用较低层级 `canonical_raw_turn_id`，而 production 按冻结 contract 保留 `conflicting_turn_completion`；四项均属于同一个 bounded signature，不影响其它 observation edge，并作为 expected difference 单独计数。应用已批准 amendment 后，`115/115` Session exact parity，无法解释的 mismatch 为 `0`。

Exact comparison covered valid-observation and barrier membership; normalized required/optional values and reuse basis points; state and ordered reason codes; predecessor physical position; elapsed and all deltas; raw/discontinuity ownership; owner equality; Main mapping and anchor order; Raw/Logical identity; and project-query projection. Every category reported `0` mismatches and there were no materialization failures. / Exact comparison 覆盖 valid observation／barrier membership、normalized required／optional value 与 reuse basis point、state 与有序 reason code、predecessor physical position、elapsed 与全部 delta、Raw／discontinuity ownership、owner equality、Main mapping 与 anchor order、Raw／Logical identity及 project-query projection；每类 mismatch 均为 `0`，materialization failure 为 `0`。

### Semantic, ownership, and mapping aggregates / Semantic、ownership 与 mapping aggregate

| Comparison state | Count |
| --- | ---: |
| `no_previous_observation` | 114 |
| `unknown_or_non_monotonic_timestamp` | 0 |
| `model_change` | 1 |
| `compaction_boundary` | 6 |
| `comparable` | 11,926 |
| `cache_discontinuity` | 94 |

- `49` Sessions contain `94` discontinuity events; all `94` map to Main (`10,000` basis points coverage). This is current snapshot evidence, not an SLA or invariant. / `49` 个 Session 含 `94` 个 discontinuity event；全部 `94` 个均可 Main-map（coverage `10,000` basis points）。这只是当前 snapshot evidence，不是 SLA 或 invariant。
- Discontinuity owner evidence is `explicit_lifecycle: 94`; `legacy_turn_context`, `canonical_raw_turn_id`, and `implicit_user_turn` are all `0`. The unmapped-reason distribution is empty because the current corpus has no unmapped discontinuity; the reducer was not widened to obtain this result. / Discontinuity owner evidence 为 `explicit_lifecycle: 94`；其它三个 tier 均为 `0`。当前 corpus 没有 unmapped discontinuity，因此 unmapped-reason distribution 为空；未为得到该结果而放宽 reducer。
- Accounting extraction is `info.last_token_usage: 12,141`, `missing: 1`; the one missing required candidate is the sole barrier. / Accounting extraction 为 `info.last_token_usage: 12,141`、`missing: 1`；该 missing required candidate 是唯一 barrier。
- All six cross-compaction edges are `compaction_boundary`, produce no ordinary discontinuity, and have `0` owner-continuity failures. Natural short-elapsed samples contain `11,001` comparable and `26` discontinuity pairs; natural long-elapsed samples contain `925` comparable and `68` discontinuity pairs. No synthetic supplement was required, confirming elapsed remains context rather than a threshold. / 六个跨 compaction edge 均为 `compaction_boundary`、不产生普通 discontinuity，且 owner-continuity failure 为 `0`。自然 short-elapsed 样本含 `11,001` comparable／`26` discontinuity，自然 long-elapsed 样本含 `925` comparable／`68` discontinuity；无需 synthetic supplement，证明 elapsed 仍只是 context 而非 threshold。

The deterministic manual rule is sealed selection order followed by first-discontinuity physical order. There were `87` mapped Main-anchor groups available; the first `20` were reviewed through real browser Main → Protocol → Main navigation plus the independently checked owner/order/link facts: `20` correct, `0` wrong-turn. The deterministic quiet pool contained `65` Sessions; the first `10` all passed, with no Main affordance, no discontinuity marker/context, no synthetic Main event or analysis metric, while their Protocol pages rendered `177` observed normal Token usage cards quietly. / Deterministic manual rule 为 sealed selection order，再按 first-discontinuity physical order；可用 mapped Main-anchor group 为 `87`，前 `20` 个经真实 browser Main→Protocol→Main 与独立 owner／order／link fact 检查：`20` correct、`0` wrong-turn。Deterministic quiet pool 含 `65` 个 Session；前 `10` 个全部通过：无 Main affordance、无 discontinuity marker／context、无 synthetic Main event 或 analysis metric，同时 Protocol page 共观察到 `177` 张保持安静的普通 Token usage card。

### Formal materialization performance / 正式 materialization 性能

Each real cohort used the sealed content-free density rank, five balanced fresh-process pairs, ABBA/BAAB ordering inside each pair, two cold materializations per mode, the same Node `v24.18.1` runtime and strict materialization interval, and no timed Index build. Five is the plan's formal minimum; the near-max case takes roughly ten seconds per cold materialization, so the balanced five-pair run was retained rather than spending substantially more time on redundant tail samples. / 每个 real cohort 使用 sealed content-free density rank、`5` 个 balanced fresh-process pair、pair 内 ABBA／BAAB 顺序、每个 mode 两次 cold materialization、同一 Node `v24.18.1` runtime 与 strict materialization interval，且 Index build 不计时。`5` 是计划规定的 formal minimum；near-max case 每次 cold materialization 约需十秒，因此采用完整 balanced 五对，而未为冗余 tail sample 大幅增加耗时。

| Real cohort | Raw / obs | BASE median / p95 / max ms | Candidate median / p95 / max ms | Paired median delta | Paired p95 delta | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Representative | 317 / 45 | 285.914 / 292.933 / 292.933 | 296.515 / 311.340 / 311.340 | +10.528 ms / +3.68% | +27.312 ms / +9.32% | pass |
| High (near p95) | 3,047 / 450 | 2,525.688 / 2,557.290 / 2,557.290 | 2,605.547 / 2,692.127 / 2,692.127 | +79.859 ms / +3.16% | +143.575 ms / +5.61% | pass |
| Very high (max) | 10,398 / 1,539 | 9,970.497 / 10,140.614 / 10,140.614 | 9,837.910 / 10,164.648 / 10,164.648 | −124.747 ms / −1.25% | +24.034 ms / +0.24% | pass |

Every cold real run used exactly one source read and one verification. Candidate used one seed-capture and one finalizer; the quiet representative avoided owner reduction, while high and very-high each used one reduction. Warm same-revision candidate medians were `0.027`, `0.029`, and `0.037` ms, returned the exact admitted object, and added zero source/seed/reducer/finalizer work. No real cohort triggers either unchanged conjunctive guardrail. / 每个 real cold run 均执行一次 source read 与一次 verification；candidate 各执行一次 seed capture／finalizer，quiet representative 跳过 owner reduction，high／very-high 各执行一次 reduction。Candidate warm same-revision median 分别为 `0.027`、`0.029`、`0.037` ms，返回 exact admitted object，新增 source／seed／reducer／finalizer work 为零。没有 real cohort 触发任何未修改的 conjunctive guardrail。

The M2R synthetic anchors were repeated with five balanced pairs after M3/M3R: / M3／M3R 后以五个 balanced pair 重复 M2R synthetic anchor：

| Synthetic anchor | BASE median / p95 / max ms | Candidate median / p95 / max ms | Paired median delta | Paired p95 delta | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Ordinary, 32 observations | 77.895 / 80.585 / 80.585 | 84.266 / 90.856 / 90.856 | +6.371 ms / +8.18% | +20.594 ms / +25.56% | pass: p95 absolute conjunct is below 50 ms |
| Stress, 384 observations | 795.465 / 886.144 / 886.144 | 899.091 / 918.592 / 918.592 | +75.909 ms / +9.54% | +117.790 ms / +13.29% | pass: both percentage conjuncts remain below their limits |

Both anchors used one read/verification per cold run, exactly one candidate seed/reducer/finalizer, and zero warm extra work. Candidate warm medians were approximately `0.032` and `0.031` ms. The original gate was neither modified nor reinterpreted. / 两个 anchor 的每次 cold run 都执行一次 read／verification、恰好一次 candidate seed／reducer／finalizer，warm extra work 为零；candidate warm median 约为 `0.032`／`0.031` ms。原 gate 未被修改或重新解释。

### Forced-GC retained-memory characterization / Forced-GC retained-memory characterization

Memory was measured under Node `--expose-gc` in ten balanced fresh-process repetitions per real cohort. Each process built the identical Index before the measured baseline, forced GC to a stable point, retained the Materialized Session and cache entry, measured a warm same-object hit, then retired the owner, dropped external references, and forced GC again. The production O(1) IndexedSession-derived weight estimator was not changed and is not presented as a heap estimator. / Memory 使用 Node `--expose-gc`，每个 real cohort 执行 `10` 次 balanced fresh-process repetition。每个 process 在测量 baseline 前建立 identical Index，强制 GC 至稳定点，保留 Materialized Session 与 cache entry，测量 warm same-object hit，然后 retire owner、释放外部 reference 并再次强制 GC。Production O(1) IndexedSession-derived weight estimator 未修改，也未被描述为 heap estimator。

| Cohort | Obs / links | BASE retained median bytes | Candidate retained median bytes | Paired median delta | Relative / bytes per observation | Paired p95 delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Representative | 45 / 0 | 3,184,300 | 3,345,076 | +160,996 | +5.06% / 3,577.7 B | +381,320 B |
| High | 450 / 3 | 28,052,720 | 28,383,576 | +331,920 | +1.18% / 737.6 B | +2,106,112 B |
| Very high | 1,539 / 4 | 93,777,752 | 94,223,148 | +445,396 | +0.47% / 289.4 B | +873,312 B |

The measured public-fact increment is bounded and does not exhibit a density-driven nonlinear jump; diagnostic bytes per observation decline as the underlying Session grows. Candidate median warm-heap movement was `628`, `456`, and `400` bytes, every warm lookup returned the exact same object with zero adapter/finalizer work, and no second observation/link graph appeared. Every returned Session lacked `_cacheObservationSeeds` and transient owner diagnostics. Owner retirement reduced cache membership from one to zero in every repetition. / 测得的 public-fact 增量有界，未出现 density-driven nonlinear jump；随底层 Session 增长，diagnostic bytes per observation 反而下降。Candidate warm-heap median movement 为 `628`、`456`、`400` bytes；每次 warm lookup 均返回同一对象且 adapter／finalizer work 为零，没有第二份 observation／link graph。所有返回 Session 均不含 `_cacheObservationSeeds` 或 transient owner diagnostic；每次 repetition 的 owner retirement 都使 cache membership 从一降为零。

Retired residual medians for BASE/CANDIDATE were `301,140/456,680`, `305,332/577,376`, and `328,784/606,940` bytes. Their candidate-minus-BASE difference approaches a small density-independent plateau rather than retaining an observation-sized graph. An additional eight-cycle representative retirement series had first/last per-cycle residuals of `572,264/26,512` bytes, median `82,988` bytes, and total fresh-process growth of `1,116,160` bytes—well below one retained representative Session graph—with no repeated cache object. These are characterization data, not a newly invented numeric heap gate. / BASE／CANDIDATE retired residual median 分别为上述三组；candidate-minus-BASE 差异趋近小型、与 observation density 无关的平台，而不是保留 observation-sized graph。额外八轮 representative retirement series 的首／末 per-cycle residual 为 `572,264/26,512` bytes，median `82,988` bytes，fresh process 总增长 `1,116,160` bytes，明显低于一份 retained representative Session graph，且无重复 cache object。这些属于 characterization data，不是新发明的 numeric heap gate。

### Structural, lifecycle, UX, and regression proof / 结构、lifecycle、UX 与回归证据

- Two complete sealed Index builds are identical: `115` candidates, `619,892,848` accepted-prefix bytes, `230` source verifications, `111/4` LIGHT/FULL decisions, `4` full Pass-A constructions, `0` cycle parses, `115` final canonical parses, and identical relationship output. Indexed Sessions have no Raw/Logical/cache/presentation graph and no Cache fact. / 两次完整 sealed Index build 在上述全部指标上完全一致；Indexed Session 不含 Raw／Logical／cache／presentation graph 或 Cache fact。
- ProjectQueryStore remains schema `2` with digest domain `project-query-projection-v1`; BASE/CANDIDATE packed rows, digests, and accounted bytes are identical. The measured selected-store accounted bytes are `387,591,129`. / ProjectQueryStore 继续为 schema `2`、digest domain `project-query-projection-v1`；BASE／CANDIDATE packed row、digest 与 accounted byte 完全相同；本次 selected store accounted bytes 为 `387,591,129`。
- Focused lifecycle coverage confirms cold concurrency coalesces one parse/seed/reducer/finalizer, warm same-revision lookup does no work and returns exact identity, normal eviction rematerializes once, revision replacement cannot reuse the old enriched object, and cancellation admits no partial Session. The forced-GC checks add no alternate cache architecture. / Focused lifecycle coverage 确认 cold concurrency 合并为一次 parse／seed／reducer／finalizer，warm same-revision lookup 不工作且返回 exact identity，普通 eviction 只 rematerialize 一次，revision replacement 不能复用旧 enriched object，cancellation 不 admission partial Session；forced-GC 检查未增加另一套 cache architecture。
- The sealed production server on `127.0.0.1:17893` passed aggregate-only Playwright CLI acceptance: `20/20` linked owner round trips, `0` wrong-turn; `10/10` quiet Sessions; ordinary `kind=assistant_message` preservation plus exact temporary reveal; Main-only `codeModeRequest` removed before every Protocol request and not secretly restored; EN/zh-CN key copy and negative expiry notice; Comparison Context; zero analysis-panel Cache metrics; unchanged folding overrides; and `0` console errors/warnings. / 17893 sealed production server 的 aggregate-only Playwright CLI acceptance 全部通过上述项目。
- Focused Cache/domain/materialization/fork/Pass-A/query/detail/i18n matrix: `154/154` passed. `npm run build:check` passed with generated assets current. The first `npm test` run passed `916/917`; its sole failure was an existing asynchronous project-index status assertion observing `running` instead of `succeeded` after the preceding pressure runs. That exact test passed alone (`1/1`), and a clean full rerun passed `917/917`. `npm run test:browser` passed `191/191`. `npm run test:package` passed packaged Codex, Claude Code, and DeepSeek Harness startup/indexing. `git diff --check` passed with only the checkout's expected LF→CRLF notices. / Focused matrix `154/154`；build check 通过。首次 full unit 因既有异步 project-index 状态 timing assertion 得到 `916/917`；该 case 单独 `1/1`，clean full rerun `917/917`。Full browser `191/191`；三 source package smoke 通过；`git diff --check` 通过，只有既有 LF→CRLF notice。

All M4 stop conditions remain false: there is no unexplained oracle mismatch, wrong-turn, inherited-fork leak, representative performance gate failure, synthetic-anchor drift, repeated/nonlinear retained-memory growth, or Pass-A/Index/ProjectQueryStore change. M4 stops here for acceptance review and does not begin M5. / M4 全部 stop condition 均为 false：不存在无法解释的 oracle mismatch、wrong-turn、inherited-fork leak、representative performance gate failure、synthetic anchor drift、重复／非线性 retained-memory growth，或 Pass A／Index／ProjectQueryStore change。M4 在此停止等待 acceptance review，不开始 M5。

## M5 closeout record / M5 收口记录

The 2026-09-03 review formally accepted M4 and authorized documentation/release closeout only. A fresh fetch reconfirmed `origin/towards-0.2.0` at `66462708c4a2fa184f7b22054c53a87692ea1c24`, so there is no integration drift. Before any M5 edit, a deterministic manifest of the 28 current runtime/test/package/generated-asset files recorded `2,569,767` bytes and SHA-256 `22b265ef4cfd0b9c0e4c5b1a321ccb0ac2c29b9ea9f748bee05f554d8f8fe8ec`; the same manifest is the M5 runtime-freeze oracle. / 2026-09-03 review 正式接受 M4，并且只授权 documentation／release closeout。重新 fetch 后，`origin/towards-0.2.0` 仍为上述 SHA，因此没有 integration drift。任何 M5 edit 之前，以 28 个当前 runtime／test／package／generated-asset file 构造的 deterministic manifest 记录了 `2,569,767` bytes 与上述 SHA-256；同一 manifest 作为 M5 runtime-freeze oracle。

M5 updates the bilingual domain glossary, product specification, timeline, Codex protocol coverage, source-adapter boundary, Indexed／Materialized lifecycle, public README pair, and Unreleased Codex changelog. It adds `docs/design-docs/cache-observation-and-discontinuity.md` as the durable architecture authority and adds only that design-document anchor to `AGENTS.md`. The documentation-system and npm-release runbooks were read and remain correct without edits. The schema-update runbook was audited and needs no Cache-specific edit: it governs upstream schema review and contains no canonical additive-extension registry; Cache v1 changes neither canonical schema version nor ProjectQueryStore schema/digest domain. / M5 更新双语 domain glossary、product spec、timeline、Codex protocol coverage、source-adapter boundary、Indexed／Materialized lifecycle、public README pair 与 Unreleased Codex changelog。新增 `docs/design-docs/cache-observation-and-discontinuity.md` 作为长期 architecture authority，并且只在 `AGENTS.md` 增加该 design-doc anchor。Documentation-system 与 npm-release runbook 已读取，现有内容仍正确，无需修改。Schema-update runbook 已审计且无需 Cache-specific edit：它负责上游 schema review，不包含 canonical additive-extension registry；Cache v1 既不改变 canonical schema version，也不改变 ProjectQueryStore schema／digest domain。

Two M4 tools remain as durable, opt-in, non-package regression aids: `scripts/cache-observation-corpus-audit.js` performs only aggregate/content-free density auditing for a caller-selected repository, and `scripts/cache-observation-materialization-profile.js` runs a sealed synthetic paired materialization profile with no reported identity or path. Five untracked, one-time M4 scaffolds were removed from the proposed feature diff: the acceptance orchestrator depended on the disposable prototype plus a private sealed manifest; the browser and owner scripts depended on private selected identities; and the real-materialization and retained-memory runners depended on that one-time manifest/cohort layout. Their accepted aggregate evidence remains here; none is a public CLI or npm-package file. / 两个 M4 tool 作为 durable、opt-in、不会进入 package 的 regression aid 保留：`scripts/cache-observation-corpus-audit.js` 只对 caller 选择的 repository 执行 aggregate／content-free density audit；`scripts/cache-observation-materialization-profile.js` 运行 sealed synthetic paired materialization profile，不报告 identity 或 path。五个 untracked 一次性 M4 scaffold 已从 proposed feature diff 移除：acceptance orchestrator 依赖 disposable prototype 与 private sealed manifest；browser／owner script 依赖 private selected identity；real-materialization／retained-memory runner 依赖该一次性 manifest／cohort layout。已接受 aggregate evidence 继续保留在本计划中；这些脚本均不是 public CLI 或 npm package file。

Pre-archive validation passed on Node `v24.18.1` and npm `12.0.2`: `npm run build:client`; generated-asset `npm run build:check`; `npm test` at `917/917`; `npm run test:browser` at `191/191`; three-source `npm run test:package`; `npm run release:check` (including another clean `917/917` plus three-source package smoke); both retained-script `node --check` commands; and `git diff --check` with only expected LF→CRLF notices. The production server on `127.0.0.1:17893` still returned HTTP 200. The 28-file runtime manifest remained exactly `2,569,767` bytes and SHA-256 `22b265ef4cfd0b9c0e4c5b1a321ccb0ac2c29b9ea9f748bee05f554d8f8fe8ec` after `build:client`, proving that M5 changed no feature runtime, test, package metadata, or generated asset. / Pre-archive validation 在 Node `v24.18.1`／npm `12.0.2` 上全部通过：client build、generated-asset check、Node `917/917`、browser `191/191`、三来源 package smoke、`release:check`（再次包含 clean `917/917` 与三来源 smoke）、两个 retained script 的 `node --check`，以及只有预期 LF→CRLF notice 的 `git diff --check`。17893 production server 继续返回 HTTP 200。`build:client` 后 28-file runtime manifest 仍精确为上述 byte count 与 SHA-256，证明 M5 未修改 feature runtime、test、package metadata 或 generated asset。

After this plan moved from `active/` to `completed/`, the mandated final sequence passed again: `npm run build:client`, `npm run build:check`, `npm test` (`917/917`), `npm run test:browser` (`191/191`), three-source `npm run test:package`, and `npm run release:check` (another `917/917` plus three-source package smoke). Both retained scripts passed `node --check`; the runtime manifest still matched the same byte count and SHA-256; `127.0.0.1:17893` still returned HTTP 200; and the final evidence-only edit retained a clean `git diff --check`. / 本计划从 `active/` 移到 `completed/` 后，规定的 final sequence 再次全部通过：client build、build check、Node `917/917`、browser `191/191`、三来源 package smoke 与 `release:check`（再次包含 `917/917` 与三来源 smoke）。两个 retained script 均通过 `node --check`；runtime manifest 仍匹配同一 byte count／SHA-256；`127.0.0.1:17893` 继续返回 HTTP 200；最后一次仅证据文档编辑后，`git diff --check` 仍然 clean。

## Audit coverage / 审计覆盖

### Current production architecture / 当前 production 架构

M0 reviewed the current `README.md`, `AGENTS.md`, `CONTEXT.md`, `package.json`, the required product/design documents, and the latest completed Codex relationship-scan performance plan. The implementation audit followed the full relevant chain through canonical validation, adapter dispatch and materialization, session and project queries, Codex parsing/logical/detail/search, browser timeline state/navigation/detail rendering, i18n, server routes, package smoke, unit tests, and browser E2E. / M0 已审阅当前 `README.md`、`AGENTS.md`、`CONTEXT.md`、`package.json`、要求列出的产品／设计文档，以及最近完成的 Codex relationship-scan 性能计划。实现审计覆盖 canonical validation、adapter dispatch 与 materialization、Session 与 Project query、Codex parse／logical／detail／search、browser timeline state／navigation／detail rendering、i18n、server route、package smoke、unit tests 与 browser E2E 的完整相关链路。

The principal reviewed production paths are:

- `src/canonical-contract.js`, `src/source-adapter-contract.js`, `src/source-adapters.js`, `src/session-query.js`, and `src/project-query-store.js`;
- `src/codex-source.js`, `src/codex-logical.js`, `src/codex-detail.js`, `src/codex.js`, and `src/codex-search.js`;
- `src/browser/app.js`, `src/browser/navigation.js`, `src/browser/timeline-event-state.js`, `src/browser/timeline-card-lifecycle.js`, `src/browser/detail-presentation.js`, `src/browser/renderers.js`, `src/shared/i18n.js`, and `server.js`;
- relevant canonical/materialization/fork/query/detail/navigation/renderer/package tests and `e2e/browser.test.js`. / 相关 canonical／materialization／fork／query／detail／navigation／renderer／package tests 与 `e2e/browser.test.js`。

The required architecture documents reviewed were:

- `docs/product-specs/session-transcript-analyzer.md`;
- `docs/design-docs/logical-event-timeline.md`;
- `docs/design-docs/codex-protocol-event-coverage.md`;
- `docs/design-docs/transcript-source-adapters.md`;
- `docs/design-docs/indexed-materialized-session-lifecycle.md`;
- `docs/design-docs/timeline-loading-and-rendering-performance.md`;
- `docs/design-docs/schema-update-runbook.md`;
- `docs/exec-plans/completed/2026-09-01-performance-server-s2-relationship-scan.md` as a performance boundary, not as Cache requirements. / 将其作为性能边界，而不是 Cache 需求来源。

`public/assets/app.js` was identified only as a generated runtime artifact. It was not used as an architecture source. / `public/assets/app.js` 只被识别为生成的 runtime artifact，未被用作架构源文件。

### Disposable prototype / Disposable prototype

The demo worktree was located by `git worktree list` at `G:\vibe\session-analyzer\tmp\worktrees\cache-observation-demo`, HEAD `b7ca3bff12fd5061410aaa3483341023498b23d4`, with its uncommitted prototype changes left untouched. M0 reviewed: / Demo worktree 通过 `git worktree list` 定位于上述路径，HEAD 为 `b7ca3bff12fd5061410aaa3483341023498b23d4`；其中未提交的 prototype 变更保持原样。M0 审阅了：

- all of `src/cache-observation-demo.js` and `test/cache-observation-demo.test.js`;
- the demo changes in `server.js`, `src/browser/app.js`, `src/shared/i18n.js`, `public/styles.css`, `e2e/browser.test.js`, `package.json`, `test/package.test.js`, and `test/i18n.test.js`;
- the generated `public/assets/app.js` only as a changed build artifact, not as an independent behavior source. / 生成的 `public/assets/app.js` 仅作为 changed build artifact 记录，不作为独立行为来源。

## What the prototype proved / Prototype 已证明什么

The following are accepted product semantics, not an invitation to re-explore the product: / 以下是已接受的产品语义，不再重新做产品探索：

1. Existing Codex `token_count` Logical Events remain in the Protocol Layer. Cache observation adds no Raw Record, no Logical Event, and no synthetic Main event. / 现有 Codex `token_count` Logical Event 继续位于 Protocol Layer；Cache observation 不增加 Raw Record、Logical Event 或 synthetic Main event。
2. Human copy says “Token usage” / “Token 使用情况” or an equivalent readable localized term while the machine subtype remains `token_count`. / 人类可读 copy 使用 “Token usage”／“Token 使用情况” 或等义本地化名称，machine subtype 保持 `token_count`。
3. A normal Token usage card compactly shows Input, Cached, Cache reuse ratio, and Output. Normal reuse stays visually quiet. / 普通 Token usage card 紧凑显示 Input、Cached、Cache reuse ratio 与 Output；正常复用保持低噪声。
4. Only the conservative rule below creates “Cache discontinuity / 缓存复用中断”. It never makes an expiration, TTL, causal, or cache-validity claim. / 只有下述 conservative rule 能产生“Cache discontinuity／缓存复用中断”；不得作出 expiration、TTL、因果或 cache-validity 断言。
5. Elapsed time and the previous-to-current cache-read transition may appear as compact context. Elapsed time is not a threshold and is not causal evidence. / elapsed 与前后 cache-read transition 可作为紧凑上下文；elapsed 不是阈值，也不是因果证据。
6. Inspector Comparison Context contains elapsed, input previous/current, absolute and percentage input delta, cached input previous/current, cache-read delta, reuse previous/current, comparison state, and the fixed inference notice. / Inspector Comparison Context 包含 elapsed、input 前后值、input absolute／percentage delta、cached input 前后值、cache-read delta、reuse 前后值、comparison state 与固定 inference notice。
7. The notice states that discontinuity is inferred from adjacent token accounting and is not explicit upstream cache-expiry evidence. The negated notice is the only intentional expiry wording; all positive or causal expiry/TTL language is forbidden. / Notice 明确说明 discontinuity 来自相邻 token accounting 的推断，并非上游显式 cache-expiry evidence。该否定式 notice 是唯一有意出现的 expiry 表述；其它正向或因果性的 expiry／TTL 文案全部禁止。
8. `#analysisPanel` gains no cache metric or summary card. Session lists and Main Timeline do not duplicate Token usage. / `#analysisPanel` 不增加 cache metric／summary card；Session list 与 Main Timeline 不复制 Token usage。
9. A reliably owned Main turn gets one lightweight presentation-only affordance. Multiple discontinuities for the same owner aggregate into one affordance and navigate to the first discontinuity in raw order. / 可可靠归属的 Main turn 获得一个轻量、仅 presentation 的 affordance；同 owner 多次 discontinuity 聚合为一个，并导航到 raw order 中第一个 discontinuity。
10. Main-to-Protocol navigation switches layer, selects the real `token_count` event, and shows its real evidence. The reverse “View Main context” action exists only when a reliable reverse link exists. / Main→Protocol 会切换 layer、选中真实 `token_count` event 并展示真实 evidence；只有可靠 reverse link 存在时才显示 “View Main context”。
11. Cross-layer ownership is reconstructed from raw order and lifecycle evidence, never timestamp proximity. Unknown evidence is not itself a conflict; contradictory known owners and rollback ambiguity fail closed. / 跨 layer ownership 由 raw order 与 lifecycle evidence 重建，绝不使用 timestamp proximity；unknown evidence 本身不等于 conflict，互相矛盾的已知 owner 与 rollback ambiguity 必须 fail closed。
12. The Main anchor is the nearest same-owner Main event at or before the first discontinuity by raw order, with Logical order as the deterministic tie-breaker. It is not forced to the turn’s final assistant message. / Main anchor 是 first discontinuity 之前或同位置、raw order 最近的同 owner Main event，并以 Logical order 作确定性 tie-break；不强制使用 turn 最后的 assistant message。

### Historical real-corpus evidence / 历史真实语料证据

On the prototype’s then-current sample of 115 recent real Codex Sessions, 50 Sessions contained 100 discontinuities. After the final reducer correction, all 50 Sessions and all 100 events were Main-mapped, all from the explicit-lifecycle evidence tier; the prior 12 strict owners remained unchanged; a 20-event new-mapping spot check found no wrong-turn attribution; no obvious conservative-rule miss or compaction false positive was observed; both seconds-scale and long-gap cases existed; the cross-layer UX was understandable; and ordinary Sessions stayed quiet. / 在 prototype 当时的 115 个近期真实 Codex Session 样本上，50 个 Session 含 100 个 discontinuity。最终 reducer 修正后，50/50 Session 与 100/100 event 均可 Main-map，且都来自 explicit-lifecycle evidence tier；原 12 个 strict owner 不变；新增 mapping 抽查 20 项未发现 wrong-turn attribution；未观察到明显 conservative-rule 漏报或 compaction false positive；样本同时包含秒级与长间隔；cross-layer UX 可理解；普通 Session 保持安静。

These numbers describe one historical snapshot. They are neither an SLA nor a production invariant and must not be asserted against an evolving corpus. M4 revalidates behavior on a newly sealed snapshot and reports only aggregates. / 这些数字只描述一个历史 snapshot，既不是 SLA，也不是 production invariant；不得对变化中的 corpus 断言相同数字。M4 会在新封存 snapshot 上重新验证，并且只报告 aggregate。

## Exact v1 scope / v1 精确范围

The only producer in v1 is Codex. The shared contract may be source-neutral, but Claude Code and DeepSeek Harness emit empty presentation indexes and no cache observations. / v1 唯一 producer 是 Codex。共享 contract 可以 source-neutral，但 Claude Code 与 DeepSeek Harness 只产生空 presentation index，不产生 cache observation。

V1 includes only:

- normalized cache observations on valid Codex `token_count` Protocol events;
- conservative adjacent-observation discontinuity classification;
- raw-order Codex turn ownership and Main anchoring;
- compact Protocol Token usage presentation;
- full Inspector Comparison Context and fixed inference notice;
- reliable presentation-only Main ↔ Protocol navigation;
- correctness, real-corpus aggregate, lifecycle, package, and performance validation. / correctness、真实语料 aggregate、lifecycle、package 与 performance validation。

V1 explicitly excludes:

- Claude Code or DeepSeek Harness Cache Observation;
- project-wide cache discovery, `cache=discontinuity`, Search-options Cache fields, ProjectQueryStore cache columns, schema changes, or projection-digest-domain changes;
- analysis-panel metrics, Session-list cache summaries, or Main Timeline Token usage copies;
- model/CLI historical risk estimation, TTL or expiry prediction, causal attribution, health grading, charts, retention buckets, or settings;
- persistence, a derived cache database, cache summaries, or any new cache Logical Event. / persistence、派生 cache database、cache summary 或任何新 cache Logical Event。

If implementation appears to require ProjectQueryStore, stop and return to architecture review. Do not silently widen this plan. / 如果实现看似必须修改 ProjectQueryStore，应立即停止并回到架构评审，不得静默扩大本计划。

## Current architecture boundaries / 当前架构边界

1. The committed strict Index retains IndexedSession shells, dependency/materialization descriptors, ProjectQueryStore, legacy Raw owners, and catalogs. It does not retain full Raw/Logical/analysis/presentation graphs. / Committed strict Index 保留 IndexedSession shell、dependency／materialization descriptor、ProjectQueryStore、legacy Raw owner 与 catalog；不保留完整 Raw／Logical／analysis／presentation graph。
2. Timeline, event, detail, Raw readback, and analysis surfaces materialize one complete Session on demand. A revision-scoped weighted LRU coalesces concurrent work and reuses the exact admitted Materialized Session; normal limits remain 256 MiB and 12 entries. / Timeline、event、detail、Raw readback 与 analysis surface 按需 materialize 一个完整 Session。Revision-scoped weighted LRU 会合并并发工作并复用已准入的同一个 Materialized Session；普通 limit 保持 256 MiB／12 entries。
3. ProjectQueryStore is an independent resident query path with schema version 2 and digest domain `project-query-projection-v1`. It contains only fields needed by list/project queries. / ProjectQueryStore 是独立的 resident query path，schema version 为 2、digest domain 为 `project-query-projection-v1`；只含 list／project query 所需字段。
4. Codex relationship Pass A now routes ordinary candidates through a LIGHT scanner. On its accepted sealed corpus, full Pass-A semantic constructions fell from 600 to 59 while the final canonical parse remained 600. Cache v1 must not reverse that boundary. / Codex relationship Pass A 当前把 ordinary candidate 送入 LIGHT scanner。在已接受的 sealed corpus 上，完整 Pass-A semantic construction 从 600 降至 59，而 final canonical parse 仍为 600；Cache v1 不得逆转该边界。
5. `presentationIndexes` is a Materialized-Session-only, exact-shape seam. It currently owns Code Mode declaration facts and is the natural home for cross-event cache links that are not Main semantics. / `presentationIndexes` 是 Materialized-Session-only 的 exact-shape seam，目前承载 Code Mode declaration fact；它也是不属于 Main semantic 的 cross-event cache link 的自然归属。
6. Timeline DTOs are paged and intentionally lighter than complete events/details. Event-envelope and temporary-reveal paths already support exact navigation to an event excluded by the loaded page or current filters. / Timeline DTO 分页且有意轻于完整 event／detail；既有 event-envelope 与 temporary-reveal path 已支持精确导航到未加载页或被当前 filter 排除的 event。
7. `package.json` uses an explicit npm `files` allowlist, and `test/package.test.js` asserts the exact pack manifest. New runtime modules require both allowlist and package-smoke coverage. / `package.json` 使用显式 npm `files` allowlist，`test/package.test.js` 对 pack manifest 作 exact assertion；新增 runtime module 必须同步 allowlist 与 package smoke。

## Chosen production architecture / 选定的 production 架构

```text
accepted-prefix Codex materialization parse
  -> while parsed payloads exist, capture bounded token/model seeds only
  -> compact Raw records as today
  -> applyCodexRelationshipEvidence()
  -> remove inherited materialized-fork Logical prefix
  -> finalizeSession() for owned counts/analysis/base presentation indexes
  -> finalizeCodexCacheObservation() over owned raw/logical order
       normalize valid token_count observations
       compare adjacent observations
       reconstruct turn ownership
       attach Protocol cacheObservation facts
       build bidirectional presentation links
  -> canonical/private/fingerprint/query-projection validation
  -> weighted Materialized Session cache admission
  -> paged timeline DTO or detail response
```

The materialization parse captures minimal seeds while source payloads already exist. It performs no second source-row hydration and creates no demo sidecar request. Seed capture is enabled only for complete-Session construction: the production strict materialization path and the test-only resident oracle used for parity. It is disabled in relationship Pass A and in the source-backed final Index-construction pass. / Materialization parse 在 source payload 已经存在时捕获最小 seed，不进行第二次 source-row hydration，也不创建 demo sidecar request。Seed capture 只对完整 Session 构造启用：production strict materialization path，以及用于 parity 的 test-only resident oracle；在 relationship Pass A 与 source-backed final Index-construction pass 中关闭。

Cache finalization runs only after relationship ownership has selected the public owned Logical projection and after base Session finalization has built counts/analysis. Therefore it cannot affect counts or `#analysisPanel`. For a materialized fork, the reducer receives fork metadata plus continuation only; inherited Raw/model/turn/token seeds and inherited Logical events cannot establish the child’s comparison predecessor or owner. / Cache finalization 只在 relationship ownership 选定 public owned Logical projection、且 base Session finalization 已构造 counts／analysis 后运行，因此不会影响 count 或 `#analysisPanel`。对 materialized fork，reducer 只接收 fork metadata 与 continuation；inherited Raw／model／turn／token seed 以及 inherited Logical event 都不能成为 child comparison predecessor 或 owner。

No new long-lived private Materialized Session field is planned. Temporary seeds are deleted before the public Materialized object is returned. Public facts participate in existing canonical validation and materialized fingerprinting, and the resulting Session is governed by the existing owner/admission/eviction lifecycle. The deterministic pre-materialization weight proxy remains unchanged and does not inspect those public facts. / 不计划增加长期 private Materialized Session field。临时 seed 在返回 public Materialized object 前删除；public fact 参与既有 canonical validation 与 materialized fingerprint，所得 Session 继续受既有 owner／admission／eviction lifecycle 管理。Deterministic pre-materialization weight proxy 保持不变，也不检查这些 public fact。

### Why the demo sidecar is rejected / 为什么不采用 demo sidecar

The prototype’s `/api/demo/cache-observation/...` route, analysis-time parallel fetch, browser-global observation maps, and source-kind branches were appropriate disposable plumbing. In production they would duplicate materialization work, hydrate source rows again, eagerly send full observations, bypass exact canonical/presentation validation, recompute on repeated requests, complicate revision cancellation, and risk using inherited fork rows. The production design instead enriches one owned Materialized Session once and lets existing revision caching, DTO pagination, and detail hydration carry the feature. / Prototype 的独立 demo route、analysis-time parallel fetch、browser-global observation map 与 source-kind branch 适合 disposable plumbing；进入 production 后却会重复 materialization、再次 hydrate source row、eagerly 发送完整 observation、绕过 exact canonical／presentation validation、在重复请求时重算、使 revision cancellation 更复杂，并可能误用 inherited fork row。正式设计改为一次 enrich 一个 owned Materialized Session，再由现有 revision cache、DTO pagination 与 detail hydration 承载功能。

## Domain and detection contract / Domain 与 detection contract

### Shared module / 共享模块

Add `src/cache-observation.js` as a pure source-neutral domain module. It owns normalized validation, exact integer arithmetic, `reuseBasisPoints`, relative deltas, comparison states, deterministic reason codes, and `CACHE_DISCONTINUITY_POLICY_V1`. It has no filesystem, Codex, server, browser, or i18n dependency. / 新增纯 source-neutral domain module `src/cache-observation.js`，负责 normalized validation、精确整数运算、`reuseBasisPoints`、relative delta、comparison state、确定性 reason code 与 `CACHE_DISCONTINUITY_POLICY_V1`；不得依赖 filesystem、Codex、server、browser 或 i18n。

A normalized valid observation has:

- `inputTokens` and `cachedInputTokens`: present, finite non-negative safe integers; explicit zero is valid;
- `cachedInputTokens <= inputTokens`;
- optional `outputTokens` and `totalTokens`: independently normalize to a finite non-negative safe integer or `null`; a malformed optional does not invalidate otherwise-valid required accounting;
- derived `uncachedInputTokens = inputTokens - cachedInputTokens`;
- `reuseBasisPoints = floor(cachedInputTokens * 10_000 / inputTokens)` when input is positive, otherwise `null` for the valid zero/zero case. / `inputTokens` 为正时按上述公式计算；合法的 zero/zero case 为 `null`。

Missing or malformed required fields, negative/fractional/non-finite/unsafe required values, or `cachedInputTokens > inputTokens` produce no public `cacheObservation`. Such a `token_count` remains a comparison barrier so two valid observations are never compared across malformed or missing required accounting. Missing is never coerced to zero. Optional output/total fields degrade independently to `null` and do not alter classifier validity. / required field 缺失或 malformed、required value 为负数／小数／non-finite／unsafe，或 `cachedInputTokens > inputTokens` 时，不创建 public `cacheObservation`。该 `token_count` 仍是 comparison barrier，因此不会跨过 malformed／missing required accounting 比较两条 valid observation；missing 绝不转成 zero。Optional output／total field 独立降为 `null`，不改变 classifier validity。

Codex candidate selection preserves the prototype’s exact precedence: / Codex candidate selection 保持 prototype 的精确优先级：

1. `payload.info.last_token_usage`;
2. direct token fields on `payload.info`;
3. direct token fields on `payload`.

A candidate is selected only when that exact node owns at least one of `input_tokens`, `cached_input_tokens`, `output_tokens`, or `total_tokens`. Nested `total_token_usage` is cumulative and is never substituted for a selected or missing `last_token_usage`. If `last_token_usage` is present but incomplete, the implementation fails closed instead of falling through to cumulative totals. / 只有该 exact node 自身含上述任一字段时才选中。Nested `total_token_usage` 属于 cumulative usage，绝不替代已选中或缺失的 `last_token_usage`；若 `last_token_usage` 存在但不完整，应 fail closed，而不是 fallback 到 cumulative total。

### Frozen discontinuity policy / 冻结的 discontinuity policy

The exact v1 classifier is true only when all five predicates hold, using integer/BigInt cross-multiplication rather than floating-point thresholds: / v1 classifier 只有五个 predicate 全部成立时为 true，并使用 integer／BigInt cross multiplication，禁止 floating-point threshold：

| Ordered gate / 有序 gate | Exact predicate / 精确条件 |
| --- | --- |
| Previous cache-read floor / 前次 cache-read 下限 | `previous.cachedInputTokens >= 8_192` |
| Previous reuse floor / 前次 reuse 下限 | `previous.reuseBasisPoints >= 7_500` |
| Comparable input floor / 当前 input 可比下限 | `current.inputTokens * 4 >= previous.inputTokens * 3` |
| Cache-read halving / cache-read 至少减半 | `current.cachedInputTokens * 2 <= previous.cachedInputTokens` |
| Absolute cache-read drop / cache-read 绝对下降 | `previous.cachedInputTokens - current.cachedInputTokens >= 8_192` |

Reason codes are emitted in that table order. Multiple failed gates remain ordered; ordering must not depend on object enumeration, locale, timestamps, or test construction. `comparable` means only that the pair was eligible and did not satisfy all five gates; it does not mean the cache is still valid. / Reason code 按表中顺序产生；多个 failed gate 的顺序不得依赖 object enumeration、locale、timestamp 或 test 构造。`comparable` 只表示 pair 可比较但未同时满足五个 gate，不表示 cache 仍然有效。

### Adjacent comparison lifecycle / 相邻比较 lifecycle

Valid observations are consumed in physical raw order. A valid observation compares only with the immediately preceding valid observation unless a malformed/missing `token_count` reset the predecessor. Comparison-state precedence is fixed: / Valid observation 按 physical raw order 消费；除非 malformed／missing `token_count` 已重置 predecessor，否则只与紧邻的前一条 valid observation 比较。Comparison-state precedence 固定为：

1. `no_previous_observation`;
2. `unknown_or_non_monotonic_timestamp` when either timestamp is invalid or current is not strictly later;
3. `model_change` when both explicit models are known and differ;
4. `compaction_boundary` when compaction generations differ;
5. `cache_discontinuity` when every policy gate passes;
6. `comparable` otherwise.

Every valid current observation becomes the next predecessor even when its edge was excluded by timestamp, model, or compaction. A missing/malformed observation alone clears the predecessor. Explicit compaction increments an epoch but does not end turn ownership. / 每条 valid current observation 都会成为下一 predecessor，即使其当前 edge 因 timestamp、model 或 compaction 被排除；只有 missing／malformed observation 会清空 predecessor。显式 compaction 增加 epoch，但不结束 turn ownership。

Elapsed time is recorded only for strictly increasing parseable timestamps whose difference is a safe integer; otherwise the edge uses `unknown_or_non_monotonic_timestamp` with `elapsedMs: null`. Elapsed has no minimum or maximum classifier threshold. The exact same token pair must classify identically at short and long elapsed intervals. / Elapsed 只在 timestamp 可解析、严格递增且差值为 safe integer 时记录；否则 edge 使用 `unknown_or_non_monotonic_timestamp` 与 `elapsedMs: null`。Elapsed 不设 classifier minimum／maximum threshold；相同 token pair 在短、长 elapsed 下必须得到相同 classification。

### Public Protocol fact / Public Protocol fact

Each valid owned Protocol `token_count` event may receive one optional source-neutral `cacheObservation` fact. Its v1 shape is exact and versioned: / 每个 valid owned Protocol `token_count` event 可获得一个 optional source-neutral `cacheObservation` fact；v1 shape 必须 exact 且 versioned：

```text
cacheObservation {
  schemaVersion: 1
  inputTokens
  cachedInputTokens
  uncachedInputTokens
  outputTokens: integer | null
  totalTokens: integer | null
  reuseBasisPoints: integer | null
  comparison {
    state
    reasonCodes[]
    previousEventId: string | null
    elapsedMs: integer | null
    previousInputTokens: integer | null
    inputDeltaTokens: integer | null
    inputDeltaBasisPoints: integer | null
    previousCachedInputTokens: integer | null
    cachedInputDeltaTokens: integer | null
    previousReuseBasisPoints: integer | null
  }
}
```

Only a Protocol `token_count` event may own this fact in v1. `previousEventId`, when present, must resolve to an earlier owned Protocol `token_count` event. `comparison.state` is the sole discontinuity truth; no redundant boolean is retained. Full turn-owner diagnostics remain transient; they are used to build links, not retained as source-neutral cache semantics. / v1 中只有 Protocol `token_count` event 可以持有该 fact。`previousEventId` 存在时必须解析到更早的 owned Protocol `token_count` event；`comparison.state` 是 discontinuity 的唯一 truth，不保留冗余 boolean。完整 turn-owner diagnostic 保持 transient，只用于构造 link，不作为 source-neutral cache semantic 长期保留。

## Codex extraction, ownership, and anchoring / Codex extraction、ownership 与 anchoring

Add `src/codex-cache-observation.js`. It owns Codex payload extraction, materialization-only seed capture, model and compaction epochs, raw-order lifecycle reconstruction, observation-to-owner association, and Main anchoring. It delegates all normalized math/classification to `src/cache-observation.js`. / 新增 `src/codex-cache-observation.js`，负责 Codex payload extraction、materialization-only seed capture、model／compaction epoch、raw-order lifecycle reconstruction、observation→owner association 与 Main anchoring；所有 normalized math／classification 委托给 `src/cache-observation.js`。

The owner reducer contract is frozen as follows: / Owner reducer contract 冻结如下：

- `turn_started` or canonical `task_started` with `turn_id` opens an explicit owner and supplies the strongest `explicit_lifecycle` evidence.
- A legacy user-message boundary opens an implicit owner when no compatible active owner exists. Mirrored `response_item`/`event_msg` copies of the same user message stay in one owner. A later distinct legacy user boundary opens a new implicit owner. / Legacy user-message boundary 在不存在 compatible active owner 时开启 implicit owner；相同 user message 的 mirrored `response_item`／`event_msg` copy 保持同 owner；后续不同的 legacy user boundary 开启新的 implicit owner。
- `turn_context.turn_id` may corroborate or alias an implicit owner and supplies `legacy_turn_context` evidence. It is not the sole general ownership algorithm. A contradictory explicit active owner fails closed. / `turn_context.turn_id` 可 corroborate 或 alias implicit owner，并提供 `legacy_turn_context` evidence；它不是唯一的一般 ownership algorithm。若与 explicit active owner 矛盾则 fail closed。
- Canonical Raw `turnId` evidence remains lower priority than explicit lifecycle and legacy context. For token observations, ownership is reconstructed from raw order rather than trusting the Logical event’s turn field as the sole source. / Canonical Raw `turnId` evidence 的优先级低于 explicit lifecycle 与 legacy context。Token observation 的 ownership 从 raw order 重建，不把 Logical event turn field 当作唯一来源。
- `turn_complete`, canonical `task_complete`, and `turn_aborted` close the active owner but retain it as the last owner for trailing TokenCount records. Matching repeated completion/context evidence may remain trailing; contradictions fail closed. / `turn_complete`、canonical `task_complete` 与 `turn_aborted` 关闭 active owner，但保留为 trailing TokenCount 的 last owner；matching repeated completion／context evidence 可继续 trailing，矛盾则 fail closed。
- Compaction never closes an owner. Rollback clears active/last ownership and establishes `rollback_boundary` ambiguity until a new trustworthy boundary appears. / Compaction 不关闭 owner。Rollback 清空 active／last ownership，并建立 `rollback_boundary` ambiguity，直到出现新的可信 boundary。
- Event association collects all known owners from Raw refs. Zero known owners is unknown, one known owner plus unknown refs is accepted, and two distinct known owners is `conflicting_raw_ref_owners`. No timestamp fallback exists. / Event association 收集 Raw ref 中的全部 known owner；零个 known owner 为 unknown；一个 known owner 加若干 unknown ref 可接受；两个不同 known owner 为 `conflicting_raw_ref_owners`；不存在 timestamp fallback。
- A canonical Main event `turnId`, when present and internally valid, may provide the event’s explicit owner and outranks conflicting auxiliary Raw refs exactly as the prototype test established. / Canonical Main event `turnId` 存在且内部有效时，可提供 event 的 explicit owner，并按 prototype test 已验证的行为优先于冲突的辅助 Raw ref。
- Evidence tiers are ordered `explicit_lifecycle` > `legacy_turn_context` > `canonical_raw_turn_id` > `implicit_user_turn`. / Evidence tier 顺序如左。

Discontinuities group by resolved owner. For each owner, choose the first discontinuity by raw order, then choose the eligible same-owner Main event whose latest Raw ref is nearest at or before that discontinuity. Break equal-raw-order ties by later Logical order. One owner yields at most one Main affordance, whose Protocol IDs remain in raw order. Any ownership, raw-order, or anchor ambiguity yields no link. / Discontinuity 按 resolved owner 分组。对每个 owner，先按 raw order 选择 first discontinuity，再选择其 latest Raw ref 位于该 discontinuity 之前或同位置且最近的 eligible same-owner Main event；raw order 相同时用较后的 Logical order tie-break。每个 owner 最多产生一个 Main affordance，Protocol ID 保持 raw order。任何 ownership、raw-order 或 anchor ambiguity 都不产生 link。

## Canonical presentation-index design / Canonical presentation-index 设计

Extend the exact Materialized Session shape to: / 将 exact Materialized Session shape 扩展为：

```text
presentationIndexes {
  codeModeDeclaredRequests: Map
  cacheDiscontinuityLinks {
    protocolEventIdsByMainEventId: Map<MainEventId, readonly ProtocolEventId[]>
    mainEventIdByProtocolEventId: Map<ProtocolEventId, MainEventId>
  }
}
```

Canonical validation must require both top-level fields for every Materialized Session and exact nested keys for `cacheDiscontinuityLinks`. Claude Code, DeepSeek Harness, and Codex Sessions with no reliable discontinuities use both empty link maps. Browser and shared query code consume the fact without `sourceKind` branches. / Canonical validation 对每个 Materialized Session 都要求两个 top-level field，并要求 `cacheDiscontinuityLinks` 的 exact nested keys。Claude Code、DeepSeek Harness 与无可靠 discontinuity 的 Codex Session 使用两个空 link map。Browser 与 shared query code 不通过 `sourceKind` branch 消费该 fact。

Validation requires:

- every Main key resolves to one owned `layer === 'main'` event;
- every Protocol ID resolves to one owned `layer === 'protocol'`, `subtype === 'token_count'` event with a valid discontinuity fact;
- each list is non-empty, duplicate-free, and ordered by raw order;
- each Protocol ID occurs in exactly one Main list;
- forward and reverse maps are exact inverses;
- no link points into inherited materialized-fork context;
- maps contain no accessors or extra properties. / Map 不含 accessor 或额外 property。

This is presentation-only association. Main events are not mutated with cache semantics, and query/event counts and identities remain unchanged. / 该关联仅属于 presentation；Main event 不写入 cache semantic，query／event count 与 identity 保持不变。

## Timeline, detail, and browser contract / Timeline、detail 与 browser contract

### Timeline DTO / Timeline DTO

The list DTO sends only rendering/navigation facts: / List DTO 只发送 rendering／navigation fact：

- Protocol `cacheUsage`: input, cached input, reuse basis points, and optional output;
- Protocol discontinuity summary: a projection-time boolean derived from `comparison.state`, plus optional elapsed and previous cached input for the compact comparison line;
- Protocol reverse-link Main event ID when reliable;
- Main link: first Protocol target ID and aggregate count.

The list DTO must not include the full previous/current input comparison, deltas, reason-code list, cumulative summary, turn-owner diagnostics, or the entire `cacheObservation`. Those remain in the Materialized Session and detail path. / List DTO 不得包含完整 input 前后 comparison、delta、reason-code list、cumulative summary、turn-owner diagnostic 或整个 `cacheObservation`；这些只留在 Materialized Session 与 detail path。

### Detail / Detail

Codex detail uses the event’s normalized fact and existing structured section contracts. A valid Token usage section presents Input, Cached, Cache reuse ratio, and Output in that order. The Inspector adds Comparison Context with every frozen field and the fixed notice for an inferred discontinuity. It does not fabricate provider, client version, context identity, cause, expiration, or TTL fields. / Codex detail 使用 event 的 normalized fact 与既有 structured section contract。Valid Token usage section 按 Input、Cached、Cache reuse ratio、Output 顺序展示。Inspector 增加含全部冻结字段的 Comparison Context，并对 inferred discontinuity 增加固定 notice；不得伪造 provider、client version、context identity、cause、expiration 或 TTL field。

The negative inference notice is localized and exact in meaning: inference from adjacent token accounting is not explicit upstream cache-expiry evidence. Copy tests separately allow this fixed negative notice while rejecting positive/causal expiry, TTL, “likely”, and “because/due to” language elsewhere. / 否定式 inference notice 的本地化语义必须精确：相邻 token accounting 推断并非上游显式 cache-expiry evidence。Copy test 单独允许这条固定否定 notice，同时拒绝其它位置的正向／因果 expiry、TTL、“likely” 与 “because／due to” 表述。

### Cross-layer navigation / 跨 layer 导航

Main affordances use the existing exact-event envelope and temporary-reveal mechanics after changing the Layer. The target must be selected even when it is beyond the loaded page, excluded by a structured filter, or absent from the current canonical result array. A temporary target must not mutate canonical timeline membership, counts, pagination offsets, filter state, or saved folding overrides. Leaving the target clears temporary presentation state through the existing lifecycle. / Main affordance 在切换 Layer 后使用既有 exact-event envelope 与 temporary-reveal mechanism。即使 target 位于未加载页、被 structured filter 排除或不在当前 canonical result array 中，也必须被选中。Temporary target 不得改变 canonical timeline membership、count、pagination offset、filter state 或已保存 folding override；离开 target 后按既有 lifecycle 清除 temporary presentation state。

The Protocol Inspector renders “View Main context” only from a validated reverse link. Both directions select a real existing event; neither creates a presentation row that claims canonical event membership. / Protocol Inspector 只根据已验证 reverse link 显示 “View Main context”。两个方向都选中真实既有 event；不得创建声称属于 canonical event membership 的 presentation row。

## Why ProjectQueryStore stays unchanged / 为什么不修改 ProjectQueryStore

Every v1 surface begins with a selected Session and already crosses the Materialized Session boundary. Project Scope discovery/filtering, Session-list summaries, and project cache columns are explicit non-goals. Adding cache data to ProjectQueryStore would retain per-token facts for every indexed candidate, require a schema/domain migration, expand resident bytes, and risk the new LIGHT Pass-A boundary without serving an accepted v1 UX. / v1 的每个 surface 都从已选 Session 开始，并已跨过 Materialized Session boundary。Project Scope discovery／filter、Session-list summary 与 project cache column 都是明确 non-goal。向 ProjectQueryStore 加入 cache data 会为每个 indexed candidate 常驻 per-token fact、要求 schema／domain migration、扩大 resident byte，并威胁新建立的 LIGHT Pass-A boundary，却不服务任何已接受的 v1 UX。

Hard invariants are `PROJECT_QUERY_STORE_SCHEMA_VERSION === 2`, digest domain `project-query-projection-v1`, identical projected rows/digests for baseline fixtures, and no cache field access from the packed project-query path. / Hard invariant 包括 schema version 继续为 2、digest domain 继续为 `project-query-projection-v1`、baseline fixture 的 projected row／digest 完全相同，以及 packed project-query path 不读取 cache field。

The invariant also covers projection inputs: canonical `token_count` `label`, `preview`, `searchText`, and every other field consumed by ProjectQueryStore/project-query projection remain byte-for-byte unchanged when only empty cache presentation indexes or later Materialized cache facts are added. M1 tests cover empty-index row/digest parity; M2 covers a real Materialized fact; M3 covers presentation copy without semantic-input mutation. / 该 invariant 也覆盖 projection input：当只增加 empty cache presentation index、或后续增加 Materialized cache fact 时，canonical `token_count` 的 `label`、`preview`、`searchText` 及 ProjectQueryStore／project-query projection 消费的其它字段保持 byte-for-byte 不变。M1 test 覆盖 empty-index row／digest parity；M2 覆盖真实 Materialized fact；M3 覆盖 presentation copy 且不修改 semantic input。

## Why Claude Code and DeepSeek Harness are deferred / 为什么延期 Claude Code 与 DeepSeek Harness

The validated classifier and ownership lifecycle are Codex-specific evidence derived from Codex `token_count`, `last_token_usage`, lifecycle envelopes, and real Codex corpus checks. Claude Code and DeepSeek Harness have not passed equivalent source-contract and corpus validation. Implementing them now would turn a source-neutral seam into unvalidated cross-source semantics. V1 therefore gives them the canonical empty index shape only; a future source producer requires its own evidence and plan. / 已验证 classifier 与 ownership lifecycle 来自 Codex `token_count`、`last_token_usage`、lifecycle envelope 与真实 Codex corpus。Claude Code 与 DeepSeek Harness 尚未经过等价 source-contract／corpus validation；现在实现会把 source-neutral seam 变成未经验证的跨 source semantic。因此 v1 只让它们满足 canonical empty-index shape；未来 producer 必须有独立 evidence 与计划。

## Test and acceptance matrix / 测试与验收矩阵

### Domain/classifier / Domain/classifier

- exact pass/fail boundaries for all five ordered policy gates, including equality and one-unit-outside cases;
- explicit cached input zero versus missing cache field;
- malformed required values: negative, fractional, non-finite, unsafe, cached greater than input, and incomplete selected `last_token_usage`; malformed optional output/total independently degrade to `null` without changing validity;
- extraction precedence proving `last_token_usage` wins and cumulative `total_token_usage` is never substituted;
- first observation and post-invalid reset;
- short and long elapsed parity, plus invalid/non-monotonic timestamps;
- known-same, known-different, and one-side-unknown model context;
- compaction edge exclusion followed by normal same-epoch comparison;
- exact delta and basis-point integer rounding, including zero denominator;
- deterministic comparison-state and multi-reason-code ordering;
- wording/semantic assertion that `comparable` does not mean cache validity. / 文案／语义断言 `comparable` 不代表 cache validity。

### Codex attribution and anchoring / Codex attribution 与 anchoring

- explicit `turn_started`/`task_started` lifecycle;
- implicit legacy user turn and mirrored user envelopes;
- trailing TokenCount after complete and abort;
- compaction does not end owner;
- `turn_context` alias/corroboration and evidence priority;
- unknown Raw ref plus one consistent known owner;
- two conflicting known owners;
- conflicting turn context/completion;
- rollback ambiguity and completion-without-active-turn;
- canonical Main turn ID precedence where the prototype proved it;
- no timestamp fallback under adjacent timestamps;
- nearest same-owner Main event before the first discontinuity, including raw-order ties and a later assistant event that must not be selected;
- same-owner multi-discontinuity aggregation and deterministic first target;
- no Main link when owner, raw order, or anchor is unreliable. / owner、raw order 或 anchor 不可靠时不生成 Main link。

### Fork ownership / Fork ownership

- a materialized child whose copied prefix contains valid/cache-discontinuity observations receives no predecessor, observation, owner, or link from inherited context;
- child continuation observations classify normally from continuation-only state;
- inherited model/compaction/turn signals do not alter continuation classification;
- fork metadata and continuation retain existing Raw segment presentation and canonical counts;
- pointer/non-materialized ancestry behavior stays unchanged. / pointer／non-materialized ancestry 行为保持不变。

### Canonical, query, and lifecycle invariants / Canonical、query 与 lifecycle invariant

- Raw Record count, Logical Event count, event ID list, layer, kind, subtype, and Raw refs remain unchanged;
- cache facts validate exact shape, ownership, integer bounds, previous-event order, and `comparison.state` as the sole discontinuity truth;
- `presentationIndexes` rejects missing/extra fields, non-inverse maps, duplicates, wrong layers, non-discontinuities, foreign IDs, inherited IDs, and accessors;
- all three adapters emit the same exact presentation-index shape; unsupported sources use empty maps;
- Indexed Sessions retain no cache observations or presentation maps;
- ProjectQueryStore schema, domain, rows, digests, accounted bytes, and packed-query behavior remain unchanged;
- materialized public/private fingerprint validation accepts valid facts and rejects post-hook mutation;
- the deterministic IndexedSession-derived cache-weight proxy remains unchanged, while enriched Sessions use the same owner/eviction lifecycle; / deterministic IndexedSession-derived cache-weight proxy 保持不变，enriched Session 使用同一 owner／eviction lifecycle；
- concurrent and repeated same-revision requests coalesce/reuse one enriched Materialized Session and do not rerun the expensive finalizer;
- revision retirement/cancellation cannot admit a partially enriched Session. / revision retirement／cancellation 不得准入 partially enriched Session。

### Presentation and detail / Presentation 与 detail

- ordinary Token usage renders Input, Cached, reuse ratio, and Output without a discontinuity badge;
- explicit zero renders as zero, while invalid/missing accounting does not invent metrics;
- discontinuity marker and compact elapsed/cache transition;
- same-turn aggregate Main copy for one and many cases;
- full Comparison Context fields and exact negative inference notice in English and Chinese;
- copy audit rejects expiry/expiration/TTL/likely-cause language outside the fixed negative notice;
- no cache card appears in `#analysisPanel`;
- Main affordance exists only with a reliable forward link; Protocol action exists only with a reliable reverse link;
- Main → Protocol and Protocol → Main select the exact real events;
- pagination, active structured filters, profile-hidden targets, temporary reveal, locale change, Session change, Layer change, and stale/aborted detail requests preserve existing transition safety;
- timeline DTO tests prove full comparison/turn diagnostics are absent from list responses. / Timeline DTO test 证明完整 comparison／turn diagnostic 不进入 list response。

### End-to-end inference / 端到端 inference

At least one fixture-driven test must begin with source Raw Records and prove the entire chain: / 至少一个 fixture-driven test 必须从 source Raw Record 开始，证明完整链路：

```text
Raw Records
-> owned raw-order turn reducer
-> selected last_token_usage
-> normalized token_count cacheObservation
-> adjacent discontinuity classification
-> bidirectional presentation index
-> Main affordance
-> Protocol temporary/canonical reveal
-> real detail Comparison Context
-> View Main context
```

Browser tests that inject preconstructed `mainAffordances` or observation sidecars are insufficient as the sole evidence. They may be used only as focused renderer tests alongside the source-to-UI fixture. / 只注入预构造 `mainAffordances` 或 observation sidecar 的 browser test 不能作为唯一证据；只能与 source→UI fixture 并存，作为 focused renderer test。

### Package and release suites / Package 与 release suites

- add both new Node modules to the explicit npm `files` allowlist and exact package-manifest test;
- run focused tests at each milestone, then `npm run build:check`, `npm test`, `npm run test:browser`, and `npm run test:package` before M5 closeout;
- run `npm run release:check` in M5 after generated assets and docs are final;
- do not publish as part of this plan. / 本计划不执行 publish。

## Real-corpus acceptance / 真实语料验收

M4 freezes one local recent-Codex snapshot and records only aggregate counts, durations, evidence tiers, comparison states, and mapping outcomes. No transcript content, prompts, outputs, paths, Session IDs, event IDs, model strings, or per-session rows may leave the local audit. / M4 封存一份本地近期 Codex snapshot，只记录 aggregate count、duration、evidence tier、comparison state 与 mapping outcome；不得输出 transcript content、prompt、output、path、Session ID、event ID、model string 或 per-session row。

On the identical sealed snapshot, compare the production implementation with a read-only prototype-oracle runner or an extracted frozen semantic oracle. Acceptance requires: / 在同一 sealed snapshot 上，将 production implementation 与只读 prototype oracle runner 或抽出的冻结 semantic oracle 比较。验收要求：

- exact parity for normalized valid observation membership, comparison states, discontinuity event positions, and threshold results, except for explicitly documented prompt-mandated malformed-input hardening;
- exact parity for previously strict owner mappings and no unexplained owner regression;
- every production Main link resolves to the same reconstructed owner and an eligible preceding Main anchor;
- aggregate evidence-tier and unmapped-reason reports, with all conflicts fail-closed;
- explicit checks that compaction edges are excluded and both short/long elapsed examples retain classification parity;
- a deterministic sample of at least 20 mapped discontinuities, or all if fewer than 20, manually reviewed locally for wrong-turn attribution, reporting only the aggregate pass/fail count;
- a deterministic sample of ordinary no-discontinuity Sessions confirming quiet presentation;
- historical 115/50/100 values shown only as prior evidence, never as expected counts. / 历史 115／50／100 只作为 prior evidence，不作为 expected count。

Any unexplained classifier or owner-set difference stops M4. Do not tune thresholds to recover historical counts. / 任何无法解释的 classifier 或 owner-set difference 都使 M4 停止；不得为恢复历史 count 而调 threshold。

## Performance and lifecycle gates / 性能与 lifecycle gate

### Hard structural gates / Hard structural gate

- Cache extraction/classification is never called by relationship Pass A, and LIGHT evidence gains no token-count object, payload fragment, comparison array, owner map, or cache summary.
- The number of relationship source verifications, LIGHT/FULL decisions, full Pass-A constructions, cycle parses, final canonical parses, and accepted-prefix bytes remains exactly equal to the baseline on the same fixtures/corpus.
- Source-backed Index construction produces no cache observation and no non-empty cache link index.
- ProjectQueryStore schema/domain/rows/digests/accounted bytes remain exactly unchanged.
- A cold Materialized Session miss adds at most one bounded seed-capture pass already inside canonical construction and one linear `O(raw + logical)` finalization using Maps; no per-token nested scan and no second source read are allowed.
- A same-revision cache hit performs zero parsing, seed extraction, turn reduction, or cache finalization.
- The existing deterministic cache-weight estimator remains derived from IndexedSession bytes/counts and unchanged; the 256 MiB/12 policy, prewarm admission model, and oversize-foreground exception remain unchanged. M4 separately measures forced-GC aggregate retained-memory delta for representative and high-density materializations. / 既有 deterministic cache-weight estimator 继续只由 IndexedSession bytes／counts 派生且保持不变；256 MiB／12 policy、prewarm admission model 与 oversize-foreground exception 保持不变。M4 另行测量 representative／high-density materialization 的 forced-GC aggregate retained-memory delta。

### Measured gate / 测量 gate

Before M2 implementation is accepted, capture a content-free strict-materialization baseline on one sealed corpus using balanced fresh processes. M4 repeats BASE and candidate in at least five balanced pairs and reports materialization median, p95, max, source-read/verification counts, cache-finalizer invocation counts, retained estimated bytes, and cache-hit latency aggregates. / M2 implementation 获接受前，需用 balanced fresh process 在一份 sealed corpus 上捕获 content-free strict-materialization baseline。M4 至少执行五组 balanced BASE／candidate paired run，并报告 materialization median／p95／max、source-read／verification count、cache-finalizer invocation count、retained estimated byte 与 cache-hit latency aggregate。

A candidate regression is blocking when either paired median exceeds both 10 ms and 10% of BASE, or paired p95 exceeds both 50 ms and 15% of BASE. A noisy or unstable measurement is not a pass; repeat or stop for review. These are implementation-review guardrails, not product SLAs. / 若 paired median 同时超过 BASE 的 10 ms 与 10%，或 paired p95 同时超过 BASE 的 50 ms 与 15%，candidate regression 即为 blocking。噪声大或不稳定的 measurement 不算通过，应重复或停下评审。这些只是 implementation-review guardrail，不是 product SLA。

## Documentation and release plan / 文档与 release 计划

M5 updates English and Chinese meaning together in the same change for: / M5 在同一次变更中同步更新中英文含义，覆盖：

- `CONTEXT.md` for canonical terms and forbidden causal/expiry wording;
- `docs/product-specs/session-transcript-analyzer.md` for user-visible Codex-only behavior and non-goals;
- `docs/design-docs/logical-event-timeline.md` for Protocol ownership, no-new-event invariants, DTO/detail responsibilities, and cross-layer presentation links;
- `docs/design-docs/codex-protocol-event-coverage.md` for the existing `token_count` subtype and optional observation/detail behavior;
- `docs/design-docs/transcript-source-adapters.md` for the source-neutral optional fact/index seam and empty unsupported-source shape;
- `docs/design-docs/indexed-materialized-session-lifecycle.md` for request-time enrichment, fork-prefix exclusion, fingerprint/weight/cache reuse, and Pass-A/ProjectQueryStore boundaries.

Add bilingual `docs/design-docs/cache-observation-and-discontinuity.md`. The classifier, validation, turn reducer, presentation-index invariants, inference language, performance boundary, and extension rules are sufficiently cross-cutting to deserve one durable design document rather than being scattered across existing documents. / 新增双语 `docs/design-docs/cache-observation-and-discontinuity.md`。Classifier、validation、turn reducer、presentation-index invariant、inference language、performance boundary 与 extension rule 足够跨领域，应集中在一份长期设计文档，而不是散落在现有文档中。

This plan judges Cache Observation to be a public 0.2.0 capability because it adds visible Protocol cards and cross-layer navigation. M5 therefore adds one concise aligned feature/limitation entry to `README.md` and `README.zh-CN.md`, explicitly saying Codex-only and inference-based; it must not expand into a tutorial or duplicate the design document. / 本计划判断 Cache Observation 应作为 0.2.0 public capability，因为它新增可见 Protocol card 与 cross-layer navigation。因此 M5 会在 `README.md` 与 `README.zh-CN.md` 中加入一条简洁、对齐的 feature／limitation 说明，明确 Codex-only 且 inference-based；不得扩写成教程或复制 design doc。

Update `CHANGELOG.md` only at final feature closeout. Move this plan from `active/` to `completed/` only after M5 is actually complete. Release validation does not authorize commit, push, npm publish, or GitHub release. / 只在最终 feature closeout 时更新 `CHANGELOG.md`。只有 M5 实际完成后才把本计划从 `active/` 移到 `completed/`。Release validation 不授权 commit、push、npm publish 或 GitHub release。

## Milestones and completion criteria / Milestone 与完成标准

### [x] M0 — Baseline, audit, and plan / Baseline、审计与计划

Completion criteria: / 完成标准：

- fetched and verified the live production baseline;
- created the isolated production worktree/branch with a clean starting status;
- audited current architecture, relevant tests, and the demo read-only;
- extracted the exact policy, reducer, UX, and historical evidence;
- ran and recorded build, unit, browser, and package baselines;
- wrote this self-contained active plan and stopped before implementation. / 编写本 self-contained active plan，并在 implementation 前停止。

Review boundary: approve or revise this plan. Do not start M1 automatically. / 评审边界：接受或修订本计划；不得自动开始 M1。

### [x] M1 — Shared domain and canonical contract / 共享 domain 与 canonical contract

Work completed in M1: implemented the pure shared domain module and exhaustive policy/normalization tests; extended exact `cacheObservation` and `presentationIndexes` validation; added the shared empty-index constructor; updated all production finalizers to emit the uniform empty shape; updated compact-event and package allowlists; proved ProjectQueryStore/schema/digest and canonical query inputs remain unchanged. M1 itself contained no Codex producer or UI. / M1 已完成上述 pure shared domain／canonical／empty-shape 工作；M1 本身不包含 Codex producer 或 UI。

Completion criteria met: focused domain/canonical/adapter/package tests pass; malformed input fails closed; unsupported sources validate with empty maps; no Pass-A or project-query implementation change occurred; exact public/reason-code vocabulary is frozen in the M1 record above. / Completion criteria 已满足：focused domain／canonical／adapter／package test 通过；malformed input fail closed；unsupported source 以 empty map 通过 validation；未修改 Pass A 或 project-query implementation；exact public／reason-code vocabulary 已冻结于上述 M1 record。

Review boundary: stop for domain and canonical-shape review. / 停止等待 domain 与 canonical-shape review。

### [x] M2 — Codex materialization, comparison, and attribution / Codex materialization、comparison 与 attribution

Work completed: implemented materialization-only seed capture and Codex extraction; placed one shared finalizer after owned relationship/base finalization; implemented raw-order model/compaction/comparison state, owner reducer, fork exclusion, Main anchoring, exact bidirectional links, aggregate-only observation hooks, weighted-owner lifecycle tests, and the content-free preliminary profile. No M3 presentation work was started. / 已完成上述 materialization、reducer、fork、anchor、link、aggregate hook、weighted-owner lifecycle 与 content-free preliminary profile；未开始 M3 presentation。

Completion criteria were accepted after M2R: source-level attribution/fork/end-to-end materialization tests pass; strict and resident oracle facts/links agree; inherited prefix cannot affect continuation; Raw/Logical identity and query projection are invariant; Pass-A counters/evidence stay unchanged; same-revision hits rerun nothing; both ordinary and 384-observation stress selectors pass the unchanged conjunctive guardrails. The stress point is high-but-plausible in the aggregate corpus and remains mandatory M4 sizing and forced-GC memory evidence, not an SLA. / M2R 后 completion criteria 已正式接受；stress 仍是 M4 必须复验的 sizing 与 forced-GC memory evidence，而非 SLA。

Review boundary: stop for materialization/ownership/performance review before UI work. / UI 开始前停止等待 materialization／ownership／performance review。

### [x] M3 — Detail, timeline, and cross-layer UX / Detail、timeline 与跨 layer UX

Work completed: added the source-neutral bounded presentation projection, structured Token Usage/Comparison Context detail, localized quiet/discontinuity rendering, one aggregated Main affordance, and bidirectional exact-event navigation through the existing envelope/temporary-reveal lifecycle; regenerated the client artifact only from source. / 已完成 source-neutral bounded presentation projection、structured Token Usage／Comparison Context detail、本地化 quiet／discontinuity rendering、单个聚合 Main affordance，以及复用既有 envelope／temporary-reveal lifecycle 的双向 exact-event navigation；client artifact 只由 source 重新生成。

Completion criteria met: focused renderer/i18n/navigation/detail/query tests and the source-to-browser E2E pass; filtered and beyond-page targets use temporary canonical envelopes without persisted state mutation; browser has no source-kind branch; full observations/reason codes/owner diagnostics are absent from list DTOs; wording and analysis-panel invariants pass; canonical events/counts and ProjectQueryStore inputs remain unchanged. / Completion criteria 已满足：focused renderer／i18n／navigation／detail／query test 与 source→browser E2E 通过；filtered／beyond-page target 使用 temporary canonical envelope 且不修改持久状态；browser 无 source-kind branch；list DTO 不含 full observation／reason code／owner diagnostic；文案与 analysis-panel invariant 通过；canonical event／count 与 ProjectQueryStore input 不变。

Review boundary: stop for UX and browser-transition review. / 停止等待 UX 与 browser-transition review。

### [x] M4 — Real-corpus and performance acceptance / 真实语料与性能验收

Work completed: froze one 115-Session accepted-prefix snapshot; ran an independent demo-oracle comparison with only approved production amendments; audited every normalized/comparison/owner/anchor/link edge; reviewed deterministic mapped and quiet browser samples; ran three real density cohorts, both synthetic anchors, ten-repeat forced-GC memory characterization, lifecycle regression, and exact Pass-A/Index/ProjectQueryStore structural parity. / 已封存一份 115-Session accepted-prefix snapshot；只带已批准 production amendment 运行独立 demo oracle comparison；审计全部 normalized／comparison／owner／anchor／link edge；检查 deterministic mapped 与 quiet browser sample；完成三档真实 density cohort、两项 synthetic anchor、十轮 forced-GC memory characterization、lifecycle regression 与 Pass A／Index／ProjectQueryStore exact structural parity。

Completion criteria met: unexplained semantic/owner mismatch is `0`; all six compaction boundaries and natural short/long elapsed classes match the contract; `20/20` manual mappings have `0` wrong-turn and `10/10` quiet Sessions pass; all real and synthetic performance guardrails pass unchanged; retained memory is bounded without warm duplication or retirement accumulation; every structural invariant and full regression suite passes; aggregate reports contain no content or identity leakage. Historical prototype counts remain descriptive only. / Completion criteria 已满足：无法解释的 semantic／owner mismatch 为 `0`；六个 compaction boundary 与自然 short／long elapsed class 均符合 contract；manual mapping `20/20`、wrong-turn `0`，quiet Session `10/10`；全部 real／synthetic performance guardrail 保持原定义并通过；retained memory 有界、无 warm duplicate 或 retirement accumulation；全部 structural invariant 与 full regression suite 通过；aggregate report 不泄漏 content／identity。历史 prototype count 继续只作描述。

Review boundary: stop for corpus/performance acceptance. / 停止等待 corpus／performance acceptance。

### [x] M5 — Documentation and release closeout / 文档与 release 收口

Work completed: updated every required bilingual domain/product/design surface; added the dedicated accepted Cache design; added aligned public README capability/limit copy and Unreleased Codex changelog copy; added the durable AGENTS design anchor; audited the schema/documentation/release runbooks; retained two reusable content-free scripts and removed five one-time private-manifest/prototype-dependent scaffolds; rebuilt an already-current client asset; and changed no runtime/package allowlist or version. / 已完成全部要求的双语 domain／product／design surface、新增已接受 Cache design、对齐 README capability／limit 与 Unreleased Codex changelog 文案、增加长期 AGENTS design anchor、审计 schema／documentation／release runbook、保留两个可复用 content-free script并移除五个依赖 private manifest／prototype 的一次性 scaffold、重建本已 current 的 client asset，且未修改 runtime／package allowlist 或 version。

Completion criteria met: bilingual docs match accepted implementation; the dedicated design contains the exact extraction, arithmetic, policy, ownership, fork, materialization, presentation, navigation, and future-source boundaries; forbidden-language and cross-document audits found no positive Cache-expiry/causal claim or unsupported-source support claim; every listed build/unit/browser/package/release/diff gate passed; the runtime manifest is byte-identical to the M4-accepted state; no publish, push, commit, merge, rebase, cherry-pick, version bump, or release occurred. / Completion criteria 已满足：双语文档与已接受实现一致；dedicated design 包含精确 extraction、arithmetic、policy、ownership、fork、materialization、presentation、navigation 与 future-source boundary；禁用措辞与跨文档审计未发现正向 Cache-expiry／因果断言或 unsupported-source 支持声明；全部列出的 build／unit／browser／package／release／diff gate 通过；runtime manifest 与 M4 accepted state byte-identical；未执行 publish、push、commit、merge、rebase、cherry-pick、version bump 或 release。

Review boundary: M0–M5 are complete; await final feature closeout review and separate authorization for any commit, integration, publication, or release action. / M0–M5 已完成；等待最终 feature closeout review，任何 commit、integration、publication 或 release action 均需另行授权。

## Rollback and stop conditions / Rollback 与停止条件

Stop the active milestone and return to review if any of the following occurs: / 出现以下任一情况时停止当前 milestone 并回到评审：

- a threshold or comparison precedence must change to fit corpus counts;
- Raw/Logical counts, canonical event IDs, layers, kinds, subtypes, or refs change;
- cache computation enters Pass A, retains per-token relationship evidence, adds a second source read, or expands ordinary Index candidates;
- ProjectQueryStore schema/domain/rows/digests/accounted bytes change;
- inherited materialized-fork state affects child continuation;
- browser code requires a Codex `sourceKind` branch to render the shared fact;
- a Main link needs timestamp proximity or maps across unknown/conflicting ownership;
- full observations must be copied into every timeline DTO;
- same-revision cache hits rerun extraction/reduction/finalization;
- canonical/private/fingerprint/weight validation cannot cover the new public fields;
- the fixed copy requires expiry/TTL/likely-cause claims;
- measured materialization gates fail or remain unstable;
- real-corpus parity differs without a contract-backed explanation;
- Claude/DeepSeek, project search, analysis metrics, persistence, settings, or other non-goals become prerequisites. / Claude／DeepSeek、project search、analysis metric、persistence、settings 或其它 non-goal 变成 prerequisite。

Rollback is straightforward because v1 adds no persisted schema, ProjectQueryStore column, or new event identity. Remove the optional Protocol facts, the presentation-link index, DTO/detail projections, and UI consumption together; retain the existing `token_count` event and all baseline behavior. If a source lacks evidence or validation fails, fail closed to no observation/no link rather than emitting partial semantics. / v1 不增加 persisted schema、ProjectQueryStore column 或新 event identity，因此 rollback 清晰：一起移除 optional Protocol fact、presentation-link index、DTO／detail projection 与 UI consumption；保留现有 `token_count` event 与所有 baseline 行为。若 source 缺证据或 validation 失败，应 fail closed 为无 observation／无 link，而不是输出 partial semantic。

## M2 conclusion / M2 结论

M2 establishes the owned request-time Materialized Codex Session as the production producer seam, with no Index/Pass-A/ProjectQueryStore expansion. Real Protocol `token_count` events own validated optional facts; reliable discontinuities produce validated presentation-only Main↔Protocol links; materialized-fork inherited state is excluded before reduction; strict/resident paths share one finalizer; and the revision-scoped owner controls coalescing, reuse, eviction, cancellation, and replacement using the unchanged deterministic IndexedSession-derived weight proxy. M2R isolated and removed the unrelated shared fingerprint optimization, reduced feature-specific duplicate work, measured a stable density curve and real-corpus distribution, and passed both unchanged ordinary/stress guardrails. M2/M2R are formally accepted. At that review boundary, M3 was required to use the approved source-neutral presentation seam without browser reinterpretation and M4 was required to repeat sealed-corpus performance plus forced-GC retained-memory acceptance; both requirements are now evidenced above. / M2 建立上述 production producer seam 与 invariant，并使用未修改的 IndexedSession-derived deterministic weight proxy。M2R 已完成归因／修正并正式 accepted。在当时的 review boundary，M3 必须使用已批准的 source-neutral presentation seam 且 browser 不得重建 association，M4 必须重复 sealed-corpus performance 与 forced-GC retained-memory acceptance；两项要求现在均已有上述证据。

## M4 conclusion / M4 结论

M4 independently revalidated the completed M1–M3R feature on one frozen, content-private 115-Session Codex snapshot. Production and the frozen oracle have exact semantic parity after only the two already-approved hardening amendments; owner mapping has zero wrong-turn; real and synthetic performance pass the unchanged conjunctive gates; actual retained memory is bounded with no duplicate warm graph or accumulating retirement leak; and Pass A, Indexed Session, canonical identity, ProjectQueryStore, package, browser, and cache-owner lifecycle invariants all remain intact. M4 changed no feature runtime or UX and was formally accepted on 2026-09-03, authorizing M5 documentation/release closeout. / M4 在一份冻结且 content-private 的 115-Session Codex snapshot 上独立复验已完成的 M1–M3R feature。只应用两项此前已批准 hardening amendment 后，production 与 frozen oracle semantic exact parity；owner mapping 无 wrong-turn；real／synthetic performance 通过未修改的 conjunctive gate；actual retained memory 有界，无 duplicate warm graph 或累积 retirement leak；Pass A、Indexed Session、canonical identity、ProjectQueryStore、package、browser 与 cache-owner lifecycle invariant 全部保持。M4 未修改 feature runtime／UX，并于 2026-09-03 正式 accepted，因而授权 M5 documentation／release closeout。

## M5 conclusion / M5 结论

M5 converts the accepted feature record into durable bilingual product and architecture authority without reopening implementation. Public wording is concise and Codex-only; the dedicated design preserves the exact accounting, comparison, ownership, fork, materialization, presentation, and extension contracts; existing timeline, protocol, adapter, and lifecycle documents now point to the appropriate boundary; and the completed plan retains detailed prototype/M1–M4 evidence without turning corpus results into product guarantees. Reusable aggregate/synthetic profiling remains available while private one-time scaffolding is excluded. All release gates passed, the M4 runtime manifest stayed byte-identical, and the feature is ready for final closeout review only—commit, integration, publication, and release remain separate maintainer-authorized actions. / M5 在不重新打开 implementation 的前提下，把已接受 feature record 转化为长期双语 product／architecture authority。Public wording 简洁且明确 Codex-only；dedicated design 保留精确 accounting、comparison、ownership、fork、materialization、presentation 与 extension contract；既有 timeline、protocol、adapter 与 lifecycle 文档分别指向正确边界；completed plan 保留完整 prototype／M1–M4 evidence，且不把 corpus 结果变成产品保证。可复用 aggregate／synthetic profiling 得以保留，private 一次性 scaffold 被排除。全部 release gate 通过，M4 runtime manifest byte-identical；feature 现在只等待 final closeout review，commit、integration、publication 与 release 仍是需要维护者另行授权的动作。
