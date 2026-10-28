# Schema update runbook / Schema 更新运行手册

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-10-28 / 最近更新：2026-10-28
- Related design docs: / 相关设计文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/design-docs/external-source-mapping-pressure-tests.md`
- Related plan: / 相关计划：
  - `docs/exec-plans/completed/2026-06-10-v0.1-release-hardening.md`

## Purpose / 目的

Use this runbook when an upstream transcript or agent-session schema may have changed. The goal is to produce a trusted-source diff report, fixture TODOs, a parser checklist, and docs or debt updates. This runbook does not automatically edit parser behavior.

当上游 transcript 或 agent session schema 可能发生变化时，使用本运行手册。目标是产出可信来源差异报告、fixture TODO、parser 检查清单，以及文档或技术债更新。本运行手册不会自动编辑 parser 行为。

For current v0.1 parser behavior, Codex upstream protocol and observed Codex transcript fixtures are authoritative for the Codex adapter. An explicitly accepted adapter target has its own evidence boundary: for this compatibility line, Claude Code `2.1.220` source facts are read-only structural evidence, and behavior is accepted only when exact source shapes, sanitized synthetic fixtures, and Protocol/Raw fallback behavior agree. A local corpus observation alone is never sufficient authority.

对于当前 v0.1 parser 行为，Codex upstream protocol 和已观察到的 Codex transcript fixture 对 Codex adapter 具有权威性。明确接受的 adapter target 具有自己的证据边界：对于本兼容线，Claude Code `2.1.220` 的来源事实只作为只读结构证据，只有在精确 source shape、脱敏合成 fixture 与 Protocol/Raw fallback 行为一致时才接纳行为。单独的本地语料观察永远不足以构成权威。

The [2.1.283 compatibility review](claude-2.1.283-compatibility.md) adds an accepted target for the exact observed Bash edit-diff shape, backed by the official 2.1.269 release notes, fresh 2.1.283 sessions, and minimized synthetic regressions. This supplements rather than replaces the earlier 2.1.220 fixtures; unobserved lifecycle shapes remain fixture TODOs. / [2.1.283 兼容性审查](claude-2.1.283-compatibility.md) 为精确观测到的 Bash 修改 diff 形态增加接纳目标，依据是官方 2.1.269 发布说明、新生成的 2.1.283 会话及最小化合成回归；它补充而不替代既有 2.1.220 fixture，未观测生命周期形态仍为 fixture TODO。

## Source authority / 来源权威性

The 2026-09-29 follow-up in that review adds exact MCP background and Monitor receipt/terminal shapes, with official feature documentation, real-client probes and synthetic ownership/reindex/browser regressions. SDK-only progress is not treated as persisted project JSONL. Text-only Monitor deadline alerts and rewritten-ID fork parent relationships remain unproven semantics. / 同一审查的 2026-09-29 后续增加精确 MCP 后台与 Monitor 回执／终态形态，以官方功能文档、真实客户端探针及合成归属／重建索引／浏览器回归为依据。仅存在于 SDK 的进度不视为持久化项目 JSONL；纯文本 Monitor 截止提示与改写 ID 分叉父级关系仍不赋予未证明的语义。

The same 2.1.283 review accepts exact SendMessage resume receipts and trusted terminal notifications observed in fresh sessions. They extend existing async-agent correlation using both task and call identity; they do not generalize to unobserved auto-mode hand-back tools. / 同一 2.1.283 审查接纳新会话中精确观测到的 SendMessage 续接回执与可信终态通知，通过 task 与 call 双重标识扩展已有异步 agent 关联，不泛化至未观测的自动模式回传工具。

- Primary Codex sources: upstream `codex-rs/protocol/src/protocol.rs`, upstream protocol docs, and repo-local Codex fixtures. / Codex 主要来源：上游 `codex-rs/protocol/src/protocol.rs`、上游协议文档，以及仓库内 Codex fixture。
  - Protocol source: `https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs`
  - Protocol docs: `https://github.com/openai/codex/blob/main/codex-rs/docs/protocol_v1.md`
- Secondary Codex evidence: minimized local observations, generated schemas from upstream Rust types, and release notes. / Codex 次级依据：最小化后的本地观察、从上游 Rust 类型生成的 schema，以及 release notes。
- Adapter references: Claude Code docs/SDK, opencode docs/source/schema, Crush storage evidence, and any future verified Hermes source. / Adapter 参考：Claude Code 文档/SDK、opencode 文档/源码/schema、Crush 存储依据，以及未来任何已验证 Hermes 来源。
- Accepted Claude compatibility evidence: the pinned Claude Code `2.1.220` target shape, read-only local corpus inventory, minimized synthetic fixtures, and fail-closed fallback tests. Client `version` remains metadata; it is not inferred as a transcript schema version. / 已接受的 Claude 兼容性证据：固定的 Claude Code `2.1.220` target shape、只读本地语料 inventory、最小化合成 fixture 与 fail-closed fallback 测试。Client `version` 继续只是 metadata，不会被推断为 transcript schema version。
- Non-authoritative clues: blog posts, forum comments, screenshots, incomplete snippets, or unverified exports. Use them only to decide what official source or local fixture should be checked next. / 非权威线索：博客文章、论坛评论、截图、不完整片段或未验证导出。只能用它们决定下一步应检查哪个官方来源或本地 fixture。

Observed Codex transcript fixtures should default to repo-local synthetic fixtures. If a real transcript informs investigation, minimize and sanitize it before creating any committed fixture. Do not commit real `.codex/sessions` data, Claude transcripts, opencode or Crush databases, or exported agent sessions.

已观察到的 Codex transcript fixture 默认应指仓库内合成 fixture。如果真实 transcript 用于调查，创建任何提交的 fixture 前必须先最小化并脱敏。不得提交真实 `.codex/sessions` 数据、Claude transcript、opencode 或 Crush 数据库，或导出的 agent session。

## Review workflow / 审查流程

Route by source family before choosing a schema or coverage matrix. This is the common decision process; source-specific probes supply evidence to it. / 先按来源选择 schema 与覆盖矩阵。本手册是共用决策流程，来源专属探针向它提供证据。

| Source / 来源 | Authority and coverage / 依据与覆盖 |
| --- | --- |
| Codex | [Protocol coverage](codex-protocol-event-coverage.md), pinned producer/serde/persistence policy and qualified fixtures / 协议覆盖、固定 producer／serde／持久化策略与合格 fixture |
| OpenCode | [Compatibility maintenance](opencode-compatibility-maintenance.md), pinned SQL/migrations/projector/message types and isolated producer probes / 兼容维护、固定 SQL／迁移／projector／消息类型与隔离 producer 探针 |
| Other accepted adapters / 其他已接纳 adapter | Source-specific evidence linked from [adapter design](transcript-source-adapters.md); another source's schema is not authority / 按 adapter 设计关联的来源专属依据；其他来源的 schema 不构成权威 |

1. Identify the source family and trust level before reading fields. For v0.1 parser decisions, keep Codex sources separate from adapter-reference sources, and keep an explicitly accepted Claude target separate from both the local observation that motivated it and the committed synthetic proof. / 先识别 source family 和信任等级，再阅读字段。对于 v0.1 parser 决策，要把 Codex 来源与 adapter 参考来源分开；明确接受的 Claude target 还必须与触发实现的本地观察、以及提交的合成证明相互区分。
2. Compare the pinned source against its routed coverage matrix. Separate source review, synthetic reader tests, imported synthetic messages and actual writer captures; runtime/API visibility alone does not prove persistence. / 将固定来源与对应覆盖矩阵比较。区分源码审查、合成 reader 测试、导入合成消息与真实 writer 采集；runtime／API 可见本身不证明持久化。
3. Classify the result using the decision tiers below. / 使用下面的决策分层对结果分类。
4. Record fixture gaps as TODOs unless a minimized, sanitized fixture is already available. / 除非已有最小化、脱敏后的 fixture，否则将 fixture 缺口记录为 TODO。
5. Propose parser behavior only when the product semantics justify it. Add focused fixtures before parser changes in the follow-up implementation. / 只有产品语义足以证明需要时，才提出 parser 行为变更。后续实现 parser 变更前应先添加聚焦 fixture。
6. Update bilingual docs together. Protocol coverage belongs in `codex-protocol-event-coverage.md`; model changes belong in `logical-event-timeline.md`; user-visible behavior changes belong in the product spec; intentional gaps belong in `tech-debt-tracker.md`. / 双语文档要同步更新。协议覆盖写入 `codex-protocol-event-coverage.md`；模型变化写入 `logical-event-timeline.md`；用户可见行为变化写入产品规格；有意保留的缺口写入 `tech-debt-tracker.md`。

For native databases, review storage compatibility before message semantics: table/column/key/index layout, migrations and external payload dependencies, ordering and update/delete behavior, project/session membership, concurrent reads, and snapshot-bound Raw locators. Unknown messages inside a readable profile may retain Protocol/Raw fallback; an unknown storage layout must produce an unsupported-source diagnostic, never a successful empty index. / 原生数据库先审查存储兼容，再审查消息语义：表／列／键／索引、迁移与外部正文依赖、排序及更新／删除、项目／会话成员、并发读取与绑定快照的 Raw locator。可读 profile 中的未知消息可保留 Protocol／Raw；未知存储布局必须明确诊断不支持，不能返回成功的空索引。

A fixed-version replay proves the baseline remains reproducible. Upgrade detection requires a separately pinned candidate and a baseline/candidate comparison with the same Analyzer and probe. A mutable `latest` label is only a discovery hint. Source/hash drift requests review; it does not by itself prove a behavior regression or authorize accepting the candidate. Ordinary PR CI uses fixed fixtures; upstream installation belongs to an explicitly invoked compatibility task. / 固定版本复跑证明基线仍可复现。升级探测需要另行固定候选版本，并使用同一 Analyzer 与探针比较基线／候选；可变 `latest` 标签仅用于发现。源码／hash 变化要求审查，本身不证明行为回归，也不授权接纳候选。普通 PR CI 使用固定 fixture，上游安装归属显式运行的兼容任务。

## Decision tiers / 决策分层

- `docs-only`: Source wording, comments, or documentation changed, but observed source records and adapter output are unaffected. Update docs if the change clarifies maintenance guidance. / `docs-only`：来源措辞、注释或文档发生变化，但已观察来源记录和 adapter 输出不受影响。如变更能澄清维护指导，则更新文档。
- `fixture TODO / coverage update`: A new event shape, field, or storage shape is observed or suspected, but sample quality, frequency, or product semantics are insufficient for parser behavior. Record the gap and desired fixture shape. / `fixture TODO / coverage update`：观察到或怀疑存在新的 event shape、字段或存储形态，但样本质量、出现频率或产品语义不足以支持 parser 行为。记录缺口和期望 fixture 形态。
- `parser behavior change proposal`: Trusted evidence for the selected source family and fixture-quality examples justify changes to storage reading, layer placement, kind/subtype, severity, grouping, detail rendering, search/filter, metrics, or raw traceability. This is a proposal for follow-up implementation, not an automatic edit. / `parser behavior change proposal`：所选来源的可信依据和达到 fixture 质量的样例证明，需要改变存储读取、layer 归属、kind/subtype、severity、grouping、detail rendering、search/filter、metrics 或 raw traceability。这是后续实现提案，不是自动编辑。

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
- Evidence type: source review / synthetic reader / imported synthetic / actual writer:
- Baseline and candidate identities; Analyzer/probe revision:
- Executed checks, unrun checks and coverage gaps:

Observed change:
- New / changed / removed field:
- Example shape:
- Affected layer:

Impact assessment:
- Raw event:
- Storage layout / ordering / updates / deletion / snapshot identity:
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
- Unknown messages in a readable storage profile remain visible through Protocol/Raw fallback; unsupported storage has an explicit diagnostic. / 可读存储 profile 中的未知消息经 Protocol／Raw 保留；不支持的存储布局有明确诊断。
- The change preserves raw refs and source locators. / 该变更保留 raw refs 和 source locator。
- Machine identifiers remain stable and unlocalized. / 机器标识保持稳定且不被本地化。
- Fixture data is synthetic or strongly minimized and sanitized. / fixture 数据为合成数据，或经过强最小化与脱敏。
- Expected-output changes are limited to the behavior being protected. / expected output 变更仅限于被保护的行为。
