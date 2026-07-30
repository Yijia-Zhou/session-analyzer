# Cross-surface contract consistency technical debt / 跨表面契约一致性技术债

- Status: open, audit-backed deferred debt / 状态：开放，已有审计依据的延后技术债
- Recorded: 2026-07-30 / 记录日期：2026-07-30
- Scope: Codex transcript classification and Code Mode display contracts / 范围：Codex 转录分类与 Code Mode 展示契约
- Source: read-only consistency audit after the Code Mode tool-metadata registry consolidation / 来源：Code Mode 工具 metadata 注册表收敛后的只读一致性审计

## Purpose / 目的

This document records four high-confidence risks where one semantic contract is represented by several consumers. It is a prioritised refactoring queue, not evidence of a current user-visible defect. The Code Mode tool registry already removed one such duplication; the items below deliberately retain parsing, rendering, and security decisions that are not mechanically interchangeable.

本文记录四项高置信度风险：同一语义契约被多个消费方分别表达。它是一份按优先级排序的重构队列，而非当前已有用户可见缺陷的证据。Code Mode 工具注册表已经消除了一处此类重复；下列事项会刻意保留那些不能机械互换的解析、渲染和安全决策。

## Decision rule / 决策规则

Extract a shared descriptor only when multiple consumers need the same stable semantic fact. Keep source-specific parsing, payload extraction, presentation layout, and safety-sensitive allowlists at their existing boundaries unless the descriptor can state the shared fact without hiding those distinctions.

只有当多个消费方需要同一项稳定的语义事实时，才提取共享 descriptor。除非 descriptor 能在不掩盖差异的前提下表达共享事实，否则 source 专属解析、payload 提取、展示布局和安全敏感 allowlist 应保留在现有边界中。

## 1. Tool-lifecycle family taxonomy / 工具生命周期族分类法

- Priority: high / 优先级：高
- Evidence: lifecycle admission is declared in `src/codex.js`; raw enrichment classifications live in `src/codex-source.js`; logical grouping, hook-family recognition, and terminal representative selection live in `src/codex-logical.js`. / 证据：生命周期准入在 `src/codex.js` 中声明；原始富集分类位于 `src/codex-source.js`；逻辑分组、hook family 识别和终态代表选择位于 `src/codex-logical.js`。
- Risk: a new lifecycle family or alias can remain visible as a Raw Record while missing logical grouping, terminal selection, or enrichment semantics. / 风险：新增生命周期族或 alias 可能作为 Raw Record 可见，却缺少逻辑分组、终态选择或富集语义。
- Bounded direction: introduce a data-only lifecycle-family descriptor for membership, phase, terminal rank, and logical admission. Retain source-specific payload extraction and card/detail rendering outside it. / 有界方向：引入仅含数据的生命周期族 descriptor，表达成员关系、阶段、终态优先级和逻辑准入；source 专属 payload 提取以及 card/detail 渲染仍留在 descriptor 外。
- Required proof: table-driven fixtures covering every declared family, aliases, start/terminal transitions, and the intended logical representative. / 必需证明：用表驱动 fixture 覆盖每个已声明族、alias、开始/终态转换以及预期的逻辑代表。

## 2. Planning semantic facet / 规划语义 facet

- Priority: high / 优先级：高
- Evidence: proposed-plan, tool-shaped planning, `plan_update`, and `plan_delta` semantics are separately recognized by `src/codex-logical.js`, `src/shared/folding.js`, `src/codex-detail.js`, `src/codex.js`, and browser navigation code. / 证据：`src/codex-logical.js`、`src/shared/folding.js`、`src/codex-detail.js`、`src/codex.js` 与浏览器导航代码分别识别 proposed-plan、工具形态 planning、`plan_update` 和 `plan_delta` 语义。
- Risk: a newly supported planning provenance can render correctly while being absent from metrics, folding, or navigation. / 风险：新支持的规划来源可能渲染正确，却没有进入指标、折叠或导航。
- Bounded direction: add a post-normalization `planningFacetForEvent` or `isPlanningEvent` projection. Raw wire-shape parsing remains independent so the canonical facet does not become a second parser. / 有界方向：新增归一化后的 `planningFacetForEvent` 或 `isPlanningEvent` 投影。原始 wire shape 解析保持独立，避免 canonical facet 成为第二个 parser。
- Required proof: fixtures for all four current shapes and assertions for logical classification, folding, metrics, detail presentation, and navigation eligibility. / 必需证明：为上述四种现有形态提供 fixture，并断言逻辑分类、折叠、指标、detail 展示和导航资格。

## 3. Code Mode detail-presentation DTO vocabulary / Code Mode detail 展示 DTO 词汇表

- Status: completed 2026-07-30 / 状态：已于 2026-07-30 完成
- Priority: medium; preferred next small refactor / 优先级：中；建议作为下一项小型重构
- Scope decision: the next increment covers `presentation.variant`, `presentation.requestEvidence`, and `presentation.resultAssociation`. The stable `declared_source` semantic value may be shared with `presentationFacts.codeModeDeclaredRequests.requestEvidence`, but the timeline fact and detail presentation remain separate DTO shapes with separate admission boundaries. / 范围决策：下一增量覆盖 `presentation.variant`、`presentation.requestEvidence` 与 `presentation.resultAssociation`。稳定语义值 `declared_source` 可以与 `presentationFacts.codeModeDeclaredRequests.requestEvidence` 共享，但 timeline fact 与 detail presentation 仍是具有独立准入边界的不同 DTO 形态。
- Evidence: the declared-call projector currently emits `declared_source` plus `none` or `bounded`; the domain glossary classifies Nested Tool Projection result association as `exact`, `bounded`, or `none`; the detail sanitizer additionally admits values such as `observed_lifecycle`, `exact_identity`, and `bounded_order`; and browser app and section renderers duplicate evidence-to-badge interpretation. An admission list therefore cannot by itself establish the stable vocabulary. / 证据：声明调用 projector 当前生成 `declared_source` 以及 `none` 或 `bounded`；领域词汇表将 Nested Tool Projection 的结果关联分类为 `exact`、`bounded` 或 `none`；detail sanitizer 还额外接受 `observed_lifecycle`、`exact_identity` 和 `bounded_order` 等值；浏览器 app 与 section renderer 则重复解释 evidence 到 badge 的映射。因此，不能仅凭准入列表确定稳定词汇。
- Risk: a newly introduced value can be silently sanitized away or receive an inconsistent badge, title, or variant across detail surfaces. Conversely, mechanically extracting the current sanitizer allowlists can promote a compatibility-only, reserved, or stale value into a permanent public contract. / 风险：新引入的值可能被静默清洗掉，或在不同 detail 表面获得不一致的 badge、标题或 variant；反过来，机械提取当前 sanitizer allowlist 也可能把仅兼容、预留或陈旧的值提升为永久公开契约。
- Audited baseline: every value that was produced, admitted, documented, or rendered before extraction now has one lifecycle classification. / 审计基线：提取前所有会被生成、准入、记录或渲染的值现在都具有唯一生命周期分类。

  | Dimension / 维度 | Value / 值 | Classification / 分类 | Rationale / 理由 |
  | --- | --- | --- | --- |
  | `presentation.variant` | `single_tool` | `producer-supported` | Produced for exactly one safe declared request and consumed by detail plus browser presentation. / 为恰好一个安全声明 request 生成，并由 detail 与浏览器展示消费。 |
  | `presentation.variant` | `multi_tool` | `producer-supported` | Produced for two or more safe declared requests. / 为两个及以上安全声明 request 生成。 |
  | `presentation.variant` | `raw_code_mode` | `producer-supported` | Produced as the fail-closed fallback for unsupported programs. / 作为不受支持程序的保守失败回退生成。 |
  | `requestEvidence` | `declared_source` | `producer-supported` | Produced by the bounded declared-call projector; the same semantic value is also used by the separate name-only timeline fact. / 由有界声明调用 projector 生成；独立的仅名称 timeline fact 也使用同一语义值。 |
  | `requestEvidence` | `observed_lifecycle` | `rejected` | No producer or persisted compatibility need exists, and treating Observed Nested Activity as projection evidence would blur its independent canonical ownership. / 不存在 producer 或持久化兼容需求；把 Observed Nested Activity 当作投影证据会模糊其独立 canonical ownership。 |
  | `resultAssociation` | `bounded` | `producer-supported` | Produced only for supported static one-to-one output order. / 只为受支持的静态一一对应输出顺序生成。 |
  | `resultAssociation` | `none` | `producer-supported` | Produced when no supported result association is established. / 未建立受支持结果关联时生成。 |
  | `resultAssociation` | `exact` | `compatibility/reserved` | The domain model reserves it for a future persisted exact identity edge; it remains admitted and has an intentional exact-match badge, but no current producer fabricates it. / 领域模型将其预留给未来持久化的精确 identity 边；它继续被准入并具有有意的精确匹配 badge，但当前 producer 不会伪造它。 |
  | `resultAssociation` | `exact_identity` | `rejected` | Undocumented alias with no producer or persisted compatibility requirement. / 没有文档定义、producer 或持久化兼容要求的 alias。 |
  | `resultAssociation` | `bounded_order` | `rejected` | Undocumented alias superseded by canonical `bounded`, with no producer or persisted compatibility requirement. / 已由 canonical `bounded` 取代，且没有 producer 或持久化兼容要求的未记录 alias。 |

- Implemented direction: `src/shared/code-mode-presentation-contract.js` now owns the stable values, strict normalization, the detail sanitizer's vocabulary projection, and semantic badge identity. Declared-call producers, the name-only timeline request fact, detail construction, the detail sanitizer, browser app, and section renderer consume that contract where meanings are identical. Renderer markup and layout remain local. / 已实施方向：`src/shared/code-mode-presentation-contract.js` 现在负责稳定值、严格规范化、detail sanitizer 的词汇投影以及语义 badge identity。声明调用 producer、仅名称 timeline request fact、detail 构造、detail sanitizer、浏览器 app 与 section renderer 会在含义相同时消费该契约；renderer markup 与布局仍保持局部。
- Explicit exclusions: this increment does not consolidate canonical `kind: code_mode_operation`, the synthetic `code_mode_script_operation` query facet, or `presentationContext.relation: enclosed_by_code_mode_operation`. Those contracts retain their existing canonical, query, and navigation ownership and must not be folded into one central Code Mode registry. / 明确排除：本增量不收敛 canonical `kind: code_mode_operation`、合成查询 facet `code_mode_script_operation` 或 `presentationContext.relation: enclosed_by_code_mode_operation`。这些契约继续保留现有的 canonical、查询与导航 ownership，不得被折叠进一个中央 Code Mode registry。
- Expansion trigger: revisit a multi-family contract model only when a second canonical Code Mode kind or presentation-context relation is introduced, a new evidence provenance must span timeline and detail, or another consumer begins independently interpreting one of those contracts. If triggered, define separate canonical-identity, timeline-fact, detail-presentation, and presentation-context families rather than one catch-all vocabulary. / 扩展触发条件：仅当引入第二种 canonical Code Mode kind 或 presentation-context relation、新 evidence provenance 必须横跨 timeline 与 detail，或新增消费方开始独立解释其中某项契约时，才重新评估多 family 契约模型。触发后应分别定义 canonical identity、timeline fact、detail presentation 与 presentation context family，而不是建立一个包罗万象的词汇表。
- Delivered proof: table-driven contract coverage verifies producer-supported, reserved, and rejected values; producer tests verify `declared_source`, `bounded`, and `none`; sanitizer coverage retains `exact` while dropping rejected aliases; renderer coverage verifies shared badge eligibility and stable omission; and cross-layer coverage proves that sharing `declared_source` does not merge timeline and detail DTO ownership. / 已交付证明：表驱动契约覆盖验证 producer-supported、reserved 与 rejected 值；producer 测试验证 `declared_source`、`bounded` 与 `none`；sanitizer 覆盖保留 `exact` 并丢弃 rejected alias；renderer 覆盖验证共享 badge 资格与稳定省略；跨层覆盖证明共享 `declared_source` 不会合并 timeline 与 detail DTO ownership。

## 4. Structured detail-section type contract / 结构化 detail section 类型契约

- Priority: medium; defer until a new section type is needed / 优先级：中；推迟到确有新 section 类型需求时
- Evidence: section-type admission and dropping occur in `src/codex.js`; section construction occurs in `src/codex-detail.js`; browser rendering and inspector supplementation are handled separately in browser code. / 证据：section 类型的准入与丢弃发生在 `src/codex.js`；section 构建发生在 `src/codex-detail.js`；浏览器渲染与 inspector 补充则由浏览器代码分别处理。
- Risk: a new allowed section can be silently removed, fall back inconsistently, or duplicate a timeline summary in the inspector. / 风险：新增的允许 section 可能被静默移除、发生不一致回退，或在 inspector 中重复时间线摘要。
- Bounded direction: when a new type is introduced, add a section descriptor with `allowed`, `inspectorSupplement`, and `ownsTimelinePreview`, and derive backend admission plus browser fallback behavior from it. / 有界方向：引入新类型时，增加含 `allowed`、`inspectorSupplement` 和 `ownsTimelinePreview` 的 section descriptor，并从中派生后端准入及浏览器回退行为。
- Required proof: every allowed type has either a dedicated renderer or an intentional fallback, and tests establish timeline-preview ownership and inspector supplementation. / 必需证明：每个允许类型都具有专用 renderer 或有意的回退，且测试明确时间线预览 ownership 与 inspector 补充。

## Sequencing / 排序

1. Item 3 is complete. Keep its bounded shared contract separate from canonical kind and presentation context, and revisit the multi-family expansion only when one of its recorded triggers occurs. / 事项 3 已完成。继续让其有界共享契约与 canonical kind、presentation context 保持分离，并且只在已记录触发条件出现时重新评估多 family 扩展。
2. Design items 1 and 2 together only when protocol coverage expands or planning semantics change; both need fixture-first classification decisions. / 仅当协议覆盖扩展或规划语义变化时联合设计事项 1 和 2；两者都需要先做 fixture 驱动的分类决策。
3. Keep item 4 deferred until an actual new structured section type establishes its required semantics. / 事项 4 保持推迟，直到实际新增结构化 section 类型并明确所需语义。

## Related documents / 相关文档

- `CONTEXT.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/design-docs/code-mode-operations.md`
- `docs/design-docs/code-mode-structured-display-catalog.md`
- `docs/design-docs/logical-event-timeline.md`
- `docs/design-docs/codex-protocol-event-coverage.md`
