# Post-batching fingerprint attribution / 批量写入后的 fingerprint 归因

## Scope / 范围

Measure before optimizing. Perform read-only real DeepSeek corpus acceptance, then CPU sampling and separate workload accounting for both 50k plain synthetic shapes. Select exactly one next direction: byte-buffer/string work, task traversal, mutation-guard architecture, or stop #22 optimization and move to the next debt. Do not implement an optimization or #20 in this task. / 先测量再决定优化。先对真实 DeepSeek 语料做只读验收，再对两种 50k plain 合成形状做 CPU 采样及独立工作量核算。最终仅选一个方向：byte-buffer／string、task traversal、mutation-guard architecture，或停止 #22 优化并转向下一债务。本任务不实现优化或 #20。

## Baseline / 基线

Merged main is `73f759fd112429313fb49da7a03971a961c972c7`. Local checkout is clean `2cd0f2ffcde57799b0ad7b600cae64cc1964ca6b`; both have tree `52e67baf5dbc91808768d5df603c7dce13935e48`, verified through the GitHub Git Commit API and local Git. SSH and HTTPS Git fetch fail DNS resolution, so use this identical local tree and record both identities. / 合并 main 为上述 SHA；本地 clean checkout 与其 Git tree 完全一致，已通过 GitHub Git Commit API 及本地 Git 核验。SSH／HTTPS Git fetch 均因 DNS 解析失败，故使用相同本地源码树并记录两个提交身份。

## Method and acceptance / 方法与验收

- Inventory the user-designated sample roots read-only; distinguish historical real, lab and generated writer evidence, and include the largest artifacts and size/density variation. Record only anonymous aggregates, never transcript content, source paths or Session IDs. / 只读盘点用户指定的样本根，区分历史真实、lab 及生成 writer 证据，覆盖最大工件及尺寸／密度差异；只保存匿名汇总，不保存正文、来源路径或会话 ID。
- Use isolated workers, prewarm off, existing instrumentation and real HTTP first Detail. Verify materialization 0→1, intended project/source/root, indexing outcome, diagnostics, Raw/Logical counts, actual reading and unchanged source identity. Cold means no Materialized Session, not empty OS cache. / 使用隔离 worker，关闭 prewarm，以既有 instrumentation 测真实 HTTP 首次 Detail；核验物化 0→1、目标项目／来源／根、索引结果、诊断、Raw／Logical 数、实际阅读及来源身份未变。Cold 指无 Materialized Session，不指 OS cache 清空。
- Run performance workers sequentially. Keep detailed fingerprint telemetry off during CPU sampling; run it separately for accounting. Record first Detail, materialization, fingerprint phases and memory. / 性能 worker 串行执行；CPU 采样关闭详细 fingerprint telemetry，另跑独立核算；记录首次 Detail、物化、fingerprint 阶段和内存。
- Attribute weighted samples only within fingerprint stacks. Report native encoding/crypto and inlined allocation/descriptor attribution limits honestly; report unattributed GC separately. / 仅对 fingerprint 栈内样本按时间加权归因；明确 native 编码／crypto 及内联 allocation／descriptor 的可观测限制，将无法归属的 GC 单独报告。

## Progress / 进度

- [x] Verify post-batching source identity. / 核验 batching 后源码身份。
- [x] Real-corpus acceptance and slow-case repeats. / 真实语料验收及慢场景复测。
- [x] Two-shape CPU sampling and independent workload accounting. / 两形状 CPU 采样与独立工作量核算。
- [x] Record aggregate evidence, one decision, and tracker update. / 记录汇总证据、单一决策并更新 tracker。

## Outcome / 结果

[The report](../../design-docs/post-batching-fingerprint-attribution.md) records 19/19 primary sample acceptances, eight largest-artifact follow-ups (four repeats, two CPU captures, two counter captures), and 19/19 additional Detail→Raw correspondence checks after independent Luna review. Existing focused tests pass 19/19; top-level telemetry forwarding also passes a separate counter smoke. All source diagnostics are zero. / [报告](../../design-docs/post-batching-fingerprint-attribution.md)记录 19／19 份样本主验收、八次最大工件跟进（四次复测、两次 CPU、两次计数），以及 Luna 独立复查后额外 19／19 次 Detail→Raw 对应检查。既有聚焦测试通过 19／19，顶层 telemetry 转发另通过计数 smoke；全部来源诊断为零。

Historical largest-case first Detail medians are 2.46/2.32 seconds. The four synthetic workers retain 50,001 Raw Records and 25,000/50,000 Logical Events, seven fingerprint invocations and exact #57 workloads. Post-batching sampled Hash.update shares are 19.5/23.4%, not the historical 64–65%. / 历史最大场景首次 Detail 中位数为 2.46／2.32 秒。四个合成 worker 保留 50,001 条 Raw、25,000／50,000 个 Logical、七个 fingerprint 调用及 #57 精确工作量；batching 后采样的 Hash.update 占比为 19.5／23.4%，不再是历史 64–65%。

Single decision: accept and close tracker item #22 with a documented synthetic-extreme limitation and limited evidence coverage; no further optimization is currently planned, and the next performance investigation moves to #20. Reopen only if real-session evidence shows materially problematic cold first-read latency. This is a separate documentation closeout; it includes no #20 implementation, production optimization, architecture change, persistent-server change or public API change. / 单一决策：接受并关闭 tracker 第 #22 项，保留已记录的 synthetic extreme 限制及有限证据覆盖；目前不再继续优化，下次性能调查转向 #20。仅当后续真实会话证据显示具有实际影响的冷态首次阅读时延时重新打开本项。本次为独立文档收口，不包含 #20 实现、生产优化、架构修改、持久 server 修改或公开 API 变化。
