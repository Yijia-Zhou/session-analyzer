# Search count and jump-target convergence / 搜索计数与可跳转目标收敛

## Goal / 目标

Make free-text search counts and previous/next navigation match user expectations after a phrase search finds content inside command outputs, folded event details, or unloaded timeline pages. / 当短语搜索命中命令输出、折叠事件详情或尚未加载的时间线页时，让自由文本搜索计数和上一个/下一个导航符合用户预期。

Current pain point: the UI can show a large total, but previous/next navigation may loop over only a small subset of that number. This is not only a wording issue. The backend full-text count and the frontend jumpable mark set currently measure different things, and command events can inflate backend counts by indexing repeated mirror copies of the same output. / 当前痛点：界面可能显示很大的总数，但上一个/下一个导航只会在其中一小部分目标里循环。这不只是文案问题。后端全文计数与前端可跳转 mark 集合当前衡量的是不同对象，而且 command 事件会因为索引同一输出的多份镜像副本而放大后端计数。

## Decisions / 已定决策

- Fix backend count inflation first, then improve frontend target materialization. / 先修后端计数虚高，再改善前端目标物化。
- Folded detail hits should be revealed by expanding the timeline event, not by opening the Inspector as the primary surface. / 折叠详情中的命中应通过展开时间线事件来显示，而不是主要打开 Inspector。
- Search-triggered expansion is transient and must not be persisted into the user's session folding overrides. / 搜索触发的展开是临时状态，不能写入用户的 session 折叠覆盖。
- Search count UI should use the "jump target + full-text" model: primary count is current position among jumpable targets, while backend full-text hits remain visible as secondary context. / 搜索计数 UI 使用“可跳转目标 + 全文命中”模型：主计数显示当前位于可跳目标中的位置，同时将后端全文命中作为次级信息保留。

## Phase 1: backend count de-duplication / 第一阶段：后端计数去重

- Adjust command logical-event `searchText` construction so a command contributes the command text plus one canonical output body, rather than concatenating every mirrored output field. / 调整 command 逻辑事件的 `searchText` 组装，使一个命令贡献命令文本和一个规范化输出体，而不是拼接所有镜像输出字段。
- Preserve discoverability for command text, stdout/stderr, parsed function-call output, failure text, and file-touch inference. The goal is not to remove searchable content; it is to avoid counting the same output copy from `stdout`, `aggregated_output`, `formatted_output`, `raw.searchText`, and `function_call_output` multiple times in one logical event. / 保留命令文本、stdout/stderr、解析后的 function-call output、失败文本和 touched-file 推断的可发现性。目标不是移除可搜索内容，而是避免同一逻辑事件中来自 `stdout`、`aggregated_output`、`formatted_output`、`raw.searchText` 和 `function_call_output` 的同一输出副本被多次计数。
- Add focused regression coverage using the existing fixture where `alpha failed` currently appears six times in one failed command's `searchText`; the expected count should reflect one canonical rendered output occurrence, plus any genuinely distinct occurrences. / 使用现有 fixture 增加聚焦回归覆盖：当前 `alpha failed` 会在一个 failed command 的 `searchText` 中出现六次；期望计数应反映一个规范化可渲染输出命中，再加上任何真实不同的命中。
- Do not change `/api/sessions/:id/timeline` response shape in this phase. / 本阶段不改变 `/api/sessions/:id/timeline` 响应形状。

## Phase 2: count UI model / 第二阶段：计数 UI 模型

- Replace the current single ambiguous `{current} / {total} matches` label with a label whose primary denominator is rendered or materialized jump targets. / 将当前含糊的 `{current} / {total} matches` 标签替换为以已渲染或已物化可跳目标为主分母的标签。
- Keep backend `searchMatchCount` visible as secondary context, for example "3 / 12 jump targets · 48 full-text hits" and the equivalent Simplified Chinese string. / 保留后端 `searchMatchCount` 作为次级信息，例如 “3 / 12 jump targets · 48 full-text hits” 及对应简体中文文案。
- Update `searchMatchTitle` so the tooltip explicitly distinguishes jump targets from backend full-text hits. / 更新 `searchMatchTitle`，让 tooltip 明确区分可跳目标和后端全文命中。
- Keep structured result counts (`Sessions: ... match`, `Events: ... match`) separate from free-text jump/full-text counts. / 保持结构化结果计数（`Sessions: ... match`、`Events: ... match`）与自由文本可跳/全文计数分离。

## Phase 3: search target materialization / 第三阶段：搜索目标物化

- Refactor previous/next navigation so it does not wrap within the current DOM marks while backend full-text hits remain unmaterialized. / 重构上一个/下一个导航，使其在仍有未物化后端全文命中时不要只在当前 DOM mark 内循环。
- When the next search hit is on an unloaded timeline page, append more timeline pages before wrapping. The preload limit may remain bounded, but explicit navigation should keep loading until it either finds another jump target or exhausts the filtered timeline. / 当下一个搜索命中位于未加载的时间线页时，在循环前追加更多时间线页。预加载仍可保持边界，但用户明确导航时应持续加载，直到找到另一个可跳目标或耗尽筛选后的时间线。
- When a loaded event has `hasSearchHit` but no current DOM mark, temporarily expand that event in the timeline, load its detail, re-render, refresh highlights, and scroll to the concrete mark in `.eventBody`. / 当已加载事件有 `hasSearchHit` 但当前 DOM 中没有 mark 时，临时展开该时间线事件、加载其详情、重绘、刷新高亮，并滚动到 `.eventBody` 中的具体 mark。
- Store transient search expansions separately from persisted folding overrides. Bind them to the active search target key: session, layer, free text, kind, status, and file. Clear them when free text is cleared, the search target key changes, the session/layer/profile changes, or the event receives a user manual override. / 将临时搜索展开与持久化折叠覆盖分开存储。它们绑定到当前搜索目标 key：session、layer、自由文本、kind、status 和 file。当自由文本清空、搜索目标 key 变化、session/layer/profile 变化，或事件收到用户手动 override 时清除。
- Reuse existing detail loading and highlighter behavior where possible, including opening nested `<details>` ancestors before scrolling to a mark. / 尽量复用现有详情加载和高亮行为，包括滚动到 mark 前展开嵌套 `<details>` 祖先。

## Verification / 验证

- Unit tests for phrase count semantics, especially command-output mirror de-duplication. / 为短语计数语义增加单元测试，特别覆盖命令输出镜像去重。
- Browser tests for default narrative profile: searching a phrase that appears only in command stdout/detail should make Next temporarily expand the command event, load detail, activate the stdout mark, and clear the transient expansion when search text is removed. / 为默认 narrative profile 增加浏览器测试：搜索只存在于 command stdout/detail 中的短语时，Next 应临时展开 command 事件、加载详情、激活 stdout mark，并在移除搜索文本时清理临时展开。
- Browser tests that explicit search navigation loads additional timeline pages before wrapping when more hit events exist beyond the current page. / 增加浏览器测试：当当前页之后仍有命中事件时，明确的搜索导航应在循环前加载更多时间线页。
- Browser/i18n tests for the new jump-target/full-text count copy in English and Simplified Chinese. / 为新的可跳目标/全文命中文案增加英文和简体中文浏览器或 i18n 测试。
- Run `npm test`, `npm run test:browser`, `npm run build:check`, and `git diff --check` before moving this plan to completed. / 移动本计划到 completed 前运行 `npm test`、`npm run test:browser`、`npm run build:check` 和 `git diff --check`。

## Documentation updates / 文档更新

- Update `docs/product-specs/session-transcript-analyzer.md` to describe the jump-target/full-text count model and transient expansion behavior. / 更新 `docs/product-specs/session-transcript-analyzer.md`，描述可跳目标/全文命中计数模型和临时展开行为。
- Update `docs/design-docs/logical-event-timeline.md` to document backend command-output de-duplication and frontend materialization rules. / 更新 `docs/design-docs/logical-event-timeline.md`，记录后端命令输出去重和前端目标物化规则。
- When implementation is complete, move this file to `docs/exec-plans/completed/` and update active-plan indexes. / 实现完成后，将本文件移动到 `docs/exec-plans/completed/` 并更新 active-plan 索引。
