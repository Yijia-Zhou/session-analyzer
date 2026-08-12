# Index memory and runtime reliability / 索引内存与运行时可靠性

## Objective / 目标

Reduce the retained and peak memory of Codex repository indexing by keeping source JSONL as the lossless source of truth and committing only explicit compact projections, while preserving timeline, search, analysis, fork ownership, structured detail, Raw Layer, image preview, reindex, cancellation, and failure behavior. / 以来源 JSONL 作为无损事实来源，只提交显式紧凑投影，从而降低 Codex 仓库索引的常驻内存与峰值内存，同时保持时间线、搜索、分析、分叉 ownership、结构化详情、原始层、图片预览、重建索引、取消与失败行为。

## Status and ownership / 状态与负责人

- Owner: lead agent; one architecture owner and normally one writer / 负责人：主 agent；保持单一架构 owner，通常只保留一个 writer
- Status: active / 状态：进行中
- Started: 2026-08-12 / 开始日期：2026-08-12
- Base: `v0.1.4-development` at `83e8a71b9dacd13ba20877a5f38c6469af3e6d50` / 基线：`v0.1.4-development` 的 `83e8a71b9dacd13ba20877a5f38c6469af3e6d50`
- Worktree: registered Git worktree on branch `memory-runtime-reliability`; the primary worktree remains untouched / 工作树：登记在 Git 中、位于 `memory-runtime-reliability` 分支的专用 worktree；主工作树保持不动
- Related product spec: `docs/product-specs/session-transcript-analyzer.md` / 相关产品规格：`docs/product-specs/session-transcript-analyzer.md`
- Related designs: `docs/design-docs/logical-event-timeline.md`, `docs/design-docs/timeline-loading-and-rendering-performance.md`, `docs/design-docs/transcript-source-adapters.md` / 相关设计：`docs/design-docs/logical-event-timeline.md`、`docs/design-docs/timeline-loading-and-rendering-performance.md`、`docs/design-docs/transcript-source-adapters.md`

## Evidence-backed problem statement / 基于证据的问题陈述

### Confirmed source-code facts / 已确认的源码事实

1. Codex parsing is line-streamed with `createReadStream` and `readline`; the problem is not whole-file input buffering. Each parsed record is nevertheless retained as `session.rawEvents[*].parsed`, and every retained Raw Record remains reachable from the committed index. / Codex 解析使用 `createReadStream` 与 `readline` 逐行流式进行；问题不是整文件输入缓冲。但每条解析记录仍作为 `session.rawEvents[*].parsed` 保留，且每条常驻原始记录都可从已提交索引到达。
2. Logical Events, Code Mode presentation indexes, and search structures retain derived strings, scalar facts, Raw References, and locators, not aliases to the original parsed record graph. `sessions` and `sessionsById` point to the same Sessions, and same-project reindex shallow-copies Session shells while sharing unchanged Raw and Logical arrays. / 逻辑事件、Code Mode presentation index 与搜索结构保留派生字符串、标量事实、原始引用与 locator，不会别名引用原始 parsed record 对象图。`sessions` 与 `sessionsById` 指向同一批会话；同项目重建索引会浅拷贝 Session shell，同时共享未变化的 Raw 与 Logical 数组。
3. Codex structured detail and Raw Layer detail are synchronous and currently consume resident parsed records. The source-neutral Raw Reference route and Codex image-preview route already re-read source rows asynchronously. / Codex 结构化详情与原始层详情当前为同步构建，并直接消费常驻 parsed record。来源中立的原始引用 route 与 Codex 图片预览 route 已经会异步重读来源行。
4. Image externalization proves the intended ownership boundary: resident parsed data is already markerized rather than lossless, while source-backed Raw re-read is authoritative. Normal detail hydration has no equivalent batch reader or freshness contract yet. / 图片外置已经证明预期 ownership 边界：常驻 parsed 数据本来就是 marker 化而非无损数据，而来源支撑的 Raw 重读才是权威来源。普通详情 hydration 尚无等价的批量 reader 或 freshness 契约。
5. Materialized fork inference still reads a few parsed fields, although the required facts are small: session metadata identity/ancestry, record shape, canonical copied-prefix digests, timestamps, and Raw/Logical references. Title and review finalization similarly need small explicit facts rather than full payload trees. / 物化式分叉推断仍读取少量 parsed 字段，但真正需要的事实很小：session metadata identity／ancestry、record shape、规范 copied-prefix digest、timestamp 与 Raw／Logical 引用。标题与 review finalization 同样只需要少量显式事实，而非完整 payload tree。
6. The current server replaces `state.index` only after a successful non-aborted build, so failure normally preserves the old committed index. A cancelled job can still be overwritten to `failed` by a later non-`AbortError` rejection. / 当前服务端只会在 build 成功且未 abort 后替换 `state.index`，因此普通失败会保留旧的 committed index。但已取消 job 仍可能被较晚到达的非 `AbortError` rejection 覆盖成 `failed`。
7. Codex reuse currently accepts an unchanged file by size plus ISO mtime. A synthetic same-size/same-mtime rewrite reproduced stale Raw/Logical reuse, which can disagree with source-backed Raw re-read. / Codex reuse 当前只根据文件大小与 ISO mtime 接受未变化文件。合成的同大小、同 mtime 重写已复现过期 Raw／Logical 复用，且它可能与来源支撑的 Raw 重读不一致。
8. No committed runtime memory diagnostics currently record memory, heap limit, phase timing, or useful peak summaries. / 当前没有已提交的运行时内存诊断记录 memory、heap limit、阶段耗时或有用峰值摘要。

### Tests and reviews actually executed / 已实际执行的测试与审计

- Full Node baseline after making the existing dependency tree visible inside the isolated worktree: 432/432 passed. The first attempt passed 431/432 and failed only because the isolated worktree had no local `node_modules/highlight.js/LICENSE`; no product test failed. / 在隔离 worktree 内可见既有依赖树后，完整 Node 基线为 432/432 通过。第一次尝试为 431/432，通过项之外的唯一失败是隔离 worktree 缺少本地 `node_modules/highlight.js/LICENSE`；没有产品测试失败。
- Independent read-only audits covered source-object retention, detail/Raw/image ownership, and reindex/fork/failure lifecycle. The reindex/fork audit additionally executed 98 focused tests, all passing. / 独立只读审计覆盖 source object 留存、detail／Raw／image ownership，以及 reindex／fork／failure lifecycle；其中 reindex／fork 审计还实际运行了 98 项聚焦测试，全部通过。

### Measurements actually observed / 已实际观察的测量

Measurements used a sensitive local corpus only as read-only input. Only aggregate values are recorded here; transcripts, raw dumps, heap snapshots, prompts, and local source paths remain uncommitted. Counts varied slightly while active source files grew. / 测量只把敏感本地语料作为只读输入。此处只记录聚合值；transcript、raw dump、heap snapshot、prompt 与本地来源路径均不提交。由于活跃来源文件持续增长，计数存在轻微变化。

- Runtime: Node `v24.18.1`; default V8 `heap_size_limit` 2,348,810,240 bytes. / 运行时：Node `v24.18.1`；默认 V8 `heap_size_limit` 为 2,348,810,240 bytes。
- Default-heap cold indexing reproducibly terminated with fatal V8 OOM after about 31 seconds; the final reported GC retained about 2.04 GiB. Raw stderr remains local crash evidence. / 默认 heap 冷索引在约 31 秒后可复现 fatal V8 OOM；最后一次 GC 报告约 2.04 GiB 常驻。原始 stderr 只作为本地崩溃证据保留。
- A completed cold baseline under a temporary 6 GiB old-space limit indexed 451 Sessions, about 240k Raw Records, about 165k Logical Events, and about 805 MB candidate bytes in 31.5 seconds. Peak `heapUsed` was 2.59 GB and post-GC `heapUsed` was 2.45 GB. All Raw Records retained `parsed`. / 临时使用 6 GiB old-space limit 完成的冷基线索引了 451 个会话、约 24 万条原始记录、约 16.5 万条逻辑事件与约 805 MB candidate bytes，耗时 31.5 秒。峰值 `heapUsed` 为 2.59 GB，post-GC `heapUsed` 为 2.45 GB；所有 Raw Record 均保留 `parsed`。
- A no-change build reused 448 of 451 files in 4.9 seconds, but old and new builds overlapped and peak `heapUsed` reached 2.63 GB; post-GC remained 2.50 GB. / 无变化 build 在 4.9 秒内复用了 451 个文件中的 448 个，但新旧 build 发生重叠，峰值 `heapUsed` 达到 2.63 GB；post-GC 仍为 2.50 GB。
- Releasing only `raw.parsed` in an uncommitted process experiment reduced post-GC `heapUsed` from 2.46 GB to 1.97 GB. Rebuilding Raw Records from a conservative explicit runtime whitelist reduced it to 1.61 GB, about 26% below the default heap limit. / 在未提交的进程实验中，只释放 `raw.parsed` 会把 post-GC `heapUsed` 从 2.46 GB 降至 1.97 GB；按保守显式运行时白名单重建 Raw Record 后降至 1.61 GB，比默认 heap limit 低约 26%。

### Current inference / 当前推断

The primary proven resident-memory lifecycle problem is the full parsed record retained under every Raw Record, plus fields retained after their parse/finalization role has ended. Removing only `parsed` is useful but does not provide adequate default-heap headroom on the measured corpus. The smallest meaningful structural boundary is therefore source-backed detail hydration plus per-Session construction of new compact Raw objects from an explicit whitelist. / 已证明的首要常驻内存生命周期问题，是每条 Raw Record 下保留完整 parsed record，以及部分字段在 parse／finalization 角色结束后仍继续常驻。只删除 `parsed` 虽有收益，但对实测语料无法提供充分的默认 heap 余量。因此，最小且有意义的结构边界是：detail 由来源 hydration 支撑，并按 Session 从显式白名单构造新的紧凑 Raw 对象。

The corpus-level fix is expected to work because parsing is already streaming and Sessions are much smaller than the aggregate project. A single Session larger than the default heap remains a residual risk to measure and document, not a reason to expand this goal into a persistent database or lazy Session working set. / 该 corpus 级修复预计有效，因为解析本身已流式进行，单个 Session 远小于整个项目聚合。单个 Session 本身超过默认 heap 仍是需要测量与记录的残余风险，但不构成本目标扩展到持久化数据库或 lazy Session working set 的理由。

## Required invariants / 必须保持的不变量

1. Source JSONL remains the lossless source of truth and is never modified. / 来源 JSONL 继续作为无损事实来源，且绝不被修改。
2. Main, Protocol, Raw, search, filters, counts, analysis, title inference, Raw References, and Raw fork segments keep their current meaning. / Main、Protocol、Raw、搜索、筛选、计数、分析、标题推断、原始引用与 Raw fork segment 保持当前含义。
3. Structured detail remains equivalent for conversation, reasoning, planning, commands, patches, direct/custom/MCP tools, Code Mode, goals, review, web search, lifecycle/protocol, and Raw records. / conversation、reasoning、planning、command、patch、direct／custom／MCP tool、Code Mode、goal、review、web search、lifecycle／protocol 与 Raw record 的结构化详情保持等价。
4. Hydrated records pass through the same parse-time image externalization and Raw normalization as indexing before detail construction. / hydrated record 在构建 detail 前必须通过与索引阶段相同的图片外置与 Raw normalization。
5. Materialized fork inference remains fail-closed and continues to use pre-externalization canonical digest evidence where currently required. / 物化式分叉推断继续 fail closed，并在当前需要的位置继续使用图片外置前的 canonical digest 证据。
6. A failed or cancelled replacement build never mutates or replaces the old committed index. Shared unchanged arrays are compact and treated as immutable. / 失败或取消的替换 build 绝不修改或替换旧 committed index。共享的未变化数组必须已紧凑化并按 immutable 处理。
7. The committed Codex index has no reachable full parsed source-record graph after successful build. / 成功 build 后，已提交 Codex index 中不得存在可到达的完整 parsed source-record 对象图。
8. This work does not optimize Claude resident memory, redesign full-text search, reopen source switching, change browser UX, or perform release work. / 本工作不优化 Claude 常驻内存、不重做全文搜索、不重启 source switching、不改变浏览器 UX，也不开展 release 工作。

## Execution milestones and gates / 执行里程碑与门禁

### M0 — Runtime diagnostics and frozen baseline / 运行时诊断与冻结基线

- Add opt-in `--log-dir` lifecycle diagnostics without changing index semantics. Record throttled JSONL phase/progress samples, durations, file/byte/session/Raw/Logical/reuse counts, `rss`, `heapUsed`, `heapTotal`, `external`, `arrayBuffers`, V8 heap limit, and process-local peaks. / 增加 opt-in `--log-dir` lifecycle diagnostics，不改变索引语义。以节流 JSONL 记录 phase／progress sample、duration、file／byte／Session／Raw／Logical／reuse count、`rss`、`heapUsed`、`heapTotal`、`external`、`arrayBuffers`、V8 heap limit 与进程内峰值。
- Keep fatal OOM stderr authoritative. Diagnostic output directories and real-corpus artifacts stay ignored and uncommitted. / fatal OOM 继续以 stderr 为权威证据。诊断输出目录与真实语料 artifact 保持 ignored 且不提交。
- Add synthetic tests for CLI validation, log creation, throttling/final summaries, successful completion, failure, and cancellation. / 增加 CLI 校验、日志创建、节流／最终摘要、成功、失败与取消的合成测试。
- Gate: focused diagnostics tests, then full Node suite. / 门禁：先运行聚焦诊断测试，再运行完整 Node suite。

### M1 — Source-backed Codex detail hydration / 来源支撑的 Codex detail hydration

- Make the source-adapter detail boundary index-aware and awaitable; keep source dispatch out of `server.js`. / 让 source adapter 的 detail 边界感知 index 且可 await；不在 `server.js` 增加来源分支。
- Add a bounded per-file batch line reader so all Raw References for one detail request hydrate in one scan rather than one scan per reference. / 增加有界的按文件批量行 reader，使一次 detail 请求的所有原始引用只扫描每个文件一次，而不是每个引用扫描一次。
- Store a compact exact source-line digest in each Codex Raw projection. On hydration, require locator ownership and digest equality before parsing. / 在每个 Codex Raw projection 中保存紧凑且精确的来源行 digest。Hydration 时先要求 locator ownership 与 digest 相等，再进行解析。
- Freshness contract: unchanged source hydrates; append-only growth hydrates only indexed rows whose exact digest still matches; rewrite, shrink, line shift, missing row, or invalid locator fails explicitly as stale and requests reindex. No changed row is presented as the committed snapshot. / freshness 契约：未变化来源可 hydration；append-only growth 只允许 hydrate digest 仍精确匹配的已索引行；rewrite、shrink、line shift、缺失行或无效 locator 明确以 stale 失败并要求 reindex。不得把已变化记录呈现为 committed snapshot。
- Feed hydrated source rows through the same externalization and `makeRawEvent` normalization used at index time, then call the existing source-specific detail builder. / 把 hydrated 来源行送入与索引时相同的 externalization 与 `makeRawEvent` normalization，再调用既有来源专属 detail builder。
- Preserve source-backed Raw Reference readback and image preview; converge them on the same row-freshness validation where practical. / 保持来源支撑的 Raw Reference readback与图片预览；在可行处让它们收敛到相同的行 freshness 校验。
- Gate: representative old-resident versus hydrated-detail deep equivalence for every supported detail family, Raw record equivalence including image markers versus lossless Raw re-read, stale-source matrix, batch-scan assertion, focused suites, then full Node suite. Runtime detail must no longer require permanent parsed records before M2 starts. / 门禁：对每个受支持 detail family 做旧 resident 与 hydrated detail 的代表性深度等价验证；验证包含图片 marker 的 Raw detail 与无损 Raw 重读；覆盖 stale-source matrix 与批量扫描断言；运行聚焦 suite 后再运行完整 Node suite。进入 M2 前，runtime detail 必须不再要求永久常驻 parsed record。

### M2 — Per-Session compact resident Codex index / 按 Session 紧凑化 Codex 常驻索引

- Extract small canonical facts required after logical construction: session metadata identity/ancestry, source record shape, owned thread-name/title evidence, review marker facts, source digest, canonical materialized-fork digest, image descriptors, and any additional field proven by consumer tests. / 提取 logical construction 之后仍需使用的小型规范事实：session metadata identity／ancestry、source record shape、自有 thread-name／title 证据、review marker fact、source digest、物化分叉 canonical digest、图片 descriptor，以及 consumer 测试证明还需要的其他字段。
- Refactor fork, review, title, and finalization consumers to use explicit facts rather than full parsed payloads. / 把 fork、review、title 与 finalization consumer 改为使用显式事实，而非完整 parsed payload。
- Immediately after one Session finishes logical construction, create a new compact Raw array from an explicit whitelist and release the original Raw/parsed graph before parsing the next Session. Do not compact by mutating shared objects or by a broad delete list. / 每个 Session 完成 logical construction 后，立即从显式白名单构造新的 compact Raw 数组，并在解析下一 Session 前释放原始 Raw／parsed graph。不得通过修改共享对象或大范围 delete list 实现 compact。
- Keep `_logicalEvents` and public `logicalEvents` as derived projections with Raw References only. Add a recursive retained-graph audit that rejects parsed/source payload graphs or equivalent generic replacement payloads in committed Codex Sessions. / `_logicalEvents` 与公开 `logicalEvents` 继续作为只含原始引用的派生投影。增加递归 retained-graph 审计，拒绝 committed Codex Session 中的 parsed／source payload graph 或等价的通用替代 payload。
- Gate: explicit readiness checkpoint, focused parser/logical/fork/review/detail/search tests, full Node suite, then an independent retention/detail/fork/reindex review. / 门禁：明确 readiness checkpoint；运行聚焦 parser／logical／fork／review／detail／search 测试、完整 Node suite，随后进行独立 retention／detail／fork／reindex 审查。

### M3 — Reindex, reuse, cancellation, and snapshot reliability / Reindex、reuse、取消与快照可靠性

- Give parsed Sessions a transcript fingerprint and require it, in addition to stat evidence, before reusing unchanged compact payload arrays. Measure the no-change wall-time cost and avoid hashing files that cannot otherwise qualify for reuse. / 为已解析 Session 增加 transcript fingerprint；复用未变化的 compact payload array 前，除 stat evidence 外还必须验证 fingerprint。测量 no-change wall-time 成本，并避免 hash 本就不符合 reuse 条件的文件。
- Re-stat/fingerprint consistently so a source change during selection, hashing, or parsing cannot commit a mixed snapshot. / 一致地复核 stat／fingerprint，确保来源在 selection、hash 或 parse 期间变化时不会提交混合快照。
- Preserve immutable compact arrays for unchanged Session sharing; changed Sessions remain full only during their own parse/build interval. / 保持未变化 Session 的 compact array immutable 并可共享；changed Session 只在自身 parse／build 区间内保持 full。
- Keep cancellation terminal even if the abandoned build later rejects with an ordinary error; add abort checks around relationship inference/finalization where they improve responsiveness without weakening server commit guards. / 即使已放弃 build 稍后以普通错误 reject，也要保持 cancellation 为终态；在 relationship inference／finalization 周围增加合理 abort check，提高响应性但不削弱 server commit guard。
- Validate cold build, no-change reindex, one-growing/changed Session, same-size/same-mtime rewrite, successful replacement, build failure, cancellation, and old/new overlap. / 验证 cold build、no-change reindex、单个 growing／changed Session、同大小同 mtime rewrite、成功替换、build failure、cancellation 与新旧 index overlap。
- Gate: focused lifecycle/reindex/fork tests, full Node suite, and independent lifecycle review. / 门禁：聚焦 lifecycle／reindex／fork 测试、完整 Node suite 与独立 lifecycle review。

### M4 — Reprofile and close the structural change / 重新测量并收口结构变更

- Measure cold, no-change, and one-growing/changed-session runs with wall time, peak/post-build `heapUsed`, RSS, heap limit, candidate bytes, counts, and reuse. / 对 cold、no-change 与单个 growing／changed-session run 测量 wall time、peak／post-build `heapUsed`、RSS、heap limit、candidate bytes、count 与 reuse。
- Attempt the known large corpus under the normal/default heap. Target meaningful headroom (about 20–25% locally) without encoding a brittle CI threshold. / 使用 normal／default heap 尝试已知大型语料。以本地约 20–25% 的有意义余量为目标，但不把它编码成脆弱 CI 阈值。
- Only if measurements show the compact Raw projection is still insufficient may duplicated derived output fields be reconsidered. Do not redesign search text or working-set architecture without new evidence. / 只有测量证明 compact Raw projection 仍不足时，才重新考虑重复派生 output 字段。没有新证据时，不重做 search text 或 working-set architecture。
- Update bilingual product/design docs with the final lifecycle and freshness contract. Complete a fresh independent architecture review of the final diff, measurements, tests, and residual risks. / 用最终 lifecycle 与 freshness 契约更新双语 product／design 文档。对最终 diff、测量、测试与残余风险完成新的独立架构审查。
- Move this plan to `completed/` only after every required gate and review is complete. / 只有全部必需门禁与审查完成后，才把本计划移到 `completed/`。

### M5 — Deferred larger working set / 推迟的更大 working set

If M4 still shows growth close to the default heap limit, record evidence and propose a separate lightweight project/search index plus lazy Session working-set design. Do not implement it in this goal. / 如果 M4 仍显示增长接近默认 heap limit，则记录证据，并另行提出轻量 project／search index 加 lazy Session working set 设计；本目标不实现该方案。

## Validation matrix / 验证矩阵

- Static graph: no reachable Codex full parsed source graph after commit; no Logical/presentation alias to hydrated source objects. / 静态对象图：commit 后不存在可到达的 Codex 完整 parsed source graph；Logical／presentation 不别名引用 hydrated source object。
- Detail: old versus hydrated DTO equivalence across all switch families, English and Chinese localization, Raw Layer, Raw References, and image descriptors. / Detail：覆盖全部 switch family、中英文 localization、Raw Layer、原始引用与图片 descriptor 的旧路径与 hydrated DTO 等价性。
- Fork: canonical prefix, image-before-externalization digest, `__proto__`, interrupted/cross-boundary fail-closed, inherited ownership, Earlier Branch retraction, review-parent inference. / Fork：canonical prefix、图片外置前 digest、`__proto__`、interrupted／cross-boundary fail-closed、继承 ownership、Earlier Branch 撤销与 review-parent inference。
- Search/analysis: Main/Protocol/Raw phrase search, filters, file suggestions, counts, goals, review, usage, Code Mode presentation facts. / Search／analysis：Main／Protocol／Raw phrase search、筛选、file suggestion、计数、goal、review、usage 与 Code Mode presentation fact。
- Lifecycle: cold/no-change/changed reuse, exact fingerprint invalidation, cancellation, late failure, parse/finalization failure, old index preservation, successful atomic replacement. / Lifecycle：cold／no-change／changed reuse、精确 fingerprint invalidation、取消、晚到 failure、parse／finalization failure、旧 index 保留与成功原子替换。
- Performance: synthetic deterministic memory regression plus aggregate real-corpus before/after measurements; no real data committed. / Performance：确定性的合成内存回归与真实语料聚合前后测量；不提交真实数据。
- Broader gates: `npm test`; browser/package/release gates only when affected or required by final review. / 更广门禁：`npm test`；browser／package／release gate 仅在受影响或最终审查要求时运行。

## Progress log / 进度日志

### 2026-08-12 — Reconnaissance and baseline / 侦察与基线

- Created and verified the isolated worktree and branch from the current intended baseline; the primary worktree's unrelated untracked files were not touched. / 已从当前目标基线创建并验证隔离 worktree 与分支；未触碰主工作树中无关的未跟踪文件。
- Read the repository guide, README, product spec, indexing/timeline/detail/source-adapter/fork/performance/image documents, current implementation, and relevant tests. / 已阅读仓库指南、README、产品规格、索引／timeline／detail／source adapter／fork／performance／image 文档、当前实现与相关测试。
- Completed the measurements and audits recorded above. / 已完成上文记录的测量与审计。
- Decision: retain M0–M4 with a source-backed detail gate before compaction; add exact snapshot/fingerprint and cancellation hardening because current-HEAD evidence shows they are correctness requirements of the new lifecycle. Keep M5 deferred. / 决策：保留 M0–M4，并在 compaction 前设置 source-backed detail 门禁；由于当前 HEAD 证据证明 exact snapshot／fingerprint 与 cancellation hardening 是新 lifecycle 的正确性要求，因此将其纳入。M5 继续推迟。

### 2026-08-12 — M0 runtime diagnostics / M0 运行时诊断

- Implemented opt-in `--log-dir` diagnostics as bounded JSONL: indexing start, throttled phase/progress samples, terminal outcome, aggregate file／byte／Session／Raw／Logical／reuse counts, V8 heap limit, memory samples, and process-local peak memory. Diagnostic records omit repository and transcript paths, retain at most 20 matching logs, and do not replace fatal OOM stderr. / 已实现 opt-in `--log-dir` 诊断与有界 JSONL：索引开始、节流的 phase／progress sample、终态、聚合 file／byte／Session／Raw／Logical／reuse count、V8 heap limit、memory sample 与进程内 peak memory。诊断记录不包含仓库或 transcript 路径，最多保留 20 个匹配日志，且不会替代 fatal OOM stderr。
- Hardened the already-proven cancellation race while touching the job lifecycle: abort remains terminal even when the abandoned builder later rejects with an ordinary error, and synchronous builder throws now enter the same Promise failure path. The old committed index remains unchanged. / 在修改 job lifecycle 时同步修复已证明的取消竞态：即使已放弃 builder 稍后以普通错误 reject，abort 仍保持终态；同步 builder throw 也会进入同一 Promise failure path。旧 committed index 保持不变。
- Actually executed focused diagnostics／Codex tests: 75/75 passed before the final server-outcome coverage was added; the final diagnostics-only suite passed 4/4. The full Node suite passed 436/436 after the initial implementation and 437/437 after final server success／failure／cancellation log coverage. / 已实际执行聚焦 diagnostics／Codex 测试：加入最终 server outcome coverage 前 75/75 通过；最终 diagnostics-only suite 为 4/4 通过。完整 Node suite 在初版实现后为 436/436 通过，在加入最终 server success／failure／cancellation 日志 coverage 后为 437/437 通过。
- M0 does not change indexing representation or detail semantics. M1 remains the readiness gate before resident compaction. / M0 不改变索引表示或 detail 语义。M1 仍是 resident compaction 前的 readiness gate。
