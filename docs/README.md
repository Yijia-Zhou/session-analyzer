# Documentation Overview / 文档概览

This repository uses three document classes:

本仓库使用三类文档：

- `product-specs/`: what the product should do / 产品应该做什么
- `design-docs/`: why the system is designed this way / 系统为什么这样设计
- `exec-plans/`: how a concrete change is being executed / 一项具体变更如何执行

## How to use this tree / 如何使用这棵文档树

- Start with a product spec when adding or changing user-facing behavior. / 添加或修改面向用户的行为时，先从产品规格开始。
- Add or update a design doc when changing the transcript model, APIs, storage, or UI architecture. / 修改转录模型、API、存储或 UI 架构时，新增或更新设计文档。
- Create an exec plan for any non-trivial implementation that spans multiple files or milestones. / 对任何跨多个文件或里程碑的非平凡实现创建执行计划。

## Current docs / 当前文档

- `product-specs/session-transcript-analyzer.md` / 会话转录分析器产品规格
- `design-docs/logical-event-timeline.md` / 逻辑事件时间线设计文档
- `design-docs/documentation-system.md` / 文档系统设计文档
- `exec-plans/active/2026-04-21-transcript-normalization-followups.md` / 转录归一化后续工作的活跃执行计划
- `exec-plans/completed/2026-04-20-session-analyzer-v1.md` / 会话分析器 V1 已完成执行计划
- `exec-plans/tech-debt-tracker.md` / 技术债跟踪器
