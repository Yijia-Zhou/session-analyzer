# Logical Event Timeline / 逻辑事件时间线

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-05-05 / 最近更新：2026-05-05
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related plans: / 相关计划：
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

## Context / 背景

Codex transcript JSONL files contain multiple channels for the same semantic action. A user message can appear as both `response_item.message role=user` and `event_msg.user_message`. Assistant responses, reasoning, tool calls, and plan artifacts may also be mirrored or split across multiple rows. Transcript formats also evolve over time, so old sessions and new sessions cannot be normalized with a single simplistic rule.

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

- Raw parser in `src/codex.js` / `src/codex.js` 中的原始解析器
- Logical-event builder in `src/codex.js` / `src/codex.js` 中的逻辑事件构建器
- HTTP API in `server.js` / `server.js` 中的 HTTP API
- Layer-aware UI rendering in `public/app.js` / `public/app.js` 中的层感知 UI 渲染

### Data flow / 数据流

1. Load session metadata and raw JSONL rows. / 加载会话元数据和原始 JSONL 行。
2. Annotate each raw row with extracted text, call IDs, command text, outputs, and touched files when available. / 在可用时，为每个原始行标注提取文本、调用 ID、命令文本、输出和触及文件。
3. Group by `call_id` first for tool operations. / 对工具操作先按 `call_id` 分组。
4. Walk the remaining rows in order and fold them into logical messages, reasoning entries, protocol events, lifecycle events, or plan artifacts. / 按顺序遍历剩余行，并折叠为逻辑消息、推理条目、协议事件、生命周期事件或计划产物。
5. Expose logical events to the main and protocol layers; expose raw rows separately. / 向主层和协议层暴露逻辑事件；单独暴露原始行。

Session identity is fixed from the transcript file UUID or the first `session_meta` row. Later embedded `session_meta` rows, such as parent metadata copied into a forked subagent transcript, remain inspectable protocol/raw records but do not replace the owning session id or selection key.

会话身份固定来自转录文件 UUID 或第一条 `session_meta` 行。后续嵌入的 `session_meta` 行，例如 fork 出来的子 agent 转录中复制进来的父会话元数据，仍然作为可检查的协议/原始记录保留，但不会替换所属会话 id 或选择 key。

Session title inference prefers explicit `session_index.jsonl` or thread-name metadata. When no explicit title exists, fallback inference scans main-layer user messages, skips protocol-shaped wrappers such as `<user_shell_command>`, cleans lightweight Markdown title syntax, and uses the first valid task line. Forked subagent sessions use the last valid user task line so copied parent context does not dominate the child title.

会话标题推断优先使用显式的 `session_index.jsonl` 或 thread-name 元数据。当不存在显式标题时，回退推断会扫描主层用户消息，跳过 `<user_shell_command>` 等协议形态包装，清理轻量 Markdown 标题语法，并使用第一条有效任务行。fork 出来的子 agent 会话会使用最后一条有效用户任务行，避免复制进来的父上下文主导子会话标题。

## Data model / schema / 数据模型 / 模式

### Raw event / 原始事件

Important fields:

重要字段：

- `rawId`
- `recordType`
- `payloadType`
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

### Logical event / 逻辑事件

Important fields:

重要字段：

- `id`
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
- `rawRefs[]`
- `channels[]`

Protocol logical events derive `label` and `preview` from subtype display metadata instead of raw subtype identifiers, while `searchText` and `rawRefs[]` keep the original transcript text discoverable and traceable.

协议逻辑事件会从子类型展示元数据派生 `label` 和 `preview`，而不是直接使用原始子类型标识符；同时 `searchText` 和 `rawRefs[]` 会保留原始转录文本的可搜索性和可追踪性。

### Event detail DTO / 事件详情 DTO

Expanded cards do not reuse `preview` for rich rendering. The server derives an `EventDetailDto` from the underlying logical event plus its referenced raw rows:

展开卡片不会复用 `preview` 进行富渲染。服务器会根据底层逻辑事件及其引用的原始行派生 `EventDetailDto`：

- `id`
- `kind`
- `subtype`
- `layer`
- `title`
- `meta`
- `rawRefs[]`
- `sections[]`

`meta` always includes `timestamp`, `turnId`, `status`, `severity`, `toolName`, `touchedFiles`, `outputStats`, `channels`, and `source`.

`meta` 始终包含 `timestamp`、`turnId`、`status`、`severity`、`toolName`、`touchedFiles`、`outputStats`、`channels` 和 `source`。

`sections[]` is a discriminated union of:

`sections[]` 是以下类型的可辨识联合：

- `markdown`
- `code`
- `terminal`
- `json`
- `diff`
- `kv`
- `notice`
- `raw_json`

Expanded-card rendering treats `markdown-it` as a required server dependency. Markdown source is converted server-side with raw HTML disabled and dangerous link protocols rejected. In the main and protocol layers, `raw_json` sections are rendered as collapsible fallback material so the right-side raw refs panel remains the primary full-source view.

展开卡片渲染将 `markdown-it` 视为必需的服务器依赖。Markdown 源内容在服务器端转换，禁用原始 HTML，并拒绝危险链接协议。在主层和协议层中，`raw_json` 区段渲染为可折叠的回退材料，从而让右侧原始引用面板保持主要的完整来源视图。

Raw rows that map to known semantic events reuse the same primary structured section extraction as their logical event family, then add raw-record metadata and expanded raw JSON. Conversation rows reuse Markdown body sections, protocol rows reuse protocol text/field sections, lifecycle rows reuse notice sections, and tool rows reuse command or patch sections. This keeps raw inspection faithful without falling back to duplicated scalar fields or generic payload blocks when a more specific renderer exists.

映射到已知语义事件的原始行会复用与其逻辑事件家族相同的主结构化区段提取，然后附加原始记录元数据和展开的原始 JSON。对话行复用 Markdown 正文区段，协议行复用协议文本/字段区段，生命周期行复用通知区段，工具行复用命令或补丁区段。这样原始检查既保持忠实，也不会在已有更具体渲染器时退回到重复标量字段或通用 payload 块。

Sections may set `hideTitle: true` when the section title only restates the event header, such as the primary `Message`, `Plan`, `Reasoning`, or protocol text body. Renderer implementations should keep titles visible for structural sections such as stdout/stderr, metadata tables, request/response payloads, patch files, and raw JSON summaries.

当区段标题只是重复事件标题时，例如主要的 `Message`、`Plan`、`Reasoning` 或协议文本正文，区段可以设置 `hideTitle: true`。渲染器实现应为 stdout/stderr、元数据表、请求/响应载荷、补丁文件和原始 JSON 摘要等结构性区段保留可见标题。

## API / contract changes / API / 契约变更

- `/api/sessions/:id/timeline` accepts `layer=main|protocol|raw` / `/api/sessions/:id/timeline` 接受 `layer=main|protocol|raw`
- `/api/sessions/:id/events/:eventId/detail?layer=main|protocol|raw` returns the structured detail DTO for one event / `/api/sessions/:id/events/:eventId/detail?layer=main|protocol|raw` 返回单个事件的结构化详情 DTO
- Main and protocol layers return logical events / 主层和协议层返回逻辑事件
- Raw layer returns raw-record DTOs / 原始层返回原始记录 DTO
- Event detail uses `rawRefs` so one logical event can expose multiple source rows / 事件详情使用 `rawRefs`，因此一个逻辑事件可以暴露多个来源行

## Alternatives considered / 已考虑的备选方案

### Render raw transcript rows directly / 直接渲染原始转录行

- Pros: simplest parser, minimal inference / 优点：解析器最简单，推断最少
- Cons: duplicates everywhere, protocol noise dominates, poor default reading experience / 缺点：到处重复，协议噪声占主导，默认阅读体验差
- Rejected because it breaks the product goal of readable repository history / 已拒绝，因为它破坏了让仓库历史可读的产品目标

### Hide duplicated channels without adding event layers / 不新增事件层，只隐藏重复通道

- Pros: smaller implementation change / 优点：实现改动更小
- Cons: protocol rows and plan artifacts still lack a stable place to live / 缺点：协议行和计划产物仍然缺少稳定归属
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
