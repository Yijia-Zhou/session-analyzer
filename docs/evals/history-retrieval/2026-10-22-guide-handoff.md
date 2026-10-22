# Guide and reader handoff pilot, 2026-10-21–22 / 指南与阅读交接试跑

**Four fresh trials recovered the required decision evidence and delivered actual reader URLs with both the old and layered guides.** Neither layered-guide worker produced the `open maxBytes` error observed once in each old-guide trial; these single observations do not establish a stable improvement. / **四次全新试跑中，旧指南与分层指南均恢复了所需决策依据，并实际交付阅读 URL。** 两名分层指南 worker 未出现旧组各一次的 `open maxBytes` 错误，但单次观察不能证明稳定改善。

## Setup and limits / 设置与限制

This supplement follows the [ten-trial decision pilot](2026-10-21-decision-workflow.md). Four new independent workers compared D03 (late correction in a long event) and D07 (original decision and evidence handoff), using the same original question, frozen candidate runtime, selected corpus and environment within each task pair. The prospective guide protocol froze at `2026-10-21T15:35:24.292Z`; execution and review crossed October 21–22 in Asia/Shanghai. These UTC and local dates describe different boundaries. Old archives and results remain unchanged. / 本补充承接[十次决策试跑](2026-10-21-decision-workflow.md)。四个全新独立 worker 对比 D03（长事件中的较晚修正）和 D07（原始决策及依据交接），每道题内保持原题、冻结候选运行时、精选语料及环境一致。指南协议于上述 UTC 时间冻结；执行与复核跨上海时区的 10 月 21–22 日。旧归档与结果保持原样。

Both conditions allowed **16 retrieval calls, including failures, and 24,000 forwarded bytes per call**. This prospective budget adds room after the earlier twelve-call saturation; it is not a measured optimum. The earlier twelve-call trials are separate conditions. Guide reads were setup calls, limited to five distinct available guide files, with repeated reads and their bytes counted separately. All running command sessions were polled before the next call. No failed trial was replaced. / 两条件均允许 **16 次 retrieval 调用，包含失败，每次最多转发 24,000 字节**。这是针对前轮十二次调用饱和而前瞻增加的余量，并非量测出的最优预算；前轮属于不同条件。指南读取列为 setup，最多五个不同可用文件，重复读取及其字节另计。运行中的命令均在下一次调用前完成轮询；没有替换失败试验。

D03 used scaffold revision 1: both workers initially repeated the endpoint already supplied by the wrapper and received an error. Before D07 started, both conditions received the same revision 2 clarification that the wrapper supplies `--endpoint`; frozen guides, wrapper and runtime stayed unchanged. The two task pairs therefore have different scaffold identities. The common harness supplied no `open` workaround. A separate pretrial calibration fixed log newline parsing and verified two consecutive guide reads plus a status call; it is not a model trial. / D03 使用包装说明第一版，两组首次均重复传入 wrapper 已提供的 endpoint 而报错。D07 启动前，两组共同收到第二版说明，明确 wrapper 已提供 `--endpoint`；冻结指南、wrapper 和运行时未改。两道题具有不同包装说明身份。共同 harness 没有提示 `open` 解法。独立预检修正日志换行解析并核验连续两次指南读取及一次 status，不计模型试验。

Runtime fingerprint is `5204594d0e79aab99414b576c9928e481fe53ba4681f1af9fc6dcd0c066f21f4`; corpus hash is `fa4161fab574affc0d247994a81565547f219d3e4f018f4de87f6fcb9d8f95a6`. Seven real artifacts form five canonical Sessions, with both questions from one selected work episode. Coverage remains incomplete, with one `CODEX_CURRENT_ROLLOUT_UNAVAILABLE` and one `CODEX_HISTORY_HEAD_INFERRED` caused by isolated corpus metadata. This is not representative recall testing. All actual questions, evidence, URLs, captures and screenshots remain private. / 运行时指纹与语料哈希如上。七份真实工件形成五个规范会话，两题来自同一精选工作片段。来源范围仍不完整，隔离语料元数据产生上述两项诊断，不能据此测试代表性召回。真实题目、依据、URL、捕获及截图全部保留私有。

Workers were requested as `gpt-6.1-sol`, high effort, in fresh contexts without gold or other answers. Actual provider configuration and usage remain null. Concurrent work prevents controlled latency claims. / worker 请求为 `gpt-6.1-sol`、high effort，采用全新上下文，不接触答案或其他回答。实际 provider 配置及用量保持 null；并发工作不能支持受控时延结论。

## Observed outcomes / 观察结果

Content completeness, supported judgment, delivered entry and actual UI verification are separate axes. Qualified unknown later state is not a false assertion. / 内容完整、判断有据、入口交付及实际 UI 核验分别评价；对后续状态保留未知不等于错误断言。

| Task / 题 | Guide / 指南 | Content and judgment / 内容与判断 | Retrieval calls; failed / 调用；失败 | Delivered entries / 已交付入口 | UI scope / UI 范围 |
| --- | --- | --- | --- | --- | --- |
| D03 | Old + addendum / 旧＋补充 | Required evidence complete; supported / 所需依据完整；有据 | 16; 2 | Failure + late correction URLs / 失败＋较晚修正 URL | Both targets, visible support after internal scrolling, same-event continuation / 两目标、内部滚动后支撑可见、同事件续读 |
| D03 | Layered / 分层 | Required evidence complete; supported / 所需依据完整；有据 | 15; 1 | Failure + late correction URLs / 失败＋较晚修正 URL | Same scope; distinct correction offset checked / 同范围；修正的不同 offset 单独核验 |
| D07 | Old + addendum / 旧＋补充 | Required evidence complete; supported, later state bounded / 所需依据完整；有据，后续状态有界 | 16; 4 | Discussion URL; implementation durable refs / 讨论 URL；实现持久引用 | Discussion support initially visible, same-event continuation checked; implementation UI not assessed / 讨论支撑初始可见、同事件续读核验；实现 UI 未评估 |
| D07 | Layered / 分层 | Required evidence complete; supported, later state bounded / 所需依据完整；有据，后续状态有界 | 16; 3 | Discussion URL; implementation durable refs / 讨论 URL；实现持久引用 | Discussion support initially visible, same-event continuation checked; implementation UI not assessed / 讨论支撑初始可见、同事件续读核验；实现 UI 未评估 |

Both old-guide workers recovered from an unsupported `open` budget option and returned a successful URL within budget. Both layered-guide workers read the browser reference and did not produce that error. Other failures remained: the shared D03 endpoint ambiguity, and D07 context/budget/option errors. Search choices and evidence trajectories also differed; this guide-package comparison does not isolate a causal effect of splitting files. / 两个旧指南 worker 均从不支持的 `open` 预算参数错误恢复，并在预算内返回有效 URL。两个分层指南 worker 均读取 browser 参考，未出现该错误。其他错误仍存在：D03 共同 endpoint 歧义，以及 D07 的 context／预算／参数错误。检索选择与依据路径也不同，不能将本指南包对照归因于拆分文件本身。

## Actual guide forwarding / 实际指南转发

| Trial / 试跑 | Full entrypoint bytes / 完整入口字节 | Other assets actually opened / 实际打开的其他文件 | Setup reads / 读取次数 | Total guide bytes / 指南总字节 |
| --- | --- | --- | --- | --- |
| D03 old / 旧 | 19,146 | `aroundHit` addendum / 补充：1,275 | 2 | 20,421 |
| D03 layered / 分层 | 10,813 | `reading.md`: 8,613; `browser-handoff.md`: 3,657 | 3 | 23,083 |
| D07 old / 旧 | 19,146 | `aroundHit` addendum / 补充：1,275 | 2 | 20,421 |
| D07 layered / 分层 | 10,813 | `reading.md`: 8,613; `browser-handoff.md`: 3,657 | 3 | 23,083 |

Every opened asset was recorder-forwarded without truncation or repeat, with exact captured/forwarded SHA-256 and byte equality. Workers reported full visibility and retained/polled their tool outputs; the outer tool-to-model receipt was not independently captured. This proves recorder forwarding, not independently verified full model consumption. The layered package additionally made `search.md` (4,943 bytes) and `source-locators.md` (2,738 bytes) available; neither was opened. “Full entrypoint” does not mean “full package exposed.” / 已打开文件均无截断、无重复，记录器捕获与转发的 SHA-256 及字节数完全相同。worker 自报完整可见并保留、轮询工具输出，但没有独立捕获外层工具到模型的接收工件。因此只能证明记录器转发，不能独立证明模型全部消费。分层包还提供 `search.md`（4,943 字节）及 `source-locators.md`（2,738 字节），均未打开。“入口完整”不表示“整个包已暴露”。

Recorded retrieval stdout was 120,657 / 141,566 bytes for D03 old/layered and 109,351 / 151,396 bytes for D07 old/layered, with no recorder truncation. Different query/read choices explain different payloads; fewer errors did not imply fewer forwarded bytes. / D03 旧／分层的 retrieval stdout 分别为 120,657／141,566 字节，D07 为 109,351／151,396 字节，记录器均无截断。查询／读取选择不同会产生不同载荷，错误更少不表示转发字节更少。

The layered entrypoint is smaller, but each layered worker received **2,662 more cumulative guide bytes** after references. Setup exclusion from retrieval limits does not erase reading cost. These are UTF-8 bytes, not tokens, memory, cache, cost or latency measurements. / 分层入口较小，但加入按需参考后，每个分层 worker 累计收到的指南反而 **多 2,662 字节**。setup 不占 retrieval 次数并不消除阅读成本；这些是 UTF-8 字节，不是 token、记忆、缓存、费用或时延量测。

## Reader experience and remaining gaps / 阅读体验与剩余缺口

D03 produced four delivered-entry mappings to three unique URLs; the shared failure URL contributes one UI observation, not two independent successes. All three original targets and their same-event continuation were checked. The supporting failure and late correction required scrolling the internal code output, then screenshot review. Opening the URL did **not** initially align the visible supporting span. `aroundHit` changes agent text-read positioning; this trial shows no change to Web internal scrolling or rendering. / D03 四条交付映射对应三个唯一 URL；共享失败入口只算一次 UI 观察，不算两个独立成功样本。三个原始目标及其同事件续读均已核验。失败及较晚修正的支撑内容需要内部代码输出滚动，再经截图复核；打开 URL **并非** 初始就对准可见支撑片段。`aroundHit` 改变 agent 文本读取位置，本试跑没有表明 Web 内部滚动或渲染改变。

The two distinct D07 discussion URLs reached the same original message. At the reviewed 1280×720 desktop size, the key rule and reliable/unknown-position table were initially visible without manual expansion or scrolling; neighboring proposal/acceptance messages were not all initially visible. Clicking Continue retained the event, and actual downward scrolling reached the acceptance and implementation promise. / D07 两条不同讨论 URL 到达同一原始消息。在核验的 1280×720 桌面尺寸，关键规则和可靠／未知位置表格初始可见，无需手动展开或滚动；相邻提议／同意并非全部初始可见。点击续读保留该事件，实际向下滚动后可读同意及实施承诺。

D07 discussion URLs and implementation references are separate deliverables. A readable discussion entry cannot establish that implementation evidence was also delivered as a one-click reader URL. Unknown later integration/release state and incomplete source coverage remain explicit. Isolated original services and their viewer retain the original URLs; they are local snapshot dependencies, not published links or a restart of the user's main service. / D07 讨论 URL 与实现引用是不同交付物。讨论入口可读，不能据此称实现依据也已交付一键阅读 URL。后续集成／发布状态未知及来源范围不完整继续保留。原隔离服务及 viewer 保留原 URL，它们依赖本地快照，不是公开链接，也没有重启用户主服务。

Final integrity review rehashed 16 frozen protocol/guide/helper files, two derived D07 briefs, seven corpus files and sixteen candidate archive files: 41 checks, zero mismatches. The separate twelve-call results remain intact. The next useful improvement is calibrated guidance for recovering from context/output-budget failures and clearer visible positioning inside long Web outputs; this selected four-trial pilot does not establish general robustness or efficiency gains. / 最终完整性复核重新计算 16 份冻结协议／指南／助手文件、两份派生 D07 brief、七份语料及十六份候选归档文件：共 41 项，无差异。独立十二次预算结果保持原样。下一步可围绕 context／输出预算错误恢复与 Web 长输出中的可见定位校准操作；四次精选试跑不能证明普遍稳健性或效率收益。
