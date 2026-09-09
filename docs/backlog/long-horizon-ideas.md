# Long-Horizon Ideas
# 远期想法

This file captures possible future improvements that are not yet accepted
requirements or implementation plans.
本文件记录尚未成为已接受需求或实施计划的潜在未来改进。

## Performance ideas / 性能方向

These are possible future directions, not accepted requirements, implementation plans, or authorization to reopen closed work. Historical measurements inform prioritisation only; they are not future production-acceptance evidence. Before implementation, profile the then-current production baseline, explicitly select a candidate, and freeze a new representative workload and acceptance contract. / 以下是可能的未来方向，并非已接受需求、实施计划或重开已关闭工作的授权。历史测量仅辅助排序，不能作为未来生产验收证据。实施前，应针对届时的生产基线进行性能归因、明确选择候选，并冻结新的代表性工作负载与验收合同。

Do not reconstruct completed performance work such as the Codex relationship LIGHT scan, ProjectQueryStore direct-text encoding, or browser Waves 1a–1d. Exact BigInt source identity is also completed correctness infrastructure, not a performance candidate. Do not revive the abandoned S4 Raw-copy mechanism without new causal attribution and a new mechanism. / 不要重建已完成的性能工作，如 Codex relationship LIGHT scan、ProjectQueryStore direct-text encoding 或浏览器 Waves 1a–1d。Exact BigInt source identity 也是已完成的正确性基础，并非性能候选。没有新的因果归因和新机制，不应恢复已放弃的 S4 Raw-copy 方案。

### Deferred positive candidate: PQS projection-digest batching / 已有正向信号但暂缓：PQS projection-digest batching

Status / 状态：`CLOSED_POSITIVE_SIGNAL_NOT_ACCEPTED`; `PRODUCTION_ACCEPTANCE: NO`; `NO_BENEFIT: FALSE`.

Earlier mechanism investigation showed internal-phase improvements from a bounded 64 KiB staging writer that reduces tiny crypto writes. A separate preserved historical primary cohort recorded project readiness of 20696.07 → 19886.52 ms, a 3.91% gain with 4/4 positive blocks. These are different evidence sets; neither establishes production acceptance. Required supporting phase, control, memory, CI and independent acceptance-review gates remain incomplete. Benchmark recovery stopped at its engineering-cost bound. / 较早的机制调查表明，64 KiB 有界 staging writer 通过减少细小 crypto 写入取得了内部阶段收益。另一组独立保留的历史 primary 测量记录了项目就绪时间 20696.07 → 19886.52 ms，改善 3.91%，4/4 个块为正向。这是不同的证据集，均不构成生产验收。必需的 supporting phase、control、memory、CI 和独立验收审查门槛仍未完成；benchmark recovery 因工程成本上限而停止。

The candidate preserves the projection-digest protocol and full commit validation and remains anchored only for provenance. The [completed closeout](../exec-plans/completed/2026-09-06-pqs-projection-digest-batching.md) is authoritative for candidate identity, evidence identities, unresolved gates and retention. / 候选保持 projection-digest 协议和完整 commit validation，仅为可追溯性保留其锚点。[已完成的关闭记录](../exec-plans/completed/2026-09-06-pqs-projection-digest-batching.md)是候选身份、证据身份、未完成门槛及保留要求的权威记录。

Revisit only with explicit renewed authorization and a new engineering-cost budget. First stabilize and independently review supervisor/child lifecycle and output-directory ownership contracts. Then freeze a new base/candidate pair and real workload, rerun qualification and every formal correctness, performance, control, memory, CI and independent review gate from scratch. Do not reuse historical samples for acceptance or introduce production timeout, keep-alive or retry workarounds merely to pass a benchmark. / 仅在获得明确的重新授权和新的工程成本预算后重启。先稳定 supervisor/child 生命周期及输出目录所有权合同，并完成独立审查；再冻结新的 base/candidate 对和真实工作负载，从头重跑 qualification，以及所有正式正确性、性能、control、memory、CI 和独立审查门槛。不得复用历史样本作为验收证据，也不得仅为通过 benchmark 而引入生产 timeout、keep-alive 或 retry 变通。

### Re-evaluate graph fingerprint writer batching / 重新评估 graph fingerprint writer batching

Status: mechanism reproduced historically; closed under the pre-frozen >=30% fingerprint-phase promotion gate, explicitly not `NO_BENEFIT`. / 状态：历史机制已复现；因未达到预先冻结的 fingerprint 阶段改善 >=30% 晋升门槛而关闭，明确不是 `NO_BENEFIT`。

Fixed-input investigation recorded approximately 35–36% writer-local replay improvement, 27–29% synchronous fingerprint improvement, 24% asynchronous fingerprint improvement, and 20–22% synthetic materialization improvement. The materialization experiment bypassed the owner's complete-Session cache but used two warmups and seven timed calls per arm; it was not process startup, cold OS file-cache, HTTP, or click-to-paint measurement. Do not extrapolate it into a universal user-visible gain. / 固定输入调查记录了约 35–36% writer-local replay 改善、27–29% 同步 fingerprint 改善、24% 异步 fingerprint 改善，以及 20–22% 合成物化改善。物化实验绕过 owner 的完整 Session 缓存，但每组有两次预热和七次计时调用；它不是进程启动、操作系统冷文件缓存、HTTP 或点击到绘制测量。不得将其外推为普遍的用户可感知收益。

Revisit when uncached materialization is again a material user-visible hotspot and representative real workloads justify the local writer complexity. Freeze any new gate before new measurements; do not reinterpret the old gate retroactively. / 当未缓存物化再次成为显著的用户可感知热点，且代表性真实工作负载足以证明局部 writer 复杂度值得承担时再评估。任何新门槛均须在新测量前冻结，不得追溯性地重解释旧门槛。

Keep an initially graph-specific private bounded writer. Preserve the complete byte stream, including immediate raw-byte reads and async raw-chunk/cancellation cadence, not just text encoding. Shared delivery does not unify sync/async graph traversal semantics. Do not introduce a PQS/graph abstraction without demonstrated stable common contracts. Detailed implementation boundaries, independent parity requirements and evidence provenance belong in [graph fingerprint batching guidance](graph-fingerprint-batching-guidance.md), not a second contract here. / 初始方案保持 graph 专用的私有有界 writer。保留完整字节流，包括即时 raw-byte 读取和异步 raw-chunk／取消节奏，而不只是文本编码。共享交付层不等于统一同步／异步 graph 遍历语义。未经稳定公共合同的实际证明，不引入 PQS/graph 抽象。详细实施边界、独立 parity 要求和证据来源集中在 [graph fingerprint batching 指导](graph-fingerprint-batching-guidance.md)，此处不建立第二套合同。

### Materialized Session derived query index and Raw late DTO projection / Materialized Session 派生查询索引与 Raw 延迟 DTO 构造

Status: unimplemented structural candidate; fresh profiling required. Current query entry points are in [session-query.js](../../src/session-query.js). Raw queries construct DTOs across the layer before structural filtering and paging; event lookup also reconstructs layer data before searching. / 状态：未实施的结构性候选，需要重新归因。当前查询入口位于 [session-query.js](../../src/session-query.js)。Raw 查询在结构过滤和分页前构造全层 DTO；事件查找也在搜索前重新构造层数据。

Potential static derivations include per-layer Logical Event arrays, event-ID lookup, Raw Record ID-to-ordinal lookup or lightweight query facts, kind counts, presentation context, and Session-scoped file-suggestion facts. They could be associated externally with the exact Materialized Session identity through a WeakMap or revision-owned cache; this is a design option, not a selected architecture. / 潜在静态派生数据包括分层 Logical Event 数组、event-ID 查找、Raw Record ID 到序号的查找或轻量查询事实、kind 计数、presentation context，以及 Session 范围的文件建议事实。可通过 WeakMap 或 revision 所有的缓存，在外部关联精确的 Materialized Session 身份；这只是设计选项，并非已选择的架构。

For Raw pagination, evaluate scanning lightweight facts, computing exact structural matches and search counts, selecting the requested page, and constructing full DTOs only for page records. Preserve these boundaries: / 对 Raw 分页，可评估先扫描轻量事实、计算精确结构匹配与搜索计数、选择请求页，再仅为页内记录构造完整 DTO。须保留以下边界：

- Preserve filtering, counts, order, pagination and presentation semantics. Current timeline `q` contributes search counts/highlights; it does not simply remove every non-hit record from the structural page. / 保持过滤、计数、顺序、分页和 presentation 语义。当前 timeline 的 `q` 用于搜索计数／高亮，并非简单地从结构分页中移除全部未命中记录。
- DTO construction currently performs canonical validation. Deferral must preserve validation coverage, rejection and error behavior, including off-page records; it is not permission to bypass checks. / 当前 DTO 构造执行 canonical validation。延迟构造必须保持验证覆盖、拒绝及错误行为，包括页外记录；不能据此绕过检查。
- Do not mutate canonical Materialized Sessions or assume all reachable storage is immutable solely from object identity. Establish derivation validity and invalidation against actual ownership contracts. / 不修改规范 Materialized Session，也不应仅凭对象身份认定所有可达存储不可变；须根据实际所有权合同建立派生数据的有效性和失效规则。
- WeakMap lifetime is not a memory budget. Account for retained indexes in the Session cache budget or set a separate bound, and avoid strong references that retain evicted Sessions. / WeakMap 生命周期不等于内存预算。须将保留索引计入 Session 缓存预算或另设上限，并避免通过强引用保留已淘汰 Session。
- Keep query text, locale and presentation configuration dependencies explicit. Prefer caching static facts over query-specific or localized DTOs; do not cache arbitrary search/filter result sets without separate justification. / 明确查询词、locale 和 presentation 配置依赖。优先缓存静态事实，而非查询专属或本地化 DTO；没有单独论证，不缓存任意搜索／过滤结果集。

Revisit by profiling warm Session timelines, Raw pagination, event lookup, filtering and file suggestions. Proceed only if server query work remains material after completed browser optimizations, with build cost and retained memory measured alongside query latency. / 通过重新测量 warm Session 时间线、Raw 分页、事件查找、过滤和文件建议来决定是否重启。仅在已完成浏览器优化后服务端查询工作仍显著时推进，同时测量构建成本、保留内存与查询延迟。

### Materialization validator guard reduction / Materialization validator guard 降本

Status: architecture-sensitive; profile before redesign. The [adapter lifecycle](../design-docs/indexed-materialized-session-lifecycle.md) guards private-state validation with graph fingerprints. Claude currently declares no materialized private fields and has a no-op private-state validator, but still enters this guarded path. / 状态：涉及架构敏感边界，重设计前须归因。[Adapter 生命周期](../design-docs/indexed-materialized-session-lifecycle.md)使用 graph fingerprint 保护 private-state validation。Claude 当前未声明 materialized private fields，且 private-state validator 为空操作，但仍进入该 guard 路径。

Keep two possible directions separate: an explicit audited no-private-state path, and a narrow read-only projection of enumerated facts for adapters that really have private state. The latter would restrict what the callback receives rather than exposing the entire graph; it requires a concrete ownership/mutation model, not merely a shallow freeze. / 将两个可能方向分开：对经过审计的无私有状态情况建立显式路径；对确有私有状态的 adapter 提供只包含枚举事实的窄只读投影。后者通过限制 callback 接收的数据来避免暴露整个 graph；需要具体的所有权／mutation 模型，而不只是浅层 freeze。

The current private-validator guard returns a Session fingerprint reused by the subsequent query-projection mutation check. Skipping a no-op callback cannot remove that protection: preserve or establish the fingerprint at the correct pre-projection boundary. Do not count the entire current capture/recheck cost as removable. Preserve error precedence, mutation detection, cancellation, observer behavior, canonical validation and legacy contracts. / 当前 private-validator guard 返回的 Session fingerprint 会被后续 query-projection mutation check 复用。跳过空 callback 不能移除这层保护：必须保留或在正确的 projection 前边界建立 fingerprint。不得把当前整段 capture/recheck 成本都计为可消除成本。保持错误优先级、mutation detection、取消、observer 行为、canonical validation 和旧合同。

Revisit only when fresh profiling shows material guard costs after cheaper writer work, required private facts can be enumerated, and measured benefit justifies adapter lifecycle API changes. Do not redesign validator ownership solely for theoretical cleanliness. / 仅当重新归因表明更便宜的 writer 工作之后 guard 仍有显著成本、所需私有事实可明确枚举，且实测收益足以支持 adapter 生命周期 API 变更时重启。不要仅为理论上的整洁而重设计 validator 所有权。

### Immutable ProjectQueryStore ownership and commit proof / ProjectQueryStore 不可变所有权与 commit proof

Status: invasive architecture candidate, behind cheaper mechanisms. [PQS commit validation](../../src/project-query-store.js) reconstructs and verifies stored-shard projection digests. Prior builder validation or a WeakMap marker alone cannot prove that writable Buffer/TypedArray aliases have not changed the bytes. / 状态：侵入性架构候选，优先级低于更便宜的机制。[PQS commit validation](../../src/project-query-store.js)重建并验证 stored-shard projection digest。已有 builder 验证或 WeakMap 标记本身，不能证明可写 Buffer/TypedArray 别名没有改变字节。

A candidate would need a concrete model in which the builder creates bytes, no writable alias escapes, ownership is sealed or transferred, and a proof binds the exact representation and required metadata. Only then could commit rely on that proof instead of some repeated reconstruction. Object freezing alone is insufficient. / 候选需要具体模型：builder 创建字节，没有可写别名逸出，所有权被封存或转移，且 proof 绑定精确表示和必要元数据。只有这样，commit 才可能依赖 proof 取代部分重复重建。仅冻结对象不足以实现这一点。

Revisit if full commit verification remains a major startup hotspot, cheaper local optimizations are insufficient, and the model can prove validated stored bytes cannot subsequently mutate. PQS batching demonstrated a possible cheaper hashing mechanism without weakening verification, but its production candidate was not accepted. Do not weaken, skip or narrow validation before establishing ownership. / 若完整 commit verification 仍是启动主热点、更便宜的局部优化不足，且模型能够证明验证后的存储字节不会再变化，才重新评估。PQS batching 展示了不削弱验证的较低成本 hash 机制，但其生产候选未获接受。建立所有权证明前，不削弱、跳过或收窄验证。

### Claude relationship and fork scale hardening / Claude relationship 与 fork 规模化优化

Status: scalability hypothesis; no established dominance in ordinary workloads. Current [Claude relationship](../../src/claude.js) and [fork](../../src/claude-forks.js) code contains repeated conflict scans, timestamp sorting, parent-chain walks and repeated filtering of relationship evidence. / 状态：规模化假设，尚无证据表明它主导普通工作负载。当前 [Claude relationship](../../src/claude.js) 与 [fork](../../src/claude-forks.js) 代码包含重复 conflict 扫描、时间排序、parent-chain 遍历和 relationship evidence 重复过滤。

Potential local mechanisms are adjacency/work queues, single-pass extrema, graph coloring and pre-grouped evidence. Some graph subprocedures may approach O(S+E), where S is Session count and E is relationship-edge count; this is not a complexity guarantee for the complete pipeline, which also processes records and evidence. / 潜在局部机制包括邻接关系／工作队列、单次扫描求极值、graph coloring 和预分组证据。部分图子过程可能接近 O(S+E)，其中 S 为 Session 数量，E 为关系边数量；这不是完整处理链的复杂度保证，因为处理链还处理记录和证据。

Revisit with representative large Claude workloads showing material attribution cost, or supported scale creating a demonstrated practical risk. Require exact relationship, conflict propagation, cycle-removal, timestamp and evidence-selection parity; justify each complexity claim separately. Ordinary-project speedup must be measured, not inferred from asymptotic analysis. / 当代表性大型 Claude 工作负载显示显著归因成本，或支持规模带来已证实的实际风险时重启。要求关系、conflict 传播、cycle removal、时间和证据选择精确等价；分别论证每项复杂度声明。普通项目提速必须测量，不能从渐近分析推断。

### Final accepted-parse residual attribution / 最终 accepted parse 残余热点归因

Status: profiling target, not an implementation candidate. Historical cold-index work left accepted-prefix parsing/construction as a large residual after relationship scanning improvements. The [completed S2 plan](../exec-plans/completed/2026-09-01-performance-server-s2-relationship-scan.md) and [current lifecycle](../design-docs/indexed-materialized-session-lifecycle.md) explain the LIGHT/complete-parse boundary; current phase cost must be remeasured. / 状态：归因目标，并非实施候选。历史 cold-index 工作在 relationship scan 改进后，仍留下较大的 accepted-prefix 解析／构造残余。[已完成 S2 计划](../exec-plans/completed/2026-09-01-performance-server-s2-relationship-scan.md)与[当前生命周期](../design-docs/indexed-materialized-session-lifecycle.md)说明 LIGHT／完整解析边界；当前阶段成本必须重新测量。

If cold project startup remains important, decompose the current implementation into input scanning, JSON parsing, Raw Record construction, Logical Event construction, source-specific relationship/fork work, derived analysis, canonical validation and other retained transformations as appropriate. Define nesting and attribution to avoid double-counting. Historical S3/S4 labels do not dictate the new boundaries. / 若冷项目启动仍重要，按当前实现合理拆分输入扫描、JSON 解析、Raw Record 构造、Logical Event 构造、来源特定 relationship/fork 工作、派生分析、canonical validation 及其它保留转换。定义嵌套与归因关系，避免重复计时。历史 S3/S4 标签不决定新边界。

The abandoned S4 Raw-copy experiment is a reason to demand causal evidence, not a ready implementation to revive. Design a new candidate only after identifying a specific costly subphase. This attribution may precede any startup optimization; it is not queued behind invasive architecture work. / 已放弃的 S4 Raw-copy 实验提醒我们要求因果证据，而不是提供可直接恢复的实现。只有识别出具体高成本子阶段后才设计新候选。此归因可以先于任何启动优化，不排在侵入性架构工作之后。

### Browser virtualization or deeper renderer work / 浏览器虚拟化与更深层 renderer 优化

Status: conditional only. Browser Waves 1a–1d already changed event lookup, search/render scheduling, keyed append/card ownership and detail-body patching. Re-profile the current renderer; do not implement virtualization from historical timings. See [timeline performance](../design-docs/timeline-loading-and-rendering-performance.md). / 状态：仅为条件性方向。浏览器 Waves 1a–1d 已改变事件查找、搜索／渲染调度、keyed append／card 所有权和 detail-body patching。应重新测量当前 renderer，不根据历史计时实施虚拟化。参见[时间线性能设计](../design-docs/timeline-loading-and-rendering-performance.md)。

Consider windowed rendering or further lifecycle reduction only if representative large or deeply filtered Sessions show dominant DOM/main-thread costs and meaningful user-visible benefit. Preserve exact search/filter results, jump-to-event, selection/focus, card identity/detail lifecycle, scroll restoration/deep navigation, accessibility and keyboard interaction. Account for the additional lifecycle maintenance cost. / 仅当代表性大型或深度过滤 Session 显示 DOM／主线程成本主导，且有显著用户收益时，考虑窗口化渲染或进一步生命周期降本。保持精确搜索／过滤结果、jump-to-event、选择／焦点、card 身份／detail 生命周期、滚动恢复／深层导航、无障碍及键盘交互，并计入新增生命周期维护成本。

### Characterize other relationship/inference ideas before revival / 恢复其它 relationship／inference 想法前先归因

Historical Codex review-parent inference or relationship proposals predate the S2 LIGHT scan and may no longer describe current architecture. If inference becomes expensive again, profile the current code, identify the exact remaining algorithmic boundary, and design a new candidate. Do not reconstruct pre-S2 proposals merely because old reports mention them. / 历史 Codex review-parent inference 或 relationship 提案早于 S2 LIGHT scan，可能已不再描述当前架构。若 inference 再次昂贵，应测量当前代码、识别精确的残余算法边界，并设计新候选。不要仅因旧报告提及就重建 pre-S2 方案。

### Choose a revisit entry by current symptoms / 按当前症状选择重启入口

This is a conditional routing guide, not a ranked implementation queue. Fresh attribution determines the next step. / 以下是条件性入口指引，并非有固定优先级的实施队列。下一步由新的归因决定。

| Current symptom / 当前症状 | First investigation / 首先调查 | Conditional follow-up / 条件性后续 |
| --- | --- | --- |
| Warm Session interaction is server-bound / warm Session 交互受服务端限制 | Query derivation, Raw pagination, event lookup / 查询派生、Raw 分页、事件查找 | Bounded derived index or late DTO / 有界派生索引或延迟 DTO |
| Uncached Session opens slowly / 未缓存 Session 打开慢 | Current materialization phase attribution / 当前物化阶段归因 | Graph writer first; validator changes only if guards remain material / 优先 graph writer；guard 仍显著时再评估 validator 变更 |
| Cold project startup is slow / 冷项目启动慢 | Accepted parsing and PQS build/commit attribution / accepted parsing 与 PQS build／commit 归因 | New causal parse candidate, or PQS batching after infrastructure/cost prerequisites; ownership/proof only after cheaper options / 新的解析因果候选，或满足基础设施／成本前提后的 PQS batching；更便宜方案不足后才评估 ownership／proof |
| Large Claude relationship cost rises sharply / 大型 Claude relationship 成本陡增 | Representative scale and exact subprocedure / 代表性规模与精确子过程 | Narrow algorithmic hardening / 局部算法规模化改进 |
| Browser DOM/main thread dominates / 浏览器 DOM／主线程主导 | Current timeline profiler and user interaction / 当前 timeline profiler 与用户交互 | Windowing or lifecycle changes only with measured benefit / 有实测收益才考虑窗口化或生命周期变更 |

Known theoretical optimizations are not implementation obligations. Prefer current user-visible hotspot evidence, narrow causal mechanisms, exact semantic parity and bounded maintenance cost. / 已知理论优化并非实施义务。优先依据当前用户可感知热点证据、局部因果机制、精确语义等价和有界维护成本。
