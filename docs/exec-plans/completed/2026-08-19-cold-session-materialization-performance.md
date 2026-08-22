# Cold Session materialization performance / 冷 Session 物化性能

## Status / 状态

- Status: complete; M0–M4 and fresh read-only final review passed with no findings or blocker / 状态：已完成；M0 至 M4 与 fresh 只读最终评审均通过，无 finding 或 blocker
- Started: 2026-08-19 / 开始日期：2026-08-19
- Working branch: `cold-session-materialization-performance` / 工作分支：`cold-session-materialization-performance`
- Registered worktree: `tmp/worktrees/cold-session-materialization-performance` / 已登记工作树：`tmp/worktrees/cold-session-materialization-performance`
- Integration baseline: `towards-0.2.0` at merge commit `3e3d4dbc4a76b52fbe149aaa7f7a37e7e1c1e054` / 集成基线：`towards-0.2.0` 的 merge commit `3e3d4dbc4a76b52fbe149aaa7f7a37e7e1c1e054`
- Parallel branch boundary: `support-dsh` is read-only and is not an implementation target / 并行分支边界：`support-dsh` 只读，不是实现目标
- Git state: the coherent M0–M4 diagnostics, one-pass optimization, docs, and tests are unstaged; no staged change or goal commit exists / Git 状态：一致的 M0 至 M4 诊断、单 pass 优化、文档与测试尚未暂存；不存在暂存变更或本 goal commit

## Objective / 目标

Measure and explain cold Session-open latency introduced by the accepted Indexed／Materialized Session lifecycle, then implement only the smallest evidence-backed source-neutral improvement that preserves the exact `indexed-materialized-v1` adapter contract, source freshness, mutation detection, Q↔M parity, revision ownership, cancellation, and the lifecycle's memory benefits. / 测量并解释已接受 Indexed／Materialized Session 生命周期引入的冷 Session 打开延迟；随后只实现有证据支持的最小来源中立改进，同时保持精确的 `indexed-materialized-v1` adapter 契约、来源 freshness、mutation detection、Q↔M 等价、revision ownership、cancellation 及该生命周期的内存收益。

## Frozen boundaries / 冻结边界

1. The committed Index does not regain complete Raw／Logical Session graphs or eager corpus-wide materialization. / 已提交 Index 不恢复完整 Raw／Logical Session 图，也不进行全语料 eager 物化。
2. Materialized Sessions remain source-backed, revision-scoped, atomically retired, exact-cache/coalescing owned, and fail closed on stale, cancellation, or contract error. / Materialized Session 继续由来源支撑、绑定 revision、原子 retire、由精确 cache／coalescing 管理，并在 stale、取消或契约错误时 fail closed。
3. Detail Purpose／Responsibility, Raw References, DependencySet meaning, materialization context, Q↔M responsibility, adapter non-mutation, and `MATERIALIZATION_CONTRACT_VIOLATION` remain unchanged. / 详情用途／职责、Raw Reference、DependencySet 含义、materialization context、Q↔M 职责、adapter 不可 mutation 与 `MATERIALIZATION_CONTRACT_VIOLATION` 保持不变。
4. Shared runtime receives no Codex／Claude／DeepSeek performance branch. The parallel third adapter consumes the stabilized contract through later normal integration. / 共享 runtime 不增加 Codex／Claude／DeepSeek 性能分支；并行第三 adapter 以后通过正常集成消费稳定契约。
5. No broad prefetch, persistent Materialized storage, LRU／eviction, arbitrary scheduler concurrency increase, validation removal, cancellation weakening, or unrelated timeline virtualization belongs to this goal. / 本目标不包含广泛 prefetch、持久 Materialized 存储、LRU／eviction、任意提高 scheduler 并发、移除校验、削弱取消或无关时间线虚拟化。

## Milestones and gates / 里程碑与门槛

| Milestone / 里程碑 | Deliverable / 交付物 | Gate / 门槛 | Status / 状态 |
| --- | --- | --- | --- |
| M0 — Reproduce and attribute / 复现与归因 | Content-free end-to-end phase model; small／medium／large／largest cold and warm; A→B queueing; switch-away cancellation; controlled pre-lifecycle comparison where practical / 不含内容的端到端 phase 模型；small／medium／large／largest 冷／热；A→B 排队；切走取消；可行时做受控生命周期前对照 | Dominant real costs classified A–F before production optimization / 生产优化前把真实主因分类为 A 至 F | Complete / 已完成 |
| M1 — Design checkpoint / 设计检查点 | Per-dominant-phase invariant, duplication, complexity, allocation, cancellation, source-neutrality, and cheaper-equivalent analysis / 按主导 phase 记录 invariant、重复、复杂度、分配、取消、来源中立性与更便宜等价方案 | Stop for fresh Sol xhigh review if the preferred design changes a stabilized contract or ownership boundary / 若首选设计改变稳定契约或 ownership 边界，停止并请求 fresh Sol xhigh 评审 | Complete; no contract checkpoint triggered / 已完成；未触发契约检查点 |
| M2 — Smallest shared optimization / 最小共享优化 | One evidence-backed responsibility-boundary improvement at a time with deterministic operation-count and correctness coverage / 每次一个有证据支持的职责边界改进，并增加确定性 operation-count 与正确性覆盖 | Exact cold／warm parity, error codes, cancellation, cache identity, freshness, replacement, and Q↔M parity / 精确冷／热等价、错误码、取消、cache identity、freshness、replacement 与 Q↔M 等价 | Complete / 已完成 |
| M3 — Browser workflow / 浏览器工作流 | Cold loading, warm reopen, quick switch-away, no stale flash, no misleading cancellation error, replacement safety / 冷 loading、热重开、快速切走、无 stale 闪现、无误导取消错误、replacement 安全 | Focused browser automation and content-free timings pass / 聚焦浏览器自动化与不含内容 timing 通过 | Complete / 已完成 |
| M4 — Performance and release gate / 性能与发布门槛 | Before／after phase table, queue/cancel/cache/memory evidence, index-memory envelope, full required validation / 前后 phase 表、queue／cancel／cache／memory 证据、Index 内存边界、完整必需验证 | Focused suites, `release:check`, full browser, package smoke, generated-client parity, and `git diff --check` pass / 聚焦 suite、`release:check`、完整 browser、package smoke、生成 client 等价与 `git diff --check` 通过 | Complete / 已完成 |
| Final review / 最终评审 | Freeze candidate head or exact working-tree diff; fresh read-only full base-to-head review / 冻结 candidate head 或精确 working-tree diff；fresh 只读完整 base-to-head 评审 | Reviewer explicitly confirms unchanged `indexed-materialized-v1` contract for the parallel DeepSeek adapter / 评审显式确认并行 DeepSeek adapter 可在不重做契约的情况下消费该变更 | Complete; no findings or blocker / 已完成；无 finding 或 blocker |

## M0 phase ledger / M0 phase 账本

The initial phase inventory is deliberately broader than the existing aggregate hooks. Exact function ownership and instrumentation availability are still under audit. / 初始 phase 清单有意宽于既有聚合 hook；仍在审计精确函数 ownership 与 instrumentation 可用性。

| Phase / 阶段 | Required evidence / 所需证据 | Current state / 当前状态 |
| --- | --- | --- |
| Browser selection → timeline fetch / 浏览器选择到 timeline fetch | monotonic request owner, abort reason/time, request start / 单调 request owner、abort 原因／时间、请求开始 | Code path audited: each new request aborts its prior owner; real browser-to-socket timing remains to measure / 代码路径已审计：每个新请求都会中止其旧 owner；仍需实测浏览器到 socket 的 timing |
| Revision capture and owner admission / revision 捕获与 owner 准入 | revision, hit/miss/coalesced, queue depth, wait/start / revision、hit／miss／coalesced、queue depth、wait／start | Owner counters and active-one scheduler semantics audited; A→B measurements pending / 已审计 owner counter 与 active-one scheduler 语义；A→B 测量待完成 |
| Adapter verify/read/parse/finalize / adapter 校验／读取／解析／finalize | accepted bytes, rows, bounded timings, abort observation / accepted bytes、row、有界 timing、abort observation | Content-free Codex／Claude observer added for verification read, stream, parse CPU, read wait, canonical construction, and finalization; focused tests pass / 已为 Codex／Claude 增加不含内容的 verification read、stream、parse CPU、read wait、canonical construction 与 finalization 观测；聚焦测试通过 |
| Shared canonical/private validation / 共享 canonical／private 校验 | separate timings and full-graph pass counts / 分离 timing 与完整图遍历次数 | Admission phases are separately observable; deterministic pass accounting still pending / admission phase 已可独立观测；确定性 pass 计数仍待完成 |
| Fingerprint capture → Q↔M projection → recheck / 指纹捕获到 Q↔M 投影再到复核 | timings, chunk/pass counts, allocation, cancellation boundary / timing、chunk／pass 次数、分配、取消边界 | Existing hooks extended to one content-free materialization callback with safe observer isolation; cancellation boundary tests pass / 既有 hook 已扩展为统一、不含内容且故障隔离的 materialization callback；取消边界测试通过 |
| Cache commit → timeline query → HTTP serialization / cache 提交到 timeline query 再到 HTTP 序列化 | commit time, query time, response bytes, server flush/end / commit 时间、query 时间、response bytes、server flush／end | Server path audited; dedicated end-to-end timing pending / server 路径已审计；专用端到端 timing 待完成 |
| Browser parse/process → first useful paint / 浏览器解析／处理到首次有效绘制 | response end, JSON completion, state commit, render, paint／Long Task / response 结束、JSON 完成、state commit、render、paint／Long Task | Source-backed real Chromium timing complete for cold, warm reopen, and cold switch-away; no stale DOM or visible cancellation error / source-backed 真实 Chromium 已完成冷开、warm 重开与冷切走 timing；无 stale DOM 或可见取消错误 |

M0 is now closed. The observer accounts for `99.99%+` of cold owner time in every measured class; browser and HTTP measurements cover the remaining end-to-end path. / M0 现已闭合；observer 在每个测量等级中都解释了 `99.99%+` 的冷 owner 时间，浏览器与 HTTP 测量覆盖其余端到端路径。

| Class／ordinal / 等级／序位 | Source bytes | Raw／Logical | Adapter | Canonical shape | Private validation | Outer fingerprint capture＋recheck | Q↔M projection | Cold／warm owner | Peak heap over before |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Small／50 | 229,263 | 96／63 | 14.82 ms | 1.54 ms | 59.79 ms | 52.53 ms | 3.38 ms | 136.19／0.15 ms | 40.92 MB |
| Medium／247 | 863,896 | 388／244 | 34.88 ms | 2.22 ms | 159.45 ms | 144.83 ms | 7.61 ms | 353.08／0.07 ms | 56.31 MB |
| Large／445 | 6,168,172 | 640／565 | 135.57 ms | 14.64 ms | 288.78 ms | 268.58 ms | 19.03 ms | 730.24／0.06 ms | 89.75 MB |
| Largest／494 | 116,936,717 | 8,749／6,351 | 3,408.01 ms | 33.49 ms | 3,172.80 ms | 3,169.06 ms | 131.19 ms | 9,919.43／0.07 ms | 198.09 MB |

- Adapter decomposition for the largest Session: source stream `2,642.03 ms`, of which record parse CPU is `2,175.68 ms` and read wait is `466.33 ms`; accepted-prefix verification `135.93 ms`; canonical construction `543.32 ms`; source finalization `85.95 ms`. / 最大 Session 的 adapter 分解：source stream `2,642.03 ms`，其中 record parse CPU `2,175.68 ms`、read wait `466.33 ms`；accepted-prefix verification `135.93 ms`；canonical construction `543.32 ms`；source finalization `85.95 ms`。
- Cold A→cold B with global active-one: A large materialization `702.30 ms`; B medium queue wait `698.96 ms`, own materialization `295.75 ms`, total `994.71 ms`; admission saw one active and one queued job; both then cached. / 全局 active-one 下 cold A→cold B：A 大型物化 `702.30 ms`；B 中型排队 `698.96 ms`、自身物化 `295.75 ms`、总计 `994.71 ms`；准入时一个 active、一个 queued，随后两者均进入 cache。
- Direct quick switch after A entered source stream: abort observation `0.41 ms`, B queue wait `0.96 ms`; A admitted no cache and no completion; only B completed and cached. / A 进入 source stream 后直接快速切换：abort observation `0.41 ms`、B 排队 `0.96 ms`；A 未进入 cache 且未 completion；仅 B 完成并缓存。
- Real Chromium quick switch: switch occurred `7.70 ms` after A request start; A fetch rejected with `AbortError` after `46.60 ms` and never committed DOM; B first useful paint was `109.70 ms`; final heading and all `40` cards belonged to B; visible error count was zero. / 真实 Chromium 快速切换：A 请求开始 `7.70 ms` 后切换；A fetch 于 `46.60 ms` 后以 `AbortError` reject 且从未提交 DOM；B 首次有效绘制为 `109.70 ms`；最终标题及全部 `40` 张卡片属于 B；可见错误数为零。
- Controlled pre-lifecycle comparison on one unchanged `6,937,418`-byte／`1,800`-event fixture produced exact identical `847,336` timeline response bytes: resident-complete first request `91.42 ms`; indexed/materialized cold `1,531.25 ms`; indexed/materialized warm median `27.73 ms`; cold causal delta `1,439.83 ms`. / 在同一不变 `6,937,418`-byte／`1,800`-event fixture 上的生命周期前对照产生精确相同的 `847,336` timeline response bytes：resident-complete 首请求 `91.42 ms`；indexed/materialized 冷请求 `1,531.25 ms`；indexed/materialized warm 中位数 `27.73 ms`；冷路径因果增量 `1,439.83 ms`。
- Real Chromium cold fixture: request-to-headers `1,670.20 ms`, JSON `2.40 ms`, DOM commit `41.40 ms`, paint after DOM `15.30 ms`, request-to-first-useful-paint `1,729.30 ms`; warm reopen request-to-paint `68.10 ms`. / 真实 Chromium 冷 fixture：请求到 headers `1,670.20 ms`、JSON `2.40 ms`、DOM commit `41.40 ms`、DOM 后 paint `15.30 ms`、请求到首次有效绘制 `1,729.30 ms`；warm 重开请求到绘制 `68.10 ms`。

### M0 classification / M0 分类

1. **B — shared post-materializer validation dominated (primary).** Private validator guarding plus the outer fingerprint capture／recheck consumes about `82.5%` small, `86.2%` medium, `76.3%` large, and `63.9%` largest cold owner time. Canonical shape validation and Q↔M projection are individually small; repeated whole-graph fingerprints are the measured center. / **B — 共享 post-materializer validation 主导（主要）。** private validator guard 与外层 fingerprint capture／recheck 合计约占 small `82.5%`、medium `86.2%`、large `76.3%`、largest `63.9%` 的冷 owner 时间。canonical shape validation 与 Q↔M projection 各自很小；重复全图指纹才是实测中心。
2. **A — source re-read／parse dominated (secondary at the extreme).** Adapter work is about `10.9%` small, `9.9%` medium, `18.6%` large, and `34.4%` largest; the largest adapter is parse／construction dominated rather than verification-read dominated. / **A — 来源重读／解析主导（极端样本中的次要主因）。** adapter 工作约占 small `10.9%`、medium `9.9%`、large `18.6%`、largest `34.4%`；最大 adapter 由 parse／construction 而不是 verification read 主导。
3. **C — global scheduler queue dominated (conditional sequential case).** B inherits almost all remaining A time while A is live, but prompt last-waiter cancellation reduces that queue to under `1 ms`. / **C — 全局 scheduler 排队主导（有条件的连续场景）。** A 存活时 B 几乎继承 A 的全部剩余耗时，但及时取消最后 waiter 可把该排队降至 `1 ms` 内。
4. **D／E／F are not dominant in the reproduced workflow.** Browser cancellation is authoritative; timeline payload／JSON and browser render add tens of milliseconds rather than the measured cold seconds. / **D／E／F 在已复现工作流中不占主导。** 浏览器取消具权威性；timeline payload／JSON 与浏览器 render 只增加几十毫秒，而非实测的冷路径数秒。

## M1 decision packet / M1 决策包

- Purpose／invariant: the private guard rejects mutation by `validateMaterializedPrivateState` before query work; the final guard rejects mutation by query-presentation logic; Q↔M digest equality proves exact indexed projection parity. / 用途／不变量：private guard 在 query 工作前拒绝 `validateMaterializedPrivateState` mutation；final guard 拒绝 query-presentation logic mutation；Q↔M digest 相等证明精确 indexed projection 等价。
- Duplication／complexity: the complete Materialized Session is fingerprinted four times—private capture, private recheck, separate outer capture, final outer recheck. Each is O(complete Session object graph plus Raw／Logical payload text), yields every 4,096 operations, and allocates transient hash／identity state but no second event graph. / 重复／复杂度：完整 Materialized Session 被 fingerprint 四次——private capture、private recheck、独立 outer capture、最终 outer recheck。每次都是 O(完整 Session object graph 加 Raw／Logical payload text)，每 4,096 operations yield，并分配 transient hash／identity state，但不创建第二份 event graph。
- Selected cheaper equivalent: after successful private recheck, return its already verified Materialized Session fingerprint internally and reuse it as the pre-Q↔M baseline; retain private recheck and final post-projection recheck. This removes exactly one complete pass. / 选定的更便宜等价方案：private recheck 成功后，在内部返回已经验证的 Materialized Session fingerprint，并复用为 Q↔M 前 baseline；保留 private recheck 与最终 post-projection recheck。这样精确移除一次完整 pass。
- Cancellation／errors: add an explicit abort check at the reuse boundary; private mutation still fails before projection and keeps its cause precedence; query mutation／unverifiable state keeps final recheck and stable `MATERIALIZATION_CONTRACT_VIOLATION`. / 取消／错误：在复用边界显式检查 abort；private mutation 仍在 projection 前失败并保持 cause 优先级；query mutation／不可验证状态保留最终 recheck 与稳定 `MATERIALIZATION_CONTRACT_VIOLATION`。
- Source neutrality／contract: no adapter signature, private-field declaration, materialization context, DependencySet, Indexed／Materialized ownership, freshness, Q↔M responsibility, cache, revision, or source branch changes. The mandatory contract-level Sol checkpoint is not triggered. / 来源中立／契约：不改变 adapter signature、private-field 声明、materialization context、DependencySet、Indexed／Materialized ownership、freshness、Q↔M 职责、cache、revision 或 source branch；不触发强制 contract-level Sol 检查点。
- Rejected for this milestone: removing private recheck or combining both hooks behind only one final check, because query logic could then run on a graph already mutated by the private hook and error attribution would change. / 本 milestone 拒绝：移除 private recheck，或只在两个 hook 后做一次最终检查；因为 query logic 可能在已被 private hook mutation 的 graph 上运行，且错误归责会改变。

The authoritative bilingual decision is also recorded in `docs/design-docs/indexed-materialized-session-lifecycle.md`. M1 is satisfied; M2 must begin with deterministic phase／operation-count coverage before the central path is edited. / 权威双语决策也已记录于 `docs/design-docs/indexed-materialized-session-lifecycle.md`。M1 已满足；M2 必须先增加确定性 phase／operation-count 覆盖，再编辑中央路径。

## M2 result / M2 结果

- Implementation: `invokeReadOnlyMaterializationValidatorAsync` returns only the selected already captured and successfully rechecked guarded fingerprint; strict materialization reuses it after an explicit abort check. The separate `materialized_fingerprint_capture` traversal is gone and a near-zero `materialized_fingerprint_reuse` boundary replaces it. / 实现：`invokeReadOnlyMaterializationValidatorAsync` 仅返回选定、已 capture 且成功 recheck 的 guarded fingerprint；strict materialization 在显式 abort 检查后复用它。独立 `materialized_fingerprint_capture` 遍历已消失，替换为近零成本 `materialized_fingerprint_reuse` 边界。
- Deterministic test: old code failed because it still emitted fingerprint-capture operations; new code proves zero outer-capture operations, equal private capture／recheck operation totals, a retained final recheck, exact phase order, and cancellation at the reuse boundary. / 确定性测试：旧代码因仍产生 fingerprint-capture operation 而失败；新代码证明 outer-capture operation 为零、private capture／recheck operation 总数相等、保留最终 recheck、phase 顺序精确，并覆盖 reuse 边界取消。
- Fixed-fixture causal result: indexed/materialized cold HTTP `1,531.25 → 1,201.43 ms` (`-329.82 ms`, `-21.5%`); resident-adjusted lifecycle cold delta `1,439.83 → 1,129.10 ms` (`-310.74 ms`, `-21.6%`); exact `847,336` response-byte parity retained and warm stayed within run noise. / 固定 fixture 因果结果：indexed/materialized 冷 HTTP `1,531.25 → 1,201.43 ms`（`-329.82 ms`、`-21.5%`）；经同轮 resident 调整的生命周期冷增量 `1,439.83 → 1,129.10 ms`（`-310.74 ms`、`-21.6%`）；保持精确 `847,336` response-byte 等价，warm 维持在运行噪声内。
- Same real Sessions: medium `353.08 → 268.35 ms` (`-24.0%`); upper-decile large `730.24 → 563.88 ms` (`-22.8%`); largest `9,919.43 → 8,269.83 ms` (`-16.6%`, `-1,649.60 ms`). Largest removed phase was `1,584.51 ms`; reuse was `0.005 ms`. / 同一真实 Session：medium `353.08 → 268.35 ms`（`-24.0%`）；上十分位 large `730.24 → 563.88 ms`（`-22.8%`）；largest `9,919.43 → 8,269.83 ms`（`-16.6%`、`-1,649.60 ms`）。largest 被移除 phase 原为 `1,584.51 ms`；reuse 为 `0.005 ms`。
- The lower-decile ordinal selected a different evolving Session and is not used for causal comparison. The after sample was `229,311` bytes／`48` Raw／`37` Logical at `72.33／0.15 ms`. / 低十分位序位因语料演进选中了不同 Session，不用于因果对照；after sample 为 `229,311` bytes／`48` Raw／`37` Logical，冷／热 `72.33／0.15 ms`。
- Queue／cancel/cache after: cold A materialization `574.70 ms`; B queue `571.25 ms`; quick switch abort observation `0.51 ms`, B queue `1.09 ms`, only B cached; largest cancellation settled `7.40 ms` after scheduling and admitted nothing. / after queue／cancel／cache：cold A 物化 `574.70 ms`；B 排队 `571.25 ms`；快速切换 abort observation `0.51 ms`、B 排队 `1.09 ms`、仅缓存 B；largest 取消调度后 `7.40 ms` settle 且未准入任何结果。
- Memory: the default-heap 494-Session build still completes; forced-GC committed heap is `57,105,648` bytes. Same large transient heap fell `89.75 → 66.20 MB`; largest transient heap `198.09 → 199.39 MB` is effectively unchanged at this sampling granularity; cache/retirement deltas remain bounded. / 内存：默认 heap 的 494-Session build 仍完成；强制 GC 后 committed heap 为 `57,105,648` bytes。同一 large transient heap 从 `89.75 → 66.20 MB`；largest 从 `198.09 → 199.39 MB`，在本采样粒度下实质不变；cache／retirement 增量继续有界。

## M3 result / M3 结果

- The unchanged 6.94 MiB fixture's real-Chromium cold request-to-first-useful-paint improved `1,729.30 → 1,467.80 ms` (`-261.50 ms`, `-15.1%`). Request-to-headers improved `1,670.20 → 1,367.30 ms`; after-run JSON／DOM／paint was `5.30／73.00／22.20 ms`, including one 73-ms Long Task. / 同一不变 6.94 MiB fixture 的真实 Chromium 冷请求到首次有效绘制从 `1,729.30 → 1,467.80 ms`（`-261.50 ms`、`-15.1%`）。请求到 headers 从 `1,670.20 → 1,367.30 ms`；after-run JSON／DOM／paint 为 `5.30／73.00／22.20 ms`，含一个 73-ms Long Task。
- Warm reopen remained stable at `68.10 → 65.90 ms`, rendered 150 cards, and showed no visible error. / warm 重开稳定在 `68.10 → 65.90 ms`，绘制 150 张卡片且无可见错误。
- In-flight switch remained authoritative: switch `7.80 ms` after A request start; A fetch rejected with `AbortError` after `49.40 ms`, never committed DOM; B painted in `108.30 ms`; final heading／40 cards belonged only to B; visible error count zero. / in-flight 切换继续具权威性：A 请求开始 `7.80 ms` 后切换；A fetch 于 `49.40 ms` 后以 `AbortError` reject，未提交 DOM；B 于 `108.30 ms` 绘制；最终标题／40 张卡片仅属于 B；可见错误数为零。
- Browser sessions, automatic snapshots, exact temporary server processes, and synthetic fixture directories were closed or removed after verification. / 验证后已关闭或移除浏览器 session、自动 snapshot、精确临时 server process 与合成 fixture 目录。

## M4 result / M4 结果

- `npm.cmd run release:check` passed. Generated client assets are current; the complete Node suite passed `615／615`; installed-package smoke passed for Codex and Claude Code. / `npm.cmd run release:check` 通过。生成 client asset 为最新；完整 Node suite 通过 `615／615`；Codex 与 Claude Code 安装包 smoke 通过。
- `npm.cmd run test:browser` passed `117／117` twice; the final exact-candidate rerun completed in `151,504.06 ms`. Coverage includes busy retry, rapid Session replacement, intentional timeline abort, stale revision response discard, source replacement, detail／Raw cancellation, and complete search／pagination workflows. / `npm.cmd run test:browser` 两次通过 `117／117`；最终精确候选重跑耗时 `151,504.06 ms`。覆盖 busy retry、快速 Session replacement、主动 timeline abort、stale revision response 丢弃、来源替换、detail／Raw 取消及完整 search／pagination 工作流。
- Focused M2 matrix passed `175／175`; changed-file `node --check` passed; `git diff --check` passed with line-ending warnings only. / M2 聚焦矩阵通过 `175／175`；变更文件 `node --check` 通过；`git diff --check` 通过，仅有换行符提示。
- Source-neutral sweep found no new Codex／Claude branch in the shared observer／reuse path. `support-dsh` appears only in this plan's read-only boundary statements and was not modified. / 来源中立 sweep 未在共享 observer／reuse 路径发现新增 Codex／Claude 分支。`support-dsh` 仅出现在本 plan 的只读边界声明中，未被修改。
- The candidate remains an exact unstaged working-tree diff on branch `cold-session-materialization-performance`, baseline `3e3d4dbc...`; Git staging／commit is not required for semantic completion. / 候选仍是 `cold-session-materialization-performance` 分支上相对 baseline `3e3d4dbc...` 的精确未暂存工作树 diff；语义完成不依赖 Git stage／commit。

## Baseline evidence / 基线证据

- The exact integration baseline was independently fetched and verified: `origin/towards-0.2.0` points to `3e3d4dbc4a76b52fbe149aaa7f7a37e7e1c1e054`, merge parents `6f8fa085...` and `7218eba9...`. / 已独立 fetch 并确认精确集成基线：`origin/towards-0.2.0` 指向 `3e3d4dbc4a76b52fbe149aaa7f7a37e7e1c1e054`，merge parent 为 `6f8fa085...` 与 `7218eba9...`。
- The source checkout used to create the worktree was clean and was not `support-dsh`. / 创建 worktree 的来源 checkout 干净，且不是 `support-dsh`。
- Clean baseline `npm test` passed `609／609` in about `19.47 s` before instrumentation. / 在加入观测前，干净 baseline `npm test` 以约 `19.47 s` 通过 `609／609`。
- Node is `v24.18.1`; npm is `12.0.2`; exposed default V8 heap limit is `2,348,810,240` bytes. / Node 为 `v24.18.1`；npm 为 `12.0.2`；默认暴露的 V8 heap 上限为 `2,348,810,240` bytes。
- Real Codex corpus baseline: `494` Sessions, `75,146` Main／`146,159` Protocol／`307,590` Raw rows, `1,067,374,069` query-store bytes; build `115,370.17 ms`, ownership validation `10,380.30 ms`, total `125,750.47 ms`. / 真实 Codex 语料 baseline：`494` 个 Session、`75,146` Main／`146,159` Protocol／`307,590` Raw row、`1,067,374,069` query-store bytes；build `115,370.17 ms`、ownership validation `10,380.30 ms`、总计 `125,750.47 ms`。
- Lower-decile baseline (`229,263` source bytes, `96` Raw, `63` Logical): cold／warm `145.23／0.16 ms`, exactly one adapter call and exact warm identity. / 低十分位 baseline（`229,263` source bytes、`96` Raw、`63` Logical）：冷／热 `145.23／0.16 ms`，精确一次 adapter 调用且 warm identity 精确一致。
- Largest baseline (`116,936,717` source bytes, `8,749` Raw, `6,351` Logical): cold／warm `10,368.95／0.20 ms`; private validation `3,428.18 ms`, fingerprint capture `1,640.95 ms`, projection `133.20 ms`, fingerprint recheck `1,613.80 ms`; these shared post-materializer phases total `6,816.12 ms`, leaving about `3,552.83 ms` for adapter, canonical validation, and other then-unobserved work. / 最大 Session baseline（`116,936,717` source bytes、`8,749` Raw、`6,351` Logical）：冷／热 `10,368.95／0.20 ms`；private validation `3,428.18 ms`、fingerprint capture `1,640.95 ms`、projection `133.20 ms`、fingerprint recheck `1,613.80 ms`；这些共享 post-materializer phase 共 `6,816.12 ms`，adapter、canonical validation 与当时未观测工作约剩 `3,552.83 ms`。
- Largest cancellation at verification rejected the waiter in `0.85 ms`, settled the job in `1.59 ms`, admitted no cache entry, and recorded zero completion. / 最大 Session 在 verification 阶段取消时，waiter 于 `0.85 ms` 内 reject，job 于 `1.59 ms` 内 settle，未写入 cache，completion 为零。
- Largest observed transient heap over pre-open was `195,213,440` bytes; post-cache retained heap delta was `37,072,488` bytes; lower-decile post-cache heap delta was `715,480` bytes. / 最大 Session 相对打开前的观测 transient heap 为 `195,213,440` bytes；cache 后保留 heap 增量为 `37,072,488` bytes；低十分位 cache 后 heap 增量为 `715,480` bytes。

## Current decisions / 当前决定

1. M0 instrumentation is retained as safe, opt-in, content-free diagnostics with behavior-neutral tests. / M0 instrumentation 作为安全、可选、不含内容的诊断保留，并由行为中立测试覆盖。
2. Browser cancellation was measured as authoritative and is unchanged; no scheduler or browser production change was needed. / 浏览器取消经测量具有权威性且保持不变；无需修改 scheduler 或 browser 生产逻辑。
3. Existing aggregate hooks and profilers were extended instead of creating a competing profiling model. / 已扩展既有聚合 hook 与 profiler，没有创建竞争性 profiling 模型。
4. The active-one global scheduler remains unchanged. / 全局 active-one scheduler 保持不变。
5. Phase observers are best-effort and content-free, run only when explicitly supplied, and cannot change success／failure. Source adapters receive them through async context rather than a contract-signature change. / phase observer 为显式启用、尽力而为且不含内容，不能改变成功／失败；source adapter 通过 async context 接收，而不改变契约签名。

## Files materially changed / 已实质变更文件

- `docs/exec-plans/active/2026-08-19-cold-session-materialization-performance.md` — authoritative bilingual progress ledger / 权威双语进度账本
- `docs/design-docs/indexed-materialized-session-lifecycle.md` — M0 evidence and M1 pass-reuse decision／contract-impact record / M0 证据与 M1 pass 复用决策／契约影响记录
- `src/materialization-observer.js` — opt-in, content-free, failure-isolated async observation context / 可选、不含内容、故障隔离的异步观测上下文
- `src/source-adapters.js` — complete strict-admission phase boundaries plus one verified fingerprint reuse, without adapter-signature change / 完整 strict-admission phase 边界及一次已验证 fingerprint 复用，且不改变 adapter 签名
- `src/codex.js`, `src/claude.js` — source-specific read／parse／construction phase observation / 来源专属 read／parse／construction phase 观测
- `scripts/project-query-store-profile.js` — consumes full materialization phases and reports attributed versus unattributed cold time / 消费完整 materialization phase 并报告已归因与未归因冷耗时
- `scripts/cold-session-lifecycle-comparison.js` — exact-payload controlled resident-complete versus indexed/materialized HTTP comparison / exact-payload 受控 resident-complete 与 indexed/materialized HTTP 对照
- `package.json`, `test/package.test.js` — include the runtime observer in the published manifest / 将 runtime observer 纳入发布清单
- `test/materialization-observer.test.js`, `test/canonical-contract.test.js` — behavior-neutrality and exact phase coverage / 行为中立与精确 phase 覆盖
- `test/project-query-store-profile.test.js` — deterministic candidate selection and bounded comparison arguments / 确定性候选选择与有界对照参数
- `test/claude.test.js` — non-empty Claude source-stream observer event-shape coverage / 非空 Claude source-stream observer event shape 覆盖

## Tests and profiling actually executed / 已实际执行的测试与 profiling

- Before instrumentation: `npm test` — `609／609` pass. / 观测代码前：`npm test` — `609／609` 通过。
- Real-corpus aggregate profile: `node --expose-gc scripts/project-query-store-profile.js --source codex --repo <repo> --repeats 3` — completed with redacted, content-free output; key measurements are recorded above. / 真实语料聚合 profile：同命令已完成，输出已脱敏且不含内容；关键数据记录于上。
- Extended real-corpus profile with four classes, A→B queueing, quick switch, and largest cancellation — completed; all selected Session ids remained redacted. / 带四等级、A→B 排队、快速切换与最大取消的扩展真实语料 profile 已完成；所有选中 Session id 均保持脱敏。
- Controlled lifecycle comparison against detached `6f8fa085...` parent — exact response parity and causal cold delta proven on one content-free fixture. / 对 detached `6f8fa085...` parent 的受控生命周期对照已完成；在一个不含内容 fixture 上证明 exact response 等价与冷路径因果增量。
- Playwright CLI／Chromium — cold first useful paint, warm reopen, and in-flight A→B switch measured; final DOM and visible-error assertions pass. Temporary browser snapshots, fixture, and server were removed; exact server process was stopped. / Playwright CLI／Chromium — 已测量冷首次有效绘制、warm 重开与进行中 A→B 切换；最终 DOM 与可见错误断言通过。临时浏览器 snapshot、fixture 与 server 已清理；精确 server process 已停止。
- After observation changes: `node --check` on all changed runtime／profile files — pass; focused Node suites (`materialization-observer`, canonical contract, Codex materialization, Claude, profile, package) — `106／106` pass in about `7.72 s`; `git diff --check` — pass with line-ending warnings only. / 观测变更后：所有变更 runtime／profile 文件的 `node --check` 通过；聚焦 Node suite（observer、canonical contract、Codex materialization、Claude、profile、package）以约 `7.72 s` 通过 `106／106`；`git diff --check` 通过，仅有换行符警告。
- M2 pass-reuse focused matrix — `175／175` pass; the new deterministic test first failed on the old outer capture and then passed after reuse. / M2 pass 复用聚焦矩阵通过 `175／175`；新的确定性测试先在旧 outer capture 上失败，复用后通过。
- After profiles — fixed exact fixture, four-class real corpus, queue, quick switch, largest cancellation, and memory evidence all completed with content-free output. / After profile 已完成固定精确 fixture、真实四等级、queue、快速切换、largest 取消与内存证据，输出均不含内容。
- `npm.cmd run release:check` — passed three times, including after the final Claude diagnostic correction and after review follow-ups; generated-client parity, Node `615／615`, package smoke for both installed adapters. / `npm.cmd run release:check` 三次通过，包括最终 Claude 诊断修正之后及评审 follow-up 之后；包含 generated-client 等价、Node `615／615`、两个已安装 adapter 的 package smoke。
- `npm.cmd run test:browser` — passed `117／117` twice; final exact-candidate run about `151.50 s`. / `npm.cmd run test:browser` 两次通过 `117／117`；最终精确候选运行约 `151.50 s`。
- Final changed-file syntax, source-neutrality sweep, temporary-process cleanup, and `git diff --check` — pass. / 最终变更文件语法、来源中立 sweep、临时 process 清理与 `git diff --check` 均通过。

## Final review and residual notes / 最终评审与剩余说明

- Fresh Sol xhigh read-only review of the exact tracked plus untracked candidate returned no findings and no blocker. It confirmed that adapter signatures and contract definitions are unchanged; the private validator still captures and rechecks guarded inputs; query projection retains its final full-graph recheck and abort／digest admission check; and freshness, ownership, revision leasing, cache／coalescing, retirement, and error precedence remain intact. / 对精确 tracked 加 untracked 候选进行的 fresh Sol xhigh 只读评审无 finding、无 blocker。评审确认 adapter signature 与契约定义未变；private validator 仍 capture 并 recheck guarded input；query projection 仍保留最终完整 graph recheck 与 abort／digest admission check；freshness、ownership、revision leasing、cache／coalescing、retirement 与错误优先级均保持不变。
- The reviewer explicitly confirmed that the parallel DeepSeek Harness adapter can consume the result without redesign: `indexed-materialized-v1` and the descriptor contract are unchanged, the shared implementation adds no source-kind branch, and optional observation uses async context rather than a changed materializer signature. / 评审明确确认并行 DeepSeek Harness adapter 可在无需重新设计的情况下消费该结果：`indexed-materialized-v1` 与 descriptor 契约未变，共享实现未增加 source-kind 分支，可选观测通过 async context 传递而未改变 materializer signature。
- The reviewer independently reran the final contract／profile corrections and passed `34／34`; the expensive full suites were not redundantly repeated during review. / 评审独立重跑最终 contract／profile 修正并通过 `34／34`；评审期间未重复执行昂贵的完整 suite。
- Source parse remains a measured secondary cost for the largest Session and is intentionally outside this one-change milestone; no unmeasured source optimization is implied. / 最大 Session 的 source parse 仍是已测量次要成本，并有意不属于本次单一变更 milestone；不暗示任何未经测量的来源优化。
- The parallel DeepSeek adapter was not present in this branch and its tests were not run; acceptance is based on the review-confirmed unchanged stabilized contract. / 并行 DeepSeek adapter 不在本分支中，未运行其测试；验收依据是评审已确认稳定契约保持不变。

## Completion / 完成

M0–M4, current validation, and the independent final review are complete. This plan is archived; the coherent implementation remains unstaged for user review and an optional later commit. / M0 至 M4、当前验证与独立最终评审均已完成。本 plan 已归档；一致的实现仍保持未暂存，供用户审阅并可选择后续提交。
