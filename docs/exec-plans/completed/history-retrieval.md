# History retrieval implementation / 历史检索实现

Started and completed 2026-09-23. Status: implementation and bounded MVP acceptance complete; full efficacy matrix remains future evaluation. / 于 2026-09-23 启动并完成。状态：实现及有界 MVP 验收完成；完整效果矩阵仍为后续评估。

## Context and scope / 背景与范围

Implement the read-only retrieval MVP in the isolated `tmp/worktrees/history-retrieval` checkout: fixed project/source service; status/search/context/read CLI and HTTP; verifiable references; bounded disclosure; conservative direct echo filtering; packaged agent guide; synthetic evaluation. Reuse source adapters and query projections. / 在独立 `tmp/worktrees/history-retrieval` checkout 实现只读检索 MVP：固定项目／来源服务；status/search/context/read CLI 及 HTTP；可核验证据引用；有界披露；保守直接回声过滤；随包 agent 指南；合成评估。复用来源 adapter 及查询投影。

Canonical behavior is in the [product spec](../../product-specs/history-retrieval.md), internal choices in the [design](../../design-docs/history-retrieval.md), commands in the [usage guide](../../usage/history-retrieval.md). / 规范行为见[产品规格](../../product-specs/history-retrieval.md)，内部取舍见[设计](../../design-docs/history-retrieval.md)，命令见[使用指南](../../usage/history-retrieval.md)。

## Invariants / 不变量

Do not alter canonical event identity, UI search semantics or active browser scope. Do not commit real transcripts. Source reads stay within admitted artifacts. Uncertain relationships remain uncertain. Legacy CLI startup and npm package contents are acceptance surfaces. English and Chinese docs stay synchronized. / 不改变规范事件身份、UI 搜索语义或活动浏览器范围。不提交真实转录。来源读取限于准入工件。不确定关系保留不确定性。旧 CLI 启动及 npm 包内容均纳入验收。中英文文档同步。

## Milestones / 里程碑

- [x] P0: Write scope, context-window semantics, identity and evaluation contracts. / 编写范围、窗口语义、身份与评估契约。
- [x] P1: Implement isolated service, status/search/read, scope/freshness checks and bounded output. / 实现隔离服务、status/search/read、范围／新鲜度核验及有界输出。
- [x] P2: Implement batch windows, internal gaps, outward navigation and content continuation. / 实现批量窗口、内部间隙、向外导航及内容续读。
- [x] P3: Implement conservative reversible echo policy, CLI compatibility and packaged skill. / 实现保守可逆回声策略、CLI 兼容性及随包 skill。
- [x] P4: Run focused deterministic and package checks, independent agent smoke tasks, repair introduced defects and record measured limits. / 运行聚焦确定性及安装包检查、独立 agent 冒烟任务，修复引入缺陷并记录量测局限。

## Validation and completion / 验证与完成

Follow [development validation](../../development.md#validation-scope). Prioritize meaningful scope/reference/budget/navigation/echo tests and existing CLI compatibility; then package smoke. Keep the browser bundle unchanged unless browser sources change. Run independent clean workers against synthetic corpus snapshots and record actual model identities, evidence, calls, output bytes and elapsed time; unavailable token accounting stays unknown. A complete 12-task × 2-model × 2-trial per-condition matrix is a repeatable evaluation target, not a claim implied by a smoke test. / 遵循[开发验证](../../development.md#validation-scope)。优先执行范围／引用／预算／导航／回声测试及旧 CLI 兼容性，再检查安装包。浏览器源码未变时保持 bundle 不变。独立干净 worker 使用合成语料快照，记录实际模型、证据、调用数、输出字节与耗时；无法获取的 token 核算保留未知。完整每条件 12 任务 × 2 模型 × 2 次矩阵是可复现评估目标，不能由冒烟测试暗示已经完成。

Do not archive this plan until implemented requirements and required validation are complete; identify any deferred larger evaluation separately from completed smoke runs. / 实现要求及所需验证完成前不归档；更大评估若后置，应与已完成冒烟明确分开。

## Progress log / 进度记录

- 2026-09-23: Work split between core retrieval, CLI/package integration, and bilingual docs/evaluation. Fixed-scope service selected to avoid UI interference; no parser/schema change planned. / 工作分为核心检索、CLI／包集成、双语文档／评估。选择固定范围服务以避免干扰 UI；不计划解析器／schema 变更。
- 2026-09-23: Added product/design/usage contracts, packaged skill text and isolated synthetic evaluation protocol. Execution results remain to be recorded by the implementing agent. / 新增产品／设计／使用契约、随包 skill 及隔离合成评估协议。执行结果待实现 agent 记录。
- 2026-09-23: Completed four read operations, fixed-scope CLI/HTTP, persistent compact refs, source verification, directional navigation, bounded UTF-8 responses and direct echo filtering. Fixed actual compact-Codex classification, backward navigation with reduced limits, multiline hit preservation and validation of unreturned batch items. / 完成四种读取操作、固定范围 CLI／HTTP、持久紧凑引用、来源核验、方向导航、有界 UTF-8 响应及直接回声过滤。修正了真实紧凑 Codex 分类、缩小 limit 后反向导航、多行命中保留及未返回批次项提前核验问题。
- 2026-09-23: Final full Node suite 1,247/1,247; focused history suite 26/26; installed package UI/history smoke passed all three sources. `git diff --check` passed. No browser-source changes; browser interaction suite not rerun. / 最终完整 Node 套件 1,247/1,247、历史聚焦套件 26/26；安装包 UI／history smoke 三来源全部通过。`git diff --check` 通过。未改浏览器源码，未重跑浏览器交互套件。
- 2026-09-23: Recorded raw/enhanced trials with explicitly configured Astra and Luna max, plus separately labeled inherited-model calibration. Fresh post-repair T06 workers both recovered patch/failure/rerun evidence in six calls with no errors. See [pilot report](../../evals/history-retrieval/2026-09-23-pilot.md) for all results and shortcomings. / 记录明确配置 Astra、Luna max 的原始／增强试验，另单列继承模型校准。修复后全新 T06 worker 均以六次调用、零错误找回 patch／失败／重跑依据。全部结果及不足见[试跑报告](../../evals/history-retrieval/2026-09-23-pilot.md)。

## Follow-up boundary / 后续边界

Independent pre-commit Astra review found two issues after MVP acceptance: normalized Unicode matches could expose the wrong excerpt offset, and an unrelated stale session could block all artifact policies through eager classification. Both were repaired with source-backed regressions; the history suite passed 28/28 and the full Node suite passed 1,249/1,249. A second independent Astra review verified the fixes and reported no remaining actionable findings before the authorized commit. / MVP 验收后，提交前独立 Astra 审查发现两项问题：Unicode 归一化命中可能暴露错误摘录偏移；提前分类可能使无关失效会话阻断所有工件策略。两项均已修正并补充来源测试；历史套件 28/28、完整 Node 套件 1,249/1,249 通过。授权提交前，第二轮独立 Astra 复审核验修复并报告无剩余可操作问题。

A later user-requested integrated review of commits `9e5b742` and `38a0b7d` found duplicate `raw` selectors could loop without advancing, and CLI flag-like clues could trigger help or be rejected. Parts now normalize before offsets/cursors, and help is recognized only in option positions. Parent inspection additionally found inherited object property names were silently accepted as serve options; own-property lookup now rejects them. Three independent Astra review rounds ended without remaining actionable findings. Relevant history/legacy CLI/package tests passed 59/59, and the final reviewer ran 108 additional parser assertions. Installed-package smoke passed all three sources with literal help-token queries and duplicate selector checks. / 用户随后要求对提交 `9e5b742` 与 `38a0b7d` 做整体审查，发现重复 `raw` 选择器可能导致续读循环，CLI 选项形状的线索可能触发帮助或被拒绝。现在先归一化 parts 再解释偏移／游标，仅在选项位置识别帮助。主 agent 另发现继承的对象属性名会被静默接受为 serve 选项，已改为自有属性查找并拒绝。三轮独立 Astra 审查最终无剩余可操作问题。相关历史／旧 CLI／package 测试 59/59 通过，最终 reviewer 另运行 108 项参数断言。安装包 smoke 的三来源均通过，包含字面帮助词查询及重复选择器检查。

The 96-trial controlled matrix, larger sanitized corpora and model-token measurement were not run. The pilot does not establish an efficiency advantage over raw search. These remain evaluation work rather than unreported acceptance results; semantic recall, cross-source aggregation and DeepSeek echo classification remain documented scope limits. / 未运行 96 次受控矩阵、更大脱敏语料或模型 token 量测。试跑不证明相较原始搜索的效率优势。这些是后续评估工作，不能作为未报告的验收结果；语义召回、跨来源聚合及 DeepSeek 回声分类仍为已记录的范围限制。
