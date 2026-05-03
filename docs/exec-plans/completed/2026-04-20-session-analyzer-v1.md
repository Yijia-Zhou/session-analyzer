# Session Analyzer V1 / 会话分析器 V1

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Last updated: 2026-04-21 / 最近更新：2026-04-21
- Related spec: / 相关规格：
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design: / 相关设计：
  - `docs/design-docs/logical-event-timeline.md`

## Objective / 目标

Deliver a local web-based Codex session viewer with repository filtering, search, timeline browsing, folding profiles, and raw JSONL drill-down.

交付一个本地 Web 版 Codex 会话查看器，具备仓库筛选、搜索、时间线浏览、折叠配置和原始 JSONL 下钻能力。

## Scope / 范围

### In scope / 范围内
- Local HTTP server / 本地 HTTP 服务器
- Repository-scoped session scanning / 仓库范围的会话扫描
- In-memory indexing / 内存索引
- Search and filtering / 搜索和筛选
- Timeline UI / 时间线 UI
- Folding profiles / 折叠配置

### Out of scope / 范围外
- Shared deployment / 共享部署
- Persistent index storage / 持久索引存储
- LLM-generated summaries / LLM 生成摘要

## Repository context / 仓库背景

- Server entry: `server.js` / 服务器入口：`server.js`
- Transcript parser: `src/codex.js` / 转录解析器：`src/codex.js`
- Folding profiles: `src/folding.js` / 折叠配置：`src/folding.js`
- Frontend UI: `public/` / 前端 UI：`public/`
- Tests: `test/codex.test.js` / 测试：`test/codex.test.js`

## Invariants / 不变量

- Transcript files stay read-only / 转录文件保持只读
- Main workflows must work without external services / 主要工作流必须在没有外部服务的情况下工作
- Raw transcript rows remain inspectable / 原始转录行保持可检查

## Milestones / 里程碑

### Milestone 1 - Baseline parser and API / 里程碑 1 - 基线解析器和 API
#### Changes / 变更
- Added session scanning, session summaries, timeline API, and raw-row API / 添加会话扫描、会话摘要、时间线 API 和原始行 API

#### Validation / 验证
- Syntax checks and parser tests / 语法检查和解析器测试

#### Exit criteria / 退出标准
- Local server can list repository sessions and fetch timelines / 本地服务器可以列出仓库会话并获取时间线

### Milestone 2 - Browser UI / 里程碑 2 - 浏览器 UI
#### Changes / 变更
- Added session list, filters, timeline rendering, folding profiles, and detail panel / 添加会话列表、筛选器、时间线渲染、折叠配置和详情面板

#### Validation / 验证
- Manual browser verification / 手动浏览器验证

#### Exit criteria / 退出标准
- Sessions can be browsed end to end in the local UI / 可以在本地 UI 中端到端浏览会话

### Milestone 3 - Test fixtures / 里程碑 3 - 测试 fixture
#### Changes / 变更
- Added fixture Codex home and parser tests / 添加 fixture Codex 主目录和解析器测试

#### Validation / 验证
- `node --test`

#### Exit criteria / 退出标准
- Core parser behavior is covered by repeatable tests / 核心解析器行为由可重复测试覆盖

## Validation checklist / 验证清单
- [x] Unit-style parser tests pass / 单元式解析器测试通过
- [x] Local server starts / 本地服务器可启动
- [x] Main timeline renders / 主时间线可渲染
- [x] Raw JSONL drill-down works / 原始 JSONL 下钻可工作

## Rollback notes / 回滚说明

- The project has no migration or persistent store, so rollback is file-based only.

本项目没有迁移或持久存储，因此回滚仅基于文件。

## Progress log / 进度日志

- 2026-04-20: Created initial local web app structure. / 2026-04-20：创建初始本地 Web 应用结构。
- 2026-04-20: Added parser, HTTP API, and UI skeleton. / 2026-04-20：添加解析器、HTTP API 和 UI 骨架。
- 2026-04-20: Added folding profiles and fixture tests. / 2026-04-20：添加折叠配置和 fixture 测试。

## Decision log / 决策日志

- 2026-04-20: Chose a dependency-light Node application instead of a larger framework. / 2026-04-20：选择依赖较少的 Node 应用，而不是更大的框架。
- 2026-04-20: Kept indexing in memory for the initial version. / 2026-04-20：初始版本将索引保留在内存中。

## Completion summary / 完成摘要

V1 shipped as a usable local repository-scoped transcript browser. Later work moved into transcript normalization and layered timeline follow-ups.

V1 作为可用的本地仓库范围转录浏览器交付。后续工作转向转录归一化和分层时间线后续事项。
