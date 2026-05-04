# Viewer UX Inspector and Search / 查看器 UX 检查器与搜索

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Last updated: 2026-05-04 / 最近更新：2026-05-04
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design: / 相关设计：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/documentation-system.md`
- Related active plan: / 相关活跃计划：
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

## Objective / 目标

Improve the browser UX around event inspection, search feedback, same-category event navigation, and narrow-screen use without changing the transcript normalization model.

在不改变转录归一化模型的前提下，改进浏览器中的事件检查、搜索反馈、同类事件导航和窄屏使用体验。

## Scope / 范围

### In scope / 范围内
- Upgrade the right-side pane from raw-only detail into an event inspector that can show selected-event summary, metadata, structured sections, and raw refs. / 将右侧面板从仅显示原始详情升级为事件检查器，可显示选中事件摘要、元数据、结构化区段和原始引用。
- Add clearer search and filter feedback, including result counts, active-filter state, and easier filter clearing. / 添加更清晰的搜索和筛选反馈，包括结果数量、当前筛选状态和更容易清空筛选的入口。
- Improve same-category event navigation for repeated reading and debugging workflows, including user messages, update_plan calls, patches, failed commands, and other useful event groups. / 改进面向连续阅读和排查工作流的同类事件导航，包括用户消息、update_plan 调用、patch、失败命令以及其他有用事件组。
- Improve narrow-screen browsing so session selection, timeline reading, and event detail are not forced into one long document flow. / 改进窄屏浏览，使会话选择、时间线阅读和事件详情不再被迫挤进一个很长的文档流。
- Keep existing raw JSONL drill-down behavior available. / 保持现有原始 JSONL 下钻行为可用。

### Out of scope / 范围外
- Changing logical-event normalization rules / 改变逻辑事件归一化规则
- LLM-generated summaries / LLM 生成摘要
- Persistent indexing or saved user annotations / 持久索引或保存用户标注
- Multi-user hosted analytics / 多用户托管分析

## Repository context / 仓库背景

- Frontend app state and event wiring: `public/app.js` / 前端应用状态和事件绑定：`public/app.js`
- Frontend layout and responsive rules: `public/styles.css` / 前端布局和响应式规则：`public/styles.css`
- Structured section renderers: `public/renderers.js` / 结构化区段渲染器：`public/renderers.js`
- Event detail API: `server.js` and `src/codex.js` / 事件详情 API：`server.js` 和 `src/codex.js`
- Renderer tests: `test/renderers.test.js` / 渲染器测试：`test/renderers.test.js`
- Parser/API tests: `test/codex.test.js` / 解析器和 API 测试：`test/codex.test.js`

## Invariants / 不变量

- Raw refs must continue to show all underlying JSONL rows. / 原始引用必须继续显示所有底层 JSONL 行。
- Main, protocol, and raw layers must remain available. / main、protocol 和 raw 三层必须保持可用。
- The viewer must not mutate transcript files. / 查看器不得变更转录文件。
- UX changes must not require external services. / UX 改动不得依赖外部服务。
- Any API contract change must be reflected in the product spec or logical-event design doc. / 任何 API 契约变更都必须反映到产品规格或逻辑事件设计文档中。

## Milestones / 里程碑

### Milestone 1 - Inspector foundation / 里程碑 1 - 检查器基础
#### Changes / 变更
- Make ordinary event selection populate the right-side pane with a concise selected-event header and metadata. / 让普通事件选择也能在右侧面板填充简洁的选中事件标题和元数据。
- Keep `Raw refs` as an explicit raw-source view inside the inspector. / 将 `Raw refs` 保持为检查器中的显式原始来源视图。
- Clarify the empty-state copy so users know when the pane shows selection detail versus raw rows. / 澄清空状态文案，让用户知道面板何时显示选中详情、何时显示原始行。

#### Validation / 验证
- `node --check public\app.js`
- `node --check public\renderers.js`
- Manual browser verification on a real local session / 在真实本地会话上手动浏览器验证

#### Exit criteria / 退出标准
- Clicking an event and clicking `Raw refs` have distinct, understandable right-pane results. / 点击事件和点击 `Raw refs` 会产生不同且可理解的右侧面板结果。

### Milestone 2 - Search and filter feedback / 里程碑 2 - 搜索和筛选反馈
#### Changes / 变更
- Show current session-result and event-result counts for active search/filter state. / 针对当前搜索和筛选状态显示会话结果数和事件结果数。
- Show active filters as clearable state, not only as values buried in controls. / 将当前筛选显示为可清除状态，而不只是埋在控件值里。
- Preserve existing search semantics unless a separate API change is documented. / 除非单独记录 API 变更，否则保持现有搜索语义。

#### Validation / 验证
- `node --test`
- `node --check public\app.js`
- Manual search checks for message text, command text, file paths, and output strings / 手动检查消息文本、命令文本、文件路径和输出字符串搜索

#### Exit criteria / 退出标准
- A user can tell how many sessions and events match the current query without inferring from list length. / 用户无需从列表长度推断，即可知道当前查询匹配多少会话和事件。

### Milestone 3 - Same-category quick navigation / 里程碑 3 - 同类事件快速导航
#### Changes / 变更
- Add right-side inspector controls to jump between events in useful reading categories within the current filtered result set. / 在右侧检查器中添加控件，用于在当前过滤结果集内按有用阅读类别跳转事件。
- Cover user messages, assistant messages, plans/update_plan calls, commands, failed commands, patch applied/failed, errors/warnings, MCP calls, and web searches. / 覆盖用户消息、助手消息、计划/update_plan 调用、命令、失败命令、patch 成功/失败、错误/警告、MCP 调用和 web 搜索。
- Keep navigation frontend-only by reusing existing timeline payload fields and loading additional timeline pages as needed. / 复用现有时间线载荷字段并在需要时加载额外时间线页，使导航保持前端实现。

#### Validation / 验证
- `node --test`
- Manual verification using sessions with multiple user messages, update_plan calls, patches, and failed commands / 使用包含多个用户消息、update_plan 调用、patch 和失败命令的会话手动验证

#### Exit criteria / 退出标准
- A user can move through repeated same-category events without repeatedly changing filters or scrolling manually. / 用户无需反复调整筛选或手动滚动，即可在重复出现的同类事件之间移动。

### Milestone 4 - Narrow-screen workflow / 里程碑 4 - 窄屏工作流
#### Changes / 变更
- Choose a narrow-screen structure for `Sessions`, `Events`, and `Detail`, such as tabs, a drawer, or a bounded session list. / 为 `Sessions`、`Events` 和 `Detail` 选择一种窄屏结构，例如标签页、抽屉或有高度限制的会话列表。
- Keep top-level search and layer/profile controls reachable on narrow screens. / 在窄屏上保持顶层搜索和 layer/profile 控件可访问。
- Avoid hiding raw refs behind desktop-only UI. / 避免让原始引用只能在桌面端 UI 中访问。

#### Validation / 验证
- `node --check public\app.js`
- Manual Playwright verification around 390 px and desktop width / 在约 390 px 和桌面宽度下进行手动 Playwright 验证

#### Exit criteria / 退出标准
- On a narrow screen, a user can select a session, inspect events, and open raw refs without scrolling through the full session list first. / 在窄屏上，用户可以选择会话、检查事件并打开原始引用，而不必先滚完整个会话列表。

## Validation checklist / 验证清单
- [x] Syntax checks pass / 语法检查通过
- [x] Tests pass where API or renderer behavior changes / 当 API 或渲染器行为变化时测试通过
- [x] Raw refs still open all underlying JSONL rows / 原始引用仍能打开所有底层 JSONL 行
- [x] Main/protocol/raw layer switching still works / main/protocol/raw 层切换仍能工作
- [x] Narrow-screen manual verification completed / 已完成窄屏手动验证

## Rollback notes / 回滚说明

- Inspector and responsive changes are frontend-only unless an API milestone explicitly changes server payloads. / 除非某个 API 里程碑明确改变服务端载荷，否则检查器和响应式改动只涉及前端。
- If inspector behavior becomes confusing, keep the raw refs path unchanged and revert the selection-detail pane independently. / 如果检查器行为变得混乱，保持原始引用路径不变，并单独回退选中详情面板。
- If narrow-screen tabs or drawers add too much complexity, use a bounded session list as a smaller fallback. / 如果窄屏标签页或抽屉引入过多复杂性，则使用有高度限制的会话列表作为较小的回退方案。

## Progress log / 进度日志

- 2026-05-04: Created this plan to separate viewer UX work from transcript normalization follow-ups. / 2026-05-04：创建本计划，将查看器 UX 工作从转录归一化后续工作中分离出来。
- 2026-05-04: Seeded scope from manual Playwright exploration of the local viewer on a real session set. / 2026-05-04：基于对真实会话集上的本地查看器进行 Playwright 手动探索，初始化范围。
- 2026-05-04: Implemented the Milestone 1 inspector foundation so ordinary event clicks show a selected-event inspector while `Raw refs` remains a separate raw JSONL view. / 2026-05-04：实现里程碑 1 的检查器基础，使普通事件点击显示选中事件检查器，同时保留 `Raw refs` 作为独立的原始 JSONL 视图。
- 2026-05-04: Added a right-pane return action from `Raw refs` back to the selected-event inspector. / 2026-05-04：在右侧面板中为 `Raw refs` 增加返回选中事件检查器的操作。

- 2026-05-04: Implemented Milestone 2 search/filter feedback with explicit matched session/event counts and clearable active-filter chips. / 2026-05-04：实现里程碑 2 的搜索/筛选反馈，显示明确的匹配会话/事件数量，并提供可逐项清除的当前筛选 chip。
- 2026-05-04: Smoke-checked the local viewer with Playwright for rendered result counts and a clearable search chip. / 2026-05-04：使用 Playwright 对本地查看器进行冒烟检查，确认结果计数和可清除搜索 chip 已实际渲染。
- 2026-05-04: Limited matched result counts to active search/filter states so the default browsing toolbar stays quiet. / 2026-05-04：将匹配结果计数限制为仅在搜索/筛选激活时显示，使默认浏览状态下的工具栏保持简洁。
- 2026-05-04: Regression-checked raw refs and main/protocol/raw layer switching in the local viewer with Playwright. / 2026-05-04：使用 Playwright 在本地查看器中回归检查原始引用和 main/protocol/raw 层切换。
- 2026-05-04: Implemented Milestone 3 as generalized same-category quick navigation from the selected-event inspector instead of a failed-command-only control. / 2026-05-04：将里程碑 3 实现为从选中事件检查器发起的通用同类事件快速导航，而不是仅面向失败命令的控件。
- 2026-05-04: Implemented and verified Milestone 4 with narrow-screen `Sessions`/`Events`/`Detail` tabs, automatic view transitions, reachable top-level controls, and raw refs access at 390 px. / 2026-05-04：实现并验证里程碑 4，提供窄屏 `Sessions`/`Events`/`Detail` 标签页、自动视图切换、可访问的顶层控件，以及 390 px 下的原始引用访问。

## Decision log / 决策日志

- 2026-05-04: Kept event-inspector, search-feedback, failure-navigation, and narrow-screen work in a separate active plan because they change browser UX and information architecture more than transcript normalization. / 2026-05-04：将事件检查器、搜索反馈、失败导航和窄屏工作保留在单独的活跃计划中，因为它们改变的是浏览器 UX 和信息架构，而不是主要改变转录归一化。

## Completion summary / 完成摘要

Completed the viewer UX follow-up: selected-event inspection, raw refs drill-down, search/filter feedback, same-category quick navigation, and narrow-screen tabs are implemented and verified without changing transcript normalization.

已完成查看器 UX 后续工作：选中事件检查、原始引用下钻、搜索/筛选反馈、同类事件快速导航和窄屏标签页均已实现并验证，且未改变转录归一化。
