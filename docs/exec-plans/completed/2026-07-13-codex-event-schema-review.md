# Codex Event Schema Review — 2026-07-13 / Codex Event Schema 审查——2026-07-13

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Decision: `fixture TODO / coverage update`; no parser behavior change / 决策：`fixture TODO / coverage update`；不改变 parser 行为
- Related runbook: `docs/design-docs/schema-update-runbook.md` / 相关 runbook：`docs/design-docs/schema-update-runbook.md`
- Related coverage: `docs/design-docs/codex-protocol-event-coverage.md` / 相关覆盖文档：`docs/design-docs/codex-protocol-event-coverage.md`
- Related debt: `docs/exec-plans/tech-debt-tracker.md` / 相关技术债：`docs/exec-plans/tech-debt-tracker.md`

## Review scope / 审查范围

This pass checks current Codex rollout storage and protocol event shapes against the repository's Codex coverage matrix. It is a source-and-fixture review only; it does not implement parser behavior. / 本次检查将当前 Codex rollout storage 和 protocol event 形态与仓库的 Codex 覆盖矩阵进行对照。此次只做来源和 fixture 审查，不实现 parser 行为。

## Trusted-source diff report / 可信来源差异报告

### Source reviewed / 已审查来源

- Tool: official OpenAI Codex GitHub repository / 工具：OpenAI Codex 官方 GitHub 仓库
- Version / commit / release date: `main`, checked 2026-07-13; recent relevant commits include `5c19155`, `c4318c3`, `bca577d`, and `b5314ae` / 版本／commit／发布日期：`main`，于 2026-07-13 检查；近期相关 commit 包括 `5c19155`、`c4318c3`、`bca577d` 和 `b5314ae`
- Trust level: primary upstream authority / 信任级别：上游一手权威来源
- Schema area: `RolloutLine` storage envelope and `EventMsg` payloads / schema 范围：`RolloutLine` storage envelope 与 `EventMsg` payload
- Sources: [`protocol.rs`](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs), [`protocol_v1.md`](https://github.com/openai/codex/blob/main/codex-rs/docs/protocol_v1.md) / 来源：[`protocol.rs`](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)、[`protocol_v1.md`](https://github.com/openai/codex/blob/main/codex-rs/docs/protocol_v1.md)
- Recent change references: [`5c19155`](https://github.com/openai/codex/commit/5c19155cbd93bfa099016e7487259f61669823ff), [`c4318c3`](https://github.com/openai/codex/commit/c4318c386de365bd0dd9595a08d55a30bb142d11), [`bca577d`](https://github.com/openai/codex/commit/bca577d69a2f2be4550da5cd31f7bef6608c751e), [`b5314ae`](https://github.com/openai/codex/commit/b5314aea1110fa2c114d57b17f1cabbf6f512f02) / 近期变更参考：[`5c19155`](https://github.com/openai/codex/commit/5c19155cbd93bfa099016e7487259f61669823ff)、[`c4318c3`](https://github.com/openai/codex/commit/c4318c386de365bd0dd9595a08d55a30bb142d11)、[`bca577d`](https://github.com/openai/codex/commit/bca577d69a2f2be4550da5cd31f7bef6608c751e)、[`b5314ae`](https://github.com/openai/codex/commit/b5314aea1110fa2c114d57b17f1cabbf6f512f02)

### Observed change / 观察到的变更

- `RolloutLine` now has an optional top-level zero-based `ordinal` for paginated rollouts. Legacy rollout serialization remains without this field. / `RolloutLine` 现在为分页 rollout 增加可选的顶层零基 `ordinal`；legacy rollout serialization 仍不包含该字段。
- Turn lifecycle payloads expose more metadata: `turn_started`/`task_started` can carry `trace_id`, `started_at`, `model_context_window`, and collaboration mode; `turn_complete`/`task_complete` can carry terminal `error`, start/completion timestamps, duration, and time-to-first-token. / Turn 生命周期 payload 暴露了更多 metadata：`turn_started`/`task_started` 可携带 `trace_id`、`started_at`、`model_context_window` 和 collaboration mode；`turn_complete`/`task_complete` 可携带终态 `error`、开始／完成时间戳、duration 和 time-to-first-token。
- The current `EventMsg` set includes `safety_buffering`, richer `thread_settings_applied`, command process/timing/source fields, item/delta identity and timestamps, and detailed review/collaboration lifecycle payloads. / 当前 `EventMsg` 集合包含 `safety_buffering`、更丰富的 `thread_settings_applied`、command process／计时／source 字段、item/delta identity 与 timestamp，以及更详细的 review/collaboration 生命周期 payload。
- `protocol_v1.md` continues to describe `EventMsg` as non-exhaustive and the current Rust protocol types as primarily in-process rather than a stable public serde contract. / `protocol_v1.md` 继续将 `EventMsg` 描述为 non-exhaustive，并说明当前 Rust protocol type 主要是进程内类型，而不是稳定的公开 serde contract。

Synthetic example only; no real transcript data is committed. / 以下仅为合成示例；未提交真实 transcript 数据。

```json
{"timestamp":"2026-07-13T00:00:00.000Z","ordinal":42,"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-synthetic","error":{"message":"terminal failure"},"started_at":1,"completed_at":3,"duration_ms":2000}}
```

## Impact assessment / 影响评估

- Raw event: current raw parsing retains the complete source record in `raw.parsed`, and unknown `event_msg` variants remain visible through protocol/raw fallback. Top-level `ordinal` is retained inside the parsed record but is not a typed raw field or part of `rawRefs`. / Raw event：当前 raw parsing 会在 `raw.parsed` 中保留完整来源 record，未知 `event_msg` variant 继续通过 protocol/raw fallback 可见。顶层 `ordinal` 会保留在 parsed record 中，但还不是 typed raw field，也不属于 `rawRefs`。
- Logical event: task lifecycle alias routing is already covered; new fields and `safety_buffering` currently become generic protocol events. No new grouping, layer, subtype, or severity rule is justified without a sanitized fixture and product semantics. / Logical event：task 生命周期 alias 路由已有覆盖；新字段和 `safety_buffering` 当前会成为 generic protocol event。没有脱敏 fixture 和产品语义前，不增加新的分组、layer、subtype 或 severity 规则。
- Detail panel: generic protocol fields and raw JSON remain available, but field-specific sections for ordinal, terminal error/timing, safety buffering, command source/process, and new item/collaboration fields are not yet defined. / Detail panel：generic protocol fields 和 raw JSON 仍可用，但尚未定义 ordinal、终态 error／timing、safety buffering、command source／process 以及新 item/collaboration 字段的字段级 section。
- Folding: no change. Safety buffering must not be inferred as failure or an issue until its user-facing waiting semantics are fixture-backed. / Folding：不变。在其用户可见的等待语义有 fixture 支持前，不能把 safety buffering 推断为 failure 或 issue。
- Search/filter: nested payload text remains searchable through existing flattening; top-level `ordinal` is not currently indexed as event text and no new filter identifier is proposed. / Search/filter：嵌套 payload 文本继续通过现有 flattening 可搜索；顶层 `ordinal` 当前不会作为 event text 建索引，也不提出新的 filter identifier。
- Metrics: no metric change. Terminal `error` may eventually inform failure indicators, but the current pass does not establish that product contract. / Metrics：不改变指标。终态 `error` 未来可能影响 failure indicator，但本次检查不建立该产品契约。
- Fixtures: add sanitized synthetic coverage before any parser proposal; do not commit real `.codex/sessions` rows. / Fixtures：在提出 parser 方案前增加脱敏合成覆盖；不得提交真实 `.codex/sessions` 行。
- Docs: update the protocol coverage matrix and tech-debt tracker. No product-spec or logical-model update is required because no user-visible behavior or normalized model changed. / Docs：更新 protocol coverage matrix 和 tech-debt tracker。由于没有用户可见行为或 normalized model 变化，不需要更新 product spec 或 logical model。

## Fixture TODOs / Fixture TODO

1. Add a paginated rollout shape with `ordinal`, a legacy row without it, a gap/resume sequence, and an incomplete tail; assert raw JSON retention, physical source locators, and current line-order behavior. / 增加带 `ordinal` 的分页 rollout、没有该字段的 legacy 行、gap/resume 序列和 incomplete tail；断言 raw JSON 保留、物理 source locator 以及当前按行排序行为。
2. Add `task_started`/`task_complete` rows with trace, timing, context-window, collaboration-mode, and terminal-error fields; keep the expected layer as protocol fallback until a product decision exists. / 增加带 trace、计时、context-window、collaboration-mode 和终态 error 字段的 `task_started`/`task_complete` 行；在产品决策前，期望 layer 保持为 protocol fallback。
3. Add `safety_buffering`, `thread_settings_applied`, command timing/source/process, item/delta, and collab resume/sub-agent shapes with bounded detail expectations. / 增加 `safety_buffering`、`thread_settings_applied`、command 计时／source／process、item/delta 以及 collab resume/sub-agent 形态，并设定受限 detail 预期。

## Parser checklist / Parser 检查清单

- [x] Current upstream protocol source and protocol documentation were reviewed. / [x] 已检查当前上游 protocol source 和 protocol documentation。
- [x] Unknown rows remain visible through protocol/raw fallback if no behavior change is made. / [x] 不改变行为时，未知行仍会通过 protocol/raw fallback 可见。
- [x] Existing raw refs and source locators remain preserved. / [x] 现有 raw refs 和 source locator 继续保留。
- [x] Machine identifiers remain stable and unlocalized; no new identifier is proposed. / [x] machine identifier 保持稳定且不本地化；本次不提出新 identifier。
- [x] Any future fixture will be synthetic or strongly minimized and sanitized. / [x] 后续 fixture 将使用合成数据或强最小化、脱敏数据。
- [x] Expected-output changes are empty for this pass; parser behavior is deferred. / [x] 本次 expected-output 变更为空；parser behavior 延后。

## Decision and follow-up / 决策与后续

Decision: `fixture TODO / coverage update`, not `parser behavior change proposal`. The new shapes are trusted and relevant, but the repository has no committed fixture proving a different layer, grouping, severity, metric, search, or detail contract. / 决策：归类为 `fixture TODO / coverage update`，不是 `parser behavior change proposal`。这些新形态来源可信且相关，但仓库还没有提交 fixture 来证明需要改变 layer、分组、severity、指标、搜索或 detail 契约。

Follow-up order: add the focused synthetic fixtures, verify raw/source traceability, then make a separate parser proposal only for semantics that the product actually exposes. / 后续顺序：先增加聚焦的合成 fixture，验证 raw/source 可追踪性；之后只针对产品确实暴露的语义，单独提出 parser 方案。

## Validation / 验证

- Documentation updated bilingually in `codex-protocol-event-coverage.md` and `tech-debt-tracker.md`. / `codex-protocol-event-coverage.md` 和 `tech-debt-tracker.md` 已同步更新中英文。
- No parser, product behavior, or canonical logical-event DTO was changed in this pass. / 本次没有修改 parser、产品行为或 canonical logical-event DTO。
