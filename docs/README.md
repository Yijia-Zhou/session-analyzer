# Documentation Overview / 文档概览

This repository uses three formal document classes plus one idea parking area:

本仓库使用三类正式文档，并设置一个想法暂存区：

- `product-specs/`: what the product should do / 产品应该做什么
- `design-docs/`: why the system is designed this way / 系统为什么这样设计
- `exec-plans/`: how a concrete change is being executed / 一项具体变更如何执行
- `backlog/`: rough long-horizon ideas that are not yet accepted plans / 尚未成为已接受计划的粗略远期想法

## How to use this tree / 如何使用这棵文档树

- Start with a product spec when adding or changing user-facing behavior. / 添加或修改面向用户的行为时，先从产品规格开始。
- Add or update a design doc when changing the transcript model, APIs, storage, or UI architecture. / 修改转录模型、API、存储或 UI 架构时，新增或更新设计文档。
- Create an exec plan for any non-trivial implementation that spans multiple files or milestones. / 对任何跨多个文件或里程碑的非平凡实现创建执行计划。
- Park under-shaped, long-horizon ideas in backlog until they have enough evidence to promote. / 将尚未成形的远期想法暂存在 backlog 中，直到它们有足够证据可以晋升。

## Current docs / 当前文档

- `product-specs/session-transcript-analyzer.md` / 会话转录分析器产品规格
- `design-docs/logical-event-timeline.md` / 逻辑事件时间线设计文档
- `design-docs/codex-protocol-event-coverage.md` / Codex 协议事件覆盖设计文档
- `design-docs/cross-surface-contract-consistency-tech-debt.md` / 跨表面契约一致性技术债
- `design-docs/schema-update-runbook.md` / Schema 更新运行手册
- `design-docs/npm-release-runbook.md` / npm 发布运行手册
- `design-docs/readme-visual-capture-runbook.md` / README 视觉素材与捕获运行手册
- `design-docs/external-source-mapping-pressure-tests.md` / 外部 source 映射压力测试设计文档
- `design-docs/transcript-source-adapters.md` / 转录来源适配器设计文档
- `design-docs/documentation-system.md` / 文档系统设计文档
- `exec-plans/completed/2026-08-15-v0.1.4-release.md` / v0.1.4 发布已完成执行计划
- `exec-plans/completed/2026-07-31-claude-code-source-adapter.md` / Claude Code 来源适配器已完成执行计划
- `exec-plans/completed/2026-07-31-claude-pointer-fork-context.md` / Claude 指针式分叉上下文已完成执行计划
- `exec-plans/completed/2026-07-30-subagent-activity-correlation.md` / Subagent 活动带类型关联已完成执行计划
- `exec-plans/completed/2026-07-30-tool-lifecycle-family-contract.md` / 工具生命周期族契约收敛已完成执行计划
- `exec-plans/completed/2026-06-26-search-count-and-jump-target-convergence.md` / 搜索计数与可跳转目标收敛已完成执行计划
- `exec-plans/completed/2026-06-10-v0.1-release-hardening.md` / v0.1 发布前加固已完成执行计划
- `exec-plans/completed/2026-06-02-inspector-search-target-reveal.md` / Inspector 搜索目标展开定位已完成执行计划
- `exec-plans/completed/2026-06-02-find-in-page-phrase-search.md` / 类浏览器页内短语查找已完成执行计划
- `exec-plans/completed/2026-05-31-folding-rule-priority-governance.md` / 折叠规则优先级治理已完成执行计划
- `exec-plans/completed/2026-05-31-lazy-image-preview-payload-externalization.md` / 图片预览载荷延迟外置已完成执行计划
- `exec-plans/completed/2026-05-26-event-body-inspector-responsibility-split.md` / 事件正文与 Inspector 职责重切已完成执行计划
- `exec-plans/completed/2026-05-21-codex-protocol-event-coverage-followup.md` / Codex 协议事件覆盖后续已完成执行计划
- `exec-plans/completed/2026-04-20-session-analyzer-v1.md` / 会话分析器 V1 已完成执行计划
- `exec-plans/completed/2026-04-21-transcript-normalization-followups.md` / 转录归一化后续工作的已完成执行计划
- `exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md` / 查看器 UX 检查器与搜索已完成执行计划
- `exec-plans/tech-debt-tracker.md` / 技术债跟踪器
- `backlog/README.md` / 远期想法暂存区规则
- `backlog/long-horizon-ideas.md` / 远期想法暂存清单
