# Code Mode Operations / Code Mode 操作

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted; composite Logical Event selected / 状态：已接受；选用复合逻辑事件
- Last updated: 2026-07-16 / 最近更新：2026-07-16
- Related spec: `docs/product-specs/session-transcript-analyzer.md` / 相关规格：`docs/product-specs/session-transcript-analyzer.md`
- Related design docs: / 相关设计文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/design-docs/code-mode-structured-display-catalog.md`
- Related plan: / 相关计划：
  - `docs/exec-plans/completed/2026-07-16-code-mode-adaptive-presentation.md`
  - `docs/exec-plans/completed/2026-07-14-code-mode-operation-grouping.md`
  - `docs/exec-plans/completed/2026-07-15-code-mode-structured-nested-projections.md`

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
- Treating each static `tools.*` call site or Nested Tool Projection as an executed tool call or as a reliable execution count / 把每个静态 `tools.*` 调用位置或嵌套工具投影视为已执行工具调用或可靠执行次数
- Treating undifferentiated outer output as an exact or unlabeled result for a particular nested call without a persisted identity edge / 在缺少持久化 identity 边时，把不可区分的外层输出当作某个特定嵌套调用的精确结果或未标注结果
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

Declared Nested Calls remain source declarations rather than execution facts. Supported declarations may additionally produce request-only Nested Tool Projections inside the accepted operation presentation, but the operation identity and canonical event model do not change. Loops, branches, concurrency, and dynamic dispatch mean one source call site can execute zero, one, or many times; no projection becomes a Logical Event, counter, status, parent link, or execution claim.

声明的嵌套调用仍是来源声明，而不是执行事实。受支持的声明可以在已接受的 operation 呈现内额外生成 request-only 嵌套工具投影，但 operation identity 与 canonical 事件模型不变。循环、分支、并发和动态分派意味着一个来源调用位置可以执行零次、一次或多次；任何投影都不会成为逻辑事件、计数器、状态、父链接或执行声明。

## Nested Tool Projections / 嵌套工具投影

A Nested Tool Projection is an operation-owned display fragment derived from a supported structured nested request. It may originate from a Declared Nested Call even when no nested lifecycle evidence was persisted. It remains request-only: presentation may show the tool name and bounded structured arguments, but must not state that the request executed.

嵌套工具投影是从受支持的结构化嵌套 request 派生、归属于 operation 展示的片段。即使没有持久化 nested lifecycle 证据，它也可以来自声明的嵌套调用。它始终保持 request-only：呈现可以显示工具名称和受限结构化 arguments，但不得声称该 request 已执行。

Every projection exposes one explicit result-association label: / 每个投影都暴露一个明确的结果关联标签：

- `exact`: a persisted identity edge proves which observed result belongs to the request. / `exact`：持久化 identity 边证明哪个已观测结果属于该 request。
- `bounded`: no exact identity edge exists, but one result fragment can be conservatively related within a strictly ordered static shape. This is permitted only when calls and candidate results are sequential and one-to-one, with no branch, loop, concurrency (`Promise.all` or equivalent), dynamic tool selection, repeated call site, or ambiguous extra output. The UI must label the association as bounded rather than exact. / `bounded`：不存在精确 identity 边，但在严格有序静态形态中，可以保守地把一个结果 fragment 与 request 关联。只有当调用与候选结果按顺序一一对应，且不存在分支、循环、并发（`Promise.all` 或同类形态）、动态工具选择、重复调用位置或歧义额外输出时才允许使用。UI 必须把该关联标为 bounded，而不是 exact。
- `none`: no result is assigned to the projection. This is the default whenever the source shape or output mapping is uncertain. / `none`：不向投影分配结果。只要来源形态或输出映射存在不确定性，就默认使用该值。

Unsupported syntax, unsafe values, parse uncertainty, or any failed eligibility check uses raw fallback: keep the outer JavaScript as the readable source and preserve lossless verification through operation Raw refs. The analyzer must not execute JavaScript to improve a projection or association.

不受支持的语法、不安全的值、解析不确定性，或任何资格检查失败，都会使用 raw fallback：保留 outer JavaScript 作为可读来源，并通过 operation Raw refs 保留无损验证能力。Analyzer 不得为了改进投影或关联而执行 JavaScript。

Projection extraction runs only while building operation detail. It uses a versioned known-tool allowlist, a real JavaScript parser, and an all-or-nothing top-level sequential grammar with recursively bounded literal arguments. One unsupported statement, tool, binding, argument, or emission shape makes the entire source use raw fallback; partial projections are forbidden because they can imply a complete execution list.

投影提取只在构建 operation detail 时运行。它使用版本化的已知工具 allowlist、真正的 JavaScript parser，以及全有或全无的顶层顺序语法与递归受限的 literal arguments。只要存在一个不受支持的语句、工具、绑定、参数或 emission 形态，整个来源就使用 raw fallback；禁止生成局部投影，因为局部列表可能暗示它是一份完整执行清单。

Whenever `bounded` assigns a result fragment, the projection keeps that entire sanitized fragment in a collapsed associated-result section even if a specialized renderer also shows a plan, command output, collaboration response, or truncated summary. Structured interpretation of result JSON has independent character, depth, and node budgets; over-budget values remain uninterpreted text. Raw refs remain the lossless source when standard payload sanitization removes embedded data URLs.

只要 `bounded` 分配了某个结果 fragment，投影就会在折叠的关联结果 section 中保留该 fragment 的完整脱敏文本，即使专用 renderer 还会展示计划、命令输出、协作响应或截断摘要。结果 JSON 的结构化解释使用独立的字符数、深度与节点预算；超出预算的值保持为未解释文本。当标准 payload 脱敏移除内嵌 data URL 时，Raw refs 继续作为无损来源。

Nested Tool Projections own no Logical Event identity, metrics, search document or target, Raw refs, source rows, outcome, severity, or escalation tag. Their text is already covered by the operation's single search owner. Observed Nested Activity remains the canonical, independently inspectable Logical Event and is never replaced, merged, or demoted by a projection; exact or bounded projection display is not a second event.

嵌套工具投影不拥有逻辑事件 identity、指标、搜索文档或目标、Raw refs、来源行、结果、severity 或提权标签。其文本已经由 operation 的单一搜索 owner 覆盖。已观测嵌套活动仍是 canonical、可独立检查的逻辑事件，绝不会被投影替代、合并或降级；exact 或 bounded 投影展示也不是第二个事件。

## Adaptive single/multi-tool presentation / 单工具与多工具自适应呈现

Adaptive presentation is selected only after the detail-only whole-program projector succeeds. Exactly one declared request uses `single_tool`: its projection wrapper is removed, its existing structured request/result sections become the timeline body, and the compact event header receives the presentation-only native tool title plus one visible Code Mode chip. Because that title already names the tool, the machine tool-name chip is omitted. A bounded result that is actually displayed adds the compact warning `Inferred result`; separate outer output adds `Unassociated output`. Request evidence and machine tool name remain in inspector chips, metadata, and projection evidence rather than the timeline header. Outer source, projection evidence, operation metadata, command context/result metadata, protocol channel, Raw-ref count, and wait trace are inspector detail. A final outer output without bounded association stays in the timeline under `Unassociated operation output`; it is not assigned to the declared tool. / 只有详情阶段的整段程序 projector 成功后，才选择自适应呈现。恰好一个声明 request 时使用 `single_tool`：移除投影 wrapper，让既有结构化 request/result sections 成为时间线正文，并在紧凑事件 header 中增加仅 presentation 的原生工具 title 与一个明确的代码模式 chip。由于标题已经命名工具，因此省略机器工具名 chip。Request evidence 与机器工具名保留在 inspector chip、metadata 与投影证据中，不再占用时间线 header。只有实际展示 bounded 结果时才增加紧凑警示“推断结果”；outer output 保持分离时增加“未关联输出”。Outer source、投影证据、operation metadata、命令 context/result metadata、协议 channel、Raw-ref 数量与 wait trace 属于 inspector 详情。没有 bounded 关联的最终 outer output 仍以 `Unassociated operation output` 留在时间线中，不会被分配给声明工具。

`resultAssociation: none` means only that no result fragment was assigned to a declared request; it does not prove that any output exists. The presentation descriptor therefore carries the separate boolean `hasUnassociatedOutput`, derived from an actually observed final outer output that lacks complete association. Header and inspector output-warning chips require that boolean, while request-only and incomplete-tail operations show no output warning. / `resultAssociation: none` 只表示没有 result fragment 被分配给声明 request，并不证明存在任何 output。因此 presentation descriptor 使用独立布尔值 `hasUnassociatedOutput`，它只能由实际观测到、且缺少完整关联的最终 outer output 派生。Header 与 inspector 的输出警示 chip 都必须依赖该布尔值；request-only 与 incomplete-tail operation 不显示输出警示。

Projected shell run context preserves numeric timeout values. `timeout_ms` takes nullish precedence over the compatibility alias `timeoutMs`, and the chosen scalar is formatted only after selection rather than passed through string-oriented non-empty selection. / 投影的 shell 运行上下文会保留数值 timeout。`timeout_ms` 通过 nullish 规则优先于兼容别名 `timeoutMs`；应先选定 scalar，再格式化，而不是让它经过面向字符串的非空选择逻辑。

Two or more declared requests use `multi_tool`: the current projection wrappers and folded outer source remain in the timeline, the header label becomes `Multi-tool Code Mode operation`, and one compact tool-count chip is shown. The title replaces a redundant Code Mode chip; a bounded association adds `Inferred result` only because projected results are actually visible. Unsupported programs use `raw_code_mode` and retain the existing command/final-output/trace presentation without any single, multiple, or complex claim. / 两个及以上声明 request 使用 `multi_tool`：当前投影 wrapper 与折叠 outer source 继续留在时间线，header label 变为 `Multi-tool Code Mode operation`，并显示一个紧凑工具数量 chip。标题取代重复的代码模式 chip；只有投影结果实际可见时，bounded 关联才增加“推断结果”。不受支持的程序使用 `raw_code_mode`，保留现有 command/final-output/trace 呈现，不提出 single、multiple 或 complex 声明。

The descriptor is presentation-only. All three variants keep canonical `kind: other_tool_call`, `subtype: code_mode_operation`, `toolName: exec`, operation identity, metric/search/Raw-ref ownership, neutral outcome, and independently visible Observed Nested Activity. The AST projector remains detail-only; visible Code Mode cards may lazily fetch detail to refine their headers, but cold indexing does not classify declared tool composition. / 该 descriptor 只属于 presentation。三个 variant 都保持 canonical `kind: other_tool_call`、`subtype: code_mode_operation`、`toolName: exec`、operation identity、指标/搜索/Raw-ref 所有权、中性 outcome，以及独立可见的已观测嵌套活动。AST projector 继续只在详情阶段运行；可见 Code Mode 卡片可以惰性获取详情以细化 header，但冷索引不会分类声明工具组成。

## Web request projection and lifecycle compression / Web request 投影与生命周期压缩

For `web__run`, the detail projector groups literal top-level arrays such as `search_query`, `open`, `click`, `find`, `finance`, `weather`, `sports`, and `time`. Each group shows only bounded identifying fields and shared options; it does not evaluate JavaScript, infer execution multiplicity from syntax, or manufacture a per-result schema. A bounded terminal fragment is rendered through the existing Markdown pipeline (`html: false`, safe-link validation, escaped fallback), while the complete sanitized fragment remains folded in inspector evidence. Citation markers remain text and do not create synthetic links. / 对 `web__run`，detail projector 会对 `search_query`、`open`、`click`、`find`、`finance`、`weather`、`sports` 与 `time` 等 literal 顶层数组分组。每组只展示受限辨识字段与共享 option；不会求值 JavaScript、从语法推断执行次数，也不会伪造逐结果 schema。Bounded terminal fragment 通过既有 Markdown pipeline 渲染（`html: false`、安全链接校验、转义 fallback），完整脱敏 fragment 则继续折叠保存在 inspector 证据中。Citation marker 保持文本，不生成合成链接。

`web_search_end` is not moved to the Protocol layer. It remains the canonical Main timeline `web_search` event and keeps its event identity, metrics, search document/target, status, and Raw refs. When a Code Mode detail supplies a unique `event_refs` association to such an event, the browser only compresses its ordinary presentation to a one-line `Web activity observed` lifecycle row and hides redundant preview/tool chips. A search hit may still reveal its preview, and opening the row retains the canonical event detail. Ambiguous or missing associations receive no compression. / `web_search_end` 不会移入 Protocol 层。它继续作为 canonical Main timeline `web_search` event，并保留 event identity、指标、搜索 document/target、status 与 Raw refs。当 Code Mode detail 通过 `event_refs` 唯一关联到该事件时，浏览器只把其普通呈现压缩为一行“已观测网页活动”生命周期行，并隐藏重复 preview/tool chip。搜索命中仍可显示其 preview，打开该行也仍保留 canonical event detail。歧义或缺失关联不会触发压缩。

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
- Count every Nested Tool Projection zero times; its association label does not change operation or nested-event metrics. / 每个嵌套工具投影计数零次；其关联标签不改变 operation 或 nested event 指标。
- Do not follow `eventRefs` when aggregating counts; they are relations, not ownership copies. / 聚合计数时不得跟随 `eventRefs`；它们是关系，不是所有权副本。

Thus a Code Mode Operation with two associated nested lifecycle events and three waits contributes one operation plus two nested tool calls, not six tool calls. Both A and B must produce the same metrics.

因此，一个包含两个已关联嵌套生命周期事件和三次 wait 的 Code Mode 操作，应贡献一次 operation 和两次 nested tool call，而不是六次 tool call。A/B 两个方案必须产生相同指标。

## Search rules / 搜索规则

- Index the operation's outer JavaScript and accumulated exec/wait outputs once under one operation search owner. / 将操作的外层 JavaScript 及累积 exec/wait 输出在一个操作搜索 owner 下只索引一次。
- Do not create standalone wait search owners. Poll text resolves to the owning operation. / 不创建独立 wait 搜索 owner；poll 文本归属其操作。
- Keep each nested Logical Event's existing search document and target. Do not copy nested search text into the operation by following `eventRefs`. / 保留每个嵌套逻辑事件现有的搜索文档和目标；不得沿 `eventRefs` 把嵌套搜索文本复制到操作。
- Declared Nested Call text remains covered by the already-indexed JavaScript and is not separately indexed; a Nested Tool Projection is another view of that same operation-owned text and creates no extra results, tool facets, or execution claims. / 声明的嵌套调用文本继续由已索引的 JavaScript 覆盖，不会被单独索引；嵌套工具投影只是同一份 operation-owned 文本的另一种视图，不创建额外结果、工具 facet 或执行声明。
- Nested Tool Projections create no search owner or duplicated searchable text; their request and any displayed result remain covered by the operation's existing single owner. / 嵌套工具投影不创建搜索 owner，也不复制可搜索文本；其 request 与任何展示结果继续由 operation 既有的单一 owner 覆盖。
- A maps the operation search owner to its composite Logical Event ID. B maps it to the non-event group's stable ID. The A/B decision must compare identical queries and exact owner IDs/counts. / A 方案把操作搜索 owner 映射到复合逻辑事件 ID；B 方案把它映射到非事件 group 的稳定 ID。A/B 决策必须使用相同 query 并比较精确 owner ID/计数。

## Escalation rules / 提权规则

Escalation is evidence, not an outcome classifier. V1 creates an `Escalation requested` tag only when an Observed Nested Activity owns a structured request whose `sandbox_permissions` is exactly `require_escalated`. The tag belongs only to that nested event. The same text inside outer JavaScript remains visible and searchable but creates no tag or approval event. A persisted permission/approval lifecycle record, if present, remains its own observed evidence and event.

提权是证据，不是结果分类器。V1 只有在某个已观测嵌套活动拥有结构化 request，且其中 `sandbox_permissions` 精确等于 `require_escalated` 时，才创建 `Escalation requested` 标签。该标签只属于这个嵌套事件。outer JavaScript 中的同名文本继续保持可见、可搜索，但不会创建标签或 approval 事件。如果存在持久化的 permission/approval 生命周期记录，它继续作为独立的已观测证据和事件。

The implementation must not execute JavaScript to recover escalation, must not treat an unstructured keyword occurrence as structured evidence, and must not infer failure or decline from approval-related text in ordinary output. Absence of an approval event means “not observed,” not “no approval happened.”

实现不得为恢复提权信息而执行 JavaScript，不得把非结构化关键字出现当作结构化证据，也不得根据普通输出中的审批相关文本推断失败或拒绝。缺少 approval event 表示“未观测到”，不表示“没有发生审批”。

## Representation decision / 呈现决策

### A: composite Logical Event / A：复合逻辑事件

A emits one Main Timeline event for the operation using the existing `kind: other_tool_call`, `subtype: code_mode_operation`, and `toolName: exec`. It owns only outer exec and wait refs, exposes associated nested IDs through detail `eventRefs`, and leaves nested Logical Events independently visible. It adds no new kind and remains status-neutral.

A 在主时间线中为操作发出一个事件，使用现有 `kind: other_tool_call`、`subtype: code_mode_operation` 和 `toolName: exec`。它只拥有外层 exec/wait refs，通过详情 `eventRefs` 暴露相关嵌套 ID，并让嵌套逻辑事件继续独立可见。它不新增 kind，并保持状态中性。

Adding zero or more Nested Tool Projections does not create a second operation or change the operation ID, Logical Event ID, kind, subtype, raw ownership, metric ownership, or search owner. Projections are sections inside the accepted A presentation, not children in the canonical event graph.

增加零个或多个嵌套工具投影不会创建第二个 operation，也不会改变 operation ID、逻辑事件 ID、kind、subtype、raw 所有权、指标所有权或搜索 owner。投影只是已接受 A 呈现内部的 section，不是 canonical 事件图中的子节点。

Accepted. The expanded timeline body gives the outer JavaScript command and final observed output the primary visual region. When waits exist, their phase metadata and intermediate outputs live in one collapsed-by-default `code_mode_trace` section after the final output. Operation evidence, observation state, cell ID, and poll count live in the inspector; associated nested events remain independently navigable through inspector-only `event_refs`.

Display extraction is deliberately separate from observation classification. Classification reads the complete outer output so the canonical first line still determines pending or terminal state. Presentation may remove a leading status-only array fragment when a later fragment contains the actual tool result, and strips ANSI terminal control sequences; Raw refs preserve the original fragments and escapes.

已接受。展开后的 timeline 正文把 outer JavaScript 命令与最终已观测输出作为主要视觉区域。存在 wait 时，各阶段元数据和中间输出位于最终输出之后的单个 `code_mode_trace` section 中，并默认折叠。Operation 的证据状态、观测状态、cell ID 和轮询次数位于 inspector；关联的 nested event 继续通过 inspector 专用 `event_refs` 独立导航。

展示提取与观测分类有意分离。分类读取完整 outer output，仍由 canonical 首行判断 pending 或 terminal；展示可以在后续 fragment 包含实际工具结果时移除开头仅含状态的数组 fragment，并剥离 ANSI 终端控制序列。Raw refs 保留原始 fragment 与转义字符。

### B: non-event group / B：非事件 group

B represents the operation as a stable group/container around child events for the outer exec phase, every Poll Phase, and every associated Observed Nested Activity, without emitting a Logical Event for the operation itself. The group owns the operation search target and one operation metric contribution. Exec and wait children remain independently inspectable inside the group, but Poll Phases contribute zero tool-call metrics; nested event identities and metrics remain unchanged.

B 把操作表示为一个稳定 group/container，其中的子事件包括 outer exec phase、每一个轮询阶段，以及每一个已关联嵌套活动，但不为操作本身发出逻辑事件。该 group 拥有操作搜索目标和一次 operation 指标贡献。exec 与 wait 子项在 group 内保持可独立检查，但轮询阶段贡献零次工具调用指标；nested event 的 identity 与指标保持不变。

Rejected for the product path. Although B preserved the shared facts, it required group-specific API, pagination, search-target, metrics, ordering, and browser state paths, and measured slower cold startup on the comparison corpus. A fits the existing Logical Event contract with less migration risk. The B worktree is intentionally retained as comparison evidence rather than merged.

产品实现不采用 B。虽然 B 保留了共享事实，但它需要 group 专属的 API、分页、搜索目标、指标、顺序和浏览器状态路径，并在对比语料上测得更慢的冷启动。A 能以更低迁移风险适配现有逻辑事件契约。B worktree 有意保留为对比证据，不合并进产品实现。

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

Candidate A was accepted on 2026-07-15 after both candidates passed the symmetric correctness gate. The product spec and `logical-event-timeline.md` now record the composite-event behavior; the main implementation contains no group-container DTO path.

候选 A 已于 2026-07-15 在两个候选都通过对称正确性门禁后获接受。产品规格与 `logical-event-timeline.md` 现已记录复合事件行为；主实现不包含 group-container DTO 路径。

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
- A structured projection can look like execution evidence even when it is request-only, and a bounded result can look exact if its uncertainty is hidden. Keep the request-only and association labels visible, make bounded eligibility fail closed, and prefer raw fallback over a fabricated mapping. / 结构化投影即使只是 request-only，也可能看起来像执行证据；如果隐藏不确定性，bounded 结果也可能看起来像 exact。应保持 request-only 与关联标签可见，让 bounded 资格检查以保守失败为原则，并优先使用 raw fallback 而不是制造映射。

## Validation / 验证

- Sanitized synthetic fixtures cover direct completion, pending/multi-wait completion, pending tail, unobserved terminal, incomplete tail, unique and ambiguous physical intervals, nested lifecycle events, outer-JavaScript escalation text without a tag, and misleading failure keywords. / 脱敏合成 fixture 覆盖直接终态、pending/multi-wait 完成、pending 尾部、unobserved terminal、incomplete tail、唯一与歧义物理区间、嵌套生命周期事件、outer JavaScript 中不产生标签的提权文本，以及误导性失败关键字。
- Shared-core unit tests assert grouping and association without depending on A or B presentation. / 共享核心单元测试断言分组与关联，且不依赖 A 或 B 呈现。
- Candidate tests assert identical counts, search owners, raw-ref ownership, event refs, and neutral status. / 候选方案测试断言完全一致的计数、搜索 owner、raw-ref 所有权、event refs 和中性状态。
- Browser acceptance uses only sanitized fixtures until a winning representation is chosen; real transcripts remain read-only validation inputs and are never committed. / 胜出呈现确定前，浏览器验收只使用脱敏 fixture；真实转录只作为只读验证输入，绝不提交。
- Structured-projection fixtures cover request-only display, emitted `bounded` and `none` labels, strict sequential bounded eligibility, branch/loop/concurrency rejection, unsafe or unsupported argument fallback, unchanged operation identity, zero projection ownership, and coexistence with canonical Observed Nested Activity events. `exact` remains reserved for a future persisted identity edge and must not be emitted or fixture-claimed until such evidence exists. / 结构化投影 fixture 覆盖 request-only 展示、实际发出的 `bounded` 与 `none` 标签、严格顺序 bounded 资格、分支/循环/并发拒绝、不安全或不受支持 argument fallback、不变的 operation identity、投影零所有权，以及与 canonical 已观测嵌套活动事件共存。`exact` 保留给未来的持久化 identity 边；在这种证据出现前，不得发出该标签，也不得声称 fixture 已覆盖。

## Decision log / 决策日志

- 2026-07-14: Accepted the shared operation semantics and opened an A/B decision between a composite Logical Event and a non-event group. No new kind, product-spec change, or logical-timeline contract is accepted yet. / 2026-07-14：接受共享操作语义，并在复合逻辑事件与非事件 group 之间开启 A/B 决策。当前尚未接受新 kind、产品规格变更或逻辑时间线 contract 变更。
- 2026-07-15: Selected A after symmetric unit/browser/package validation and directional cold-start comparison. The accepted UI prioritizes command and final output, folds wait trace by default, and keeps operation metadata plus nested-event navigation in the inspector. Both prototype worktrees are retained; only A was integrated. / 2026-07-15：在对称单元/浏览器/package 验证和方向性冷启动对比后选择 A。已接受 UI 优先展示命令和最终输出，默认折叠 wait 过程，并把 operation 元数据与 nested-event 导航保留在 inspector。两个原型 worktree 都继续保留；只有 A 被集成。
- 2026-07-15: Accepted request-only Nested Tool Projections as an additive presentation inside A without changing operation identity or the canonical event model. Result association must be explicit (`exact | bounded | none`); bounded is limited to strict sequential static shapes, and every uncertain case uses raw fallback. / 2026-07-15：接受 request-only 嵌套工具投影作为 A 内部的增量呈现，不改变 operation identity 或 canonical 事件模型。结果关联必须明确标注（`exact | bounded | none`）；bounded 仅限严格有序静态形态，所有不确定场景都使用 raw fallback。
- 2026-07-16: Accepted adaptive presentation: one safe declared tool reuses its structured body with visible Code Mode/evidence header labels and inspector-only operation details; multiple declarations retain composite cards under a multi-tool label; raw fallback remains unclassified. Canonical event semantics do not change. / 2026-07-16：接受自适应呈现：一个安全声明工具复用其结构化正文，header 明确显示代码模式/证据标签，operation 详情只进 inspector；多个声明继续在多工具 label 下使用复合卡片；raw fallback 保持未分类。Canonical event 语义不变。
