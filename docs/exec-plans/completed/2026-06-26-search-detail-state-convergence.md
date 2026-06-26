# Search detail state convergence / 搜索详情状态收敛

## Goal / 目标

Keep search-driven detail views from leaving stale inspector or raw-ref content behind after the free-text find state changes, while preserving detail panes that the user explicitly opened or interacted with. / 避免自由文本查找状态变化后，由搜索自动打开的详情面板残留过期的 inspector 或 raw refs 内容，同时保留用户明确打开或交互过的详情面板。

## Phase 1 scope / 第一阶段范围

- [x] Add a detail-view state marker that distinguishes search-transient detail views from user-confirmed detail views. / 增加详情视图状态标记，区分搜索临时详情与用户确认详情。
- [x] Treat search navigation-created inspector views as transient, and promote timeline clicks, raw/inspect toggles, and selected-event navigation to user-confirmed views. / 将搜索导航创建的 inspector 视为临时详情，并将时间线点击、raw/inspect 切换和选中事件导航提升为用户确认详情。
- [x] Add a search-state convergence point so transient detail views close when `q` is cleared, no current search hit remains, or the selected event no longer matches the current free-text hit state after refresh. / 增加搜索状态收敛点，使临时详情在 `q` 清空、当前搜索无命中，或刷新后选中事件不再匹配当前自由文本命中状态时关闭。
- [x] Keep user-confirmed detail views across free-text changes unless the selected event falls out of the current structured result/layer context. / 用户确认详情在自由文本变化时保留，除非选中事件脱离当前结构化结果或事件层上下文。
- [x] Update product/design docs and browser regression coverage for the phase 1 behavior. / 更新产品/设计文档和浏览器回归覆盖。

## Deferred / 延后范围

- Search count copy and count model wording are intentionally deferred to phase 2. / 搜索计数文案和计数模型措辞有意延后到第二阶段。
- Search filter popover localization and `complete` / `completed` wording separation are intentionally deferred unless needed by phase 1 tests. / 搜索筛选弹层本地化以及 `complete` / `completed` 文案区分有意延后，除非第一阶段测试需要。

## Verification / 验证

- [x] `npm test`
- [x] `npm run test:browser`
- [x] `npm run build:check`
- [x] `git diff --check`
