# Code Mode Operations / Code Mode 操作

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: proposed; A/B presentation decision pending / 状态：提议中；A/B 呈现决策待定
- Last updated: 2026-07-14 / 最近更新：2026-07-14
- Related spec: intentionally deferred until the A/B winner is selected / 相关规格：有意延后到 A/B 胜出方案确定后再更新
- Related design docs: / 相关设计文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
- Related plan: / 相关计划：
  - `docs/exec-plans/active/2026-07-14-code-mode-operation-grouping.md`

## Context / 背景

Code Mode changes the source topology of tool work. Instead of directly emitting each underlying tool call, the model emits an outer `custom_tool_call(name = exec)` containing JavaScript. That JavaScript can invoke multiple nested tools, return a pending `cell_id`, and continue through one or more outer `wait` calls. Current normalization treats `exec` and every `wait` as unrelated `other_tool_call` events, while independently persisted nested lifecycle rows may become their own Logical Events. This splits one operation, overcounts polling, and can falsely treat the first pending output as completion.

Code Mode 改变了工具工作的来源拓扑。模型不再直接发出每个底层工具调用，而是发出一个包含 JavaScript 的外层 `custom_tool_call(name = exec)`。该 JavaScript 可以调用多个嵌套工具、返回 pending `cell_id`，并通过一个或多个外层 `wait` 调用继续运行。当前归一化会把 `exec` 和每个 `wait` 视为互不相关的 `other_tool_call` 事件，而单独持久化的嵌套生命周期行又可能成为各自的逻辑事件。这会拆散同一个操作、重复计算轮询，并可能把第一次 pending 输出误当作完成。

Upstream runtime identity is richer than the ordinary rollout. At runtime, Codex can match each nested result through `cell_id + runtime_tool_call_id`; the persisted transcript reliably preserves outer call IDs and observed exec/wait cell chains, but does not currently preserve a public, explicit parent edge from every nested lifecycle ID back to its outer operation. The design therefore distinguishes deterministic source facts from observational association.

上游运行时身份比普通 rollout 更丰富。运行期间，Codex 可以通过 `cell_id + runtime_tool_call_id` 匹配每个嵌套结果；持久化转录能够可靠保留外层 call ID 和已观测的 exec/wait cell 链，但目前不会为每个嵌套生命周期 ID 持久化一条指回外层操作的公开显式父边。因此，本设计明确区分确定性来源事实与观察性关联。

## Goals and constraints / 目标与约束

- Reconstruct one Code Mode Operation from its outer exec call/output, optional cell, and wait chain before choosing its final timeline presentation. / 在选择最终时间线呈现方式前，先从外层 exec 调用/输出、可选 cell 和 wait 链重建一个 Code Mode 操作。
- Preserve all source traceability without copying nested activity raw references into the operation. / 保留全部来源可追溯性，同时不把嵌套活动的原始引用复制进操作。
- Keep Observed Nested Activity as independently inspectable Logical Events with their existing kinds and evidence-backed statuses. / 让已观测嵌套活动继续作为可独立检查的逻辑事件，并保留现有 kind 和有证据支持的状态。
- Make counting, search ownership, status, and escalation semantics identical in both A/B representations. / 让两个 A/B 呈现方案使用完全一致的计数、搜索归属、状态和提权语义。
- Treat the physical-interval parent relation as a bounded analyzer inference, not as a promised upstream wire contract. / 把物理区间父子关系视为 analyzer 的受限推断，而不是上游承诺的 wire contract。

## Non-goals / 非目标

- Executing Code Mode JavaScript or implementing a general JavaScript evaluator / 执行 Code Mode JavaScript，或实现通用 JavaScript 求值器
- Treating each static `tools.*` call site as an executed tool call or as a reliable execution count / 把每个静态 `tools.*` 调用位置视为已执行工具调用或可靠执行次数
- Assigning undifferentiated outer output to a particular nested call without a persisted identity edge / 在缺少持久化 identity 边时，把不可区分的外层输出分配给某个特定嵌套调用
- Inferring failure, decline, or approval outcome from words such as `error`, `failed`, `denied`, or `approved` in JavaScript, logs, search results, or ordinary output text / 根据 JavaScript、日志、搜索结果或普通输出文本中的 `error`、`failed`、`denied` 或 `approved` 等词推断失败、拒绝或审批结果
- Adding a new Logical Event `kind` for Code Mode / 为 Code Mode 新增逻辑事件 `kind`
- Stabilizing the provisional shared model as a public DTO before the representation decision / 在呈现决策前把临时共享模型稳定为公开 DTO
- Updating the product specification or `logical-event-timeline.md` before the winning representation is accepted / 在胜出呈现方案获接受前更新产品规格或 `logical-event-timeline.md`
- Committing real session transcripts or sensitive command/result bodies as fixtures / 把真实会话转录或敏感命令/结果正文提交为 fixture

## Shared operation model / 共享操作模型

Both experiments must consume the same internal `CodeModeOperation` model. The exact JavaScript object shape is implementation-private during the experiment, but it must preserve these semantics:

两个实验必须消费同一个内部 `CodeModeOperation` 模型。实验期间，具体 JavaScript object 形态属于实现私有内容，但必须保留以下语义：

```text
CodeModeOperation
- operationId: stable identity derived from the owning session and outer exec call
- outerCallId: exact outer exec call identity
- outerRefs: exec call/output source references only
- cellId: optional pending-cell identity
- pollPhases[]: ordered wait call/output pairs for the same cell
- evidenceState: call_only | output_observed
- observationState: unknown | pending | terminal | unobserved_terminal
- eventRefs[]: IDs of uniquely associated Observed Nested Activity events
- searchableText: outer JavaScript plus outer/poll outputs, deduplicated once
```

`outerRefs` and Poll Phase refs are operation-owned source references. `eventRefs` are logical references. A nested event's `rawRefs` remain owned by that nested event and must not be copied into the operation's `rawRefs`, source list, or detail sections. In the decision shorthand this relation is called `event_refs`; if serialized in the repository's canonical camelCase DTO style, the field is `eventRefs`. The operation detail must expose these event refs so a reader can open each nested event without manufacturing duplicate Raw References.

`outerRefs` 和轮询阶段 refs 是操作自有的来源引用；`eventRefs` 是逻辑引用。嵌套事件的 `rawRefs` 继续由该嵌套事件拥有，不得复制进操作的 `rawRefs`、来源列表或详情 sections。本决策简写把这条关系称为 `event_refs`；如果按仓库 canonical camelCase DTO 风格序列化，则字段名为 `eventRefs`。操作详情必须暴露这些 event refs，使读者能够打开每个嵌套事件，而不制造重复的原始引用。

Declared Nested Calls remain visible only as part of the original JavaScript. Loops, branches, and `Promise.all` mean one source call site can execute zero, one, or many times. V1 does not extract them into summaries, Logical Events, counters, statuses, or parent links.

声明的嵌套调用只作为原始 JavaScript 的一部分保持可见。循环、分支和 `Promise.all` 意味着一个来源调用位置可能执行零次、一次或多次。V1 不会把它们提取为摘要、逻辑事件、计数、状态或父子关联。

## Deterministic grouping / 确定性分组

1. Pair the outer exec call and output by their exact outer `call_id`. / 使用精确的外层 `call_id` 配对 exec 调用与输出。
2. If the exec output declares a pending `cell_id`, attach only waits whose arguments reference that exact cell; pair each wait call/output by its own exact call ID and retain source order. / 如果 exec 输出声明 pending `cell_id`，只关联 arguments 精确引用该 cell 的 wait；每个 wait 调用/输出按其自身精确 call ID 配对，并保留来源顺序。
3. Do not require a terminal wait. A pending cell can remain pending at transcript tail or become `unobserved_terminal` after the session clearly continues or ends without a terminal result. / 不要求一定存在终态 wait。pending cell 可以在转录尾部继续保持 pending，也可以在会话明确继续或结束、却没有终态结果时成为 `unobserved_terminal`。
4. An outer exec call without a matching output at the current transcript tail is `incomplete_tail`; it is not failed. / 当前转录尾部缺少匹配输出的外层 exec 调用属于 `incomplete_tail`，而不是失败。
5. Never merge Direct Tool Calls into a Code Mode Operation. / 绝不把直接工具调用合并进 Code Mode 操作。

## Unique physical-interval association / 唯一物理区间关联

An Observed Nested Activity event may be associated with an operation only when all of its owning lifecycle Raw Records fall inside one uniquely determined, closed physical interval from an exec or wait call row through that call's matching output row. The interval must already belong to exactly one grouped operation. Association uses physical JSONL line containment only after exact call/output pairing; timestamps, tool names, nested `call_id` resemblance, JavaScript text, and adjacency outside a closed interval are not parent evidence.

只有当某个已观测嵌套活动事件的全部自有生命周期原始记录，都落在一个唯一确定且闭合的物理区间内时，才能把它关联到某个操作。该区间从一次 exec 或 wait 调用行开始，到这次调用的匹配输出行结束，并且必须已经唯一归属于一个已分组操作。关联只能在精确配对调用/输出后使用物理 JSONL 行包含关系；timestamp、工具名称、嵌套 `call_id` 相似性、JavaScript 文本，以及闭合区间外的相邻关系，都不能作为父级证据。

If an event crosses interval boundaries, lies between polls, falls in an interval without a matching output, or could belong to more than one operation, it remains unassociated. Each nested Logical Event can appear in at most one operation's `eventRefs`. This intentionally favors no link over a false link.

如果事件跨越区间边界、位于两次 poll 之间、落在没有匹配输出的区间内，或可能属于多个操作，它就保持未关联。每个嵌套逻辑事件最多只能出现在一个操作的 `eventRefs` 中。本设计有意宁可不建立关联，也不建立错误关联。

## Two status axes / 状态双轴

The observation axis describes transcript completeness only:

观测轴只描述转录完整性：

- `unknown`: the outer exec output has not been observed, or an observed envelope is not safely classified. / 尚未观测到外层 exec 输出，或已观测 envelope 无法安全分类。
- `pending`: the latest observed result is pending and the transcript has not established a later disposition. / 最近一次已观测结果为 pending，且转录尚未确立后续处置。
- `terminal`: a terminal outer exec or wait result is present. / 存在外层 exec 或 wait 的终态结果。
- `unobserved_terminal`: the session continued or ended after a pending cell without preserving a terminal result for that cell. / 会话在 pending cell 后继续或结束，但没有保留该 cell 的终态结果。

The evidence axis is `call_only | output_observed`. An incomplete outer exec is `call_only + unknown`; it is a derived presentation state, not a third evidence value. / 证据轴为 `call_only | output_observed`。不完整的 outer exec 是 `call_only + unknown`；它是派生展示状态，而不是第三种证据值。

The outcome axis is the existing Logical Event `status`/severity surface. During this plan, the Code Mode Operation is status-neutral: an A composite event has empty/neutral status and normal severity, and a B non-event group has no event status. Observation state `terminal` means only that a terminal result was observed; it does not mean success. Nested events retain their own structured, evidence-backed outcome statuses, but those statuses never roll up to the operation. Observation states do not enter failed-command, issue, error/warning, or status-filter counts.

结果轴是现有逻辑事件 `status`/severity 表面。本计划期间，Code Mode 操作保持状态中性：A 方案的复合事件使用空/中性 status 和 normal severity；B 方案的非事件 group 不具备 event status。观测状态 `terminal` 只表示观察到了终态结果，并不表示成功。嵌套事件保留自身由结构化证据支持的结果状态，但这些状态绝不向上汇总到操作。观测状态不进入 failed-command、issue、error/warning 或 status filter 计数。

## Counting rules / 计数规则

- Count each Code Mode Operation exactly once as a tool operation. / 每个 Code Mode 操作在工具操作指标中恰好计数一次。
- Count each Observed Nested Activity Logical Event exactly once under its existing tool semantics. / 每个已观测嵌套活动逻辑事件按其现有工具语义恰好计数一次。
- Count every Poll Phase zero times as an independent tool call or engineering activity. / 每个轮询阶段作为独立工具调用或工程活动计数零次。
- Count every Declared Nested Call zero times. / 每个声明的嵌套调用计数零次。
- Do not follow `eventRefs` when aggregating counts; they are relations, not ownership copies. / 聚合计数时不得跟随 `eventRefs`；它们是关系，不是所有权副本。

Thus a Code Mode Operation with two associated nested lifecycle events and three waits contributes one operation plus two nested tool calls, not six tool calls. Both A and B must produce the same metrics.

因此，一个包含两个已关联嵌套生命周期事件和三次 wait 的 Code Mode 操作，应贡献一次 operation 和两次 nested tool call，而不是六次 tool call。A/B 两个方案必须产生相同指标。

## Search rules / 搜索规则

- Index the operation's outer JavaScript and accumulated exec/wait outputs once under one operation search owner. / 将操作的外层 JavaScript 及累积 exec/wait 输出在一个操作搜索 owner 下只索引一次。
- Do not create standalone wait search owners. Poll text resolves to the owning operation. / 不创建独立 wait 搜索 owner；poll 文本归属其操作。
- Keep each nested Logical Event's existing search document and target. Do not copy nested search text into the operation by following `eventRefs`. / 保留每个嵌套逻辑事件现有的搜索文档和目标；不得沿 `eventRefs` 把嵌套搜索文本复制到操作。
- Declared Nested Call text remains visible inside the already-indexed JavaScript but is not separately extracted and creates no extra results, tool facets, or execution claims. / 声明的嵌套调用文本继续在已索引 JavaScript 中可见，但不会被单独提取，也不创建额外结果、工具 facet 或执行声明。
- A maps the operation search owner to its composite Logical Event ID. B maps it to the non-event group's stable ID. The A/B decision must compare identical queries and exact owner IDs/counts. / A 方案把操作搜索 owner 映射到复合逻辑事件 ID；B 方案把它映射到非事件 group 的稳定 ID。A/B 决策必须使用相同 query 并比较精确 owner ID/计数。

## Escalation rules / 提权规则

Escalation is evidence, not an outcome classifier. V1 creates an `Escalation requested` tag only when an Observed Nested Activity owns a structured request whose `sandbox_permissions` is exactly `require_escalated`. The tag belongs only to that nested event. The same text inside outer JavaScript remains visible and searchable but creates no tag or approval event. A persisted permission/approval lifecycle record, if present, remains its own observed evidence and event.

提权是证据，不是结果分类器。V1 只有在某个已观测嵌套活动拥有结构化 request，且其中 `sandbox_permissions` 精确等于 `require_escalated` 时，才创建 `Escalation requested` 标签。该标签只属于这个嵌套事件。outer JavaScript 中的同名文本继续保持可见、可搜索，但不会创建标签或 approval 事件。如果存在持久化的 permission/approval 生命周期记录，它继续作为独立的已观测证据和事件。

The implementation must not execute JavaScript to recover escalation, must not treat an unstructured keyword occurrence as structured evidence, and must not infer failure or decline from approval-related text in ordinary output. Absence of an approval event means “not observed,” not “no approval happened.”

实现不得为恢复提权信息而执行 JavaScript，不得把非结构化关键字出现当作结构化证据，也不得根据普通输出中的审批相关文本推断失败或拒绝。缺少 approval event 表示“未观测到”，不表示“没有发生审批”。

## A/B representation decision / A/B 呈现决策

### A: composite Logical Event / A：复合逻辑事件

A emits one Main Timeline event for the operation using the existing `kind: other_tool_call`, `subtype: code_mode_operation`, and `toolName: exec`. It owns only outer exec and wait refs, exposes associated nested IDs through detail `eventRefs`, and leaves nested Logical Events independently visible. It adds no new kind and remains status-neutral.

A 在主时间线中为操作发出一个事件，使用现有 `kind: other_tool_call`、`subtype: code_mode_operation` 和 `toolName: exec`。它只拥有外层 exec/wait refs，通过详情 `eventRefs` 暴露相关嵌套 ID，并让嵌套逻辑事件继续独立可见。它不新增 kind，并保持状态中性。

### B: non-event group / B：非事件 group

B represents the operation as a stable group/container around child events for the outer exec phase, every Poll Phase, and every associated Observed Nested Activity, without emitting a Logical Event for the operation itself. The group owns the operation search target and one operation metric contribution. Exec and wait children remain independently inspectable inside the group, but Poll Phases contribute zero tool-call metrics; nested event identities and metrics remain unchanged.

B 把操作表示为一个稳定 group/container，其中的子事件包括 outer exec phase、每一个轮询阶段，以及每一个已关联嵌套活动，但不为操作本身发出逻辑事件。该 group 拥有操作搜索目标和一次 operation 指标贡献。exec 与 wait 子项在 group 内保持可独立检查，但轮询阶段贡献零次工具调用指标；nested event 的 identity 与指标保持不变。

Neither representation may change the shared grouping, association, status, counting, search, or escalation semantics. The decision is about presentation and DTO fit, not about choosing different facts.

两个方案都不得改变共享的分组、关联、状态、计数、搜索或提权语义。决策只涉及呈现与 DTO 适配性，而不是选择不同事实。

## Decision gate / 决策门

The two implementations must start from the same verified fixture/shared-core commit in separate worktrees. Select a winner only after both pass the same fixture matrix and produce identical operation identities, observation states, association sets, raw-ref ownership, tool counts, and search-owner counts. Compare:

两个实现必须从同一个已验证 fixture/shared-core commit 出发，并位于独立 worktree。只有当两者通过相同 fixture 矩阵，并生成完全一致的 operation identity、观测状态、关联集合、raw-ref 所有权、工具计数和搜索 owner 计数后，才能选择胜出方案。比较维度包括：

- Main Timeline readability and whether operation boundaries are understandable without hiding nested work / 主时间线可读性，以及在不隐藏嵌套工作的前提下操作边界是否易懂
- Inspector and Raw refs navigation, especially `eventRefs` traversal without duplicated source rows / Inspector 与 Raw refs 导航，尤其是 `eventRefs` 遍历是否避免重复来源行
- Compatibility with current Logical Event APIs, search targets, folding, filters, and pagination / 与当前逻辑事件 API、搜索目标、折叠、筛选和分页的兼容性
- Additional schema/UI complexity and migration risk / 额外 schema/UI 复杂度和迁移风险
- Deterministic behavior for pending, unobserved-terminal, incomplete-tail, multi-wait, and nested-lifecycle cases / pending、unobserved-terminal、incomplete-tail、multi-wait 和 nested-lifecycle 场景下的确定性行为

After the winner is accepted, update the bilingual product spec and `logical-event-timeline.md` together with the final behavior, record the decision here, and remove experimental-only DTO paths. Until then, neither candidate is an accepted product contract.

胜出方案获接受后，应根据最终行为同步更新双语产品规格与 `logical-event-timeline.md`，在本文记录决策，并移除仅用于实验的 DTO 路径。在此之前，两个候选方案都不是已接受的产品 contract。

## Alternatives considered / 已考虑的备选方案

### Keep exec and waits as independent Logical Events / 继续把 exec 与 waits 作为独立逻辑事件

- Pros: no new grouping model / 优点：无需新增分组模型
- Cons: splits one operation, overcounts polls, and conflates pending output with completion / 缺点：拆分同一操作、重复计算 poll，并混淆 pending 输出与完成
- Rejected / 已拒绝

### Promote every static nested call site / 提升每个静态嵌套调用位置

- Pros: appears to recover underlying tool names / 优点：看似能恢复底层工具名称
- Cons: branches, loops, and concurrency make call-site count different from runtime execution count; output identity is not preserved / 缺点：分支、循环和并发使调用位置数量不同于运行时执行次数，且输出 identity 没有保留
- Rejected / 已拒绝

### Add a new Code Mode Logical Event kind immediately / 立即新增 Code Mode 逻辑事件 kind

- Pros: explicit representation / 优点：呈现明确
- Cons: expands the public contract before evidence establishes that a new kind is necessary / 缺点：在证据尚未证明需要新 kind 前扩大公开 contract
- Rejected for this plan / 本计划中已拒绝

## Risks and failure modes / 风险和失效模式

- Upstream may later persist explicit parent IDs or may interleave multiple cells, making physical-interval association obsolete or insufficient. Keep it isolated behind the shared core. / 上游未来可能持久化显式 parent ID，或交错多个 cell，从而使物理区间关联过时或不足。应把它隔离在共享核心之后。
- Copying nested `rawRefs` or search text into the operation would silently double-count source rows and search hits. / 把嵌套 `rawRefs` 或搜索文本复制进操作会静默重复计算来源行和搜索命中。
- Treating observation state `terminal` as success would contaminate failure filters and session metrics. / 把观测状态 `terminal` 视为成功会污染失败筛选和会话指标。
- A and B can appear comparable while accidentally using different grouping code. The shared core and fixture expectations must land before worktree divergence. / A 与 B 可能看似可比，却意外使用不同分组代码。共享核心和 fixture 预期必须在 worktree 分叉前落盘。
- A non-event group may require broader API and browser changes; a composite event may add timeline density. The decision gate must measure both rather than assuming either cost is acceptable. / 非事件 group 可能需要更广的 API 与浏览器改动；复合事件可能增加时间线密度。决策门必须实际衡量两者，而不能假定任一成本可接受。

## Validation / 验证

- Sanitized synthetic fixtures cover direct completion, pending/multi-wait completion, pending tail, unobserved terminal, incomplete tail, unique and ambiguous physical intervals, nested lifecycle events, outer-JavaScript escalation text without a tag, and misleading failure keywords. / 脱敏合成 fixture 覆盖直接终态、pending/multi-wait 完成、pending 尾部、unobserved terminal、incomplete tail、唯一与歧义物理区间、嵌套生命周期事件、outer JavaScript 中不产生标签的提权文本，以及误导性失败关键字。
- Shared-core unit tests assert grouping and association without depending on A or B presentation. / 共享核心单元测试断言分组与关联，且不依赖 A 或 B 呈现。
- Candidate tests assert identical counts, search owners, raw-ref ownership, event refs, and neutral status. / 候选方案测试断言完全一致的计数、搜索 owner、raw-ref 所有权、event refs 和中性状态。
- Browser acceptance uses only sanitized fixtures until a winning representation is chosen; real transcripts remain read-only validation inputs and are never committed. / 胜出呈现确定前，浏览器验收只使用脱敏 fixture；真实转录只作为只读验证输入，绝不提交。

## Decision log / 决策日志

- 2026-07-14: Accepted the shared operation semantics and opened an A/B decision between a composite Logical Event and a non-event group. No new kind, product-spec change, or logical-timeline contract is accepted yet. / 2026-07-14：接受共享操作语义，并在复合逻辑事件与非事件 group 之间开启 A/B 决策。当前尚未接受新 kind、产品规格变更或逻辑时间线 contract 变更。
