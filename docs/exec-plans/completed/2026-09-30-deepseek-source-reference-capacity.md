# DeepSeek source-reference capacity / DeepSeek 来源引用容量

- Status: completed / 状态：已完成
- Baseline: `ce2876d` on `feat/deepseek-latest-compatibility`; attempt-search correction is committed separately. / 基线：上述分支与 commit；attempt 搜索修复已独立提交。
- Authority: existing pinned format-4 codec contract and current adapter admission rules; this changes internal representation, not the upstream schema. / 依据：既有固定 format-4 codec 契约与 adapter 准入规则；本次改变内部表示，不改变上游 schema。

## Contract / 契约

Keep validated `sourceEventSeqs` in its encoded scalar/range representation instead of eagerly expanding ranges. Preserve scalar-only ordering, strict increasing order when any range is present, uniqueness, safe-integer and earlier-event constraints, exact Raw, format 0, and generation/ownership boundaries. Prune and compaction use exact set matching without range expansion. No new canonical DTO, arbitrary expansion cutoff, or inferred ownership. / 保留已校验的数字／区间编码，不急切展开区间。保持纯标量顺序、含区间时严格递增、唯一性、安全整数及先前事件约束、精确 Raw、format 0 与代际／归属边界。Prune 和 compaction 通过无需展开的精确集合匹配查询。不新增 canonical DTO、任意展开阈值或推断归属。

## Work and acceptance / 工作与验收

- [x] Add synthetic validation equivalence regressions before changing decoding, then extend consumer regressions. / 修改解码前添加合成校验等价回归，再扩展消费端回归。
- [x] Preserve compressed references and update both consumers. / 保留压缩引用并更新两个消费端。
- [x] Compare bounded, isolated, repeatable capacity samples against the baseline; separate decoder observations from accepted-log indexing/materialization/Detail. / 与基线比较有界、隔离、可重复容量样本；区分 decoder 与合法日志索引／物化／详情证据。
- [x] Run focused and full tests, build check, whitespace/reference checks; refresh original lab acceptance. / 执行聚焦及全套测试、构建、空白／引用检查，刷新原 lab 验收。
- [x] Review, update design/debt evidence and archive; commit independently from the search correction. / 复核，更新设计／债务证据并归档；与搜索修复独立提交。

The larger cross-platform/GC/cancellation stress matrix remains separate; timing observations are descriptive, not CI thresholds or production capacity promises. Fixtures and benchmark data are synthetic. / 更广的跨平台／GC／取消压力矩阵另行处理；耗时为描述性观察，不作为 CI 阈值或生产容量承诺。Fixture 与基准数据均为合成。

## Implementation / 实现

Only the storage decoder and two source-reference consumers change at runtime. Ranges are validated by endpoint order and cumulative cardinality; scalar-only lists retain ordering and a scalar uniqueness Set. `sourceEventSeqsMatch()` checks cardinality, expected uniqueness and membership using binary search for range-bearing lists, or a Set for scalar-only lists. It takes already validated references, not arbitrary physical input. Format-0 prune explicitly keeps the prior scalar-singleton rule; an added negative regression guards against admitting v4 range syntax there. Raw data/locators and shared DTOs are unchanged. / 运行时只改解码器与两个来源引用消费端；区间通过端点顺序与累计数量校验，纯标量保留原顺序与标量唯一性 Set。匹配函数核对数量、预期唯一性与成员，含区间时二分查询，纯标量使用 Set。输入必须是已校验引用，不接纳任意物理输入。Format 0 prune 明确保留原标量单项规则，并以负例防止错误接纳 v4 区间。Raw 数据／定位及共享 DTO 不变。

Storage tests compare 4,369 small encoded lists against the previous expansion algorithm as an independent admission oracle; boundary cases cover one million references and the safe-integer limit without proportional allocation. Consumer regressions cover mixed/gapped ranges, unordered scalars, same-cardinality mismatches, duplicate expected references, singleton versus containing-range prune, plain/Zstd Detail and exact Raw, and index/materialized query-digest parity. / 存储测试用旧展开算法作为独立准入对照，核验 4,369 个小规模编码列表；边界测试覆盖百万引用及安全整数上限，且不按覆盖项数分配。消费端回归覆盖混合／有间隙区间、乱序标量、同数量不同成员、预期重复项、单项与包含区间的 prune、普通／Zstd 详情与精确 Raw、索引／物化查询摘要一致性。

## Capacity evidence / 容量证据

Executed `node scripts/deepseek-reference-profile.js` before implementation at baseline `ce2876d`, then after compact decoding and consumer changes. Windows, Node `v24.18.1`, sequential fresh child processes, `--expose-gc --max-old-space-size=256`, three samples per case, 27 samples per implementation. Each phase begins after requested GC. The table reports medians, not pass/fail time limits. / 在基线执行脚本，然后在紧凑解码及消费端修改后执行；环境及参数如前，每类三次新进程样本，每个实现共 27 次，各阶段在请求 GC 后开始。表中为中位数，不设耗时通过阈值。

| Synthetic case / 合成场景 | Before / 优化前 | After / 优化后 |
| --- | --- | --- |
| Single range, 10,000 references, decode / 单区间一万引用解码 | 1.20 ms | 0.36 ms |
| Single range, 100,000 references, decode / 单区间十万引用解码 | 7.80 ms | 0.35 ms |
| Single range, 1,000,000 references, decode / 单区间百万引用解码 | 99.27 ms | 0.38 ms |
| Million-reference post-call heap delta / 百万引用调用后堆增量 | 51.61 MiB | 0.02 MiB |
| Million-reference retained encoded entries / 百万引用保留编码项数 | 1,000,000 | 1 |
| 10,000 unordered scalar entries, decode / 一万乱序标量解码 | 1.58 ms | 1.66 ms |
| 10,000 mixed scalar/range entries, decode / 一万混合编码项解码 | 2.70 ms | 1.62 ms |
| 4,000-prefix plain log, cold index / 四千前缀普通日志冷索引 | 441.11 ms | 170.61 ms |
| 4,000-prefix Zstd log, cold index / 四千前缀 Zstd 日志冷索引 | 487.37 ms | 250.66 ms |
| Same plain log, materialization / 同普通日志物化 | 1,702.57 ms | 1,425.97 ms |
| Same Zstd log, materialization / 同 Zstd 日志物化 | 1,772.32 ms | 1,375.01 ms |
| Same plain log, first / warm Detail / 同普通日志首次／暖详情 | 15.09 / 6.71 ms | 14.53 / 6.61 ms |
| Same Zstd log, first / warm Detail / 同 Zstd 日志首次／暖详情 | 53.41 / 42.52 ms | 57.72 / 44.26 ms |

Session samples use actual continuous seqs, unknown synthetic Protocol rows referencing prior prefixes, and a final compaction whose exact source set includes the prior rows/start/summary. They exercise normal admission, indexing, materialization and Detail; no direct decoder-only sample is presented as an accepted tiny Session. All Session samples assert successful compaction, counts parity, search, repeated Detail equality and exact replacement Raw. Zstd keeps the header in its own frame. / 会话样本使用实际连续序号、引用此前前缀的未知合成 Protocol 行，以及引用前序行／start／summary 精确集合的最终 compaction，经过正常准入、索引、物化与详情；不把直接 decoder 样本当作可接纳的微小 Session。会话样本断言 compaction 成功、计数一致、搜索、重复详情相等与 replacement Raw 精确。Zstd header 使用独立帧。

Heap figures are post-call deltas, not allocation peaks; script RSS high-water marks cover the child process, including startup/fixture preparation, not isolated phase peaks. Detail and scalar-only timings show no general speedup guarantee. Logs remain ignored: `tmp/dsh-reference-{before,after}.json`. The first benchmark draft was rejected for putting the Zstd header and body in one frame; corrected fixtures passed both implementations. An initial red-test large-array diff overwhelmed failure formatting; a length assertion made the expected pre-fix failure bounded before rerunning. / 堆数据为调用后增量而非分配峰值；RSS 高水位覆盖子进程启动／fixture 准备等，不是隔离阶段峰值。详情及纯标量耗时不支持普遍加速保证。日志保留于忽略目录。初版基准将 Zstd header／正文放入一帧，被正确拒绝；修正后两版均通过。最初红测试的大数组差异输出负担过大，增加长度断言使预期修复前失败有界后重跑。

## Validation and closeout / 验证与收尾

- Pre-fix focused storage regressions failed as expected; post-fix storage/format4/prune tests passed. / 修复前聚焦存储回归按预期失败；修复后存储／format4／prune 测试通过。
- `node --test test/deepseek-harness*.test.js test/session-query-store.test.js test/trajectory-presentation.test.js test/i18n.test.js`: **238/238 passed**. / 聚焦测试 238/238 通过。
- `npm test`: **1312/1312 passed**; `npm run build:check`: passed; `git diff --check` and changed-document references: passed. / 全套 1312/1312、构建、空白与变更文档引用检查通过。
- Original lab Analyzer restarted at `http://127.0.0.1:17890/`; intended workspace/source root, indexing succeeded, **23 Sessions / zero diagnostics**. Prior real rc.2 late reply passes Main, bilingual Detail, search and exact Raw; source hashes unchanged. / 原 lab Analyzer 已重启，目标工作区／来源根正确，索引成功、23 会话／零诊断；此前真实 rc.2 late reply 的 Main、双语详情、搜索与精确 Raw 通过，来源哈希未变。
- No new DSH writer run, browser rerun, installed-package smoke or GitHub CI claim. No browser/shared source or new runtime source file was added; generated assets remain current. / 未新增 DSH writer 实验、浏览器重跑、安装包 smoke 或 GitHub CI 通过声明；未修改 browser/shared 或新增运行时文件，生成资产保持最新。
- Review found no remaining blocking regression. Product behavior contracts are preserved, so no new product-spec behavior is introduced; design, development command and debt 30 are updated. / 复核未发现剩余阻塞回归；保持产品行为契约，不新增产品规格行为，已更新设计、开发命令与债务 30。

The broader capacity matrix in [debt 30](../tech-debt-tracker.md) remains open, including larger encoded scalar lists, total Session memory, platform comparisons, GC, event-loop and cancellation measurements. / 债务 30 的更广容量矩阵仍开放，包含更大编码标量列表、会话总内存、平台对比、GC、事件循环与取消量测。
