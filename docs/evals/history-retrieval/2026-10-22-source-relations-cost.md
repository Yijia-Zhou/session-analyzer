# Source observation, relations and server cost / 来源观察、关系及服务端成本

This bounded follow-up verifies operational contracts and measures server work. It does **not** contain new independent agent trials: the coordinator deferred them based on retained worker errors without a fresh availability check. Agent judgment, actual guide exposure, visible browser handoff and model usage remain unassessed/null. Synthetic regression success does not establish better project memory, token savings or stable agent benefit. / 本次有界后续核验操作契约并量测服务端工作，**不包含新独立 agent 试跑**：协调者依据保留的 worker 错误推迟试跑，未重新核验当时可用性。Agent 判断、实际指南暴露、浏览器可见交付及模型用量保持未评估／null。合成回归成功不证明更好的项目记忆、token 节省或稳定 agent 收益。

Availability correction on 2026-10-22: a newly spawned minimal worker returned `SUBAGENT_STARTUP_OK`; `followup_task` to the formerly failed `assess_snapshot_readiness` returned `SUBAGENT_RECOVERY_OK`, and its listed state became completed while an unresumed worker retained the old error. No configuration or account was changed. Retained agent errors were incorrectly treated as current quota checks. The original service-side rejection cause remains unknown; the exposed message does not identify the quota category or request trace. These two diagnostics establish minimal startup/recovery availability, not task effectiveness or an account-balance audit. / 2026-10-22 可用性更正：全新最小 worker 返回 `SUBAGENT_STARTUP_OK`；通过 `followup_task` 恢复原失败的 `assess_snapshot_readiness` 后返回 `SUBAGENT_RECOVERY_OK`，其列表状态变为 completed，而未恢复的 worker 仍保留旧错误。期间未修改配置或账户。此前错误地把保留的 agent 失败状态当成当前额度检查。最初服务端拒绝的原因仍未知，暴露的消息未提供额度类别或请求追踪。这两次诊断只证明最小启动／恢复可用，不是任务效果验证或账户余额核验。

## Four acceptance scenarios / 四项验收场景

| Scenario / 场景 | Reference and deterministic result / 参考依据与确定性结果 | Agent verdict / Agent 判定 |
| --- | --- | --- |
| Caller appends while another session changes a decision / 调用方追加期间另一会话改变决定 | An initial automatic-retry decision remains readable in the old snapshot; an explicit new service reads the later user-retry restriction. Further caller appends do not change either snapshot. Existing HTTP tests separately preserve old refs/cursors/viewer URL. / 初始自动重试决定在旧快照仍可读；显式新服务读到后续用户主动重试限制；调用方继续追加不改变两个快照。既有 HTTP 测试另行核验旧引用／游标／查看 URL 保持。 | Not run / 未运行 |
| Observation cannot establish current coverage / 观察不能证明最新覆盖 | Existing file-budget, incomplete-baseline and unresolved-caller cases preserve partial/unknown distinctions. A rewrite still fails strict evidence reading. / 既有文件预算、不完整基线及未确认调用方场景保留部分／未知区别；改写后精读仍严格失败。 | Not run / 未运行 |
| Child implementation leads to parent constraints / 子级实施引出父级约束 | A recorded parent ref reaches the exact-count requirement and rejected alternative through full and compact context, then read. Rewriting the parent makes the followed ref fail. / 已记录父引用通过完整／紧凑 context 再 read 抵达精确计数要求及被拒方案；改写父来源后沿引用读取失败。 | Not run / 未运行 |
| Related evidence is unavailable / 关联依据不可达 | Before repair, missing/out-of-project/empty-Main targets disappeared from context. The additive `unavailableRelatedSessions` reports the recorded ID, distinct reason and recovery without fabricating a ref. Ordinary absence and inferred review parents stay distinct. / 修复前，缺失／范围外／无 Main 目标从 context 消失；新增列表报告已记录 ID、不同原因及恢复方法，不编造引用。普通无关系与推断 review 父关系保持区分。 | Not run / 未运行 |

The public fixtures are minimized synthetic data in [relation tests](../../../test/history-relations.test.js) and [observation tests](../../../test/history-source-observation.test.js). Four initial relation tests failed against the pre-repair runtime, then passed after the repair; subsequent tests also cover inferred-parent exclusion and the two-snapshot decision scenario. These are coordinator-driven contract checks, not blind development-task attempts. Before independent acceptance, freeze real task prompts/reference evidence and current runtime/guide assets under the [decision workflow protocol](decision-workflow.md); record every forwarded guide and response, then verify the worker's actual evidence links separately. / 公开 fixture 为[关系测试](../../../test/history-relations.test.js)及[观察测试](../../../test/history-source-observation.test.js)中的最小合成数据。初始四项关系测试在修复前运行时失败、修复后通过；后续另覆盖推断父关系排除及双快照决定场景。这些是协调者驱动的契约检查，不是盲测开发任务。独立验收前，应按[决策流程协议](decision-workflow.md)冻结真实任务问题／参考依据及当前运行时／指南资产，记录逐次转发指南与响应，再单独核对 worker 实际交付的证据链接。

## Frozen real-corpus costs / 冻结真实语料成本

Runtime: committed `8e52436`, archived before the relation edit. Windows, Node `v24.18.1`; seven unchanged real artifacts, 37,769,656 bytes, five canonical sessions, corpus hash `fa4161fab574affc0d247994a81565547f219d3e4f018f4de87f6fcb9d8f95a6`. Hashes were verified before and after measurement. This reuses the earlier private pilot corpus, not a new holdout. Coverage retains `CODEX_CURRENT_ROLLOUT_UNAVAILABLE` and `CODEX_HISTORY_HEAD_INFERRED` diagnostics. Raw data, source paths, frozen runtime and measurement helpers remain in ignored `tmp/bc-acceptance-20261022-ZRJ5T1/`. / 运行时为关系修改前归档的已提交 `8e52436`。环境如上，七份未修改真实工件共 37,769,656 字节、五个规范会话；量测前后均验证 hash。复用此前私有试跑语料，不是新留出集；覆盖仍有上述两类诊断。真实数据、来源路径、冻结运行时及量测辅助脚本保留在所列私有忽略目录。

Calls use the service directly in one process, sequentially across an initial construction and an explicit rebuild with the same inputs; elapsed time excludes CLI/HTTP/model overhead. OS caches were not flushed, and this is a shared development machine, not an isolated latency benchmark. A small focused regression run overlapped part of sampling. First/repeated read labels describe call order, not a guaranteed cold/warm cache. / 顺序在同一进程直接调用服务，包含初始构建及同输入的显式重建；耗时不含 CLI／HTTP／模型开销。未清空 OS 缓存，环境为共享开发机器，不是隔离时延基准；一小组聚焦回归与部分采样重叠。首次／重复精读描述调用顺序，不保证冷／暖缓存。

| Operation / 操作 | Observations / 观察值 | Serialized response bytes / 序列化响应字节 |
| --- | --- | --- |
| Startup / 启动 | 5.37 s | Status recorded separately / 单独记录 status |
| Explicit rebuild / 显式重建 | 5.20 s | Status recorded separately / 单独记录 status |
| Observe, six calls / 六次观察 | 1.05–2.25 ms | 3,316 each / 每次 |
| First search page, two calls / 两次首搜索页 | 9.32–9.83 s | 3,410 each / 每次 |
| Second search page, two calls / 两次次搜索页 | 9.21–9.54 s | 4,082 each / 每次 |
| Two grouped queries, two calls / 两次双组查询 | 18.87–19.53 s | 7,275 each / 每次 |
| First projection read, two calls / 两次首次投影读取 | 3.41–3.73 s | 5,361 each / 每次 |
| Repeated projection read, two calls / 两次重复投影读取 | 3.33–3.56 s | 5,361 each / 每次 |

The literal queries are `source` and `compressed`, with two candidates per group; the broad terms intentionally expose repeated work, not task-selection quality. No real-corpus files were appended or rewritten in this sample. Rebuild time therefore measures construction cost, not successful recovery of newly added evidence. / 字面查询为 `source` 与 `compressed`，每组两个候选；宽词有意用于暴露重复工作，不评估任务选词质量。此样本未追加／改写真实语料，重建耗时量测构建成本，不表示已找回新追加依据。

## Work attribution / 工作量归因

### Larger live-source sample / 较大活动来源样本

The same archived runtime also constructed two services sequentially against the active local Codex source, scoped to this repository. Startup took **379,999.82 ms** and the explicit rebuild **362,141.91 ms**; each indexed **1,095 project sessions**, with zero reported diagnostics and `sourceCoverage:configured_scope_only`. Six observations took **219.19–231.56 ms**. The first baseline sampled 1,410 physical artifacts, including one admitted dependency sampled after indexing; the first three reports each observed two size increases. After rebuild, three reports observed two increases plus one new candidate, sampling 1,411 artifacts. No caller identity was asserted, so none of this growth was attributed to the active agent by guessing. / 同一归档运行时还面向本地活动 Codex 来源，按本仓库范围顺序构建两次服务。启动 **379,999.82 ms**，显式重建 **362,141.91 ms**；各索引 **1,095 个项目会话**，报告诊断为零、覆盖为 `configured_scope_only`。六次观察耗时 **219.19–231.56 ms**。首基线采样 1,410 份物理工件，含一份索引后采样的准入依赖；前三份报告均观察到两个文件增大。重建后三份报告观察到两个增大及一个新候选，采样 1,411 份工件。未声明调用方身份，因此没有靠猜测把增长归因于当前 agent。

All six observations reported complete work within their metadata scope, with no omission gaps; this does not certify content, project membership of new candidates or current historical coverage. The new candidate is not counted as a new project session. Response sizes were 4,668 bytes before rebuild and 5,193 afterward. The live corpus was not frozen and continued changing; startup/rebuild are individual cost samples, not a controlled speedup comparison or a new-content correctness evaluation. The focused test run overlapped startup. No original transcript was modified, no pre-existing service was restarted, and both measurement services were closed afterward. / 六次观察均报告在其 metadata 范围内完成工作且无省略缺口；这不证明内容、新候选项目归属或历史覆盖最新。新候选没有被换算为新增项目会话。重建前后响应分别为 4,668 与 5,193 字节。活动语料未冻结并持续变化；启动／重建是独立成本样本，不是受控提速对比，也不是新增内容正确性评估。聚焦测试与启动部分重叠。未修改原始转录、未重启任何已有服务，两个量测服务随后均已关闭。

### Frozen-corpus scan profile / 冻结语料扫描剖析

A separate diagnostic run wraps query-shard scans, decoded projection iteration, query-store `readSync` calls and adapter materialization without editing the archived runtime. The wrappers add overhead; these elapsed values are diagnostic observations, not a controlled before/after comparison. Read bytes are application requests to the query store, not physical disk IO. Materialization includes source verification and reconstruction; its internal stages were not separately timed. / 独立诊断轮在不编辑归档运行时的前提下包装查询分片扫描、解码投影迭代、查询存储 `readSync` 及 adapter 物化。包装存在开销，耗时用于诊断，不是受控前后对比。读取字节是应用对查询存储的请求，不是物理磁盘 IO；物化包含来源核验与重建，内部阶段尚未拆分计时。

| Diagnostic operation / 诊断操作 | Shard scans / 分片扫描 | Visited rows / 访问行 | Query-store requested bytes / 查询存储请求字节 | Materializations / 物化 | Total / 总时长 | Materialization / 物化时长 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First page / 首页 | 15 | 15,386 | 41,079,907 | 5 | 9.65 s | 6.38 s |
| Second page / 次页 | 15 | 15,386 | 41,183,167 | 5 | 9.38 s | 6.12 s |
| Include-artifacts control / 包含工件对照 | 15 | 15,386 | 41,079,907 | 5 | 9.36 s | 6.21 s |
| Two groups / 双组 | 30 | 30,772 | 82,179,095 | 10 | 19.58 s | 12.68 s |
| First read / 首次精读 | 0 | 0 | 0 | 1 | 3.32 s | 3.32 s |
| Repeated read / 重复精读 | 0 | 0 | 0 | 1 | 3.50 s | 3.50 s |

The first search reports `scannedEvents:3014`, yet actual shard visits total 15,386 rows; decoded projection iteration consumes 31,101,581 UTF-8 bytes. Its query-store read calls take about 61 ms, while scans including matching take 3.26 s. All five materializations arise from retrieval-artifact suspicion, although final recognized artifacts are zero for this query. `include` still performs recognition to retain classification/count semantics. The second page repeats nearly all work; grouping repeats both scans and materialization. / 首次搜索报告 `scannedEvents:3014`，实际分片访问合计 15,386 行，解码投影迭代消费 31,101,581 个 UTF-8 字节。查询存储读取调用约 61 ms，含匹配的扫描共 3.26 s。五次物化均由疑似检索工件触发，但此查询最终识别工件数为零。`include` 仍执行识别以保留分类／计数语义。次页基本重做全部工作，分组同时重复扫描与物化。

This supports investigating avoidable classification/materialization work before choosing shared disk reads as the first optimization. It does not justify disabling strict evidence verification, caching stale events, changing counts or widening source admission. No performance implementation is included in this follow-up. / 这些结果支持优先调查可避免的分类／物化工作，再决定共享底层读取是否应先实现；不支持关闭严格依据核验、缓存过期事件、改变计数或扩大来源准入。本次后续不包含性能实现。

## Validation boundary / 验证边界

Current focused validation passed **103 tests** across relations, source observation, service, transport, presentation, open, evidence navigation and package contracts. The skill validator, 55 local links across six changed documents and `git diff --check` passed. Full Node/browser suites and installed-package smoke were not rerun for this narrow follow-up. The committed baseline's [CI #267](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/39765428406) is green, including Node/browser/package checks; it predates the relation change. The independent ordinary-navigation focus race remains open. / 本轮关系、来源观察、服务、传输、呈现、open、依据导航及打包契约共 **103 项聚焦测试通过**。Skill 校验、六份变更文档中的 55 个本地链接及 `git diff --check` 通过。本次窄范围后续未重跑全量 Node／browser 或安装包 smoke。已提交基线的 [CI #267](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/39765428406)全绿，包含 Node／browser／打包检查，但早于关系修改。普通导航的独立焦点竞态仍开放。

Later agent acceptance is recorded in the [B/C current-version report](2026-10-22-bc-agent-acceptance.md), under a protocol frozen at `2026-10-22T12:34:05.788Z`. That later round contains four fresh real-history workers and separate text/browser assessments. The no-agent-trial statements and “Not run” cells above describe this earlier measurement round and are intentionally retained; subsequent agent results do not retroactively change these cost samples or establish a before/after benefit. / 后续 agent 验收记录于 [B／C 当前版本报告](2026-10-22-bc-agent-acceptance.md)，协议于上述 UTC 时间冻结。后轮包含四名全新真实历史 worker，以及独立的文本／浏览器评分。上文未进行 agent 试跑的说明和“未运行”单元格描述此前量测阶段，特意保留；后续 agent 结果不回写这些成本样本，也不证明前后收益。
