# Graph Fingerprint Batching Guidance / Graph Fingerprint Batching 实施指导

- Status: conditional guidance; not accepted implementation work or production acceptance. / 状态：有条件的指导材料，不代表已接受的实施工作或生产验收。
- Updated: 2026-09-08. / 更新：2026-09-08。
- Scope: A, graph fingerprint delivery in `src/source-adapters.js`. / 范围：A，`src/source-adapters.js` 内 graph fingerprint 的字节交付。
- Related: [Session lifecycle](../design-docs/indexed-materialized-session-lifecycle.md), [loading performance](../design-docs/timeline-loading-and-rendering-performance.md), [B closeout](../exec-plans/completed/2026-09-06-pqs-projection-digest-batching.md). / 相关：Session 生命周期、加载性能及 B 关闭记录。

## Decision boundary / 决策边界

A remains closed under its historical >=30% fingerprint-phase gate. This document records how to implement and evaluate it if reopened; it does not reopen A, change that gate, authorize benchmarks, or implement B. Promotion requires an explicit decision to reopen, a frozen acceptance metric and representative corpus, and an active execution plan. A different gate must be declared before new measurements rather than retroactively treating historical results as acceptance. / A 在历史 fingerprint 阶段改善 >=30% 的门槛下仍为关闭状态。本文记录若重开时应如何实施和评价；不重开 A、不修改门槛、不授权基准测试，也不实施 B。晋升需要明确的重开决定、冻结的验收指标与代表性语料，以及活跃执行计划。新门槛须在新测量前声明，不能追溯性地把历史结果视为验收通过。

Maintenance cost is local and controllable, not necessarily a net improvement. Explicit contracts, shared delivery, and independent tests can improve structure even without batching. / 维护成本局部且可控，但不必然带来净改善。明确合同、共享交付和独立测试即使没有 batching 也能改善结构。

## Implementation boundary / 实施边界

1. Introduce one small module-private writer shared by sync and async graph walkers. Use a fixed 65,536-byte staging buffer per invocation, with private occupancy and flush state. Avoid pools, caches, capacity tuning, public exports, and configurable framework machinery. / 引入一个由同步、异步 graph walker 共用的模块内私有 writer。每次调用使用固定 65,536-byte staging buffer，内部维护占用量和 flush 状态。避免池化、缓存、容量调优、公共导出和可配置框架。
2. Preserve text bytes exactly: convert with `String(text)`, compute UTF-8 byte length, then emit decimal length, `:`, and the value's UTF-8 bytes. Batch boundaries carry no meaning. Do not join tokens or split UTF-16 strings. / 精确保留文本字节：以 `String(text)` 转换，计算 UTF-8 字节长度，再输出十进制长度、`:` 和值的 UTF-8 字节。Batch 边界无语义；不拼接 token，不拆分 UTF-16 字符串。
3. Write the prefix into staging; flush before a whole value that cannot fit in the remaining space. Encode values into staging only when their known byte length fits. For values larger than capacity, flush and call the original native string `hash.update` directly; avoid a temporary Buffer per token or a large temporary payload Buffer. / 将前缀写入 staging；完整值放不下时先 flush。只有已知字节长度可容纳时才把值编码到 staging。超容量值先 flush，再直接使用原生字符串 `hash.update`；避免每个 token 分配临时 Buffer 或为超大值分配临时 payload Buffer。
4. Include private `writeRaw(bytes)` and `digest()` boundaries. Raw writes flush pending text and immediately hash the original byte view, without adding a length prefix or deferring its read. Digest flushes pending bytes before finalization. No walker may bypass pending staging with a direct hash update. / 私有边界还须包含 `writeRaw(bytes)` 和 `digest()`。Raw 写入先 flush 待处理文本，再立即 hash 原始字节视图，不新增长度前缀、不延迟读取。Digest 在结束前 flush；walker 不得绕过待处理 staging 直接更新 hash。
5. Preserve traversal order, identity state and reuse, descriptors, prototype handling, cycles/shared references, mutation guards, and error precedence. Keep async 256 KiB raw tasks, 4,096-operation cancellation/yield checks, observer traces, and final yield/abort check unchanged. Flushes must not add traversal operations or callbacks. / 保持遍历顺序、identity state 及复用、descriptor、prototype、循环／共享引用、mutation guard 和错误优先级。保持 async 256 KiB raw task、每 4,096 operation 的取消／yield 检查、observer trace 和最终 yield／abort 检查。Flush 不增加遍历 operation 或 callback。
6. Keep A separate from PQS. A's raw-byte path and the absence of proven shared maintenance demand favor a private helper now; different upper-level lifecycles alone do not prove that future low-level sharing is wrong. / A 与 PQS 分开。A 的 raw-byte 路径和尚未证实的共同维护需求支持当前使用私有 helper；上层生命周期不同本身不能证明未来共享底层实现一定错误。

The 64 KiB bound applies only to each writer's staging allocation, not total process memory, temporary string work, graph traversal state, or concurrent invocations. / 64 KiB 上限只针对每个 writer 的 staging 分配，不涵盖进程总内存、临时字符串工作、graph 遍历状态或并发调用。

## Correctness evidence / 正确性证据

- During migration, compare actual old/new module behavior using a test-local legacy oracle, including generated graphs and boundary cases. Independently compare each walker against the baseline; new-sync/new-async parity alone can hide a shared writer bug. / 迁移期间用 test-local legacy oracle 比较实际新旧模块行为，包含生成式 graph 和边界场景。分别将每个 walker 与基线比较；只做新 sync／async parity 会掩盖共享 writer 错误。
- Long term, retain independently specified byte-stream vectors, legacy-derived fixed graph digests, boundary fixtures, raw ordering/read-timing assertions, sync/async parity, and cancellation/yield/observer/mutation behavior tests. Expected bytes must not be generated by the new writer or its encoding helper. / 长期保留独立定义的字节流向量、从旧实现冻结的 graph 摘要、边界 fixture、raw 顺序／读取时点断言、sync／async parity，以及取消／yield／observer／mutation 行为测试。预期字节不能由新 writer 或其编码 helper 生成。
- Cover empty strings, exact fills, prefix-fit/value-overflow, repeated flushes, oversize values, multibyte UTF-8, surrogate pairs and isolated surrogates, raw bytes between staged text, zero-length/raw subviews, and final pending bytes. Graph fixtures cover cycles, shared references, prototypes, descriptors, symbols, functions/accessors, Map/Set, and typed views. Choose stable fixtures for fixed digests. / 覆盖空字符串、恰好填满、前缀可放但值溢出、反复 flush、超大值、多字节 UTF-8、代理对及孤立代理项、staged 文本之间的 raw bytes、空 raw／子视图和最终待处理字节。Graph fixture 覆盖循环、共享引用、prototype、descriptor、symbol、function／accessor、Map／Set 和 typed view。固定摘要选用可稳定复现的 fixture。
- A full legacy walker need not be maintained forever. Retain or retire the oracle according to its independent bug-finding value and upkeep; a tiny reference writer can remain worthwhile. Preserve independent correctness evidence when removing it. / 不必永久维护完整 legacy walker。按独立查错价值和维护成本决定 oracle 去留；很小的参考 writer 仍可能值得保留。移除时必须保留独立正确性依据。

## Historical evidence and limits / 历史证据及边界

The local investigation artifacts are `tmp/hash-writer-investigation/ATTRIBUTION-DECISION.md`, `investigation/v2/SUMMARY.md`, and `investigation/v2-supplement/SUMMARY.md` under that directory. These ignored local files may not exist in another checkout. Recorded target SHA: `d8bde19400f634493f9612350b446b650fa0f10e`; Node `v24.18.1`. The fixed-input supplement used synthetic Codex Sessions of 16/128/512 turns. / 本地调查材料位于上述路径；这些 ignored 文件可能不在其它 checkout 中。记录的目标 SHA 为上述值，Node 为 `v24.18.1`。固定输入补充使用 16／128／512 turn 的合成 Codex Session。

| Measurement / 测量 | Representative / 代表点 | Large / 大点 | Stress / 压力点 |
| --- | ---: | ---: | ---: |
| Sync fingerprint reduction / 同步 fingerprint 耗时下降 | 26.95% | 28.55% | 27.19% |
| Async fingerprint reduction / 异步 fingerprint 耗时下降 | 23.83% | 24.12% | 23.76% |
| Materialization before → after / 物化前 → 后 | 68.458 → 54.650 ms | 489.099 → 384.308 ms | 1999.203 → 1561.042 ms |
| Materialization reduction / 物化耗时下降 | 20.17% | 21.43% | 21.92% |

The measured materialization function rebuilds a Session without the owner's complete-Session cache. It uses two warmups and seven timed calls per arm; it is not a cold OS file-cache experiment, server startup measurement, HTTP measurement, or click-to-paint browser measurement. Real-source timings in the earlier summary are explicitly limited evidence, not a balanced acceptance matrix. Do not claim a universal 20% user-visible gain. V1 reduced update counts but regressed timing; update-count reduction alone is insufficient. / 所测物化函数不使用 owner 的完整 Session cache，重新构建 Session；每组有两次预热和七次计时调用。它不是操作系统冷文件缓存实验，也不是服务启动、HTTP 或浏览器点击到绘制测量。早期汇总中的真实来源计时明确只是有限证据，不是平衡验收矩阵。不能宣称普遍有 20% 用户可感知收益。V1 虽减少 update 次数却出现耗时回退；仅减少调用次数不足以验收。

## User-visible expectations / 用户可感知的预期

| User stage / 用户阶段 | Expected effect if implemented / 实施后的预期影响 |
| --- | --- |
| Start service, build/load project index, show Session list / 启动服务、构建或载入项目索引、显示会话列表 | No established end-to-end estimate; this does not optimize parsing, index I/O, or PQS digest. Any small graph guards need separate attribution. / 无已证实的端到端估计；不优化解析、索引 I/O 或 PQS digest。小型 graph guard 的收益须单独归因。 |
| Open an uncached Session timeline / 打开未缓存会话的时间线 | Primary benefit: less server materialization wait before the response. Historical synthetic savings were about 14/105/438 ms at the three sizes. / 主要收益：响应前的服务端物化等待缩短。历史三个合成规模约节省 14／105／438 ms。 |
| Reopen cached or already-prewarmed Session / 重开已缓存或已预热会话 | No direct materialization saving on a cache hit; owner returns retained Session. / 命中缓存时直接返回保留的 Session，没有本次物化节省。 |
| Reopen after eviction or revision replacement / 淘汰或 revision 更换后重开 | Benefits when a fresh materialization is required; this does not change hit rate or retention policy. / 需要重新物化时受益；不改变缓存命中率或保留策略。 |
| Paginate/filter timeline or open event/detail / 时间线分页、筛选或打开事件／详情 | Usually cache-hit behavior after initial load; benefits only if that request triggers materialization. Query work and detail rendering are unchanged. / 首次加载后通常命中缓存；只有请求触发物化才受益。查询工作和详情渲染不变。 |
| Scroll, fold, render Markdown or highlight code / 滚动、折叠、渲染 Markdown 或代码高亮 | No direct browser-rendering improvement. / 无直接浏览器渲染改善。 |
| Project-wide search/filter / 项目级搜索与筛选 | Resident query-store path has no direct A speedup; opening an uncached result can benefit. / 常驻 query-store 路径无直接 A 提速；打开未缓存搜索结果可能受益。 |
| Background prewarm and concurrent waits / 后台预热与并发等待 | Faster jobs may finish prewarming or release scheduler slots earlier; secondary benefit is unmeasured and workload-dependent. / 更快完成的任务可能提前完成预热或释放调度槽；间接收益未测量且依赖负载。 |

For a serial, non-overlapped click path, let M be materialization time, O all other time, and r the materialization reduction: old = M + O; new = M(1-r) + O; overall fractional saving = rM/(M+O). Do not multiply a measured materialization gain by the fingerprint share again, or apply the fingerprint-phase gain to the whole click path. Browser concurrency and queueing require direct measurement. / 对串行且不重叠的点击路径，设 M 为物化时间、O 为其它时间、r 为物化耗时下降比例：原耗时 = M + O；新耗时 = M(1-r) + O；整体节省比例 = rM/(M+O)。已测物化收益不能再乘一次 fingerprint 占比，也不能把 fingerprint 阶段收益直接套到整个点击路径。浏览器并发和排队影响须直接测量。

## Promotion and validation / 晋升与验证

If reopened, freeze acceptance scope first: clean per-phase timing plus actual uncached click-to-first-usable-timeline latency, absolute milliseconds and relative change, representative sources/sizes, cached controls, tail latency, concurrency, and memory. Preserve sealed inputs, baseline/candidate identities, balanced order, warmups, and environment details. Keep correctness and diagnostics separate from clean timing. Historical results inform the hypothesis, not production acceptance. / 若重开，先冻结验收范围：干净的分阶段计时及实际未缓存点击到首个可用时间线的延迟、绝对毫秒和相对变化、代表性来源／规模、缓存命中对照、尾延迟、并发及内存。保留封存输入、基线／候选身份、平衡顺序、预热和环境细节。正确性与诊断测量和干净计时分开。历史结果用于建立假设，不代表生产验收。

Run boundary and module-level behavior checks first, then applicable source-adapter/materialization tests and repository-required checks. Reuse legacy differential evidence during migration, review the final diff for accidental traversal or lifecycle changes, and only then assess the frozen performance gate. On promotion, record accepted internal decisions in the design docs and implementation steps in an active plan; update product specs only if the external contract changes. / 先运行边界与模块行为检查，再运行相关 source-adapter／物化测试和仓库要求的检查。迁移期间使用 legacy 差分证据，审查最终 diff 是否意外改变遍历或生命周期，然后评价冻结的性能门槛。晋升时将接受的内部决策写入 design docs，将实施步骤写入 active plan；只有外部合同变化时才修改 product spec。
