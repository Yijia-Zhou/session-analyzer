# Session Transcript Analyzer / 会话转录分析器

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: draft / 状态：草案
- Last updated: 2026-05-30 / 最近更新：2026-05-30
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`
  - `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md`

## Summary / 摘要

Session Transcript Analyzer is a local web tool for reviewing Codex session transcripts for a specific repository. It helps a single developer move from raw transcript dumps to usable history: searchable sessions, layered timelines, tool-call analysis, and drill-down into the original JSONL when needed. The product is optimized for long sessions, repeated iterations, and mixed protocol noise inside Codex transcripts.

Session Transcript Analyzer 是一个本地 Web 工具，用于查看特定仓库的 Codex 会话转录。它帮助单个开发者把原始转录转储转化为可用历史：可搜索的会话、分层时间线、工具调用分析，以及在需要时下钻到原始 JSONL。该产品针对长会话、反复迭代，以及 Codex 转录中混杂的协议噪声进行了优化。

## Problem / 问题

- Raw Codex transcripts are long, repetitive, and hard to review after many sessions. / 原始 Codex 转录又长又重复，在许多会话之后很难回顾。
- The same user or assistant content may appear through multiple channels, which makes naive viewers noisy. / 同一用户或助手内容可能通过多个通道出现，这会让朴素查看器产生大量噪声。
- Tool activity, protocol injections, and plan artifacts are useful for debugging but should not dominate normal reading. / 工具活动、协议注入和计划产物对调试有用，但不应主导正常阅读。
- Without a local review tool, repository-specific engineering history becomes hard to search and hard to trust. / 如果没有本地查看工具，特定仓库的工程历史会变得难以搜索，也难以信任。

## Target users / 目标用户

- Primary users: individual developers using Codex across many sessions in the same repository / 主要用户：在同一仓库中跨多个会话使用 Codex 的个人开发者
- Secondary users: maintainers debugging transcript format changes or viewer behavior / 次要用户：调试转录格式变化或查看器行为的维护者
- Non-target users: multi-user hosted analytics or cloud reporting consumers / 非目标用户：多用户托管分析或云报告消费者

## Goals / 目标

- Make repository-scoped session history readable without opening raw JSONL files by hand. / 让仓库范围内的会话历史可读，而不需要手动打开原始 JSONL 文件。
- Support fast search across messages, tool calls, files, and outputs. / 支持跨消息、工具调用、文件和输出的快速搜索。
- Provide a main timeline that reflects logical work rather than raw duplicated transcript rows. / 提供反映逻辑工作的主时间线，而不是原始重复转录行。
- Preserve access to protocol and raw transcript detail for debugging and verification. / 保留对协议和原始转录细节的访问，以便调试和验证。

## Non-goals / 非目标

- Cloud sync, shared collaboration, or hosted dashboards / 云同步、共享协作或托管仪表板
- LLM-based summarization or semantic clustering / 基于 LLM 的摘要或语义聚类
- Editing or mutating Codex transcript files / 编辑或变更 Codex 转录文件
- Supporting every historical Codex transcript variant perfectly on day one / 在第一天就完美支持每一种历史 Codex 转录变体

## User stories / 用户故事

- As a developer, I want to list only sessions that touched my current repository, so that unrelated Codex history stays out of the way. / 作为开发者，我希望只列出触及当前仓库的会话，以便排除无关的 Codex 历史。
- As a developer, I want to search for a file path, command, or error string, so that I can jump back to the relevant work quickly. / 作为开发者，我希望搜索文件路径、命令或错误字符串，以便快速跳回相关工作。
- As a developer, I want the default timeline to collapse protocol noise and duplicate message channels, so that I can follow the real flow of work. / 作为开发者，我希望默认时间线折叠协议噪声和重复消息通道，以便跟随真实的工作流程。
- As a maintainer, I want a protocol layer and a raw layer, so that I can verify how the logical timeline was derived. / 作为维护者，我希望有协议层和原始层，以便验证逻辑时间线是如何派生的。
- As a maintainer, I want tool operations grouped by logical call, so that shell runs, patch applications, and MCP calls are easier to inspect. / 作为维护者，我希望按逻辑调用对工具操作分组，以便更容易检查 shell 运行、补丁应用和 MCP 调用。

## User-facing behavior / 面向用户的行为

1. The user starts the local server with an optional repository root; if omitted, the browser can show configured Codex workspaces immediately, then update project activity after transcript scanning discovers session working directories. / 用户用可选的仓库根目录启动本地服务器；如果省略，浏览器可以先立即显示已配置的 Codex 工作区，然后在转录扫描发现会话工作目录后更新项目活动信息。
1. When a project is already selected, opening the idle project chooser keeps a return path: clicking the project switch control again exits the chooser and restores the currently indexed project. While a replacement project is indexing, the top bar is hidden and the chooser's cancel control remains the cancellation path. / 当已经选择了项目时，打开空闲的项目选择器仍保留返回路径：再次点击项目切换控件会退出选择器并恢复当前已索引项目。替换项目正在索引时，顶部栏会隐藏，项目选择器内的取消控件仍是取消入口。
2. The application scans the local Codex home and shows only sessions matching the selected repository. / 应用扫描本地 Codex 主目录，并只显示与所选仓库匹配的会话。
3. The user sees a session list with counts, sizes, timestamps, and failure indicators; long rows are height-limited by default and reveal their full content on hover or keyboard focus. Forked subagent and review sessions remain selectable but render as visually secondary derived sessions with their source session title when available, and hovering or focusing a derived session lightly highlights its visible parent. Plain user-created `/fork` sessions remain normal primary rows but show a `Fork · from ...` relationship tag when the source session is known. / 用户看到包含计数、大小、时间戳和失败指示器的会话列表；较长的条目默认限制高度，并在鼠标悬停或键盘聚焦时显示完整内容。fork 出来的子 agent 和 review 会话仍可选择，但会以视觉上次级的派生会话呈现，并在可用时显示来源会话标题；悬停或聚焦派生会话时，会轻量高亮当前可见的父会话。普通用户发起的 `/fork` 会话仍作为普通主会话行展示，但在已知来源会话时显示 `Fork · from ...` 关系标签。
4. Opening a session shows the main timeline by default, including visible review start/completion lifecycle markers when the transcript records review mode. / 打开会话时默认显示主时间线；当转录记录了 review mode 时，主时间线会显示 review 开始和完成的生命周期标记。
5. The user may switch between `Main timeline`, `Protocol layer`, and `Raw records`. / 用户可以在 `Main timeline`、`Protocol layer` 和 `Raw records` 之间切换。
6. The user may search from the top search bar, use `file:`, `kind:`, `status:`, and `layer:` operators for structured narrowing, choose common analyzed-project files from suggestions, choose current-layer event kinds from dynamic suggestions, inspect grouped tool operations, and see free-text matches highlighted in the currently rendered session list, timeline, and detail panel. / 用户可以从顶部搜索栏搜索，使用 `file:`、`kind:`、`status:` 和 `layer:` 操作符进行结构化收窄，从候选中选择常见的被分析项目文件，从动态候选中选择当前事件层的事件类型，检查分组后的工具操作，并在当前已渲染的会话列表、时间线和详情面板中看到自由文本命中高亮。
7. Expanding a timeline card through folding strategy, event selection, or the small spine control replaces the preview with structured timeline body content: markdown messages, command run regions for command/stdout/stderr, patch changes, notices, and other primary work output. When a card that naturally belongs in summary mode is manually expanded, the small spine control returns it to summary mode instead of the more compact collapsed mode. / 通过折叠策略、事件选择或小型脊柱控件展开时间线卡片时，会以内联结构化 timeline 正文替换预览：Markdown 消息、command 的命令/stdout/stderr 执行区域、patch 变更、通知以及其他主要工作输出。当一个自然属于摘要模式的卡片被手动展开后，小型脊柱控件会把它恢复到摘要模式，而不是更紧凑的折叠模式。
8. Raw JSON fallback, metadata tables, structured payloads, and other supplemental sections live in the selected-event inspector instead of duplicating the timeline body. / 原始 JSON 回退、元数据表、结构化 payload 以及其他补充区段位于选中事件检查器中，而不重复 timeline 正文。
9. Clicking a timeline event selects it, expands it when needed, and shows a selected-event inspector in the right-side panel with summary only when it adds context, compact metadata, source context, raw refs, and supplemental details named by purpose such as Files, Result, Run context, Arguments, Request, and Response. / 点击时间线事件会选中该事件，在需要时展开它，并在右侧面板显示选中事件检查器；只有概要能补充上下文时才显示概要，同时展示紧凑元数据、来源上下文、原始引用，以及按用途命名的补充详情，例如 Files、Result、Run context、Arguments、Request 和 Response。
10. Clicking the selected-event inspector's `Raw refs` control shows all underlying raw JSONL rows for verification in the right-side panel, with a return path back to the selected-event inspector. / 点击选中事件检查器中的 `Raw refs` 控件会在右侧面板显示所有底层原始 JSONL 行以供验证，并提供返回选中事件检查器的入口。
11. The UI reports filtered session and event result counts while structured filters are active. Free-text search is a find-in-timeline aid rather than an event filter: it highlights matches inside the current session and layer, reports the current rendered-match position against the current session's full-text match total, and lets the user jump to the previous or next highlighted match with controls or Enter/Shift+Enter in the search box. From a selected event in a filtered or non-main view, the user can choose `Read from here` to clear event filters, return to `Main timeline`, and keep reading from the selected event's position or the nearest visible main event. / 当结构化筛选生效时，界面会显示过滤后的会话和事件结果数量。自由文本搜索是时间线内查找辅助，而不是事件筛选器：它会在当前 session 和事件层中高亮命中，显示当前可渲染命中位置与当前 session 全文命中总数，并允许用户通过控件或在搜索框中按 Enter/Shift+Enter 跳转到下一个或上一个高亮命中。在筛选后视图或非主时间线视图中选中事件后，用户可以选择 `Read from here` 清除事件筛选、回到 `Main timeline`，并从选中事件的位置或最近的可见主时间线事件继续阅读。
12. Session analysis metrics use a compact display and provide reading-view shortcuts where the metric maps to a useful mode: on Main timeline, nonzero message, failed, file-change, and plan metrics toggle conversation, debugging, change-review, and planning folding strategies respectively and can return to the previous strategy; on protocol and raw layers, those folding-strategy shortcuts are disabled because profiles are not active there. The plan metric includes plan artifacts and `update_plan` calls. Nonzero protocol metrics toggle the protocol layer and can return to the previous layer. Zero-value metrics remain informational only. / Session 分析指标使用紧凑显示，并在指标能映射到有用模式时提供阅读视角快捷入口：在 Main timeline 上，非零的消息、失败、文件改动和计划指标会分别切换到对话阅读、问题排查、改动审查和计划阅读折叠策略，并可返回之前的策略；在 protocol 和 raw layer 上，这些折叠策略快捷入口会禁用，因为 profile 在这些层不生效。计划指标包含 plan artifact 和 `update_plan` 调用。非零协议指标会切换协议层，并可返回之前的事件层。零值指标仅作为信息展示。
13. From the selected-event inspector, the user can jump to the previous or next event in the current filtered result set for useful reading categories such as user messages, assistant messages, plans, update_plan calls, failed commands, commands, patches, errors, MCP calls, and web searches. / 在选中事件检查器中，用户可以在当前过滤结果集内按有助于阅读的类别跳转到上一个或下一个事件，例如用户消息、助手消息、计划、update_plan 调用、失败命令、命令、patch、错误、MCP 调用和 web 搜索。
14. On narrow screens, `Sessions`, `Events`, and `Detail` are available as top-level tabs; selecting a session switches to `Events`, and inspecting an event or opening `Raw refs` switches to `Detail`. / 在窄屏上，`Sessions`、`Events` 和 `Detail` 作为顶层标签页可用；选择会话会切换到 `Events`，检查事件或打开 `Raw refs` 会切换到 `Detail`。
15. Changing the folding strategy reapplies that strategy's defaults for the selected session instead of keeping stale manual fold overrides, and the reset-folds control only appears after the user manually expands or collapses a timeline card. When a selected event exists, folding-strategy and layer switches keep focus on that event if it remains visible, or move focus to the nearest visible event in the new timeline order; when no event is selected, switches focus the first naturally expanded event if one exists. / 切换折叠策略时，会对当前选中 session 重新应用该策略的默认展开规则，而不是保留过时的手动折叠覆盖；重置展开状态控件只会在用户手动展开或折叠时间线卡片后出现。当存在选中事件时，折叠策略和事件层切换会在该事件仍可见时保持焦点，否则把焦点移到新时间线顺序中最近的可见事件；当未选中事件时，切换后会在存在自然展开事件时聚焦第一个自然展开事件。
16. When no event is selected on Main timeline, the right-side detail panel shows the active folding strategy as editable rule groups for Main timeline event kinds only; unsaved edits preview immediately, and Save stores a browser-local custom strategy while Cancel restores the saved strategy. On protocol and raw layers, the profile picker is disabled and the panel explains the layer's fixed display rules with a path back to Main timeline. / 在 Main timeline 上未选中事件时，右侧详情面板会以只适用于 Main timeline 事件类型的可编辑规则组显示当前折叠策略；未保存修改会立即预览，Save 会保存为浏览器本地自定义策略，Cancel 会恢复已保存策略。在 protocol 和 raw layer 上，profile 选择器会禁用，面板会说明该层的固定显示规则，并提供回到 Main timeline 的入口。
17. Any action that would switch folding strategies while profile edits are unsaved asks in-app whether to save and switch, discard and switch, or cancel; the dialog shows the current strategy name and lets the user edit the saved strategy name before saving. / 当折叠策略编辑尚未保存时，任何会切换折叠策略的操作都会在应用内询问是保存并切换、不保存并切换，还是取消；该对话框会显示当前策略名称，并允许用户在保存前编辑要保存的策略名称。
18. The detail panel provides consistent Back and Close behavior across event inspectors and raw refs; Close returns to the folding strategy panel. / 详情面板在事件检查器和原始引用之间提供一致的 Back 和 Close 行为；Close 会返回折叠策略面板。
19. When the server was started without `--repo`, the browser remembers the last selected target project locally and restores it on refresh when it is still available. / 当服务器未使用 `--repo` 启动时，浏览器会在本地记住上次选择的目标项目，并在刷新且该项目仍可用时恢复它。
20. Timeline pagination remains available through the explicit load-more button and also attempts to load the next page when the user scrolls to the bottom of the timeline pane. / 时间线分页既可通过显式的“加载更多”按钮使用，也会在用户滚动到时间线面板底部时尝试加载下一页。
21. Routine task start/completion, token count, and rate-limit records live in the protocol layer because they describe Codex runtime state rather than the engineering workflow; when a transcript reports an actual reached usage limit, the main timeline shows a warning event. Raw JSON remains available for verification. / 常规 task 开始/完成、token count 和 rate-limit 记录位于 protocol layer，因为它们描述的是 Codex 运行时状态而不是工程工作流；当转录报告确实触达使用限额时，main timeline 会显示一个 warning 事件。原始 JSON 仍可用于验证。
22. Project indexing shows progress while it scans and parses transcript files, can be cancelled from the project chooser, and avoids fully parsing transcript files that are clearly associated with a different repository. Files whose repository cannot be identified from early metadata are still parsed as a conservative fallback. / 项目索引在扫描和解析转录文件时会显示进度，可从项目选择器取消，并避免完整解析明确属于其他仓库的转录文件。无法从早期 metadata 识别仓库的文件仍会作为保守回退被解析。

## Acceptance criteria / 验收标准

- [x] Main timeline does not show duplicated user or assistant messages when mirrored transcript channels exist. / 当存在镜像转录通道时，主时间线不显示重复的用户或助手消息。
- [x] Protocol injections such as `AGENTS.md`, environment blocks, and developer instructions are accessible but not mixed into the default main timeline. / `AGENTS.md`、环境块和开发者指令等协议注入可以访问，但不会混入默认主时间线。
- [x] Protocol layer events use readable labels and concise summaries before users open raw JSON. / 协议层事件在用户打开原始 JSON 之前就使用可读标签和简洁摘要。
- [x] Tool calls are visible as logical operations with status, affected files, and raw drill-down. / 工具调用以逻辑操作形式可见，并带有状态、受影响文件和原始下钻入口。
- [x] Expanded timeline cards render structured event detail when timeline-owned sections exist; inspector-only events keep their readable preview instead of expanding into an empty body. / 当存在 timeline 所属区段时，展开的时间线卡片会渲染结构化事件详情；只有 inspector 内容的事件会保留可读摘要，而不是展开成空白正文。
- [x] Command output display applies conservative mojibake repair for likely UTF-8-as-GB18030/GBK text and marks unrecoverable replacement placeholders as `□`, while preserving raw JSONL drill-down. / 命令输出显示会对疑似 UTF-8 被当作 GB18030/GBK 解码的文本做保守乱码修复，并用 `□` 标记不可恢复的替换占位，同时保留原始 JSONL 下钻。
- [x] Command and patch expanded bodies keep primary work content in the timeline while moving metadata, structured payloads, and raw JSON to the inspector. / command 和 patch 展开正文会把主要工作内容保留在 timeline 中，并把 metadata、结构化 payload 和原始 JSON 移到 inspector。
- [x] Expanded timeline cards do not duplicate truncated preview text above the full body. / 展开的时间线卡片不会在完整正文上方重复截断预览文本。
- [x] Expanded detail remains available for `main`, `protocol`, and `raw` layers without hiding unknown transcript shapes. / 展开详情在 `main`、`protocol` 和 `raw` 层都保持可用，并且不会隐藏未知转录形态。
- [x] Raw records that map to known semantic events reuse the relevant structured detail sections, while keeping raw JSON available. / 映射到已知语义事件的原始记录会复用相关的结构化详情区段，同时保持原始 JSON 可用。
- [x] Raw JSONL rows remain accessible from the selected-event inspector for every logical event. / 每个逻辑事件都仍可从选中事件检查器访问原始 JSONL 行。
- [x] Finding by keyword and filtering by structured file operator, status, and event kind work across the selected layer. / 按关键词查找，以及按结构化文件操作符、状态和事件类型筛选可在所选层中正常工作。
- [x] Structured filter result counts stay visible while browsing a selected session, while free-text search keeps the full event set and reports match navigation counts. / 浏览选中 session 时，结构化筛选结果数量保持可见；自由文本搜索保留完整事件集合，并显示命中导航数量。
- [x] Free-text search terms are highlighted in currently rendered results and details, with current-position/full-match counts plus previous/next navigation. / 自由文本搜索词会在当前已渲染的结果和详情中高亮，并提供当前位置/全文命中总数以及上一个/下一个导航。
- [x] A selected filter/layer result can become a full Main timeline reading anchor through `Read from here`, without restarting at the beginning of the session. / 选中的筛选或事件层结果可以通过 `Read from here` 成为完整 Main timeline 的阅读锚点，而不需要从 session 开头重新开始。
- [x] Analysis metrics stay compact, expose only nonzero actionable shortcuts, and use reading-view shortcuts rather than adding search filters. / 分析指标保持紧凑，只对非零可操作指标提供快捷入口，并使用阅读视角快捷入口而不是添加搜索筛选。
- [x] Selected-event quick navigation moves through matching events within the current session, layer, and structured filters without losing raw drill-down access; when free-text search is active, search hits are available as a navigation category without shrinking the timeline. / 选中事件快速跳转会在当前 session、事件层和结构化筛选条件内的匹配事件之间移动，并且不会丢失原始下钻入口；当自由文本搜索生效时，搜索命中会作为导航类别可用，但不会缩小时间线。
- [x] Narrow-screen browsing keeps session selection, timeline reading, event inspection, raw refs, and layer/profile controls reachable without forcing them into one long document flow. / 窄屏浏览会保持会话选择、时间线阅读、事件检查、原始引用和 layer/profile 控件可访问，而不会把它们挤进一个很长的文档流。
- [x] Folding strategy changes clear stale manual fold overrides for the selected session, and the reset-folds control stays hidden until manual fold overrides exist. / 折叠策略变更会清除当前选中 session 的过时手动折叠覆盖，并且重置展开状态控件会保持隐藏，直到存在手动折叠覆盖。
- [x] Folding strategy and layer changes preserve the selected-event reading focus when possible, move to the nearest visible event when needed, and focus the first naturally expanded event when switching from an unselected state. / 折叠策略和事件层变更会尽可能保持选中事件的阅读焦点，必要时移动到最近的可见事件，并在未选中状态切换时聚焦第一个自然展开事件。
- [x] Folding strategy rules are visible and editable in the empty detail panel, with immediate preview and browser-local custom saves. / 折叠策略规则会在空详情面板中可见且可编辑，并支持即时预览和浏览器本地自定义保存。
- [x] Switching folding strategies with unsaved rule edits offers in-app save, discard, and cancel choices before changing the strategy, and supports naming the saved strategy from that dialog. / 在规则编辑未保存时切换折叠策略，会先在应用内提供保存、放弃和取消选项，并支持在该对话框中命名要保存的策略。
- [x] Detail panel Back and Close controls work consistently for inspector and raw refs views. / 详情面板的 Back 和 Close 控件在检查器和原始引用视图中保持一致。
- [x] Scrolling to the bottom of a partially loaded timeline attempts to load the next page without requiring the load-more button. / 滚动到尚未完全加载的时间线底部时，会尝试加载下一页，而不必点击“加载更多”按钮。
- [x] Forked subagent session files remain separately selectable even when they contain embedded parent session metadata. / 即使 fork 出来的子 agent 会话文件中包含嵌入的父会话元数据，它们也必须保持可单独选择。
- [x] Plain `/fork` sessions are not visually secondary derived sessions, while still exposing their fork source as a relationship tag. / 普通 `/fork` 会话不会被视觉上当作次级派生会话，但仍会把 fork 来源作为关系标签暴露出来。
- [x] Repository filtering is case-insensitive on Windows paths. / 在 Windows 路径上，仓库筛选不区分大小写。
- [x] Inferred fallback titles come from real user task text rather than protocol wrappers or malformed transcript scaffolding. / 推断出的回退标题来自真实用户任务文本，而不是协议包装或格式异常的转录脚手架。
- [x] Starting without `--repo` lets the user select a target project in the browser before repository-scoped indexing. / 不带 `--repo` 启动时，用户可以先在浏览器中选择目标项目，再进行仓库范围的索引。
- [x] Routine token count events stay out of Main timeline, remain readable in Protocol layer, and only produce a Main timeline warning when a usage limit is reached. / 常规 token count 事件不会进入 Main timeline，会在 Protocol layer 中保持可读，并且只有在触达使用限额时才会产生 Main timeline warning。
- [x] Project indexing reports visible progress, can be cancelled before completion, and preserves correctness by parsing unknown-repository transcript files while skipping only files known to belong to other repositories. / 项目索引会报告可见进度，可在完成前取消，并通过解析未知仓库归属的转录文件、只跳过已知属于其他仓库的文件来保持正确性。

## Edge cases / 边界情况

- Sessions with no `session_index.jsonl` entry / 没有 `session_index.jsonl` 条目的会话
- Sessions with partial or malformed JSONL rows / 包含部分或格式错误 JSONL 行的会话
- Old transcripts that only expose tool call plus output without an `event_msg:*_end` row / 只暴露工具调用及输出、但没有 `event_msg:*_end` 行的旧转录
- Empty reasoning records / 空推理记录
- Sessions that contain user-side protocol wrappers such as `<turn_aborted>` or `<user_shell_command>` / 包含 `<turn_aborted>` 或 `<user_shell_command>` 等用户侧协议包装器的会话
- Forked subagent sessions that start with child `session_meta` and then embed parent `session_meta` from forked context / fork 出来的子 agent 会话以子会话 `session_meta` 开头，随后又因 fork 上下文嵌入父会话 `session_meta`

## Metrics / 指标

- Adoption: number of repository sessions loaded and revisited locally / 采用度：本地加载和再次访问的仓库会话数量
- Success: time to locate a prior session or relevant command/file path / 成功指标：定位先前会话或相关命令/文件路径所需时间
- Failure: duplicate content still visible in main timeline, or important protocol data impossible to recover / 失败指标：主时间线中仍可见重复内容，或重要协议数据无法恢复
- Guardrail: raw row drill-down always remains available / 护栏：原始行下钻始终保持可用

## Open questions / 待解决问题

- Whether protocol subtypes should get custom icons beyond current readable labels and summaries / 协议子类型是否应在当前可读标签和摘要之外获得自定义图标
- Whether session titles should be manually editable or inferred only / 会话标题应允许手动编辑，还是只能推断
- Whether future transcript indexing should remain in-memory only or allow an optional local cache / 未来转录索引应继续只保存在内存中，还是允许可选的本地缓存
