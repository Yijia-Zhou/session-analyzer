# Code Mode adaptive single/multi-tool presentation / Code Mode 单工具与多工具自适应呈现

## Goal-ready objective / 可直接用于 `/goal` 的目标

Render a safely projected single-tool Code Mode Operation with that tool's ordinary structured body while keeping Code Mode and evidence provenance visible in the event header and inspector. Keep the current composite projection cards for multiple declared tools, label that presentation as a multi-tool Code Mode operation, and retain raw fallback for every uncertain program without changing canonical Logical Event identity, counts, search ownership, Raw refs, status, severity, escalation semantics, or Observed Nested Activity. / 对能够安全投影为单工具的 Code Mode Operation，使用该工具的普通结构化正文，同时在事件 header 与 inspector 中保留 Code Mode 和证据来源；多个声明工具继续使用当前复合投影卡片，并标为多工具 Code Mode 操作；所有不确定程序继续 raw fallback，且不改变 canonical 逻辑事件 identity、计数、搜索所有权、Raw refs、status、severity、提权语义或已观测嵌套活动。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-07-16 / 开始日期：2026-07-16
- Completed: 2026-07-16 / 完成日期：2026-07-16
- Related product spec: `docs/product-specs/session-transcript-analyzer.md` / 相关产品规格：`docs/product-specs/session-transcript-analyzer.md`
- Related design: `docs/design-docs/code-mode-operations.md` / 相关设计：`docs/design-docs/code-mode-operations.md`
- Display catalog: `docs/design-docs/code-mode-structured-display-catalog.md` / 显示目录：`docs/design-docs/code-mode-structured-display-catalog.md`

## Fixed decisions / 固定决定

1. Canonical fields remain `kind: other_tool_call`, `subtype: code_mode_operation`, and `toolName: exec`; adaptive behavior is presentation-only. / Canonical 字段继续保持 `kind: other_tool_call`、`subtype: code_mode_operation` 与 `toolName: exec`；自适应行为只属于 presentation。
2. A single-tool presentation is eligible only when whole-program static extraction succeeds and returns exactly one allowlisted declared request. / 只有整段程序静态提取成功且恰好返回一个 allowlist 内的声明 request 时，才允许单工具呈现。
3. Single-tool headers retain `Code Mode` and only actionable result evidence: `Inferred result` when a bounded result is displayed or `Unassociated output` when outer output stays separate. The native title already names the tool, so the redundant machine tool-name chip is omitted; request evidence, machine tool name, protocol channel, and Raw-ref count remain in the inspector. The tool title and tool name are display overrides, not execution facts or filter facets. / 单工具 header 保留 `Code Mode` 与仅具行动价值的结果证据：展示 bounded 结果时显示“推断结果”，outer output 保持分离时显示“未关联输出”。原生标题已经命名工具，因此省略重复的机器工具名 chip；request evidence、机器工具名、协议 channel 与 Raw-ref 数量继续留在 inspector。工具标题和工具名称只是显示 override，不是执行事实或筛选 facet。
4. A single tool's outer JavaScript, operation metadata, and wait trace move to inspector detail. Any unassociated final output remains in the timeline and is never presented as the tool's result. / 单工具的 outer JavaScript、operation metadata 与 wait trace 移入 inspector；任何未关联 final output 继续留在时间线，且绝不冒充该工具的结果。
5. Two or more safe declarations keep projection wrappers and use the presentation label `Multi-tool Code Mode operation / 多工具代码模式操作`, one compact tool count, no redundant Code Mode chip, and an inferred-result warning only when projected results are displayed. / 两个及以上安全声明继续使用投影 wrapper，并显示 `Multi-tool Code Mode operation / 多工具代码模式操作`、一个紧凑工具数量，不重复代码模式 chip，且只有展示投影结果时才显示推断结果警示。
6. Unsupported or uncertain JavaScript keeps the existing raw command/output/trace presentation and does not receive a single, multiple, or complex classification. / 不受支持或不确定的 JavaScript 继续使用现有 raw command/output/trace 呈现，不获得 single、multiple 或 complex 分类。
7. Detail-only parsing remains lazy. Visible Code Mode cards may lazily load detail to refine their presentation header; cold indexing does not run the AST projector. / 解析继续只发生在惰性详情阶段。可见 Code Mode 卡片可以惰性加载详情以细化 header；冷索引不运行 AST projector。

## Execution phases / 执行阶段

### Phase 1: contract and DTO / 第一阶段：contract 与 DTO

- Add a bounded presentation descriptor with `single_tool | multi_tool | raw_code_mode`, localized label, display tool, declared count, request evidence, and result association. / 增加受限 presentation descriptor，包含 `single_tool | multi_tool | raw_code_mode`、本地化 label、显示工具、声明数量、request evidence 与 result association。
- Document the adaptive user-visible behavior in the product spec, canonical design, and display catalog. / 在产品规格、canonical 设计与显示目录中记录自适应用户可见行为。

### Phase 2: detail composition / 第二阶段：详情组成

- Unwrap a single projection into its existing structured request/result sections. / 把单个投影解包为既有的结构化 request/result sections。
- Keep command and terminal output adjacent; move run context/result metadata to inspector when needed to preserve the ordinary command-run region. / 保持 command 与 terminal output 相邻；必要时把运行 context/result metadata 移入 inspector，以保留普通 command-run 区域。
- Move single-tool Code Mode source and wait trace to inspector while retaining unassociated final output in the timeline. / 把单工具 Code Mode source 与 wait trace 移入 inspector，同时在时间线保留未关联 final output。

### Phase 3: browser presentation / 第三阶段：浏览器呈现

- Apply the presentation-only label and a compact chip budget after detail loads: single-tool Code Mode plus actionable result evidence and tool name; multi-tool count plus actionable result evidence. / 详情加载后应用仅 presentation 的 label 与紧凑 chip 预算：单工具显示代码模式、具行动价值的结果证据与工具名；多工具显示数量与具行动价值的结果证据。
- Lazily request detail for visible Code Mode events even when folded, without eagerly parsing the full session. / 即使折叠，也为可见 Code Mode event 惰性请求详情，但不提前解析整个 session。
- Keep raw fallback indistinguishable from the existing canonical operation header until structure is safely known. / 在结构被安全确认前，让 raw fallback 保持既有 canonical operation header。

### Phase 4: validation and close / 第四阶段：验收与收口

- Cover single bounded, single unassociated, single wait, multi bounded, and raw fallback detail DTOs in both locales. / 使用双语 detail DTO 覆盖单工具 bounded、单工具 unassociated、单工具 wait、多工具 bounded 与 raw fallback。
- Cover browser header/body behavior, canonical metrics, search owner, Raw-ref ownership, and independently visible nested lifecycle events. / 覆盖浏览器 header/body、canonical 指标、搜索 owner、Raw-ref 所有权与独立可见的 nested lifecycle event。
- Run Node, browser, package, build, build-check, and diff-check gates; move this plan to `completed/` only when all behavior ships. / 运行 Node、browser、package、build、build-check 与 diff-check 门禁；只有全部行为交付后才把本计划移入 `completed/`。

## Acceptance criteria / 验收标准

1. A single safe `update_plan`, command, patch, user-input, collaboration, image, goal, MCP, plugin, or web declaration has no `code_mode_tool_projection` wrapper in its timeline body. / 单个安全的 `update_plan`、command、patch、user-input、collaboration、image、goal、MCP、plugin 或 web 声明在时间线正文中没有 `code_mode_tool_projection` wrapper。
2. Its header visibly retains Code Mode plus declared-request and association evidence, while its canonical DTO remains an `exec` Code Mode operation. / 其 header 明确保留 Code Mode、声明 request 与关联证据，而 canonical DTO 仍是 `exec` Code Mode operation。
3. Multiple safe declarations retain one wrapper per declaration, one operation count, and a multi-tool presentation label with declared count. / 多个安全声明继续每个声明拥有一个 wrapper，只计一个 operation，并显示带声明数量的多工具呈现 label。
4. Unassociated output remains primary operation output and is not placed under a tool Result label. / 未关联 output 继续作为主要 operation output，不放入工具 Result 标签下。
5. Raw fallback, event counts, tool usage, search targets, Raw refs, event refs, and neutral status are unchanged. / Raw fallback、事件计数、tool usage、搜索 targets、Raw refs、event refs 与中性 status 保持不变。
6. English and Simplified Chinese presentation labels are complete and machine values remain untranslated. / 英文与简体中文 presentation label 完整，机器值保持不翻译。

## Progress log / 进度日志

- 2026-07-16: Accepted the adaptive-presentation direction with canonical semantics unchanged and opened implementation. / 2026-07-16：接受 canonical 语义不变的自适应呈现方向，并开始实现。
- 2026-07-16: Shipped the detail presentation descriptor, native single-tool body, multi-tool composite label, bilingual UI, lazy visible-header refinement, fixtures, and browser coverage. Node (226), browser (52), package, build-check, diff-check, and real-session Playwright acceptance all passed. / 2026-07-16：完成 detail presentation descriptor、单工具原生正文、多工具复合标签、双语 UI、可见 header 惰性细化、fixtures 与浏览器覆盖。Node（226）、browser（52）、package、build-check、diff-check 以及真实会话 Playwright 验收全部通过。
- 2026-07-16: Reduced Code Mode header chips without removing inspector evidence: removed duplicate request evidence, protocol channel, and Raw-ref count; removed the redundant multi-tool Code Mode chip; shortened bounded association to `Inferred result`; and kept only actionable association warnings. / 2026-07-16：在不删除 inspector 证据的前提下精简 Code Mode header chip：移除重复的 request evidence、协议 channel 与 Raw-ref 数量，移除多工具重复的代码模式 chip，将 bounded 关联缩短为“推断结果”，并只保留具行动价值的关联警示。
- 2026-07-16: Removed the single-tool machine tool-name chip because the native event title already communicates the same tool identity; raw fallback retains `exec` because its title does not name an underlying tool. / 2026-07-16：移除单工具机器工具名 chip，因为原生事件标题已经表达相同工具身份；raw fallback 的标题没有命名底层工具，因此继续保留 `exec`。
- 2026-07-16: Added the accepted `web__run` baseline: grouped request operations, safe Markdown terminal results, and presentation-only compression of uniquely associated canonical web lifecycle events. Canonical layer, counts, search ownership, status, and Raw refs remain unchanged. / 2026-07-16：加入已接受的 `web__run` 基础版：分组 request operation、安全 Markdown 终态结果，以及对唯一关联 canonical web lifecycle event 的纯 presentation 压缩。Canonical layer、计数、搜索所有权、status 与 Raw refs 保持不变。
- 2026-07-16: Revalidated the complete change with Node (227), browser (53), package smoke, build-check, and diff-check. Luna Playwright acceptance confirmed grouped web requests and compact lifecycle rows in a real session without console or layout defects; rich Markdown remained covered by the safe-link browser fixture because the real sample returned empty results. / 2026-07-16：使用 Node（227）、browser（53）、package smoke、build-check 与 diff-check 重新验收完整变更。Luna Playwright 在真实会话中确认了分组网页 request 与紧凑 lifecycle 行，且未发现控制台或布局缺陷；由于真实样本返回空结果，富 Markdown 继续由安全链接浏览器 fixture 覆盖。
- 2026-07-17: Review follow-up separated absent output from observed-but-unassociated output in the presentation descriptor and preserved numeric shell timeouts with nullish alias precedence. Added browser coverage for request-only headers and detail coverage for numeric timeout projection. / 2026-07-17：Review follow-up 在 presentation descriptor 中区分“没有 output”与“已观测但未关联的 output”，并通过 nullish alias 优先级保留数值 shell timeout；新增 request-only header 的浏览器覆盖与数值 timeout 投影的详情覆盖。
