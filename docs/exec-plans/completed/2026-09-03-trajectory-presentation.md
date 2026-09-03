# Trajectory Presentation Production Implementation / Trajectory 呈现正式实现

## Status / 状态

- Status: complete — M0–M6 accepted and ready for local review / 状态：已完成——M0–M6 已验收，可供本地 review
- Started: 2026-09-03 / 开始日期：2026-09-03
- Production worktree: `G:\vibe\session-analyzer\tmp\worktrees\trajectory-view`
- Branch: `feat/trajectory-view`
- Exact base: `origin/towards-0.2.0` at `3419a49ae2c1c9a6ff7e1e34ecb3b550ba1f9ec1`
- Original checkout used for transcript history at acceptance: `G:\vibe\session-analyzer`
- Disposable prototype evidence: `G:\vibe\session-analyzer\tmp\worktrees\trajectory-demo` at `b7ca3bff12fd5061410aaa3483341023498b23d4` (strictly read-only) / 一次性 prototype 证据：`G:\vibe\session-analyzer\tmp\worktrees\trajectory-demo`，HEAD `b7ca3bff12fd5061410aaa3483341023498b23d4`（严格只读）
- Acceptance server target: `http://127.0.0.1:17893/`, with server source from the production worktree and `--repo G:\vibe\session-analyzer` / 验收 server 目标：`http://127.0.0.1:17893/`，server source 来自 production worktree，`--repo G:\vibe\session-analyzer`
- No cherry-pick/merge from the prototype, no push, and no publish. / 不从 prototype cherry-pick／merge，不 push，不发布。

## Goal / 目标

Reimplement the validated Trajectory concept as a production Main Presentation on the latest accepted architecture. Keep Timeline as the default, keep Main／Protocol／Raw as the complete Event Layer contract, preserve canonical event/search/detail/Raw ownership, integrate every current browser transition path, and bound long-session overview rendering without adding a dependency or server API. / 在最新已接受架构上，把已验证的 Trajectory 概念重新实现为正式 Main Presentation。保持 Timeline 为默认值，保持 Main／Protocol／Raw 为完整 Event Layer 契约，保留 canonical event／search／detail／Raw ownership，集成当前所有 browser transition path，并在不新增依赖或 server API 的前提下约束长 Session overview rendering。

## Authoritative constraints / 权威约束

- `docs/design-docs/trajectory-presentation.md` is the implementation contract. / `docs/design-docs/trajectory-presentation.md` 是实现契约。
- Existing canonical query DTOs, folding evaluation, search target registry, event-envelope navigation, detail/Raw ownership, request owners, and Timeline pagination remain authoritative. / 既有 canonical query DTO、folding evaluation、search target registry、event-envelope navigation、detail／Raw ownership、request owner 与 Timeline pagination 保持权威。
- Wave 1C keyed Main Timeline append remains unchanged on the active Timeline path. Trajectory is an explicit non-Main-card root and must retire/reconcile lifecycle owners honestly. / Wave 1C keyed Main Timeline append 在 active Timeline path 上保持不变。Trajectory 是显式 non-Main-card root，必须如实 retire／reconcile lifecycle owner。
- Cache Observation Main↔Protocol links and current DeepSeek Harness approval/permission semantics stay on their existing Logical Events and layers. / Cache Observation Main↔Protocol link 与当前 DeepSeek Harness approval／permission semantic 保留在既有 Logical Event 与 layer 上。
- Real transcripts are read-only acceptance inputs and never fixtures. / 真实 transcript 只作为只读验收输入，绝不成为 fixture。

## Prototype evidence and production corrections / Prototype 证据与正式修正

Reusable after review: source-neutral lane classification shape; canonical-order projection; weak reliable-turn boundary filtering; contiguous tool-run grouping; compact text; selected-event synchronization; Fit/zoom/pan interactions; selected anchor on the first zoom. / 经重新审查后可复用：来源中立 lane classification 形态、canonical-order projection、弱 reliable-turn boundary 过滤、连续 tool run grouping、compact text、selected-event synchronization、Fit／zoom／pan 交互，以及首次 zoom 的 selected anchor。

Rejected or replaced for production: Swimlanes; a `Trajectory demo` view available on non-Main layers; prominent missing-turn sections; duration display; nested assistant-owned group appearance; per-event overview DOM buttons; unconditional tool-member DOM; direct full-render append without an explicit Wave 1C lifecycle branch. / 正式拒绝或替换：Swimlanes、在 non-Main layer 显示的 `Trajectory demo` view、醒目的 missing-turn section、duration display、暗示 assistant ownership 的嵌套 group 外观、逐 event overview DOM button、无条件 tool-member DOM，以及没有显式 Wave 1C lifecycle branch 的直接 full-render append。

## Milestones / 里程碑

### M0 — Baseline, documents, and active plan / Baseline、文档与 active plan

- [x] Read the latest root `README.md` and `AGENTS.md` before modifying production files. / 修改正式文件前读取最新 root `README.md` 与 `AGENTS.md`。
- [x] Fetch `origin/towards-0.2.0`, record its exact HEAD, create the independent branch/worktree, and verify root/HEAD/status. / Fetch `origin/towards-0.2.0`，记录精确 HEAD，创建独立 branch／worktree，并验证 root／HEAD／status。
- [x] Review the current domain, product, Timeline, performance, Indexed/Materialized, Cache, DSH, and Wave 1C boundaries. / 审阅当前 domain、product、Timeline、performance、Indexed／Materialized、Cache、DSH 与 Wave 1C boundary。
- [x] Add bilingual domain language, product contract, production design, and this active plan. / 增加 bilingual domain language、product contract、正式设计与本 active plan。
- [x] Establish focused baseline tests and generated-asset status. / 建立 focused baseline test 与 generated-asset 状态。

Actual evidence / 实际证据：

- Remote, fetched, local, and worktree base all resolved to `3419a49ae2c1c9a6ff7e1e34ecb3b550ba1f9ec1`; the original checkout and new worktree were clean. / Remote、fetched、local 与 worktree base 均解析为 `3419a49ae2c1c9a6ff7e1e34ecb3b550ba1f9ec1`；原始 checkout 与新 worktree 均为 clean。
- Toolchain: Node `v24.18.1`, npm `12.0.2`; `npm ci --strict-allow-scripts` installed 13 locked packages; `npm install-scripts ls --json` reported `allowScripts: []`. / Toolchain：Node `v24.18.1`、npm `12.0.2`；严格脚本策略下安装 13 个锁定 package；install-script 审计为 `allowScripts: []`。
- Baseline focused command passed 82/82 tests across folding, navigation, search targets, Timeline event state, search batch, and card lifecycle. / Baseline focused command在 folding、navigation、search target、Timeline event state、search batch 与 card lifecycle 上通过 82／82 tests。
- Baseline `npm run build:check` passed with generated assets current. / Baseline `npm run build:check` 通过，generated asset 为 current。

### M1 — Pure source-neutral trajectory projection / 纯来源中立 trajectory projection

- [x] Add `src/browser/trajectory-presentation.js` with no source-kind branch and no DOM dependency in projection functions. / 增加 `src/browser/trajectory-presentation.js`；projection function 不按 source kind 分支，也不依赖 DOM。
- [x] Validate event identity, classify lanes, represent reliable turn boundaries, group adjacent tool activity, flatten groups reversibly, and build overview sequence/density models. / 验证 event identity、分类 lane、表示 reliable turn boundary、归组相邻 tool activity、可逆 flatten group，并构建 overview sequence／density model。
- [x] Cover known kinds, role/tool fallbacks, unknown visible fallback, duplicate/missing IDs, mixed turn evidence, group splits, and 300／1,000／1,800-event identity/performance shapes. / 覆盖 known kind、role／tool fallback、unknown visible fallback、重复／缺失 ID、混合 turn evidence、group split 与 300／1,000／1,800 event identity／performance shape。
- [x] Record exact focused command and results below. / 在下方记录精确 focused command 与结果。

Actual evidence / 实际证据：

- `node --check src/browser/trajectory-presentation.js` passed. / `node --check` 通过。
- `node --test test/trajectory-presentation.test.js` passed 10/10 tests with no failures. / Focused test 通过 10／10，无失败。
- Characterization only, not a gate: 300 events projected in 0.936 ms to 150 narrative items／25 groups／300 occupied bins; 1,000 in 2.159 ms to 502 items／84 groups／720 bins; 1,800 in 2.935 ms to 900 items／150 groups／720 bins. All shapes recovered every input ID in exact order and capped density bins at the 720 px test width. / 仅作 characterization，不作为 gate：300 event 为 0.936 ms、150 narrative item／25 group／300 occupied bin；1,000 event 为 2.159 ms、502 item／84 group／720 bin；1,800 event 为 2.935 ms、900 item／150 group／720 bin。所有 shape 均按精确顺序还原全部输入 ID，并把 density bin 限制在 720 px test width 内。

### M2 — Main Presentation state, narrative ledger, and grouping / Main Presentation state、narrative ledger 与 grouping

- [x] Add `Timeline | Trajectory` as a Main Presentation selector, default Timeline, process-memory only. / 增加 Main Presentation selector `Timeline | Trajectory`，默认 Timeline，只存在于 process memory。
- [x] Keep Protocol/Raw on Timeline and restore remembered Main presentation on return. / Protocol／Raw 始终使用 Timeline，返回 Main 时恢复 remembered presentation。
- [x] Render Input/Model narrative rows, visible Other fallback, compact standalone Tool Activity Groups, lazy reversible members, and existing folding states. / 渲染 Input／Model narrative row、可见 Other fallback、紧凑且独立的 Tool Activity Group、lazy 可逆 member 与既有 folding state。
- [x] Integrate selection, Inspector, Raw refs, locale, mobile Events/Detail flow, and honest Wave 1C owner retirement/reconciliation. / 集成 selection、Inspector、Raw refs、locale、mobile Events／Detail flow 与真实 Wave 1C owner retirement／reconciliation。

Actual evidence / 实际证据：

- `node --test test/trajectory-presentation.test.js test/i18n.test.js test/timeline-card-lifecycle.test.js test/search-targets.test.js` passed 45/45 after the zh-CN terminology gate required localized display copy. / Focused suite 在 zh-CN 词汇治理要求本地化 display copy 后通过 45／45。
- `node --test --test-name-pattern='browser Main presentation switches' e2e/browser.test.js` passed in 1.344 s. / Focused browser case 在 1.344 s 内通过。
- Browser evidence proved: default Timeline; presentation-only switches issue no Timeline API request; a closed Tool Activity Group retains zero member nodes until opened; the ledger still represents every canonical ID; member selection opens the existing Inspector and Raw refs; selection round-trips to the same collapsed Timeline card without writing a folding override; Protocol hides the selector and renders Timeline; returning Main restores Trajectory; entering Trajectory emits a non-Main Wave 1C lifecycle record with zero retained owners. / Browser 证据证明：默认 Timeline；只切呈现不会发 Timeline API request；关闭的工具活动组在展开前保持零 member node；ledger 仍代表全部 canonical ID；member selection 打开既有 Inspector 与 Raw refs；selection 往返到相同 collapsed Timeline card 且不写 folding override；Protocol 隐藏 selector 并渲染 Timeline；返回 Main 恢复 Trajectory；进入 Trajectory 时产生 owner count 为零的 non-Main Wave 1C lifecycle record。

### M3 — Overview, selection, and navigation / Overview、selection 与 navigation

- [x] Add the three-row Input/Model/Tools canvas overview over the loaded canonical sequence. / 增加覆盖 loaded canonical sequence 的三行 Input／Model／Tools canvas overview。
- [x] Add explicit loaded-prefix/full-loaded copy and a constant-size selected locator. / 增加明确 loaded-prefix／fully-loaded 文案与固定数量 selected locator。
- [x] Map overview clicks to exact canonical IDs and synchronize narrative/Inspector selection. / 把 overview click 映射到精确 canonical ID，并同步 narrative／Inspector selection。
- [x] Verify Inspector previous/next and project-search drill-down can load, reveal, select, and scroll to grouped events. / 验证 Inspector previous／next 与 project-search drill-down 能加载、reveal、select 并滚动到 grouped event。

Actual evidence / 实际证据：

- `browser Trajectory overview exposes only the loaded canonical sequence and shares selection identity` passed in 1.463 s. It asserted exactly three Input／Model／Tools labels, `Loaded prefix · 150/300`, zero overview `data-event-id` owners, one canvas, one locator, fewer than 30 overview descendants, canonical click/keyboard selection in narrative and Inspector, locator visibility at Fit, Inspector next navigation, and constant overview node count after Load more reached `Loaded sequence · 300`. The 300-event Fit canvas selected density mode with rendered bins bounded by plot pixels. / 该 case 在 1.463 s 内通过，并断言三条 lane、明确 prefix、overview 不拥有 canonical search node、单 canvas／单 locator、overview descendant 少于 30、click／keyboard／Inspector next 同步、Fit locator 可见、Load more 后节点数恒定与 300-event density 有界。
- `browser project-search drill-down restores Trajectory and anchors the exact loaded-prefix event` passed in 1.769 s. Existing project search loaded through timeline index 250, restored the remembered Trajectory presentation, selected one exact canonical ID in overview and narrative, retained the return path, and reported prefix/full copy consistent with the final committed depth after optional search preload. / 该 case 在 1.769 s 内通过；既有 project search 加载到 timeline index 250，恢复 remembered Trajectory，在 overview 与 narrative 选择同一个精确 canonical ID，保留返回路径，并使 prefix／full 文案与 optional search preload 后的最终 committed depth 一致。

### M4 — Sequence Zoom and bounded rendering / Sequence Zoom 与有界 rendering

- [x] Implement Fit, `−`, `+`, selected-event first-zoom anchoring, center-preserving later zoom, wheel/pointer pan, selection bring-into-view, and free-pan non-snap behavior. / 实现 Fit、`−`、`+`、selected-event 首次 zoom anchor、后续 zoom 保持中心、wheel／pointer pan、selection bring-into-view 与 free-pan 不吸回行为。
- [x] Switch canvas between density bins and individual markers based on pixel separation. / 根据像素间隔在 canvas density bin 与 individual marker 之间切换。
- [x] Assert constant overview DOM and bounded canvas width for 300／1,000／1,800 events. / 对 300／1,000／1,800 event 断言固定 overview DOM 与有界 canvas width。

Actual evidence / 实际证据：

- `browser Trajectory sequence zoom keeps long overviews bounded and selection-aware without pan snapback` passed against 1,000 loaded Main events. Fit used 20 overview descendants and 461 pixel-bounded density bins; 8× retained the same 20 descendants and rendered 1,000 canvas markers across 3,685 px. The first zoom kept the selected event visible around the viewport center, wheel pan moved from 0 to 420 px without snapback, pointer drag moved it to 536 px without snapback, a later selection brought its locator into view, Fit returned to density/scroll 0, and a Timeline round trip restored zoom/scroll with no Timeline request. / 该 1,000-event case 通过：Fit 为 20 个 overview descendant 与 461 个像素有界 density bin；8× 保持同样 20 个 descendant，并在 3,685 px canvas 上绘制 1,000 marker。首次 zoom 围绕 selection，wheel／pointer 自由平移不吸回，selection change 会 bring into view，Fit 回到 density／scroll 0，Timeline 往返恢复 zoom／scroll 且不发 Timeline request。
- `browser Trajectory characterizes the existing 1800-event performance shape without overview DOM growth` passed in 5.60 s total. Loading eleven additional 150-event pages while Trajectory was active took 1,832 ms; Fit remained 20 overview descendants／461 density bins while the narrative exposed 1,800 reading rows; Timeline return took 725 ms, Trajectory return 381 ms, and neither issued a new Timeline request; four zoom steps took 207 ms and 16× rendered 1,800 markers on a 7,369 px canvas, bounded by viewport width × zoom. These are local characterization values, not gates. / 1,800-event browser characterization 通过；Trajectory active 时加载十一页耗时 1,832 ms，Fit 仍为 20 个 overview descendant／461 density bin，narrative 为 1,800 reading row；Timeline／Trajectory 返回分别为 725／381 ms 且无额外 Timeline request；四步 zoom 为 207 ms，16× 在 7,369 px canvas 上绘制 1,800 marker。以上为本机 characterization，不是 gate。
- The existing 300-event overview case continued to pass after zoom integration, retaining constant overview DOM across Load more and selecting density mode at Fit. / 既有 300-event overview case 在 zoom 集成后继续通过，Load more 前后 overview DOM 恒定，Fit 使用 density mode。

### M5 — Search, folding, Load more, and transition integration / Search、folding、Load more 与 transition 集成

- [x] Reuse canonical search target discovery/binding; open and materialize a collapsed Tool Activity Group for a target without changing saved folding. / 复用 canonical search target discovery／binding；为目标打开并 materialize collapsed Tool Activity Group，同时不改变 saved folding。
- [x] Keep structured-filter server membership, folding evaluation, selected-event synchronization, explicit Load more, auto pagination, and batch publication behavior. / 保持 structured-filter server membership、folding evaluation、selected-event synchronization、显式 Load more、auto pagination 与 batch publication behavior。
- [x] Exercise session/source/layer/locale/query/filter/project-result/context/revision transitions and stale request ownership. / 覆盖 session／source／layer／locale／query／filter／project result／context／revision transition 与 stale request ownership。
- [x] Prove Timeline append remains keyed when Timeline is active and presentation round trips reconcile owners correctly. / 证明 Timeline active 时 append 仍为 keyed，且 presentation round trip 正确 reconcile owner。

Actual evidence / 实际证据：

- The consolidated `node --test --test-name-pattern='Trajectory' e2e/browser.test.js` run passed 10/10 cases in 21.97 s. / 合并 Trajectory browser run 在 21.97 s 内通过 10／10。
- The hidden failed-command search case kept the canonical member absent from DOM until navigation, then transiently expanded its existing Tool Activity Group, materialized the exact event ID, bound one active Timeline mark, synchronized narrative／overview／Inspector, and restored natural folding after query clear without writing an override. A `kind=command` structured filter returned the server-defined four-event membership as two collapsed visible groups; switching to the built-in narrative Folding Strategy made the failed command expanded through the existing rule evaluator. / hidden failed-command search 在 navigation 前保持 member 不进入 DOM；navigation 后通过既有 transient expansion 展开 group、materialize 精确 ID、绑定 active mark 并同步 narrative／overview／Inspector；清除 query 后恢复自然 folding 且不写 override。`kind=command` structured filter 使用 server 定义的四 event membership，呈现为两个 collapsed group；切换 narrative Folding Strategy 后由既有规则把失败 command 展开。
- After Trajectory → Timeline, a 150→300 Main Load more operation preserved all 150 original card node identities and produced exactly one Wave 1C `appendOnly` mutation (`pre=150`, `added=150`, `removed=0`, `final=300`) with no replacement. / Trajectory → Timeline 后，150→300 Main Load more 保留全部 150 个原 card node identity，只产生一次 Wave 1C `appendOnly` mutation，无 replacement。
- At 150／300 events, a large wheel over the zoomed overview changed only horizontal Sequence Zoom scroll and issued no pagination request; the same wheel over `.timelinePane` retained existing automatic pagination and committed the 300-event projection. / 在 150／300-event case 中，zoomed overview 上的大幅 wheel 只改变横向 Sequence Zoom scroll，不触发分页；同一 wheel 作用于 `.timelinePane` 时保留既有 automatic pagination 并提交 300-event projection。
- A paused `offset=750` search page from a 900-event Session was released after selecting a 40-event Session; Trajectory stayed on the successor 40-event context, reset zoom to Fit, retained the remembered presentation, exposed no pending navigation, and did not surface `AbortError`. / 900-event Session 的 `offset=750` search page 在切换到 40-event Session 后才释放；Trajectory 保持 successor 40-event context、zoom 重置为 Fit、remembered presentation 保留，无 pending navigation 或 `AbortError`。
- A real source-registry browser transition selected a Codex Trajectory event, entered the chooser, replaced the source with a generated Claude Code source, and selected its project. Main returned in remembered Trajectory mode with two Claude events, cleared old selection/locator ownership, and exposed no old Codex event ID. Layer and project-search transitions remain covered by M2/M3. / source-registry browser transition 从已选择 Codex Trajectory event 切换到生成的 Claude Code source／project；Main 以 remembered Trajectory 返回并显示两个 Claude event，旧 selection／locator／Codex ID 均被清除。Layer 与 project-search transition 已由 M2／M3 覆盖。

### M6 — Full validation, performance, documentation, and manual acceptance / 完整验证、性能、文档与手工验收

- [x] Run focused unit and relevant browser tests. / 运行 focused unit 与 relevant browser test。
- [x] Run `npm run build:client`, `npm run build:check`, `npm test`, `npm run test:browser`, `npm run test:package`, and `npm run release:check`. / 运行完整指定 gate。
- [x] Record view switch, overview node/canvas mode, narrative row/group, zoom/pan, Load more, and Timeline round-trip evidence for ~300, ~1,000, and the existing 1,800-event shape. / 对约 300、约 1,000 与既有 1,800-event shape 记录 view switch、overview node／canvas mode、narrative row／group、zoom／pan、Load more 与 Timeline round-trip 证据。
- [x] Perform read-only real-transcript acceptance for ordinary Codex, tool-heavy/Code Mode Codex, Claude Code, and DeepSeek Harness. / 对 ordinary Codex、tool-heavy／Code Mode Codex、Claude Code 与 DeepSeek Harness 做真实 transcript 只读验收。
- [x] Update docs and acceptance checkboxes, then move this plan to `completed/` only after every required outcome is complete. / 更新文档与验收 checkbox；只有全部必需 outcome 完成后才把本 plan 移到 `completed/`。
- [x] Start and verify the acceptance server on `127.0.0.1:17893` from this worktree with the original repository as `--repo`; do not disturb 17892 or 3080. / 从本 worktree 启动并验证 `127.0.0.1:17893` 验收 server，`--repo` 指向原始仓库；不影响 17892 或 3080。

Actual evidence / 实际证据：

- Final focused syntax/build run passed `node --check` for both browser modules, `npm run build:check`, and 106/106 focused tests across projection, i18n, folding, navigation, canonical search targets, event state, search batching, and card lifecycle. / 最终 focused syntax／build run 通过两个 browser module 的 `node --check`、`build:check` 与 106／106 focused tests。
- `npm test` passed 952/952 in 9.80 s. `npm run test:browser` passed 203/203 in 223.87 s, including the complete unchanged Wave 1A–1D, pagination, search, folding, source, and Cache suites plus Trajectory. `npm run test:package` passed installed Codex／Claude Code／DeepSeek Harness smoke in 9.97 s. `npm run release:check` passed in 20.65 s and repeated generated-asset, 952-test, and three-source package verification. / 完整 Node 952／952、browser 203／203、三来源 installed-package smoke 与 release gate 全部通过。
- Final full-browser 1,800-event characterization retained 20 overview descendants and 461 Fit density bins, loaded eleven pages in 1,805 ms, returned to Timeline in 489 ms and Trajectory in 342 ms without a data request, and reached 1,800 individual canvas markers at 16× in 245 ms. Values are local observations, not latency gates. / 最终 full-browser 1,800-event characterization 保持 20 个 overview descendant 与 461 个 Fit density bin；十一页加载 1,805 ms；无数据请求的 Timeline／Trajectory 返回分别为 489／342 ms；245 ms 内在 16× 切到 1,800 个 canvas marker。数值只作本机观察。
- Read-only real ordinary Codex: 9 Main events became 9 narrative rows／0 groups with exact identity, a 20-node overview, working Inspector next synchronization, Protocol-forced Timeline, and restored Main Trajectory. Tool-heavy/Code Mode Codex: 69 events became 8 rows／7 standalone lazy groups with exact identity, a 20-node overview, selected-first zoom, Inspector, and Raw References. / 真实 ordinary Codex 与 tool-heavy／Code Mode Codex 均通过只读验收。
- Read-only real Claude Code exported corpus: the selected 150-event loaded prefix became 74 rows／33 groups with 28 lazy closed groups and exact identity; Load more reached 300 in 93 ms while overview DOM stayed at 20 and switched from markers to density. / 真实 Claude Code exported corpus 首屏与 Load more 验收通过。
- Read-only real DeepSeek Harness: one retained corpus shape projected 150 events as 79 rows／40 groups with 71 selectable tool members; the current-writer Zstandard shape projected 150 as 96 rows／54 lazy groups with exact identity and a 20-node loaded-prefix overview. The current-writer Protocol showed one durable permission preset, sandbox mode, and approval policy row each. No durable approval lifecycle occurred in that selected real corpus, and the four retained DSH Sessions exposed no Code Mode operation; this is “not observed,” while adapter/fixture gates cover both contracts. / 真实 DSH retained 与 current-writer Zstandard 语料通过；permission 三行各观测一条。该真实语料未出现 durable approval lifecycle，四个 retained Session 也未出现 Code Mode operation；这是“未观察到”，不是“不支持”。
- Acceptance server PID 3280 was launched from this production worktree with `--repo G:\vibe\session-analyzer --port 17893`. Final state is HTTP 200, Codex, original project selected, index revision 8; the served `assets/app.js` SHA-256 equals this worktree asset. Prototype 17892 and live DSH 3080 both remained HTTP 200. Playwright's two temporary page snapshots were deleted after acceptance so no real transcript artifact remains in the worktree. / 17893 最终状态与 served asset 均已核验；17892／3080 未受影响；真实 transcript 的临时 snapshot 已删除。

## Validation ledger / 验证台账

| Command or observation / 命令或观察 | Status / 状态 | Evidence / 证据 |
| --- | --- | --- |
| Focused baseline (6 files) | passed | 82 tests, 0 failed / 82 tests，0 failed |
| `npm run build:check` baseline | passed | generated assets current |
| M1 projection tests | passed | 10 tests; exact identity at 300／1,000／1,800 events / 10 tests；300／1,000／1,800 event 精确 identity |
| Relevant Trajectory browser tests | passed | 12 Trajectory-named cases plus context-transition coverage / 12 个 Trajectory 命名 case，另含 context transition |
| `npm run build:client` | passed | generated `public/assets/app.js` from production source |
| `npm run build:check` final | passed | generated assets current |
| `npm test` | passed | 952 tests, 0 failed, 9.80 s |
| `npm run test:browser` | passed | 203 tests, 0 failed, 223.87 s |
| `npm run test:package` | passed | Codex／Claude Code／DeepSeek Harness installed smoke, 9.97 s |
| `npm run release:check` | passed | build check + 952 tests + three-source package smoke, 20.65 s |
| Codex ordinary real transcript | passed | 9 events, 9 rows, 0 groups; navigation／Layer memory passed |
| Codex tool-heavy/Code Mode real transcript | passed | 69 events, 8 rows, 7 groups; zoom／Inspector／Raw passed |
| Claude Code real transcript | passed | 150→300 events; exact identity and constant 20-node overview |
| DeepSeek Harness real transcript | passed | retained + current-writer Zstandard shapes; permission Protocol observed |
| Acceptance server `17893` | passed | HTTP 200; Codex/original repo; served asset hash matches worktree |

## Performance evidence ledger / 性能证据台账

Record actual browser measurements without turning them into permanent product promises. / 记录实际 browser measurement，不把它们变成永久产品承诺。

| Shape / Shape | Overview DOM nodes | Narrative rows/groups | Fit render mode/count | View switch | Zoom/pan | Load more | Timeline round trip |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| ~300 Main events | 20 | 300／0 in alternating narrative shape | density 300 at measured 461 px | no Timeline request | horizontal wheel isolated | explicit and automatic 150→300 passed | 320 shape retained keyed append |
| ~1,000 Main events | 20 | 1,000／0 in alternating narrative shape | density 461; 8× markers 1,000 | no request; state restored | wheel 420 px; drag 536 px; no snapback | 150→1,000 passed | zoom／scroll restored |
| 1,800-event profile shape | 20 | 1,800／0 in alternating narrative shape | density 461; 16× markers 1,800 | Timeline 489 ms; Trajectory 342 ms | four zoom steps 245 ms | 11 pages in 1,805 ms | no extra Timeline request |

## Remaining-risk ledger / 剩余风险台账

- The narrative ledger intentionally retains one reading row per Input/Model/Other event, so its DOM remains proportional to readable narrative volume even though the overview and closed tool members are bounded. The 1,800-event shape is acceptable locally; much larger narrative-dense Sessions may eventually justify ledger virtualization. / Narrative ledger 有意为每个 Input／Model／Other event 保留 reading row；因此即使 overview 与关闭 group member 有界，其 DOM 仍与可读叙事量同比增长。1,800-event shape 本机可接受；更大的 narrative-dense Session 未来可能需要 ledger virtualization。
- A full Trajectory rerender on append is intentionally separate from Wave 1C. The measured 1,800-event work is acceptable but remains the clearest place for a future keyed Trajectory projection if real histories grow substantially. / Trajectory append 的 full rerender 有意独立于 Wave 1C；本次 1,800-event 实测可接受，但若真实历史显著增长，这仍是未来 keyed Trajectory projection 的首要候选。
- Current real DSH acceptance did not contain durable approval lifecycle or Code Mode events. Synthetic/conformance gates pass, but another future real-corpus observation should pressure those display classifications without adding a source-specific renderer. / 当前真实 DSH 验收未包含 durable approval lifecycle 或 Code Mode event；synthetic／conformance gate 已通过，但未来仍应以另一份真实语料施压其 display classification，且不得增加来源专属 renderer。
- Browser canvas behavior is covered at desktop and 390 px mobile widths with DPR-aware rendering, but unusual accessibility zoom or extreme device-pixel configurations remain manual-acceptance territory. / Canvas 已覆盖 desktop 与 390 px mobile，并采用 DPR-aware rendering；异常 accessibility zoom 或极端 device-pixel 配置仍属于手工验收范围。

## Change log / 变更记录

- 2026-09-03 M0: fixed the production base, created the clean worktree/branch, installed reviewed dependencies, captured focused baselines, and established the bilingual domain/product/design/plan contract before coding. / 2026-09-03 M0：固定正式 base，创建 clean worktree／branch，安装已审阅依赖，记录 focused baseline，并在 coding 前建立 bilingual domain／product／design／plan 契约。
- 2026-09-03 M1: added the independent source-neutral projection, strict identity validation, reversible adjacency groups, reliable-turn boundaries, overview sequence/density models, and focused long-shape evidence. / 2026-09-03 M1：增加独立的来源中立 projection、严格 identity validation、可逆 adjacency group、reliable-turn boundary、overview sequence／density model 与 focused long-shape 证据。
- 2026-09-03 M2: added the process-local Main Presentation selector, production narrative ledger, lazy standalone groups, folding consumption, canonical selection/Inspector/Raw integration, Main-only Layer memory, and explicit Timeline-owner retirement/reconciliation. / 2026-09-03 M2：增加 process-local Main Presentation selector、正式 narrative ledger、lazy 独立 group、folding consumption、canonical selection／Inspector／Raw integration、Main-only Layer memory，以及显式 Timeline-owner retirement／reconciliation。
- 2026-09-03 M3: added the three-row bounded canvas overview, loaded-prefix truth, constant selected locator, click/keyboard/Inspector selection synchronization, and project-search deep-target restoration. / 2026-09-03 M3：增加三行有界 canvas overview、真实 loaded-prefix 状态、固定 selected locator、click／keyboard／Inspector selection synchronization 与 project-search deep-target restoration。
- 2026-09-03 M4: added process-local Sequence Zoom state, Fit／`−`／`+`, selected-first and viewport-center anchoring, wheel/pointer free pan, selection bring-into-view, pixel-dependent density/marker canvas rendering, and 1,000／1,800-event browser characterization. / 2026-09-03 M4：增加 process-local Sequence Zoom state、Fit／`−`／`+`、selection-first 与 viewport-center anchor、wheel／pointer free pan、selection bring-into-view、随像素密度切换的 density／marker canvas rendering，以及 1,000／1,800-event browser characterization。
- 2026-09-03 M5: proved canonical search reveal inside lazy groups, structured-filter and Folding Strategy reuse, explicit/automatic pagination, Inspector/project drill-down identity, keyed Timeline append after presentation round-trip, and stale Session/source transition ownership. / 2026-09-03 M5：证明 lazy group 内 canonical search reveal、structured-filter 与 Folding Strategy 复用、显式／自动分页、Inspector／project drill-down identity、presentation 往返后的 keyed Timeline append，以及 stale Session／source transition ownership。
- 2026-09-03 M6: completed bilingual public/repository documentation, all requested release gates, 300／1,000／1,800-event performance evidence, read-only Codex／Claude Code／DeepSeek Harness acceptance, sensitive temporary-artifact cleanup, and a verified persistent 17893 acceptance server. / 2026-09-03 M6：完成 bilingual public／repository 文档、全部指定 release gate、300／1,000／1,800-event performance evidence、只读 Codex／Claude Code／DeepSeek Harness 验收、敏感临时 artifact 清理，以及持久 17893 验收 server 核验。
