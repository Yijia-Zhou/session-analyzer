# Post-batching fingerprint attribution / 批量写入后的 fingerprint 归因

## Scope and provenance / 范围与来源

This is a measurement-only follow-up to #57, dated 2026-09-11. It changes no production code, hash algorithm, traversal, guard pass/window, cancellation, error precedence or #20 reader. The preceding experiment is [equivalent textual hash batching](deepseek-readback-measurement.md#equivalent-textual-hash-batching-experiment--等价文本-hash-批量写入实验). / 本文为 2026-09-11 对 #57 的纯测量跟进；不修改生产代码、hash 算法、遍历、guard pass／窗口、取消、错误优先级或 #20 reader。前序实验见上述链接。

GitHub's Git Commit API identifies merged main as `73f759fd112429313fb49da7a03971a961c972c7`, tree `52e67baf5dbc91808768d5df603c7dce13935e48`. Measurements use local `2cd0f2ffcde57799b0ad7b600cae64cc1964ca6b`, whose complete tracked tree is identical. Both SSH and HTTPS Git fetch failed DNS resolution; this is an explicitly verified identical-tree checkout, not a claim that local main was fetched. Documentation is added after establishing the baseline; executable files remain unchanged. / GitHub Git Commit API 确认合并 main 及 tree 如上。本次使用本地 `2cd0f2f…`，完整 tracked tree 与合并 main 相同。SSH／HTTPS Git fetch 均因 DNS 解析失败；这里使用经核验的相同源码树，不声称本地 main 已更新。确立基线后新增测量文档，执行代码保持不变。

Host: Windows 11 `10.0.22631`, Node `v24.18.1`, Ryzen 5 5600U, 12 logical CPUs, 14,864,674,816 bytes RAM. Workers run sequentially, with no concurrent benchmark/test worker, forced GC, heap tuning or OS-cache reset. Cold means no Materialized Session. / 环境为上述 Windows／Node／CPU／内存；worker 串行执行，不并发基准／测试、不强制 GC、不调整 heap 或清空 OS cache。Cold 指无 Materialized Session。

## Synthetic CPU captures / 合成 CPU 采集

Run the existing worker directly for each shape: / 各形状直接运行既有 worker：

```powershell
node --cpu-prof --cpu-prof-interval=1000 --cpu-prof-dir=<ignored-output> --cpu-prof-name=<shape>.cpuprofile scripts/deepseek-readback-profile.js --worker --sizes=50000 --shape=<shape> --compression=plain --fingerprint-profile=off
node scripts/deepseek-readback-profile.js --worker --sizes=50000 --shape=<shape> --compression=plain --fingerprint-profile=on
```

Each table cell is one observation, not a paired performance comparison against #57. CPU captures disable detailed fingerprint counters but retain existing phase timing; accounting captures enable counters separately. / 每格为一次观测，不是与 #57 的配对性能比较。CPU 采集关闭详细 fingerprint 计数，保留既有阶段计时；工作量计数另行采集。

| Capture / 采集 | Shape / 形状 | First Detail ms | Materialization ms | Fingerprint ms | Fingerprint / Detail | Cold RSS MiB | Lifetime maxRSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CPU | tool-dense | 14,090.66 | 13,871.00 | 12,288.36 | 87.21% | 749.79 | 1,125.47 |
| CPU | message-dense | 18,150.30 | 17,994.72 | 16,269.81 | 89.64% | 817.90 | 1,046.53 |
| Counters / 计数 | tool-dense | 13,206.90 | 13,039.41 | 11,627.69 | 88.04% | 1,059.18 | 1,437.97 |
| Counters / 计数 | message-dense | 16,568.47 | 16,426.35 | 14,901.06 | 89.94% | 805.87 | 1,034.69 |

Fingerprint duration sums three nonoverlapping parent spans: private capture, private recheck and projection recheck. Memory includes generator, index, server/client and warm-read tails; maxRSS is not per-request or fingerprint-only memory, and checkpoints can miss transient peaks. / Fingerprint 时长为 private capture、private recheck、projection recheck 三个不重叠父阶段之和。内存包含生成器、索引、服务端／客户端及热读尾部；maxRSS 不是单请求或仅 fingerprint 内存，检查点可能遗漏瞬时峰值。

Reconstruct parent chains through profile `nodes[].children`, retain samples with `graphFingerprintAsync` ancestry, and weight samples by corresponding `timeDeltas`. The tool/message profiles contain 19,846/22,995 samples, with 11,221.41/14,833.79 ms on selected stacks out of 22,264.84/25,752.99 ms total sampled time. Categories below are disjoint, in priority order: update, byte-length/UTF-8, remaining write, task helpers, identity helpers, remainder. / 通过 profile 的子节点关系还原父链，保留祖先含 `graphFingerprintAsync` 的样本，按对应 `timeDeltas` 加权。工具／消息 profile 分别包含上述样本数及栈内／全进程时长。下列类别按 update、byte-length／UTF-8、write 余量、task helper、identity helper、其余顺序互斥分类。

| Share within sampled fingerprint stacks / fingerprint 栈内占比 | Tool-dense | Message-dense |
| --- | ---: | ---: |
| `Hash.update`, including native encoding/flattening/crypto / 含 native 编码／flattening／crypto | 19.51% | 23.44% |
| `Buffer.byteLength` / UTF-8 outside update / update 外 | 11.11% | 10.37% |
| Remaining textual `write` / 文本 write 余量 | 21.67% | 21.03% |
| `appendWriteKey` / `pushSequence` helpers | 4.43% | 4.32% |
| `objectId` / `symbolId` helpers | 3.03% | 3.62% |
| Traversal body and unresolved inlined work / 遍历主体及未分离内联工作 | 40.25% | 37.22% |

The old 64–65% tiny-update conclusion is superseded for this implementation. The graph-body samples cannot all be called task allocation: the hottest position hints include dispatch to `write`, `Reflect.ownKeys`, descriptors and `seen.add`; named task helpers capture only part of allocation/stack work. `pendingText += prefix + valueText` appears in write position hints, but ordinary CPU profiles do not separately resolve rope creation/flattening, UTF-8 conversion and native SHA-256 inside update. Position ticks are unweighted diagnostic hints and may include inlined source positions, not a precise line-level cost model. / 旧的 tiny update 占 64–65% 结论不再适用于此实现。不能把全部 graph-body 样本称为 task allocation：热点位置提示同时包含 write 分派、`Reflect.ownKeys`、descriptor 和 `seen.add`；命名 task helper 仅覆盖部分 allocation／stack 工作。文本拼接行出现在 write 位置提示中，但普通 CPU profile 无法单独分解 rope 创建／flattening、UTF-8 转换及 update 内 native SHA-256。Position tick 是未加权提示，且可能含内联源码位置，不是精确逐行成本模型。

Whole-process GC samples total 1,696.11/1,748.44 ms. V8's GC samples lack reliable fingerprint ancestry; they are reported separately, not silently charged to strings or task objects. Native crypto is a subset of the update row, so these captures do not support a claim that SHA-256 core dominates remaining cost. / 全进程 GC 样本总计 1,696.11／1,748.44 ms。V8 GC 样本没有可靠的 fingerprint 祖先，故单列，不擅自归入字符串或 task 对象。Native crypto 仅是 update 行的一部分，因此本次采集不支持“剩余成本由 SHA-256 核心主导”的结论。

## Workload accounting / 工作量核算

Both counter captures contain all seven invocations. Each of the three complete Materialized Session passes has identical counters within its shape: / 两次计数采集均包含七个调用；同形状三个完整 Materialized Session pass 的计数一致：

| Per full pass / 每完整 pass | Tool-dense | Message-dense |
| --- | ---: | ---: |
| Objects / 对象 | 500,029 | 700,028 |
| Own descriptors / 自有属性描述符 | 3,325,145 | 4,150,142 |
| Tasks | 23,776,051 | 29,751,029 |
| Text tokens | 28,601,278 | 36,051,250 |
| SHA-256 input bytes | 293,577,892 | 341,259,441 |
| Physical updates / 实际提交 | 5,805 | 7,264 |
| Yields | 5,805 | 7,264 |

Tool full-pass elapsed times are 4,077.17/3,778.01/3,770.98 ms; message times are 5,073.86/4,978.90/4,844.38 ms (capture/private recheck/projection recheck). All-invocation yield-wait shares are 6.03%/5.14%; active remainder is wall time minus observed waits, not process CPU time. These preserve the #57 graph/task/byte/update counts. / 工具完整 pass 时长依次为 4,077.17／3,778.01／3,770.98 ms，消息为 5,073.86／4,978.90／4,844.38 ms（capture／private recheck／projection recheck）。全部调用的 yield-wait 占比为 6.03%／5.14%；active remainder 为墙钟减去观测等待，不是进程 CPU 时间。图／task／字节／update 计数保持 #57 的结果。

All four workers pass materialization 0→1, 50,001 Raw Records, 25,000/50,000 Logical Events, exact requested nonempty Detail, Raw reading, warm reuse and unchanged source dev/ino/size/mtime/ctime. Existing focused byte-stream and readback-profiler tests pass 19/19. / 四个 worker 均通过物化 0→1、50,001 条 Raw、25,000／50,000 个 Logical、精确匹配且非空的 Detail、Raw 阅读、热态复用及来源身份未变；既有字节流与 readback-profiler 聚焦测试通过 19／19。

## Real-corpus acceptance / 真实语料验收

The user designated the repositories and explanations under ignored `tmp/` as the intended corpus. The local evidence notes distinguish six historical real Sessions from the interactive lab and the two current-writer Sessions generated with public test content. Inventory covers all 19 supplied artifacts, all Zstd: historical 6 / 10,751,750 bytes, lab 11 / 2,042,084 bytes, writer 2 / 46,582 bytes. These are three evidence groups, not 19 representative organic Sessions. / 用户指定 ignored `tmp/` 内的样本仓库及说明为目标语料。当地说明将六份历史真实会话与交互 lab、两份用公开测试内容生成的 current-writer 会话区分。已盘点全部 19 个工件，均为 Zstd：历史 6 份／10,751,750 字节，lab 11 份／2,042,084 字节，writer 2 份／46,582 字节。这是三组不同来源证据，不是 19 份具代表性的日常真实会话。

Because the corpus is small, measure every artifact rather than subsample. Historical samples span 1,693–11,757 Raw Records, 115–1,437 Logical Events and 0.034–0.222 Logical/Raw density. This covers the largest artifact, several size bands and both density extremes. Synthetic tool/message densities are 0.5/1.0; equal storage bytes or Raw counts do not imply equal fingerprint workloads. Artifact sizes below are compressed bytes, not comparable to synthetic plain sizes. / 语料数量较少，因此逐份全量测量。历史样本覆盖 1,693–11,757 条 Raw、115–1,437 个 Logical，Logical／Raw 密度为 0.034–0.222，含最大工件、多个尺寸区间及密度两端。合成工具／消息密度为 0.5／1.0；相同存储字节或 Raw 数不代表相同 fingerprint 工作量。下表工件大小为压缩字节，不与合成 plain 大小直接比较。

The ignored harness wraps the existing `createServer` `buildIndex`, `materializeSession` and `buildEventDetail` options; it delegates to the unchanged adapter. Each worker re-enumerates a group by descending artifact size, reads the selected header in memory, and uses `resolveFsPath` to preserve its original repository path flavor. The completed compact index supplies the event ID through its existing query shard; there is no Timeline request or preliminary materialization in the worker. First Detail uses the first Main event, or Protocol if Main is empty. A repeated Detail and matching parsed Raw header verify actual reading and warm reuse. / ignored harness 包装既有 server 的三个选项，并委托未修改的 adapter。每个 worker 按工件尺寸降序重新枚举分组，在内存读取所选 header，以 `resolveFsPath` 保持原始仓库路径风格。从已完成的紧凑索引 query shard 获取 event ID；worker 内不先请求 Timeline 或预物化。首次 Detail 选择首个 Main event，无 Main 时选 Protocol；重复 Detail 与匹配且可解析的 Raw header 核验实际阅读及热态复用。

Workers have a 240-second parent deadline, a 60-second indexing poll deadline plus one in-flight HTTP timeout, and 120-second individual HTTP timeouts. They check the selected project/source/root, matching source Session and artifact in memory, successful indexing, index count, source diagnostics, exact materialized Raw/Logical counts, cold 0→1, nonempty requested Detail, warm reuse and unchanged target dev/ino/size/mtimeNs/ctimeNs. No diagnostic log directory is configured. Only numeric/boolean metrics, fixed phases/codes and anonymous group/size ranks are retained; no transcript, Session ID or source-path mapping is saved. Real CPU files are summarized and then removed. / Parent worker 限时 240 秒，索引轮询限时 60 秒加至多一次进行中 HTTP 超时，单次 HTTP 限时 120 秒。核验目标项目／来源／根、内存中匹配的来源会话与工件、索引成功及数量、来源诊断、物化 Raw／Logical 精确计数、冷态 0→1、所请求非空 Detail、热态复用及目标文件身份未变。不配置诊断日志目录；仅保留数值／布尔指标、固定阶段／错误码及匿名分组／尺寸排序，不保存转录、会话 ID 或来源路径映射。真实 CPU 文件汇总后删除。

The first attempt incorrectly used host `path.resolve` for historical POSIX repository roots, producing zero indexed Sessions in six cases. These were recorded as failed harness checks and excluded from timing evidence. Switching only the local harness to the project's existing path helper fixed selection; all cases were then rerun. No source artifact was relocated, rewritten or repaired. / 首次试跑错误地以宿主 `path.resolve` 处理历史 POSIX 仓库根，使六个场景索引为零；这些结果记录为 harness 核验失败，不纳入时延证据。仅将本地 harness 改用项目既有路径 helper 后修复选择，并重跑全部场景。未移动、改写或修复来源工件。

Primary measurements disable CPU sampling and detailed counters. All 19/19 pass every acceptance check with zero source diagnostics. / 主测量关闭 CPU 采样及详细计数；19／19 均通过全部验收检查，来源诊断为零。

An independent Luna review subsequently strengthened the local harness: read a Raw Record actually referenced by the selected Detail rather than only the Session header, restrict retained codes to an explicit allowlist, and forward the top-level detailed-counter flag to child workers. An additional 19/19 fresh workers passed Detail→Raw correspondence, cold ownership, all other checks and zero diagnostics. The timing tables retain their original captures; this additional verification does not relabel earlier header reads as correspondence checks. No unexpected code or private value was found in retained earlier output. / Luna 独立复查后加强本地 harness：读取所选 Detail 实际引用的 Raw，而非仅会话 header；保留代码改用显式白名单；将顶层详细计数开关传递给 child worker。额外 19／19 个全新 worker 通过 Detail→Raw 对应、冷态归属及其他检查，诊断为零。时延表保留原始采集，不将早期 header 阅读追认成对应关系检查。此前保留输出未发现意外错误码或私有值。

| Historical size rank / 历史尺寸排序 | Artifact MiB | Raw | Logical | First Detail ms | Materialization ms | Fingerprint ms | Cold RSS MiB | Lifetime maxRSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.906 | 11,757 | 1,387 | 2,421.78 | 2,137.41 | 1,726.39 | 475.02 | 495.44 |
| 2 | 2.559 | 11,050 | 1,437 | 2,315.49 | 2,048.51 | 1,646.83 | 454.34 | 465.01 |
| 3 | 1.835 | 7,826 | 1,010 | 1,652.58 | 1,430.82 | 1,150.79 | 409.87 | 434.12 |
| 4 | 1.620 | 7,185 | 864 | 1,448.22 | 1,261.42 | 988.13 | 269.13 | 300.69 |
| 5 | 0.880 | 3,344 | 115 | 724.73 | 612.93 | 463.75 | 310.07 | 318.75 |
| 6 | 0.453 | 1,693 | 376 | 396.23 | 341.98 | 277.42 | 319.44 | 337.80 |

Historical indexing takes 708–1,909 ms before these primary first-Detail measurements; each selected project indexes 2 or 4 Sessions. The memory values include that project index, not only the selected Session. The 11 lab first Details span 32.53–711.56 ms, and the two writer cases are 54.34/60.35 ms. They independently pass the same checks but do not establish daily-use performance. / 历史主测量的索引在上述首次 Detail 之前耗时 708–1,909 ms；所选项目索引包含 2 或 4 个会话。内存值包含该项目索引，不只所选会话。11 个 lab 首次 Detail 为 32.53–711.56 ms，两份 writer 为 54.34／60.35 ms；它们独立通过相同检查，但不能证明日常使用性能。

Two additional fresh unprofiled workers per largest historical artifact give three-observation median [min,max] first Detail: rank 1 **2,455.98 [2,421.78,2,507.59] ms**, rank 2 **2,315.49 [2,307.27,2,329.39] ms**. These six measurements contain no ≥5-second first Detail; fingerprint spans remain about 70.5–71.7% of first Detail. / 最大两份历史工件各增加两个全新、无 profile 的 worker，三次首次 Detail 的中位数及区间如上；六次测量均无 ≥5 秒首次 Detail，fingerprint 阶段仍占约 70.5–71.7%。

Separate CPU workers for ranks 1/2 observe first Detail 2,541.77/2,474.66 ms. Their fingerprint stack categories are: / 排序 1／2 的独立 CPU worker 首次 Detail 为 2,541.77／2,474.66 ms；fingerprint 栈内分类如下：

| Fingerprint stack share / 栈内占比 | Rank 1 | Rank 2 |
| --- | ---: | ---: |
| Hash update including encoding/crypto / 含编码／crypto | 20.52% | 19.20% |
| Byte-length / UTF-8 outside update / update 外 | 12.40% | 11.99% |
| Text write remainder / 文本 write 余量 | 21.12% | 24.70% |
| Task sequence helpers | 3.52% | 2.98% |
| Identity helpers | 2.71% | 2.68% |
| Traversal body / unresolved / 遍历主体及未分离工作 | 39.73% | 38.45% |

The same attribution limits apply. Whole-process GC is 260.54/259.02 ms, with no reliable allocation-family assignment. Two separate counter workers pass seven-invocation accounting: each full pass at rank 1 visits 61,566 objects / 518,494 properties / 3,691,031 tasks and hashes 46,481,919 bytes in 1,007 updates with 902 yields; rank 2 is 59,236 / 493,132 / 3,511,167 / 43,561,132 bytes / 946 updates / 858 yields. Each graph is scanned three times. Updates exceeding yields confirm that real text sometimes flushes outside the ordinary task boundary; synthetic updates-equal-yields is not generalized. / 可观测限制相同。全进程 GC 为 260.54／259.02 ms，不能可靠归属分配类别。两次独立计数 worker 通过七调用核算；最大样本每完整 pass 的对象／属性／task／输入字节／update／yield 计数如上，第二样本亦如上。每个图仍扫描三遍。Update 数超过 yield 数，证明真实文本有时会在普通 task 边界之外 flush；不把合成场景 update 等于 yield 推广到真实图。

## Decision / 决策

**Accept and close tracker item #22 with a documented synthetic-extreme limitation. No further optimization is currently planned; the next performance investigation moves to debt #20.** / **接受并关闭 tracker 第 #22 项，保留已记录的 synthetic extreme 限制。目前不再继续优化，下一次性能调查转向债务 #20。**

This is a prioritization decision, not a claim of instantaneous first reading. Before measurement, repeated ≥5-second first Detail was treated as a clear continuation signal; the 1–5-second range requires judgment. Exhaustive coverage of the supplied historical corpus, stable largest-case results around 2.3–2.5 seconds, and no observed ≥5-second case justify accepting its current first-read delay rather than starting another optimization. Indexing and browser rendering are outside the first-Detail number. / 这是优先级决策，不声称首次阅读瞬时完成。测量前将反复 ≥5 秒首次 Detail 视为明确的继续优化信号，1–5 秒区间仍需判断。所提供历史语料已全量覆盖，最大场景稳定在约 2.3–2.5 秒且未出现 ≥5 秒，因此接受其当前首次阅读等待，不启动另一轮优化。索引及浏览器渲染不包含在首次 Detail 数值中。

Closure accepts the supplied corpus and retains explicit limitations: only six historical real Sessions were available, all Zstd, with at most 1,437 Logical Events; the other 13 samples are lab/generated writer evidence. No common-workload distribution, larger contemporary organic corpus, browser end-to-end acceptance or real plain-artifact coverage was established. Synthetic 50k still takes roughly 13–18 seconds in these instrumented observations, retained as an extreme-case limitation rather than generalized to normal real Sessions. Reopen only if real-session evidence shows materially problematic cold first-read latency. / 本次关闭基于对所提供语料的接受，并保留明确限制：仅有六份历史真实会话，均为 Zstd，最多 1,437 个 Logical；其余 13 份为 lab／生成 writer 证据。未建立常见负载分布、更大的当代日常语料、浏览器端到端验收或真实 plain 工件覆盖。本次带 instrumentation 的 50k 合成观测仍约 13–18 秒，作为极端场景限制保留，不推广为普通真实会话的表现。仅当后续真实会话证据显示具有实际影响的冷态首次阅读时延时重新打开本项。

The profiles retire the tiny-update diagnosis but do not demonstrate a single isolated low-risk winner or crypto-core saturation. They do not justify reducing passes, weakening either private-validator/query-projection mutation window, or changing hashes. No byte-buffer, traversal or guard-architecture implementation is bundled here; #20 likewise remains a future task. / Profile 淘汰 tiny-update 旧诊断，但未证明单一、已分离且低风险的优化胜出点，也未证明 crypto 核心饱和。不据此减少 pass、削弱 private-validator／query-projection 任一 mutation 窗口或更换 hash。本次不混入 byte-buffer、遍历或 guard architecture 实现；#20 同样属于后续任务。

Local reproducibility artifacts are under ignored `tmp/post-batching-attribution/`: allowlisted corpus inventory, HTTP aggregate JSON, independent fingerprint counters, CPU summaries and local runners. Production files and product contracts are unchanged; no build/browser refresh or persistent server restart is required. / 本地可复现工件位于 ignored 目录：白名单语料盘点、HTTP 汇总 JSON、独立 fingerprint 计数、CPU 摘要及本地 runner。生产文件及产品合同未变，无需构建／浏览器刷新或重启持久 server。
