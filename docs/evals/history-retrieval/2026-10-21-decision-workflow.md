# Development decision pilot, 2026-10-21 / 真实开发决策试跑

**Ten independent worker trials were completed: six frozen-baseline tasks and raw/candidate comparisons on two long-event tasks.** The baseline exposes incomplete recovery and failed human handoff, so neither implementation tests nor this selected pilot justify token, memory or general-recall benefit claims. / **已完成十次独立 worker 试验：六项冻结基线任务，以及两项长事件任务的原始来源／候选对照。** 基线暴露依据恢复不完整及向人交接失败；实现测试与本次精选试跑均不能证明 token、记忆或普遍召回收益。

## Frozen setup and limits / 冻结设置与限制

The baseline runtime was archived from `80674e4ec37daa9e5842b9600016785883f7cdd9` before runtime edits. Question preparation overlapped implementation; each question was locked before its worker started. Six selected questions cover two weak-clue cases (D01/D02), two long-event cases (D03/D04), an explicitly superseding decision (D05), and human evidence handoff (D07). D06/D08 were retained as prepared, unrun reserves before the paired-task outcomes were known, to reduce overlapping questions. This tests supersession across continuation artifacts, not exhaustive parent/child agent-graph reasoning. / 运行时代码修改前，从该 commit 归档基线；题目准备与实现并行，各题在对应 worker 启动前锁定。六题覆盖两个弱线索案例、两个长事件案例、一个明确取代旧提议的决策及向人交接原始依据。为减少重复，在配对题结果已知前将 D06/D08 保留为已准备但未运行的备用题。本次验证跨续接工件的决策取代，不等于穷尽父子 agent 图推理。

Seven byte-identical real source artifacts (37,769,656 bytes) form five canonical Sessions, with several questions sharing one historical work episode. This is a selected three-family corpus, not a representative project sample. Corpus SHA-256 is `fa4161fab574affc0d247994a81565547f219d3e4f018f4de87f6fcb9d8f95a6`. Physical originals, questions, reference key, exact captures, answers and review artifacts remain private in ignored local storage. / 七份逐字节一致的真实来源工件，共 37,769,656 字节，形成五个规范会话；多道题共用同一段历史工作。本语料来自精选的三个工作主题，不能代表项目分布。语料 SHA-256 如上。物理原件、题目、参考答案、精确捕获、回答及审查工件保留于本地忽略的私有存储。

Both services completed indexing with five Sessions and reported incomplete source coverage: one `CODEX_CURRENT_ROLLOUT_UNAVAILABLE` and one `CODEX_HISTORY_HEAD_INFERRED`. These diagnostics arise from the selected isolated corpus without live-writer current-rollout metadata; they do not establish a general live-project defect. Supporting canonical events were found despite rejection of a nonprimary historical file's direct path/line locator. `UNKNOWN_SOURCE` alone therefore did not become an evidence-absence score. / 两个服务均完成索引，得到五个会话，并报告来源范围不完整及上述两项诊断。这来自选定隔离语料缺少实时 writer 的 current-rollout 元数据，不能据此声称在线项目普遍存在缺陷。尽管非主历史文件的直接路径／行 locator 被拒绝，支撑规范事件仍可找到；没有仅凭 `UNKNOWN_SOURCE` 判定依据缺失。

Workers were independently requested as `gpt-6.1-sol`, high effort, with fresh contexts and no reference key, other answers or current checkout access. Actual provider model/effort and input/output/cache/reasoning/cost usage were not independently available and remain null. Each trial allows twelve retrieval-phase calls, including status and failed invocations, and at most 24,000 recorder-forwarded bytes **per call**. Setup is recorded separately. Concurrent tests and workers preclude controlled latency comparisons. / 各 worker 独立请求使用 `gpt-6.1-sol`、high effort，采用全新上下文，不接触答案、其他回答或当前源码。实际 provider 模型／effort 及输入／输出／缓存／推理／费用用量无法独立取得，保持 null。每次试验允许十二次 retrieval 阶段调用，包含 status 与失败调用，每次最多转发 **24,000 字节**；setup 单独记录。测试与 worker 并发运行，不能作受控时延比较。

The baseline guide is exactly 19,146 bytes, SHA-256 `0382e6ecc150354974b105f33ff163787291499d67aacc0004e3e5e6a57aadc4`. All reviewed setup captures forwarded the complete guide and workers confirmed full visibility. Candidate workers received this same guide plus a separately recorded 1,275-byte `aroundHit` addendum, SHA-256 `aba41bb07504d2ba538b399a6f9af05add410df6d404d4d1dc5b77522a9a293e`. This is an **API-plus-instruction** intervention. The newly layered skill and later wording clarifications were not exposed and have no measured effectiveness result here. / 基线指南的精确字节数与 SHA-256 如上。已审查 setup 均完整转发，worker 确认全部可见。候选条件使用同一指南，加上单独记录的 1,275 字节 `aroundHit` 补充说明；这是 **API 与指令组合干预**。新分层 skill 及其后续措辞澄清未暴露给试验，本次没有它们的效果量测。

D01 discarded the execution-session metadata for its first search and did not consume that output; a subsequent call encountered the still-live trial lock. This error is retained. Later trials share the clarified instruction to poll running sessions before another call. A coordinator-only pretrial smoke also caught and corrected an unsupported CLI flag in an unexposed candidate addendum; the invalid version remains archived and is not a model trial. / D01 首次搜索丢弃执行 session 元数据，未消费该输出，随后调用撞到仍活跃的试验锁；错误保留。后续试验共用明确的顺序轮询说明。协调者在候选试验前的 smoke 还发现并修正了未暴露补充说明中的不支持 CLI 参数；旧版归档，不算作模型试验。

## Baseline observations / 基线观察

“Supported judgment” evaluates claims actually made; it does not imply complete recovery. A correctly qualified unknown remains distinct from a false assertion. “Entry delivered” below means the worker returned the requested verified reader URL, separate from durable-reference addressability. / “判断有据”只评价实际作出的主张，不表示依据全部找齐；正确保留未知不等于错误断言。下表“已交付入口”指 worker 返回了所要求的已验证阅读 URL，与持久引用可解析性分开。

| Task / 题 | Family / 类别 | Required content / 所需内容 | Judgment / 判断 | Entry delivered / 已交付入口 | Actual UI review / 实际 UI 核验 |
| --- | --- | --- | --- | --- | --- |
| D01 | Weak clues / 弱线索 | Partial / 部分 | Limited claims supported / 限定主张有据 | No / 无 | Unassessed / 未评估 |
| D02 | Weak clues / 弱线索 | Complete / 完整 | Supported / 有据 | No; invalid open arguments / 无；open 参数错误 | Unassessed / 未评估 |
| D03 | Long event / 长事件 | Failure recovered; repair missing / 找到失败，缺修正 | Limited claims supported / 限定主张有据 | Yes / 有 | Supporting original failure visibly readable; continued reading preserved target / 原始失败可见可读，续读保留目标 |
| D04 | Long event / 长事件 | Complete / 完整 | Supported / 有据 | Yes / 有 | Target and continuation checked; exact supporting span visibility inconclusive / 已查目标及续读，具体支撑片段可见性未定 |
| D05 | Superseding decision / 取代旧提议 | Complete / 完整 | Supported / 有据 | No; invalid open arguments / 无；open 参数错误 | Unassessed / 未评估 |
| D07 | Human handoff / 向人交接 | Complete / 完整 | Supported / 有据 | No; invalid open arguments / 无；open 参数错误 | Unassessed / 未评估 |

D03's verified handoff supports the earlier original failure the worker recovered. It does not fill its missing repair evidence or make the whole task complete. Alternative original evidence was accepted when it supported the same claim, rather than requiring the private key's exact record. / D03 已核验交接支持其找回的较早原始失败，不补足缺失修正依据，也不使整题完成。支持同一主张的其他原始来源同样接受，不强制引用私有答案的指定记录。

## Selected long-event comparisons / 精选长事件对照

These are independent workers on the same task, frozen corpus, requested model, environment and call/byte budgets. Raw controls receive the same frozen guide plus an explicit raw-only restriction, use ordinary literal search and JSON parsing, and supply physical file/one-based record citations as valid original provenance. UI handoff is unavailable in that condition and remains unassessed, rather than failed for lacking an `er2` or viewer URL. This is a workflow control, not a native-product comparison. / 下列 worker 独立运行，题目、冻结语料、请求模型、环境及调用／字节预算一致。原始来源对照获得同一冻结指南及明确的仅限原始来源指令，使用普通字面检索与 JSON 解析，物理文件及从一开始的记录行号是有效原始溯源；该条件不提供 UI 交接能力，不因缺少 `er2` 或查看页 URL 判为失败。这是流程对照，不是原生产品比较。

| Task / 题 | Condition / 条件 | Content / 内容 | Calls / 调用 | Failed calls / 失败调用 | Observed reading / 实际阅读方式 |
| --- | --- | --- | ---: | ---: | --- |
| D03 | Baseline / 基线 | Partial / 部分 | 12 | 0 | One absolute-offset read / 一次绝对偏移读取 |
| D03 | Raw / 原始来源 | Complete / 完整 | 12 | 0 | Parsed original records and long-output tails / 解析原记录及长输出尾部 |
| D03 | Candidate / 候选 | Complete / 完整 | 12 | 1 | Two successful `aroundHit` reads / 两次成功命中附近读取 |
| D04 | Baseline / 基线 | Complete / 完整 | 12 | 3 | Three absolute-offset attempts / 三次绝对偏移尝试 |
| D04 | Raw / 原始来源 | Complete / 完整 | 12 | 2 | Parsed original diagnostic fields / 解析原始诊断字段 |
| D04 | Candidate / 候选 | Complete / 完整 | 12 | 3 | Two successful `aroundHit` reads and one absolute-offset attempt / 两次成功命中附近读取及一次绝对偏移尝试 |

The D03 candidate found the repair where its baseline did not, but it also chose a different successful literal query. D04's baseline already recovered the core evidence. These observations show the new operation was usable; they do not isolate a causal improvement from API, instruction or stochastic search choices. Both candidate workers exhausted their calls without delivering an `open` URL; durable supporting refs were retained, but a coordinator-created link would not retroactively pass worker handoff. / D03 候选找到了基线未找齐的修正依据，但成功的字面查询也不同；D04 基线已找回核心依据。这说明新操作可用，不能从 API、指令及随机检索选择中隔离因果提升。两名候选 worker 均耗尽调用而未交付 `open` URL；持久引用仍保留，协调者事后创建链接不能倒算 worker 交接通过。

## Failure layers and next evidence / 失败层与后续依据

Private assessments use the [explicit layer protocol](decision-workflow.md): included, found, displayed, read/continued, judgment and human handoff, with false verdicts separate from null/unassessed. Incomplete recovery was not relabeled wrong judgment. Invalid context/open arguments, insufficient response budgets, raw-parser mistakes, truncation and the D01 execution-lock error remain in the traces. Some worker caveats mistakenly treated 24,000 bytes as an aggregate cap; assessment uses the actual per-call contract and preserved caveat. Missing URLs under a saturated budget do not by themselves identify an API defect. / 私有评分按[显式分层协议](decision-workflow.md)分别记录包含、找到、展示、阅读／续读、判断及向人交接，失败与 null／未评估分开。未找齐依据不改写为判断错误。错误 context/open 参数、响应预算不足、原始解析错误、截断及 D01 执行锁错误均保留。部分 worker 将 24,000 字节误解为总上限；评分按实际逐次上限并保留原误解。预算耗尽下缺少 URL 本身不能定位为 API 缺陷。

Priority follow-ups are to measure whether the new layered guide reduces operation-specific argument mistakes and improves human handoff within a calibrated budget, then add independent work episodes and genuine parent/child reasoning. Hold task/model/environment fixed for comparable follow-ups. The three older saturated state scenarios remain fixed regressions. No actual model-token, total-cost or memory-benefit result follows from this pilot or passing implementation tests. / 后续优先量测新分层指南能否减少操作专属参数错误，并在经校准预算内改善向人交接，再加入独立历史任务及真正父子推理。可比较复测保持题目／模型／环境一致。旧三项已饱和状态题仍作为固定回归。本试跑与实现测试通过均不能推出实际模型 token、总费用或记忆收益。

Byte-level integrity checks found zero mismatches across all seven corpus artifacts, 626 archived baseline source files and sixteen candidate changed/new files, with every remaining candidate file matching the archive. Candidate source fingerprint: `5204594d0e79aab99414b576c9928e481fe53ba4681f1af9fc6dcd0c066f21f4`. All reviewed recorder deliveries complied with the per-call cap. Services were not restarted during paired trials; local viewer URLs depend on those services remaining alive, while durable refs and startup identities are retained privately for reopening. / 字节核验中，七份语料、626 个归档基线源码文件及十六个候选修改／新增文件均无差异，其余候选文件与归档一致。候选源码指纹如上。已审查记录器转发均遵守逐次上限。配对试验中未重启服务；本地查看 URL 依赖服务存活，持久引用及启动身份私下保留以便重开。
