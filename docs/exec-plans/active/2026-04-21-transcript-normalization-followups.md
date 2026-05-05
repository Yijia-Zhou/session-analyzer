# Transcript Normalization Follow-Ups / 转录归一化后续工作

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: active / 状态：活跃
- Last updated: 2026-05-05 / 最近更新：2026-05-05
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design: / 相关设计：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/documentation-system.md`
- Related completed plan: / 相关已完成计划：
  - `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md`

## Objective / 目标

Stabilize the new logical-event timeline so the main/protocol/raw layers are easier to trust and easier to maintain.

稳定新的逻辑事件时间线，让 main/protocol/raw 三层更容易信任，也更容易维护。

## Scope / 范围

### In scope / 范围内
- Refine protocol subtype labels and summaries / 细化协议子类型标签和摘要
- Improve session title inference / 改进会话标题推断
- Reduce noise from empty reasoning rows in the protocol layer / 减少协议层中空推理行带来的噪声
- Add targeted fixture coverage for more historical transcript shapes / 为更多历史转录形态添加有针对性的 fixture 覆盖
- Document current normalization gaps / 记录当前归一化缺口
- Upgrade expanded timeline cards from preview-only text to structured field-level detail rendering / 将展开时间线卡片从仅预览文本升级为结构化字段级详情渲染

### Out of scope / 范围外
- LLM summarization / LLM 摘要
- Persistent indexing / 持久索引
- Multi-user deployment / 多用户部署
- Event inspector UX, search result chrome, failure navigation, and narrow-screen layout work tracked by `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md` / 由 `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md` 跟踪的事件检查器 UX、搜索结果界面、失败导航和窄屏布局工作

## Repository context / 仓库背景

- Backend parser: `src/codex.js` / 后端解析器：`src/codex.js`
- HTTP API: `server.js` / HTTP API：`server.js`
- Frontend timeline rendering: `public/app.js` / 前端时间线渲染：`public/app.js`
- Current tests: `test/codex.test.js` / 当前测试：`test/codex.test.js`
- Fixture transcripts: `test/fixtures/codex-home/sessions/...` / 转录 fixture：`test/fixtures/codex-home/sessions/...`

## Invariants / 不变量

- Raw JSONL drill-down must remain available / 原始 JSONL 下钻必须保持可用
- Main timeline must not regress into duplicate user/assistant messages / 主时间线不能退化为重复的用户/助手消息
- Historical transcripts without newer `event_msg:*_end` rows must remain readable / 没有较新 `event_msg:*_end` 行的历史转录必须保持可读
- No transcript files are mutated / 不变更任何转录文件

## Current remaining focus / 当前剩余焦点

- Finish protocol label and summary quality within the normalization model, especially protocol subtype names that should be understandable without opening raw JSON. / 在归一化模型内完成协议标签和摘要质量改进，尤其是无需打开原始 JSON 就能理解的协议子类型名称。
- Finish session title and summary hygiene so fallback titles avoid protocol-heavy or malformed transcript text. / 完成会话标题和摘要卫生，使回退标题避免协议过重或格式异常的转录文本。
- Reduce low-information empty reasoning rows in the protocol layer without hiding unknown transcript shapes. / 减少协议层中低信息量的空 reasoning 行，同时不隐藏未知转录形态。
- Add historical fixtures for transcript shapes that affect normalization, not for purely visual UX behavior. / 为影响归一化的历史转录形态添加 fixture，而不是为纯视觉 UX 行为添加 fixture。
- Keep expanded-detail structured rendering here only when it depends on `EventDetailDto` extraction or renderer correctness. / 只有当展开详情结构化渲染依赖 `EventDetailDto` 提取或渲染器正确性时，才继续在本计划中跟踪。

## Milestones / 里程碑

### Milestone 1 - Label quality / 里程碑 1 - 标签质量
#### Changes / 变更
- Replace placeholder protocol labels such as `agents instructions` / 替换 `agents instructions` 等占位协议标签
- Give plan artifacts and protocol records more legible summaries / 为计划产物和协议记录提供更易读的摘要

#### Validation / 验证
- Manually inspect the first protocol events from a real local session / 手动检查真实本地会话中的首批协议事件
- Confirm labels are readable in the browser and API payloads / 确认标签在浏览器和 API 载荷中可读

#### Exit criteria / 退出标准
- Protocol layer labels explain what the event is without opening raw JSON / 协议层标签无需打开原始 JSON 即可说明事件是什么

### Milestone 2 - Title and summary hygiene / 里程碑 2 - 标题和摘要卫生
#### Changes / 变更
- Tighten session title fallback rules / 收紧会话标题回退规则
- Avoid protocol-heavy or garbled titles when no thread name exists / 在线程名称不存在时，避免协议过重或乱码标题

#### Validation / 验证
- Run a local index build against a real `.codex` directory / 针对真实 `.codex` 目录运行本地索引构建
- Inspect the session list for current repository sessions / 检查当前仓库会话的会话列表

#### Exit criteria / 退出标准
- Session titles are stable enough for browsing and search / 会话标题足够稳定，可用于浏览和搜索

### Milestone 3 - Historical transcript coverage / 里程碑 3 - 历史转录覆盖
#### Changes / 变更
- Add more fixtures for web search, old shell formats, protocol wrappers, and plan artifacts / 为 Web 搜索、旧 shell 格式、协议包装器和计划产物添加更多 fixture
- Expand tests for raw/protocol/main layer filtering / 扩展 raw/protocol/main 层筛选测试

#### Validation / 验证
- `node --test`

#### Exit criteria / 退出标准
- Known transcript shapes are represented in tests / 已知转录形态在测试中有表示

### Milestone 4 - Expanded detail reading quality / 里程碑 4 - 展开详情阅读质量
#### Changes / 变更
- Hide timeline preview text when a card is expanded so the card reads as preview-or-body, not preview-plus-body. / 卡片展开时隐藏时间线预览文本，使卡片读起来是“预览或正文”，而不是“预览加正文”。
- Treat `markdown-it` as a required dependency and keep a lockfile so Markdown rendering does not silently degrade. / 将 `markdown-it` 视为必需依赖，并保留 lockfile，避免 Markdown 渲染静默降级。
- Add Markdown fixture coverage for headings, tables, lists, raw HTML escaping, and dangerous link filtering. / 为标题、表格、列表、原始 HTML 转义和危险链接过滤添加 Markdown fixture 覆盖。
- Style Markdown block elements for readable expanded cards. / 为 Markdown 块级元素添加样式，使展开卡片可读。
- Avoid duplicate command output sections when stdout/stderr cannot be parsed as JSON or diff. / 当 stdout/stderr 无法解析为 JSON 或 diff 时，避免重复命令输出区段。
- Collapse `raw_json` sections by default outside the raw layer while keeping right-pane raw refs available. / 在原始层之外默认折叠 `raw_json` 区段，同时保持右侧面板原始引用可用。
- Limit detail loading to visible expanded cards, while loading immediately for user-triggered expansion. / 将详情加载限制在可见的展开卡片，同时对用户触发的展开立即加载。
- Hide low-information section titles when they only repeat the event header while preserving structural titles for metadata, streams, payloads, and raw JSON. / 当低信息量区段标题只重复事件标题时隐藏它们，同时保留元数据、流、载荷和原始 JSON 的结构性标题。

#### Validation / 验证
- `node test\codex.test.js`
- `node test\renderers.test.js`
- `node --check public\app.js`
- `node --check public\renderers.js`
- `node --check server.js`
- `node --check src\codex.js`

#### Exit criteria / 退出标准
- User/assistant Markdown messages render as structured Markdown in expanded cards. / 用户/助手 Markdown 消息在展开卡片中渲染为结构化 Markdown。
- Expanded cards no longer repeat truncated preview text above the full body. / 展开卡片不再在完整正文上方重复截断预览文本。
- Raw JSON remains available without dominating the main reading flow. / 原始 JSON 仍然可用，但不会主导主阅读流程。

## Validation checklist / 验证清单
- [x] Syntax checks pass / 语法检查通过
- [x] Tests pass / 测试通过
- [x] Main timeline stays deduplicated / 主时间线保持去重
- [x] Protocol layer remains accessible / 协议层保持可访问
- [x] Raw refs still open all underlying JSONL rows / 原始引用仍能打开所有底层 JSONL 行

## Rollback notes / 回滚说明

- If normalization changes hide important history, keep the raw layer unchanged and temporarily route affected cases back to protocol instead of main. / 如果归一化变更隐藏了重要历史，保持原始层不变，并临时将受影响场景路由回协议层而不是主层。
- Avoid deleting older fallback parsing paths until fixture coverage exists. / 在 fixture 覆盖存在之前，避免删除较旧的回退解析路径。

## Progress log / 进度日志

- 2026-04-21: Added logical-event normalization, protocol layer, raw layer, and tool-call grouping. / 2026-04-21：添加逻辑事件归一化、协议层、原始层和工具调用分组。
- 2026-04-21: Added fixture coverage for duplicated messages, protocol injections, and old/new patch formats. / 2026-04-21：为重复消息、协议注入以及新旧补丁格式添加 fixture 覆盖。
- 2026-04-21: Documentation system scaffolded for this repository. / 2026-04-21：为本仓库搭建文档系统脚手架。
- 2026-04-21: Added `/api/sessions/:id/events/:eventId/detail`, section-based detail extraction, inline expanded-body rendering, and renderer tests. / 2026-04-21：添加 `/api/sessions/:id/events/:eventId/detail`、基于区段的详情提取、内联展开正文渲染和渲染器测试。
- 2026-05-03: Tracking expanded-detail reading quality follow-up after finding preview/body duplication and silent Markdown fallback in the web UI. / 2026-05-03：在 Web UI 中发现预览/正文重复和 Markdown 静默回退后，跟踪展开详情阅读质量后续工作。
- 2026-05-03: Implemented preview/body separation, required `markdown-it` lockfile, Markdown fixture coverage, Markdown styles, command output de-duplication, collapsible `raw_json`, and visible-card detail loading. / 2026-05-03：实现预览/正文分离、必需的 `markdown-it` lockfile、Markdown fixture 覆盖、Markdown 样式、命令输出去重、可折叠 `raw_json` 和可见卡片详情加载。
- 2026-05-03: Added `hideTitle` section rendering rule for redundant primary body titles such as Message, Plan, Reasoning, lifecycle notices, and protocol text. / 2026-05-03：为 Message、Plan、Reasoning、生命周期通知和协议文本等冗余主正文标题添加 `hideTitle` 区段渲染规则。
- 2026-05-04: Split event-inspector, search-feedback, failure-navigation, and narrow-screen UX work into `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md`, keeping this plan focused on transcript normalization and structured detail extraction. / 2026-05-04：将事件检查器、搜索反馈、失败导航和窄屏 UX 工作拆分到 `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md`，使本计划继续聚焦转录归一化和结构化详情提取。
- 2026-05-04: Added protocol subtype display metadata and fixture assertions for readable AGENTS.md, developer permissions, environment context, session metadata, and turn context labels/previews. / 2026-05-04：为协议子类型添加展示元数据，并为 AGENTS.md、开发者权限、环境上下文、会话元数据和 turn context 的可读标签/预览添加 fixture 断言。
- 2026-05-04: Aligned raw semantic-row detail rendering with existing protocol, lifecycle, conversation, command, and patch structured sections, reducing generic `Message`/`Payload` fallback use when a specific renderer exists. / 2026-05-04：将原始语义行详情渲染与现有协议、生命周期、对话、命令和补丁结构化区段对齐，在存在专用渲染器时减少通用 `Message`/`Payload` 回退使用。
- 2026-05-05: Added compatible patch change-stat parsing for legacy `additions`/`deletions`, newer `unified_diff`/`content` change records, and old apply_patch output-only transcripts; fixed failed verification output being labeled as `Patch applied`. / 2026-05-05：为旧版 `additions`/`deletions`、新版 `unified_diff`/`content` 变更记录，以及只有 apply_patch 输出的旧转录添加兼容的补丁改动统计解析；修正校验失败输出被标记为 `Patch applied` 的问题。

- 2026-05-05: Fixed forked subagent session identity so embedded parent `session_meta` rows no longer overwrite the child session id; added subagent metadata in session summaries and fixture coverage for separate selection. / 2026-05-05：修复 fork 子 agent 会话身份，使嵌入的父会话 `session_meta` 行不再覆盖子会话 id；在会话摘要中加入子 agent 元数据，并添加可单独选择的 fixture 覆盖。
## Decision log / 决策日志

- 2026-04-21: Kept active follow-up work in a separate plan instead of rewriting the completed baseline plan. / 2026-04-21：将活跃后续工作保留在单独计划中，而不是重写已完成的基线计划。

## Completion summary / 完成摘要

Pending.

待完成。
