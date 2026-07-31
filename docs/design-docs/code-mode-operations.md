# Code Mode Operations / Code Mode 操作

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted; composite Logical Event selected / 状态：已接受；选用复合逻辑事件
- Last updated: 2026-07-30 / 最近更新：2026-07-30
- Related spec: `docs/product-specs/session-transcript-analyzer.md` / 相关规格：`docs/product-specs/session-transcript-analyzer.md`
- Related design docs: / 相关设计文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/design-docs/code-mode-structured-display-catalog.md`
- Related plan: / 相关计划：
  - `docs/exec-plans/completed/2026-07-16-code-mode-adaptive-presentation.md`
  - `docs/exec-plans/completed/2026-07-14-code-mode-operation-grouping.md`
  - `docs/exec-plans/completed/2026-07-15-code-mode-structured-nested-projections.md`
  - `docs/exec-plans/completed/2026-07-22-code-mode-context-and-discoverability.md`
  - `docs/exec-plans/active/2026-07-25-code-mode-request-facets-and-folding.md`

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

The accepted public reverse relation is presentation-only. At a logical timeline DTO or layer-aware event-envelope response boundary, a nested event may receive exactly `{ relation: 'enclosed_by_code_mode_operation', codeModeParentId }` under optional `presentationContext` only when one existing canonical `code_mode_operation` parent has an existing ID and lists that nested ID in `eventRefs`. It is omitted for zero or multiple parents, missing/malformed refs, self/ambiguous/cross-span associations, and declaration/projection-only facts. It is never inferred from JavaScript, tool names, timestamps, adjacency, or similar call IDs, and it is not written into raw DTOs or the canonical event graph. Parent and child identities, Raw refs, status, counts, search owners/targets, metrics, and evidence ownership remain unchanged.

已接受的公开反向关系只用于呈现。在逻辑 timeline DTO 或感知事件层 event-envelope 响应边界，nested event 只有在一个已有规范 `code_mode_operation` 父操作具有已有 ID 且其 `eventRefs` 列出该 nested ID 时，才可以在可选 `presentationContext` 下获得精确的 `{ relation: 'enclosed_by_code_mode_operation', codeModeParentId }`。父操作为零或多个、refs 缺失/格式错误、自引用/歧义/跨区间关联，以及仅有声明/投影事实时都会省略。它绝不从 JavaScript、工具名称、timestamp、相邻关系或相似 call ID 推断，也不会写入 raw DTO 或规范事件图。父子 identity、Raw refs、status、计数、搜索 owner/target、指标和证据 ownership 均保持不变。

### Main discoverability and canonical folding / Main 可发现性与规范折叠

Code Mode Operations use the independent canonical `kind: code_mode_operation`; `other_tool_call` therefore excludes them in catalogs, filters, counts, and canonical kind rules. The Main Kind picker does not expose an all-Code-Mode row: it presents only `Scripted operation` and safely declared request rows beneath the `Code Mode tool calls` group. Folding follows the same boundary. Declared requests inherit their corresponding ordinary tool behavior, while `codeModeScriptOperation` matches only operations without a safe declared-request fact and inherits the ordinary `other_tool_call` state when unset. The independent kind remains part of metrics and DTO identity but is not directly editable as a broad folding rule.

Code Mode operation 使用独立规范 `kind: code_mode_operation`；因此目录、筛选、计数和规范 kind 规则中的 `other_tool_call` 都不再包含它们。Main 类型选择器不暴露“全部 Code Mode”行，只在“Code Mode 工具调用”分组下展示“脚本化操作”和可安全识别的声明 request 行。折叠遵循同一边界：声明 request 继承对应普通工具行为，`codeModeScriptOperation` 只匹配缺少安全声明 request 事实的 operation，未设置时继承普通 `other_tool_call` 状态。独立 kind 仍参与指标和 DTO identity，但不会作为宽泛折叠规则直接编辑。

Declared Nested Calls remain source declarations rather than execution facts. Supported declarations may additionally produce request-only Nested Tool Projections inside the accepted operation presentation, but the operation identity and canonical event model do not change. Loops, branches, concurrency, and dynamic dispatch mean one source call site can execute zero, one, or many times; no projection becomes a Logical Event, counter, status, parent link, or execution claim.

声明的嵌套调用仍是来源声明，而不是执行事实。受支持的声明可以在已接受的 operation 呈现内额外生成 request-only 嵌套工具投影，但 operation identity 与 canonical 事件模型不变。循环、分支、并发和动态分派意味着一个来源调用位置可以执行零次、一次或多次；任何投影都不会成为逻辑事件、计数器、状态、父链接或执行声明。

### Declared-request presentation index, facets, and folding / 声明请求呈现索引、分面与折叠

Cold Session indexing invokes the same exact outer-exec source lookup and all-or-nothing eligibility entry point as detail, but retains only a name-only presentation fact outside the canonical event graph. The in-memory index is `session.presentationIndexes.codeModeDeclaredRequests`, a `Map<operationId, { toolNames, requestEvidence: 'declared_source' }>` keyed by the existing Code Mode operation ID. It never writes request names, source, AST nodes, request arguments, result association, or execution information onto a canonical Logical Event. The compact logical DTO may expose the same fact only as `presentationFacts.codeModeDeclaredRequests`; full request data remains detail-only.

冷启动的 Session 索引会调用与 detail 相同的精确 outer-exec 源码查找和全有或全无资格入口，但只在 canonical 事件图之外保留仅含名称的呈现事实。内存索引为 `session.presentationIndexes.codeModeDeclaredRequests`，它是以既有 Code Mode operation ID 为键的 `Map<operationId, { toolNames, requestEvidence: 'declared_source' }>`。它绝不会把 request 名称、源码、AST 节点、request 参数、result association 或执行信息写入 canonical Logical Event。轻量逻辑 DTO 只能通过 `presentationFacts.codeModeDeclaredRequests` 暴露同一事实；完整 request 数据仍只存在于 detail。

Only a whole-program `projectDeclaredCodeModeCalls(...).supported === true` result contributes a fact. Dynamic arguments or dispatch, unsupported bindings, branches, loops, concurrency, unknown tools, syntax errors, and source/call/literal budget failures contribute nothing. A fact proves only that the outer source declared a request: it owns no Logical Event identity, execution count, status, severity, touched files, metric, search owner or target, Raw Reference, escalation state, result, or outcome. Observed Nested Activity remains independent and is never merged, hidden, deduplicated, or promoted through this fact; the canonical `updatePlanCall` and `userInputRequest` folding conditions retain their execution-oriented definitions.

只有整段程序的 `projectDeclaredCodeModeCalls(...).supported === true` 才会贡献事实。动态参数或分派、不受支持的 binding、分支、循环、并发、未知工具、语法错误，以及 source/call/literal 预算失败都不贡献任何事实。该事实只证明 outer source 声明了 request：它不拥有 Logical Event identity、执行次数、status、severity、touched files、指标、搜索 owner 或 target、Raw Reference、提权状态、result 或 outcome。Observed Nested Activity 保持独立，绝不会因这一事实被合并、隐藏、去重或提升；canonical 的 `updatePlanCall` 与 `userInputRequest` 折叠 condition 继续使用面向执行的定义。

`Code Mode request / Code Mode 请求` is a separate Main-layer query and catalog dimension, not an Event type alias. The exact query parameter is `codeModeRequest=<stable-tool-name>`. It matches only canonical `kind === 'code_mode_operation'` events carrying the requested safe fact, composes with `q`, `kind`, `status`, and `file` on the same parent event, and clears on a Protocol or Raw transition. In the browser Kind select, the `Code Mode tool call` optgroup has no all-operation choice. It contains the presentation-scoped `Scripted operation` facet (`kind=code_mode_script_operation`) for no-fact fallback events and `Declared: <tool>` children. A declared child atomically projects to `kind=code_mode_operation` plus `codeModeRequest=<stable-tool-name>`; Scripted operation uses only its synthetic Kind facet. Each counts as one visible Kind filter, and selecting Scripted operation or another Kind clears `codeModeRequest`. A repeated tool declaration counts once per operation; a multi-tool operation can match several request facets but remains one event in totals, pagination, phrase occurrences, matching-event counts, and jump targets. `status` and `file` keep reading canonical parent facts. State and timeline payloads expose `codeModeRequests` beside `eventKinds`; the event-kind catalog exposes both the real `code_mode_operation` kind and `code_mode_script_operation` with `matchField: 'presentation_fallback'`. Friendly labels never replace stable values.

`Code Mode request / Code Mode 请求` 是独立的 Main 层查询与目录维度，而不是 Event type 的别名。精确查询参数为 `codeModeRequest=<stable-tool-name>`。它只匹配带有所请求安全事实的 canonical `kind === 'code_mode_operation'` event，并与 `q`、`kind`、`status` 和 `file` 在同一个父事件上组合；切换到 Protocol 或 Raw 时会清除。浏览器类型选择器中的 `Code Mode 工具调用` optgroup 不再提供“全部 operation”选项，而是包含面向无事实回退 event 的 presentation 范围“脚本化操作”facet（`kind=code_mode_script_operation`）和 `声明：<工具>` 子项。声明子项会原子投影为 `kind=code_mode_operation` 加 `codeModeRequest=<stable-tool-name>`；“脚本化操作”只使用其合成 Kind facet。每个选择只计作一个可见类型筛选，选择“脚本化操作”或其他类型都会清除 `codeModeRequest`。重复声明同一工具在每个 operation 中只计一次；多工具 operation 可以命中多个 request 分面，但在总数、分页、短语 occurrence、匹配事件数和跳转 target 中仍是一个 event。`status` 与 `file` 继续读取 canonical 父事件事实。State 与 timeline payload 会在 `eventKinds` 旁暴露 `codeModeRequests`；事件类型目录同时暴露真实 `code_mode_operation` kind 和带 `matchField: 'presentation_fallback'` 的 `code_mode_script_operation`。友好 label 绝不取代稳定 value。

Folding profiles add the independent `codeModeRequestStates` rule family. Natural state resolution deliberately ignores the broad `code_mode_operation` kind rule, takes one contribution for every safely declared request plus every matching existing condition rule, and retains the most-visible merge `expanded > summary > collapsed > hidden`; a valid manual event override remains higher. An explicit request rule supplies its request contribution. When that rule is unset, the request instead follows an evidence-neutral ordinary-call alias: `shell_command` and `exec_command` use `command`, `apply_patch` uses `patch`, goal tools use `goal`, `update_plan` and `request_user_input` can match their ordinary tool-name conditions, and all remaining tools use `other_tool_call`. A Scripted operation with no explicit `codeModeScriptOperation` condition also inherits `other_tool_call`. These aliases have normal severity, successful status, no preview, and no touched files, so failure, file, review-command, result, or execution facts are never invented. Built-in profiles contain no explicit Code Mode rules and therefore use inherited ordinary-call states. Missing maps normalize to `{}`, while valid unknown or historical tool keys survive browser-local normalization and persistence and appear under `Other / historical requests` until the current catalog exposes them again. Request-rule edits preview directly from timeline DTO facts and do not fetch detail. The editor uses ordinary rule rows: one `Scripted operation` fallback row followed directly by `codeModeRequestStates` rows. When Code Mode data or saved Code Mode rules exist, rendering synthesizes an explicit empty `commonWork` group if necessary, attaches the Code Mode subgroup there exactly once, and never attaches it while mapping default-kind groups. Unset rows compactly show `Inherit: <resolved ordinary state>`. Obsolete all-Code-Mode conditions are rejected. Rows retain localized labels, stable ids, operation counts, and compact Changed markers without a dedicated card, nested disclosure, local sticky heading, indentation guide, or Code Mode-only emphasis.

折叠策略增加独立的 `codeModeRequestStates` 规则族。自然状态求值会有意忽略宽泛的 `code_mode_operation` kind 规则，收集每个安全声明 request 的一个贡献和每条命中的既有 condition 规则，然后继续使用最可见合并 `expanded > summary > collapsed > hidden`；合法的手动事件覆盖仍具有更高优先级。显式 request 规则会提供该 request 的贡献；未设置时则沿用不携带执行证据的普通调用别名：`shell_command` 与 `exec_command` 使用 `command`，`apply_patch` 使用 `patch`，goal 工具使用 `goal`，`update_plan` 与 `request_user_input` 可以命中同名普通工具条件，其余工具使用 `other_tool_call`。没有显式 `codeModeScriptOperation` condition 的“脚本化操作”同样继承 `other_tool_call`。这些别名固定为正常严重性、成功状态、无 preview、无触达文件，因此绝不会虚构失败、文件、review 命令、result 或执行事实。内置 profile 不含显式 Code Mode 规则，因此使用普通调用继承状态。缺失 map 会规范化为 `{}`；有效但未知或历史的工具 key 会跨浏览器本地规范化与持久化保留，并在当前目录重新暴露前显示于“其他/历史请求”。Request 规则编辑直接依据 timeline DTO 事实预览，不会请求 detail。编辑器使用普通规则行：先提供一个“脚本化操作”兜底行，再直接列出 `codeModeRequestStates` 行。当存在 Code Mode 数据或已保存规则时，渲染会在必要时合成一个显式的空 `commonWork` 分组，把 Code Mode 子组只挂载一次，并且绝不在映射默认 kind 分组时挂载它。未设置的行紧凑显示“继承：<解析后的普通状态>”。过时的“全部 Code Mode”condition 会被拒绝。各行保留本地化名称、稳定 id、按 operation 计数和紧凑的“已修改”标记，不再使用专属卡片、嵌套 disclosure、局部吸顶标题、缩进导线或 Code Mode 专属强调。

Agent Coordination is the exception to the preceding “remaining tools” fallback. Safely declared `spawn_agent`, `list_agents`, `wait_agent`, `send_message`, `send_input`, `followup_task`, `interrupt_agent`, and `close_agent` requests inherit the ordinary `agent_coordination` kind. When that kind has no explicit rule, it in turn inherits `other_tool_call` for saved-strategy compatibility; an explicit `agent_coordination` rule replaces the compatibility inheritance. / Agent 协调是上述“其余工具”兜底规则的例外。可安全识别的 `spawn_agent`、`list_agents`、`wait_agent`、`send_message`、`send_input`、`followup_task`、`interrupt_agent` 和 `close_agent` request 会继承普通 `agent_coordination` kind。该 kind 没有显式规则时，会继续继承 `other_tool_call` 以兼容已保存策略；显式 `agent_coordination` 规则会替代这项兼容继承。

The profile header remains sticky above the scrolling editor so the active strategy, dirty status, and save/cancel actions do not disappear during long request catalogs. The Code Mode group itself follows ordinary section scrolling and adds no second sticky layer.

Profile 标题会固定在滚动编辑器上方，使当前策略、未保存状态和保存/取消操作不会在较长的 request 目录中消失。Code Mode 子组随“工作与工具”区段滚动，不再增加第二层吸顶。

Within Event kinds, Code Mode is a lightweight presentation subgroup inside `Work and tools`, following the ordinary command, patch, web, MCP, JS REPL, and other-tool rows. This does not merge declared requests into canonical kind grouping; it gives all tool-call controls one top-level home. Reasoning, collaboration, lifecycle, and diagnostic kinds remain under `Agent and system events`; presentation-only facets are excluded from ordinary kind rules. / 在“事件类型”中，Code Mode 是“工作与工具”内部的轻量呈现子组，位于普通命令、文件补丁、网页、MCP、JS REPL 和其它工具规则之后。这不会把声明 request 并入 canonical kind 分组，而是让所有工具调用控件只有一个顶层归属；推理、协作、生命周期和诊断类型继续归入“代理与系统事件”；仅用于呈现的 facet 会从普通 kind 规则中排除。

## Nested Tool Projections / 嵌套工具投影

A Nested Tool Projection is an operation-owned display fragment derived from a supported structured nested request. It may originate from a Declared Nested Call even when no nested lifecycle evidence was persisted. It remains request-only: presentation may show the tool name and bounded structured arguments, but must not state that the request executed.

嵌套工具投影是从受支持的结构化嵌套 request 派生、归属于 operation 展示的片段。即使没有持久化 nested lifecycle 证据，它也可以来自声明的嵌套调用。它始终保持 request-only：呈现可以显示工具名称和受限结构化 arguments，但不得声称该 request 已执行。

Every projection exposes one explicit result-association label: / 每个投影都暴露一个明确的结果关联标签：

- `exact`: a persisted identity edge proves which observed result belongs to the request. / `exact`：持久化 identity 边证明哪个已观测结果属于该 request。
- `bounded`: no exact identity edge exists, but one result fragment can be conservatively related within a strictly ordered static shape. This is permitted only when calls and candidate results are sequential and one-to-one, with no branch, loop, concurrency (`Promise.all` or equivalent), dynamic tool selection, repeated call site, or ambiguous extra output. The UI must label the association as bounded rather than exact. / `bounded`：不存在精确 identity 边，但在严格有序静态形态中，可以保守地把一个结果 fragment 与 request 关联。只有当调用与候选结果按顺序一一对应，且不存在分支、循环、并发（`Promise.all` 或同类形态）、动态工具选择、重复调用位置或歧义额外输出时才允许使用。UI 必须把该关联标为 bounded，而不是 exact。
- `none`: no result is assigned to the projection. This is the default whenever the source shape or output mapping is uncertain. / `none`：不向投影分配结果。只要来源形态或输出映射存在不确定性，就默认使用该值。

Unsupported syntax, unsafe values, parse uncertainty, or any failed eligibility check uses raw fallback: keep the outer JavaScript as the readable source and preserve lossless verification through operation Raw refs. The analyzer must not execute JavaScript to improve a projection or association.

不受支持的语法、不安全的值、解析不确定性，或任何资格检查失败，都会使用 raw fallback：保留 outer JavaScript 作为可读来源，并通过 operation Raw refs 保留无损验证能力。Analyzer 不得为了改进投影或关联而执行 JavaScript。

Projection extraction runs during cold Session indexing for the bounded name-only fact and during detail construction for structured request presentation. Both paths share the exact outer-exec source lookup and the same eligibility entry point. It uses a versioned known-tool allowlist, a real JavaScript parser, and an all-or-nothing top-level sequential grammar with recursively bounded literal arguments. Result emission accepts both direct `text(result)` and the standard type-preserving `text(typeof result === "string" ? result : JSON.stringify(result))` wrapper, with every identifier required to name the same declared result. The ambient runtime identifiers `tools`, `text`, and `JSON` must remain unshadowed by every declared result binding; otherwise the source uses raw fallback. One unsupported statement, tool, binding, argument, or emission shape makes the entire source use raw fallback; partial projections are forbidden because they can imply a complete execution list.

投影提取会在冷启动的 Session 索引阶段为有界的仅名称事实运行，并在构建 detail 时为结构化 request 呈现运行。两条路径共享精确的 outer-exec 源码查找和同一个资格入口。它使用版本化的已知工具 allowlist、真正的 JavaScript parser，以及全有或全无的顶层顺序语法与递归受限的 literal arguments。结果 emission 同时接受直接的 `text(result)` 与标准的保类型包装 `text(typeof result === "string" ? result : JSON.stringify(result))`，且其中每个 identifier 都必须指向同一个已声明结果。环境运行时标识符 `tools`、`text` 与 `JSON` 必须不被任何已声明的结果绑定遮蔽；否则该来源使用 raw fallback。只要存在一个不受支持的语句、工具、绑定、参数或 emission 形态，整个来源就使用 raw fallback；禁止生成局部投影，因为局部列表可能暗示它是一份完整执行清单。

`src/shared/code-mode-tools.js` is the single source for stable Code Mode tool metadata shared by Node and the browser: whether a direct tool is safe to declare, its baseline display-title key, evidence-neutral ordinary folding kind, and collapsed-preview field priority. It composes the separate Agent Coordination registry rather than copying its tools. The parser still uses a derived closed-world Set as its fail-closed security boundary; translation catalogs still own localized text; dynamic `web__run` titles and specialized request/result sections remain in their dedicated renderers. Registry coverage is verified against the declared-tool list, folding behavior, localized labels, and the exhaustive preview matrix. / `src/shared/code-mode-tools.js` 是 Node 与浏览器共享的稳定 Code Mode 工具元数据唯一来源：直接工具是否可安全声明、基础展示标题 key、不携带执行证据的普通折叠 kind，以及折叠预览的字段优先级。它组合独立的 Agent Coordination 注册表，而不复制其中的工具。parser 仍使用由此派生的封闭集合，作为保守失败的安全边界；翻译目录仍负责本地化文本；动态的 `web__run` 标题和专用 request/result section 继续留在各自 renderer 中。测试会把注册表覆盖与声明工具列表、折叠行为、本地化标签以及完整预览矩阵进行校验。

Whenever `bounded` assigns a result fragment, the projection keeps that entire sanitized fragment in a collapsed associated-result section even if a specialized renderer also shows a plan, command output, collaboration response, or truncated summary. Structured interpretation of result JSON has independent character, depth, and node budgets; over-budget values remain uninterpreted text. Raw refs remain the lossless source when standard payload sanitization removes embedded data URLs.

只要 `bounded` 分配了某个结果 fragment，投影就会在折叠的关联结果 section 中保留该 fragment 的完整脱敏文本，即使专用 renderer 还会展示计划、命令输出、协作响应或截断摘要。结果 JSON 的结构化解释使用独立的字符数、深度与节点预算；超出预算的值保持为未解释文本。当标准 payload 脱敏移除内嵌 data URL 时，Raw refs 继续作为无损来源。

Nested Tool Projections own no Logical Event identity, metrics, search document or target, Raw refs, source rows, outcome, severity, or escalation tag. Their text is already covered by the operation's single search owner. Observed Nested Activity remains the canonical, independently inspectable Logical Event and is never replaced, merged, or demoted by a projection; exact or bounded projection display is not a second event.

嵌套工具投影不拥有逻辑事件 identity、指标、搜索文档或目标、Raw refs、来源行、结果、severity 或提权标签。其文本已经由 operation 的单一搜索 owner 覆盖。已观测嵌套活动仍是 canonical、可独立检查的逻辑事件，绝不会被投影替代、合并或降级；exact 或 bounded 投影展示也不是第二个事件。

## Adaptive single/multi-tool presentation / 单工具与多工具自适应呈现

In summary state, Code Mode previews use an inset readable treatment instead of exposing a multi-line raw-code fragment; only expansion shows the full JavaScript source. This is a presentation change only and does not change declaration or execution evidence. / 在摘要态，Code Mode 预览使用内嵌的可读样式，而不会暴露多行原始代码片段；只有展开后才显示完整 JavaScript 源码。这只改变呈现，不改变声明或执行证据。

For `raw_code_mode`, collapsed state keeps the single sanitized `Source` preview line. The whole outer source is sanitized before segmentation on every ECMAScript line terminator (LF, CRLF, lone CR, U+2028, and U+2029), so a wrapped data URL cannot leak a continuation payload into an excerpt. Summary state uses a frameless row aligned with ordinary event summaries and renders at most two source-ordered sanitized logical lines, with each logical line occupying one independently truncated visual row. Its short source label is muted beneath the preview text hierarchy. For direct call lines, the presentation layer removes only a leading `tools.` namespace after sanitization; the expanded command retains the exact source. A single logical line remains one visual row instead of being enlarged to fill the summary card. If nonempty source lines were not selected or a selected line exceeded the source-preview text budget, a separate non-numeric `…` continuation marker follows the visible lines. It means only that further source context was omitted; it is neither a parsed declaration/count nor execution evidence. Old descriptors that contain only `text` render as one summary line without the marker. / 对 `raw_code_mode`，折叠态保持单条已脱敏“源码”预览行。在按全部 ECMAScript 行终止符（LF、CRLF、单独 CR、U+2028 与 U+2029）切分前，会先对完整 outer source 脱敏，因此被换行的 data URL 不会把 continuation payload 泄漏到摘录中。摘要态使用与普通 event 摘要对齐的无内框行式布局，最多渲染两条按源码顺序排列的已脱敏逻辑行，每条逻辑行只占一条独立截断的视觉行。简短的源码标签在视觉层级上弱于预览正文。对于直接调用行，presentation 层只会在脱敏后移除开头的 `tools.` 命名空间；展开后的 command 仍保留精确源码。单条逻辑行仍保持为一条视觉行，而不会为了填满摘要卡片被放大。若存在未被选中的非空源码行，或已选行超过源码预览字符预算，则在可见行之后显示独立的非计数 `…` 延续标记。它只表示后续源码上下文被省略，既不是解析出的声明或数量，也不是执行证据。只含 `text` 的旧 descriptor 会降级为一条摘要行且不显示该标记。

When an active free-text search matches a folded Code Mode event outside its bounded request/source preview, the search-hit snippet temporarily replaces that preview. This preserves a live timeline binding for navigation even when a persisted manual fold prevents transient expansion. Clearing or changing the match restores the ordinary Code Mode preview. / 当生效的自由文本搜索命中折叠 Code Mode event 中超出有界 request/source 预览的内容时，搜索命中 snippet 会临时替代该预览。即使持久化手动折叠阻止临时展开，也能为导航保留 live timeline binding。清除搜索或改变命中后，会恢复普通 Code Mode 预览。

Adaptive presentation consumes the same supported whole-program result that cold indexing records as a name-only fact; it is not a separate permissive detail-only classifier. Every Code Mode header uses one visible Code Mode source chip and omits the machine `exec` tool-name chip. Exactly one declared request uses `single_tool`: its projection wrapper is removed, its existing structured request/result sections become the timeline body, and the compact event header receives the presentation-only native tool title. Its descriptor also owns one `request_summary` collapsed preview derived exclusively from the declared request. The extractor prefers structured plan steps, command text, web identifiers, patch paths, and user-input prompts; then uses tool-specific request keys for every allowlisted tool; then a bounded sanitized scalar; and finally a localized no-argument marker. The safe-tool allowlist and the exhaustive preview matrix are asserted equal so a newly supported type cannot silently ship without folded content. Request evidence and machine tool name remain in inspector chips, metadata, and projection evidence rather than the timeline header. Outer source, projection evidence, operation metadata, command context/result metadata, protocol channel, Raw-ref count, and wait trace are inspector detail. A final observed operation output without complete bounded association stays in the timeline under `Operation output`; it receives no header warning and is not assigned to the declared tool. Raw fallback uses the `Scripted operation` title and, while folded, a sanitized `Source` preview taken from its outer JavaScript; it is source text rather than a partial declaration or execution claim. / 自适应呈现会消费 cold indexing 已记录为仅名称事实的同一份受支持整段程序结果；它不是一条宽松、只在 detail 阶段运行的独立分类器。每个 Code Mode header 都显示一个明确的代码模式来源 chip，并省略机器 `exec` 工具名 chip。恰好一个声明 request 时使用 `single_tool`：移除投影 wrapper，让既有结构化 request/result sections 成为时间线正文，并在紧凑事件 header 中增加仅 presentation 的原生工具 title。其 descriptor 还持有一个完全从声明 request 派生的 `request_summary` 折叠预览。提取器依次优先使用结构化 plan 步骤、command 文本、web 标识、patch 路径与 user-input 问题，再使用覆盖所有 allowlist 工具的专用 request key，之后使用有界脱敏标量，最后使用本地化“无参数”标记。测试会断言安全工具 allowlist 与完整预览矩阵相等，因此新增受支持类型不能在没有折叠内容的情况下静默交付。Request evidence 与机器工具名保留在 inspector chip、metadata 与投影证据中，不再占用时间线 header。Outer source、投影证据、operation metadata、command context/result metadata、协议 channel、Raw-ref 数量与 wait trace 属于 inspector 详情。没有完整 bounded 关联的最终已观测操作输出仍以“操作输出”留在时间线中；它不显示 header 警示，也不会被分配给声明工具。Raw fallback 使用“脚本化操作”标题，并在折叠时显示取自 outer JavaScript 的已脱敏“源码”预览；它是源码文本，而不是局部声明或执行结论。

The stable detail-presentation vocabulary is owned by `src/shared/code-mode-presentation-contract.js`. Current producers emit variants `single_tool | multi_tool | raw_code_mode`, request evidence `declared_source`, and result associations `bounded | none`; `exact` remains an admitted, intentionally rendered reserved value for a future persisted identity edge. The undocumented aliases `observed_lifecycle`, `exact_identity`, and `bounded_order` are rejected. Timeline `presentationFacts.codeModeDeclaredRequests` and detail `presentation` may share the `declared_source` value constant but retain separate DTO shapes, sanitizers, and ownership. Canonical kind, the synthetic query facet, and enclosing-operation presentation context remain outside this contract. / 稳定的 detail 展示词汇由 `src/shared/code-mode-presentation-contract.js` 负责。当前 producer 生成 variant `single_tool | multi_tool | raw_code_mode`、请求证据 `declared_source` 以及结果关联 `bounded | none`；`exact` 继续作为未来持久化 identity 边的已准入且有意渲染的 reserved 值。未记录的 alias `observed_lifecycle`、`exact_identity` 与 `bounded_order` 会被拒绝。Timeline 的 `presentationFacts.codeModeDeclaredRequests` 与 detail 的 `presentation` 可以共享 `declared_source` 值常量，但继续保留不同的 DTO 形态、sanitizer 与 ownership。Canonical kind、合成查询 facet 和 enclosing-operation presentation context 仍位于该契约之外。

`resultAssociation: none` means only that no result fragment was assigned to a declared request; it does not prove that any output exists. The presentation descriptor therefore carries the separate boolean `hasUnassociatedOutput`, derived from an actually observed final operation output that lacks complete association. It controls whether the separate `Operation output` section is present; request-only and incomplete-tail operations render no empty output region. Inspector projection evidence retains the machine value and explains that no result output matched the supported shape, rather than asserting that it is unrelated to the declared tool. / `resultAssociation: none` 只表示没有 result fragment 被分配给声明 request，并不证明存在任何 output。因此 presentation descriptor 使用独立布尔值 `hasUnassociatedOutput`，它只能由实际观测到、且缺少完整关联的最终操作输出派生。它决定是否显示独立的“操作输出”区域；request-only 与 incomplete-tail operation 不渲染空输出区域。Inspector 的投影证据保留该机器值，并解释未检测到满足受支持形态的结果输出，而不是断言它与声明工具无关。

Projected shell run context preserves numeric timeout values. `timeout_ms` takes nullish precedence over the compatibility alias `timeoutMs`, and the chosen scalar is formatted only after selection rather than passed through string-oriented non-empty selection. / 投影的 shell 运行上下文会保留数值 timeout。`timeout_ms` 通过 nullish 规则优先于兼容别名 `timeoutMs`；应先选定 scalar，再格式化，而不是让它经过面向字符串的非空选择逻辑。

Two or more declared requests use `multi_tool`: the current projection wrappers and folded outer source remain in the timeline, the header label becomes `Multiple operations`, and one compact tool-count chip is shown beside the shared Code Mode source chip. While folded or summarized, a bounded `Declared sequence` line shows at most the first two source-ordered projection labels and their concise request-only details, followed by `+N` when more declarations remain. Detail selection is limited to request-provenance fields: response-derived values that a specialized expanded card co-locates in its request section, such as image dimensions or MIME type, remain excluded. It does not show results or claim execution. Unsupported programs use `raw_code_mode` and retain the existing command/final-output/trace presentation without any single, multiple, or complex claim. / 两个及以上声明 request 使用 `multi_tool`：当前投影 wrapper 与折叠 outer source 继续留在时间线，header label 变为“多个操作”，并在共享的代码模式来源 chip 旁显示一个紧凑工具数量 chip。在折叠或摘要态，一个有上限的“声明顺序”行会按源码顺序最多展示前两个投影的展示名及其精简的 request-only 详情；若仍有更多声明，则显示 `+N`。详情选择被限制为具有 request 来源的字段：即使专用展开卡会在 request section 中并置图片尺寸或 MIME 类型等响应派生值，预览也会排除它们。它不展示结果，也不声称已经执行。不受支持的程序使用 `raw_code_mode`，保留现有 command/final-output/trace 呈现，不提出 single、multiple 或 complex 声明。

The descriptor and the name-only request fact are presentation-only. All three variants keep canonical `kind: code_mode_operation`, `toolName: exec`, operation identity, metric/search/Raw-ref ownership, neutral outcome, and independently visible Observed Nested Activity. The bounded AST projector is no longer detail-only: cold indexing classifies only safely declared tool names into the independent presentation index, while visible Code Mode cards may still lazily fetch detail for structured arguments, source, and result-association evidence. / 该 descriptor 与仅名称 request 事实都只属于 presentation。三个 variant 都保持 canonical `kind: code_mode_operation`、`toolName: exec`、operation identity、指标/搜索/Raw-ref 所有权、中性 outcome，以及独立可见的已观测嵌套活动。有界 AST projector 不再只在 detail 阶段运行：cold indexing 只把安全声明的工具名称分类到独立的 presentation index，而可见 Code Mode 卡片仍可惰性获取 detail，以展示结构化 arguments、source 与 result-association 证据。

The declared projector preserves argument presence separately from the materialized value, so an omitted argument and an explicit `null` never collapse to the same preview fact. The request-summary fallback distinguishes absence from explicit empty structure: only an omitted or structurally empty request uses `No arguments / 无参数`; explicit `null` renders `Request: null / 请求：空值`, and a nonempty request whose scalar extractors find only an empty list, empty object, or another bounded structural shape retains its first field and shape, for example `Plan: empty list / 计划：空列表`. The same metadata path applies to single-tool and declared-sequence previews. / Declared projector 会把参数存在性与 materialized value 分开保留，因此省略参数与显式 `null` 不会折叠成同一个预览事实。Request 摘要回退会区分“缺少参数”和“显式空结构”：只有省略参数或结构上为空的 request 才使用 `No arguments / 无参数`；显式 `null` 显示 `Request: null / 请求：空值`；若非空 request 的 scalar extractor 只发现空列表、空对象或其他有界结构形态，则保留首个字段及其形态，例如 `Plan: empty list / 计划：空列表`。单工具与声明顺序预览共用这条 metadata 路径。

Raw-source preview selection scans the whole sanitized source by index but retains only a fixed set of candidate offsets: the first nonempty fallback, first tool line, and bounded secondary candidates. A monotonic `tools.` match cursor advances past each occurrence at most once instead of searching the remaining suffix from every line. The selector creates strings and preview metadata only for the final two selected lines, while a saturated nonempty-line count supplies the omission flag. Runtime remains linear in source length and match count, and additional retained memory remains constant rather than scaling with newline count. / Raw-source 预览选择会按索引扫描完整已脱敏源码，但只保留固定数量的候选 offset：首个非空 fallback、首个工具行及有界 secondary 候选。单调前进的 `tools.` 匹配游标最多只会越过每个 occurrence 一次，而不会从每一行重复搜索剩余 suffix。只有最终选中的两行会创建字符串与 preview metadata，饱和的非空行计数用于生成省略标记。运行时间与源码长度及匹配数量保持线性关系，额外保留内存则保持常量，不再随换行数量增长。

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

## Enclosing-operation presentation / Enclosing-operation 呈现

The optional reverse context does not automatically decorate every nested event. Its localized, low-emphasis enclosing-operation affordance appears only when the nested event is relevant in the committed current-session view: an active free-text hit, a returned structured-filter result, a selected event, or an expanded event. If the unique parent card is mounted, not profile-hidden, and structurally present in the committed timeline, the control invokes the existing event-selection/scroll path directly. Any navigation expansion is transient and cannot persist a fold override.

可选反向上下文不会自动装饰每个 nested event。其已本地化、低强调的 enclosing-operation 入口只在 nested event 与已提交的当前 session 视图相关时出现：它是生效的自由文本命中、已返回的结构化筛选结果、被选中的事件或被展开的事件。如果唯一父卡片已挂载、未被 profile 隐藏且在结构上存在于已提交时间线中，该控件会直接调用既有事件选择/滚动路径。导航所需的任何展开都是临时的，不能持久化折叠覆盖。

If the parent is profile-hidden, outside the loaded prefix, or structurally filtered out, the browser uses a separately owned context reveal keyed by the committed repository, scope, session, layer, query, filters, Folding Strategy, locale, detail context, nested ID, and parent ID. It resolves the parent through the layer-aware event envelope/detail path rather than adding a timeline page. A current-owner success may insert one distinct context-only summary row immediately before the nested event; the row can expose a parent preview plus inspect/open action but is explicitly not a normal event card or search owner. It does not enter `currentEvents`, change offsets, totals, filters, matching counts, occurrence counts, targets, highlights, Raw-ref ownership, or pagination, and uses distinct data/class/ARIA markers with no ordinary event-ID or search-owner attributes. Missing/ambiguous parents and stale or failed requests leave canonical state unchanged.

如果父操作被 profile 隐藏、位于已加载前缀之外或被结构化筛选排除，浏览器会使用独立 ownership 的 context reveal；其 key 包含已提交的仓库、范围、会话、事件层、query、筛选、折叠策略、locale、详情上下文、nested ID 和 parent ID。它通过感知事件层的 event envelope/detail 路径解析父操作，而不是增加时间线分页。当前 owner 成功时，可以在 nested event 前立即插入一条不同的 context-only 摘要行；该行可以暴露父操作预览及 inspect/open 操作，但被明确规定为不是普通事件卡片或搜索 owner。它不会进入 `currentEvents`，不会改变 offset、总数、筛选、匹配计数、occurrence 计数、目标、高亮、Raw-ref ownership 或分页，并且使用不同的 data/class/ARIA 标记，不带普通 event-ID 或 search-owner 属性。父操作缺失/歧义、以及过期或失败请求都不会改变规范状态。

This presentation owner has its own generation and `AbortController`. A new reveal cancels only its matching owner. Committed repository, scope, session, layer, query/filter, Folding Strategy, locale, selected detail/view, and detail-cache-generation transitions invalidate its generation, abort pending work, and remove all context rows. Every success, error, and `finally` path verifies both current owner identity and captured committed context; typed intentional aborts are silent. Context-row insertion/removal updates only an owner-scoped presentation slot and never triggers canonical target discovery or ordinary timeline/search rendering.

该呈现 owner 拥有自己的 generation 和 `AbortController`。新的 reveal 只会取消匹配的 owner。已提交的仓库、范围、会话、事件层、query/filter、折叠策略、locale、选中详情/视图和 detail-cache-generation 转换会使其 generation 失效、取消 pending 工作并移除所有 context 行。每条 success、error 和 `finally` 路径都会同时验证当前 owner identity 与捕获的已提交 context；类型化的有意 abort 保持静默。context 行的插入/移除只更新 owner 范围的呈现 slot，绝不触发规范目标发现或普通 timeline/search 渲染。

## Escalation rules / 提权规则

Escalation is evidence, not an outcome classifier. V1 creates an `Escalation requested` tag only when an Observed Nested Activity owns a structured request whose `sandbox_permissions` is exactly `require_escalated`. The tag belongs only to that nested event. The same text inside outer JavaScript remains visible and searchable but creates no tag or approval event. A persisted permission/approval lifecycle record, if present, remains its own observed evidence and event.

提权是证据，不是结果分类器。V1 只有在某个已观测嵌套活动拥有结构化 request，且其中 `sandbox_permissions` 精确等于 `require_escalated` 时，才创建 `Escalation requested` 标签。该标签只属于这个嵌套事件。outer JavaScript 中的同名文本继续保持可见、可搜索，但不会创建标签或 approval 事件。如果存在持久化的 permission/approval 生命周期记录，它继续作为独立的已观测证据和事件。

The implementation must not execute JavaScript to recover escalation, must not treat an unstructured keyword occurrence as structured evidence, and must not infer failure or decline from approval-related text in ordinary output. Absence of an approval event means “not observed,” not “no approval happened.”

实现不得为恢复提权信息而执行 JavaScript，不得把非结构化关键字出现当作结构化证据，也不得根据普通输出中的审批相关文本推断失败或拒绝。缺少 approval event 表示“未观测到”，不表示“没有发生审批”。

## Representation decision / 呈现决策

### A: composite Logical Event / A：复合逻辑事件

A emits one Main Timeline event for the operation using the independent `kind: code_mode_operation` and `toolName: exec`. It owns only outer exec and wait refs, exposes associated nested IDs through detail `eventRefs`, and leaves nested Logical Events independently visible. A nested logical DTO may additionally expose the separately derived, optional enclosing-operation presentation context, but that reverse display relation creates no canonical child. The operation remains status-neutral.

A 在主时间线中为操作发出一个事件，使用独立 `kind: code_mode_operation` 和 `toolName: exec`。它只拥有外层 exec/wait refs，通过详情 `eventRefs` 暴露相关嵌套 ID，并让嵌套逻辑事件继续独立可见。Nested 逻辑 DTO 还可以额外暴露独立派生、可选的 enclosing-operation 呈现上下文，但这种反向展示关系不会创建规范 child。Operation 保持状态中性。

Adding zero or more Nested Tool Projections does not create a second operation or change the operation ID, Logical Event ID, kind, subtype, raw ownership, metric ownership, or search owner. Projections are sections inside the accepted A presentation, not children in the canonical event graph.

增加零个或多个嵌套工具投影不会创建第二个 operation，也不会改变 operation ID、逻辑事件 ID、kind、subtype、raw 所有权、指标所有权或搜索 owner。投影只是已接受 A 呈现内部的 section，不是 canonical 事件图中的子节点。

Accepted. The expanded timeline body gives the outer JavaScript command and final observed output the primary visual region. When waits exist, their phase metadata and intermediate outputs live in one collapsed-by-default `code_mode_trace` section after the final output. Operation evidence, observation state, cell ID, and poll count live in the inspector; `eventRefs` remain inspector evidence/navigation while the nested DTO's unique presentation context can offer the separate enclosing-operation path described above.

Display extraction is deliberately separate from observation classification. Classification reads the complete outer output so the canonical first line still determines pending or terminal state. Presentation may remove a leading status-only array fragment when a later fragment contains the actual tool result, and strips ANSI terminal control sequences; Raw refs preserve the original fragments and escapes.

已接受。展开后的 timeline 正文把 outer JavaScript 命令与最终已观测输出作为主要视觉区域。存在 wait 时，各阶段元数据和中间输出位于最终输出之后的单个 `code_mode_trace` section 中，并默认折叠。Operation 的证据状态、观测状态、cell ID 和轮询次数位于 inspector；`eventRefs` 继续属于 inspector 证据/导航，而 nested DTO 的唯一呈现上下文可以提供上文所述独立的 enclosing-operation 路径。

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
- Public-context coverage proves exact DTO shape and omission for unique, missing, malformed, self, ambiguous, and cross-span `eventRefs`; catalog coverage proves disjoint `code_mode_operation` and `other_tool_call` canonical counts plus the presentation-only Scripted facet; folding coverage proves broad Code Mode kind rules are ignored while request and fallback inheritance remain exact. / 公开上下文覆盖证明唯一、缺失、格式错误、自引用、歧义和跨区间 `eventRefs` 的精确 DTO 形态与省略行为；目录覆盖证明 `code_mode_operation` 与 `other_tool_call` 的规范计数互不重叠，并验证仅用于呈现的“脚本化操作”facet；折叠覆盖证明宽泛 Code Mode kind 规则会被忽略，而 request 与 fallback 继承保持精确。
- Browser coverage proves relevance-gated affordance rendering, visible-parent direct navigation, hidden/unloaded/filtered-parent owner-scoped context reveal, one context-only row before the nested event, and cancellation across committed transition boundaries without changing canonical timeline/search/count/pagination/folding behavior. / 浏览器覆盖证明按相关性门控的入口渲染、可见父操作直达、隐藏/未加载/被筛选父操作的 owner 范围 context reveal、nested event 前的一条 context-only 行，以及跨已提交转换边界的取消，同时不改变规范时间线/搜索/计数/分页/折叠行为。
- Collapsed-preview coverage verifies source order, bounded request-only detail, truncation, and `+N` for safe multi-tool declarations, plus a sanitized outer-source excerpt for raw fallback. Dynamic or uncertain programs must never receive a partial declared-tool sequence. / 折叠态预览覆盖会验证安全多工具声明的源码顺序、有上限的 request-only 详情、截断与 `+N`，并验证 raw fallback 的已脱敏 outer 源码摘录。动态或不确定程序绝不能获得局部声明工具顺序。
- Presentation-index coverage proves exact outer-exec source identity, one-exec-phase and raw-record fail-closed behavior, own-input priority, safe single/multi/duplicate tool names, whole-program fallback for dynamic/control-flow/concurrent/unknown/syntax/budget cases, and unchanged logical/raw serialization. Filter and catalog coverage proves operation-based deduplication, same-event composition, Main-only clearing, and DTO name-only evidence. / 呈现索引覆盖证明精确 outer-exec 源码 identity、单一 exec phase 与 raw-record 的保守失败行为、own-input 优先级、安全 single/multi/duplicate 工具名称、动态/控制流/并发/未知工具/语法/预算场景的整段程序回退，以及不变的 logical/raw 序列化。筛选与目录覆盖证明按 operation 去重、同一事件组合、仅 Main 的清除行为和 DTO 的仅名称证据。

## Decision log / 决策日志

- 2026-07-14: Accepted the shared operation semantics and opened an A/B decision between a composite Logical Event and a non-event group. No new kind, product-spec change, or logical-timeline contract is accepted yet. / 2026-07-14：接受共享操作语义，并在复合逻辑事件与非事件 group 之间开启 A/B 决策。当前尚未接受新 kind、产品规格变更或逻辑时间线 contract 变更。
- 2026-07-15: Selected A after symmetric unit/browser/package validation and directional cold-start comparison. The accepted UI prioritizes command and final output, folds wait trace by default, and keeps operation metadata plus nested-event navigation in the inspector. Both prototype worktrees are retained; only A was integrated. / 2026-07-15：在对称单元/浏览器/package 验证和方向性冷启动对比后选择 A。已接受 UI 优先展示命令和最终输出，默认折叠 wait 过程，并把 operation 元数据与 nested-event 导航保留在 inspector。两个原型 worktree 都继续保留；只有 A 被集成。
- 2026-07-15: Accepted request-only Nested Tool Projections as an additive presentation inside A without changing operation identity or the canonical event model. Result association must be explicit (`exact | bounded | none`); bounded is limited to strict sequential static shapes, and every uncertain case uses raw fallback. / 2026-07-15：接受 request-only 嵌套工具投影作为 A 内部的增量呈现，不改变 operation identity 或 canonical 事件模型。结果关联必须明确标注（`exact | bounded | none`）；bounded 仅限严格有序静态形态，所有不确定场景都使用 raw fallback。
- 2026-07-16: Accepted adaptive presentation: one safe declared tool reuses its structured body with visible Code Mode/evidence header labels and inspector-only operation details; multiple declarations retain composite cards under a multi-tool label; raw fallback remains unclassified. Canonical event semantics do not change. / 2026-07-16：接受自适应呈现：一个安全声明工具复用其结构化正文，header 明确显示代码模式/证据标签，operation 详情只进 inspector；多个声明继续在多工具 label 下使用复合卡片；raw fallback 保持未分类。Canonical event 语义不变。
- 2026-07-22: Locked the public, optional enclosing-operation presentation context and the `code_mode_operation` discoverability facet. Both derive from existing canonical operation facts only; the subtype-only folding condition and separately owned context row improve access without changing canonical identity, evidence, counts, search, pagination, or built-in Folding Strategy defaults. / 2026-07-22：锁定公开、可选的 enclosing-operation 呈现上下文以及 `code_mode_operation` 可发现性 facet。二者都只能从既有规范 operation 事实派生；仅 subtype 的折叠 condition 和独立 ownership 的 context 行提升访问能力，却不改变规范 identity、证据、计数、搜索、分页或内置折叠策略默认值。
- 2026-07-25: Accepted an independent, cold-built Code Mode request presentation index and the `codeModeRequest` Main-layer filter/catalog. The bounded name-only pass passed the performance gate, leaves canonical Logical Events unchanged, and feeds `presentationFacts` plus additive `codeModeRequestStates` folding rules without turning source declarations into execution evidence. / 2026-07-25：接受独立、冷启动构建的 Code Mode request 呈现索引以及 `codeModeRequest` Main 层筛选/目录。有界的仅名称遍历通过性能门禁，不改变 canonical Logical Event，并为 `presentationFacts` 和增量 `codeModeRequestStates` 折叠规则提供数据，同时不会把源码声明变成执行证据。
- 2026-07-26: Nested the browser's Code Mode request refinement under the `Code Mode tool call` Kind branch. The UI now projects `kind=code_mode_operation + codeModeRequest=<tool>` as one filter while preserving the independent backend dimension and declared-source evidence contract. / 2026-07-26：把浏览器中的 Code Mode request 细分嵌套到 `Code Mode 工具调用` 类型分支下。UI 现在把 `kind=code_mode_operation + codeModeRequest=<tool>` 投影为一个筛选，同时保留独立的后端维度与声明来源证据契约。
- 2026-07-27: Replaced the folding editor's all-Code-Mode rule with a narrower `Scripted operation` fallback plus ordinary-tool-inheriting declared-request rows, all using the editor's lightweight group-and-row presentation. Obsolete all-Code-Mode custom rules are rejected because the model is unreleased. / 2026-07-27：把折叠编辑器中作用于全部 Code Mode 的规则替换为更窄的“脚本化操作”兜底项和继承普通工具的声明 request 行，并统一使用轻量分组与规则行。由于模型尚未发布，过时的“全部 Code Mode”自定义规则会被拒绝。
- 2026-07-27: Promoted Code Mode operations from the overlapping `other_tool_call` subtype to the disjoint canonical `code_mode_operation` kind. The broad kind remains hidden from search and folding controls; actionable request children preserve ordinary-tool inheritance, while Scripted operations inherit `other_tool_call` unless explicitly configured. / 2026-07-27：把 Code Mode operation 从与 `other_tool_call` 重叠的 subtype 提升为互不重叠的规范 `code_mode_operation` kind。宽泛 kind 继续从搜索和折叠控件中隐藏；可操作的 request 子项保留普通工具继承，“脚本化操作”未显式配置时继承 `other_tool_call`。
