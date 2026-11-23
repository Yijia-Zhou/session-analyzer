# Round 1 closeout supplement / 第一轮收尾补充

This supplement records the bounded review of the [formal comparison](2026-11-15-round1-comparison.md). The frozen manifest and runtimes identify the original comparison. The three follow-up repairs have a separate [synthetic validation record](2026-11-18-round1-repair-validation.md). / 本补充记录[正式对照](2026-11-15-round1-comparison.md)的有界复核。原对照以冻结 manifest 和运行时为准。三处后续修复另有[合成验证记录](2026-11-18-round1-repair-validation.md)。

## Disposition / 处置

The candidate supported 57/70 assessable primary fact instances, below the frozen 90% completeness threshold. The established `fail` does not come under the [at-most-one supplementary round clause](../../exec-plans/active/2026-11-13-history-retrieval-next-rounds.md#bundle-comparison-exit-clause--整包对照出口条款) for insufficient evidence. Ordinary reads keep `content`, `auto` remains opt-in, and `compact` remains the default under its separate deterministic acceptance. Slot 40's usage remains unknown. / 候选支持 57/70 个可评估主要事实实例，低于冻结的 90% 完整度门槛。已确定的 `fail` 不适用证据不足时的[最多一轮补充评估条款](../../exec-plans/active/2026-11-13-history-retrieval-next-rounds.md#bundle-comparison-exit-clause--整包对照出口条款)。普通读取保持 `content`，`auto` 仍须显式选择，`compact` 按独立的确定性验收保持默认。第 40 项 usage 仍未知。

## Omission diagnosis / 遗漏诊断

The original audit of the 42 omissions recorded in the scores found sufficient delivered evidence for 30 and left 12 undetermined. Those original classifications remain recorded. The bounded review found sufficient delivered evidence for 11 of the 12 undetermined cases. The combined diagnosis therefore has **41 with sufficient delivered evidence and 1 still unknown**. The unresolved case is D01's earlier implementation proof. / 原审计在原评分记录的 42 个遗漏实例中确认 30 项有充分交付依据，12 项未定。原分类予以保留。有界复核在 12 个未定项中确认了 11 项的充分交付依据。因此合并后的新诊断为 **41 项有充分交付依据，1 项仍未知**。未决的是 D01 的较早实现证明。

The review covered 27 distinct fact/trial instances across the 12 originally undetermined cases and 16 instances of three recurring omissions in D01 and N02. The two sets share one instance. The 15 cases confirmed as delivered in the recurring-omission set are already among the original 30. The denominator contains only previously scored omissions. It supports neither a retrieval recall estimate nor a conclusion that every scoring clause was necessary to answer the task. Scoring-key fit was examined separately from answer coverage. Explicit condition labels were hidden where practical, and some conditions remained recognizable from the records. / 复核覆盖 12 个原未定项与 D01、N02 三个高频遗漏事实的 16 个实例，扣除 1 个重合项，共 27 个事实／试验实例。高频遗漏组中确认交付的 15 项已包含在原来的 30 项中。分母仅含原评分中的遗漏实例，不能据此估计检索召回率，也不能确认每个评分子句都是回答题目的必需内容。评分键与题干的对应关系和答案覆盖分别考察。工作副本尽量隐藏显式条件标签，部分条件仍可从记录识别。

The review distinguished missing external originals for N04 from the attributed statements and limitations that can be checked in the frozen material. For D02, one recorded projection span could not be independently pinned down. The delivery judgment uses a locatable delivered prefix and another delivered test output from the same trial. The original span remains unverified. / 复核区分 N04 缺失的外部原件及冻结材料可核对的归属陈述和限制。D02 有一处原 projection 范围未能独立精确定位。交付判断依据同一试验内可定位的已交付前缀和另一笔已交付测试输出。旧定位仍未核验。

## Service lifetime and outer tool time / 服务存活期与外层工具耗时

The aligned records show normal cleanup for all 40 structured trials. They record no 600-second timer termination before worker exit and no tool call spanning or starting after the recorded service exit. The audit observed no request obstruction from service shutdown in this batch. Nominal expiry comes from the start event and configured duration. The audit aligns the recorded service exit, tool recorder start and gate response timestamps in UTC. Some worker lifecycle records have matching preserved copies and corroborating worker results, without independently recorded historical hashes. / 40 次结构化试验的对齐记录均显示正常清理，均未记录 worker 结束前因 600 秒计时器触发而终止。没有工具调用跨越记录中的服务退出时点，也没有退出后发起的调用。本批审计未观察到服务停止阻碍请求。名义到期取启动事件和配置时长。审计在 UTC 时间基准下对齐服务退出、工具 recorder 调用开始及门禁响应的时间戳。部分 worker 生命周期日志有相符的保全副本和 worker 结果佐证，没有单独记录的历史哈希。

The breakdown retained 1,421 outer invocations, including failures and refusals, across four primary and two regression cells. All 40 trial totals reconcile to `sumToolElapsedMs`. The longest invocation in every trial was `search` (25 first searches, 15 later searches, maximum 59.118 s). Seventeen longest calls had outer output truncation. The elapsed times cover outer calls, including any gate work or waiting within the measured interval. The records do not separate internal service processing, transfer, audit and model waiting. / 分解按四个主要条件格和两个回归条件格保留 1,421 笔外层调用，含失败和拒绝调用。40 次逐试验合计均与 `sumToolElapsedMs` 对齐。每次最长调用均为 `search`（25 次首次搜索、15 次后续搜索，最大 59.118 秒）。其中 17 笔最长调用发生外层输出截断。计时覆盖外层调用及该区间内实际经过的门禁工作或等待。记录无法拆开服务内部处理、传输、审计和模型等待。

The later product fixes address two continuation boundaries. Whether either occurred in the formal trials remains unknown. The evaluation-gate fix addresses requests after a service exits, a path absent from the 40 structured trials. The repairs and their synthetic tests do not change the earlier observations, scores or timing. / 后续产品修复处理两处续读边界。它们是否在正式试验中触发仍未知。评估门禁修复处理服务退出后的请求，40 次结构化试验没有这类调用。修复及合成测试不改变先前观察、评分或耗时。

## Recorded UI limitation / 已记录的 UI 局限

The owner accepts the incomplete viewport evidence for D07-current-B as a recorded limitation and closes the request for further captures. Prior observations confirmed target identity and continued reading. The entry's full claimed scope remains partially verified. The original trial UI annotations remain `null`. / 负责人对 D07-current-B 的视口证据不完整作出“接受局限”的决定，该项不再补拍。既有观察确认了目标身份及续读，入口声明的完整范围仍为部分核验。原始试验 UI 标注保持 `null`。

- Frozen manifest / 冻结 manifest SHA-256: `6934f93d15d25afea1b2d713d251b44317c0d3667c9f82d8aae17f370f0a3336`
- Reviewed rollup / 原评分汇总 SHA-256: `e03acfa8a374c4f593359e4028ed456dfc9547608fc619ed3f66eda4bc4eacd0`
- Collector index / 收集器索引 SHA-256: `b6ac7c0866b11de48635d8fef57329aca83b2fc191f59cf0e9f9cb438af3b9bd`
- Recorded UI supplement / 既有 UI 补充记录 SHA-256: `538b2b6b750ea262b35500ae8e9a7d9667ba01d2a50bb520bf6b6c0022439576`
