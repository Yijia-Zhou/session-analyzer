# DeepSeek cold first-read attribution / DeepSeek 冷态首次阅读归因

Base / 基线: `cc55ffde4cc253e2a5d7904e9cc45e66bec1d20c`.

Diagnostic only: preserve one real HTTP cold Detail, accepted snapshots, admission, cancellation and read-only sources. Cold means absent Materialized Session, not cold OS caches. / 仅诊断：保留一次真实 HTTP 冷 Detail、accepted snapshot、准入、取消及来源只读。冷态指无 Materialized Session，不指 OS 缓存冷态。

1. Add scoped DeepSeek source-read/reconstruction phases and a narrow Detail builder injection, with behavior-neutral tests. / 增加 DeepSeek 来源读取／重建阶段及最小 Detail builder 注入，并验证行为中立。
2. Extend the HTTP profiler with hierarchical accounting and contrasting tool/message fixtures; validate 100-record smoke matrix. / 扩展 HTTP profiler 的层级核算及工具／消息对照 fixture；验证 100 记录 smoke 矩阵。
3. Run focused tests, build check and full Node suite, then quiet sequential 10k/50k profiles and repeated 50k cases. / 执行聚焦测试、构建检查及完整 Node 测试，再顺序执行安静的 10k／50k 量测与 50k 复测。
4. Document aggregate evidence, update debt #22 without closing it, review and push a focused PR without merging. / 记录聚合证据，更新但不关闭债务 #22，审查并推送聚焦 PR，不合并。

No optimization, latency gate, OS cache flushing, forced GC, browser change or public API change. / 不优化、不设时延门槛、不清 OS 缓存、不强制 GC、不修改浏览器或公共 API。
