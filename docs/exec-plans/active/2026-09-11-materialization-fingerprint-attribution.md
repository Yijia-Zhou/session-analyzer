# Materialization fingerprint attribution / 物化 fingerprint 归因

Base: `400aa81e7a74ed14e5f02ceb966d148e91627916` (remote main fetched through HTTPS; SSH DNS unavailable). Branch: `perf/materialization-fingerprint-attribution`. / 基线为已通过 HTTPS fetch 核验的远端 main；SSH DNS 不可用，分支如上。

## Boundary / 边界

Second-level, diagnostic-only investigation of debt #22 and PR #54's shared async fingerprint hotspot. Preserve SHA-256 input bytes, traversal order/domain, identity state, descriptors, all seven invocations, 4,096-task yields plus final yield, cancellation and error precedence. No public option or production optimization. / 对债务 #22 与 PR #54 共享 async fingerprint 热点进行第二层纯诊断归因。保留 SHA-256 输入字节、遍历顺序／范围、identity state、descriptor、七次调用、每 4,096 task 及末尾 yield、取消与错误优先级。不增加公开选项，不实现生产优化。

## Steps and acceptance / 步骤与验收

- Add optional internal `onFingerprintProfile` completed-invocation summaries with fixed roles, task/object/property/token/byte counts and monotonic wall/yield accounting. Audit existing chunk consumers and leave their events unchanged. / 增加可选内部完整调用摘要，包含固定角色、task／对象／属性／token／字节计数与单调时钟墙钟／yield 核算；审查并保留既有 chunk 事件。
- Extend the existing HTTP profiler with an off/on detailed telemetry switch; preserve cold 0→1 materialization, deterministic nonempty Detail, expected Raw/Logical counts and unchanged source identity. / 扩展既有 HTTP profiler 的详细遥测开关，保留冷态物化 0→1、确定且非空 Detail、预期 Raw／Logical 数量与来源身份未变。
- Validate byte-stream equivalence, accounting, observer isolation, mutation guards, cancellation and another strict source; run focused tests, build check and full Node suite before measurements. / 验证字节流等价、核算、观测隔离、mutation guard、取消及另一个 strict 来源；测量前执行聚焦测试、构建检查和完整 Node 测试。
- Quiet sequential matrix: 10k/50k × tool/message plain, 50k message Zstd, two additional 50k plain observations per shape; off/on overhead comparison at 10k both shapes and 50k messages. CPU-sample 50k plain both shapes in the worker process. / 安静顺序矩阵：10k／50k × 工具／消息 plain、50k 消息 Zstd、每种 50k plain 额外两次复测；在 10k 两形状及 50k 消息比较开关开销，并对两种 50k plain worker 做 CPU 采样。
- Record exact implementation SHA, compact bilingual results/definitions/limits and one next optimization decision in the existing measurement report. Keep #22 open; push a focused PR without merging. / 在既有测量报告记录确切实现 SHA、紧凑双语结果／定义／限制及单一下一步优化决策。保持 #22 开放，推送聚焦 PR，不合并。

Raw JSON and CPU samples stay under ignored `tmp/fingerprint-attribution/`; generated fixtures are removed by the existing worker. / 原始 JSON 与 CPU 采样保留在 ignored 临时目录；生成 fixture 由既有 worker 清理。

## Progress / 进度

Implementation and focused validation in progress; measurements pending. / 实现与聚焦验证进行中，测量待执行。
