# Indexed Session and Materialized Session lifecycle execution plan / Indexed Session 与 Materialized Session 生命周期执行计划

## Status / 状态

- Status: active, stopped at the M1 architecture-review gate / 状态：活跃，停在 M1 架构评审门槛
- Started: 2026-08-16 / 开始日期：2026-08-16
- Working branch: `indexed-materialized-session-lifecycle` / 工作分支：`indexed-materialized-session-lifecycle`
- Baseline branch: `towards-0.2.0` / 基线分支：`towards-0.2.0`
- Exact baseline commit: `6f8fa085fbd18344a973c8169be1998b5a71943d` / 精确基线 commit：`6f8fa085fbd18344a973c8169be1998b5a71943d`
- Current review artifact: committed M0/M1 documentation checkpoints on this branch; each review dispatch records its exact immutable Git head; no production lifecycle code / 当前评审 artifact：本分支已提交的 M0／M1 文档 checkpoint；每次 review dispatch 都记录其精确不可变 Git head；没有生产生命周期代码
- Design packet: `docs/design-docs/indexed-materialized-session-lifecycle.md` / 设计包：`docs/design-docs/indexed-materialized-session-lifecycle.md`

## Objective / 目标

Replace the resident complete-Session Index with a source-neutral lifecycle in which Indexed Sessions support project-wide browsing and query behavior, while complete Materialized Sessions are reconstructed, validated, coalesced, and cached on demand within one committed Index revision. Preserve existing source selection, query, timeline, detail, Raw, image, relationship, cancellation, and reindex semantics for Codex and Claude Code. / 用来源中立生命周期替换常驻完整 Session 的 Index：Indexed Session 支持项目级浏览与查询，而完整 Materialized Session 在单个已提交 Index revision 内按需重建、校验、合并并缓存。保持 Codex 与 Claude Code 既有来源选择、查询、时间线、详情、Raw、图片、关系、cancellation 与 reindex 语义。

## Guardrails / 护栏

1. Milestone stops are mandatory. M2 production code cannot start until a fresh independent M1 architecture review explicitly accepts the packet. M4 cannot start until the M3 implementation checkpoint is accepted. / Milestone 停点是强制的。Fresh 独立 M1 架构评审显式接受前不得开始 M2 生产代码；M3 实现检查点接受前不得开始 M4。
2. The implementation stays source-neutral in shared contracts, server state, materialization ownership, and project query. Adapters own source parsing, evidence, freshness, and reconstruction. / 实现必须在共享契约、server state、物化 ownership 与项目查询中保持来源中立；adapter 拥有来源解析、证据、freshness 与重建。
3. Aggregate profiling must not record transcript content or paths. Diagnostic heap increases are evidence only and never become a product-default change. / 聚合 profiling 不得记录转录内容或路径。诊断性提高 heap 只作为证据，绝不成为产品默认变更。
4. Existing detail purpose/responsibility, complete ordered Raw References, source-owned locators, sanitization, fork/derived ownership, replacement atomicity, and cancellation behavior remain contractual. / 既有详情用途／职责、完整有序 Raw Reference、来源拥有 locator、sanitization、fork／derived ownership、替换原子性与 cancellation 行为继续属于契约。
5. First implementation has no eviction. It must nevertheless isolate materialization by Index revision and release the whole old cache on successful replacement. / 首版不实现 eviction，但必须按 Index revision 隔离物化，并在成功替换时释放整个旧 cache。

## Milestone plan / 里程碑计划

| Milestone / 里程碑 | Deliverable / 交付物 | Status / 状态 | Gate / 门槛 |
| --- | --- | --- | --- |
| M0 — Baseline, consumer map, retained-memory audit / 基线、consumer map、常驻内存审计 | Exact branch/baseline, full baseline tests, complete consumer/residency map, aggregate heap/search evidence, stop-condition decision / 精确 branch／baseline、全量基线测试、完整 consumer／常驻矩阵、聚合 heap／search 证据、停止条件决定 | Complete / 已完成 | Naive event-shaped query projection rejected after measured 82.5% retained heap / 量测仍保留 82.5% heap 后拒绝朴素 event-shaped 查询投影 |
| M1 — Lifecycle architecture packet / 生命周期架构评审包 | Closed Indexed/Materialized/descriptor/dependency/query contracts, route matrix, data flow, scheduler/failure semantics, Codex/Claude sketches, compatibility, non-goals, review dispositions / 封闭 Indexed／Materialized／descriptor／dependency／query 契约、route 矩阵、数据流、scheduler／failure 语义、Codex／Claude 草图、兼容性、非目标、评审处理 | Changes addressed; re-review pending / 已处理变更；等待复审 | Fresh independent Sol xhigh review must explicitly accept; every blocker resolved and re-reviewed / Fresh 独立 Sol xhigh 评审必须显式接受；每个 blocker 解决并复审 |
| M2 — Dual-mode shared lifecycle contracts / 双模式共享生命周期契约 | Discriminated `resident-complete-v1`/`indexed-materialized-v1` adapter contract; exact validators/budgets; dependency/query envelopes; async server-await compatibility bridge; production adapters remain legacy / 判别式两种 adapter 契约；精确 validator／budget；dependency／query envelope；异步 server-await 兼容 bridge；生产 adapter 仍为 legacy | Pending / 待开始 | Focused mode-discrimination, ownership/equality, forbidden-retainer, budget, malformed-descriptor, staged-signature, and synthetic Indexed-adapter tests / 聚焦 mode 判别、ownership／等值、禁止 retainer、budget、畸形 descriptor、staged signature 与合成 Indexed adapter 测试 |
| M3 — Codex vertical lifecycle slice / Codex 垂直生命周期 slice | Shared async project query, global scheduler/revision owner, atomic replacement, Codex Indexed build/materialization, fork descriptor, legacy Raw owner map, detail/Raw/image route migration, query oracle parity / 共享异步项目查询、全局 scheduler／revision owner、原子替换、Codex Indexed build／物化、fork descriptor、legacy Raw owner map、detail／Raw／image route 迁移、query oracle 等价 | Pending / 待开始 | Codex default-heap real corpus completes; latency/cancel/memory gates, full Node tests, and independent implementation review accepted before M4 / Codex 默认 heap 真实语料完成；latency／cancel／memory 门槛、全量 Node 测试与独立实现评审在 M4 前接受 |
| M4 — Claude vertical lifecycle slice / Claude 垂直生命周期 slice | Transient parsed graph, interned positive/negative/directory dependencies, primary/derived/pointer/materialized-fork descriptors, source-backed materialization, reuse and staged route migration / 瞬态 parsed 图、intern 正向／负向／directory 依赖、primary／derived／pointer／materialized-fork descriptor、来源回读物化、复用与 staged route 迁移 | Pending / 待开始 | Claude pairing/detail/analysis/derived/fork parity, append/snapshot freshness, no-reachable-parsed-graph, large available-corpus gate; no legacy production adapter remains / Claude pairing／detail／analysis／derived／fork 等价、append／snapshot freshness、parsed 图不可达、可用大型语料门槛；不再有 legacy 生产 adapter |
| M5 — Cross-source lifecycle convergence / 跨来源生命周期收敛 | Remove transitional production-only legacy paths, cross-source conformance, replacement/scheduler/revision/error telemetry, retained-shape and package review / 移除过渡生产 legacy path、跨来源 conformance、替换／scheduler／revision／error telemetry、常驻 shape 与 package 评审 | Pending / 待开始 | Full Node/source-switch/replacement/package checks and independent cross-source implementation review / 全量 Node／来源切换／替换／package 检查与独立跨来源实现评审 |
| M6 — Browser and integration convergence / Browser 与集成收敛 | Revision-safe project navigation, cold materialization loading/error/retry behavior, async project cancellation, generated asset/browser/package checks / Revision-safe 项目导航、冷物化 loading／error／retry 行为、异步项目 cancellation、生成资产／browser／package 检查 | Pending / 待开始 | Node, browser, build/package, source switch and replacement flows pass / Node、browser、build／package、来源切换与替换流程通过 |
| M7 — Release readiness and closeout / 发布准备与收尾 | Product/design docs synchronized, final corpus measurements, external review findings closed, plan archived only when shipped / product／design 文档同步、最终语料量测、外部评审 finding 关闭、只在已交付时归档计划 | Pending / 待开始 | Release checks pass; no unresolved blocking findings; explicit completion evidence / 发布检查通过；无未解决阻断 finding；有显式完成证据 |

## M0 record / M0 记录

### Repository and baseline / 仓库与基线

- The original worktree was clean at `6f8fa085fbd18344a973c8169be1998b5a71943d`; work moved to dedicated branch `indexed-materialized-session-lifecycle`. / 原 worktree 在 `6f8fa085fbd18344a973c8169be1998b5a71943d` 上干净；工作已移至专用分支 `indexed-materialized-session-lifecycle`。
- Baseline command: `npm test`. Result: 528 passed, 0 failed, 0 skipped, about 9.85 seconds reported test duration. / 基线命令：`npm test`。结果：528 passed、0 failed、0 skipped，报告测试时长约 9.85 秒。
- Runtime: Node `v24.18.1`, npm `12.0.2`. / Runtime：Node `v24.18.1`、npm `12.0.2`。

### Consumer/residency findings / Consumer／常驻结论

- `state.index` is the sole server owner. `sessions` and `sessionsById` share exact Session object identities; they do not duplicate event bodies. / `state.index` 是唯一 server owner。`sessions` 与 `sessionsById` 共享精确 Session object identity，不重复事件 body。
- Session summaries need metadata, counts, relationships, top-five tools/files, failed-command count, and protocol count; requiring event arrays is a validator/length artifact. / Session 摘要只需要 metadata、count、关系、前五 tools／files、失败命令 count 与 protocol count；对事件 array 的要求来自 validator／length 偶合。
- Project filters/search, file suggestions, and catalogs currently scan full Raw/Logical arrays. Search-result navigation depends on event ID plus structural timeline ordinal and currently lacks a revision token. / 项目 filter／search、文件建议与目录当前扫描完整 Raw／Logical array。搜索结果导航依赖 event ID 与结构 timeline ordinal，且当前缺少 revision token。
- Timeline limit controls response size but not full-array scans; Raw timeline creates DTOs before slicing; browser navigation can accumulate complete filtered timelines and detail caches. / Timeline limit 只控制 response size，不控制完整 array 扫描；Raw timeline 在切片前创建 DTO；浏览器导航会累积完整过滤时间线与 detail cache。
- Codex commits compact Raw plus complete Logical, hidden fork/presentation/analysis derivations, while source-backed detail hydration is already bounded and freshness-checked. / Codex 提交紧凑 Raw 加完整 Logical、隐藏 fork／presentation／analysis 派生；来源回读 detail hydration 已有界且校验 freshness。
- Claude commits parsed Raw graphs, normalized duplicates, Logical arrays, analysis, and relationship/presentation state. Its structured detail directly consumes resident parsed records. / Claude 提交 parsed Raw 图、normalized 副本、Logical array、analysis 与关系／presentation 状态；结构详情直接消费常驻 parsed record。
- Fork/derived inference is a build-time global consumer, but its committed navigation result is compact. Production migration needs compact cross-session evidence and a materialization boundary descriptor rather than resident parent/child bodies. / Fork／derived 推断是构建期全局 consumer，但其已提交导航结果紧凑。生产迁移需要紧凑跨 Session 证据与物化边界 descriptor，而不是常驻 parent／child body。

The detailed consumer matrix and source-specific retained-field audit are normative inputs to M1 and are recorded in `docs/design-docs/indexed-materialized-session-lifecycle.md`. / 详细 consumer 矩阵与来源专属常驻字段审计是 M1 的规范输入，记录在 `docs/design-docs/indexed-materialized-session-lifecycle.md`。

### Memory and search evidence / 内存与搜索证据

The aggregate-only corpus profiling found 666 files, 482 indexed Sessions, approximately 1.193 GB of candidates, approximately 200,820 Logical Events, and approximately 282,998 Raw Records. The default-heap cold build OOMed near the V8 limit. A diagnostic-only 4 GiB build committed at 2,098,809,064 bytes forced-GC heap and 2,674,880,512 bytes RSS. / 仅聚合语料 profiling 发现 666 个文件、482 个已索引 Session、约 1.193 GB 候选、约 200,820 个 Logical Event 与约 282,998 个 Raw Record。默认 heap 冷构建在 V8 限制附近 OOM。仅诊断的 4 GiB 构建在提交后强制 GC 得到 2,098,809,064 bytes heap 与 2,674,880,512 bytes RSS。

Dropping event bodies while retaining ordinary per-event query objects left 1,731,440,608 bytes forced-GC heap, about 82.5% of the complete graph. The stop condition therefore rejected that representation. Packed length-framed text plus scalar metadata measured 384,223,656 bytes when every layer was compressed, but cold search regressed to Main 2.126 s, Protocol 1.001 s, and Raw 4.173 s and added about 13.9 s of build work. M1 therefore proposes uncompressed packed Main text and compressed Protocol/Raw text, estimated at about 601 MB total packed query data, subject to M3 runtime measurement and parity/performance gates. / 删除 event body、保留普通逐 event 查询 object 后，强制 GC heap 仍有 1,731,440,608 bytes，约为完整图的 82.5%，因此停止条件拒绝该表示。每层都压缩时，紧凑长度分帧正文加 scalar metadata 量测为 384,223,656 bytes，但冷搜索退化到 Main 2.126 s、Protocol 1.001 s、Raw 4.173 s，并增加约 13.9 s 构建工作。M1 因而提议 Main 使用未压缩紧凑正文，Protocol／Raw 使用压缩正文，估算查询数据总计约 601 MB；最终仍受 M3 runtime 量测及等价／性能门槛约束。

## M1 architecture checkpoint / M1 架构检查点

The review packet includes all mandatory inputs: exact base/head description, consumer matrix, memory evidence and rejected stop-condition representation, Indexed/Materialized canonical contracts, runtime/data-flow diagram, Codex and Claude migration sketches, a concrete project-search representation, cache/reindex/cancellation/stale-source semantics, compatibility, non-goals, conformance gates, and unresolved questions. / 评审包包含全部强制输入：精确 base／head 描述、consumer 矩阵、内存证据与被停止条件拒绝的表示、Indexed／Materialized canonical 契约、runtime／data-flow 图、Codex 与 Claude 迁移草图、具体项目搜索表示、cache／reindex／cancellation／stale-source 语义、兼容性、非目标、conformance 门槛与待决问题。

### Independent review log / 独立评审日志

No production M2 work may be recorded below until the review log contains an explicit accepted verdict. / 在评审日志包含显式 accepted verdict 前，下方不得记录任何生产 M2 工作。

| Review / 评审 | Exact scope / 精确范围 | Verdict / 结论 | Findings and disposition / Finding 与处理 |
| --- | --- | --- | --- |
| M1 fresh architecture review, pass 1 / M1 fresh 架构评审，第 1 轮 | Working-tree documentation diff against `6f8fa085...`; independent `gpt-5.6-sol`, xhigh, fresh context / 相对 `6f8fa085...` 的 working-tree 文档 diff；独立 `gpt-5.6-sol`、xhigh、fresh context | `CHANGES_REQUIRED` / `CHANGES_REQUIRED` | Accepted M0 stop-condition direction; eight blockers: executable milestone transition, closed fields/budgets/equality, filtered `timelineIndex`, async query semantics/cancellation, staged adapter APIs, Codex fork descriptor, Claude dependency closure, bounded scheduler/error transitions. All are addressed in the revised design; exact re-review pending. / 接受 M0 停止条件方向；八项 blocker：可执行 milestone 过渡、封闭字段／budget／等值、过滤后 `timelineIndex`、异步查询语义／cancellation、staged adapter API、Codex fork descriptor、Claude dependency 闭包、有界 scheduler／error transition。修订设计已逐项处理；等待精确复审。 |
| M1 architecture re-review, pass 2 / M1 架构复审，第 2 轮 | Exact immutable head `a65778e7ac5a7ae14c16d3e11b16b0698c3f8fc1` against `6f8fa085...` / 相对 `6f8fa085...` 的精确不可变 head `a65778e7ac5a7ae14c16d3e11b16b0698c3f8fc1` | `CHANGES_REQUIRED` / `CHANGES_REQUIRED` | Closed blockers 1, 3, 4, 5, 7, and 8. Reopened field-specific unresolved relationship compatibility and Codex's valid three-segment membership; new blocker removed an unconsumed Raw query segment fact. Atomic replacement wording and committed-head description were also normalized. / 关闭 blocker 1、3、4、5、7、8。重新打开按字段允许 unresolved relationship 的兼容性与 Codex 有效三 segment membership；新 blocker 要求移除无人消费的 Raw query segment fact。同时统一原子替换措辞与已提交 head 描述。 |
| M1 architecture re-review, pass 3 / M1 架构复审，第 3 轮 | Pending next immutable documentation head / 等待下一个不可变文档 head | Pending / 待定 | Must close the two reopened and one new blocker before acceptance / 接受前必须关闭两个 reopened 与一个 new blocker |

## Planned verification / 计划验证

### M2 dual-mode boundary and M3 Codex slice / M2 双模式边界与 M3 Codex slice

- Focused canonical/source-adapter/query-store contract tests. / 聚焦 canonical／source-adapter／query-store 契约测试。
- Exact query-oracle parity for both sources and both locales. / 两种来源、两种 locale 的精确 query oracle 等价。
- Dual-mode discrimination keeps both production adapters legacy throughout M2; a synthetic Indexed adapter locks the future staged signatures without prematurely switching runtime storage. / 双模式判别让两个生产 adapter 在 M2 全程保持 legacy；合成 Indexed adapter 锁定未来 staged signature，不提前切换 runtime storage。
- Global active-one/FIFO queued-32 scheduling, coalescing, independent/all-waiter cancellation, queue capacity, cache hit identity, retry-after-failure, stale source, abort-ignoring adapters, async search retirement, owner retirement, and atomic replacement tests. / 全局 active-one／FIFO queued-32 scheduling、合并、独立／全部 waiter cancellation、queue capacity、cache hit identity、失败后重试、来源 stale、忽略 abort 的 adapter、异步 search retirement、owner retirement 与原子替换测试。
- Codex default-heap real-corpus cold build and aggregate-only heap/RSS/external/ArrayBuffer, transient peak, query bytes, build-time, latency, and cancellation measurements. / Codex 默认 heap 真实语料冷构建与仅聚合 heap／RSS／external／ArrayBuffer、瞬态 peak、query bytes、build-time、latency 与 cancellation 量测。

### M3 Codex source semantics / M3 Codex 来源语义

- Compact Indexed shape, no reachable complete event graph, cold/warm materialization equality, source append/rewrite matrix, detail/Raw/image parity, and hydration coordination. / 紧凑 Indexed shape、完整事件图不可达、冷／热物化等值、来源 append／rewrite 矩阵、detail／Raw／image 等价与 hydration 协调。
- Materialized fork continuation ownership, inherited-context summary, Raw segment presentation, earlier-branch supersession, and unchanged-reindex query/evidence reuse. / Materialized fork continuation ownership、inherited-context 摘要、Raw segment presentation、earlier-branch supersession 与未变化 reindex 的 query／evidence 复用。

### M4 Claude / M4 Claude

- No reachable parsed Raw/source graph in the committed Index; exact message/tool pairing, plan/lifecycle/detail/analysis parity after materialization. / 已提交 Index 中 parsed Raw／来源图不可达；物化后 message／tool pairing、plan／lifecycle／detail／analysis 精确等价。
- Pointer/materialized fork, primary/derived/subagent/workflow ownership, sidecar dependency invalidation, and Indexed reuse without complete-array sharing. / Pointer／materialized fork、primary／derived／subagent／workflow ownership、sidecar 依赖失效，以及不共享完整 array 的 Indexed 复用。

### M5–M7 convergence and integration / M5–M7 收敛与集成

- Full Node and browser suites, client build, package/release checks, source switch, project replacement, navigation revision, cancellation, and error/loading behavior. / 全量 Node 与 browser suite、client build、package／release 检查、来源切换、项目替换、导航 revision、cancellation 与 error／loading 行为。
- Final aggregate corpus measurements compared with M0, complete bilingual docs, accepted independent closeout review, and plan archive only after shipped completion. / 最终聚合语料量测与 M0 比较、完整双语文档、已接受独立收尾评审，以及只在已交付完成后归档 plan。

## Documentation updates / 文档更新

When behavior changes in later milestones, update the product spec if the external contract changes, this design doc for lifecycle/tradeoff changes, `transcript-source-adapters.md` for adapter-boundary changes, `logical-event-timeline.md` and the performance design for loading/query changes, and this active plan after each real checkpoint. English and Chinese text must change together. / 后续 milestone 改变行为时：若外部契约变化则更新产品规格；生命周期／tradeoff 变化更新本设计文档；adapter 边界变化更新 `transcript-source-adapters.md`；loading／query 变化更新 `logical-event-timeline.md` 与性能设计；每个真实检查点后更新本活跃计划。英文与中文必须同步变更。

This plan moves to `docs/exec-plans/completed/` only after M7 is genuinely complete. / 只有 M7 真正完成后，本计划才移至 `docs/exec-plans/completed/`。
