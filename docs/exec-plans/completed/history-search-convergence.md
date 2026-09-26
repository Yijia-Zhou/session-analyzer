# Search convergence and later-state resolution / 搜索收敛与后续状态核验

Status: complete, 2026-09-26; baseline `d589d56`. / 状态：已完成，2026-09-26；基线 `d589d56`。

## Goal and boundaries / 目标与边界

Reduce rediscovery: reach necessary evidence from precise clues, preserving uncertainty when later records may change the apparent state. Deliver three synthetic state scenarios, independent grouped search, and version-bound source-locator resolution. Do not change ranking, add semantic/vector retrieval, infer decision states, or introduce a MatchRef protocol. / 减少重复发现：从明确线索到达必要证据，在后续记录可能改变表面状态时保留不确定性。交付三个合成状态场景、独立分组搜索和绑定来源版本的定位解析。不改变排序、不增加语义／向量检索、不推断决策状态、不引入 MatchRef 协议。

## Contracts / 契约

- `search` accepts independent `groups` with stable IDs and per-group query, limit, byte budget and cursor. Existing single-search semantics remain unchanged. A whole-response byte limit also applies; unexecuted groups and scanned-but-unreturned results are explicit, never zero-hit claims. / `search` 接受带稳定 ID、各自查询／条数／字节预算／游标的独立 `groups`。单查询语义保持不变；整批另有字节限制，未执行组及已扫描未展示结果明确标记，不伪装成零命中。
- `read` accepts an indexed SourceRef or exact admitted source path plus a one-based physical JSONL line locator. Initial support is uncompressed Codex. Return Raw evidence and only existing explicit Logical Event associations. Versioned references fail on incompatible source changes; legacy path-only provenance stays unverified. / `read` 接受已索引 SourceRef 或准入来源精确路径，加从 1 开始的 JSONL 物理行定位。首版支持未压缩 Codex；返回 Raw 证据及已有明确逻辑事件关联。版本引用遇不兼容来源变化失效；仅旧路径的历史一致性保持未核验。
- State questions require bounded later-evidence checking, not a compulsory extra call if sufficient evidence is already available. Distinguish message timestamp, described-state time, reliable changes and unresolved claims. / 状态问题需要有界后续证据核验；已有充分证据时不强制额外调用。区分消息时间、所述状态时间、可靠变化和未决陈述。
- Freeze recorder/runtime/guide identities for trials. Count repeated events, match locations and excerpts separately; first-read and search/read ratios are diagnostics, not quality scores. Actual supported claims and later-state closure require evidence assessment. / 冻结试跑记录器／运行时／指南身份；分别统计重复事件、命中位置和摘录，首次 read 及 search/read 比率仅用于诊断，不充当质量分。主张支撑和后续状态闭环需要证据判断。

## Work and validation / 工作与验证

1. Freeze baseline runtime/guide; create synthetic cases and private trial outputs. / 冻结基线运行时／指南，建立合成场景和私有试跑输出。
2. Implement grouped search and locator read with deterministic boundary, budget, cursor, source-expiry and transport tests. / 实现分组搜索及定位读取，测试边界、预算、游标、来源失效和传输。
3. Run independent Sol/Luna baseline, skill-only and API follow-ups with fixed corpus/budgets; retain all failures, distinguish provided locators from discovery. / 使用固定语料／预算执行独立 Sol／Luna 基线、仅指南及 API 后续试跑，保留失败，区分已提供 locator 与自行发现。
4. Update bilingual spec/design/usage and package allowlist. Run focused tests, relevant full-suite/package gates, then independent Astra review/repair/re-review. Restart owned demo service. / 同步双语规格／设计／用法和打包清单，执行聚焦测试及相关全量／安装包验收，再独立 Astra 审查／修复／复审，重启本任务演示服务。

Full 96-trial evaluation and complete branch merge acceptance remain outside this increment. / 完整 96 次评估和整个分支合并验收仍不属于本轮增量。

## Final implementation evidence / 最终实现证据

Grouped search, source-locator reads, bilingual guidance and convergence instrumentation are implemented. Full Node 1,300/1,300 and three-source installed-package acceptance passed; final runtime/transport/source/metrics/package focused checks passed 66/66 after group-prevalidation repair, followed by 9/9 affected analytics tests for help classification and durable-reference aliases. Independent Astra reviews repaired empty-locator option validation, denied-read metrics, skipped-group semantic validation and offset-sensitive evidence alias metrics; final scoped reviews returned clean. / 分组搜索、来源定位读取、双语指南和收敛量测已实现。完整 Node 1,300/1,300 和三来源安装包验收通过；分组预校验修复后最终聚焦 66/66，之后 help 分类及持久引用别名统计的受影响套件 9/9。独立 Astra 修复空定位参数校验、拒绝 read 的量测、省略组语义校验及引用偏移变化的别名统计；最终聚焦复审通过。

Six complete-guide trials (two models × baseline, guide-only and API) all answered the three synthetic questions correctly; baseline already passed. Four earlier truncated-guide calibration attempts are preserved and excluded. API payloads were not lower than baseline. A separate Sol provided-locator probe completed in three calls and preserved provenance uncertainty. The [results](../../evals/history-state-resolution/2026-09-26-results.md) separate effectiveness, payloads, setup deviations, unavailable model usage and deterministic validation. / 六次完整指南试跑（两模型 × 基线、仅指南、API）均正确回答三个合成问题，基线已通过。四次更早指南截断校准保留并排除。API 载荷不低于基线。另一次 Sol 已提供定位试用以三次调用完成，并保留来源不确定性。[结果](../../evals/history-state-resolution/2026-09-26-results.md)区分效果、载荷、setup 偏差、不可得模型 usage 及确定性验证。

Owned synthetic demo port 17891 was restarted with the new runtime; port 17898 serves the five-session state corpus (complete index, no diagnostics). Browser UI state and generated assets are unchanged. Final report and analytics re-review found no remaining actionable issue; closeout checks are complete. / 本任务合成演示 17891 已用新运行时重启，17898 提供五会话状态语料（索引完成、零诊断）。浏览器 UI 状态及生成资产未改；最终报告及统计复审无剩余可执行问题，收尾检查完成。
