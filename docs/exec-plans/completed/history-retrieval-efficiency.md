# History retrieval efficiency and real-history evaluation / 历史检索效率与真实历史评估

Status: completed, 2026-09-23. / 状态：已完成，2026-09-23。

## Objective / 目标

Reduce avoidable retrieval payload while retaining evidence identity, scope and continuation; evaluate development-history questions on frozen local history and compare raw, structured, summary and hybrid workflows. / 减少可避免的检索载荷，同时保留证据身份、范围和续读；在冻结本地历史上评估开发过程问题，对照原始检索、结构化检索、摘要及混合工作流。

The previous synthetic pilot measured response payloads of 6,686 / 10,612 o200k_base tokens for the single T06 task, versus 1,881 tokens for its complete source file. These are payload counts, not billable usage. / 上一轮合成试跑单题 T06 返回载荷为 6,686 / 10,612 个 o200k_base token，对应完整来源文件为 1,881 个；这是载荷计数，不是计费用量。

## Contract / 契约

- Preserve default full responses. Add opt-in compact presentation, context-bound short handles, durable evidence export on read, shared events within a context batch, and context-bound coverage reuse. / 保留默认完整响应；增加可选紧凑呈现、上下文绑定短句柄、精读持久证据导出、批量上下文共享事件及绑定上下文的覆盖信息复用。
- Add bounded full-session context and a readable detail projection; never silently erase an omitted range, distinct event or unsupported detail renderer. / 增加有界完整会话上下文及可读详情投影；不悄悄丢弃省略范围、不同事件或未支持的详情 renderer。
- Freeze explicit source files before independent evaluation. Keep raw private transcripts and answer keys in ignored local tmp; publish only safe aggregates and methodological limits. / 独立评估前冻结明确选定来源文件；真实转录和答案保留于本地忽略 tmp，只公开安全聚合及方法限制。
- Separate exact tool payloads, tokenizer estimates and provider/harness usage; missing usage remains unknown. Summary generation is a separate phase and is included when accounting for the workflow. / 区分精确工具载荷、tokenizer 估计与 provider/harness 用量；缺失用量保持未知；摘要生成作为独立阶段计入工作流。

## Work and checks / 工作与检查

1. Implement service and CLI projections with source/handle expiry, budget and traversal tests. / 实现服务和 CLI 投影，测试来源／句柄失效、预算和遍历。
2. Add condition-isolated recording, aggregation and explicit frozen-corpus manifests. / 增加按条件隔离的记录、聚合及明确冻结语料清单。
3. Prepare answer-blind real-history tasks and private evidence keys; run matched bounded trials and retain failures. / 准备不含答案的真实历史任务及私有证据键，执行预算一致的试跑并保留失败。
4. Independently review with Astra; repair and repeat review. Check package contents and restart owned demo service. / 使用独立 Astra 审查，修复后复审；检查安装包并重启本任务服务。

## Completion evidence / 完成证据

Implementation and documentation are complete. Opt-in compact responses, context-bound handles with durable export, shared event bodies, coverage reuse, bounded full-session context and readable detail projection retain default compatibility. / 实现及文档已完成：可选紧凑响应、上下文绑定句柄与持久引用导出、共享事件正文、覆盖信息复用、有界完整会话和可读详情投影，保留默认兼容性。

Validation: full Node suite 1,274/1,274 before final evaluation-harness repairs; final focused runtime/transport/package/eval tests 59/59; installed-package Codex/Claude/DeepSeek UI and history smoke passed. Python skill validation was unavailable locally; Node frontmatter/scaffold checks passed. Browser sources/assets were unchanged and the full interaction suite was not rerun. / 验证：最终评估工具修正前完整 Node 套件 1,274/1,274；最终运行时／传输／打包／评估聚焦测试 59/59；安装包三个来源 UI 与 history smoke 通过。本地 Python skill 校验不可用，Node frontmatter／基本结构检查通过。浏览器源码／资产未改，未重跑完整交互套件。

Independent Astra review found and repaired detail stream/title loss, invisible eval-output truncation, and final-log symlink containment (including dangling links). Repeated scoped review and aggregate-report review returned no further actionable findings. / 独立 Astra 审查发现并修复详情流／标题丢失、评估输出截断不可见、最终日志符号链接边界（含悬空链接）；反复聚焦复审及聚合报告审查均无剩余可执行问题。

The [real-history report](../../evals/history-retrieval/2026-09-23-real-history.md) records two named models × four conditions × two questions, plus one fresh hybrid follow-up. Four unchanged local real Sessions total 17,979,541 bytes; private sources/keys/reports remain ignored. Corpus hash: 03904b830b6508652f68615253d9fe9566075fddada0c09313bc0f6d5998977f. Older interrupted trials and first-round budget violations are retained. / [真实历史报告](../../evals/history-retrieval/2026-09-23-real-history.md)记录两个明确模型 × 四种条件 × 两题，以及一次全新混合复测。冻结四个真实会话共 17,979,541 字节；私有来源／证据键／报告保持忽略，hash 如上。早期中断及首轮超预算均保留。

Fixed-path compact payloads fell 31%/46%, but actual structured trials did not demonstrate lower end-to-end cost than raw search. Both first-round hybrid workers reported an outdated unmerged state; the revised chronology guidance plus enforced budget follow-up recovered the later merge using raw fallback. This is one successful follow-up, not causal proof or a native memory-product benchmark. Provider/harness usage remains unavailable. The full 96-trial matrix and production-scale recall remain future evaluation, not completion claims for this increment. / 固定路径紧凑载荷减少 31%／46%，但实际结构化试跑未证明端到端成本低于原始搜索。首轮两个混合 worker 都错误报告较早未合并状态；更新时序指南并强制预算后的复测通过原始回退找回后续合并。仅一次成功复测，不是因果证明或原生记忆产品基准。Provider/harness usage 仍不可得；完整 96 次矩阵及生产规模召回仍是后续评估，不计作本轮完成声明。

Owned synthetic demo service was restarted on port 17891 with the completed runtime; the frozen real evaluation service remains on port 17894. No UI project switch, publication or merge was performed. / 本任务合成演示服务已在 17891 端口使用完成实现重启，冻结真实评估服务保留于 17894；未切换 UI 项目、发布或合并。
