# Codex Protocol Event Coverage Follow-Up / Codex 协议事件覆盖后续

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: active / 状态：进行中
- Last updated: 2026-05-21 / 最近更新：2026-05-21
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design: / 相关设计：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`

## Objective / 目标

Improve parser coverage for the highest-value Codex `event_msg` variants while keeping the viewer permissive and lossless for unknown future protocol events.

补强最有价值的 Codex `event_msg` variant 解析，同时让查看器继续对未知未来协议事件保持宽松且无损。

## Scope / 范围

### In scope / 范围内
- Normalize lifecycle aliases such as `turn_started` and `turn_complete`. / 归一化 `turn_started`、`turn_complete` 等生命周期别名。
- Extract current protocol metadata from `session_configured`, while preserving the first-`session_meta` identity rule. / 从 `session_configured` 提取当前协议元数据，同时保留第一条 `session_meta` 身份规则。
- Preserve legacy `thread_name_updated` title compatibility and parse `thread_goal_updated` separately as goal metadata. / 保留旧 `thread_name_updated` 标题兼容，并将 `thread_goal_updated` 单独解析为 goal metadata。
- Surface warning/error protocol events with meaningful severity. / 以有意义的严重级别展示 warning/error 协议事件。
- Treat protocol-shaped `plan_update` and `plan_delta` as planning events. / 将协议形态的 `plan_update` 和 `plan_delta` 作为 planning events 处理。
- Improve incomplete tool-family coverage for begin/update/delta/declined shapes. / 改进 begin/update/delta/declined 形态的不完整工具事件覆盖。
- Add focused synthetic fixtures and tests for the protocol shapes above. / 为上述协议形态添加聚焦的合成 fixture 和测试。

### Out of scope / 范围外
- Exhaustive modeling of every current or future `EventMsg` variant. / 穷尽建模每个当前或未来 `EventMsg` variant。
- Runtime dependency on generated upstream JSON schema. / 在运行时依赖上游生成的 JSON schema。
- Product-level workflow changes beyond clearer event placement, labels, severity, and metrics. / 除更清晰的事件归属、标签、严重级别和指标之外的产品级工作流变化。
- UI redesign unrelated to displaying these protocol events. / 与展示这些协议事件无关的 UI 重新设计。

## Repository Context / 仓库背景

- Parser and logical-event builder: `src/codex.js` / 解析器和逻辑事件构建器：`src/codex.js`
- Folding profile data: `src/folding.js` and mirrored frontend defaults in `public/app.js` / 折叠策略数据：`src/folding.js` 以及 `public/app.js` 中的前端镜像默认值
- Backend parser tests: `test/codex.test.js` / 后端解析器测试：`test/codex.test.js`
- Synthetic transcript fixtures: `test/fixtures/codex-home/sessions/...` / 合成转录 fixture：`test/fixtures/codex-home/sessions/...`

## Invariants / 不变量

- Unknown `event_msg` variants must remain visible through protocol/raw layers. / 未知 `event_msg` variant 必须继续通过 protocol/raw 层可见。
- Raw JSONL drill-down must remain available for every logical event and raw row. / 每个逻辑事件和原始行都必须继续支持原始 JSONL 下钻。
- Main timeline must not regress into duplicated mirrored user, assistant, reasoning, plan, or tool rows. / 主时间线不能退化为重复展示镜像的用户、助手、推理、计划或工具行。
- Historical transcripts without newer end events must remain readable. / 缺少较新 end 事件的历史转录必须保持可读。
- Session identity must not be overwritten by embedded parent metadata in forked/subagent transcripts. / fork/subagent 转录中的嵌入父元数据不得覆盖 session identity。

## Milestones / 里程碑

### Milestone 1 - Metadata and Lifecycle / 里程碑 1 - 元数据与生命周期
#### Changes / 变更
- Add an internal canonical event-type helper that maps `turn_started` to `task_started` and `turn_complete` to `task_complete`, while keeping raw `payloadType` unchanged. / 增加内部 canonical event-type helper，将 `turn_started` 映射为 `task_started`、`turn_complete` 映射为 `task_complete`，同时保持原始 `payloadType` 不变。
- Use `session_configured.thread_name` as a current title source and `session_configured.cwd` for project discovery/session matching. / 使用 `session_configured.thread_name` 作为当前标题来源，并用 `session_configured.cwd` 做项目发现和 session 匹配。
- Fill parent/subagent metadata from `session_configured` only when the established first-`session_meta` rule has not already supplied it. / 仅当既有第一条 `session_meta` 规则尚未提供时，才从 `session_configured` 补充 parent/subagent 元数据。
- Keep legacy `thread_name_updated` title compatibility; handle `thread_goal_updated` as protocol goal metadata with readable preview/search/detail. / 保留旧 `thread_name_updated` 标题兼容；把 `thread_goal_updated` 作为协议 goal metadata 处理，提供可读预览、搜索和详情。

#### Validation / 验证
- Fixture assertions for title inference, project discovery, lifecycle alias placement, and goal metadata detail. / 为标题推断、项目发现、生命周期别名归属和 goal metadata 详情添加 fixture 断言。

#### Exit criteria / 退出标准
- Current protocol metadata improves session discovery and titles without changing session identity semantics. / 当前协议元数据能改进 session 发现和标题，同时不改变 session identity 语义。

### Milestone 2 - Severity and Planning / 里程碑 2 - 严重级别与计划
#### Changes / 变更
- Surface `warning`, `guardian_warning`, and `stream_error` as main timeline events with warning/error severity and structured details. / 将 `warning`、`guardian_warning` 和 `stream_error` 作为带 warning/error 严重级别和结构化详情的 main timeline 事件展示。
- Keep `deprecation_notice`, model reroute, and model verification in protocol by default unless fixtures show a main-timeline need. / 默认将 `deprecation_notice`、model reroute 和 model verification 留在 protocol，除非 fixture 显示它们需要进入 main timeline。
- Add main-layer planning events for `plan_update` and `plan_delta`, distinct from full proposed-plan artifacts. / 为 `plan_update` 和 `plan_delta` 增加 main 层 planning events，并与完整 proposed-plan artifact 区分。
- Update plan metrics, planning folding behavior, frontend labels, important-event predicates, and selected-event navigation matching for the new planning/severity kinds. / 为新的 planning/severity kind 更新计划指标、planning 折叠行为、前端标签、important-event predicate 和选中事件跳转匹配。

#### Validation / 验证
- Fixture assertions for main/protocol placement, event severity, plan counts, planning timeline filters, and detail sections. / 为 main/protocol 归属、事件严重级别、计划计数、planning 时间线筛选和详情区段添加 fixture 断言。

#### Exit criteria / 退出标准
- Users can see warnings and protocol-shaped plan updates without opening raw records, and plan metrics count both artifacts and updates. / 用户无需打开 raw records 就能看到 warning 和协议形态的计划更新，且计划指标同时统计 artifact 和 update。

### Milestone 3 - Tool-Family Incomplete Records / 里程碑 3 - 工具族不完整记录
#### Changes / 变更
- Group exec, patch, MCP, image generation, dynamic tool, approval, hook, and collaboration begin/end rows by `call_id` where present. / 对 exec、patch、MCP、图像生成、dynamic tool、approval、hook 和 collaboration begin/end 行在存在 `call_id` 时按调用分组。
- Prefer complete end payloads when present, but show begin/update/delta-only rows as incomplete tool events instead of generic protocol noise. / 存在完整 end payload 时优先使用；但只有 begin/update/delta 的行应显示为 incomplete tool events，而不是泛化协议噪声。
- Tighten command and patch status semantics: `failed` and nonzero exit code are failures, `declined` is not success, and missing exit code alone does not override explicit protocol status. / 收紧 command 和 patch 状态语义：`failed` 和非零 exit code 是失败，`declined` 不是成功，缺失 exit code 本身不得覆盖明确协议状态。

#### Validation / 验证
- Fixture assertions for begin-only tool records, declined command/patch status, grouped raw refs, status labels, and search text. / 为 begin-only 工具记录、declined command/patch 状态、分组 raw refs、状态标签和搜索文本添加 fixture 断言。

#### Exit criteria / 退出标准
- Interrupted or incomplete tool records remain readable and searchable without misreporting declined actions as successful. / 中断或不完整工具记录保持可读、可搜索，且不会把 declined 动作误报为成功。

### Milestone 4 - Documentation and Closure / 里程碑 4 - 文档与收尾
#### Changes / 变更
- Update `docs/design-docs/codex-protocol-event-coverage.md` and `docs/design-docs/logical-event-timeline.md` for any decisions that differ from the current design notes. / 若实现决策与当前设计说明不同，更新 `docs/design-docs/codex-protocol-event-coverage.md` 和 `docs/design-docs/logical-event-timeline.md`。
- Update `docs/exec-plans/tech-debt-tracker.md` to remove or narrow any risks closed by this work. / 更新 `docs/exec-plans/tech-debt-tracker.md`，移除或收窄本工作关闭的风险。
- Move this plan to `completed/` only after implementation and validation finish. / 只有实现和验证完成后，才将本计划移到 `completed/`。

#### Validation / 验证
- Documentation references remain bilingual and point to the final plan location after completion. / 文档引用保持双语，并在完成后指向最终计划位置。

#### Exit criteria / 退出标准
- The design docs, active/completed plan state, and tech-debt tracker accurately describe the shipped behavior. / 设计文档、active/completed 计划状态和技术债跟踪器准确描述已交付行为。

## Validation Checklist / 验证清单
- [ ] `node --test`
- [ ] `node --check src\codex.js`
- [ ] `node --check public\app.js`
- [ ] `node --check public\renderers.js`
- [ ] `git diff --check`
- [ ] Manual browser spot-check against the synthetic fixture session if UI labels or folding behavior change. / 如果 UI 标签或折叠行为变化，针对合成 fixture session 做浏览器人工抽查。

## Rollback Notes / 回滚说明

- If a normalization rule hides important history or causes duplicate logical events, route that event family back to protocol fallback while keeping raw rows unchanged. / 如果某条归一化规则隐藏重要历史或导致重复逻辑事件，将该事件族临时路由回 protocol fallback，同时保持 raw 行不变。
- Avoid deleting older parser paths until fixture coverage confirms the replacement handles both old and current transcript shapes. / 在 fixture 覆盖确认替代逻辑同时处理旧转录和当前转录形态之前，避免删除旧解析路径。
- New main-layer kinds should be isolated enough that frontend label/folding changes can be reverted independently of raw parsing. / 新增 main 层 kind 应保持足够隔离，使前端标签/折叠变更可以独立于 raw parsing 回滚。

## Progress Log / 进度日志

- 2026-05-21: Created this active plan from the protocol event coverage design notes. No implementation changes have been started. / 2026-05-21：根据协议事件覆盖设计说明创建本 active plan。尚未开始实现改动。
