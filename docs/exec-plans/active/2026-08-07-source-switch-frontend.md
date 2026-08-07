# Source switch frontend / 来源切换前端

## Objective / 目标

Add the Select project source switcher on top of the runtime `POST /api/source` backend: switch between Codex and Claude Code inside the chooser, optionally edit both home directories, keep last-selected repo storage scoped per source, and localize all new copy in English and Simplified Chinese. / 在运行期 `POST /api/source` 后端之上为 Select project 增加来源切换：在 chooser 内切换 Codex 与 Claude Code，可选编辑两个 home 目录，按来源区分“最后选择的仓库”存储，并用英文与简体中文本地化所有新文案。

## Scope / 范围

1. Add a source switch block under `#projectStatus` in `.projectChooserHeader`: current source and home summary, a switch action with inline two-step confirmation, and a collapsible custom-directories editor. The block is always visible in the chooser; the summary uses the “no projects? try switching” hint only after discovery finishes with an empty list. / 在 `.projectChooserHeader` 的 `#projectStatus` 下方新增来源切换区块：当前来源与 home 摘要、带行内两步确认的切换按钮，以及可折叠的自定义目录编辑器。区块在 chooser 中始终可见；只有发现完成后列表为空时，摘要才使用“没有找到想看的仓库？尝试切换”的提示。
2. Add `applySourceConfig()` as the single source-config sync entry, called from `/api/state` (`applyAppState`), `/api/projects` summary/full discovery, `/api/source` responses, and the 409 init fallback. / 新增 `applySourceConfig()` 作为唯一的来源配置同步入口，由 `/api/state`（`applyAppState`）、`/api/projects` summary/full 发现、`/api/source` 响应以及 init 的 409 回退统一调用。
3. Commit source changes through one `commitSourceConfig()` used by both source switching and home-directory apply. A backend reset (`projectSelected: false`) clears `state.repoRoot` and `projectReturning` so the topbar Return affordance disappears; an inactive-home-only change keeps them. / 来源切换与目录应用共用 `commitSourceConfig()`。后端重置（`projectSelected: false`）时清空 `state.repoRoot` 与 `projectReturning`，使顶栏 Return 消失；仅 inactive home 变化时保留两者。
4. Track `projectDiscoveryLoading` so the empty-state hint and “no transcript projects” notice never flash while summary/full discovery is still pending. Discovery 409s are treated as expected races: a stale request is dropped silently via the chooser request-id guard. / 用 `projectDiscoveryLoading` 区分发现进行中，避免空态提示与“没有发现转录项目”通知在 summary/full 请求未完成时闪现。发现 409 按预期竞争处理：过期请求通过 chooser request-id 守卫静默丢弃。
5. Replace the legacy `sessionAnalyzer.repoRoot` storage with per-source keys (`sessionAnalyzer.repoRoot.<sourceKind>`). The legacy key is read and migrated only for Codex and then removed; writes use the payload's `sourceKind`, never the possibly stale `state.sourceKind`. / 用按来源区分的 key（`sessionAnalyzer.repoRoot.<sourceKind>`）替换旧 `sessionAnalyzer.repoRoot`。旧 key 仅对 Codex 读取迁移并删除；写入使用 payload 的 `sourceKind`，绝不使用可能过期的 `state.sourceKind`。
6. Localize new UI copy and switch `projectActivityLoading`/`projectCandidates`/`noProjectCandidates` to the `{sourceHome}` placeholder; rename the empty notice to source-neutral `noTranscriptProjects`. / 本地化新 UI 文案，并把 `projectActivityLoading`/`projectCandidates`/`noProjectCandidates` 改用 `{sourceHome}` 占位符；空通知改为来源无关的 `noTranscriptProjects`。

## Validation / 验证

- New e2e helper opens a server without a prebuilt index and drives the chooser through source switches, legacy storage migration, and home-directory edits. / 新增 e2e helper 以无预建索引的服务器打开 chooser，覆盖来源切换、旧存储迁移与目录编辑。
- Eleven new browser tests cover the eight earlier scenarios plus: source switching carries unapplied home-directory edits; inactive-home apply starts a successor discovery when a scan is in flight; and a 202 indexing-job state applies the source configuration immediately. / 十一个新增浏览器用例覆盖此前八个场景，另加：来源切换携带未应用的目录草稿；扫描进行中应用 inactive home 会启动后继发现；202 索引 job 状态会立即应用来源配置。
- Review follow-ups: `commitSourceConfig` re-renders controls after clearing the busy flag; home inputs are preserved through a dirty-edit flag instead of focus-only; `resolveSourceMutation` bumps `sourceRevision` for any configuration change so stale discovery is rejected; and the product spec documents runtime switching. / 评审后续：`commitSourceConfig` 在清除 busy 后重新渲染控件；home 输入通过 dirty 编辑标记而非仅焦点判断来保留；`resolveSourceMutation` 在任何配置变化时递增 `sourceRevision`，使过期发现被拒绝；产品 spec 已补充运行期切换说明。
- Second review follow-ups: `projectDiscoveryLoading` is cleared on discovery failure or invalidation (without clobbering a successor request), and home-change confirmation compares normalized path forms so Windows-equivalent inputs do not prompt a spurious reset confirmation. / 第二轮评审后续：`projectDiscoveryLoading` 在发现失败或被作废时复位（且不会覆盖后继请求的状态）；home 修改确认改用归一化路径比较，Windows 下等价输入不再弹出多余的确认。
- Third review follow-up: the empty-state hint now sets `data-empty="true"` explicitly so the emphasis styling applies, with an e2e assertion on the computed font weight. / 第三轮评审后续：空态提示改为显式设置 `data-empty="true"`，使强调样式生效，并新增对计算后 font-weight 的 e2e 断言。
- Fourth review follow-ups: source switch consumes the unapplied home draft (and cancel no longer discards it), any successful home mutation re-runs project discovery as the successor of a stale scan, and `init()` applies source configuration immediately for the 202 job envelope. / 第四轮评审后续：来源切换携带未应用的 home 草稿（取消不再丢弃草稿）；任何成功的 home 修改都会重新执行项目发现，作为过期扫描的后继；`init()` 对 202 job envelope 立即应用来源配置。
- Full gates: 384 Node tests, 96 browser tests, `npm run build:check`, and `git diff --check` pass. / 完整门槛：384 项 Node 测试、96 项浏览器测试、`npm run build:check` 与 `git diff --check` 均通过。
- Full gates: 384 Node tests, 93 browser tests, `npm run build:check`, and `git diff --check` pass. / 完整门槛：384 项 Node 测试、93 项浏览器测试、`npm run build:check` 与 `git diff --check` 均通过。

## Status / 状态

- In progress: implementation and local gates are complete; pending external review. / 进行中：实现与本地门槛已完成，等待外部评审。
