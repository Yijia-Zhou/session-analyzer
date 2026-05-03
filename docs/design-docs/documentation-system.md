# Documentation System / 文档系统

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-05-03 / 最近更新：2026-05-03
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related plans: / 相关计划：
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

## Context / 背景

This repository started as a small local tool, but it already has user-facing behavior, internal normalization logic, and ongoing implementation work. Without a consistent documentation split, repository intent would drift into ad hoc chat history and oversized top-level instructions.

本仓库最初是一个小型本地工具，但它已经具备面向用户的行为、内部归一化逻辑和正在进行的实现工作。如果没有一致的文档拆分，仓库意图会漂移到临时聊天历史和过大的顶层说明中。

## Goals and constraints / 目标与约束

- Keep `AGENTS.md` short and navigational. / 让 `AGENTS.md` 保持简短，并专注于导航。
- Separate external behavior from internal design from step-by-step execution. / 将外部行为、内部设计和逐步执行分离开来。
- Make active implementation plans self-contained enough for a new executor to continue the work. / 让活跃实现计划足够自包含，使新的执行者可以继续工作。
- Keep filenames searchable by topic and status. / 让文件名可按主题和状态搜索。
- Keep bilingual docs synchronized when either language changes. / 当任一语言发生变更时，保持双语文档同步。

## Proposed design / 提议设计

### `AGENTS.md` / 仓库导航文件

- Repository navigation only / 仅用于仓库导航
- Update rules for documentation / 文档更新规则
- Pointers to the current spec, design docs, and plans / 指向当前规格、设计文档和计划的链接
- Lightweight bilingual sync rule for translated docs / 面向已翻译文档的轻量双语同步规则

### `docs/product-specs/` / 产品规格目录

- One document per product behavior area / 每个产品行为领域一份文档
- Focus on user-visible behavior, goals, non-goals, and acceptance criteria / 聚焦用户可见行为、目标、非目标和验收标准

### `docs/design-docs/` / 设计文档目录

- One document per important internal model or architectural decision / 每个重要内部模型或架构决策一份文档
- Must include alternatives and risks, not just the chosen design / 必须包含备选方案和风险，而不只是被选中的设计

### `docs/exec-plans/active/` / 活跃执行计划目录

- Self-contained plans for in-progress work / 面向进行中工作的自包含计划
- Must include repository context, invariants, milestones, validation, and a running progress log / 必须包含仓库背景、不变量、里程碑、验证和持续更新的进度日志

### `docs/exec-plans/completed/` / 已完成执行计划目录

- Archived plans with completion summaries / 带完成摘要的归档计划
- Used as historical implementation records / 用作历史实现记录

### `docs/exec-plans/tech-debt-tracker.md` / 技术债跟踪文档

- Cross-plan debt that would otherwise be forgotten / 否则可能被遗忘的跨计划债务
- Each entry should point back to the related spec or design doc where possible / 每个条目应尽可能指回相关规格或设计文档

## Alternatives considered / 已考虑的备选方案

### Keep everything in AGENTS.md / 将所有内容放在 AGENTS.md 中

- Pros: one file to search / 优点：只需搜索一个文件
- Cons: too much context, high drift risk, poor separation of concerns / 缺点：上下文过多、漂移风险高、关注点分离差
- Rejected / 已拒绝

### Keep only execution plans / 只保留执行计划

- Pros: less writing up front / 优点：前期写作更少
- Cons: product intent and design rationale get lost in tactical runbooks / 缺点：产品意图和设计理由会丢失在战术性运行手册中
- Rejected / 已拒绝

### Use only generic templates without current project docs / 只使用通用模板而不写当前项目文档

- Pros: low effort / 优点：工作量低
- Cons: creates a structure without actual repository knowledge inside it / 缺点：创建了结构，但其中没有实际仓库知识
- Rejected / 已拒绝

## Risks / 风险

- Empty document trees that look formal but do not guide implementation / 空文档树看起来正式，却无法指导实现
- Specs drifting away from current UI behavior / 规格与当前 UI 行为脱节
- Completed plans becoming the only place where important design decisions are recorded / 已完成计划成为记录重要设计决策的唯一位置

## Validation / 验证

- Every major feature should be traceable from spec -> design -> active/completed plan / 每个主要功能都应能从规格 -> 设计 -> 活跃/已完成计划追踪
- AGENTS should remain small enough to read quickly / AGENTS 应保持足够小，以便快速阅读
- Bilingual docs should not leave English and Chinese text describing different behavior. / 双语文档不应让英文和中文描述不同的行为。
- New contributors should be able to identify current product intent without replaying prior chats / 新贡献者应能在不回放先前聊天的情况下识别当前产品意图

## Decision log / 决策日志

- 2026-05-03: Added a lightweight rule requiring translated docs to keep English and Chinese text synchronized. / 2026-05-03：添加轻量规则，要求已翻译文档保持英文和中文文本同步。
- 2026-04-21: Chose a three-tier documentation system with repository-specific starter docs instead of template-only scaffolding. / 2026-04-21：选择带有仓库专属起始文档的三层文档系统，而不是只使用模板脚手架。
