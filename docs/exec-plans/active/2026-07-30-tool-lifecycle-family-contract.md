# Tool lifecycle-family contract convergence / 工具生命周期族契约收敛

## Objective / 目标

Extract the stable, data-only Tool Lifecycle Family taxonomy from the current Codex parser and logical-event builder while preserving every currently admitted type's observable behavior. Apply one bounded fail-closed tightening required by exact admission: an unregistered same-`callId` lookalike may remain attached as a Raw Reference through the existing traceability group, but it must no longer supply family membership, outcome, representative, preview, or search semantics. After that boundary is proven, run the accepted schema-update workflow against a pinned upstream Codex revision and produce explicit follow-up decisions rather than folding speculative protocol support into the extraction.

从当前 Codex parser 与逻辑事件构建器中提取稳定、仅含数据的工具生命周期族分类法，同时保持每个当前已准入 type 的可观察行为。精确准入还要求一项有界、保守失败的收紧：未注册但具有相同 `callId` 的相似记录可以因现有 traceability grouping 继续保留为 Raw Reference，但不得再提供 family membership、outcome、代表记录、preview 或 search 语义。证明该边界后，再针对固定 revision 的上游 Codex 执行已接受的 schema 更新流程，并产出明确的后续决策，而不是把推测性的协议支持混入本次提取。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: active; phases 1–3 complete, pinned upstream schema review pending / 状态：进行中；第一至第三阶段已完成，等待固定上游版本的 schema 审查
- Started: 2026-07-30 / 开始日期：2026-07-30
- Related design: `docs/design-docs/cross-surface-contract-consistency-tech-debt.md` / 相关设计：`docs/design-docs/cross-surface-contract-consistency-tech-debt.md`
- Schema workflow: `docs/design-docs/schema-update-runbook.md` / Schema 流程：`docs/design-docs/schema-update-runbook.md`
- Protocol coverage: `docs/design-docs/codex-protocol-event-coverage.md` / 协议覆盖：`docs/design-docs/codex-protocol-event-coverage.md`
- Domain language: `CONTEXT.md` / 领域语言：`CONTEXT.md`

## Evidence baseline / 证据基线

The current repository represents the same lifecycle facts in several places:

当前仓库在多个位置分别表达同一批生命周期事实：

- `src/codex.js` declares exact `TOOL_EVENT_TYPES` admission. / `src/codex.js` 声明精确的 `TOOL_EVENT_TYPES` 准入集合。
- `src/codex-source.js` separately recognizes exact wire types for specialized or generic raw enrichment. / `src/codex-source.js` 为专用或通用 raw enrichment 分别识别精确 wire type。
- `src/codex-logical.js` separately owns family membership, phase ranking, hook aliases, call-group admission, representative selection, and standalone terminal handling. / `src/codex-logical.js` 分别负责 family membership、阶段排名、hook alias、调用组准入、代表记录选择和独立终态处理。
- `test/codex-logical.test.js` supplies a reduced private admission set that does not cover every production member. / `test/codex-logical.test.js` 提供一份缩减后的私有准入集合，并未覆盖所有生产成员。

A read-only lightweight upstream inventory used OpenAI Codex `codex-rs/protocol/src/protocol.rs` at revision [`406dc92`](https://github.com/openai/codex/commit/406dc92) as design input. It confirmed nonuniform current wire names including `exec_command_output_delta`, `terminal_interaction`, `patch_apply_updated`, `image_generation_begin`, `dynamic_tool_call_request` / `dynamic_tool_call_response`, `collab_resume_begin` / `collab_resume_end`, and `sub_agent_activity`. It also confirmed that correlation is not universally `call_id`: current hook records use `run.id`, while `sub_agent_activity` uses `event_id`. This inventory constrains the abstraction but does not replace the post-refactor schema runbook or authorize parser behavior changes.

只读的轻量上游盘点以 OpenAI Codex revision `406dc92` 的 `codex-rs/protocol/src/protocol.rs` 作为设计输入。盘点确认现行 wire 名称并不统一，包括 `exec_command_output_delta`、`terminal_interaction`、`patch_apply_updated`、`image_generation_begin`、`dynamic_tool_call_request` / `dynamic_tool_call_response`、`collab_resume_begin` / `collab_resume_end` 与 `sub_agent_activity`；同时确认 correlation 并不总是 `call_id`：现行 hook 记录使用 `run.id`，而 `sub_agent_activity` 使用 `event_id`。该盘点只约束抽象形状，不替代重构后的 schema runbook，也不授权 parser 行为变更。

## Model distinctions / 模型区分

The refactor must preserve these separate facts:

本次重构必须保持以下事实相互独立：

| Fact / 事实 | Meaning / 含义 | First-increment ownership / 首增量 ownership |
| --- | --- | --- |
| Exact wire type / 精确 wire type | The unmodified source `payload.type`. / 未修改的来源 `payload.type`。 | Descriptor lookup key; never inferred from a prefix. / Descriptor 查找 key；不得通过前缀推断。 |
| Tool Lifecycle Family / 工具生命周期族 | Stable semantic membership such as command, patch, MCP tool, image generation, dynamic tool, approval, hook, or collaboration. / 稳定语义成员关系，例如 command、patch、MCP tool、image generation、dynamic tool、approval、hook 或 collaboration。 | Data-only descriptor. / 仅数据 descriptor。 |
| Lifecycle Phase / 生命周期阶段 | Canonical source-neutral position: `start`, `progress`, `interaction`, `terminal`, or `single`. / 规范、来源中立的位置：`start`、`progress`、`interaction`、`terminal` 或 `single`。 | Data-only descriptor; exact names such as `updated`, `output_delta`, `request`, and `completed` map explicitly. / 仅数据 descriptor；`updated`、`output_delta`、`request`、`completed` 等精确名称需显式映射。 |
| Representative priority / 代表记录优先级 | Which admitted row best labels and summarizes a grouped lifecycle. / 哪个已准入记录最适合作为分组生命周期的 label 与摘要代表。 | Derived from descriptor data; independent of outcome. / 从 descriptor 数据派生；独立于结果。 |
| Lifecycle Outcome Status / 生命周期结果状态 | Completion, failure, decline, or another source-supported outcome. / 完成、失败、拒绝或其他来源支持的结果。 | Remains in logical/source-specific status interpretation during the pure refactor. / 纯重构期间继续由 logical/source 专属状态解释负责。 |
| Lifecycle Correlation Identity / 生命周期关联标识 | Typed evidence used to relate Raw Records to one execution. / 用于把原始记录关联到同一次执行的带类型证据。 | Existing `callId` behavior remains unchanged; descriptor must not claim that every family uses a generic call ID. / 保持现有 `callId` 行为不变；descriptor 不得声称所有 family 都使用泛化调用 ID。 |
| Logical admission / 逻辑准入 | Whether a member may join a call group or receive intentional standalone handling. / 成员是否可以加入调用组或获得有意的独立处理。 | Explicit descriptor policy, not a consequence of family prefix matching. / 显式 descriptor policy，而不是 family 前缀匹配的结果。 |

Logical admission is semantic admission, not ownership of every traceability row. Existing `callId` grouping can retain an unregistered row in a grouped event's Raw References without promoting that row into a Tool Lifecycle Family or allowing it to affect outcome, representative, preview, or search semantics. Isolated unregistered rows continue through Protocol/Raw fallback.

Logical admission 是语义准入，不等于每条 traceability 记录的 ownership。现有 `callId` grouping 可以在分组事件的 Raw References 中保留一条未注册记录，但这不会把该记录提升为工具生命周期族成员，也不允许它影响 outcome、代表记录、preview 或 search 语义。孤立的未注册记录继续进入 Protocol/Raw fallback。

## Invariants and non-goals / 不变量与非目标

1. Preserve every existing exact admitted type, family, Logical Event kind/subtype, status, severity, label, Raw Reference, count, search text, Code Mode association, and detail result. / 保持每个现有精确准入类型、family、逻辑事件 kind/subtype、status、severity、label、原始引用、计数、搜索文本、Code Mode 关联与 detail 结果。
2. Preserve unknown records losslessly. Isolated unknown records use Protocol/Raw fallback. A same-`callId` unknown row already owned by a traceability group remains in that event's Raw References, but exact semantic admission prevents it from influencing lifecycle family, outcome, representative, preview, or search semantics. / 无损保留未知记录。孤立未知记录使用 Protocol/Raw fallback；已由相同 `callId` traceability group 持有的未知记录继续保留在该事件的 Raw References 中，但精确语义准入会阻止它影响 lifecycle family、outcome、代表记录、preview 或 search 语义。
3. Do not add any upstream-known type to Main Timeline or logical grouping during the pure refactor. / 纯重构期间不得把任何仅由上游得知的类型加入主时间线或逻辑分组。
4. Do not infer family, phase, outcome, or correlation identity from string prefixes or suffixes. Exact descriptor entries own admitted semantics; unknown lookalikes remain unknown. / 不得通过字符串前缀或后缀推断 family、phase、outcome 或 correlation identity。已准入语义由精确 descriptor 条目负责；未知相似字符串继续保持未知。
5. Keep command/patch payload extraction, generic raw enrichment, hook naming/status interpretation, detail construction, rendering, localization, safety allowlists, image externalization, and permission-sensitive presentation at their current boundaries. / command/patch payload 提取、通用 raw enrichment、hook 名称/状态解释、detail 构造、渲染、本地化、安全 allowlist、图片外置和权限敏感展示继续保留在当前边界。
6. Do not introduce `run.id`, `event_id`, thread/path identity, or cross-turn correlation behavior in the pure refactor. Those require runbook evidence, focused fixtures, and a separate behavior decision. / 纯重构不得引入 `run.id`、`event_id`、thread/path identity 或跨 turn correlation 行为；这些行为需要 runbook 证据、聚焦 fixture 与独立行为决策。
7. Do not broaden the Planning semantic facet as part of this plan. If the later schema review finds new planning provenance, create or extend the separate item 2 plan. / 本计划不扩大 Planning semantic facet；如果后续 schema review 发现新的 planning provenance，应创建或扩展独立的事项 2 计划。

## Proposed contract boundary / 拟议契约边界

Add one backend-safe, data-only module such as `src/codex-tool-lifecycle-contract.js`. Each exact admitted `event_msg` wire type receives one immutable descriptor with:

新增一份仅后端使用、仅含数据的模块，例如 `src/codex-tool-lifecycle-contract.js`。每个精确准入的 `event_msg` wire type 获得一个不可变 descriptor，包含：

- `wireType`
- `family`
- canonical `phase`
- `representativeRank`
- explicit call-group admission
- explicit standalone admission where current behavior requires it

The module may expose exact lookup, membership, family, phase, rank, and admission projections. It must not parse payload fields, build Logical Events, choose presentation markup, localize labels, infer outcomes, or silently admit unregistered prefix matches.

该模块可以暴露精确查找、membership、family、phase、rank 与 admission 投影；不得解析 payload 字段、构建逻辑事件、选择展示 markup、本地化 label、推断结果，或静默准入未注册的前缀匹配。

Current consumers should converge as follows:

当前消费方应按以下方式收敛：

- `src/codex.js`: derive the former `TOOL_EVENT_TYPES` membership instead of owning a separate set. / `src/codex.js`：派生原 `TOOL_EVENT_TYPES` membership，不再自有独立集合。
- `src/codex-source.js`: consume exact membership only for the existing generic lifecycle-enrichment path; keep command and patch extraction local. / `src/codex-source.js`：只在现有通用 lifecycle enrichment 路径消费精确 membership；command 与 patch 提取继续保持局部。
- `src/codex-logical.js`: derive call-group admission, family row selection, hook membership, and representative priority from descriptor facts; keep family-specific event construction and status semantics local. / `src/codex-logical.js`：从 descriptor 事实派生调用组准入、family 记录选择、hook membership 与代表优先级；family 专属事件构造和状态语义继续保持局部。
- Code Mode association: derive the existing lifecycle membership contribution while keeping its independent `web_search_end` addition and association rules. / Code Mode 关联：派生现有 lifecycle membership 部分，同时保留独立的 `web_search_end` 追加与关联规则。
- Tests: import the production contract instead of maintaining a reduced private type set. / 测试：导入生产契约，不再维护缩减的私有类型集合。

## Implementation phases / 实施阶段

### Phase 1: fixture-first baseline / 第一阶段：fixture 优先的基线

- Build a table covering every currently admitted exact type, family, canonical phase, representative rank, call-group admission, and standalone policy. / 建立表格，覆盖每个当前准入的精确类型、family、规范 phase、代表优先级、调用组准入和独立处理策略。
- Add negative lookalike cases and start/progress/terminal representative transitions before moving production ownership. / 在迁移生产 ownership 前，增加未知相似类型以及 start/progress/terminal 代表转换的负向与正向 case。
- Capture current Logical Event outputs for incomplete, declined, failed, aliased hook, image-generation exception, collaboration terminal, and Code Mode association paths. / 固定 incomplete、declined、failed、hook alias、image-generation 例外、collaboration 终态与 Code Mode 关联路径的当前逻辑事件输出。

### Phase 2: bounded descriptor extraction / 第二阶段：有界 descriptor 提取

- Add the data-only contract and make exact membership the single source of truth. / 增加仅数据契约，并让精确 membership 成为唯一事实来源。
- Replace prefix-based family selection only for already admitted members. An isolated unknown lookalike continues through generic fallback; a same-`callId` lookalike remains traceable through the existing Raw Reference group but contributes no lifecycle semantics. / 只对已经准入的成员替换基于前缀的 family 选择。孤立未知相似类型继续进入通用回退；具有相同 `callId` 的相似记录通过现有 Raw Reference group 保持可追溯，但不贡献 lifecycle 语义。
- Derive representative priority and current logical admission without changing outcome or correlation semantics. / 派生代表优先级和当前 logical admission，不改变结果或 correlation 语义。
- Remove the reduced private test set after all test builders consume the production contract. / 所有测试 builder 消费生产契约后，移除缩减的私有测试集合。

### Phase 3: admitted-behavior equivalence and fail-closed proof / 第三阶段：已准入行为等价与保守失败证明

- Run focused source, logical, Code Mode fact, detail, search, folding, and golden-replay coverage. / 运行 source、logical、Code Mode fact、detail、search、folding 与 golden replay 的聚焦覆盖。
- Run the full Node, browser, package, generated-asset, and diff checks required by the affected repository paths. / 运行受影响仓库路径所要求的完整 Node、browser、package、生成资产与 diff 检查。
- Confirm admitted behavior equivalence, record the bounded same-call lookalike tightening, and decide whether that unsupported-shape boundary changes the product spec. / 确认已准入行为等价，记录有界的 same-call lookalike 收紧，并判断该未支持形态边界是否改变产品规格。

### Phase 4: pinned upstream schema review / 第四阶段：固定上游版本的 schema 审查

- Only after Phase 3 passes, run `docs/design-docs/schema-update-runbook.md` against a newly pinned upstream revision. The lightweight `406dc92` inventory is input, not the formal result. / 仅在第三阶段通过后，针对重新固定的上游 revision 执行 `docs/design-docs/schema-update-runbook.md`；轻量的 `406dc92` 盘点只是输入，不是正式结果。
- Produce the runbook report with source, trust level, observed shapes, layer/detail/search/metrics impact, fixture gaps, and one decision tier per shape. / 使用 runbook 模板产出报告，记录来源、信任等级、观察到的形态、layer/detail/search/metrics 影响、fixture 缺口以及每种形态的唯一决策层级。
- Keep upstream-known shapes non-admitted until trusted-source plus fixture-quality evidence justifies a parser change proposal. / 在可信来源与 fixture 质量证据足以支持 parser change proposal 前，让仅由上游得知的形态保持不准入。
- Open a separate follow-up plan for any behavior-changing protocol coverage. If planning provenance changed, design item 2 together with that follow-up rather than adding planning semantics to this refactor. / 对任何会改变行为的协议覆盖另开后续计划；如果 planning provenance 发生变化，应让事项 2 与该后续联合设计，而不是把 planning 语义加入本次重构。

## Acceptance criteria / 验收标准

1. Every currently admitted lifecycle wire type has exactly one descriptor and one documented family, phase, representative rank, and logical-admission policy. / 每个当前准入的 lifecycle wire type 恰好有一个 descriptor，以及一份记录在案的 family、phase、代表优先级与 logical-admission policy。
2. Production code and tests no longer maintain independent lifecycle admission or hook-membership lists where meanings are identical. / 当含义相同时，生产代码与测试不再维护独立的 lifecycle 准入或 hook membership 列表。
3. Unknown lookalikes receive no lifecycle semantics and stay losslessly visible: isolated rows through Protocol/Raw fallback, and same-`callId` rows through their existing grouped Raw References without outcome/representative/preview/search influence. / 未知相似类型不获得 lifecycle 语义并保持无损可见：孤立记录通过 Protocol/Raw fallback，可追溯分组中的 same-`callId` 记录则继续保留为 Raw Reference，但不影响 outcome、代表记录、preview 或 search。
4. Existing admitted Logical Event output, Code Mode association, Raw References, search, metrics, folding, detail DTOs, and browser rendering remain unchanged; the bounded same-call unknown-lookalike tightening is explicitly tested and documented. / 现有已准入逻辑事件输出、Code Mode 关联、原始引用、搜索、指标、折叠、detail DTO 与浏览器渲染保持不变；有界的 same-call 未知相似类型收紧已被显式测试并记录。
5. Phase, outcome status, representative priority, and correlation identity remain separate concepts in code, tests, and documentation. / phase、结果状态、代表优先级与 correlation identity 在代码、测试和文档中保持为独立概念。
6. A pinned post-refactor schema review report exists before any new upstream type is admitted. / 在准入任何新的上游类型前，存在一份固定 revision 的重构后 schema 审查报告。
7. Any behavior-changing follow-up is recorded separately with focused fixture requirements and the appropriate documentation updates. / 任何会改变行为的后续都单独记录，并包含聚焦 fixture 要求和相应文档更新。

## Progress log / 进度日志

- 2026-07-30: Re-audited item 1 against current code and repository history. The debt is real: hook and image-generation alias additions previously required synchronized edits across admission, source parsing, logical family recognition, representative selection, and tests. / 2026-07-30：针对当前代码与仓库历史重新审计事项 1。该技术债真实存在：过去增加 hook 与 image-generation alias 时，需要同步修改准入、source parsing、logical family 识别、代表记录选择与测试。
- 2026-07-30: Completed a read-only lightweight upstream inventory at OpenAI Codex revision `406dc92`. It established nonuniform phase names, terminal-status-versus-phase separation, and typed correlation identities as abstraction constraints, while intentionally making no Main Timeline or parser behavior decision. / 2026-07-30：完成针对 OpenAI Codex revision `406dc92` 的只读轻量上游盘点。盘点确认非统一 phase 名称、终态结果与 phase 分离、typed correlation identity 是抽象约束，同时有意不作出主时间线或 parser 行为决策。
- 2026-07-30: Added this active plan and sharpened the domain language before implementation. / 2026-07-30：在实现前增加本活跃计划并收紧领域语言。
- 2026-07-30: Completed phases 1–2. Added the immutable, data-only `src/codex-tool-lifecycle-contract.js` for all 42 currently admitted exact types, and converged parser membership, logical family selection, representative priority, hook/collaboration standalone policy, Code Mode lifecycle association, package metadata, and focused tests on that contract. Command/patch extraction, outcome interpretation, response-item image handling, correlation, rendering, and the independent `web_search_end` association remain at their existing boundaries. / 2026-07-30：完成第一至第二阶段。为当前准入的全部 42 个精确 type 增加不可变、仅含数据的 `src/codex-tool-lifecycle-contract.js`，并让 parser membership、logical family 选择、代表记录优先级、hook/collaboration 独立处理策略、Code Mode 生命周期关联、package metadata 与聚焦测试收敛到该契约。command/patch 提取、outcome 解释、response-item image 处理、correlation、渲染以及独立的 `web_search_end` 关联继续保留在原有边界。
- 2026-07-30: The equivalence review exposed one pre-existing prefix/suffix-inference leak: in a mixed call group, an unregistered same-prefix row previously influenced family search text and could become the representative, while an unregistered suffix/status lookalike could also change lifecycle outcome. Exact admission now deliberately removes those semantic influences while preserving the row in the group's Raw References through unchanged `callId` traceability. Focused fixtures cover isolated lookalikes, mixed representative/search behavior, and mixed outcome behavior. This is a bounded fail-closed tightening for an unsupported shape, not a new admitted protocol behavior; it is recorded here and in the design debt, while the product spec remains unchanged. / 2026-07-30：等价复核发现一处既有的前缀/后缀推断泄漏：在 mixed call group 中，未注册但具有相同前缀的记录过去会影响 family search text，甚至可能成为代表记录；未注册的后缀或 status 相似记录还可能改变 lifecycle outcome。精确准入现在有意移除这些语义影响，同时通过未改变的 `callId` traceability 将记录继续保留在 group 的 Raw References 中。聚焦 fixture 覆盖孤立 lookalike、mixed 代表记录/搜索行为以及 mixed outcome 行为。这是针对未支持形态的有界、保守失败收紧，不是新的已准入协议行为；因此在本计划与技术债设计中记录，但不修改产品规格。
- 2026-07-30: Completed phase 3 validation, including the post-implementation review follow-up for exact outcome inputs. The final full Node suite passed 309/309, browser coverage passed 83/83, generated assets were current, package manifest and installed-package smoke passed, and `git diff --check` passed. No admitted protocol shape, Main Timeline placement, correlation rule, or supported product contract changed. Phase 4 has intentionally not run, so this plan remains active. / 2026-07-30：完成第三阶段验收，包括实现后 review 对精确 outcome 输入集合的跟进。最终完整 Node 测试 309/309 通过，浏览器测试 83/83 通过，生成资产保持最新，package manifest 与安装后 package smoke 通过，`git diff --check` 通过。没有改变任何已准入协议形态、主时间线归属、correlation 规则或受支持产品契约。第四阶段尚未执行，因此本计划继续保持 active。
