# Session Analyzer Repository Guide

This repository keeps long-lived project intent in `docs/` rather than expanding `AGENTS.md` into a large catch-all file.

## Documentation map

Use this map and the anchors below as conditional routes, not a preload checklist. Read the relevant sections for the task; follow additional references only when they resolve a concrete question. / 下列目录与锚点用于按需导航，不是预读清单。阅读与任务相关的章节；仅在解决具体问题时继续读取引用。

- `CONTEXT.md`
  - Canonical bilingual domain terminology and words to avoid.
- `docs/usage/` and `docs/development.md`
  - Online consumer startup/troubleshooting guides and source-development instructions. / 在线消费端启动／故障排查指南与源码开发说明。
- `docs/product-specs/`
  - External behavior, user value, scope boundaries, acceptance criteria.
- `docs/design-docs/`
  - Internal design, tradeoffs, data flow, risks, compatibility decisions.
- `docs/exec-plans/active/`
  - Self-contained implementation runbooks for work in progress.
- `docs/exec-plans/completed/`
  - Archived execution plans for shipped or finished work.
- `docs/exec-plans/tech-debt-tracker.md`
  - Cross-cutting debt that should not be hidden inside a single plan.

## Update rules

When changing product behavior or repository structure:

1. Update the relevant product spec if the user-visible contract changes.
2. Update the relevant design doc if the internal model, architecture, or tradeoff changes.
3. Update the active exec plan if the work is still in progress.
4. Move finished plans from `active/` to `completed/` only when the work is actually done.
5. For bilingual docs, update the English and Chinese text together so they keep the same meaning. / 对双语文档，英文和中文要在同一次变更中同步更新，保持含义一致。

## Execution and completion / 执行与完成

- Carry authorized work through implementation, relevant validation, inspection and repair of introduced regressions, and a concise result report. A plan or first implementation is not completion unless that is the requested deliverable. Ask only when missing information materially changes scope or correctness; continue independent work meanwhile. / 将已授权工作推进至实现、相关验证、检查并修复引入的回归，以及简短结果报告。除非用户所求就是计划或初版，否则不能以此视为完成。仅在缺失信息实质影响范围或正确性时提问，同时继续独立工作。
- Proceed with safe local, reversible preparation within scope. Existing authorization carries forward; follow the release runbook's explicit human gates for publication. Destructive, external, credential-sensitive, or production actions require authorization covering that action. / 在范围内自主进行安全、可逆的本地准备。已有授权持续有效；发布遵循运行手册的明确人工门禁。破坏性、外部、凭据敏感或生产操作需要覆盖该操作的授权。
- Scale validation to the change: documentation/instruction edits need reference and consistency checks; code changes need focused tests for affected behavior. See [development validation](docs/development.md#validation-scope) for commands and broader gates. Report blocked or unrun checks explicitly. / 按变更规模验证：文档／指令修改检查引用与一致性；代码修改针对受影响行为执行聚焦测试。命令与更广门槛见[开发验证](docs/development.md#validation-scope)。明确报告受阻或未运行的检查。

## Repository invariants / 仓库不变量

- Do not commit real transcript data or unsanitized exports/fixtures; use minimized synthetic or sanitized fixtures. / 不提交真实转录数据或未脱敏导出／fixture；使用最小化合成或脱敏 fixture。
- `public/assets/app.js` is generated: edit `src/browser/` or `src/shared/`, rebuild, and check generated assets. / `public/assets/app.js` 是生成文件：修改 `src/browser/` 或 `src/shared/`，重新构建并检查生成资产。
- Keep machine identifiers such as `kind`, `status`, `layer`, `rawRefs`, and `sourceLocator` stable and untranslated. / 保持 `kind`、`status`、`layer`、`rawRefs`、`sourceLocator` 等机器标识稳定，不翻译。

## Local server startup

- Start: `$repo = (git rev-parse --show-toplevel); $node = (Get-Command 'node.exe' -ErrorAction Stop).Source; $process = Start-Process -FilePath $node -ArgumentList @('server.js', '--repo', $repo) -WorkingDirectory $repo -WindowStyle Hidden -PassThru; $process.Id`
- HTTP readiness only: `Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:17890/' -TimeoutSec 10`. This does not verify indexing. / 此检查只证明 HTTP 就绪，不证明索引完成。
- Project acceptance: use the bounded checks and result contract in [agent quickstart](docs/usage/agent-quickstart.md). Verify the intended project/source/root, indexing outcome, count, diagnostics, and actual reading; report errors/codes, zero, pending, or cancellation explicitly. These are internal API checks. / 项目验收：按 [agent 快速开始](docs/usage/agent-quickstart.md)执行有界检查与结果契约，核验预期项目／来源／根、索引结果、数量、诊断及实际阅读，明确报告错误／错误码、零会话、等待或取消；这些是内部 API 检查。
- In Codex sandboxed tool sessions, background `Start-Process` server launches may be cleaned up when the command finishes. For a persistent browser-verification server, start this command outside the sandbox / with escalated execution.
- 当代码修改完成但需要重启local server才能生效时，进行重启供用户验收。

## Starting for a user / 替用户启动

- Follow [the canonical consumer agent guide](docs/usage/agent-quickstart.md) for version-aware startup and acceptance. The command above targets this checkout for development; a user session targets the user's intended repository. / 按[规范消费端 agent 指南](docs/usage/agent-quickstart.md)执行版本感知启动与验收。上面的命令面向本 checkout 的开发验收；替用户启动时应选择用户的目标仓库。

## Current anchors

Choose by the affected concern: behavior changes need the relevant product-spec sections; model/architecture changes need the matching design; parser/schema changes need the schema runbook and source-adapter evidence (Codex coverage for Codex changes). Read `CONTEXT.md` when changing domain terms, and the release runbook when preparing a release. For ongoing work, read its active plan; consult completed plans or the debt tracker when investigating prior decisions or known gaps. / 按受影响主题选择：行为变更读相关产品规格章节；模型／架构变更读对应设计；解析器／schema 变更读 schema 手册与来源 adapter 依据（Codex 变更读 Codex 覆盖文档）。修改领域术语时读 `CONTEXT.md`，准备发布时读发布手册。继续进行中工作时读其 active plan；调查历史决策或已知缺口时查 completed plan 或技术债。

- Source setup and validation: `docs/development.md` (before dependency installation or npm commands / 安装依赖或执行 npm 命令前)
- Domain language: `CONTEXT.md`
- Product spec: `docs/product-specs/session-transcript-analyzer.md`
- Design doc: `docs/design-docs/logical-event-timeline.md`
- Timeline loading/rendering performance: `docs/design-docs/timeline-loading-and-rendering-performance.md`
- Trajectory Main Presentation: `docs/design-docs/trajectory-presentation.md`
- Code Mode operations design: `docs/design-docs/code-mode-operations.md`
- Code Mode structured display catalog: `docs/design-docs/code-mode-structured-display-catalog.md`
- Schema update runbook: `docs/design-docs/schema-update-runbook.md`
- Codex protocol coverage: `docs/design-docs/codex-protocol-event-coverage.md`
- npm release runbook: `docs/design-docs/npm-release-runbook.md`
- Documentation system guide: `docs/design-docs/documentation-system.md`
- Optional Codex hook guardrails: `docs/design-docs/codex-hooks-guardrails.md`
- Transcript source adapters: `docs/design-docs/transcript-source-adapters.md`
- Cache observation and discontinuity: `docs/design-docs/cache-observation-and-discontinuity.md`
- Indexed/Materialized Session lifecycle: `docs/design-docs/indexed-materialized-session-lifecycle.md`
- Active execution plans (authoritative directory): `docs/exec-plans/active/`
- Completed execution plans (authoritative archive; not itemized here): `docs/exec-plans/completed/`

## Tips

如果你觉得需要，可以通过 `$spawn-specified-subagent` 派出 `gpt-5.6-luna`（thinking effort: max）subagent，处理繁重、复杂但不需要较强启发式判断的任务。Max effort 可能需要数十分钟；不要频繁使用很短的 `wait_agent` timeout。
