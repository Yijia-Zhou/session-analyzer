# Codex Protocol Event Coverage / Codex 协议事件覆盖

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: draft / 状态：草案
- Last updated: 2026-05-21 / 最近更新：2026-05-21
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design: / 相关设计：
  - `docs/design-docs/logical-event-timeline.md`
- Upstream references checked on 2026-05-21: / 2026-05-21 检查的上游参考：
  - `https://github.com/openai/codex/blob/main/codex-rs/docs/protocol_v1.md`
  - `https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs`

## Context / 背景

Codex rollout JSONL rows are protocol records, not a frozen public analytics schema. Local rollout rows flatten a top-level `RolloutItem` beside `timestamp`, so a protocol event normally appears as `{"timestamp":"...","type":"event_msg","payload":{"type":"..."}}`. `EventMsg` itself is a tagged Rust enum with `payload.type` encoded in `snake_case`.

Codex rollout JSONL 行是协议记录，不是固定不变的公开分析 schema。本地 rollout 行会把顶层 `RolloutItem` 和 `timestamp` 展平，因此协议事件通常形如 `{"timestamp":"...","type":"event_msg","payload":{"type":"..."}}`。`EventMsg` 本身是带 tag 的 Rust enum，`payload.type` 使用 `snake_case` 编码。

Upstream explicitly treats `EventMsg` as extensible. This viewer should therefore keep its existing loose parser model: accept unknown event variants, preserve raw JSON, and add strong behavior only for event types that affect reading, search, grouping, metadata, severity, or metrics.

上游明确把 `EventMsg` 视为可扩展类型。因此本查看器应保持现有宽松解析模型：接受未知 event variant，保留原始 JSON，只对会影响阅读、搜索、分组、元数据、严重级别或指标的事件类型补充强行为。

## Event Families / 事件族

Current upstream `EventMsg` variants fall into these practical parser families:

当前上游 `EventMsg` variant 可按解析器实践分成以下事件族：

- Lifecycle and session metadata: `task_started`, `task_complete`, `context_compacted`, `thread_rolled_back`, `turn_aborted`, `session_configured`, `thread_settings_applied`, `thread_goal_updated`, `shutdown_complete`. / 生命周期与 session 元数据：`task_started`、`task_complete`、`context_compacted`、`thread_rolled_back`、`turn_aborted`、`session_configured`、`thread_settings_applied`、`thread_goal_updated`、`shutdown_complete`。
- Conversation and reasoning: `user_message`, `agent_message`, `agent_reasoning`, raw reasoning/content delta events, `raw_response_item`, `item_started`, `item_completed`. / 对话与推理：`user_message`、`agent_message`、`agent_reasoning`、原始推理或内容 delta 事件、`raw_response_item`、`item_started`、`item_completed`。
- Tools and external actions: MCP startup/tool events, web search, image generation, exec command begin/output/interaction/end, patch apply begin/update/end, `view_image_tool_call`, dynamic tool request/response. / 工具与外部动作：MCP 启动和工具事件、Web search、图像生成、exec command begin/output/interaction/end、patch apply begin/update/end、`view_image_tool_call`、dynamic tool request/response。
- Approval and user interaction: exec/apply-patch approval requests, permissions requests, user input requests, elicitation requests, guardian assessment. / 审批与用户交互：exec/apply-patch approval request、permissions request、user input request、elicitation request、guardian assessment。
- Warning and error surfaces: `error`, `warning`, `guardian_warning`, `deprecation_notice`, `stream_error`, model reroute/verification. / 警告与错误表面：`error`、`warning`、`guardian_warning`、`deprecation_notice`、`stream_error`、model reroute/verification。
- Review, plan, hooks, realtime, and collaboration: review mode enter/exit, `plan_update`, `plan_delta`, hook events, realtime conversation events, and collab agent lifecycle events. / Review、计划、hook、实时会话与协作：review mode 进入/退出、`plan_update`、`plan_delta`、hook 事件、realtime conversation 事件、collab agent 生命周期事件。

The parser does not need to model every field in these families. It should extract only the fields needed for user-facing summaries, search, grouping, and structured detail, while raw JSON remains the source of truth for everything else.

解析器不需要建模这些事件族中的每个字段。它只应提取面向用户摘要、搜索、分组和结构化详情所需的字段；其他内容继续以原始 JSON 作为事实来源。

## Current Coverage Notes / 当前覆盖记录

- Existing parser behavior already matches the right compatibility posture: unknown `event_msg` rows fall back to protocol/raw visibility instead of being rejected. / 现有解析行为已经符合正确的兼容姿态：未知 `event_msg` 行会回退到 protocol/raw 可见性，而不是被拒绝。
- `task_started` and `task_complete` are current v1 wire names. Upstream also accepts `turn_started` and `turn_complete` as aliases, so the viewer should normalize both aliases into the same lifecycle behavior. / `task_started` 和 `task_complete` 是当前 v1 wire 名称。上游也接受 `turn_started` 和 `turn_complete` 作为别名，因此查看器应把这两个别名归一到相同生命周期行为。
- `thread_name_updated` is not the same wire event as current `thread_goal_updated`. Keep `thread_name_updated` only as legacy transcript compatibility for `payload.thread_name`. Current protocol title metadata should come from `session_configured.thread_name`; `thread_goal_updated.goal.objective` is long-running goal metadata and should be preview/search content, not a thread-name replacement. / `thread_name_updated` 不是当前 `thread_goal_updated` 的同一个 wire 事件。`thread_name_updated` 只应作为旧转录兼容，用于 `payload.thread_name`。当前协议下的标题元数据应来自 `session_configured.thread_name`；`thread_goal_updated.goal.objective` 是长期目标元数据，应作为预览和搜索内容，而不是 thread name 替代品。
- Warning-like events should not be treated as neutral protocol noise when they communicate user-visible risk. `warning`, `guardian_warning`, and `stream_error` should surface warning/error severity, while `deprecation_notice` can remain protocol unless it affects the user's current work. / 当 warning 类事件传达用户可见风险时，不应把它们当作中性协议噪声。`warning`、`guardian_warning` 和 `stream_error` 应暴露 warning/error 严重级别；`deprecation_notice` 可继续留在 protocol，除非它影响用户当前工作。
- Plan events currently arrive through both tool-call-shaped `update_plan` records and protocol-shaped `plan_update` / `plan_delta` records. Planning metrics and reading filters should count both plan artifacts and these plan update events. / 计划事件当前可能通过工具调用形态的 `update_plan` 记录和协议形态的 `plan_update` / `plan_delta` 记录出现。计划指标和阅读筛选应同时统计 plan artifact 和这些 plan update 事件。
- Tool operations should prefer complete end events when present, but begin/update/delta rows must remain readable for incomplete or interrupted transcripts. Status values such as `declined` should not be inferred as success only because an exit code is absent. / 工具操作在存在完整 end 事件时应优先使用 end 事件，但 begin/update/delta 行必须在不完整或中断转录中保持可读。`declined` 等状态不应仅因为缺少 exit code 就被推断为成功。

## Maintenance Rules / 维护规则

When Codex protocol changes or real transcripts expose new event shapes:

当 Codex 协议变化或真实转录暴露新的事件形态时：

1. Check upstream `codex-rs/protocol/src/protocol.rs` first; treat generated or hand-copied schemas as secondary evidence. / 先检查上游 `codex-rs/protocol/src/protocol.rs`；生成或手抄的 schema 只能作为次级依据。
2. Do not hard-code an exhaustive closed `EventMsg` schema in this repository. If an exact schema is needed for investigation, generate it locally from upstream Rust types with `schemars::schema_for!(RolloutLine)`. / 不要在本仓库中硬编码穷尽且闭合的 `EventMsg` schema。如果调查需要精确 schema，应从上游 Rust 类型用 `schemars::schema_for!(RolloutLine)` 本地生成。
3. Add parser behavior only when an event changes the main/protocol layer choice, severity, session metadata, tool grouping, search text, metrics, or structured details. / 只有当某个事件会改变 main/protocol 层归属、严重级别、session 元数据、工具分组、搜索文本、指标或结构化详情时，才新增解析行为。
4. Keep raw fallback lossless for every row and add focused fixtures before broadening normalization rules. / 对每一行保持无损 raw fallback，并在扩大归一化规则前添加聚焦 fixture。
5. Update bilingual docs together: this document for protocol coverage, `logical-event-timeline.md` for model changes, product specs only for changed user-visible behavior, and `tech-debt-tracker.md` for known gaps left intentionally open. / 双语文档要同步更新：协议覆盖写入本文；模型变化写入 `logical-event-timeline.md`；只有用户可见行为变化才更新产品规格；有意保留的已知缺口写入 `tech-debt-tracker.md`。

## Follow-up Candidates / 后续候选工作

- Normalize lifecycle aliases: `turn_started` -> `task_started`, `turn_complete` -> `task_complete`. / 归一化生命周期别名：`turn_started` -> `task_started`，`turn_complete` -> `task_complete`。
- Add `session_configured` metadata extraction for title, cwd, parent id, model, and thread source without replacing the established first-`session_meta` identity rule. / 为 `session_configured` 增加标题、cwd、父 id、model 和 thread source 元数据提取，但不替换既有的第一条 `session_meta` 身份规则。
- Add `thread_goal_updated` display metadata using `goal.objective`, `goal.status`, token budget, tokens used, and time used. / 为 `thread_goal_updated` 增加展示元数据，使用 `goal.objective`、`goal.status`、token budget、tokens used 和 time used。
- Surface warning/error variants with meaningful severity and details. / 以有意义的严重级别和详情展示 warning/error 类 variant。
- Treat `plan_update` and `plan_delta` as planning events for metrics, filters, and detail rendering. / 在指标、筛选和详情渲染中把 `plan_update` 和 `plan_delta` 作为计划事件处理。
- Improve tool-family coverage for begin/update/delta/declined shapes across exec, patch, MCP, image generation, dynamic tools, approvals, hooks, and collaboration. / 改进 exec、patch、MCP、图像生成、dynamic tools、approval、hook 和协作中 begin/update/delta/declined 形态的工具事件覆盖。
