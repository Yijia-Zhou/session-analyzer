# Runtime source switching API / 运行期来源切换接口

## Objective / 目标

Add a backend-only runtime Transcript Source switch so the browser can later change between Codex and Claude Code without restarting the server. The switch keeps the established single-active-adapter boundary, cancels in-flight indexing, clears stale index/project state, and snapshots project discovery so results can never mix sources. / 新增仅后端的运行期转录来源切换，使浏览器后续无需重启服务器即可在 Codex 与 Claude Code 之间切换。切换保持既有的单一活跃 adapter 边界，取消进行中的索引、清空过期的 index/project 状态，并对项目发现做快照，使结果永远不会混用来源。

## Scope / 范围

1. `POST /api/source` accepts `source` plus optional `codexHome`/`claudeHome`; validates non-empty string source before alias normalization, rejects unknown fields, and keeps the existing 413 behavior for oversized bodies. / `POST /api/source` 接受 `source` 与可选 `codexHome`/`claudeHome`；在别名归一化前校验非空字符串 source，拒绝未知字段，并保留超限 body 的既有 413 行为。
2. Switch semantics distinguish configuration changes from active index identity changes: a full no-op keeps state; an inactive home update keeps the index; a `sourceKind` or active-home change cancels the job and clears `index`, `projectCache`, and `buildMs` before swapping the adapter. / 切换语义区分配置变化与活跃 index identity 变化：完全 no-op 保持状态；inactive home 更新保留 index；`sourceKind` 或活跃 home 变化时先取消 job 并清空 `index`、`projectCache`、`buildMs`，再替换 adapter。
3. `state.buildIndex` no longer captures the startup adapter: `startProjectJob` resolves `state.buildIndexOverride` or the current `state.adapter` at call time, preserving test injection. / `state.buildIndex` 不再捕获启动时的 adapter：`startProjectJob` 在调用时解析 `state.buildIndexOverride` 或当前 `state.adapter`，保留测试注入能力。
4. `/api/projects` snapshots source revision, adapter, and source configuration before discovery; stale results return 409 and never write `projectCache`. / `/api/projects` 在发现前快照 source revision、adapter 与来源配置；过期结果返回 409 且绝不写入 `projectCache`。
5. All source configuration payloads (`/api/source`, `/api/state` 200/202/409, `/api/projects`) return `sourceKind`, `sourceHome`, `codexHome`, `claudeHome`, and `supportedSources`; the previous `codexHome: state.sourceHome` mislabeling is removed. / 所有来源配置 payload（`/api/source`、`/api/state` 200/202/409、`/api/projects`）统一返回 `sourceKind`、`sourceHome`、`codexHome`、`claudeHome` 与 `supportedSources`；移除原先 `codexHome: state.sourceHome` 的错误标注。

## Validation / 验证

- New focused suite `test/source-switch.test.js` covers validation, alias normalization, unified payload fields, dynamic adapter resolution after a switch, job cancellation without stale index commit, the no-op/inactive/active semantic matrix, and summary/full discovery races. / 新增聚焦套件 `test/source-switch.test.js` 覆盖校验、别名归一化、统一 payload 字段、切换后的动态 adapter 解析、取消 job 且不提交过期 index、no-op/inactive/active 语义矩阵，以及 summary/full 发现的 race。
- Full Node suite passes: 383/383 tests including the 7 new cases. / 完整 Node 套件通过：383/383 项测试，包含 7 个新用例。

## Status / 状态

- Completed on 2026-08-07. Backend interface, tests, and design-doc update are implemented and reviewed; 383 Node tests and 89 browser tests pass. The Select project source selector, per-source repo storage, i18n, and `sourceHome` label migration are tracked separately in the frontend plan. / 已于 2026-08-07 完成。后端接口、测试与设计文档更新已实现并通过评审；383 项 Node 测试与 89 项浏览器测试通过。Select project 的来源选择控件、按来源区分的仓库存储、i18n 与 `sourceHome` 文案迁移由前端计划单独跟踪。
