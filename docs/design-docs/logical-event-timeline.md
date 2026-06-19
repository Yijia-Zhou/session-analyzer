# Logical Event Timeline / 逻辑事件时间线

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-06-18 / 最近更新：2026-06-18
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related plans: / 相关计划：
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`
- Related design notes: / 相关设计说明：
  - `docs/design-docs/codex-protocol-event-coverage.md`

## Context / 背景

Codex transcript JSONL files contain multiple channels for the same semantic action. A user message can appear as both `response_item.message role=user` and `event_msg.user_message`. Assistant responses, reasoning, tool calls, and proposed plans may also be mirrored or split across multiple rows. Transcript formats also evolve over time, so old sessions and new sessions cannot be normalized with a single simplistic rule.

Codex 转录 JSONL 文件会为同一个语义动作包含多个通道。用户消息既可能以 `response_item.message role=user` 出现，也可能以 `event_msg.user_message` 出现。助手回复、推理、工具调用和计划产物也可能被镜像或拆分到多行中。转录格式还会随时间演进，因此旧会话和新会话无法用一个简单规则归一化。

The first version of this repository rendered raw records directly, which caused duplicate messages and exposed protocol injections in the main reading flow.

本仓库的第一个版本直接渲染原始记录，这导致消息重复，并在主阅读流程中暴露协议注入。

## Design goals / 设计目标

- Derive a stable, readable logical timeline from noisy raw transcript rows. / 从嘈杂的原始转录行中派生稳定、可读的逻辑时间线。
- Preserve traceability back to original JSONL lines. / 保留回溯到原始 JSONL 行的可追踪性。
- Support both newer and older Codex transcript formats. / 同时支持较新和较旧的 Codex 转录格式。
- Keep the main timeline readable without hiding important debugging information forever. / 保持主时间线可读，同时不永久隐藏重要调试信息。

## Non-goals / 非目标

- Lossless semantic reconstruction of every historical transcript quirk / 对每个历史转录怪异情况进行无损语义重建
- Cloud-scale indexing or storage optimization / 云规模索引或存储优化
- Rewriting transcript files into a canonical on-disk format / 将转录文件重写为规范的磁盘格式

## Proposed design / 提议设计

### High-level architecture / 高层架构

1. Parse JSONL into `rawEvents`. / 将 JSONL 解析为 `rawEvents`。
2. Build `logicalEvents` on top of `rawEvents`. / 在 `rawEvents` 之上构建 `logicalEvents`。
3. Serve one of three layers: / 提供三层之一：
   - `main` / 主时间线层
   - `protocol` / 协议层
   - `raw` / 原始记录层

### Main components / 主要组件

- Codex source/raw parser in `src/codex-source.js`, assembled by `src/codex.js` / `src/codex-source.js` 中的 Codex source/raw 解析器，并由 `src/codex.js` 组装
- Codex logical-event builder in `src/codex-logical.js`, assembled by `src/codex.js` / `src/codex-logical.js` 中的 Codex 逻辑事件构建器，并由 `src/codex.js` 组装
- HTTP API in `server.js` / `server.js` 中的 HTTP API
- Layer-aware UI rendering in `public/app.js` / `public/app.js` 中的层感知 UI 渲染

### Data flow / 数据流

1. Load session metadata and raw JSONL rows. / 加载会话元数据和原始 JSONL 行。
2. Before full parsing, pre-scan transcript `cwd` metadata to select candidate files for the target repository. Files whose `cwd` matches the target repository enter the candidate set, files known to belong only to other repositories are skipped, and files with no `cwd` metadata are counted as unknown without full parsing or display. / 在完整解析前，先预扫描转录中的 `cwd` metadata，为目标仓库选择候选文件。`cwd` 匹配目标仓库的文件会进入候选集合，已知只属于其他仓库的文件会被跳过，而没有 `cwd` metadata 的文件会计入 unknown，不会再做完整解析，也不会显示。
3. Annotate each raw row with extracted text, call IDs, command text, outputs, and touched files when available. / 在可用时，为每个原始行标注提取文本、调用 ID、命令文本、输出和触及文件。
4. Group by `call_id` first for tool operations. / 对工具操作先按 `call_id` 分组。
5. Walk the remaining rows in order and fold them into logical messages, reasoning entries, protocol events, lifecycle events, or proposed plans. / 按顺序遍历剩余行，并折叠为逻辑消息、推理条目、协议事件、生命周期事件或 proposed plan。
6. Expose logical events to the main and protocol layers; expose raw rows separately. / 向主层和协议层暴露逻辑事件；单独暴露原始行。

Reasoning text extraction is intentionally narrower than generic raw-field text flattening. A `response_item.reasoning` row uses `summary_text` entries first, then falls back to `reasoning_text` content entries when the summary is empty. An `event_msg.agent_reasoning` row accepts only string `message` or `text` fields. Retained reasoning text, including detail text assembled from mirrored rows, is capped at 16,000 characters; unknown content types or shapes and `encrypted_content` are not promoted into Main timeline text or the readable-reasoning folding condition.

Reasoning 文本提取有意比通用原始字段文本扁平化更严格。`response_item.reasoning` 行会优先使用 `summary_text` 条目，当 summary 为空时再回退到 `reasoning_text` content 条目。`event_msg.agent_reasoning` 行只接受字符串类型的 `message` 或 `text` 字段。保留的 reasoning 文本（包括从镜像行组合出的详情文本）会限制在 16,000 个字符以内；未知 content 类型或形态和 `encrypted_content` 不会被提升为 Main timeline 文本，也不会命中可读 reasoning 折叠条件。

Web search records are normalized as adjacent mirrored rows rather than normal `call_id` tool groups. Real transcripts may write `event_msg.web_search_end` before the completed `response_item.web_search_call` snapshot, often with matching action metadata and identical or near-identical timestamps. The logical builder merges adjacent search/open-page rows by canonical action target so the main timeline shows one web search event with both raw refs. When action metadata is absent or incomplete, timestamp fallback pairing is limited to rows from the same `turn_id`; call-only and end-only historical rows remain visible as single logical events.

Web 搜索记录会按相邻镜像行归一化，而不是按普通 `call_id` 工具分组处理。真实转录可能先写入 `event_msg.web_search_end`，再写入已完成的 `response_item.web_search_call` 快照，二者通常带有匹配的 action 元数据，并且时间戳相同或非常接近。逻辑构建器会按规范化后的 action 目标合并相邻的搜索/打开页面记录，使主时间线只显示一个带有两个原始引用的 Web 搜索事件。当 action 元数据缺失或不完整时，基于 timestamp 的兜底配对只会作用于同一个 `turn_id` 内的行；只有 call 或只有 end 的历史行仍保留为单独逻辑事件。

User-initiated `<user_shell_command>` wrappers from `response_item.message` role `user` or `event_msg.user_message` are promoted to Main timeline events with `kind` and `subtype` both set to `user_shell_command`. They have a dedicated user shell command label/title for display, preserve raw refs, and expose the command/result wrapper in preview and detail, but they are not normal `user_message` events.

来自 `response_item.message` role `user` 或 `event_msg.user_message` 的用户发起 `<user_shell_command>` 包装会被提升为 Main timeline 事件，`kind` 和 `subtype` 都设为 `user_shell_command`。它们有专用的用户 shell command 展示 label/title，保留 raw refs，并在 preview 和 detail 中暴露 command/result 包装内容，但它们不是普通的 `user_message` 事件。

Session identity is fixed from the transcript file UUID or the first `session_meta` row. Later embedded `session_meta` rows, such as parent metadata copied into a forked subagent transcript, remain inspectable protocol/raw records but do not replace the owning session id or selection key.

会话身份固定来自转录文件 UUID 或第一条 `session_meta` 行。后续嵌入的 `session_meta` 行，例如 fork 出来的子 agent 转录中复制进来的父会话元数据，仍然作为可检查的协议/原始记录保留，但不会替换所属会话 id 或选择 key。

Session title inference prefers explicit `session_index.jsonl` or thread-name metadata. When no explicit title exists, fallback inference scans only main-layer `user_message` events, so `user_shell_command` events do not affect fallback titles; it then cleans lightweight Markdown title syntax and uses the first valid task line. Forked subagent sessions and plain user-created `/fork` sessions use the last valid user task line so copied parent context does not dominate the child or fork title.

会话标题推断优先使用显式的 `session_index.jsonl` 或 thread-name 元数据。当不存在显式标题时，回退推断只扫描主层 `user_message` 事件，因此 `user_shell_command` 事件不会影响回退标题；随后清理轻量 Markdown 标题语法，并使用第一条有效任务行。fork 出来的子 agent 会话和普通用户发起的 `/fork` 会话会使用最后一条有效用户任务行，避免复制进来的父上下文主导子会话或 fork 会话标题。

Session summaries expose derived-session display metadata for subagent and review children. Only explicit subagent metadata such as `source.subagent.thread_spawn.parent_thread_id` or `thread_source: "subagent"` marks a session as derived; a plain `forked_from_id` alone records normal `/fork` ancestry but does not make the session visually secondary. Review-like metadata is classified as `review`; other derived children remain `subagent`. Review transcripts may omit an explicit parent id, so the index infers one only when exactly one normal same-repo session records matching `entered_review_mode` / `exited_review_mode` lifecycle events around the review child. When the parent or fork source session is indexed, summaries include its title so the frontend can label the relationship; derived child hover/focus lightly highlights its visible parent, while normal fork sessions remain primary rows with a fork-source tag. The frontend uses this metadata only for visual hierarchy and relationship labels, not for selection identity, filtering, or timeline construction.

会话摘要会为 subagent 和 review 子会话暴露派生会话展示元数据。只有 `source.subagent.thread_spawn.parent_thread_id` 或 `thread_source: "subagent"` 等显式 subagent 元数据会把会话标记为派生会话；单独的 `forked_from_id` 只记录普通 `/fork` 祖先关系，不会让会话在视觉上变成次级。metadata 呈现 review 语义的子会话分类为 `review`；其他派生子会话保持为 `subagent`。review 转录可能缺少显式父会话 id，因此索引只会在恰好一个同仓库普通会话记录了与 review 子会话匹配的 `entered_review_mode` / `exited_review_mode` 生命周期事件时推断父会话。当父会话或 fork 来源会话已被索引时，摘要会包含其标题，使前端能标记关系；派生子会话被悬停或聚焦时会轻量高亮当前可见的父会话，而普通 fork 会话仍保持主会话行并显示 fork 来源标签。前端只用这些元数据呈现视觉层级和关系标签，不会用它改变选择身份、筛选或时间线构建。

`entered_review_mode` and `exited_review_mode` raw records also produce Main timeline lifecycle events with kind `review`, so the parent session's readable timeline retains the point where review was requested and the point where review output returned.

`entered_review_mode` 和 `exited_review_mode` 原始记录也会生成 Main timeline 中 kind 为 `review` 的生命周期事件，使父会话的可读时间线保留发起 review 和收到 review 输出的位置。

## Data model / schema / 数据模型 / 模式

Canonical DTOs use a small source envelope so raw, logical, and detail payloads can be interpreted without assuming Codex JSONL implementation details. `schemaVersion` is the Session Analyzer canonical DTO version, starts at `1`, and is independent from any upstream protocol version. `sourceKind` is a stable machine identifier for the source system; v0.1 emits only `codex`, while future adapters may add other values without localizing this field. `sourceSchemaVersion` is optional and should be populated only when the source provides a trustworthy schema or protocol version.

规范 DTO 使用一个小型 source envelope，使 raw、logical 和 detail payload 可以被解释，而不需要假设 Codex JSONL 实现细节。`schemaVersion` 是 Session Analyzer 自己的规范 DTO 版本，初始为 `1`，与任何上游协议版本相互独立。`sourceKind` 是来源系统的稳定机器标识；v0.1 只输出 `codex`，未来 adapter 可以增加其他值，但该字段不得本地化。`sourceSchemaVersion` 是可选字段，只应在来源提供可信 schema 或协议版本时填充。

Source locations use typed locators instead of assuming every source can be addressed by file and line. Current Codex rows use `sourceLocator: { type: "jsonl_line", file, line }`; the `file` value is a project-generated JSONL locator path normalized to forward slashes for cross-platform DTO stability. Future sources may use different locator types such as database rows or stream offsets. During compatibility migration, existing Codex `source`, `rawRefs[].file`, `rawRefs[].line`, and `rawRefs[].rawId` fields remain available and preserve their original parser path strings, but new code should use `sourceLocator` when it needs source identity and must not assume every locator has file and line properties.

来源位置使用 typed locator，而不是假设每种来源都能用文件和行号寻址。当前 Codex 行使用 `sourceLocator: { type: "jsonl_line", file, line }`；其中 `file` 是项目生成的 JSONL locator path，并归一化为前斜杠，以保持跨平台 DTO 稳定。未来来源可以使用其他 locator 类型，例如数据库行或流 offset。在兼容迁移期间，现有 Codex `source`、`rawRefs[].file`、`rawRefs[].line` 和 `rawRefs[].rawId` 字段继续可用，并保留原始 parser path 字符串；但新代码在需要来源身份时应使用 `sourceLocator`，并且不得假设每个 locator 都有 file 和 line 属性。

`sourceRecordType` and `sourceEventType` use refs-only semantics. Raw DTOs may expose the precise source row types at the top level. Logical and detail DTOs do not expose potentially misleading aggregate `sourceRecordType` or `sourceEventType` fields; each `rawRefs[]` entry carries the precise row-level types instead, and `rawRefs[]` remains the authoritative traceability surface for multi-row logical events.

`sourceRecordType` 和 `sourceEventType` 采用 refs-only 语义。Raw DTO 可以在顶层暴露精确的来源行类型。Logical 和 detail DTO 不在顶层暴露可能误导的聚合 `sourceRecordType` 或 `sourceEventType` 字段；每个 `rawRefs[]` 条目会携带精确的逐行类型，`rawRefs[]` 仍是多行 logical event 的权威可追踪表面。

Implementation boundary: detail DTO assembly plus timeline/inspector section selection and splitting orchestration now live in `src/codex-detail.js` behind `createCodexDetailBuilder(deps)`. `src/codex.js` remains the public assembly/API layer and injects lower-level formatting, parsing, sanitization, and raw/logical source helpers. This is an implementation-only split: the canonical DTO shape and raw traceability semantics above are unchanged.

实现边界：detail DTO 组装，以及 timeline/inspector section 的选择和拆分编排现在位于 `src/codex-detail.js`，并通过 `createCodexDetailBuilder(deps)` 接入。`src/codex.js` 仍是公开组装/API 层，并注入较低层的格式化、解析、清理以及 raw/logical source helper。这只是实现层拆分：上文的 canonical DTO 形状和 raw 可追踪语义保持不变。

### Raw event / 原始事件

Important fields:

重要字段：

- `schemaVersion`
- `sourceKind`
- `sourceSchemaVersion`
- `rawId`
- `recordType`
- `payloadType`
- `sourceRecordType`
- `sourceEventType`
- `role`
- `timestamp`
- `turnId`
- `callId`
- `messageText`
- `searchText`
- `commandText`
- `stdout`
- `stderr`
- `touchedFiles`
- `source`
- `sourceLocator`

### Logical event / 逻辑事件

Important fields:

重要字段：

- `id`
- `schemaVersion`
- `sourceKind`
- `sourceSchemaVersion`
- `kind`
- `subtype`
- `layer`
- `role`
- `timestamp`
- `turnId`
- `preview`
- `searchText`
- `severity`
- `status`
- `toolName`
- `touchedFiles`
- `sourceLocator`
- `rawRefs[]`
- `channels[]`

Protocol logical events derive `label` and `preview` from subtype display metadata instead of raw subtype identifiers, while `searchText` and `rawRefs[]` keep the original transcript text discoverable and traceable.

协议逻辑事件会从子类型展示元数据派生 `label` 和 `preview`，而不是直接使用原始子类型标识符；同时 `searchText` 和 `rawRefs[]` 会保留原始转录文本的可搜索性和可追踪性。

Protocol event coverage is intentionally open-ended. The parser should preserve unknown `event_msg` variants through protocol/raw layers, and only add dedicated normalization when an upstream event changes readable timeline placement, severity, metadata, tool grouping, search, metrics, or structured detail. Current event-family notes and update rules live in `docs/design-docs/codex-protocol-event-coverage.md`.

协议事件覆盖有意保持开放。解析器应通过 protocol/raw 层保留未知 `event_msg` variant；只有当上游事件会改变可读时间线归属、严重级别、元数据、工具分组、搜索、指标或结构化详情时，才添加专门归一化。当前事件族记录和更新规则见 `docs/design-docs/codex-protocol-event-coverage.md`。

Current protocol normalization includes task lifecycle events and their aliases (`task_started` / `task_complete` and `turn_started` / `turn_complete`) in the protocol layer, `session_configured` metadata, `thread_goal_updated` protocol details, injected `goal_context` protocol details, main-layer goal tool lifecycle events, main-layer warning/error events, protocol-shaped plan updates, and incomplete tool-family records grouped by `call_id` when available. These records remain traceable through raw refs and unknown future variants still fall back to protocol/raw visibility.

当前协议归一化包括位于 protocol 层的 task 生命周期事件及其别名（`task_started` / `task_complete` 与 `turn_started` / `turn_complete`）、`session_configured` metadata、`thread_goal_updated` 协议详情、注入的 `goal_context` 协议详情、main 层 goal 工具生命周期事件、main 层 warning/error 事件、协议形态计划更新，以及在可用时按 `call_id` 分组的不完整工具族记录。这些记录仍可通过 raw refs 追踪，未知未来 variant 仍回退到 protocol/raw 可见性。

### Search and highlighting / 搜索与高亮

Backend free-text search is event-oriented but not timeline-filtering. After `file:`, `kind:`, `status:`, and `layer:` operators are removed, the remaining `q` is one case-insensitive contiguous phrase. Literal phrase segments are regex-escaped and query whitespace runs become `\s+`, so spaces, tabs, and newlines match without allowing unrelated words between segments. For each event, `preview` and `searchText` are matched independently: hit state accepts either field, snippet generation prefers `preview`, and the event contributes the larger non-overlapping match count from the two fields. This avoids double-counting derived preview text and prevents artificial matches across the field boundary. The `/timeline` response applies only layer and structured filters to decide which events are returned; its `q` parameter marks `hasSearchHit`, populates snippets, and returns `searchMatchCount` across that full structured result set. This keeps the main timeline readable as a continuous sequence while still letting the frontend jump between hits. Session filtering can still use the same phrase matcher against aggregated session `searchText` when explicitly requested by API callers, but the browser's primary search box treats free text as find-in-timeline and omits `q` from session-list requests.

后端自由文本搜索仍以事件为单位，但不再过滤时间线。移除 `file:`、`kind:`、`status:` 和 `layer:` 操作符后，剩余 `q` 会被视为一个忽略大小写的连续短语。短语中的字面片段会进行正则转义，查询中的空白段会变为 `\s+`，因此空格、Tab 和换行可以互相匹配，但片段之间不能插入无关单词。对每个事件，`preview` 和 `searchText` 会独立匹配：任一字段命中即可标记 hit，snippet 优先使用 `preview`，事件贡献的非重叠命中数取两个字段中的较大值。这样既不会重复计算派生 preview 文本，也不会在字段拼接边界产生人工命中。`/timeline` 响应只用事件层和结构化筛选决定返回哪些事件；它的 `q` 参数只负责标记 `hasSearchHit`、生成 snippet，并在完整结构化结果集上返回 `searchMatchCount`。这样 Main timeline 仍保持连续可读，同时前端仍可在命中之间跳转。Session 筛选在 API 调用方明确请求时仍会对聚合后的 session `searchText` 使用同一短语匹配器，但浏览器主搜索框会把自由文本视为时间线内查找，并在请求 session 列表时省略 `q`。

Frontend highlighting is DOM-oriented. After HTML has been rendered, the browser walks text nodes under the session list, timeline, and detail panel, skips interactive or unsafe nodes such as inputs, buttons, links, scripts, styles, and existing marks, and inserts `<mark>` elements with `textContent` around complete phrase matches instead of rewriting HTML strings. Matching remains confined to each individual DOM text node; it does not concatenate text across HTML nodes. The displayed position uses the currently rendered and jumpable marks. Its denominator is `max(searchMatchCount, renderedMarkCount)`: backend full-text coverage is retained for unloaded content, while additional rendered targets such as inspector detail marks cannot produce an impossible position like `4 / 3`. Previous/next navigation scrolls the concrete live mark after any synchronous inspector redraw; when that target is inside closed supplemental `<details>` sections, navigation opens every ancestor first. Ordinary highlight refresh remains passive and does not expand sections.

前端高亮则以 DOM 为单位。HTML 渲染完成后，浏览器遍历 session 列表、时间线和详情面板下的文本节点，跳过 input、button、link、script、style 和已有 mark 等交互或不适合处理的节点，并用 `textContent` 为完整短语命中插入 `<mark>`，而不是重写 HTML 字符串。匹配仍限制在单个 DOM text node 内，不会跨 HTML 节点拼接文本。界面显示的当前位置来自当前已渲染且可跳转的 mark，分母为 `max(searchMatchCount, renderedMarkCount)`：后端全文计数仍覆盖尚未加载的内容，而检查器详情 mark 等额外渲染目标不会产生 `4 / 3` 这种不可能的位置。上一个/下一个导航会在 Inspector 的同步重绘完成后滚动实际存在的具体 mark；当目标位于关闭的补充 `<details>` 区段中时，导航会先展开其所有祖先。普通高亮刷新保持被动，不会展开区段。

`Read from here` bridges structured-filter and layer views back to normal reading. When a selected event is shown while structured filters, a `layer:` operator, or a non-main layer is active, the inspector and raw refs views expose a contextual action that clears the event filters, switches to `Main timeline`, and restores focus using the same timestamp/line anchor logic as layer switches. If the exact selected event is not visible in Main timeline, the frontend selects the nearest visible event in timeline order. On narrow screens the action returns the user to the Events tab after the anchor is restored.

`Read from here` 用来把结构化筛选或事件层视图带回常规阅读。当选中事件处在结构化筛选、`layer:` 操作符或非主时间线事件层下时，检查器和原始引用视图会显示上下文动作；该动作会清除事件筛选、切换到 `Main timeline`，并复用事件层切换所用的 timestamp/line 锚点逻辑恢复焦点。如果精确的选中事件在 Main timeline 中不可见，前端会按时间线顺序选择最近的可见事件。在窄屏上，锚点恢复后该动作会把用户带回 Events 标签页。

The state and timeline payloads include `eventKinds` grouped by `main`, `protocol`, and `raw` layers. Main options are logical `kind` values, protocol options are logical `subtype` values, and raw options are `payloadType || recordType` values. The browser uses the selected session's timeline payload to populate the `kind:` filter picker and counts; the project-level state payload remains a fallback before a session is selected. Typed `kind:` values remain open-ended and are matched by the backend against event `kind` or `subtype`.

状态载荷和时间线载荷包含按 `main`、`protocol` 和 `raw` 分组的 `eventKinds`。Main 选项使用逻辑事件 `kind`，protocol 选项使用逻辑事件 `subtype`，raw 选项使用 `payloadType || recordType`。浏览器使用选中 session 的时间线载荷填充 `kind:` 筛选选择器及计数；项目级状态载荷仅作为尚未选中 session 前的回退。手输的 `kind:` 值保持开放，并由后端按事件 `kind` 或 `subtype` 匹配。

Search-result preloading is intentionally bounded. When free-text search has too few rendered jump targets, the browser may append a few more timeline pages so previous/next navigation has nearby real scroll targets. It does not force-expand every event or load every hidden command output; hidden detail becomes jumpable only after its event detail is rendered.

搜索结果预加载有意保持有限。当自由文本搜索下可渲染跳转目标过少时，浏览器可以追加加载少量时间线分页，让上一个/下一个导航有附近的真实滚动目标。它不会强制展开每个事件，也不会加载每个隐藏的 command output；隐藏详情只有在该事件详情实际渲染后才会变成可跳转目标。

### Event detail DTO / 事件详情 DTO

Expanded cards do not reuse `preview` for rich rendering. The server derives an `EventDetailDto` from the underlying logical event plus its referenced raw rows:

展开卡片不会复用 `preview` 进行富渲染。服务器会根据底层逻辑事件及其引用的原始行派生 `EventDetailDto`：

- `id`
- `schemaVersion`
- `sourceKind`
- `sourceSchemaVersion`
- `kind`
- `subtype`
- `layer`
- `title`
- `meta`
- `sourceLocator`
- `rawRefs[]`
- `timelineSections[]`
- `inspectorSections[]`

`meta` always includes `timestamp`, `turnId`, `status`, `severity`, `toolName`, `touchedFiles`, `outputStats`, `channels`, and `source`.

`meta` 始终包含 `timestamp`、`turnId`、`status`、`severity`、`toolName`、`touchedFiles`、`outputStats`、`channels` 和 `source`。

The old single `sections[]` field is intentionally not emitted. Timeline cards render only `timelineSections[]`; the right-side inspector renders only `inspectorSections[]` and uses `meta` for its metadata table. When an expanded event has no timeline-owned sections, the card keeps its readable preview instead of rendering an empty body.

旧的单一 `sections[]` 字段有意不再输出。时间线卡片只渲染 `timelineSections[]`；右侧 inspector 只渲染 `inspectorSections[]`，并使用 `meta` 渲染元数据表。当展开事件没有 timeline 所属区段时，卡片会保留可读摘要，而不是渲染空白正文。

`update_plan` tool calls receive dedicated detail extraction: the main timeline gets a structured `plan_update` section with the optional Markdown explanation and each step's explicit status, while the inspector keeps the generic tool context and original Request JSON for verification. The frontend renders statuses as semantic badges so completed, in-progress, pending, blocked, and unknown states remain visually distinct.

`update_plan` 工具调用使用专用详情提取：Main timeline 会获得结构化的 `plan_update` section，其中包含可选的 Markdown 说明和每一步的明确状态，而 inspector 会保留通用工具上下文和原始 Request JSON 以供核验。前端会把状态渲染成语义 badge，使 completed、in-progress、pending、blocked 和未知状态保持清晰的视觉区分。

Other `other_tool_call` events also receive timeline-owned summaries instead of relying on preview fallback. User-input requests use structured `user_input` sections with question cards, option rows, selected-option highlights, and answer chips. Goal lifecycle tools (`create_goal`, `get_goal`, and `update_goal`) are normalized as Main timeline `goal` events with status/objective/usage summaries while the injected goal context remains a protocol-only `goal_context` record. Image inspection keeps a focused Markdown timeline summary and adds an inspector-only `image_preview` section for supported embedded raster image payloads. Supported previews are deduplicated and capped at eight unique images per event; each descriptor carries a controlled same-origin endpoint URL rather than an inline data URL. Other-tool-call inspector sections preserve payload shape but recursively replace data URLs, including embedded string occurrences, line-wrapped base64 payloads, and object keys, with markers so cached detail DTOs do not duplicate large payloads; Raw refs remain the lossless drill-down. Specialized timeline cards append sanitized, bounded unmodeled text responses instead of hiding them. Collaboration actions use structured `collaboration` sections with action metadata, target and status chips, timeout state, and complete sanitized Markdown message/result bodies. `update_plan` uses the same sanitizer and text-response retention path as other specialized cards. When mirrored collaboration status fields coexist, the normalizer prefers `agent_statuses`, then `statuses`, then close-operation and generic status fields to avoid duplicate chips while retaining the most descriptive agent label. Unknown tool families use bounded request/response code summaries. Timeline summaries recursively omit data URLs and cap nested values. As a final defense, every logical-detail section, logical-event preview, session-list display field, and non-locator logical DTO envelope field is recursively sanitized before DTO emission. Stable event IDs, source locators, and Raw refs intentionally retain their original values. Indexed raw DTOs may contain an explicit externalization marker for supported raster images; source-backed Raw refs remain the authoritative lossless drill-down. Protocol-backed collaboration labels prefer their `event_msg` subtype so grouped calls do not degrade to a generic `Function Call` label.

其他 `other_tool_call` 事件也会获得 timeline 所属摘要，而不是依赖 preview 回退。面向用户的提问使用结构化 `user_input` section，其中包含问题卡片、选项行、已选选项高亮和答案 chip。Goal 生命周期工具（`create_goal`、`get_goal` 和 `update_goal`）会归一为 Main timeline 的 `goal` 事件，展示状态、objective 和用量摘要；注入的 goal context 则保留为仅在 protocol 层出现的 `goal_context` 记录。图片检查会保留聚焦的 Markdown timeline 摘要，并为受支持的内嵌 raster 图片 payload 增加 inspector 专用 `image_preview` section。受支持的预览会去重，每个事件最多保留八张不同图片；每个 descriptor 都携带受控的同源端点 URL，而不是内联 data URL。其它工具调用的 inspector section 会保留 payload 结构，但递归地把 data URL 替换为标记，包括嵌入普通字符串中的片段、换行包装的 base64 payload 和对象键，从而避免缓存的详情 DTO 重复保存大型 payload；Raw refs 仍是无损下钻入口。专用 timeline 卡片会追加经过清洗和限长的未建模文本响应，而不是将其隐藏。协作动作使用结构化 `collaboration` section，其中包含动作元数据、目标和状态 chip、超时状态，以及经过清洗的完整 Markdown 消息和结果正文。`update_plan` 会使用与其他专用卡片相同的清洗和文本响应保留路径。当镜像协作状态字段同时存在时，归一化逻辑会依次优先使用 `agent_statuses`、`statuses`、关闭操作状态和通用状态字段，从而避免重复 chip，并保留描述性最强的 agent label。未知工具族使用受限的 request/response 代码摘要。Timeline 摘要会递归省略 data URL 并限制嵌套值长度。作为最后一道防护，每个 logical-detail section、logical-event preview、session 列表展示字段和 logical DTO envelope 中的非定位字段都会在 DTO 输出前递归清洗。稳定 event ID、source locator 和 Raw refs 会有意保留原始值。Indexed raw DTO 对受支持的 raster 图片可以包含明确的外置标记；基于源文件的 Raw refs 仍是权威无损下钻入口。由协议事件支持的协作动作 label 会优先使用对应的 `event_msg` subtype，避免分组调用退化成通用的 `Function Call` label。

Supported raster image payloads are externalized during JSONL parsing before `makeRawEvent` derives retained `parsed`, `output`, and `searchText` copies. Each retained raw event keeps compact sidecar descriptors with a preview ID, source file, source line, JSON path, MIME type, estimated size, and presentation-only dedupe key. `/api/sessions/:sessionId/events/:eventId/image-previews/:previewId` resolves only an indexed server-owned descriptor, reloads the source JSONL row, traverses the stored JSON path, revalidates the source signature, MIME whitelist, base64 syntax, and encoded and decoded size guards, then returns `no-store`, `nosniff` raster bytes. The frontend accepts only this controlled route, uses `loading='lazy'` and `decoding='async'`, displays an explicit load-failure fallback, and invalidates detail-cache generations when switching sessions.

受支持的 raster 图片 payload 会在 JSONL 解析期间、`makeRawEvent` 派生要保留的 `parsed`、`output` 和 `searchText` 副本之前外置。每条保留的 raw event 只携带紧凑 sidecar descriptor，其中包含 preview ID、源文件、源行、JSON path、MIME 类型、预估大小和仅用于展示去重的 key。`/api/sessions/:sessionId/events/:eventId/image-previews/:previewId` 只会解析已索引且由服务端持有的 descriptor，重新读取源 JSONL 行，沿存储的 JSON path 取值，重新验证来源签名、MIME 白名单、base64 语法以及编码和解码大小限制，随后返回带 `no-store` 和 `nosniff` 的 raster 字节。前端只接受这一受控路由，使用 `loading='lazy'` 和 `decoding='async'`，在加载失败时显示明确 fallback，并在切换 session 时让 detail-cache generation 失效。

The first implementation deliberately reuses line-based `readRawLine` source reads instead of adding byte-offset indexing. On the 2026-05-31 development corpus, representative front, middle, and later preview rows rehydrated in approximately `15-20 ms`, so byte offsets remain deferred until measurement shows a real need.

首期实现有意复用按行工作的 `readRawLine` 来源读取，而不增加 byte-offset 索引。在 2026-05-31 的开发语料中，代表性的前部、中部和后部预览行 rehydrate 耗时约为 `15-20 ms`，因此 byte offset 继续推迟，直到测量证明存在实际需要。

Both section arrays use the same discriminated union:

两个 section 数组使用同一套可辨识联合：

- `markdown`
- `code`
- `terminal`
- `json`
- `diff`
- `patch`
- `kv`
- `notice`
- `raw_json`
- `user_input`
- `plan_update`
- `collaboration`
- `image_preview`

`code` sections carry language metadata for highlighting, but timeline bodies do not show a user-facing language badge by default. Command sections infer shell language from the command wrapper or command shape, including PowerShell, cmd/batch, bash, sh, zsh, and fish. When `environment_context` records a PowerShell shell, bare common external command heads from the shared command-highlighting allowlist are treated as PowerShell commands; explicit shell wrappers still take precedence. In timeline bodies, a command `code` section followed by stdout/stderr `terminal` sections is rendered as one command run region rather than as nested standalone blocks. `terminal` sections may include a `language`; stdout/stderr default to `text` unless their content is detected as JSON or diff-like output.

`code` section 会携带用于高亮的 language metadata，但 timeline 正文默认不展示面向用户的 language badge。Command section 会从命令包装器或命令形态推断 shell 语言，包括 PowerShell、cmd/batch、bash、sh、zsh 和 fish。当 `environment_context` 记录的是 PowerShell shell 时，共享 command-highlighting allowlist 中的常见裸外部命令头会被视为 PowerShell 命令；显式 shell wrapper 仍然优先。在 timeline 正文中，command `code` section 后接 stdout/stderr `terminal` section 时会被渲染为同一个命令执行区域，而不是嵌套的独立块。`terminal` section 可以包含 `language`；stdout/stderr 默认是 `text`，除非内容被检测为 JSON 或类似 diff 的输出。

`patch` sections carry file summaries, change type, addition/deletion counts, hunks, and old/new line numbers so the frontend can render Codex CLI-like patch bodies with gutters and red/green changed lines without an extra outer visual block. Applied patch result diffs from `patch_apply_end.payload.changes[*].unified_diff` are preferred over `apply_patch` input because result diffs are more likely to include reliable file line numbers. When a patch hunk has no real unified-diff range, line numbers are marked unreliable and the frontend hides them instead of presenting inferred numbers as file positions. If patch input is not parseable, the detail builder falls back to a `diff` timeline section.

`patch` section 携带文件摘要、变更类型、加减行统计、hunk 以及 old/new 行号，让前端可以渲染接近 Codex CLI 的 patch 正文，包括 gutter 和红/绿变更行，同时不再添加额外的外层视觉块。详情构建器优先使用 `patch_apply_end.payload.changes[*].unified_diff` 中的已应用 patch 结果 diff，而不是 `apply_patch` 输入，因为结果 diff 更可能包含可靠的文件行号。当 patch hunk 没有真实 unified-diff range 时，行号会被标记为不可靠，前端会隐藏它们，而不是把推断数字展示成文件位置。如果 patch 输入无法解析，详情构建器会回退为 timeline 中的 `diff` section。

Timeline code and patch content use a vendored `highlight.js` browser bundle for common languages such as PowerShell, shell, JavaScript/TypeScript, JSON, Python, CSS, XML/HTML, and diff. Command highlighting applies small post-processing over the `highlight.js` HTML: shared external command words and bash-style options are highlighted only in unprotected text, existing `.hljs-*` string/comment spans are left unchanged, and bash false positives inside Windows path arguments are removed. Patch highlighting is applied only to line content after the patch gutter is rendered. If a language or highlighter is unavailable, rendering falls back to escaped plain text.

Timeline 中的 code 和 patch 内容使用 vendored `highlight.js` 浏览器 bundle，为 PowerShell、shell、JavaScript/TypeScript、JSON、Python、CSS、XML/HTML 和 diff 等常见语言提供高亮。Command 高亮会在 `highlight.js` HTML 上做小型后处理：共享外部命令词和 bash 风格参数只在未受保护文本中着色，已有的 `.hljs-*` string/comment span 保持不变，并移除 bash 在 Windows 路径参数中的误判。Patch 高亮只应用在 patch gutter 之后的行内容上。如果语言或高亮器不可用，渲染会回退为已转义的纯文本。

Expanded-card rendering treats `markdown-it` as a required server dependency. Markdown source is converted server-side with raw HTML disabled and dangerous link protocols rejected. In the main and protocol layers, `raw_json` sections stay in the inspector as collapsible fallback material so the right-side raw refs panel remains the primary full-source view.

展开卡片渲染将 `markdown-it` 视为必需的服务器依赖。Markdown 源内容在服务器端转换，禁用原始 HTML，并拒绝危险链接协议。在主层和协议层中，`raw_json` 区段作为可折叠回退材料保留在 inspector 中，从而让右侧原始引用面板保持主要的完整来源视图。

Raw rows that map to known semantic events reuse the same primary structured section extraction as their logical event family, then add raw-record metadata and expanded raw JSON. Conversation rows reuse Markdown body sections, protocol rows reuse protocol text/field sections, lifecycle rows reuse notice sections, and tool rows reuse command or patch sections. This keeps raw inspection faithful without falling back to duplicated scalar fields or generic payload blocks when a more specific renderer exists.

映射到已知语义事件的原始行会复用与其逻辑事件家族相同的主结构化区段提取，然后附加原始记录元数据和展开的原始 JSON。对话行复用 Markdown 正文区段，协议行复用协议文本/字段区段，生命周期行复用通知区段，工具行复用命令或补丁区段。这样原始检查既保持忠实，也不会在已有更具体渲染器时退回到重复标量字段或通用 payload 块。

Terminal sections may apply display-only repair for text that looks like UTF-8 bytes decoded as GB18030/GBK before it was written to the transcript, such as Windows PowerShell `Get-Content` output from UTF-8 files without an explicit encoding. The repair is conservative and does not mutate raw rows; Raw refs continue to expose the original JSONL payload. When bytes were already lost and only replacement placeholders remain, terminal display uses `□` to mark unrecoverable characters.

终端区段可以对看起来像“UTF-8 字节在写入转录前被当作 GB18030/GBK 解码”的文本做仅用于显示的修复，例如 Windows PowerShell `Get-Content` 在未显式指定编码时读取 UTF-8 文件产生的输出。该修复保持保守且不改变原始行；Raw refs 仍继续暴露原始 JSONL payload。当字节已经丢失、只剩替换占位时，终端显示使用 `□` 标记不可恢复字符。

Sections may set `hideTitle: true` when the section title only restates the event header, such as the primary `Message`, `Plan`, `Reasoning`, or protocol text body. Renderer implementations should keep titles visible for structural sections such as stdout/stderr, metadata tables, request/response payloads, and raw JSON summaries. Patch sections omit the redundant outer `Patch` title and rely on per-file headers for structure.

当区段标题只是重复事件标题时，例如主要的 `Message`、`Plan`、`Reasoning` 或协议文本正文，区段可以设置 `hideTitle: true`。渲染器实现应为 stdout/stderr、元数据表、请求/响应载荷和原始 JSON 摘要等结构性区段保留可见标题。Patch section 会省略重复的外层 `Patch` 标题，并依赖每个文件自己的 header 保持结构。

## Detail panel and folding profiles / 详情面板与折叠策略

The right-side detail panel is a small view stack with three frontend-only views: editable folding rules, selected-event inspector, and raw refs. The folding rules view is the default when no event is selected. Inspecting an event or opening raw refs pushes a view; Back restores the previous view, while Close clears the selected event and returns to folding rules.

右侧详情面板是一个小型前端视图栈，包含三个仅前端视图：可编辑折叠规则、选中事件检查器和原始引用。未选中事件时默认显示折叠规则视图。检查事件或打开原始引用会压入视图；Back 恢复上一个视图，Close 清除选中事件并返回折叠规则。

The selected-event inspector is optimized for fast triage rather than repeating the expanded timeline body. It renders Summary only for events whose preview adds context beyond the timeline body, then Metadata, Source, and Details. Metadata contains compact scalar facts such as time, status, tool, exit code, duration, channels, and touched files. Source owns the JSONL location and Raw refs action. Detail section titles should describe user intent, such as `Files`, `Result`, `Run context`, `Arguments`, `Request`, and `Response`, rather than repeating generic `metadata` names.

选中事件 inspector 面向快速判断事件状况，而不是重复展开后的 timeline 正文。只有当 preview 能补充 timeline 正文之外的上下文时才渲染 Summary，之后依次渲染 Metadata、Source 和 Details。Metadata 只放紧凑标量事实，例如时间、状态、工具、退出码、耗时、通道和涉及文件。Source 负责 JSONL 位置和 Raw refs 动作。详情区段标题应描述用户意图，例如 `Files`、`Result`、`Run context`、`Arguments`、`Request` 和 `Response`，而不是重复通用的 `metadata` 名称。

Display text is localized through the shared `src/shared/i18n.js` catalog at DTO response and browser-rendering boundaries. Locale affects labels, raw-record display labels, section titles, folding profile names/descriptions, condition names/descriptions, renderer fallback copy, and UI chrome. Logical-event label localization uses a strict known-label lookup first: exact logical fixed-display labels are translated directly, kind/protocol/section keys are translated by key, and English default-catalog values are reverse-mapped back to their machine key before translating. If no strict match exists, the original logical label text is preserved; only events without a label fall back to protocol kind/subtype display keys. Locale must not affect canonical machine fields, filtering/storage identifiers, raw refs, source locators, raw JSONL content, or search semantics.

展示文本通过共享的 `src/shared/i18n.js` catalog 在 DTO 响应边界和浏览器渲染边界本地化。Locale 会影响 label、raw-record 展示 label、section title、folding profile 名称/说明、condition 名称/说明、renderer fallback 文案和 UI chrome。逻辑事件 label 会先走严格的已知文案查找：先直接翻译固定 logical display label，再按 key 翻译 kind/protocol/section，并支持把英文默认 catalog value 反查回机器 key 后再翻译；如果严格查找未命中，则保留原始 logical label 文本，只有完全没有 label 的事件才回退到 protocol kind/subtype 展示 key。Locale 不得影响 canonical machine field、filter/storage 标识、raw refs、source locator、raw JSONL 内容或搜索语义。

Project-selection POST stores the browser-selected locale on the active indexing job. State-returning project responses use an explicit query locale when present, otherwise the stored job locale, so job-status and active-job state payloads do not fall back to request language accidentally. Raw-record DTO labels are localized display fields; `recordType`, `payloadType`, `sourceRecordType`, and `sourceEventType` remain stable machine fields. The zh-CN catalog may keep allowlisted technical terms when clearer, and catalog tests guard against untranslated English values outside that allowlist. / Project-selection POST 会把浏览器选择的 locale 存到当前 indexing job 上。会返回 state 的 project 响应在存在显式 query locale 时优先使用它，否则使用 job 上保存的 locale，因此 job-status 和 active-job state payload 不会意外回退到请求语言。Raw-record DTO label 是本地化展示字段；`recordType`、`payloadType`、`sourceRecordType` 和 `sourceEventType` 仍是稳定机器字段。zh-CN catalog 可以在更清晰时保留 allowlist 中的技术术语，并由 catalog 测试防止 allowlist 之外的英文值漏翻。

Folding profiles are data-driven presets with `kindStates`, a `fallback` display state, and fixed condition rules. Built-in presets remain read-only. Edits create a draft that immediately previews in the Main timeline; Save writes a custom profile to browser `localStorage`, and Cancel restores the saved profile. Editable kind rules cover Main timeline kinds only, so protocol-only `protocol` events and raw fallback `event` kinds are not exposed as folding controls. Protocol and raw layer overrides stay outside profile editing so layer semantics remain separate from folding strategy semantics. When protocol or raw is active, the frontend disables profile controls, renders a read-only fixed-rules explanation in the detail panel, and disables profile metric shortcuts.

折叠策略是数据驱动预设，包含 `kindStates`、`fallback` 显示状态和固定条件规则。内置预设保持只读。编辑会创建草稿并立即在 Main timeline 中预览；Save 会把自定义策略写入浏览器 `localStorage`，Cancel 会恢复已保存策略。可编辑 kind 规则只覆盖 Main timeline kind，因此只存在于 protocol layer 的 `protocol` 事件和 raw fallback `event` kind 不会暴露为折叠控件。协议层和原始层覆盖规则不进入策略编辑，以保持事件层语义与折叠策略语义分离。当 protocol 或 raw 生效时，前端会禁用 profile 控件，在详情面板展示只读的固定规则说明，并禁用 profile 指标快捷入口。

The profile description affordance is a single movable frontend slot rather than duplicated controls. It attaches only when the active profile is a saved built-in profile with no unsaved preview: to the right-side profile picker when the folding-rules view is visible, otherwise to the topbar profile picker. Custom profiles and dirty previews hide the affordance so the picker and edit actions keep enough room. When present, its popover lists all strategy names and descriptions. The detail-pane popover is width-constrained to the pane so long descriptions wrap instead of being clipped by the scroll container.

折叠策略说明入口是一个可移动的前端 slot，而不是复制出的多个控件。只有当当前 profile 是没有未保存预览的已保存内置策略时，它才会挂载：折叠规则视图可见时挂载到右侧 profile 选择器，否则挂载到顶部栏 profile 选择器。自定义策略和 dirty preview 会隐藏该入口，让选择器和编辑动作保留足够空间。入口可见时，弹层会列出所有策略名称和说明。右侧详情面板中的弹层会按面板宽度约束，使较长说明自动换行，而不是被滚动容器裁切。

The conversation profile treats some non-message events as conversation continuity: proposed plans, protocol plan updates, `update_plan` calls, `request_user_input` calls, and readable reasoning entries are expanded so reading user and assistant messages does not skip over the decision or planning context that shaped the next message. Empty reasoning remains outside this promotion. Other ordinary tool calls remain hidden by that profile unless another condition promotes them.

对话阅读策略会把部分非消息事件视为对话连续性上下文：proposed plan、协议 plan update、`update_plan` 调用、`request_user_input` 调用和可读 reasoning 条目会展开，避免阅读用户与助手消息时跳过影响下一条消息的决策或计划上下文。空 reasoning 不会被该条件提升。其他普通工具调用在该策略下仍保持隐藏，除非被其他 condition 提升可见性。

Natural Main-timeline folding uses a deterministic visibility merge: `max(kind rule, every matching condition rule)` under `expanded > summary > collapsed > hidden`, with fallback used only when no rule matches. A valid manual event override remains above that natural result. Conditions intentionally support only `expanded` and `summary`, so they promote visibility rather than forcing degradation, hiding, or exclusion. `src/shared/folding.js` is the shared UMD-compatible implementation for browser and Node consumers; `src/folding.js` owns built-in profile data and re-exports the shared contract, while the browser receives the shared code through the generated `public/assets/app.js` bundle. Browser-local folding state is normalized when read and saved; if a stored profile id no longer exists, the frontend falls back to `narrative` and persists the repaired selection.

Main timeline 的自然折叠状态使用确定性的可见性合并：在 `expanded > summary > collapsed > hidden` 顺序下求 `max(kind rule, 所有命中 condition rule)`，只有没有任何规则命中时才使用 fallback。合法的事件手动覆盖仍高于该自然结果。Condition 有意只支持 `expanded` 和 `summary`，因此它们用于提升可见性，而不是强制降级、隐藏或排除。`src/shared/folding.js` 是浏览器与 Node 消费者共用的 UMD 兼容实现；`src/folding.js` 负责内置 profile 数据并重新导出共享契约，浏览器则通过生成的 `public/assets/app.js` bundle 接收共享代码。浏览器本地折叠状态在读取和保存时都会规范化；如果已存储的 profile id 不再存在，前端会回退到 `narrative` 并持久化修复后的选择。

Before a folding-profile or layer switch, the frontend captures the selected event as a focus anchor. After the new timeline state is loaded, it restores the same event when it remains visible, otherwise selects the nearest visible event in the new timeline order; if no event was selected before the switch, it selects the first event that is naturally `expanded`, and leaves the folding-rules view open when no expanded event exists.

在切换折叠策略或事件层之前，前端会把当前选中事件捕获为焦点锚点。新的时间线状态加载后，如果该事件仍可见就恢复同一事件，否则按新时间线顺序选择最近的可见事件；如果切换前没有选中事件，则选择第一个自然 `expanded` 的事件，若不存在展开事件则保持折叠规则视图打开。

## API / contract changes / API / 契约变更

- `POST /api/project` starts an asynchronous indexing job and returns `202 { job }`; `GET /api/project/status?jobId=...` returns progress and includes the app state when the job succeeds; `DELETE /api/project/status?jobId=...` cancels an active job. / `POST /api/project` 启动异步索引任务并返回 `202 { job }`；`GET /api/project/status?jobId=...` 返回进度，并在任务成功时包含应用状态；`DELETE /api/project/status?jobId=...` 取消活动任务。
- `/api/sessions/:id/timeline` accepts `layer=main|protocol|raw` / `/api/sessions/:id/timeline` 接受 `layer=main|protocol|raw`
- `/api/sessions/:id/events/:eventId/detail?layer=main|protocol|raw` returns the structured detail DTO for one event / `/api/sessions/:id/events/:eventId/detail?layer=main|protocol|raw` 返回单个事件的结构化详情 DTO
- Read APIs accept optional `locale=en|zh-CN|zh`; unsupported values fall back to English. Localized fields are display-only and do not change filtering identifiers or raw/source traceability. / 只读 API 接受可选的 `locale=en|zh-CN|zh`；不支持的值回退到英文。被本地化的字段仅用于展示，不改变筛选标识或 raw/source 可追踪性。
- State-returning project APIs should honor the browser-selected locale consistently, including project-selection POST and job-status responses that embed app state. / 会返回 state 的 project API 应一致遵循浏览器选择的 locale，包括 project-selection POST 和内嵌 app state 的 job-status 响应。
- Main and protocol layers return logical events / 主层和协议层返回逻辑事件
- Raw layer returns raw-record DTOs / 原始层返回原始记录 DTO
- Event detail uses `rawRefs` so one logical event can expose multiple source rows / 事件详情使用 `rawRefs`，因此一个逻辑事件可以暴露多个来源行
- Folding profile customization is browser-local and does not add a server API / 折叠策略自定义仅保存在浏览器本地，不新增服务器 API

## Alternatives considered / 已考虑的备选方案

### Render raw transcript rows directly / 直接渲染原始转录行

- Pros: simplest parser, minimal inference / 优点：解析器最简单，推断最少
- Cons: duplicates everywhere, protocol noise dominates, poor default reading experience / 缺点：到处重复，协议噪声占主导，默认阅读体验差
- Rejected because it breaks the product goal of readable repository history / 已拒绝，因为它破坏了让仓库历史可读的产品目标

### Hide duplicated channels without adding event layers / 不新增事件层，只隐藏重复通道

- Pros: smaller implementation change / 优点：实现改动更小
- Cons: protocol rows and proposed plans still lack a stable place to live / 缺点：协议行和 proposed plan 仍然缺少稳定归属
- Rejected because it treats symptoms but not transcript structure / 已拒绝，因为它处理的是症状，而不是转录结构

### Persist a canonical normalized store / 持久化规范化的归一化存储

- Pros: faster reloads, easier offline analysis later / 优点：重新加载更快，之后更容易离线分析
- Cons: storage versioning and migration complexity / 缺点：存储版本和迁移复杂度
- Deferred because current product still prefers in-memory local processing / 已推迟，因为当前产品仍偏好内存中的本地处理

## Risks and failure modes / 风险和失效模式

- Over-aggressive deduplication may hide genuinely distinct rows / 过度激进的去重可能隐藏真正不同的行
- Historical tool formats may not provide enough metadata for perfect normalization / 历史工具格式可能无法提供足够元数据来实现完美归一化
- Protocol classification may need refinement as Codex transcript shapes evolve / 随着 Codex 转录形态演进，协议分类可能需要细化
- Search behavior may confuse users if matches only exist in protocol or raw layers / 如果匹配只存在于协议层或原始层，搜索行为可能让用户困惑

## Security / privacy / compliance / 安全 / 隐私 / 合规

- All transcript data stays local / 所有转录数据都保留在本地
- No transcript mutation / 不变更转录
- Raw transcript access remains explicit and traceable / 原始转录访问保持显式且可追踪
- Derived logical events should not expose more than the source rows already contain / 派生逻辑事件不应暴露超过来源行已经包含的内容

## Rollout plan / 推出计划

- Keep raw layer available during normalization rollout / 在归一化推出期间保持原始层可用
- Default users to `main` layer / 默认将用户置于 `main` 层
- Use `protocol` layer for debugging and classification validation / 使用 `protocol` 层进行调试和分类验证
- Add fixture coverage for known transcript patterns before broadening rules / 在扩大规则之前，为已知转录模式添加 fixture 覆盖

## Validation / 验证

- Parser tests covering mirrored message channels / 覆盖镜像消息通道的解析器测试
- Tests for protocol classification and old/new patch formats / 针对协议分类以及新旧补丁格式的测试
- Detail DTO tests covering structured sections for conversation, command, patch, plan, protocol, and raw fallback cases / 覆盖对话、命令、补丁、计划、协议和原始回退场景结构化区段的详情 DTO 测试
- Renderer tests covering markdown/code/terminal/json/diff/notice output and escaping / 覆盖 markdown/code/terminal/json/diff/notice 输出和转义的渲染器测试
- Manual verification against a real local `.codex` directory / 使用真实的本地 `.codex` 目录进行手动验证
- Confirm that one logical event can reveal all underlying raw rows / 确认一个逻辑事件可以揭示所有底层原始行

## Decision log / 决策日志

- 2026-04-21: Adopted the three-layer model (`main`, `protocol`, `raw`) instead of raw-only rendering. / 2026-04-21：采用三层模型（`main`、`protocol`、`raw`），而不是只渲染原始内容。
- 2026-04-21: Treated protocol injections as first-class events instead of hiding them permanently. / 2026-04-21：将协议注入视为一等事件，而不是永久隐藏它们。
- 2026-04-21: Grouped tool operations by `call_id` to make shell, patch, MCP, and JS REPL activity readable. / 2026-04-21：按 `call_id` 对工具操作分组，使 shell、补丁、MCP 和 JS REPL 活动可读。
- 2026-04-21: Added server-side event-detail extraction plus a frontend renderer registry so expanded cards show structured content without trusting raw HTML from transcripts. / 2026-04-21：添加服务器端事件详情提取和前端渲染器注册表，让展开卡片在不信任转录原始 HTML 的情况下显示结构化内容。
- 2026-05-21: Added current Codex protocol event coverage for lifecycle aliases, session configuration metadata, goal metadata, warnings/errors, protocol plan updates, and incomplete tool-family records while keeping unknown variants lossless in protocol/raw layers. / 2026-05-21：增加当前 Codex 协议事件覆盖，包含生命周期别名、session configuration metadata、goal metadata、warning/error、协议计划更新和不完整工具族记录，同时让未知 variant 继续在 protocol/raw 层无损保留。
- 2026-05-30: Moved routine task start/completion lifecycle events and their aliases from the Main timeline to the protocol layer because they describe runtime state rather than engineering workflow. / 2026-05-30：将常规 task 开始/完成生命周期事件及其别名从主时间线移到 protocol 层，因为它们描述的是运行时状态而不是工程工作流。
- 2026-05-30: Kept readable previews visible when expanded cards have inspector-only detail, avoiding empty timeline bodies for protocol metadata events. / 2026-05-30：当展开卡片只有 inspector 详情时保留可读摘要，避免 protocol metadata 事件出现空白时间线正文。
- 2026-06-05: Kept remaining thread-name and unmodeled item-completion lifecycle records in the protocol layer and removed the obsolete Main-timeline `turn` kind from folding controls. / 2026-06-05：将剩余的 thread-name 和未建模 item-completion 生命周期记录保留在 protocol 层，并从折叠控制中移除过时的 Main-timeline `turn` 类型。
- 2026-06-05: Renamed ambiguous Main-timeline event kinds for folding and filters: `token` became `usage_limit_warning`, `tool_operation` became `other_tool_call`, `plan_artifact` became `proposed_plan`, and `mcp` became `mcp_call`. / 2026-06-05：重命名折叠和筛选中含义不清的 Main-timeline 事件类型：`token` 改为 `usage_limit_warning`，`tool_operation` 改为 `other_tool_call`，`plan_artifact` 改为 `proposed_plan`，`mcp` 改为 `mcp_call`。
- 2026-06-05: Removed `plan_update` from the fixed folding-editor kind list while preserving parser support and dynamic visibility when such events appear in the selected data. / 2026-06-05：从折叠编辑器的固定事件类型列表中移除 `plan_update`，同时保留解析支持，并在选中数据实际出现该事件时继续动态显示。
- 2026-06-18: Kept injected goal context in the protocol layer while promoting goal lifecycle tools to Main timeline `goal` events with structured status/objective summaries. / 2026-06-18：将注入的 goal context 保留在 protocol 层，同时把 goal 生命周期工具提升为 Main timeline 的 `goal` 事件，并展示结构化状态和 objective 摘要。
