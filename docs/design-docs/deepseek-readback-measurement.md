# DeepSeek HTTP readback measurement / DeepSeek HTTP 回读量测

This records repeatable synthetic HTTP measurements: the original warm/full-artifact readback evidence for debt item 20, followed by a separate cold first-materialization attribution for item 22. Neither is an optimization or a universal latency acceptance threshold. / 本文记录可复现的合成 HTTP 量测：先保留债务第 20 项的热态／全工件回读证据，再单独记录第 22 项的冷态首次物化归因。二者均不包含优化，也不设定通用时延验收阈值。

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

The content-free collector timestamps start/end events with `performance.now()`, balances a stack, aggregates repeated names within their parent, and retains duration-only metadata separately without assuming interval placement or adding it to coverage. It reports malformed events after the request rather than throwing into admission. Checks require finite nonnegative times, monotonic timestamps, balanced nesting, sibling nonoverlap, parent containment, and exactly one occurrence of every expected major phase in order. HTTP subtraction allows only 1e-7 ms floating-point tolerance; uncovered materialization setup/returns must be at most max(5 ms, 5% of materialization), an accounting coverage check rather than a latency target. Full unrounded residuals remain in JSON. / 不含内容的收集器使用 `performance.now()` 给 start／end 打时间戳，以栈核验平衡、在父阶段内聚合同名重复调用，并单独保留 duration-only 元数据，不推断其区间或计入覆盖量。异常事件在请求后报告，不向准入流程抛错。检查要求时间有限且非负、时间戳单调、嵌套平衡、兄弟不重叠、子阶段不越界、预期主要阶段按序各出现一次。HTTP 相减仅允许 1e-7 ms 浮点容差；未覆盖物化准备／返回时间上限为 max(5 ms, 物化的 5%)，这是核算覆盖检查，不是时延目标。JSON 保留完整未舍入 residual。

The existing observer is inert without a scope and swallows callback failures. A small private reconstruction extraction permits one scoped boundary without changing parser branches. `createServer({ buildEventDetail })` is a test/profile-only dependency injection with the normal builder as default: no CLI/API field, log, diagnostic, DTO, lifecycle/admission, cancellation or browser contract changes. After inspecting `indexed-materialized-session-lifecycle.md`, no generic profiling architecture or lifecycle contract update is needed. / 既有 observer 无作用域时直接执行原操作，回调失败被吞掉。小型私有 reconstruction 提取仅用于放置一个作用域边界，不修改 parser 分支。`createServer({ buildEventDetail })` 仅为测试／量测依赖注入，默认仍为普通 builder；不增加 CLI／API 字段、日志、诊断或 DTO，不改变生命周期／准入、取消或浏览器契约。审阅 `indexed-materialized-session-lifecycle.md` 后确认，无需修改通用 profiling 架构或生命周期契约。

### Matrix results / 矩阵结果

Completed (UTC): smoke 2026-09-11T02:29:45.234Z; formal 2026-09-11T02:32:57.965Z; repeats 2026-09-11T02:36:21.758Z, 2026-09-11T02:39:02.130Z. All reports identify implementation SHA `a87b75c6641c76e8339de356dfd693c96545e1f2`. / 完成时间（UTC）：smoke 2026-09-11T02:29:45.234Z；正式 2026-09-11T02:32:57.965Z；复测 2026-09-11T02:36:21.758Z、2026-09-11T02:39:02.130Z。全部报告标识实现 SHA `a87b75c6641c76e8339de356dfd693c96545e1f2`。

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

Scaling supports that attribution across both shapes. Increasing data records from 10k to 50k increases uncompressed bytes by about 5.03–5.04×; materialization grows 4.92–5.43× and the fingerprint total 4.94–5.45× across the four shape/encoding combinations. At 50k, messages have twice as many Logical events (50k versus 25k), the same Raw count (50,001), and about 15.2% fewer serialized bytes, yet materialize about 26–31% slower in the formal run. This is consistent with sensitivity to canonical object-graph/event shape rather than storage bytes alone; it does not establish a per-event coefficient or isolate object count from graph topology/text. / 两种形状的规模变化支持该归因。数据记录由 10k 增至 50k，未压缩字节约增至 5.03–5.04 倍；四种形状／编码组合中，物化增至 4.92–5.43 倍，fingerprint 总量增至 4.94–5.45 倍。在 50k 下，消息形状 Logical 事件为两倍（50k 对 25k）、Raw 数相同（50,001），序列化字节却少约 15.2%，正式轮次的物化仍慢约 26–31%。这与 canonical 对象图／事件形状敏感性一致，不能仅由存储字节解释；但尚未建立逐事件系数，也未隔离对象数、图结构及文本的影响。

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
