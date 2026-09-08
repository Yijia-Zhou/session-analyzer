# Session Analyzer Repository Guide

This repository keeps long-lived project intent in `docs/` rather than expanding `AGENTS.md` into a large catch-all file.

## Documentation map

- `CONTEXT.md`
  - Canonical bilingual domain terminology and words to avoid.
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

## Local server startup

- Start: `$repo = (git rev-parse --show-toplevel); $node = (Get-Command 'node.exe' -ErrorAction Stop).Source; $process = Start-Process -FilePath $node -ArgumentList @('server.js', '--repo', $repo) -WorkingDirectory $repo -WindowStyle Hidden -PassThru; $process.Id`
- HTTP readiness only: `Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:17890/' -TimeoutSec 10`. This does not verify indexing. / 此检查只证明 HTTP 就绪，不证明索引完成。
- Project acceptance: poll `GET /api/project/status` until `job.status` is `succeeded`, `failed`, or `cancelled` (use a bounded wait and report `queued`/`running` if it expires). A failure must include `job.error` and `job.errorCode` in the report. On success, request `GET /api/state`, verify `projectSelected`, the intended `repoRoot`, `totals.sessionCount`, and `sourceDiagnostics`; report zero sessions and any diagnostics explicitly instead of claiming readable history. If no `--repo` was supplied, HTTP 409 from `/api/state` means selection is still required. / 项目验收：轮询 `GET /api/project/status` 至 `job.status` 为 `succeeded`、`failed` 或 `cancelled`，采用有界等待，超时仍应报告排队／运行状态。失败时报告 `job.error` 与 `job.errorCode`；成功后检查 `GET /api/state` 的 `projectSelected`、预期 `repoRoot`、`totals.sessionCount` 与 `sourceDiagnostics`，明确报告零会话及诊断，不能直接声称历史可读。未传 `--repo` 时，`/api/state` 的 HTTP 409 表示仍需选择项目。
- In Codex sandboxed tool sessions, background `Start-Process` server launches may be cleaned up when the command finishes. For a persistent browser-verification server, start this command outside the sandbox / with escalated execution.
- 当代码修改完成但需要重启local server才能生效时，进行重启供用户验收。

## Starting for a user / 替用户启动

- The command above targets this checkout for repository development acceptance. For a user session, set `--repo` to the user's intended target repository; the Analyzer checkout and transcript root are separate paths. / 上面的命令用于当前 checkout 的开发验收；替用户启动时，`--repo` 应指向用户要查看的目标仓库，Analyzer checkout 与转录根是另外两个路径。
- Record the checkout commit (branch trial) or the installed package version (npm release), choose `--source codex|claude-code|deepseek-harness`, and specify the relevant `--codex-home`, `--claude-home`, or `--dsh-home` only when needed. `--dsh-home` points to the sessions persistence root. Branch functionality is not guaranteed in `npx session-analyzer`'s published package. / 记录 checkout commit（分支试用）或已安装包版本（npm 发布版），选择 `--source codex|claude-code|deepseek-harness`，必要时指定对应来源根。`--dsh-home` 指 sessions 持久化根；`npx session-analyzer` 的发布包不保证包含分支功能。
- Use the project acceptance checks above before reporting success. These are current internal API checks, not a stable public API commitment. / 报告成功前执行上述项目验收；这些是当前内部 API 核验，不构成稳定公共 API 承诺。

## Current anchors

- Domain language: `CONTEXT.md`
- Product spec: `docs/product-specs/session-transcript-analyzer.md`
- Design doc: `docs/design-docs/logical-event-timeline.md`
- Timeline loading/rendering performance: `docs/design-docs/timeline-loading-and-rendering-performance.md`
- Trajectory Main Presentation: `docs/design-docs/trajectory-presentation.md`
- Code Mode operations design: `docs/design-docs/code-mode-operations.md`
- Code Mode structured display catalog: `docs/design-docs/code-mode-structured-display-catalog.md`
- Schema update runbook: `docs/design-docs/schema-update-runbook.md`
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
