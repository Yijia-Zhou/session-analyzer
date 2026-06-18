# Schema update runbook / Schema 更新运行手册

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-06-12 / 最近更新：2026-06-12
- Related design docs: / 相关设计文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/design-docs/external-source-mapping-pressure-tests.md`
- Related plan: / 相关计划：
  - `docs/exec-plans/completed/2026-06-10-v0.1-release-hardening.md`

## Purpose / 目的

Use this runbook when an upstream transcript or agent-session schema may have changed. The goal is to produce a trusted-source diff report, fixture TODOs, a parser checklist, and docs or debt updates. This runbook does not automatically edit parser behavior.

当上游 transcript 或 agent session schema 可能发生变化时，使用本运行手册。目标是产出可信来源差异报告、fixture TODO、parser 检查清单，以及文档或技术债更新。本运行手册不会自动编辑 parser 行为。

For current v0.1 parser behavior, Codex upstream protocol and observed Codex transcript fixtures are authoritative. Claude Code, opencode, Crush, and future verified Hermes sources are comparative adapter references unless and until a corresponding source adapter is explicitly added.

对于当前 v0.1 parser 行为，Codex upstream protocol 和已观察到的 Codex transcript fixture 具有权威性。Claude Code、opencode、Crush 以及未来已验证的 Hermes 来源只作为比较性的 adapter 参考，除非并直到明确添加对应 source adapter。

## Source authority / 来源权威性

- Primary Codex sources: upstream `codex-rs/protocol/src/protocol.rs`, upstream protocol docs, and repo-local Codex fixtures. / Codex 主要来源：上游 `codex-rs/protocol/src/protocol.rs`、上游协议文档，以及仓库内 Codex fixture。
  - Protocol source: `https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs`
  - Protocol docs: `https://github.com/openai/codex/blob/main/codex-rs/docs/protocol_v1.md`
- Secondary Codex evidence: minimized local observations, generated schemas from upstream Rust types, and release notes. / Codex 次级依据：最小化后的本地观察、从上游 Rust 类型生成的 schema，以及 release notes。
- Adapter references: Claude Code docs/SDK, opencode docs/source/schema, Crush storage evidence, and any future verified Hermes source. / Adapter 参考：Claude Code 文档/SDK、opencode 文档/源码/schema、Crush 存储依据，以及未来任何已验证 Hermes 来源。
- Non-authoritative clues: blog posts, forum comments, screenshots, incomplete snippets, or unverified exports. Use them only to decide what official source or local fixture should be checked next. / 非权威线索：博客文章、论坛评论、截图、不完整片段或未验证导出。只能用它们决定下一步应检查哪个官方来源或本地 fixture。

Observed Codex transcript fixtures should default to repo-local synthetic fixtures. If a real transcript informs investigation, minimize and sanitize it before creating any committed fixture. Do not commit real `.codex/sessions` data, Claude transcripts, opencode or Crush databases, or exported agent sessions.

已观察到的 Codex transcript fixture 默认应指仓库内合成 fixture。如果真实 transcript 用于调查，创建任何提交的 fixture 前必须先最小化并脱敏。不得提交真实 `.codex/sessions` 数据、Claude transcript、opencode 或 Crush 数据库，或导出的 agent session。

## Review workflow / 审查流程

1. Identify the source family and trust level before reading fields. For v0.1 parser decisions, keep Codex sources separate from adapter-reference sources. / 先识别 source family 和信任等级，再阅读字段。对于 v0.1 parser 决策，要把 Codex 来源与 adapter 参考来源分开。
2. Compare the source against `docs/design-docs/codex-protocol-event-coverage.md`, including its coverage matrix. / 将来源与 `docs/design-docs/codex-protocol-event-coverage.md` 对比，包括其中的覆盖矩阵。
3. Classify the result using the decision tiers below. / 使用下面的决策分层对结果分类。
4. Record fixture gaps as TODOs unless a minimized, sanitized fixture is already available. / 除非已有最小化、脱敏后的 fixture，否则将 fixture 缺口记录为 TODO。
5. Propose parser behavior only when the product semantics justify it. Add focused fixtures before parser changes in the follow-up implementation. / 只有产品语义足以证明需要时，才提出 parser 行为变更。后续实现 parser 变更前应先添加聚焦 fixture。
6. Update bilingual docs together. Protocol coverage belongs in `codex-protocol-event-coverage.md`; model changes belong in `logical-event-timeline.md`; user-visible behavior changes belong in the product spec; intentional gaps belong in `tech-debt-tracker.md`. / 双语文档要同步更新。协议覆盖写入 `codex-protocol-event-coverage.md`；模型变化写入 `logical-event-timeline.md`；用户可见行为变化写入产品规格；有意保留的缺口写入 `tech-debt-tracker.md`。

## Decision tiers / 决策分层

- `docs-only`: Source wording, comments, or documentation changed, but observed Codex transcripts and parser output are unaffected. Update docs if the change clarifies maintenance guidance. / `docs-only`：来源措辞、注释或文档发生变化，但已观察 Codex transcript 和 parser 输出不受影响。如变更能澄清维护指导，则更新文档。
- `fixture TODO / coverage update`: A new event shape, field, or storage shape is observed or suspected, but sample quality, frequency, or product semantics are insufficient for parser behavior. Record the gap and desired fixture shape. / `fixture TODO / coverage update`：观察到或怀疑存在新的 event shape、字段或存储形态，但样本质量、出现频率或产品语义不足以支持 parser 行为。记录缺口和期望 fixture 形态。
- `parser behavior change proposal`: A trusted Codex source and fixture-quality evidence show that behavior should change for layer placement, kind/subtype, severity, grouping, detail rendering, search/filter, metrics, or raw traceability. This is a proposal for follow-up implementation, not an automatic edit. / `parser behavior change proposal`：可信 Codex 来源和达到 fixture 质量的依据表明，layer 归属、kind/subtype、severity、grouping、detail rendering、search/filter、metrics 或 raw traceability 应该改变。这是后续实现提案，不是自动编辑。

## Review output template / 审查输出模板

Use this template in an issue, execution plan, or maintenance note.

在 issue、执行计划或维护记录中使用以下模板。

```text
Source reviewed:
- Tool:
- Version / commit / release date:
- Source URL or local path:
- Trust level:
- Schema area:

Observed change:
- New / changed / removed field:
- Example shape:
- Affected layer:

Impact assessment:
- Raw event:
- Logical event:
- Detail panel:
- Folding:
- Search/filter:
- Metrics:
- Fixtures:
- Docs:

Decision:
- No action / docs-only / fixture TODO / parser change proposal:
- Rationale:
```

## Parser checklist / Parser 检查清单

Before proposing parser behavior, confirm:

提出 parser 行为前，确认：

- The source is a current Codex authority or an explicitly accepted adapter implementation target. / 该来源是当前 Codex 权威来源，或是已明确接受的 adapter 实现目标。
- Unknown rows would remain visible through protocol/raw fallback if no behavior change is made. / 如果不改变行为，未知行仍会通过 protocol/raw fallback 可见。
- The change preserves raw refs and source locators. / 该变更保留 raw refs 和 source locator。
- Machine identifiers remain stable and unlocalized. / 机器标识保持稳定且不被本地化。
- Fixture data is synthetic or strongly minimized and sanitized. / fixture 数据为合成数据，或经过强最小化与脱敏。
- Expected-output changes are limited to the behavior being protected. / expected output 变更仅限于被保护的行为。
