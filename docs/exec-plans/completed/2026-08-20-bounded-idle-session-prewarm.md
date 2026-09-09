# Bounded idle Session prewarm v1 / 有界 idle Session 预热 v1

## Status / 状态

- Status: complete; M0–M5 passed with KEEP decision and a fresh final review found no blocker / 状态：已完成；M0 至 M5 通过并决定 KEEP，fresh 最终评审未发现阻塞项
- Started: 2026-08-20 / 开始日期：2026-08-20
- Working branch: `bounded-idle-session-prewarm` / 工作分支：`bounded-idle-session-prewarm`
- Registered worktree: `tmp/worktrees/bounded-idle-session-prewarm` / 已登记工作树：`tmp/worktrees/bounded-idle-session-prewarm`
- Immutable baseline: `690fa80ac677d7f2b45e9ca82751a3d3166bd352` (`perf: reuse verified materialization fingerprint`) / 不可变基线：`690fa80ac677d7f2b45e9ca82751a3d3166bd352`（`perf: reuse verified materialization fingerprint`）
- Parallel boundary: `support-dsh` is read-only and is not an implementation target / 并行边界：`support-dsh` 只读，不是实现目标

## Objective / 目标

Evaluate and, only if the gates pass, retain a conservative source-neutral post-commit prewarm policy that reduces likely first-open latency without delaying Index availability, restoring corpus-wide complete Sessions, changing `indexed-materialized-v1`, or allowing speculative work to delay foreground materialization. / 评估一个保守、来源中立的 post-commit 预热策略；仅在门槛通过时保留它。目标是在不延迟 Index 可用性、不恢复全语料完整 Session、不改变 `indexed-materialized-v1`、也不允许 speculative 工作延迟 foreground 物化的前提下，降低最可能 Session 的首次打开延迟。

## Frozen boundaries / 冻结边界

1. `indexed-materialized-v1`, adapter signatures, `materializationContextFields`, DependencySet semantics, Q↔M parity, Detail Purpose／Responsibility, Raw Reference ownership, freshness, adapter mutation detection, and revision-scoped cache identity remain unchanged. / `indexed-materialized-v1`、adapter signature、`materializationContextFields`、DependencySet 语义、Q↔M 等价、详情用途／职责、Raw Reference ownership、freshness、adapter mutation detection 与 revision-scoped cache identity 均保持不变。
2. Prewarm is owned by the shared runtime owner／revision lifecycle, never by a source adapter or HTTP route pretending to be a browser request. / 预热由共享 runtime owner／revision lifecycle 拥有，绝不由来源 adapter 或伪装成浏览器请求的 HTTP route 拥有。
3. The global active-one scheduler remains; no worker, extra concurrency, second cache, persistence, LRU, eviction, or cross-revision transfer is introduced. / 保留全局 active-one scheduler；不引入 worker、额外并发、第二 cache、持久化、LRU、eviction 或跨 revision 转移。
4. Automatic prewarm intentionally adds bounded resident cache. Foreground-opened Sessions retain existing no-eviction semantics and may grow the cache beyond the prewarm admission budget; therefore the v1 budget is not a hard total-cache ceiling. / 自动预热会有意增加有界 resident cache。Foreground 打开的 Session 保持既有 no-eviction 语义，并可能使 cache 超过预热 admission budget；因此 v1 budget 不是硬性的总 cache 上限。
5. The optional neighbor-after-open strategy is not implemented in v1. / v1 不实现可选的“打开后预热相邻 Session”策略。

## M0 evidence / M0 证据

### Baseline and startup audit / 基线与启动审计

- The remote default branch was resolved as `main@2f282a94cc9eb3ce03fded4f8867e0d120a599aa`; its latest `README.md` and `AGENTS.md` were read before worktree creation. / 远端默认分支确认为 `main@2f282a94cc9eb3ce03fded4f8867e0d120a599aa`；创建工作树前已读取其最新 `README.md` 与 `AGENTS.md`。
- Baseline `690fa80...` contains the accepted three-pass Materialized fingerprint path and content-free `AsyncLocalStorage` materialization observer. / 基线 `690fa80...` 包含已接受的 Materialized 三 pass fingerprint 路径与不含内容的 `AsyncLocalStorage` materialization observer。
- Server flow is validation → `installIndexRevision` → successful project status. Browser flow is successful status → `/api/sessions?sort=updated-desc` → first visible root → immediate timeline request. Prewarm must therefore be scheduled after revision install and must never be awaited by project success. / Server 流程为 validation → `installIndexRevision` → 成功项目状态；浏览器流程为成功状态 → `/api/sessions?sort=updated-desc` → 第一个可见 root → 立即请求 timeline。因此预热必须在 revision install 后调度，且项目成功不得等待预热。
- The process-global scheduler currently has one active slot and FIFO foreground admission. The owner coalesces same-Session jobs, aborts an unobserved job after its final waiter leaves, and retirement clears cache plus queued／active work. / 进程全局 scheduler 当前有一个 active slot 与 FIFO foreground admission。Owner 会合并同 Session job，在最后 waiter 离开后 abort 无观察者 job，并在 retirement 时清空 cache 及 queued／active 工作。

### Content-free real-corpus measurement / 不含内容的真实语料测量

One production-path Codex build against the local repository indexed 496 Sessions. Build／commit validation took `238,181.43／21,875.67 ms`; this goal will not repeat the preceding cold-path attribution project. Session identities, paths, titles, prompts, commands, and content were not emitted. / 针对本地仓库的一次生产路径 Codex 构建索引了 496 个 Session；build／commit validation 为 `238,181.43／21,875.67 ms`。本目标不重复上一轮冷路径归因项目；未输出 Session identity、path、title、prompt、command 或内容。

| Recency rank / 新近度排名 | Source bytes / 来源 bytes | Raw／Logical | Estimate / 估算 | Baseline cold／warm / 基线冷／热 | Policy result / 策略结果 |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 (browser first / 浏览器首选) | 5,072,644 | 1,681／1,201 | 7,167,236 | 3,213.04／0.10 ms | eligible / 可准入 |
| 2 | 213,112 | 45／40 | 281,208 | 85.60／0.06 ms | eligible / 可准入 |
| 6 | 27,397,693 | 713／624 | 28,405,821 | not opened in M0 / M0 未打开 | eligible if reached / 若到达则可准入 |
| 7 | 88,799,611 | 15,819／13,145 | 110,363,515 | intentionally not opened / 有意不打开 | skip individual cap / 跳过单项上限 |

The first two candidates total 7,448,444 estimated bytes, preserve exact warm object identity, and each invoke the adapter once. The existing estimate is conservative enough to distinguish the 110.36 MiB outlier without source-specific fields. / 前两个 candidate 合计估算 7,448,444 bytes，保持精确 warm object identity，且各只调用一次 adapter。既有估算无需来源专属字段即可保守地区分 110.36 MiB outlier。

## Selected v1 policy / 已选 v1 策略

| Bound / 边界 | v1 value / v1 值 | Reason / 理由 |
| --- | ---: | --- |
| Initial post-commit delay / 初始 post-commit delay | 150 ms | Gives project-status and immediate browser selection a foreground head start without becoming a large fixed wait. / 给项目状态与浏览器立即选择提供 foreground 先手，同时不是大额固定等待。 |
| Candidate cap / Candidate 上限 | 2 | Required conservative starting point; M0 shows a useful likely hit at rank 1. / 需求指定的保守起点；M0 表明 rank 1 有有用的潜在 hit。 |
| Recent scan window / 最近扫描窗口 | 8 | Allows an oversized recent candidate to be skipped without walking arbitrarily old history merely to fill a quota. / 允许跳过过大的近期 candidate，同时不会仅为凑数遍历任意旧历史。 |
| Revision-cache admission budget / Revision cache admission budget | 96 MiB | Middle of the requested 64–128 MiB range; checks existing foreground and prewarmed cache together before every candidate. / 位于要求的 64–128 MiB 中间；每个 candidate 前共同检查既有 foreground 与 prewarm cache。 |
| Individual estimate cap / 单项估算上限 | 48 MiB | Prevents one candidate from consuming more than half the v1 budget; M0 skips the 110.36 MiB outlier while retaining a 28.41 MiB recent candidate. / 防止一个 candidate 消耗超过 v1 budget 一半；M0 会跳过 110.36 MiB outlier，同时保留 28.41 MiB 近期 candidate。 |
| Speculative concurrency / Speculative 并发 | 1 active or pending globally / 全局 active 或 pending 至多 1 | Preserves the active-one memory envelope and makes preemption deterministic. / 保持 active-one 内存边界并使 preemption 可确定验证。 |

Candidate ordering copies the source-neutral default Session list order: stable descending `updatedAt || startedAt`, retaining canonical Index order for equal timestamps. Cached candidates are skipped. Too-large or over-budget candidates are skipped while scanning only the first eight; successful, promoted, preempted, or failed attempts count toward the cap, while simple skips do not. / Candidate 顺序复制来源中立的默认 Session 列表顺序：按 `updatedAt || startedAt` 稳定降序，同 timestamp 保留规范 Index 顺序。已缓存 candidate 跳过；过大或超 budget candidate 会被跳过，但只扫描前八项；成功、被 promote、被 preempt 或失败的尝试计入上限，简单 skip 不计入。

## Foreground-preemption contract / Foreground 抢占契约

1. Same Session: `prewarm(A)` active／queued followed by foreground `get(A)` adds a foreground waiter, marks the shared job foreground-observed, removes speculative-only ownership, and keeps the same materialization. No duplicate and no abort. / 同 Session：active／queued 的 `prewarm(A)` 后发生 foreground `get(A)` 时，向共享 job 加入 foreground waiter、标记为 foreground-observed、移除 speculative-only ownership，并继续同一次物化；不重复、不 abort。
2. Different Session: foreground `get(B)` removes queued speculative A or aborts active speculative A when A has no foreground waiter; B starts when cancellation reaches the scheduler's safe settlement checkpoint. / 不同 Session：foreground `get(B)` 会移除 queued speculative A，或在 A 无 foreground waiter 时 abort active speculative A；B 在 cancellation 到达 scheduler 安全 settlement checkpoint 后启动。
3. Cancelling speculative interest aborts the underlying job only when no foreground waiter remains. / 取消 speculative interest 只会在没有 foreground waiter 时 abort 底层 job。
4. Prewarm failures, stale results, contract failures, preemption, and retirement are silent structured outcomes; they do not mutate project status or create an HTTP／UI error. / Prewarm failure、stale 结果、契约失败、preemption 与 retirement 都是静默 structured outcome；不会改变 project status 或产生 HTTP／UI error。

Explicit M0 answer: if prewarm begins A while the browser requests A, the proposed owner API coalesces and promotes the same job. It does not duplicate or abort A. / M0 明确回答：若预热 A 开始时浏览器同时请求 A，拟议 owner API 会合并并 promote 同一 job；不会重复或 abort A。

## Milestones and gates / 里程碑与门槛

| Milestone / 里程碑 | Deliverable / 交付物 | Gate / 门槛 | Status / 状态 |
| --- | --- | --- | --- |
| M0 — Verify and select policy / 核验并选择策略 | Baseline, owner／scheduler and browser audit, content-free recent-candidate measurement, concrete v1 bounds / 基线、owner／scheduler 与浏览器审计、不含内容的近期 candidate 测量、明确 v1 边界 | Contract remains stable; measured estimates justify a conservative experiment / 契约保持稳定；实测估算支持保守实验 | Complete / 已完成 |
| M1 — Ownership and preemption / Ownership 与抢占 | Explicit speculative waiter, promotion, different-Session preemption, silent outcome, owner metrics／observation / 显式 speculative waiter、promotion、不同 Session 抢占、静默 outcome、owner metric／观测 | Ten required owner cases deterministic and no source branch / 十个必需 owner case 可确定验证且无来源分支 | Complete / 已完成 |
| M2 — Post-commit policy / Post-commit 策略 | Revision-owned delayed sequential candidate runner shared by startup, selection, reindex, replacement / Revision 拥有的延迟、顺序 candidate runner，共享于 startup、selection、reindex、replacement | Project success never awaits prewarm; retirement cancels timer／active work / 项目成功不等待预热；retirement 取消 timer／active 工作 | Complete / 已完成 |
| M3 — Deterministic tests / 确定性测试 | Cache identity, promotion, preemption ordering, budget, retirement, failure silence, single-speculative coverage / Cache identity、promotion、抢占顺序、budget、retirement、失败静默、单 speculative 覆盖 | Focused owner／revision／server／contract suites pass / 聚焦 owner／revision／server／contract suite 通过 | Complete; covered again by full Node 631／631 / 已完成；完整 Node 631／631 再次覆盖 |
| M4 — Browser and full validation / 浏览器与完整验证 | Browser scenarios A–E, aggregate memory／CPU／latency evidence, release and package gates / 浏览器 A 至 E 场景、聚合内存／CPU／latency 证据、release 与 package 门槛 | `release:check`, complete browser, generated parity, package smoke, `git diff --check` pass / `release:check`、完整 browser、generated parity、package smoke、`git diff --check` 通过 | Complete / 已完成 |
| M5 — Experiment decision / 实验决策 | KEEP, KEEP BUT ADJUST POLICY, or REJECT with explicit DeepSeek contract answer / KEEP、KEEP BUT ADJUST POLICY 或 REJECT，并明确回答 DeepSeek 契约问题 | Fresh read-only full-diff review has no blocker / Fresh 只读完整 diff 评审无 blocker | Complete; KEEP accepted by fresh final review / 已完成；fresh 最终评审接受 KEEP |

## Planned implementation ownership / 计划实现 ownership

- `src/materialized-session-owner.js`: speculative／foreground waiter semantics, promotion, preemption, cache estimate admission facts, content-free metrics. / speculative／foreground waiter 语义、promotion、preemption、cache estimate admission facts、不含内容 metric。
- `src/index-revision-lease.js`: revision-owned timer／runner and post-install scheduling seam. / revision 拥有的 timer／runner 与 post-install scheduling seam。
- `server.js`: provide the existing source-neutral materializer to the revision policy after successful install without awaiting it. / 成功 install 后向 revision policy 提供既有来源中立 materializer，且不 await。
- Existing observer: fixed phase／state／duration events only; no Session identifiers or content. / 既有 observer：只使用固定 phase／state／duration event；不含 Session identity 或内容。

## Files materially changed / 实质变更文件

- `src/materialized-session-owner.js` — speculative waiter identity, queued／active foreground preemption, same-Session promotion, idle waiting, ordinary-cache origin counters. / speculative waiter identity、queued／active foreground 抢占、同 Session promotion、idle 等待、普通 cache 来源 counter。
- `src/session-prewarm.js` — closed v1 policy, stable recent ordering, sequential budgeted runner, revision wakeup scheduling／cancellation, content-free observation. / 封闭 v1 policy、稳定近期顺序、顺序且有 budget 的 runner、revision wakeup 调度／取消、不含内容观测。
- `src/index-revision-lease.js`, `server.js` — retirement cancellation and one post-validation／post-install scheduling seam shared by startup, selection, reindex, and replacement. / retirement 取消，以及 startup、selection、reindex、replacement 共享的单一 post-validation／post-install 调度 seam。
- `package.json`, `test/package.test.js` — publish the new runtime module. / 发布新 runtime module。
- `test/materialized-session-owner.test.js`, `test/session-prewarm.test.js`, `test/index-revision-server.test.js` — deterministic ownership, policy, budget, revision, silent-failure, observer, and post-commit behavior. / 确定性 ownership、policy、budget、revision、静默失败、observer 与 post-commit 行为。
- `e2e/browser.test.js` — four production-path Chromium scenarios plus two test-only atomic-settlement fixes for pre-existing suite-load races; unrelated e2e fixtures default prewarm off, while dedicated scenarios explicitly enable it. / 四条 production-path Chromium 场景，以及两个针对既有 suite-load race 的 test-only 原子 settle 修正；无关 e2e fixture 默认关闭 prewarm，专用场景显式启用。
- Product spec, lifecycle design, no-eviction debt tracker, this active plan, and `AGENTS.md` — aligned bilingual behavior, design, evidence, debt, and plan navigation. / Product spec、lifecycle design、no-eviction debt tracker、本 active plan 与 `AGENTS.md` — 对齐双语行为、设计、证据、债务与 plan 导航。

## Validation ledger / 验证账本

- M0 real-corpus content-free short profile: complete; 496 Sessions, two selected candidates, exact warm identity, one adapter call each. / M0 真实语料不含内容短 profile：完成；496 个 Session、两个选中 candidate、精确 warm identity、各一次 adapter 调用。
- M1–M3 initial focused matrix: `78／78` pass across owner, policy, revision, server, observer, canonical contract, and package manifest; the final default-policy assertion is additionally covered by the full Node suite. It directly asserts queued and active different-Session preemption ordering, same-Session promotion, exact cache identity, silent failure, existing-cache budget reduction, single speculative work, pending／active retirement, and content-free observation. / M1 至 M3 初始聚焦矩阵在 owner、policy、revision、server、observer、canonical contract 与 package manifest 上通过 `78／78`；最终 default-policy 断言另由完整 Node suite 覆盖。它直接断言 queued 与 active 的不同 Session 抢占顺序、同 Session promotion、精确 cache identity、静默失败、既有 cache 压缩 budget、单 speculative 工作、pending／active retirement 与不含内容观测。
- Broader focused source／replacement／conformance matrix: `180／180` pass. / 更广泛的 source／replacement／conformance 聚焦矩阵通过 `180／180`。
- Final hardening `npm.cmd run release:check`: generated assets current, Node `631／631`, installed Codex and Claude package smoke pass. / 最终硬化后的 `npm.cmd run release:check`：generated asset 当前、Node `631／631`、安装后的 Codex 与 Claude package smoke 通过。
- Final owner／policy／revision／server／observer／contract／package focused matrix after warning isolation and budget-stop hardening: `81／81` pass; the four dedicated Chromium scenarios also reran `4／4` pass. / warning isolation 与 budget-stop 硬化后的最终 owner／policy／revision／server／observer／contract／package 聚焦矩阵通过 `81／81`；四条专用 Chromium 场景也重跑通过 `4／4`。
- Exact complete `npm.cmd run test:browser`: `121／121` pass in `288,459.59 ms`, including four new production-path prewarm scenarios. / 精确完整 `npm.cmd run test:browser`：以 `288,459.59 ms` 通过 `121／121`，包括四条新增 production-path prewarm 场景。
- Controlled browser: hit headers `58.54 → 9.46 ms` (`-83.8%`), hit release-to-paint `199.77 ms`, foreground-beats-timer headers `58.54 ms` with one call total, wrong-prediction abort-to-foreground `0.39 ms`, oversized top candidate skipped. / 受控浏览器：hit headers `58.54 → 9.46 ms`（`-83.8%`）、hit release-to-paint `199.77 ms`、foreground 先于 timer 时 headers `58.54 ms` 且总计一次调用、错误预测 abort-to-foreground `0.39 ms`、超大 top candidate 被跳过。
- Real 496-Session profile: two prewarms `2,253.92 ms`, adapter `2,250.13 ms`, CPU user／system `1,312／16 ms`, estimate `9,409,136` bytes, forced-GC heap `+15,690,672`, sampled RSS `-131,072`, peak RSS unchanged; first two visible roots hit `2／2` with zero extra adapter calls. / 真实 496-Session profile：两项预热 `2,253.92 ms`、adapter `2,250.13 ms`、CPU user／system `1,312／16 ms`、估算 `9,409,136` bytes、forced-GC heap `+15,690,672`、采样 RSS `-131,072`、peak RSS 不变；前两个可见 root 命中 `2／2`，额外 adapter 调用为零。

## M5 decision / M5 决策

**KEEP.** The v1 policy materially reduces a controlled likely cold open, bounds automatic resident growth, remains behind a 150-ms idle gate, yields the active-one slot to foreground with sub-millisecond controlled handoff, and preserves exact ordinary cache identity. No count, budget, size cap, scan window, or delay adjustment is justified by current evidence. / **KEEP。** v1 policy 显著降低受控的 likely cold open，限制自动 resident 增长，保持在 150-ms idle gate 之后，以受控的亚毫秒 handoff 把 active-one slot 交给 foreground，并保持精确普通 cache identity。当前证据不支持调整 count、budget、size cap、scan window 或 delay。

The mechanism is entirely source-neutral: shared code branches only on the already-stabilized lifecycle kind, candidate facts are canonical Indexed Session fields, and adapters receive no prewarm hook or signature change. The exact `indexed-materialized-v1` contract consumed by the parallel DeepSeek Harness remains unchanged. / 该机制完全来源中立：共享代码只按已稳定的 lifecycle kind 分支，candidate facts 仅来自规范 Indexed Session 字段，adapter 不接收 prewarm hook 或 signature 变化。并行 DeepSeek Harness 消费的精确 `indexed-materialized-v1` 契约保持不变。

## Fresh final review / Fresh 最终评审

- A fresh read-only Sol xhigh review inspected the complete tracked plus untracked tree after final hardening and returned **no findings, no blocker**. / Fresh 只读 Sol xhigh 评审在最终硬化后检查了完整 tracked 加 untracked tree，结论为 **无发现、无阻塞项**。
- It independently confirmed that the implementation is entirely source-neutral, changes neither adapter contracts nor the exact `indexed-materialized-v1` lifecycle contract, and lets the DeepSeek Harness integrate without adapter redesign, a prewarm hook, descriptor／signature changes, source branches, or a second cache API. / 评审独立确认：实现完全来源中立，既不改变 adapter contract，也不改变精确的 `indexed-materialized-v1` lifecycle contract；DeepSeek Harness 无需 adapter redesign、prewarm hook、descriptor／signature 变化、来源分支或第二套 cache API 即可集成。
- It confirmed the concurrency, retirement, budget, cache-identity, observer-privacy, and package boundaries and agreed that the evidence supports **KEEP**. / 评审确认 concurrency、retirement、budget、cache identity、observer privacy 与 package 边界，并同意现有证据支持 **KEEP**。
- Independent checks passed focused owner／policy and canonical／observer／adapter-contract suites, syntax checks, whitespace checks, and the untracked-file review. The final project validation remained `release:check` with Node `631／631`, both installed package smokes, exact browser `121／121`, and dedicated Chromium `4／4`. / 独立检查通过聚焦 owner／policy 与 canonical／observer／adapter-contract suite、syntax check、whitespace check 及 untracked-file review；项目最终验证保持为 `release:check`（Node `631／631`、两个 installed package smoke）、精确 browser `121／121` 与专用 Chromium `4／4`。

## Completion / 完成

M0–M5 are complete, all frozen boundaries remain intact, the experiment decision is **KEEP**, and no follow-up policy adjustment is required for v1. The separate no-eviction concern remains recorded in the tech-debt tracker rather than being hidden in this experiment. / M0 至 M5 已完成，所有冻结边界保持完整，实验决策为 **KEEP**，v1 无需后续策略调整。独立的 no-eviction 问题继续记录在 tech-debt tracker 中，而不是隐藏在本实验内。
