# DeepSeek cold first-read attribution / DeepSeek 冷态首次阅读归因

Base / 基线: `cc55ffde4cc253e2a5d7904e9cc45e66bec1d20c`.

Diagnostic only: preserve one real HTTP cold Detail, accepted snapshots, admission, cancellation and read-only sources. Cold means absent Materialized Session, not cold OS caches. / 仅诊断：保留一次真实 HTTP 冷 Detail、accepted snapshot、准入、取消及来源只读。冷态指无 Materialized Session，不指 OS 缓存冷态。

1. Add scoped DeepSeek source-read/reconstruction phases and a narrow Detail builder injection, with behavior-neutral tests. / 增加 DeepSeek 来源读取／重建阶段及最小 Detail builder 注入，并验证行为中立。
2. Extend the HTTP profiler with hierarchical accounting and contrasting tool/message fixtures; validate 100-record smoke matrix. / 扩展 HTTP profiler 的层级核算及工具／消息对照 fixture；验证 100 记录 smoke 矩阵。
3. Run focused tests, build check and full Node suite, then quiet sequential 10k/50k profiles and repeated 50k cases. / 执行聚焦测试、构建检查及完整 Node 测试，再顺序执行安静的 10k／50k 量测与 50k 复测。
4. Document aggregate evidence, update debt #22 without closing it, review and push a focused PR without merging. / 记录聚合证据，更新但不关闭债务 #22，审查并推送聚焦 PR，不合并。

No optimization, latency gate, OS cache flushing, forced GC, browser change or public API change. / 不优化、不设时延门槛、不清 OS 缓存、不强制 GC、不修改浏览器或公共 API。

Completed / 已完成：

- Instrumentation capture: `a87b75c6641c76e8339de356dfd693c96545e1f2`; final diagnostic assertion/metadata follow-up: `bf7922332c239bfc503b8724c863d1d0dbd11710`. / 插桩捕获与最终诊断补强提交如左。
- Both 100-record shapes/encodings passed; 10k/50k formal matrix plus two additional 50k repetitions completed sequentially (16 formal/repeat cases). All retained one materialization and unchanged source identity. / 两种形状／编码的 100 记录 smoke 通过；顺序完成 10k／50k 正式矩阵及两次额外 50k 复测（16 组），均保持一次物化与来源身份未变。
- Shared fingerprint capture/recheck dominates across shapes. Debt #22 remains profiled; optimization decision pending. No optimization shipped. / 两种形状均由共享 fingerprint capture／recheck 主导；#22 保持已归因、优化决策待定；未交付优化。
- Final build check, 1,098 Node tests, focused tests and final HTTP smoke passed. The initial missing worktree-local dependency license was resolved with locked dependency installation. / 最终构建检查、1,098 项 Node 测试、聚焦测试及 HTTP smoke 均通过；初次缺少 worktree 本地依赖许可文件的问题已通过锁定依赖安装解决。
- Durable evidence and limitations: `docs/design-docs/deepseek-readback-measurement.md`. Existing lifecycle design requires no change for scoped observation and test/profile dependency injection; no public behavior or documentation contract changed. / 持久证据与限制见该量测文档；作用域观测与测试／量测依赖注入不要求修改既有生命周期设计；未改变公共行为或文档契约。
