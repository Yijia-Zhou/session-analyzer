# Documentation System / 文档系统

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted / 状态：已接受
- Last updated: 2026-08-23 / 最近更新：2026-08-23
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related plans: / 相关计划：
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

## Context / 背景

This repository started as a small local tool, but it already has user-facing behavior, internal normalization logic, and ongoing implementation work. Without a consistent documentation split, repository intent would drift into ad hoc chat history and oversized top-level instructions.

本仓库最初是一个小型本地工具，但它已经具备面向用户的行为、内部归一化逻辑和正在进行的实现工作。如果没有一致的文档拆分，仓库意图会漂移到临时聊天历史和过大的顶层说明中。

## Goals and constraints / 目标与约束

- Keep `AGENTS.md` short and navigational. / 让 `AGENTS.md` 保持简短，并专注于导航。
- Separate external behavior from internal design from step-by-step execution. / 将外部行为、内部设计和逐步执行分离开来。
- Keep unvalidated long-horizon ideas separate from accepted specs, design docs, and execution plans. / 将未经验证的远期想法与已接受的规格、设计文档和执行计划分离。
- Make active implementation plans self-contained enough for a new executor to continue the work. / 让活跃实现计划足够自包含，使新的执行者可以继续工作。
- Keep filenames searchable by topic and status. / 让文件名可按主题和状态搜索。
- Keep bilingual docs synchronized when either language changes. / 当任一语言发生变更时，保持双语文档同步。
- Keep project-specific domain terms canonical and easy to discover. / 让项目特有的领域术语保持规范且易于发现。
- Avoid append-only global document indexes that make unrelated feature branches edit the same lines. / 避免使用追加式全局文档索引，以免不相关的 feature branch 修改同一组文本行。

## Proposed design / 提议设计

### `CONTEXT.md` / 领域语言词汇表

- Canonical bilingual names and tight definitions for project-specific domain concepts / 为项目特有的领域概念提供规范的双语名称和精炼定义
- Explicit words to avoid when they would blur an important domain distinction / 明确列出会模糊重要领域边界、因而应避免的词语
- Contains no implementation details, behavior specifications, or architectural decisions / 不包含实现细节、行为规格或架构决策

### `AGENTS.md` / 仓库导航文件

- Repository navigation only / 仅用于仓库导航
- Update rules for documentation / 文档更新规则
- Pointers to the current spec and design docs, plus the authoritative active and completed plan directories / 指向当前规格与设计文档，以及权威的活跃计划和已完成计划目录
- A small set of genuinely current active-plan entrypoints may be grouped by subsystem; completed plans are discovered from their archive directory and are not itemized here / 可以按 subsystem 分组保留少量真正当前有效的 active-plan 入口；已完成计划从其归档目录发现，不在此逐条枚举
- Lightweight bilingual sync rule for translated docs / 面向已翻译文档的轻量双语同步规则

### `CHANGELOG.md` / 变更日志

- Keep a single changelog file; organize the current development release by stable subsystem or transcript source instead of a global implementation timeline / 保持单一 changelog 文件；当前开发版本按稳定的 subsystem 或 transcript source 组织，而不是采用全局实现时间线
- Keep each module's English and Chinese facts together and semantically aligned; do not duplicate one fact across modules / 将每个模块的英文与中文事实放在一起并保持语义一致；不要在多个模块中重复同一事实
- Omit empty modules and preserve the established release history below the current development section / 省略空模块，并保留当前开发区段以下既有的发布历史

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

### `docs/backlog/` / 远期想法暂存目录

- Parking lot for rough, uncommitted, long-horizon improvement ideas / 用于暂存粗略的、尚未承诺的、远期潜在改进想法
- Not an accepted requirement, design decision, execution plan, or technical debt tracker / 不是已接受的需求、设计决策、执行计划或技术债跟踪器
- Items should define promotion criteria before they can move into specs, design docs, or exec plans / 条目应先定义晋升标准，之后才能迁移到规格、设计文档或执行计划

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

### Put rough future ideas into active exec plans / 将粗略远期想法放入活跃执行计划

- Pros: keeps all future work in one place / 优点：所有未来工作都在一个位置
- Cons: makes speculative ideas look like committed near-term work / 缺点：会让推测性想法看起来像已经承诺的近期工作
- Rejected / 已拒绝

## Risks / 风险

- Empty document trees that look formal but do not guide implementation / 空文档树看起来正式，却无法指导实现
- Specs drifting away from current UI behavior / 规格与当前 UI 行为脱节
- Completed plans becoming the only place where important design decisions are recorded / 已完成计划成为记录重要设计决策的唯一位置
- Backlog entries becoming a permanent dumping ground instead of being promoted, rejected, or refreshed / backlog 条目变成永久垃圾堆，而不是被晋升、拒绝或刷新

## Validation / 验证

- Project-specific terminology should be consistent with `CONTEXT.md`. / 项目特有的术语应与 `CONTEXT.md` 保持一致。
- Every major feature should be traceable from spec -> design -> active/completed plan / 每个主要功能都应能从规格 -> 设计 -> 活跃/已完成计划追踪
- Backlog items should not be treated as accepted work until promoted into a formal document class. / backlog 条目在晋升到正式文档类别前，不应被视为已接受工作。
- AGENTS should remain small enough to read quickly / AGENTS 应保持足够小，以便快速阅读
- Bilingual docs should not leave English and Chinese text describing different behavior. / 双语文档不应让英文和中文描述不同的行为。
- New contributors should be able to identify current product intent without replaying prior chats / 新贡献者应能在不回放先前聊天的情况下识别当前产品意图

## Decision log / 决策日志

- 2026-08-23: Made the execution-plan directories authoritative, removed the itemized completed-plan registry from `AGENTS.md`, and organized the current changelog release by stable modules so unrelated branches no longer share append-only documentation hotspots. / 2026-08-23：将执行计划目录确立为权威来源，从 `AGENTS.md` 移除逐条维护的 completed-plan registry，并按稳定模块组织当前 changelog release，避免不相关 branch 共用追加式文档热点。
- 2026-07-13: Added a root bilingual domain glossary to distinguish source history, interpreted history, event layers, session relationships, and search boundaries. / 2026-07-13：新增根目录双语领域词汇表，用于区分来源历史、解释后历史、事件层、会话关系和搜索边界。
- 2026-05-04: Added `docs/backlog/` as a separate parking area for rough long-horizon ideas. / 2026-05-04：新增 `docs/backlog/`，作为粗略远期想法的独立暂存区。
- 2026-05-03: Added a lightweight rule requiring translated docs to keep English and Chinese text synchronized. / 2026-05-03：添加轻量规则，要求已翻译文档保持英文和中文文本同步。
- 2026-04-21: Chose a three-tier documentation system with repository-specific starter docs instead of template-only scaffolding. / 2026-04-21：选择带有仓库专属起始文档的三层文档系统，而不是只使用模板脚手架。
