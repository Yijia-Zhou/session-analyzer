# Debt #23: reading controls and project return / 债务 #23：阅读控件与项目返回

Status: implementation and local acceptance complete; not committed or published. / 状态：实现与本地验收完成，尚未提交或发布。

## Scope and decision / 范围与决策

Keep two small UX contracts in one reviewable change: desktop reading-control geometry and project-return surface ownership/state continuity. No generic CSS refactor or Wave 1D-A flake repair. / 将桌面阅读控件几何与项目返回入口职责／状态连续性两个小 UX 契约放在同一变更中；不进行泛化 CSS 重构或 Wave 1D-A flake 修复。

- Reproduced at 1600px with a fixture command selected after a manual fold override: document width 1661px, Reset folds right edge 1661.44px. / fixture 命令手动折叠后选中，在 1600px 复现文档宽 1661px，Reset folds 右边界 1661.44px。
- Nested grids require more width than the 328px detail content column. Reset-enabled folding controls now span a separate row at container widths up to 440px; no clipping. / 嵌套 grid 需要的宽度超过详情内容列的 328px；容器不超过 440px 时，显示 reset 的折叠控件独占一行，不裁切。
- Keep session-header return during loading and reading, and Inspector return for independent detail/mobile navigation. Remove duplicate timeline banner and result-summary actions; preserve the shared return function. / 保留加载与阅读期间的 session header 返回，以及独立详情／移动端 Inspector 返回；删除重复 timeline banner 和结果摘要入口，保留共用返回函数。
- Track the pre-existing stale context-slot flake independently as debt #24. / 将既有 stale context-slot flake 独立记录为债务 #24。

## Acceptance / 验收

- Review follow-up: sorting after project drill-down called `selectSession()` and removed the sole center return action while retaining `projectReturnContext`. Reproduced with a browser assertion (`0 !== 1`); both header render paths now share a context-guarded return renderer. The regression test sorts after opening Inspector, waits for the session reload and Inspector reset, then clicks the remaining header action and checks query/filter/Layer/cards/scope/focus continuity. Six focused browser tests and generated-asset validation passed after this follow-up; the full-suite counts below belong to the preceding implementation. / Review 后续：项目下钻后排序调用 `selectSession()`，在保留 `projectReturnContext` 的同时移除了中间唯一返回入口。浏览器断言已复现（`0 !== 1`）；两个 header 渲染路径现共用按 context 判断的返回入口 renderer。回归测试打开 Inspector 后排序，等待 session 重载与 Inspector 重置，再点击保留的 header 入口，检查 query／筛选／Layer／卡片／scope／焦点连续性。本次修复后六项定向浏览器测试与构建产物校验通过；下方全量测试数字属于此前实现。

- Focused browser checks passed: six desktop widths (1600, 1440, 1280, 1101, 1024, 820), document width and control bounding boxes, Reset folds interaction, original topbar layout, return surface counts, query/filter/Layer/cards/scope/focus continuity, mobile detail return, deep-event return and stale-analysis return. / 定向浏览器检查通过：六种桌面宽度、文档宽及控件边界、Reset folds 操作、原顶部布局、返回入口数量、query／筛选／Layer／卡片／scope／焦点连续性、移动端详情返回、深层事件返回与陈旧 analysis 返回。
- `npm test`: 1071 passed. `npm run build:check`: generated assets current. `npm run test:browser`: 233 passed, including the stale context-slot control; no flake observed in this run. `git diff --check`: passed. / 单元测试 1071 项通过，构建产物一致性通过；完整浏览器测试 233 项通过，包括 stale context-slot control，本轮未观察到该 flake；diff 空白检查通过。
- Existing development server at `http://127.0.0.1:17890` serves the updated CSS and bundle directly; refresh applies this static-only change. This is resource-delivery verification, not a new real-history acceptance run. / 现有开发服务器直接提供更新 CSS 与 bundle，静态资源修改刷新即可生效；这是资源交付核验，不是新一轮真实历史验收。

Reproduce focused coverage with `node --test --test-name-pattern='browser reading controls stay|browser topbar width priorities|browser project return surfaces|browser project return ignores|browser project result drill-down' e2e/browser.test.js`. / 使用上述命令复现定向覆盖。
