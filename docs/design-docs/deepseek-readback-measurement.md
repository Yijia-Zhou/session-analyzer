# DeepSeek HTTP readback measurement / DeepSeek HTTP 回读量测

For the current post-#57 attribution and supplied real-corpus acceptance decision, see [post-batching fingerprint attribution](post-batching-fingerprint-attribution.md). Historical measurements below retain their original implementation identities and definitions. / #57 后的当前归因及所提供真实语料验收决策见[批量写入后的 fingerprint 归因](post-batching-fingerprint-attribution.md)。下方历史测量保留其原始实现身份及定义。

This records repeatable synthetic HTTP measurements: the original warm/full-artifact readback evidence for debt item 20, followed by a separate cold first-materialization attribution for item 22. Neither is an optimization or a universal latency acceptance threshold. / 本文记录可复现的合成 HTTP 量测：先保留债务第 20 项的热态／全工件回读证据，再单独记录第 22 项的冷态首次物化归因。二者均不包含优化，也不设定通用时延验收阈值。

<a id="current-coverage-policy"></a>

## Current phase coverage policy / 当前阶段覆盖策略

As of 2026-09-12, phase topology and semantic accounting are deterministic correctness contracts. Every ordinary HTTP smoke and fingerprint profile still validates exact ordered major/nested phases and counts, balanced stacks, sibling nonoverlap, parent containment, finite nonnegative timings/residuals, cold materialization 0→1, exact Raw/Logical counts and Detail target, unchanged source identity, and (when enabled) all seven fingerprint invocations and byte/count/hash accounting. `coldAttribution()` returns all timings even when the residual exceeds the coverage limit; its report includes `materializationMs`, `materializationAccountedMs`, `materializationResidualMs`, `materializationCoverageLimitMs`, and existing top-level/nested durations. / 自 2026-09-12 起，阶段拓扑与语义核算属于确定性正确性契约。每次普通 HTTP smoke 与 fingerprint profile 仍检查主要／嵌套阶段的精确顺序及次数、栈平衡、兄弟不重叠、子阶段包含关系、有限非负时间／residual、冷物化 0→1、精确 Raw／Logical 数及 Detail 目标、来源身份未变，以及启用时全部七次 fingerprint 调用和字节／计数／hash 核算。即使 residual 超限，`coldAttribution()` 也返回全部时间；报告包含上述四个机器字段及既有顶层／嵌套时长。

Quantitative residual coverage is a measurement-quality contract, enforced only by `npm run test:profile-coverage`. With other repository validation paused, it runs three fresh child processes sequentially, each measuring the deterministic 100-row `tool-dense/plain` real-HTTP fixture. Every sample must pass all structural and semantic checks; all unrounded attributions are printed before testing `minimum(residual1, residual2, residual3) <= 5 ms`. Failures report residual, limit, materialization and accounted milliseconds. CI runs it once in the Node 24 / Ubuntu job, after the concurrent Node suite has finished. Other shape/compression combinations retain their single-run functional coverage. / 定量 residual 覆盖属于量测质量契约，仅由 `npm run test:profile-coverage` 执行。在暂停其他仓库验收时，顺序启动三个独立子进程，各自测量确定性的 100 行 `tool-dense/plain` 真实 HTTP fixture。每个样本均须通过全部结构与语义检查；先输出全部未舍入归因，再检查三次 residual 的最小值不超过 5 ms。失败报告 residual、limit、materialization 和 accounted 毫秒数。CI 在 Node 24／Ubuntu job 中于并发 Node 套件结束后执行一次；其他形状／压缩组合保留单次功能覆盖。

The 5 ms limit is an **absolute instrumentation-coverage bound**, not a latency target. The outer wall clock includes scheduler/GC pauses between independent phase end/start callbacks that neither span includes. Such one-sided noise invalidates a concurrent one-shot coverage gate; the three-sample minimum estimates baseline uncovered work, while a persistent 12 ms gap still fails. Original controlled residuals were 0.60–1.09 ms across 16 cases. The #57 optimization preserved phase boundaries and guard passes; its multi-second materializations do not justify hundreds of milliseconds of uncovered work. The former proportional 5% allowance is removed. The historical sections and completed plans below retain the policy used for their original measurements. / 5 ms 是**绝对 instrumentation 覆盖上限**，不是时延目标。外层墙钟包含独立阶段 end／start 回调之间的调度／GC 暂停，而相邻 span 都不包含该暂停。这种单向噪声使并发单次覆盖门槛不可靠；三次最小值估计基线未覆盖工作，持续 12 ms 缺口仍会失败。原始 16 组受控 residual 为 0.60–1.09 ms。#57 优化保留阶段边界及 guard pass，多秒物化不能成为允许数百毫秒未覆盖工作的理由。移除原有按 5% 比例放宽的规则；下方历史章节及已完成计划保留原始量测所用策略。

## Reproduction / 复现

From the repository root, with a Node runtime providing built-in Zstd compression and decompression: / 在仓库根目录运行，Node 运行时须提供内置 Zstd 压缩和解压能力：

```powershell
# Small smoke / 小规模冒烟
node scripts/deepseek-readback-profile.js --sizes=100 --compression=plain,zstd
# Full bounded matrix; stdout is JSON, progress goes to stderr.
# 完整有界矩阵；标准输出为 JSON，进度写入标准错误。
node scripts/deepseek-readback-profile.js --sizes=10000,50000 --compression=plain,zstd > readback-results.json
```

The default matrix is 10,000 and 50,000 data rows in plain and Zstd form, now across `tool-dense,message-dense` shapes. Use `--shape=tool-dense` to reproduce the original shape. `--sizes` accepts at most four even sizes between 100 and 50,000; `--compression` accepts `plain`, `zstd`, or both. Every case runs in a fresh child process, binds an ephemeral loopback port, and removes only its own generated temporary directory in `finally`. / 默认矩阵包含 10,000 和 50,000 条数据记录的未压缩及 Zstd 工件，现在覆盖 `tool-dense,message-dense` 两种形状。使用 `--shape=tool-dense` 可复现原始形状。`--sizes` 最多接受四个 100–50,000 之间的偶数规模；`--compression` 可选 `plain`、`zstd` 或两者。每个场景使用独立子进程、临时环回端口，并在 `finally` 中仅删除自身生成的临时目录。

## Method and evidence boundary / 方法与证据边界

- Fixtures follow current v0 paired `tool/call` and `tool/result` shapes, one bash operation per pair. Every result has 512 deterministic SHA-256 hex characters. Physical row counts include one additional session header. Zstd has an independently compressed header frame and batches of up to 256 data records per frame. No filesystem operations from the synthetic commands execute. / Fixture 遵循当前 v0 的 `tool/call`、`tool/result` 成对结构，每对表示一个 bash 操作。每个结果含 512 个确定性 SHA-256 十六进制字符；物理行数另含一条 Session header。Zstd header 独立成帧，后续每帧最多 256 条数据记录；合成命令不会真正执行文件系统操作。
- The real `createServer` HTTP implementation indexes once through `/api/project`, with `sessionPrewarm: false`. The first Detail uses the adapter's deterministic tool-event ID convention; there is no preceding Timeline/Analysis read. A transparent materialization counter asserts zero calls before that Detail and exactly one after all requests. / 通过真实 `createServer` HTTP 实现及 `/api/project` 仅索引一次，关闭 `sessionPrewarm`。首次 Detail 根据 adapter 的确定性工具事件 ID 规则寻址，此前不读取 Timeline/Analysis。透传物化计数器断言首次 Detail 前为零次，全部请求结束后总计恰好一次。
- Each case measures one cold-materialization Detail; 12 different Details distributed through the artifact; six repeated requests for the same already-read Detail; one Raw read; and three batches of eight concurrent Raw reads from distinct tool calls. Responses must be HTTP successes with nonempty Detail sections or the expected Raw record. The artifact's device/inode/size/mtime/ctime must remain identical through the run. / 每个场景量测一次冷物化 Detail、分布于工件各位置的 12 个不同 Detail、同一已读 Detail 的六次重复请求、一次 Raw 回读，以及三批各八个不同工具调用的并发 Raw 回读。响应必须成功且含非空 Detail 区段或预期 Raw 记录；执行前后校验工件的设备、inode、大小和修改时间身份一致。
- Timings include loopback HTTP, server processing, transfer and client JSON parsing. Index timing includes job polling. “Cold” means the session is not materialized; generation and indexing have already warmed OS file buffers. “Warm” means materialization reuse and likely warm OS buffers, not avoidance of full-file parsing. Direct HTTP requests bypass the browser Detail cache, so repeated-Detail numbers are not browser cache-hit latency. / 时延包括环回 HTTP、服务器处理、传输和客户端 JSON 解析；索引时延包含任务轮询。“冷”指尚未物化，生成和索引已预热操作系统文件缓冲；“热”指复用物化结果和可能预热的文件缓冲，不代表避免全文件解析。直接 HTTP 请求绕过浏览器 Detail 缓存，因此重复 Detail 数据不等于浏览器缓存命中时延。
- Memory checkpoints are `process.memoryUsage()` in bytes; lifetime `process.resourceUsage().maxRSS` is KiB. The same worker contains generator, server and HTTP client. Checkpoints miss transient synchronous peaks; maxRSS is the process lifetime high-water mark, not a per-request allocation or a leak measurement. No forced GC or OS-cache eviction is used. / 内存检查点来自 `process.memoryUsage()`，单位 bytes；进程生命周期 `process.resourceUsage().maxRSS` 单位为 KiB。同一 worker 包含生成器、服务器和 HTTP 客户端。检查点可能错过同步执行期间的瞬时峰值；maxRSS 是进程生命周期高水位，不是单请求分配量或泄漏量测。不强制 GC，也不清空 OS 缓存。
- This is one development workstation run, not an isolated benchmark host, a production transcript sample, browser rendering measurement, or a statistical comparison between implementations. Small-sample p95 is only a descriptive order statistic. / 这是开发工作站上的单轮执行，不是隔离基准主机、生产转录样本、浏览器渲染量测或实现间统计比较；小样本 p95 仅为描述性顺序统计量。

## Recorded run / 本次结果

Completed 2026-09-08 12:24:37 UTC on Windows 11 (`10.0.22631`), Node `v24.18.1` x64, AMD Ryzen 5 5600U (12 logical CPUs), 14,864,674,816 bytes physical RAM. Checkout: `59a444f50969f07eb9b6766bbe93e2da082c6a85` plus the uncommitted PR 23 review fixes (including bounded stable reads); this is not a clean historical-head benchmark. Other development work could run on the host. / 于 2026-09-08 12:24:37 UTC 完成，环境为 Windows 11（`10.0.22631`）、Node `v24.18.1` x64、AMD Ryzen 5 5600U（12 逻辑 CPU）、14,864,674,816 bytes 物理内存。Checkout 为 `59a444f50969f07eb9b6766bbe93e2da082c6a85` 加本轮尚未提交的 PR 23 review 修复（包含稳定读取预算），不是历史 head 的干净基准。主机可能同时进行其他开发工作。

Repository validation overlapped part of this run: the parent full Node suite (about 31 seconds), focused backend/storage tests, and potentially browser validation. This known CPU/IO contention prevents treating the plain/Zstd timing difference as a compression comparison. The quiet repeat below checks whether the tens-of-seconds cold-read observation persists when repository validation is paused. / 本轮部分时段与仓库验收重叠，包括父 agent 的完整 Node 测试（约 31 秒）、后端／存储专项测试，以及可能的浏览器验收。已知 CPU／IO 争用使 plain/Zstd 时延差不能作为压缩方式比较；下方安静复测检查暂停仓库验收后，冷态读取数十秒的现象是否仍然存在。

The 100-row smoke and all four matrix cases completed successfully. Every case asserted exactly one materialization and an unchanged source identity. / 100 行冒烟及四个完整矩阵场景均成功完成，每个场景均通过“恰好一次物化”和“来源身份未变”断言。

| Data rows / 数据行 | Encoding / 编码 | Plain equivalent MiB / 解压 MiB | Stored MiB / 存储 MiB | Zstd frames / 帧 |
| --- | --- | ---: | ---: | ---: |
| 10,000 | plain | 5.01 | 5.01 | — |
| 10,000 | zstd | 5.01 | 1.58 | 41 |
| 50,000 | plain | 25.23 | 25.23 | — |
| 50,000 | zstd | 25.23 | 7.88 | 197 |

All timings below are milliseconds. Different Detail requests have 12 samples; repeated Detail has six; Raw batches have three batches of eight requests each. / 下表时延单位均为毫秒；不同 Detail 为 12 个样本，重复 Detail 为六个样本，并发 Raw 为三批、每批八个请求。

| Rows / 行 | Encoding / 编码 | Index / 索引 | Cold Detail / 冷 Detail | Different Detail median / 不同 Detail 中位 | Different Detail p95 | Repeat median / 重复中位 | Single Raw / 单 Raw | 8-Raw batch median / 八并发批次中位 | 8-Raw batch max / 批次最大 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | plain | 735.86 | 5604.05 | 44.37 | 66.33 | 45.16 | 25.94 | 74.38 | 83.96 |
| 10,000 | zstd | 724.09 | 6490.33 | 73.82 | 146.77 | 59.58 | 35.59 | 252.89 | 289.44 |
| 50,000 | plain | 4441.38 | 48415.56 | 293.18 | 447.19 | 258.84 | 76.45 | 430.37 | 456.75 |
| 50,000 | zstd | 3742.26 | 29442.50 | 304.24 | 363.18 | 335.87 | 143.65 | 1068.36 | 1109.87 |

| Rows / 行 | Encoding / 编码 | Worker lifetime maxRSS MiB / Worker 生命周期高水位 MiB |
| --- | --- | ---: |
| 10,000 | plain | 527.7 |
| 10,000 | zstd | 470.8 |
| 50,000 | plain | 1036.5 |
| 50,000 | zstd | 1159.0 |

These observations establish real HTTP latency and process high-water evidence for a bounded synthetic workload. The 50,000-row first Detail took 29–48 seconds on this run; therefore this run cannot support a claim that large-session first reading is already quick. It does not isolate first materialization from Detail parsing, and it does not prove Zstd is faster than plain input. Investigate first materialization separately before attributing its delay to the known full-artifact Detail/Raw work. / 本次结果为有界合成负载提供了真实 HTTP 时延及进程高水位证据。50,000 行首次 Detail 在本轮耗时 29–48 秒，因此不能据此声称大会话首次阅读已经足够快。结果未隔离首次物化与 Detail 解析，也不能证明 Zstd 比未压缩输入更快。在将该延迟归因于已知全工件 Detail/Raw 工作前，需要单独调查首次物化。

Warm distinct and repeated Detail still incur material cost, and concurrent Raw requests increase batch latency. This supports further targeted ordinal-read/decode work with bounded memory and accepted-snapshot consistency, without establishing a universal release blocker or justifying an unbounded raw-content cache. / 热态不同及重复 Detail 仍有可观成本，并发 Raw 增加批次延迟。这支持继续研究按 ordinal 定向读取／解码并维持有界内存和 accepted-snapshot 一致性，但不构成通用发布阻断结论，也不能成为引入无界原始内容缓存的理由。

## Quiet repeat / 暂停仓库验收后的复测

The 50,000-row plain/Zstd cases were rerun with other repository tests paused, completing at 2026-09-08 12:28:26 UTC. Node, OS, hardware and synthetic data construction were unchanged. This is still a shared development workstation, not a dedicated benchmark machine; OS buffers are still not cold. Both cases again asserted exactly one materialization and unchanged source identity. / 暂停其他仓库测试后，重新执行 50,000 行 plain/Zstd 场景，于 2026-09-08 12:28:26 UTC 完成。Node、OS、硬件及合成数据构造保持一致。这仍是共享开发工作站，不是专用基准机器；操作系统缓冲仍非冷态。两个场景再次通过恰好一次物化和来源身份未变的断言。

```powershell
node scripts/deepseek-readback-profile.js --sizes=50000 --compression=plain,zstd > readback-quiet-results.json
```

All latency values are milliseconds; memory is worker lifetime maxRSS, converted from KiB to MiB. / 所有时延单位为毫秒；内存为 worker 生命周期 maxRSS，由 KiB 换算为 MiB。

| Encoding / 编码 | Index / 索引 | Cold Detail / 冷 Detail | Different Detail median / 不同 Detail 中位 | Different Detail p95 | Repeat median / 重复中位 | Single Raw / 单 Raw | 8-Raw batch median / 八并发批次中位 | Batch max / 批次最大 | maxRSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 2979.57 | 28084.88 | 251.72 | 274.43 | 228.89 | 51.98 | 368.10 | 394.47 | 1152.2 |
| zstd | 2871.06 | 25707.68 | 239.20 | 297.65 | 229.28 | 114.23 | 741.68 | 746.10 | 818.9 |

The quieter repeat still observed a 25–28 second first Detail and 239–252 ms median warm distinct Detail. Concurrent repository testing therefore does not fully explain the first-run latency. These two observations warrant separate first-materialization investigation, without attributing the cold delay solely to Detail readback or claiming a general compression speed ranking. The maxRSS variation between runs also reinforces that lifetime process high-water is not per-request memory. / 较安静的复测仍观察到首次 Detail 耗时 25–28 秒、热态不同 Detail 中位时延 239–252 ms。因此并行仓库测试不能完整解释首次执行中的延迟。这两轮观察支持单独调查首次物化，但不能将冷态延迟全部归因于 Detail 回读，也不能据此给出通用压缩速度排序。两轮 maxRSS 的变化也再次说明进程生命周期高水位不等于单请求内存。

## Retained samples / 保留的样本

The following compact evidence retains timings and memory checkpoints from this run; rerunning the script emits the full JSON report, including per-request concurrent Raw timings. / 以下紧凑证据保留本轮时延及内存检查点；重新运行脚本可输出完整 JSON 报告，包含并发 Raw 的各请求时延。

```json
[{"dataRows":10000,"compression":"plain","distinctDetailMs":[43.74,35.74,36.59,43.23,48.27,49.87,49.81,44.8,66.33,44.37,46.41,40.87],"repeatedDetailMs":[45.67,43.54,37.37,45.16,46.97,47.37],"concurrentRawRequestMs":[72.93,73.67,72.45,71.95,71.16,72.09,72.32,72.28,83.94,70.02,75.15,76.16,74.94,74.01,75.03,75.09,73.67,61.18,60.62,61.25,72.77,72.19,70.88,71.54],"concurrentRawBatchMs":[74.38,83.96,73.69],"memoryCheckpoints":[{"stage":"beforeFixture","rss":64790528,"heapTotal":19472384,"heapUsed":12603664,"external":2743584,"arrayBuffers":176787,"maxRSSKiB":63284},{"stage":"afterFixture","rss":71151616,"heapTotal":22355968,"heapUsed":12608664,"external":2878696,"arrayBuffers":311859,"maxRSSKiB":73416},{"stage":"afterIndex","rss":185778176,"heapTotal":102572032,"heapUsed":20898312,"external":14436583,"arrayBuffers":10439120,"maxRSSKiB":203320},{"stage":"afterColdDetail","rss":405663744,"heapTotal":297164800,"heapUsed":113107944,"external":24926462,"arrayBuffers":15683933,"maxRSSKiB":397652},{"stage":"afterDistinctDetails","rss":409403392,"heapTotal":187027456,"heapUsed":64479008,"external":35442040,"arrayBuffers":20948738,"maxRSSKiB":456916},{"stage":"afterRepeatedDetails","rss":454295552,"heapTotal":189579264,"heapUsed":87503152,"external":77468548,"arrayBuffers":31470608,"maxRSSKiB":456916},{"stage":"afterSingleRaw","rss":464809984,"heapTotal":189579264,"heapUsed":88355680,"external":87974479,"arrayBuffers":36725766,"maxRSSKiB":456916},{"stage":"afterConcurrentRawBatch1","rss":479850496,"heapTotal":185028608,"heapUsed":45947128,"external":108967252,"arrayBuffers":57718539,"maxRSSKiB":468604},{"stage":"afterConcurrentRawBatch2","rss":469352448,"heapTotal":190009344,"heapUsed":45090888,"external":98460393,"arrayBuffers":52462453,"maxRSSKiB":494248},{"stage":"afterConcurrentRawBatch3","rss":437489664,"heapTotal":189222912,"heapUsed":42941080,"external":66935675,"arrayBuffers":36690054,"maxRSSKiB":540404}],"maxRSSKiB":540404},{"dataRows":10000,"compression":"zstd","distinctDetailMs":[52.25,132.19,78.45,87.75,61.89,69.7,84.81,65.18,73.82,55.34,146.77,75.99],"repeatedDetailMs":[62.23,59.58,62.76,66.33,49.62,55.73],"concurrentRawRequestMs":[242.73,244.01,242.52,241.79,241.88,241.98,240.66,239.54,263.34,262.3,287.18,262.39,286.87,287.35,286.88,287.26,204.77,203.92,204.08,251.74,251.28,204.47,204.09,251.79],"concurrentRawBatchMs":[244.72,289.44,252.89],"memoryCheckpoints":[{"stage":"beforeFixture","rss":64806912,"heapTotal":19472384,"heapUsed":12603624,"external":2743584,"arrayBuffers":176787,"maxRSSKiB":63300},{"stage":"afterFixture","rss":73912320,"heapTotal":22093824,"heapUsed":12753832,"external":4887380,"arrayBuffers":2320543,"maxRSSKiB":76196},{"stage":"afterIndex","rss":209149952,"heapTotal":189173760,"heapUsed":80923816,"external":14573280,"arrayBuffers":10575817,"maxRSSKiB":210556},{"stage":"afterColdDetail","rss":382857216,"heapTotal":292327424,"heapUsed":181394536,"external":31563745,"arrayBuffers":27566282,"maxRSSKiB":373884},{"stage":"afterDistinctDetails","rss":353742848,"heapTotal":198373376,"heapUsed":80042936,"external":41805457,"arrayBuffers":37807994,"maxRSSKiB":431060},{"stage":"afterRepeatedDetails","rss":414433280,"heapTotal":227708928,"heapUsed":127713672,"external":77565381,"arrayBuffers":73567918,"maxRSSKiB":431060},{"stage":"afterSingleRaw","rss":438886400,"heapTotal":238231552,"heapUsed":138923352,"external":90230609,"arrayBuffers":86233146,"maxRSSKiB":431060},{"stage":"afterConcurrentRawBatch1","rss":392876032,"heapTotal":222662656,"heapUsed":85177880,"external":55923887,"arrayBuffers":51932131,"maxRSSKiB":478040},{"stage":"afterConcurrentRawBatch2","rss":425742336,"heapTotal":232398848,"heapUsed":96699128,"external":74396931,"arrayBuffers":70405175,"maxRSSKiB":482064},{"stage":"afterConcurrentRawBatch3","rss":331792384,"heapTotal":189521920,"heapUsed":50976360,"external":26624164,"arrayBuffers":22632408,"maxRSSKiB":482064}],"maxRSSKiB":482064},{"dataRows":50000,"compression":"plain","distinctDetailMs":[447.19,216.23,281.28,298.49,260.43,317.88,264.5,318.99,293.18,302.66,268.05,332.27],"repeatedDetailMs":[248.38,293.25,240.33,293.79,258.84,262.25],"concurrentRawRequestMs":[456.69,419.14,416.92,415.75,417.36,417.46,415.71,416.6,345.6,383.86,307.02,429.8,306.36,306.48,345.45,345.92,364.41,363.31,364.32,364.73,363.73,364.36,364.77,363.28],"concurrentRawBatchMs":[456.75,430.37,365.36],"memoryCheckpoints":[{"stage":"beforeFixture","rss":66736128,"heapTotal":19472384,"heapUsed":12601944,"external":2743584,"arrayBuffers":176787,"maxRSSKiB":65184},{"stage":"afterFixture","rss":88547328,"heapTotal":34029568,"heapUsed":21518392,"external":4417316,"arrayBuffers":1850479,"maxRSSKiB":89892},{"stage":"afterIndex","rss":479715328,"heapTotal":346898432,"heapUsed":218519432,"external":55358801,"arrayBuffers":51361338,"maxRSSKiB":559760},{"stage":"afterColdDetail","rss":743657472,"heapTotal":432922624,"heapUsed":192765120,"external":108195140,"arrayBuffers":77741902,"maxRSSKiB":943972},{"stage":"afterDistinctDetails","rss":797528064,"heapTotal":339099648,"heapUsed":223487048,"external":161104169,"arrayBuffers":104200863,"maxRSSKiB":943972},{"stage":"afterRepeatedDetails","rss":797954048,"heapTotal":340672512,"heapUsed":223264296,"external":161103941,"arrayBuffers":104200635,"maxRSSKiB":943972},{"stage":"afterSingleRaw","rss":852332544,"heapTotal":341942272,"heapUsed":226784432,"external":214028198,"arrayBuffers":130669117,"maxRSSKiB":943972},{"stage":"afterConcurrentRawBatch1","rss":1009872896,"heapTotal":317587456,"heapUsed":157685992,"external":372742818,"arrayBuffers":210016412,"maxRSSKiB":986204},{"stage":"afterConcurrentRawBatch2","rss":846827520,"heapTotal":308797440,"heapUsed":147624776,"external":214005675,"arrayBuffers":130646594,"maxRSSKiB":1061332},{"stage":"afterConcurrentRawBatch3","rss":1009868800,"heapTotal":313917440,"heapUsed":157820320,"external":372742610,"arrayBuffers":210016204,"maxRSSKiB":1061332}],"maxRSSKiB":1061332},{"dataRows":50000,"compression":"zstd","distinctDetailMs":[282.38,313.33,304.24,321.91,284.24,318.31,285.46,332.93,291.43,313.65,278.2,363.18],"repeatedDetailMs":[335.87,397.07,381.73,352.91,321.46,288.84],"concurrentRawRequestMs":[1107.46,1108.66,1106.64,1106.8,1107.62,1106.92,1106.93,1107.29,1051.11,1050.68,1047.03,1048.12,1048.34,1048.44,1047.67,1048.27,1066.18,1066.55,1066.62,1065.96,1067.05,1066.6,1067.02,1067.03],"concurrentRawBatchMs":[1109.87,1052.97,1068.36],"memoryCheckpoints":[{"stage":"beforeFixture","rss":67190784,"heapTotal":19464192,"heapUsed":12596112,"external":2743584,"arrayBuffers":176787,"maxRSSKiB":65628},{"stage":"afterFixture","rss":94863360,"heapTotal":32247808,"heapUsed":17380448,"external":11567351,"arrayBuffers":9000514,"maxRSSKiB":96188},{"stage":"afterIndex","rss":483450880,"heapTotal":336850944,"heapUsed":202081816,"external":61180113,"arrayBuffers":57182650,"maxRSSKiB":572172},{"stage":"afterColdDetail","rss":1010659328,"heapTotal":787001344,"heapUsed":689108256,"external":76508911,"arrayBuffers":72517155,"maxRSSKiB":1070052},{"stage":"afterDistinctDetails","rss":1137168384,"heapTotal":440578048,"heapUsed":331900792,"external":120603922,"arrayBuffers":116612166,"maxRSSKiB":1144692},{"stage":"afterRepeatedDetails","rss":1095610368,"heapTotal":439267328,"heapUsed":331820688,"external":120931390,"arrayBuffers":116939634,"maxRSSKiB":1144692},{"stage":"afterSingleRaw","rss":1015951360,"heapTotal":379203584,"heapUsed":194214656,"external":99420388,"arrayBuffers":95428632,"maxRSSKiB":1144692},{"stage":"afterConcurrentRawBatch1","rss":1067896832,"heapTotal":361115648,"heapUsed":194565064,"external":96218233,"arrayBuffers":92226477,"maxRSSKiB":1183456},{"stage":"afterConcurrentRawBatch2","rss":1082376192,"heapTotal":361639936,"heapUsed":194978760,"external":108015345,"arrayBuffers":104023589,"maxRSSKiB":1183456},{"stage":"afterConcurrentRawBatch3","rss":1068068864,"heapTotal":360591360,"heapUsed":194646008,"external":97594561,"arrayBuffers":93602805,"maxRSSKiB":1186836}],"maxRSSKiB":1186836}]
```

Quiet-repeat samples (2026-09-08 12:28:26 UTC) / 暂停仓库验收后的复测样本：

```json
[{"dataRows":50000,"compression":"plain","distinctDetailMs":[247.53,274.43,248.28,258.95,257.71,240.75,265.44,234.69,265.72,242.41,271.72,251.72],"repeatedDetailMs":[255.72,218.02,247.18,228.89,261.93,220.07],"concurrentRawRequestMs":[290.33,290.74,287.98,317.93,287.27,288.95,288.5,287.73,333.17,332.45,333.21,333.34,331.44,367.3,333.29,332.47,394.44,353.99,295.69,295.1,295.79,392.99,353.16,392.07],"concurrentRawBatchMs":[320.19,368.1,394.47],"memoryCheckpoints":[{"stage":"beforeFixture","rss":64499712,"heapTotal":19464192,"heapUsed":12596216,"external":2743584,"arrayBuffers":176787,"maxRSSKiB":63000},{"stage":"afterFixture","rss":86183936,"heapTotal":33116160,"heapUsed":21793464,"external":4418212,"arrayBuffers":1851375,"maxRSSKiB":86420},{"stage":"afterIndex","rss":483356672,"heapTotal":351318016,"heapUsed":197023200,"external":55350114,"arrayBuffers":51352651,"maxRSSKiB":556716},{"stage":"afterColdDetail","rss":758255616,"heapTotal":437952512,"heapUsed":221151648,"external":81728549,"arrayBuffers":51275311,"maxRSSKiB":901208},{"stage":"afterDistinctDetails","rss":749494272,"heapTotal":317571072,"heapUsed":189106184,"external":108189585,"arrayBuffers":77742054,"maxRSSKiB":901208},{"stage":"afterRepeatedDetails","rss":749502464,"heapTotal":322289664,"heapUsed":188979496,"external":108189433,"arrayBuffers":77741902,"maxRSSKiB":901208},{"stage":"afterSingleRaw","rss":803860480,"heapTotal":323559424,"heapUsed":192445552,"external":161113690,"arrayBuffers":104210384,"maxRSSKiB":901208},{"stage":"afterConcurrentRawBatch1","rss":1017622528,"heapTotal":313122816,"heapUsed":157750560,"external":372742818,"arrayBuffers":210016412,"maxRSSKiB":1017240},{"stage":"afterConcurrentRawBatch2","rss":1017634816,"heapTotal":313122816,"heapUsed":157780584,"external":372743442,"arrayBuffers":210017036,"maxRSSKiB":1172796},{"stage":"afterConcurrentRawBatch3","rss":1017634816,"heapTotal":312074240,"heapUsed":157699448,"external":372742818,"arrayBuffers":210016412,"maxRSSKiB":1179844}],"maxRSSKiB":1179844},{"dataRows":50000,"compression":"zstd","distinctDetailMs":[220.86,263.75,239.2,264.4,218.85,248.3,253.67,243.5,223.89,237.4,222.27,297.65],"repeatedDetailMs":[206.47,260.39,207.94,243.52,229.28,291.82],"concurrentRawRequestMs":[740.51,740.76,738.28,738.78,739.48,739.17,738.63,738.62,560.21,560.29,560.59,744.54,744.07,743.95,744.08,744.12,710.26,710.4,710.69,710.44,710.88,711.14,710.92,710.52],"concurrentRawBatchMs":[741.68,746.1,711.71],"memoryCheckpoints":[{"stage":"beforeFixture","rss":64540672,"heapTotal":19464192,"heapUsed":12596456,"external":2743584,"arrayBuffers":176787,"maxRSSKiB":63040},{"stage":"afterFixture","rss":89128960,"heapTotal":31133696,"heapUsed":13597904,"external":10656957,"arrayBuffers":8090120,"maxRSSKiB":94216},{"stage":"afterIndex","rss":477077504,"heapTotal":339566592,"heapUsed":179409880,"external":55411592,"arrayBuffers":51414129,"maxRSSKiB":518768},{"stage":"afterColdDetail","rss":624406528,"heapTotal":421703680,"heapUsed":265402632,"external":76511925,"arrayBuffers":72517153,"maxRSSKiB":689520},{"stage":"afterDistinctDetails","rss":705576960,"heapTotal":378687488,"heapUsed":281636376,"external":120669478,"arrayBuffers":116677722,"maxRSSKiB":740596},{"stage":"afterRepeatedDetails","rss":711766016,"heapTotal":378949632,"heapUsed":281720216,"external":120276010,"arrayBuffers":116284254,"maxRSSKiB":740596},{"stage":"afterSingleRaw","rss":694222848,"heapTotal":364785664,"heapUsed":194134400,"external":99551466,"arrayBuffers":95559710,"maxRSSKiB":740596},{"stage":"afterConcurrentRawBatch1","rss":742866944,"heapTotal":404406272,"heapUsed":251590048,"external":157219443,"arrayBuffers":153227687,"maxRSSKiB":810752},{"stage":"afterConcurrentRawBatch2","rss":685588480,"heapTotal":348532736,"heapUsed":194560368,"external":97262946,"arrayBuffers":93271190,"maxRSSKiB":838516},{"stage":"afterConcurrentRawBatch3","rss":691957760,"heapTotal":348270592,"heapUsed":194717888,"external":97856711,"arrayBuffers":93864955,"maxRSSKiB":838516}],"maxRSSKiB":838516}]
```

## Cold first-materialization / first-read attribution / 冷态首次物化／首次阅读归因

### Scope, identity and environment / 范围、身份与环境

This separate investigation addresses debt #22. Base `origin/main` was fetched and verified at `cc55ffde4cc253e2a5d7904e9cc45e66bec1d20c`; there were no intervening commits. Executable measurement inputs were committed at `a87b75c6641c76e8339de356dfd693c96545e1f2` on `perf/deepseek-cold-materialization-attribution`. Later report edits do not change the measured implementation. / 本节单独调查债务 #22。已 fetch 并确认基线 `origin/main` 为 `cc55ffde4cc253e2a5d7904e9cc45e66bec1d20c`，无中间提交。可执行量测输入已提交于分支 `perf/deepseek-cold-materialization-attribution` 的 `a87b75c6641c76e8339de356dfd693c96545e1f2`；后续报告编辑不改变被量测实现。

Environment: Node `v24.18.1`, npm `12.0.2`, Windows `10.0.22631`, `win32/x64`, AMD Ryzen 5 5600U with Radeon Graphics, 12 logical CPUs, 14,864,674,816 bytes RAM. Formal cases and repeats run sequentially with repository Node/browser validation paused. This is still a shared workstation, not a dedicated benchmark host. / 环境：Node `v24.18.1`、npm `12.0.2`、Windows `10.0.22631`、`win32/x64`、AMD Ryzen 5 5600U with Radeon Graphics、12 逻辑 CPU、14,864,674,816 bytes 内存。正式场景与复测顺序运行，暂停仓库 Node／浏览器验收；这仍是共享工作站，不是专用基准主机。

Cold means no cached Materialized Session. Generation and indexing already touch the source; no filesystem/OS-cache coldness is claimed, no caches are flushed, and GC is not forced. All numbers are observations, not an SLA, latency gate, or real-corpus generalization. / 冷态指没有已缓存 Materialized Session。生成与索引已接触来源；不声称文件系统／OS 缓存冷态，不清缓存，不强制 GC。全部数值仅为观测，不是 SLA、时延门槛或真实语料泛化结论。

### Shapes and method / 形状与方法

Both shapes have an ordinary format-v0 header plus N data records, sequential `seq`, deterministic timestamps, and no executed external commands. Tool-dense retains the original paired `tool/call` and `tool/result`: N+1 physical/Raw records, N/2 Logical tool events, two Raw References per Logical event. Message-dense alternates append `user/message` (user source, short question) and append `assistant/message` (512 deterministic hex answer characters, the same generated payload as tool results): N+1 physical/Raw records, N Logical messages, one Raw Reference each. There are no reasoning blocks, tool-call blocks, or turn/step lifecycle records in the second shape. / 两种形状均为普通 format-v0 header 加 N 条数据记录，使用连续 `seq`、确定性时间戳，且不执行外部命令。工具密集形状保留原始配对 `tool/call` 与 `tool/result`：N+1 条物理／Raw 记录、N/2 个 Logical 工具事件，每个 Logical 有两个 Raw Reference。消息密集形状交替使用 append `user/message`（user 来源、短问题）及 append `assistant/message`（512 个确定性十六进制回答字符，与工具结果使用相同生成 payload）：N+1 条物理／Raw 记录、N 个 Logical 消息，每个仅一个 Raw Reference。第二种形状不含 reasoning block、tool-call block 或 turn／step lifecycle 记录。

The first target is `logical:tool:profile-call-0` or `logical:user_message:0`, prefixed by the synthetic Session ID. No Timeline/Analysis request precedes it. Plain/Zstd is independent of shape: Zstd uses a separate header frame and up to 256 data records per subsequent frame. Serialized sizes differ because message and tool wrappers differ; equal record counts are not byte-normalized comparisons. / 首个目标为合成 Session ID 前缀加 `logical:tool:profile-call-0` 或 `logical:user_message:0`；之前不请求 Timeline／Analysis。Plain／Zstd 独立于形状：Zstd header 单独成帧，后续每帧最多 256 条数据记录。消息与工具包装不同，序列化大小不同，因此相同记录数不代表按字节归一化比较。

The original real HTTP flow is preserved: isolated worker, real `createServer`, prewarm disabled, POST project and await index, assert zero materializations, time first Detail through HTTP including client JSON parsing, assert exactly one materialization, then perform all original warm Detail/Raw reads and recheck identity. The injected `materializeSession` wrapper forwards the original options plus `onMaterializationPhase`. The injected `buildEventDetail` wrapper calls the real builder with unchanged arguments in that same request. Both collectors are enabled only during the first Detail. / 保留原始真实 HTTP 流程：独立 worker、真实 `createServer`、禁用 prewarm、POST project 并等待索引、断言零次物化、通过 HTTP 量测首次 Detail（包含客户端 JSON 解析）、断言恰好一次物化，再执行原有全部热态 Detail／Raw 阅读并复核身份。注入的 `materializeSession` wrapper 透传原有 options 并增加 `onMaterializationPhase`；注入的 `buildEventDetail` wrapper 在同一请求中以原参数调用真实 builder。两种收集器仅在首次 Detail 期间启用。

### Phase hierarchy and accounting / 阶段层级与核算

```text
coldDetailMs (client HTTP wall time)
  materializationMs (materializeSessionForIndex wrapper)
    materialized_pre_adapter_validation
    adapter_materialization
      deepseek_materialization_source_read
      deepseek_materialization_reconstruction
    materialized_post_adapter_ownership
    materialized_canonical_validation
    materialized_private_validation
      materialized_private_fingerprint_capture
      materialized_private_callback
      materialized_private_fingerprint_recheck
    materialized_fingerprint_reuse
    materialized_projection
    materialized_fingerprint_recheck
    materialized_final_admission_check
    materializationResidualMs
  detailConstructionMs (real buildEventDetailForSession wrapper)
  httpOuterResidualMs
```

Source-read covers `readCommittedArtifactPrefix`: stable source read, accepted identity/length/digest validation, committed prefix recovery, and committed Zstd frame handling/decompression. Reconstruction starts after that return and covers header/physical-record parsing, prefix digest, Raw/Logical event assembly, analysis, presentation indexes and finalization. Adapter residual contains adapter setup, returned-Session identity/count checks and carried-state assembly around the parser. / 来源读取覆盖 `readCommittedArtifactPrefix`：稳定来源读取、accepted identity／length／digest 校验、已提交前缀恢复及 Zstd 已提交帧处理／解压。重建在该函数返回后开始，覆盖 header／物理记录解析、前缀 digest、Raw／Logical 事件组装、analysis、presentation index 和 finalization。Adapter residual 包括 parser 周边的 adapter 准备、返回 Session 身份／数量检查及 carried-state 组装。

Formulas use unrounded durations: `httpOuterResidualMs = coldDetailMs - materializationMs - detailConstructionMs`; `materializationResidualMs = materializationMs - sum(nine top-level phases)`; adapter residual = adapter parent minus its two DeepSeek children. The HTTP residual includes unmeasured route/cache-owner work, JSON serialization/writing, loopback transport, response reading and client parsing; it is not “network latency.” Private validation includes its children. Never add a parent and its children into the same total. The separately discussed fingerprint total is **private capture + private recheck + top-level fingerprint recheck**, excluding the private parent. / 公式使用未舍入数值：`httpOuterResidualMs = coldDetailMs - materializationMs - detailConstructionMs`；`materializationResidualMs = materializationMs - 九个顶层阶段之和`；adapter residual 为 adapter 父阶段减去两个 DeepSeek 子阶段。HTTP residual 包含未量测 route／cache owner 工作、JSON 序列化／写出、环回传输、响应读取及客户端解析，不是“网络时延”。Private validation 包含其子阶段，不得将父子同时加入总和。下文单独讨论的 fingerprint 总量为 **private capture + private recheck + 顶层 fingerprint recheck**，不含 private 父阶段。

The content-free collector timestamps start/end events with `performance.now()`, balances a stack, aggregates repeated names within their parent, and retains duration-only metadata separately without assuming interval placement or adding it to coverage. It reports malformed events after the request rather than throwing into admission. Checks require finite nonnegative times, monotonic timestamps, balanced nesting, sibling nonoverlap, parent containment, and exactly one occurrence of every expected major phase in order. HTTP subtraction allows only 1e-7 ms floating-point tolerance. `coldAttribution()` reports the full residual without applying a quantitative coverage threshold; the serial coverage command enforces an absolute 5 ms limit on the minimum residual from three fresh-process 100-row `tool-dense/plain` samples. This is an accounting coverage check rather than a latency target. Full unrounded residuals remain in JSON. / 不含内容的收集器使用 `performance.now()` 给 start／end 打时间戳，以栈核验平衡、在父阶段内聚合同名重复调用，并单独保留 duration-only 元数据，不推断其区间或计入覆盖量。异常事件在请求后报告，不向准入流程抛错。检查要求时间有限且非负、时间戳单调、嵌套平衡、兄弟不重叠、子阶段不越界、预期主要阶段按序各出现一次。HTTP 相减仅允许 1e-7 ms 浮点容差。`coldAttribution()` 返回完整 residual，不施加定量覆盖门槛；顺序覆盖命令对三个独立进程的 100 行 `tool-dense/plain` 样本的最小 residual 施加绝对 5 ms 上限。这是核算覆盖检查，不是时延目标。JSON 保留完整未舍入 residual。

The existing observer is inert without a scope and swallows callback failures. A small private reconstruction extraction permits one scoped boundary without changing parser branches. `createServer({ buildEventDetail })` is a test/profile-only dependency injection with the normal builder as default: no CLI/API field, log, diagnostic, DTO, lifecycle/admission, cancellation or browser contract changes. After inspecting `indexed-materialized-session-lifecycle.md`, no generic profiling architecture or lifecycle contract update is needed. / 既有 observer 无作用域时直接执行原操作，回调失败被吞掉。小型私有 reconstruction 提取仅用于放置一个作用域边界，不修改 parser 分支。`createServer({ buildEventDetail })` 仅为测试／量测依赖注入，默认仍为普通 builder；不增加 CLI／API 字段、日志、诊断或 DTO，不改变生命周期／准入、取消或浏览器契约。审阅 `indexed-materialized-session-lifecycle.md` 后确认，无需修改通用 profiling 架构或生命周期契约。

### Matrix results / 矩阵结果

Completed (UTC): smoke 2026-09-11T02:29:45.234Z; formal 2026-09-11T02:32:57.965Z; repeats 2026-09-11T02:36:21.758Z, 2026-09-11T02:39:02.130Z. The initial smoke, formal and repeat reports identify implementation SHA `a87b75c6641c76e8339de356dfd693c96545e1f2`. / 完成时间（UTC）：smoke 2026-09-11T02:29:45.234Z；正式 2026-09-11T02:32:57.965Z；复测 2026-09-11T02:36:21.758Z、2026-09-11T02:39:02.130Z。初始 smoke、正式及复测报告标识实现 SHA `a87b75c6641c76e8339de356dfd693c96545e1f2`。

Reproduction commands, sequentially after validation / 验收后顺序执行的复现命令：

```powershell
node scripts/deepseek-readback-profile.js --sizes=100 --compression=plain,zstd
node scripts/deepseek-readback-profile.js --sizes=10000,50000 --compression=plain,zstd
# Run twice more / 再执行两次
node scripts/deepseek-readback-profile.js --sizes=50000 --compression=plain,zstd
```

T = tool-dense, M = message-dense; N excludes the header. All timings below are ms, rounded only for display; independent rounding can move sums by 0.01 ms. / T 为工具密集、M 为消息密集；N 不含 header。下列时延单位均为 ms，仅展示时舍入；独立舍入可能使相加相差 0.01 ms。

**Smoke / 冒烟**: four successful cases, zero materializations before first Detail and exactly one afterward; all hierarchy, count, nonempty Detail, Raw type and unchanged-source checks passed. / 四组均成功；首次 Detail 前为零次物化，之后恰好一次；全部层级、数量、非空 Detail、Raw 类型及来源未变检查通过。

| N / shape / encoding | Raw / Logical | Cold HTTP | Materialization / 物化 | Detail | Outer residual / 外层余量 |
| --- | --- | --- | --- | --- | --- |
| 100 / T / plain | 101 / 50 | 96.38 | 74.75 | 4.62 | 17.01 |
| 100 / T / zstd | 101 / 50 | 87.57 | 70.27 | 4.15 | 13.14 |
| 100 / M / plain | 101 / 100 | 143.43 | 117.49 | 9.79 | 16.15 |
| 100 / M / zstd | 101 / 100 | 123.47 | 112.62 | 6.99 | 3.86 |

**Formal fixture sizes / 正式 fixture 大小**. Physical count equals Raw count. Byte totals are actual generated bytes, including the synthetic header path; the temporary directory suffix is fixed length on this host. / 物理数量等于 Raw 数量。字节数为实际生成值，包含合成 header path；本机临时目录后缀长度固定。

| N / shape / encoding | Physical = Raw / 物理 = Raw | Logical | Uncompressed bytes / 未压缩字节 | Artifact bytes / 工件字节 | Zstd frames / 帧 |
| --- | --- | --- | --- | --- | --- |
| 10000 / T / plain | 10001 | 5000 | 5250773 | 5250773 | 0 |
| 10000 / T / zstd | 10001 | 5000 | 5250773 | 1652638 | 41 |
| 10000 / M / plain | 10001 | 10000 | 4464658 | 4464658 | 0 |
| 10000 / M / zstd | 10001 | 10000 | 4464658 | 1441877 | 41 |
| 50000 / T / plain | 50001 | 25000 | 26455775 | 26455775 | 0 |
| 50000 / T / zstd | 50001 | 25000 | 26455775 | 8264064 | 197 |
| 50000 / M / plain | 50001 | 50000 | 22444660 | 22444660 | 0 |
| 50000 / M / zstd | 50001 | 50000 | 22444660 | 7206917 | 197 |

**Cold user path / 冷态用户路径**. Full original warm-read samples and memory checkpoints remain in the local aggregate JSON, not in these cold totals. maxRSS is worker-lifetime MiB. / 原有完整热态阅读样本与内存检查点保留于本地聚合 JSON，不计入下表冷态总量；maxRSS 为 worker 生命周期 MiB。

| N / shape / encoding | Cold HTTP | Materialization / 物化 | Detail | Outer residual / 外层余量 | maxRSS MiB |
| --- | --- | --- | --- | --- | --- |
| 10000 / T / plain | 4977.75 | 4929.97 | 36.01 | 11.77 | 433.57 |
| 10000 / T / zstd | 5489.53 | 5439.39 | 46.71 | 3.43 | 497.29 |
| 10000 / M / plain | 6419.24 | 6366.81 | 32.78 | 19.65 | 407.54 |
| 10000 / M / zstd | 6549.83 | 6502.85 | 43.68 | 3.31 | 581.87 |
| 50000 / T / plain | 26558.63 | 26326.18 | 210.06 | 22.39 | 973.46 |
| 50000 / T / zstd | 27023.40 | 26749.84 | 256.74 | 16.82 | 796.25 |
| 50000 / M / plain | 34693.72 | 34543.65 | 143.10 | 6.97 | 1137.85 |
| 50000 / M / zstd | 33977.74 | 33775.57 | 198.27 | 3.90 | 787.73 |

**Nonoverlapping top-level materialization phases / 不重叠的物化顶层阶段**. Columns abbreviate the exact names in the hierarchy: pre = pre-adapter validation, owner = post-adapter ownership, canonical/private = respective validation, reuse/recheck = fingerprint reuse/recheck, query = projection, final = final admission check. / 列名为上方精确阶段名的缩写：pre 为 adapter 前校验、owner 为 adapter 后 ownership、canonical／private 为相应校验、reuse／recheck 为 fingerprint 复用／复核、query 为投影、final 为最终准入检查。

| N / shape / encoding | pre | adapter | owner | canonical | private | reuse | query | recheck | final | residual |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10000 / T / plain | 1.23 | 178.18 | 0.44 | 33.73 | 3085.51 | 0.01 | 101.24 | 1528.85 | 0.01 | 0.77 |
| 10000 / T / zstd | 1.16 | 192.52 | 0.46 | 46.61 | 3542.91 | 0.00 | 106.03 | 1549.00 | 0.01 | 0.68 |
| 10000 / M / plain | 1.23 | 186.91 | 0.49 | 42.45 | 4013.59 | 0.00 | 129.76 | 1991.66 | 0.01 | 0.71 |
| 10000 / M / zstd | 2.00 | 192.22 | 0.72 | 36.29 | 4148.14 | 0.01 | 135.04 | 1987.51 | 0.01 | 0.90 |
| 50000 / T / plain | 1.44 | 916.93 | 0.55 | 158.48 | 16179.77 | 0.00 | 512.27 | 8555.63 | 0.01 | 1.09 |
| 50000 / T / zstd | 1.16 | 931.73 | 0.53 | 157.71 | 16806.81 | 0.01 | 524.82 | 8326.38 | 0.01 | 0.68 |
| 50000 / M / plain | 1.10 | 826.68 | 0.50 | 172.39 | 22318.24 | 0.01 | 835.40 | 10388.69 | 0.01 | 0.64 |
| 50000 / M / zstd | 1.11 | 859.18 | 0.90 | 184.30 | 21345.08 | 0.00 | 686.64 | 10697.71 | 0.01 | 0.64 |

**Nested adapter and private-validation phases / 嵌套 adapter 与 private-validation 阶段**. These are already inside their parents above, not additional costs. / 这些时间已包含于上表父阶段中，不是额外成本。

| N / shape / encoding | Source read/decode / 来源读取解码 | Reconstruction / 重建 | Adapter residual | Private capture | Private callback | Private recheck | Fingerprint total / 总量 | % of materialization / 占物化 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10000 / T / plain | 7.70 | 170.06 | 0.43 | 1563.98 | 0.13 | 1521.08 | 4613.91 | 93.59 |
| 10000 / T / zstd | 17.31 | 174.77 | 0.44 | 1987.26 | 0.15 | 1555.27 | 5091.53 | 93.60 |
| 10000 / M / plain | 7.14 | 179.31 | 0.46 | 2038.90 | 0.13 | 1974.27 | 6004.83 | 94.31 |
| 10000 / M / zstd | 13.62 | 178.14 | 0.47 | 2159.63 | 0.12 | 1988.16 | 6135.30 | 94.35 |
| 50000 / T / plain | 38.68 | 877.76 | 0.49 | 8106.42 | 0.12 | 8073.01 | 24735.07 | 93.96 |
| 50000 / T / zstd | 98.87 | 832.33 | 0.53 | 8241.09 | 0.12 | 8565.39 | 25132.86 | 93.96 |
| 50000 / M / plain | 33.13 | 793.13 | 0.42 | 11658.20 | 0.18 | 10659.63 | 32706.52 | 94.68 |
| 50000 / M / zstd | 67.24 | 791.51 | 0.43 | 10501.10 | 0.15 | 10843.60 | 32042.42 | 94.87 |

**Two additional quiet 50k repetitions / 两次额外安静 50k 复测**. Each is a fresh worker and a fresh cold first Detail; no warm cache is carried between runs. / 每组使用新 worker 与新的冷态首次 Detail，轮次间不携带热缓存。

| Repeat / 复测 | N / shape / encoding | Cold HTTP | Materialization / 物化 | Detail | Outer residual | Fingerprint total | % of materialization |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 50000 / T / plain | 26114.61 | 25838.37 | 259.45 | 16.79 | 24370.91 | 94.32 |
| 1 | 50000 / T / zstd | 27282.71 | 27016.96 | 247.69 | 18.07 | 25417.09 | 94.08 |
| 1 | 50000 / M / plain | 33337.48 | 33188.32 | 143.40 | 5.76 | 31371.99 | 94.53 |
| 1 | 50000 / M / zstd | 33181.81 | 32973.53 | 204.53 | 3.75 | 31179.48 | 94.56 |
| 2 | 50000 / T / plain | 26649.99 | 26448.05 | 185.37 | 16.56 | 24943.28 | 94.31 |
| 2 | 50000 / T / zstd | 26670.20 | 26415.86 | 237.62 | 16.73 | 24766.76 | 93.76 |
| 2 | 50000 / M / plain | 34413.89 | 34239.17 | 169.34 | 5.38 | 32465.72 | 94.82 |
| 2 | 50000 / M / zstd | 34157.50 | 33959.99 | 191.76 | 5.75 | 32172.48 | 94.74 |

**50k cold HTTP, three observations per cell / 每格三次 50k 冷 HTTP 观测**. Median and range are descriptive, not confidence intervals. / 中位与范围仅作描述，不是置信区间。

| Shape / encoding | Cold HTTP median [min, max] / 中位 [最小, 最大] | Fingerprint % range / fingerprint 占比范围 |
| --- | --- | --- |
| tool-dense / plain | 26558.63 [26114.61, 26649.99] | 93.96–94.32 |
| tool-dense / zstd | 27023.40 [26670.20, 27282.71] | 93.76–94.08 |
| message-dense / plain | 34413.89 [33337.48, 34693.72] | 94.53–94.82 |
| message-dense / zstd | 33977.74 [33181.81, 34157.50] | 94.56–94.87 |

All 16 formal/repeat cases passed the one-materialization, Raw/Logical count, Detail/Raw response, phase-accounting and unchanged source identity checks. Materialization residual range: 0.60–1.09 ms. No duration-only events were emitted by these DeepSeek cases. / 全部 16 组正式／复测通过一次物化、Raw／Logical 数量、Detail／Raw 响应、阶段核算及来源身份未变检查。物化 residual 范围为 0.60–1.09 ms。这些 DeepSeek 场景未发出 duration-only 事件。

### Interpretation and next decision / 解读与下一步决策

The delay is predominantly **source-neutral fingerprint guarding**, not DeepSeek reconstruction or first Detail readback. In the formal matrix, the three nonoverlapping fingerprint spans consume 93.59–94.87% of materialization. Private validation's own callback is tiny; its parent is large because it encloses capture and recheck. Canonical validation and query projection remain separately visible and much smaller. / 延迟主要来自 **来源中立的 fingerprint guarding**，不是 DeepSeek 重建或首次 Detail 回读。正式矩阵中，三个不重叠 fingerprint 阶段占物化的 93.59–94.87%。Private validation 自身 callback 很小；父阶段很大是因为它包含 capture 与 recheck。Canonical validation 与 query projection 仍单独可见，且小得多。

Scaling supports that attribution across both shapes. Increasing data records from 10k to 50k increases uncompressed bytes by about 5.03–5.04×; materialization grows 4.92–5.43× and the fingerprint total 4.94–5.45× across the four shape/encoding combinations. At 50k, messages have twice as many Logical events (50k versus 25k), the same Raw count (50,001), and about 15.2% fewer uncompressed serialized bytes, yet materialize about 26–31% slower in the formal run. This is consistent with sensitivity to canonical object-graph/event shape rather than storage bytes alone; it does not establish a per-event coefficient or isolate object count from graph topology/text. / 两种形状的规模变化支持该归因。数据记录由 10k 增至 50k，未压缩字节约增至 5.03–5.04 倍；四种形状／编码组合中，物化增至 4.92–5.43 倍，fingerprint 总量增至 4.94–5.45 倍。在 50k 下，消息形状 Logical 事件为两倍（50k 对 25k）、Raw 数相同（50,001），未压缩序列化字节却少约 15.2%，正式轮次的物化仍慢约 26–31%。这与 canonical 对象图／事件形状敏感性一致，不能仅由存储字节解释；但尚未建立逐事件系数，也未隔离对象数、图结构及文本的影响。

Compression affects accepted read/decode (50k plain about 33–39 ms versus Zstd 67–99 ms in the formal run), but that is small beside tens of seconds of shared guarding. Reconstruction is about 0.79–0.88 s; first Detail construction is 0.14–0.26 s. The small outer residual does not justify a new broad HTTP profiler. Plain/Zstd cold totals vary by run and shape, so there is no supported universal compression speed ranking. / 压缩影响 accepted read／decode（正式轮次 50k plain 约 33–39 ms，Zstd 约 67–99 ms），但与共享 guarding 的数十秒相比很小。重建约 0.79–0.88 秒，首次 Detail 构建约 0.14–0.26 秒。外层余量很小，不支持因此增加通用 HTTP profiler。Plain／Zstd 的冷态总时间随轮次与形状变化，不能得出通用压缩速度排序。

**Recommended next increment:** target the shared `graphFingerprintAsync` capture/recheck implementation, keeping all three current passes and their mutation/error/cancellation boundaries. First distinguish graph traversal and token/byte hashing from cooperative-yield wait within that targeted work, then evaluate an equivalent lower-cost traversal/encoding implementation with the same real HTTP matrix plus source-neutral conformance tests. The present evidence selects this boundary; it does not prove that any particular batching, hashing or scheduling technique will help. Removing validation, widening caches or treating the issue as DeepSeek-only is not supported by this increment. / **建议下一增量：** 针对共享 `graphFingerprintAsync` capture／recheck 实现，保留当前三次遍历及其 mutation／error／cancellation 边界。先在该聚焦工作中区分图遍历、token／字节哈希与协作 yield 等待，再以同一真实 HTTP 矩阵和来源中立 conformance 测试评估等价低成本遍历／编码实现。本次证据选定该边界，但不能证明某种 batching、hashing 或 scheduling 技术必然有效。本增量不支持删校验、扩大缓存或将问题视为 DeepSeek 专属。

Debt #22 remains **profiled; optimization decision pending**, not closed. Item #20's bounded/sequential Detail/Raw reader remains a separate warm-read concern: the measured first Detail cost is material but does not explain the 26–35 second cold path. No changes to item #20's implementation or scope are included. / 债务 #22 保持 **已归因；优化决策待定**，不关闭。第 #20 项的有界／顺序 Detail／Raw reader 仍为独立热态阅读问题：首次 Detail 成本可观，但不能解释 26–35 秒冷路径。本次不修改 #20 的实现或范围。

No parser, reconstruction, fingerprint, query projection, selective read/decode, cache, heap, worker, browser or admission optimization was implemented. Latency spans are wall times, including scheduler/GC/yield effects; they are not CPU samples. The fixtures omit packed rows, reasoning, forks, compaction and other real-session complexities, and no synthetic result is generalized to all DeepSeek Sessions or all sources. / 本次未优化 parser、重建、fingerprint、查询投影、选择性读取／解码、缓存、heap、worker、浏览器或准入。阶段时间为墙钟时间，包含调度／GC／yield 影响，不是 CPU 采样。Fixture 不含 packed row、reasoning、fork、compaction 等真实会话复杂性，不将合成结果推广到全部 DeepSeek Session 或全部来源。

### Validation and retained evidence / 验证与保留证据

The final diagnostic follow-up adds exact requested Detail/Raw ID assertions after each timed request, four tiny real-HTTP worker tests, report `repositoryDirty`/`trackedDiffSha256` metadata, and formatting fixes. It does not move any timer or change any measured production operation. The formal/repeated results above remain attributed to the captured implementation SHA, not retrospectively to a later commit. / 最终诊断补强在每次计时请求结束后增加请求 Detail／Raw ID 的精确断言、四个小型真实 HTTP worker 测试、报告 `repositoryDirty`／`trackedDiffSha256` 元数据及格式修正。不移动任何计时边界，不修改任何被量测生产操作。上方正式／复测结果仍归属于捕获实现 SHA，不追溯标记为后续提交。

The new tests cover observed/unobserved result equality, throwing observers on success and accepted-snapshot/parser rejection, content-free phase fields, the default and wrapped Detail builder, HTTP errors/disconnect cancellation, nested/repeated/broken phase sequences, parent containment, coverage/residual accounting, both fixture shapes and the tiny real HTTP flow. Existing server/index-revision, adapter conformance/contract, DeepSeek/stable-read and observer suites are also exercised. / 新测试覆盖有／无 observer 结果相等、回调抛错时成功及 accepted-snapshot／parser 拒绝语义、阶段字段不含内容、默认／包装 Detail builder、HTTP 错误／断连取消、嵌套／重复／破损阶段序列、父阶段包含关系、覆盖／余量核算、两种 fixture 及小型真实 HTTP 流程。另执行既有 server／index-revision、adapter conformance／contract、DeepSeek／stable-read 与 observer 套件。

The first full-suite attempt passed 1,093/1,094 tests; its sole failure was the fresh worktree's missing local `node_modules/highlight.js/LICENSE`. Installing locked dependencies with npm 12.0.2 and strict allow-scripts resolved it (no pending scripts); the complete suite then passed. No test was weakened or skipped. / 首次完整测试通过 1,093／1,094；唯一失败为新 worktree 缺少本地 `node_modules/highlight.js/LICENSE`。使用 npm 12.0.2 与 strict allow-scripts 安装锁定依赖后解决（无待执行脚本），完整套件随后通过；未削弱或跳过测试。

Aggregate JSON is retained locally under ignored `tmp/cold-attribution/`: `smoke.json`, `formal.json`, `repeat-1.json`, `repeat-2.json`, plus final follow-up smoke and validation logs. Generated Session artifacts are removed by each worker, and no giant fixture or transient profile JSON is committed. Tables above preserve the compact durable evidence; rerunning emits the full machine-readable report. / 聚合 JSON 本地保留于 ignored `tmp/cold-attribution/`：`smoke.json`、`formal.json`、`repeat-1.json`、`repeat-2.json`，以及最终补强 smoke 与验收日志。每个 worker 删除所生成 Session 工件，不提交大型 fixture 或临时 profile JSON。上表保存紧凑持久证据；复跑输出完整机器可读报告。

Final follow-up smoke at `bf7922332c239bfc503b8724c863d1d0dbd11710` passed all four cells (cold HTTP ms: tool-dense/plain 93.77; tool-dense/zstd 82.53; message-dense/plain 111.57; message-dense/zstd 110.25). The report correctly marks the pending documentation edits as `repositoryDirty: true`; tracked diff SHA-256 `3244a14d5fb7e7648eda8a1921e668e77666e46b86041376227a2bae12eec69c`. Final `npm run build:check` passed, `npm test` passed **1,098/1,098**, and `git diff --check` passed. The 77-test focused implementation pass and 11-test final profiler pass also passed. Local browser validation was not run because no browser behavior changed; normal PR CI remains responsible for its Browser job. / 最终补强 smoke 在 `bf7922332c239bfc503b8724c863d1d0dbd11710` 上四组全部通过（冷 HTTP ms：tool-dense/plain 93.77；tool-dense/zstd 82.53；message-dense/plain 111.57；message-dense/zstd 110.25）。报告正确将待提交文档编辑标记为 `repositoryDirty: true`；tracked diff SHA-256 为 `3244a14d5fb7e7648eda8a1921e668e77666e46b86041376227a2bae12eec69c`。最终 `npm run build:check` 通过，`npm test` **1,098／1,098** 通过，`git diff --check` 通过；77 项实现聚焦测试及最终 11 项 profiler 测试亦通过。因浏览器行为未改变，未运行本地浏览器验收；标准 PR CI 仍负责 Browser job。

## Fingerprint internal attribution / Fingerprint 内部归因

This is second-level attribution of the source-neutral hotspot identified by PR #54, not a replacement for its first-level timings above. DeepSeek synthetic large Sessions expose shared materialization validation; their absolute latency is not generalized to Codex or Claude. No optimization is implemented. / 这是 PR #54 所识别来源中立热点的第二层归因，不替换上方第一层时延数据。DeepSeek 合成大会话暴露的是共享物化校验；绝不将其绝对时延推广到 Codex 或 Claude。本次未实现优化。

### Implementation and method / 实现与方法

Formal implementation: `73a619146ac275da7ead3395f1e670c52364385e`, clean tree, based on fetched main `400aa81e7a74ed14e5f02ceb966d148e91627916`. All captures use the same committed source. The profile script accepts internal `--fingerprint-profile=on|off` (default off); this is not a product CLI/API option. It extends the existing aggregate JSON with full, unrounded per-invocation statistics and totals when enabled, and preserves the existing output shape when disabled. / 正式实现为上述 clean-tree SHA，基于已 fetch 的 main；全部采集使用同一已提交源码。Profile 脚本接收内部开关（默认 off），不是产品 CLI／API 选项。开启时在既有聚合 JSON 追加未舍入的逐调用统计及总量，关闭时保留原有输出结构。

Every worker preserves PR #54's exact real-loopback HTTP cold request through completed first Detail, then executes the unchanged warm-read tail. No graph is pre-materialized. The script checks 0 materializations before first Detail, exactly 1 afterward and after all warm reads; deterministic nonempty Detail and exact requested ID; Raw/Logical fixture counts; Raw response identity/type; unchanged source file dev/ino/size/mtime/ctime. Fixtures are removed afterward. Cold still means materialization cold, not OS-cache cold. / 每个 worker 保留 PR #54 的真实 loopback HTTP 冷请求直至首次 Detail 完成，然后执行未变的热读尾部；不预先物化对象图。脚本检查首次 Detail 前物化为 0、之后及全部热读后恰好为 1；Detail 确定、非空且 ID 正确；Raw／Logical 数符合 fixture；Raw 响应身份／类型正确；来源文件 dev／ino／size／mtime／ctime 不变。之后清理 fixture。冷态仍指尚未物化，不是 OS cache 冷态。

### Invocation taxonomy and metrics / 调用分类与指标

The private validator captures and rechecks `materialization_context`, `indexed_session`, and `materialized_session` in that order; query projection is followed by `projection_recheck/materialized_session`. Thus there are seven invocations, not three. Roles are fixed strings; existing `onProjectionChunk` phase names and event shapes remain unchanged. The optional internal `onFingerprintProfile` receives one numeric/content-free summary after a completed digest and before its caller compares it. Failed/aborted invocations have no completion summary. Callback exceptions cannot replace validation/admission errors; formal script accounting is checked after materialization outside that callback. / Private validator 按顺序 capture 并 recheck context、Indexed Session、Materialized Session；查询投影后另有 Materialized Session recheck。因此是七次调用，不是三次。角色为固定字符串；既有 `onProjectionChunk` phase 名称及事件结构不变。可选内部回调在 digest 完成、调用方比较之前接收一次纯数值／无内容摘要；失败或取消的调用不发送完成摘要。回调异常不能替换校验／准入错误；正式脚本在物化之后、回调外校验核算。

| Metric / 指标 | Definition / 定义 |
| --- | --- |
| `elapsedMs` | Monotonic `performance.now()` wall duration from immediately before hash setup through completed digest; summary emission excluded. / hash 初始化之前至 digest 完成的单调墙钟时长；不含摘要发送。 |
| `yieldWaitMs`, `yieldCount` | Time immediately around each existing awaited `setImmediate`, including the final post-traversal yield, plus count. No yield is added, removed or moved. / 仅围绕每个既有 awaited `setImmediate` 计时并计数，包含遍历末尾 yield；不增加、删除或移动 yield。 |
| `activeComputeMs` | `elapsedMs - yieldWaitMs`; non-yield wall remainder, including possible GC, preemption and existing chunk callback cost, not exact on-CPU time. / 扣除 yield 等待后的墙钟余量，仍可能包含 GC、抢占及既有 chunk callback 成本，不是精确 CPU 时间。 |
| `operationCount` | Processed tasks, exactly the existing 4,096-operation chunk-policy unit; sum of visit/write/byte task counts. / 已处理 task 数，与既有 4,096-operation 分块单位完全一致，等于 visit／write／byte task 数之和。 |
| `chunkCount` | Existing chunk notifications, including final remainder even when zero: `floor(operationCount / 4096) + 1`, equal to yield count. / 既有 chunk 通知数，包含即使为零的末尾余量，等于 yield 数。 |
| `visitTaskCount`, `writeTaskCount`, `byteTaskCount` | Counts of popped tasks by kind; each byte task performs one binary hash update (up to 256 KiB). Visits may write multiple tokens directly. / 按类型计数弹出的 task；每个 byte task 做一次最多 256 KiB 的二进制 hash update；visit 可直接写多个 token。 |
| `firstObjectVisitCount`, `repeatedReferenceCount` | First traversal of an object/function in that invocation versus the `seen.has` repeated-reference branch. Prototype IDs alone are not object visits. / 当前调用内对象／函数的首次遍历与 `seen.has` 重复引用分支计数；仅分配 prototype ID 不算对象访问。 |
| `ownPropertyCount` | Sum of own keys whose descriptors are inspected on completed traversal; excludes the separate prototype-constructor descriptor lookup. / 完成遍历时被检查 descriptor 的 own key 总数；不含额外的 prototype-constructor descriptor 查询。 |
| `mapEntryCount`, `setEntryCount` | Entries actually iterated, without additional property/getter reads. / 实际迭代 entry 数，不额外读取属性或 getter。 |
| `writeTokenCount` | Logical textual `write()` calls, including direct writes inside visits. / 文本 `write()` 逻辑调用数，包含 visit 内直接写入。 |
| `textValueUtf8Bytes`, `textPrefixBytes` | UTF-8 value bytes from the already-required byte-length calculation, and ASCII decimal-length-plus-colon prefix bytes. / 复用既有长度计算得到的 UTF-8 value 字节数，以及十进制长度加冒号的 ASCII prefix 字节数。 |
| `binaryHashBytes`, `hashInputBytes` | Binary byte-task bytes; total SHA-256 input = text values + prefixes + binary bytes. / 二进制 byte-task 字节数；SHA-256 总输入为文本值、prefix 与二进制字节之和。 |
| `hashUpdateCallCount` | Derived `2 * writeTokenCount + byteTaskCount`; no additional per-update counter. / 由公式推导，不另加逐 update 计数。 |

Counters are conditional; no clock is read per token/property/hash update, no content or per-object records are retained, and no second broad profiling framework is added. Tests compare the actual concatenated SHA-256 input stream and identity IDs against unchanged synchronous fingerprinting with Unicode, cyclic references, symbols, descriptors/accessors, prototypes, Map/Set, Date/RegExp and binary chunks. Shared strict Codex admission also returns the identical observed/unobserved result. / 计数按需开启，不逐 token／属性／hash update 读时钟，不保留内容或逐对象记录，不增加第二套宽泛 profiler。测试以未变的同步 fingerprint 为参考，对含 Unicode、循环引用、symbol、descriptor／accessor、prototype、Map／Set、Date／RegExp 和二进制块的图比较实际 SHA-256 拼接输入流及 identity ID；共享 strict Codex 准入也保持有／无观测结果一致。


### Environment and instrumentation overhead / 环境与计数开销

Windows 11 (`10.0.22631`), x64, AMD Ryzen 5 5600U, 12 logical CPUs, 14,864,674,816 bytes RAM, Node `v24.18.1`, npm `12.0.2`. All workloads ran sequentially with no concurrent repository tests. PR #54 used the same reported runtime/hardware, but these are separate workstation observations, not an optimization before/after comparison; its historic latency table is retained unchanged. / 环境如上；所有场景顺序执行，不并发运行仓库测试。PR #54 所报告运行时／硬件相同，但这是独立工作站观测，不是优化前后对照；保留原有历史时延表。

Three observations per mode/case; round order off→on, on→off, off→on. The common denominator is the sum of the original three nonoverlapping PR #54 fingerprint parent spans, with phase profiling enabled in both modes. Times below are median [min, max] ms, and Δ compares medians. / 每种模式／场景观测三次，轮次顺序为关→开、开→关、关→开；比较双方均开启阶段 profiling 的 PR #54 三个不重叠 fingerprint 父阶段之和。下表为中位 [最小, 最大] 毫秒，Δ 比较中位数。

| Case / 场景 | Detailed off / 关闭 | Detailed on / 开启 | Δ |
| --- | --- | --- | --- |
| 10,000 / tool-dense | 4,489.11 [4,452.92, 4,527.83] | 4,523.88 [4,507.91, 4,662.47] | +0.77% |
| 10,000 / message-dense | 5,547.30 [5,472.49, 5,726.38] | 5,701.77 [5,573.53, 5,741.58] | +2.78% |
| 50,000 / message-dense | 28,846.16 [28,196.55, 30,150.39] | 29,809.30 [29,716.90, 30,903.46] | +3.34% |

Observed median perturbation is 0.77–3.34%, with overlapping ranges in the larger cases. The three fingerprint spans remain overwhelmingly dominant; relative ordering among similarly sized full-graph passes can fluctuate and is not an optimization priority. This is not a product latency threshold or proof of zero overhead. The perturbation is small relative to the measured active/yield and CPU-category separation, so the conditional counters are retained. / 中位扰动为 0.77–3.34%，较大场景的范围重叠。三个 fingerprint 阶段仍占绝对主导；成本相近的完整 pass 之间次序会波动，不据此选择优化。此结果不是产品时延阈值，也不证明零开销；相较 active／yield 及 CPU 类别的差距，扰动较小，因此保留条件计数。

### Formal matrix and repeats / 正式矩阵与复测

| Records / 记录 | Shape / 形状 | Encoding / 编码 | Cold Detail ms | Materialization ms | Fingerprint wall ms | Yield wait ms | Active remainder ms | Wait % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | tool-dense | plain | 4,886.22 | 4,842.08 | 4,553.42 | 83.60 | 4,469.82 | 1.84 |
| 10,000 | message-dense | plain | 6,069.20 | 6,020.28 | 5,681.07 | 115.64 | 5,565.43 | 2.04 |
| 50,000 | tool-dense | plain | 25,943.61 | 25,757.64 | 24,302.18 | 522.95 | 23,779.23 | 2.15 |
| 50,000 | message-dense | plain | 31,352.54 | 31,192.93 | 29,626.46 | 568.39 | 29,058.07 | 1.92 |
| 50,000 | message-dense | zstd | 30,798.18 | 30,607.42 | 29,004.56 | 797.84 | 28,206.72 | 2.75 |

For each 50k plain shape, the formal observation plus two additional observations give: / 每种 50k plain 形状均有正式观测及两次额外复测：

| Shape / 形状 | Fingerprint wall median [min, max] ms | Wait % range / 等待占比范围 | Materialized passes share range / 完整会话 pass 占比范围 |
| --- | --- | --- | --- |
| tool-dense | 22,926.53 [22,509.12, 24,302.18] | 2.05–2.47 | 99.995–99.996% |
| message-dense | 28,702.29 [28,012.60, 29,626.46] | 1.83–1.92 | 99.989–99.996% |

Yield wait stays below 2.5% across the six 50k plain observations and is 2.75% in the large Zstd sanity case. It does not explain the multi-second delay. The three complete Materialized Session passes consume at least 99.988% of all async fingerprint wall time in these 50k observations. / 六次 50k plain 观测的 yield 等待均低于 2.5%，大 Zstd sanity 为 2.75%；它无法解释数十秒延迟。在这些 50k 观测中，三个完整 Materialized Session pass 占全部 async fingerprint 墙钟的至少 99.988%。

### Per-invocation wall attribution / 逐调用墙钟归因

**50k tool-dense / plain** (ms; share of all seven async fingerprints / 毫秒；占七次 async fingerprint 总量)

| Role / 角色 | Elapsed | Yield wait | Active remainder | Share % |
| --- | --- | --- | --- | --- |
| private_capture/materialization_context | 0.32 | 0.06 | 0.26 | <0.01 |
| private_capture/indexed_session | 0.45 | 0.06 | 0.39 | <0.01 |
| private_capture/materialized_session | 7,813.65 | 161.19 | 7,652.46 | 32.15 |
| private_recheck/materialization_context | 0.05 | 0.01 | 0.03 | <0.01 |
| private_recheck/indexed_session | 0.22 | 0.01 | 0.22 | <0.01 |
| private_recheck/materialized_session | 8,392.73 | 162.02 | 8,230.71 | 34.53 |
| projection_recheck/materialized_session | 8,094.76 | 199.60 | 7,895.16 | 33.31 |

**50k message-dense / plain** (ms; share of all seven async fingerprints / 毫秒；占七次 async fingerprint 总量)

| Role / 角色 | Elapsed | Yield wait | Active remainder | Share % |
| --- | --- | --- | --- | --- |
| private_capture/materialization_context | 0.34 | 0.08 | 0.26 | <0.01 |
| private_capture/indexed_session | 0.46 | 0.07 | 0.40 | <0.01 |
| private_capture/materialized_session | 9,927.52 | 190.61 | 9,736.92 | 33.51 |
| private_recheck/materialization_context | 0.08 | 0.02 | 0.07 | <0.01 |
| private_recheck/indexed_session | 0.21 | 0.01 | 0.21 | <0.01 |
| private_recheck/materialized_session | 9,801.70 | 185.93 | 9,615.76 | 33.08 |
| projection_recheck/materialized_session | 9,896.14 | 191.68 | 9,704.46 | 33.40 |

### Workload density / 工作量密度

The following counts apply identically to each of private capture, private recheck and projection recheck of the Materialized Session. They are stable across all three 50k plain observations. / 下列计数对 Materialized Session 的 private capture、private recheck、projection recheck 每一次均相同，且在各形状三次 50k plain 观测中稳定。

| Records / 记录 | Shape / 形状 | Objects / 对象 | Own descriptors / 属性描述符 | Write tokens | Hash input bytes | Tasks / 操作 | Yields |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | tool-dense | 100,029 | 665,145 | 5,721,278 | 58,422,874 | 4,756,051 | 1,162 |
| 10,000 | message-dense | 140,028 | 830,142 | 7,211,250 | 67,967,425 | 5,951,029 | 1,453 |
| 50,000 | tool-dense | 500,029 | 3,325,145 | 28,601,278 | 293,577,892 | 23,776,051 | 5,805 |
| 50,000 | message-dense | 700,028 | 4,150,142 | 36,051,250 | 341,259,441 | 29,751,029 | 7,264 |

| Additional per-pass 50k metric / 额外逐 pass 指标 | Tool-dense | Message-dense |
| --- | --- | --- |
| visitTaskCount | 3,325,146 | 4,150,143 |
| writeTaskCount | 20,450,905 | 25,600,886 |
| repeatedReferenceCount | 50,000 | 100,000 |
| textValueUtf8Bytes | 230,630,097 | 262,096,700 |
| textPrefixBytes | 62,947,795 | 79,162,741 |
| hashUpdateCallCount | 57,202,556 | 72,102,500 |

Both shapes have zero binary-byte tasks/bytes and zero Map/Set entries in this fixture; binary chunks and Map/Set semantics are instead exercised by the exact-byte-stream test. The small context capture/recheck visits 1 object / 3 properties / 23 tasks / 30 tokens / 400 hash bytes per invocation. Indexed capture/recheck visits 9 / 71 / 507 / 603 / 5,235 for tools, and 8 / 68 / 485 / 575 / 5,074 for messages (same units). / 两形状在此 fixture 中二进制 task／字节、Map／Set entry 均为零；这些语义另由精确字节流测试覆盖。小 context 每次 capture／recheck 为 1 对象／3 属性／23 task／30 token／400 hash 字节。Indexed 每次工具为 9／71／507／603／5,235，消息为 8／68／485／575／5,074，单位相同。

At 50k, message density raises objects by 40.0%, descriptors by 24.8%, tokens/update calls by 26.0% and hash input by 16.2%. The three passes perform 171,607,668 hash updates for tools and 216,307,500 for messages, averaging only 5.13 / 4.73 bytes per update. The Zstd message case keeps task/object/property/token/update counts identical; text/hash input rises by 1,000,014 bytes per pass (0.293%), reflecting storage-dependent evidence strings in the guarded graph, not a different traversal. Its materialized hash input is 342,259,455 bytes. / 50k 消息形状使对象增 40.0%、descriptor 增 24.8%、token／update 调用增 26.0%、hash 输入增 16.2%。工具／消息三个 pass 分别执行 171,607,668／216,307,500 次 hash update，平均每次仅 5.13／4.73 字节。Zstd 消息的 task／对象／属性／token／update 数完全相同；每次 pass 的文本／hash 输入多 1,000,014 字节（0.293%），反映被保护对象图中与存储相关的 evidence 字符串，而非不同遍历；其物化 hash 输入为 342,259,455 字节。

### Independent CPU sampling / 独立 CPU 采样

Both commands run the real HTTP worker directly, with detailed counters disabled and the default 1,000 μs sampling interval made explicit: / 两条命令直接运行真实 HTTP worker，关闭详细计数，并显式指定默认 1,000 μs 采样间隔：

```powershell
node --cpu-prof --cpu-prof-interval=1000 --cpu-prof-dir=tmp/fingerprint-attribution --cpu-prof-name=tool-dense.cpuprofile scripts/deepseek-readback-profile.js --worker --sizes=50000 --shape=tool-dense --compression=plain --fingerprint-profile=off
node --cpu-prof --cpu-prof-interval=1000 --cpu-prof-dir=tmp/fingerprint-attribution --cpu-prof-name=message-dense.cpuprofile scripts/deepseek-readback-profile.js --worker --sizes=50000 --shape=message-dense --compression=plain --fingerprint-profile=off
```

The captures contain 32,286 / 38,825 samples (tool/message), and both pass all cold/count/identity/reading assertions. Reconstruct each sampled node's parent chain from `nodes[].children`; select samples with `graphFingerprintAsync` in the ancestry; weight them by their corresponding `timeDeltas`. Assign disjoint categories in order: crypto `update` subtree, encoding/`byteLength` subtree outside update, remaining textual `write` subtree, remaining fingerprint stack. This isolates the fingerprint from fixture generation, indexing and warm reads; selected samples represent about 70.8% / 74.9% of the whole process profile. No `--cold-only` mode was needed or added. / 工具／消息分别采到 32,286／38,825 个样本，两者均通过全部冷态／计数／身份／阅读断言。由 `nodes[].children` 重建父链，选择祖先包含 `graphFingerprintAsync` 的样本，以对应 `timeDeltas` 加权；按顺序分入互斥类别：crypto update 子树、update 外编码／byteLength 子树、剩余文本 write 子树、剩余 fingerprint 栈。这样将 fingerprint 与 fixture 生成、索引、热读隔离；选中样本约占整个进程 profile 的 70.8%／74.9%，无需也未加入 cold-only 模式。

| Approximate share within sampled fingerprint stacks / fingerprint 栈内近似采样占比 | Tool-dense | Message-dense |
| --- | --- | --- |
| `Hash.update` subtree / 子树 | 65.0% | 64.2% |
| `Buffer.byteLength` / UTF-8 subtree outside update / update 外 UTF-8 路径 | 6.4% | 6.4% |
| Remaining textual `write` / 文本 write 余量 | 9.7% | 10.1% |
| Remaining traversal/task/identity/descriptor work / 遍历、task、identity、descriptor 等余量 | 18.9% | 19.4% |

The remaining category includes `graphFingerprintAsync` self (~15.3% in both shapes), `objectId` (~1.6% / 1.9%), `pushSequence` (~1.7% / 1.6%) and `appendWriteKey` (~0.3% / 0.5%). Graph self-position ticks locate `Reflect.ownKeys` at measured line 340 (575 / 783 ticks) and `Object.getOwnPropertyDescriptor` at line 345 (466 / 519 ticks), as well as stack pop/type dispatch, direct write calls, `seen` and task construction. These builtins do not have separate sampled function frames here; line ticks locate work but are not precise per-builtin CPU accounting. No `symbolId` frame is sampled in these symbol-free synthetic histories; symbol correctness is covered by the byte-stream fixture. Synchronous `graphFingerprint` ancestry is about 0.01% or less of whole-process samples, providing no reason to widen this task to synchronous ownership guarding. / 余量包含 graphFingerprintAsync self（两形状约 15.3%）、objectId（约 1.6%／1.9%）、pushSequence（约 1.7%／1.6%）、appendWriteKey（约 0.3%／0.5%）。Graph self 的行位置 tick 定位到测量源码第 340 行 ownKeys（575／783 tick）、第 345 行 descriptor 查询（466／519 tick），以及栈弹出／类型分派、直接 write、seen 和 task 构造。这里 builtin 没有独立采样函数帧；行 tick 只能定位工作，不能精确分摊各 builtin 的 CPU。无 symbol 的合成历史未采到 symbolId 帧，其正确性由字节流 fixture 覆盖。同步 graphFingerprint 祖先链约占全进程样本的 0.01% 或更少，不支持扩大任务至同步 ownership guard。

This is sampling evidence, not exact CPU accounting. Node's `internal/crypto/hash` update frame includes validation, string conversion/native binding and native hashing; it cannot separate SHA-256 compression from tiny-call/encoding overhead. Some V8 builtins are inlined or anonymous (`byteLength` has an anonymous native child); attribution uses ancestors, not just leaf names. GC appears at the profile root (~4.0% / 3.5% of whole-process weighted samples) and cannot reliably be assigned to fingerprint invocations. Scheduling wait and preemption are not measured as precise CPU by these profiles; direct yield telemetry remains the wall-time authority. CPU-profiled cold HTTP times were 28.61 / 35.85 s, so those perturbed durations are not substituted for formal timings. / 这是采样证据，不是精确 CPU 核算。Node internal/crypto/hash 的 update 帧包含校验、字符串转换／native binding 与 native hashing，不能拆分 SHA-256 压缩核心和微小调用／编码开销。有些 V8 builtin 被 inline 或匿名化（byteLength 的 native child 为匿名），故依据祖先链而非只看叶帧。GC 位于 profile 根（约占全进程加权样本 4.0%／3.5%），无法可靠分派给某次 fingerprint。Profile 不能将调度等待／抢占当作精确 CPU；墙钟等待仍以直接 yield 遥测为准。CPU profiling 下冷 HTTP 为 28.61／35.85 秒，其扰动时长不替代正式时延。

### Next optimization decision / 下一步优化决策

**Choose one next direction: digest-byte-stream-equivalent batching of textual hash updates.** Active non-yield work dominates in both shapes; `Hash.update` is the largest sampled category, with text/UTF-8 handling accounting for another ~16%. Tens of millions of tiny updates per pass are a concrete per-pass inefficiency exposed by this evidence. The next PR should preserve exactly the concatenated bytes entering SHA-256, textual length prefixes, explicit binary chunks' byte order, object/symbol IDs, traversal domain and all descriptor/prototype/accessor checks. Keep all current guard passes, mutation-detection windows, error precedence and existing cooperative-yield/cancellation boundaries. / **仅选择一个下一方向：文本 hash update 的 digest 字节流等价批量写入。** 两形状均以非 yield 工作为主；Hash.update 是最大采样类别，文本／UTF-8 处理另约占 16%。每次 pass 数千万次微小 update 是本次证据揭示的具体逐 pass 低效。下一 PR 应证明进入 SHA-256 的拼接字节完全一致，保留文本长度 prefix、显式二进制字节顺序、object／symbol ID、遍历范围及全部 descriptor／prototype／accessor 检查，同时保留全部 guard pass、mutation 检测窗口、错误优先级及既有 yield／取消边界。

The selected update category contains roughly 64–65% of sampled fingerprint work; if an equivalent implementation halved that category while leaving the rest unchanged, it would suggest roughly one-third less fingerprint active work. This is a conditional estimate, not a measured speedup: batching retains SHA-256 byte work and introduces buffer-copy/allocation costs. Do not convert sampled shares into exact saved milliseconds. Benchmark the next implementation before accepting it. / 目标 update 类别约占 fingerprint 采样工作的 64–65%；若等价实现把该类别减半、其他不变，则条件性地意味着 fingerprint active 工作约减少三分之一。这不是已测加速：批量写入仍保留 SHA-256 字节处理，并引入 buffer 复制／分配成本；不得将采样占比换算为精确节省毫秒，必须测量下一实现再验收。

Yield-policy changes are not selected: only ~2% of 50k plain wall time is awaited yield. Weaker traversal is not selected: descriptor/prototype/identity safeguards remain required, and traversal is a smaller sampled category. Pass removal/reuse is not selected: those mutation windows remain distinct; no evidence here authorizes deleting one. The evidence selects an equivalent implementation boundary, not a weaker validation architecture. / 不选择改变 yield 策略，因为 50k plain 仅约 2% 墙钟为 yield 等待；不选择削弱遍历，因为 descriptor／prototype／identity 保护仍必须保留，且遍历占比较小；不选择删 pass 或额外复用，因为 mutation 窗口仍不同，本次证据不授权删除任何一次。证据选定的是等价实现边界，不是弱化校验架构。

Debt #22 remains open: **fingerprint internals attributed; optimization implementation pending**. No hash batching, algorithm change, yield/chunk change, pass removal/reuse, narrowed graph domain, cache/admission/accepted-snapshot change, DeepSeek reconstruction change, #20 bounded reader or browser change is implemented. / 债务 #22 保持开放：**fingerprint 内部已归因；优化实现待完成**。本次没有实现 hash batching、算法替换、yield／chunk 修改、pass 删除／复用、缩小对象图范围、cache／准入／accepted snapshot 修改、DeepSeek 重建优化、#20 有界 reader 或浏览器变更。

### Reproduction, validation and retained evidence / 复现、验证与保留证据

From the repository root, store JSON under ignored `tmp/fingerprint-attribution/`: / 从仓库根目录运行，将 JSON 保存在 ignored 临时目录：

```powershell
node scripts/deepseek-readback-profile.js --sizes=100 --shape=tool-dense,message-dense --compression=plain --fingerprint-profile=on
node scripts/deepseek-readback-profile.js --sizes=10000,50000 --shape=tool-dense,message-dense --compression=plain --fingerprint-profile=on
node scripts/deepseek-readback-profile.js --sizes=50000 --shape=message-dense --compression=zstd --fingerprint-profile=on
node scripts/deepseek-readback-profile.js --sizes=50000 --shape=tool-dense,message-dense --compression=plain --fingerprint-profile=on
```

Run the last command twice for the repeat evidence. For overhead, run 10k both shapes and 50k messages/plain separately with off and on, in the three round orders described above. Formal plain completed `2026-09-11T05:09:53.678Z`; the second repeat completed `2026-09-11T05:12:52.194Z`. All nine formal/repeat cases, 18 overhead cases and both CPU workers passed the count/identity/reading invariants. / 最后一条运行两次以获得复测。开销对照分别跑 10k 两形状和 50k 消息 plain，以前述三轮顺序切换 off／on。正式 plain 与第二轮复测完成时间如上。九个正式／复测场景、18 个开销场景、两个 CPU worker 全部通过计数／身份／阅读不变量。

The measured implementation passed `npm run build:check`, `npm test` (**1,105/1,105**) and `git diff --check` before formal captures. Explicit focused commands included: / 测量实现于正式采集之前通过构建检查、完整 Node 测试（**1,105／1,105**）及 diff 检查；显式聚焦命令包括：

```powershell
node --test test/source-adapter-conformance.test.js test/materialization-observer.test.js test/canonical-contract.test.js test/codex-indexed-materialization.test.js test/deepseek-harness-materialization-observer.test.js test/materialized-session-owner.test.js
node --test test/source-adapter-contract.test.js test/project-query-store.test.js test/index-revision-lease.test.js test/index-revision-server.test.js test/deepseek-harness.test.js test/deepseek-harness-stable-read.test.js
node --test test/deepseek-readback-profile.test.js test/fingerprint-byte-stream.test.js
```

These passes reported 122, 59 and 14 passing tests respectively. The focused tests cover disabled/enabled result parity, content-free allowlisted fields, stable workload counts, exact hash-input accounting, ordered roles, observed chunk/task consistency, callback failure isolation, private and projection mutation detection, admission failure precedence, cancellation and strict Codex conformance. No performance-duration assertions were added. / 三组分别通过 122、59、14 项测试，覆盖开关结果一致、不含内容的字段白名单、稳定工作量、精确 hash 输入核算、角色顺序、chunk／task 一致性、回调失败隔离、private 与 projection mutation 检测、准入失败优先级、取消和 strict Codex conformance；未增加性能时长断言。

Post-capture review identified returned rejected Promises as an additional observer-isolation case. Commit `58e88230b0e3ac9d95b1c51edf25cdeb3bfd7f13` suppresses those rejections without awaiting, after the invocation timer ends, and extends success/failure tests. It does not change traversal, writes, counters, yield placement or the synchronous collector used in formal captures. Formal results remain attributed to `73a6191`, not this later commit. The 66-test focused follow-up, build check, complete **1,105/1,105** Node suite and diff check passed again; clean-tree two-shape 100-record HTTP smoke at `58e8823` passed (89.61 / 108.88 ms cold Detail; seven roles each). / 采集后复查发现回调返回 rejected Promise 的额外隔离情形。后续提交在 invocation timer 结束后、不 await 地抑制该拒绝，并补充成功／失败测试；不改变遍历、写入、计数、yield 位置或正式采集使用的同步 collector。正式结果仍归属于 `73a6191`，不标为后续提交。补强后 66 项聚焦测试、构建检查、完整 **1,105／1,105** Node 套件和 diff 检查再次通过；`58e8823` clean tree 上两形状 100-record HTTP smoke 通过（冷 Detail 89.61／108.88 ms，各七角色）。

A narrow bilingual lifecycle-design note documents the reusable internal summary seam; lifecycle/product behavior and public documentation do not change. No browser-facing code changed, so no local browser suite or running checkout-server restart was needed for this isolated diagnostic worktree. / 以一段双语生命周期设计说明记录可复用的内部摘要接口；生命周期／产品行为及公开文档不变。没有浏览器代码改动，因此此独立诊断 worktree 无需本地浏览器套件或重启用户运行中的 checkout server。

Local evidence includes `smoke.json`, `overhead-{10k,50k}-{1,2,3}-{off,on}.json`, `formal-plain.json`, `formal-zstd.json`, `repeat-{1,2}.json`, `cpu-{tool,message}-dense.json`, CPU summaries, `.cpuprofile` files and validation logs under ignored `tmp/fingerprint-attribution/`. Temporary analysis scripts are local only. No raw CPU profile, giant JSON or generated transcript is committed; the durable evidence is these aggregate tables, definitions and method. / 本地证据包含上述 smoke、开销、正式／复测、CPU worker JSON、CPU 摘要、原始 CPU profile 及验证日志，均位于 ignored 临时目录。分析脚本也仅保留本地。不提交原始 CPU profile、大型 JSON 或生成 transcript；持久证据为这些聚合表、定义及方法。

## Equivalent textual hash batching experiment / 等价文本 hash 批量写入实验

This experiment implements the single optimization selected by the attribution above. Baseline is clean `main@9c3ad1eba4b2fc5384e6450c372886006af57397`; candidate is clean `0c64434241565e492ccd3d14639b343e90b8997c` on `perf/fingerprint-hash-batching`. Historical PR #54/#55 measurements and the `73a6191` anchor remain unchanged; the before/after results here come from fresh paired runs, not comparison against a historical timing. / 本实验实现上方归因选定的单一优化。Baseline 为上述 clean main，candidate 为上述 clean 新分支提交。历史 PR #54／#55 数据及 `73a6191` 锚点保持不变；这里的前后结果来自新跑的配对观测，不与历史时延直接比较。

### Implementation and equivalence / 实现与等价性

Only textual SHA-256 submission changes: complete `UTF8-byte-length:value` tokens accumulate up to 64 KiB UTF-8 input. ASCII length prefixes separate complete values, so lone UTF-16 surrogates cannot form new pairs across tokens; the encoded byte stream is unchanged. A token larger than the limit flushes pending text and uses its original two direct updates. Pending text is also flushed before every binary byte task and existing 4,096-task/final chunk boundary. No text value is split, no binary chunk changes, and no task, yield, abort checkpoint, invocation or mutation-detection window is added or removed. / 仅改变文本 SHA-256 提交：完整 `UTF8-byte-length:value` token 累积至最多 64 KiB UTF-8 输入。ASCII 长度 prefix 隔开完整 value，孤立 UTF-16 surrogate 不会跨 token 形成新 pair，因此编码字节流不变。超过容量的单个 token 先 flush 待提交文本，再沿用原有两次直接 update；每个二进制 byte task 及既有 4,096-task／末尾 chunk 边界前亦 flush。不切分文本 value、不改二进制块、不增减 task、yield、abort 检查点、调用或 mutation 检测窗口。

`writeTokenCount` and all graph/task/input-byte counters retain their definitions. The new internal `textHashUpdateCallCount` records actual physical text submissions; `hashUpdateCallCount = textHashUpdateCallCount + byteTaskCount`. Earlier reports' `2 * writeTokenCount + byteTaskCount` was correct for their unbatched implementation and is not retroactively rewritten. There is no production toggle or public API/CLI change. / `writeTokenCount` 及所有图／task／输入字节计数的定义不变。新增内部 `textHashUpdateCallCount` 记录真实物理文本提交，总 update 数按文本提交加 byte task 计算。历史报告的每 token 两次公式在其未批量实现上正确，不追溯修改。不增加生产开关或公开 API／CLI 变更。

### Method / 方法

The same Windows 11 / Node v24.18.1 / npm 12.0.2 / Ryzen 5 5600U / 12-logical-CPU / 14,864,674,816-byte host ran cases sequentially, without concurrent tests. Main and candidate each ran the existing real-HTTP profiler from their own checkout. Primary latency runs disabled detailed fingerprint counters while retaining the existing phase collector. 10k plain covers both shapes once per arm; 50k plain covers both shapes three times per arm, in baseline→candidate, candidate→baseline, baseline→candidate round order. A 50k message Zstd sanity run and a separate detailed-counter 50k plain run for both shapes were added per arm: 22 worker cases total. / 在相同 Windows 11／Node／npm／CPU／内存环境顺序运行，不并发测试。Main 与 candidate 分别从各自 checkout 运行既有真实 HTTP profiler。主要时延观测关闭详细 fingerprint 计数，保留既有阶段 collector。两种 10k plain 形状每侧各一次；两种 50k plain 形状每侧各三次，轮次顺序为 baseline→candidate、candidate→baseline、baseline→candidate。每侧另跑 50k 消息 Zstd sanity，以及两形状 50k plain 详细计数观测，共 22 个 worker 场景。

From each checkout, use these commands; run the 50k plain command in the round order above: / 在各 checkout 执行以下命令；50k plain 按上述顺序重复：

```powershell
node scripts/deepseek-readback-profile.js --sizes=10000 --shape=tool-dense,message-dense --compression=plain --fingerprint-profile=off
node scripts/deepseek-readback-profile.js --sizes=50000 --shape=tool-dense,message-dense --compression=plain --fingerprint-profile=off
node scripts/deepseek-readback-profile.js --sizes=50000 --shape=message-dense --compression=zstd --fingerprint-profile=off
node scripts/deepseek-readback-profile.js --sizes=50000 --shape=tool-dense,message-dense --compression=plain --fingerprint-profile=on
```

Every worker preserves cold materialization count 0→1, deterministic nonempty first Detail and exact requested ID, expected Raw/Logical counts, warm-read reuse and unchanged source dev/ino/size/mtime/ctime. No pre-materialization, alternate admission, OS-cache reset, forced GC or heap-limit tuning is used. This experiment measures latency and update counts directly; it does not repeat the earlier CPU-attribution investigation. / 每个 worker 保留冷态物化 0→1、确定且非空的首次 Detail 和精确请求 ID、预期 Raw／Logical 数、热读复用及来源 dev／ino／size／mtime／ctime 不变。不预物化、不改准入、不重置 OS cache、不强制 GC 或调整 heap 上限。本实验直接测量时延与 update 数，不重复此前 CPU 归因调查。


### Latency results / 时延结果

Times are ms; 50k plain cells are medians of three observations, other cells are single observations. Fingerprint time sums the same three nonoverlapping parent spans in both implementations. / 单位为毫秒；50k plain 为三次观测中位数，其余为单次。Fingerprint 时长在两实现中均为同样三个不重叠父阶段之和。

| Case / 场景 | Baseline cold Detail | Candidate cold Detail | Cold reduction / 冷读降幅 | Baseline fingerprint | Candidate fingerprint | Fingerprint reduction / 降幅 |
| --- | --- | --- | --- | --- | --- | --- |
| 10k / tool-dense | 4,823.49 | 2,460.89 | 48.98% | 4,472.35 | 2,116.99 | 52.66% |
| 10k / message-dense | 6,109.78 | 3,218.75 | 47.32% | 5,727.11 | 2,853.48 | 50.18% |
| 50k-plain / tool-dense | 23,676.73 | 12,420.75 | 47.54% | 22,082.30 | 10,809.14 | 51.05% |
| 50k-plain / message-dense | 29,810.05 | 17,180.49 | 42.37% | 28,135.26 | 15,520.03 | 44.84% |
| 50k-zstd / message-dense | 30,375.04 | 16,292.86 | 46.36% | 28,619.48 | 14,534.64 | 49.21% |

| 50k plain shape / 形状 | Baseline cold [min, max] ms | Candidate cold [min, max] ms | Baseline materialization median ms | Candidate materialization median ms |
| --- | --- | --- | --- | --- |
| tool-dense | [23,470.78, 24,288.69] | [12,316.55, 12,720.57] | 23,516.36 | 12,244.14 |
| message-dense | [29,446.54, 29,848.67] | [16,469.57, 17,208.83] | 29,676.58 | 17,036.27 |

All six paired 50k plain observations show lower candidate latency; the large Zstd case supports the same direction. The gain is substantial but not full first-read acceptance: 50k still takes roughly 12–17 seconds. This synthetic result is not generalized to all real Sessions or other sources. / 六组配对的 50k plain 观测均显示候选时延更低，大 Zstd 场景方向相同。收益明显，但不意味着首次阅读体验已全面验收：50k 仍约需 12–17 秒。不将合成结果推广到全部真实会话或其他来源。

### Workload and update accounting / 工作量与 update 核算

Across all seven invocation roles in both 50k plain counter captures, every common role/task/object/reference/property/Map/Set/token/input-byte/chunk/yield field matches baseline exactly, excluding only the intentionally changed physical update count. Each of the three full Materialized Session passes has the following identical per-shape workload: / 两种 50k plain 计数采集中，七个调用角色的全部共有 role／task／对象／引用／属性／Map／Set／token／输入字节／chunk／yield 字段均与基线精确相等，仅排除有意改变的物理 update 数。三个完整 Materialized Session pass 中每一次均具有下列相同形状工作量：

| Shape / 形状 | Objects / 对象 | Descriptors | Tasks | Tokens | Hash input bytes | Yields | Baseline updates | Candidate updates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tool-dense | 500,029 | 3,325,145 | 23,776,051 | 28,601,278 | 293,577,892 | 5,805 | 57,202,556 | 5,805 |
| message-dense | 700,028 | 4,150,142 | 29,751,029 | 36,051,250 | 341,259,441 | 7,264 | 72,102,500 | 7,264 |

Physical updates fall by about 99.99% while input bytes and all three full passes remain. In these text-only fixtures, the batch limit is not exceeded between most existing task-yield boundaries, and each completed task chunk supplies one physical text update. Binary interleaving and oversized text are separately covered by exact-stream tests; the physical count is not assumed to equal yields for arbitrary graphs. / 输入字节及三个完整 pass 保留，物理 update 减少约 99.99%。这些纯文本 fixture 的既有 task-yield 边界间批次未超容量，每个已完成 task chunk 提交一次物理文本 update。二进制交错与超大文本由精确流测试单独覆盖；不假定任意图的物理 update 数都等于 yield 数。

### Memory observations and limits / 内存观测与限制

The table is median [min, max] MiB over the three 50k plain workers. Cold RSS is sampled immediately after first Detail; maxRSS covers fixture generation, indexing, materialization and all warm-read tails, not just hashing. No forced GC is used. / 下表为三次 50k plain worker 的中位 [最小, 最大] MiB。Cold RSS 在首次 Detail 后采样；maxRSS 包含 fixture 生成、索引、物化及全部热读尾部，并非仅 hashing；未强制 GC。

| Shape / 形状 | Baseline cold RSS | Candidate cold RSS | Baseline lifetime maxRSS | Candidate lifetime maxRSS |
| --- | --- | --- | --- | --- |
| tool-dense | 737.04 [710.20, 943.44] | 734.00 [610.11, 1,062.29] | 1,129.24 [1,109.26, 1,217.51] | 1,123.74 [1,025.66, 1,470.87] |
| message-dense | 927.65 [786.67, 1,141.58] | 857.38 [806.16, 1,238.20] | 1,147.75 [1,147.12, 1,377.45] | 1,023.26 [992.43, 1,502.87] |

The data does not establish a memory improvement or a strict no-regression guarantee: candidate RSS medians are similar/lower, but individual candidate maxima reach ~1,471 / 1,503 MiB and exceed observed baseline maxima. Cold heapUsed also varies widely (tools: baseline 169–256 versus candidate 214–405 MiB; messages: baseline 345–744 versus candidate 331–513 MiB). GC timing, string/rope allocations and warm-read allocation lifetimes remain relevant. The 64-KiB limit bounds pending UTF-8 input, not total heap; this experiment changes no cache budget, retention/admission policy or heap setting. / 数据不能证明内存改善或严格无回退：候选 RSS 中位数相近／更低，但个别候选峰值达约 1,471／1,503 MiB，高于所观测基线峰值。Cold heapUsed 亦大幅波动（工具基线 169–256、候选 214–405 MiB；消息基线 345–744、候选 331–513 MiB）。GC 时机、字符串／rope 分配及热读分配存活期仍有影响。64 KiB 上限约束待提交 UTF-8 输入而非全部 heap；不修改缓存预算、保留／准入策略或 heap 设置。

### Validation and decision / 验证与决策

Keep this focused candidate for review: the exact-stream tests and unchanged workload counts support semantic equivalence, while controlled latency observations demonstrate the selected batching benefit in both shapes and Zstd. No further optimization is combined with it. Debt #22 remains open for large-Session first-read acceptance; no claim of responsive 50k first reading is made. / 保留此聚焦候选供评审：精确字节流测试及不变工作量支持语义等价，受控时延观测证明两种形状及 Zstd 中的 batching 收益。不混入其他优化。#22 保持开放以继续验收大会话首次阅读；不声称 50k 首次阅读已达到响应体验目标。

Validation before formal measurement: 181 focused shared-path tests; six exact-byte-stream tests including 65,535/65,536/65,537-byte tokens, oversized ASCII/Unicode, lone surrogates, empty text, binary chunks and exact 4,096-task plus final-zero chunk; independent read-only review with no concrete findings; `npm run build:check`; full `npm test` **1,110/1,110**; `git diff --check`; clean two-shape 100-record HTTP smoke at candidate SHA (66.57 / 82.48 ms). All 22 formal workers passed cold 0→1, Raw/Logical counts, intended nonempty reading, warm reuse and unchanged source identity. No browser code changed and no local browser suite was required. / 正式测量之前通过 181 项共享路径聚焦测试、六项精确流测试（含上述字节阈值、超大 ASCII／Unicode、孤立 surrogate、空文本、二进制块、恰好 4,096 task 及末尾零余量 chunk）、无具体问题的独立只读复查、构建检查、完整 **1,110／1,110** Node 测试、diff 检查及 candidate clean-tree 两形状 100-record HTTP smoke（66.57／82.48 ms）。全部 22 个正式 worker 通过冷态 0→1、Raw／Logical 数、正确且非空阅读、热读复用及来源身份未变。不改浏览器代码，无需本地浏览器套件。

New raw aggregate JSON and the local sequential runner are retained under main-checkout ignored `tmp/hash-batching-comparison/`; per-arm filenames include `10k`, `50k-{1,2,3}`, `50k-zstd`, and `50k-counters`. The earlier `tmp/cold-attribution/` and `tmp/fingerprint-attribution/` evidence was preserved with SHA-256 verification during old-worktree cleanup. Generated fixtures are still removed by each worker. Only this compact evidence is committed, not raw aggregates or temporary runners. / 新原始聚合 JSON 与本地顺序 runner 保留在主 checkout 的 ignored 目录，按侧保存上述文件；旧两组证据在清理 worktree 时以 SHA-256 核验后保留。生成 fixture 仍由各 worker 清理；仅提交紧凑证据，不提交原始聚合数据或临时 runner。
