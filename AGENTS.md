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
- Verify: `Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:17890/' -TimeoutSec 10`
- In Codex sandboxed tool sessions, background `Start-Process` server launches may be cleaned up when the command finishes. For a persistent browser-verification server, start this command outside the sandbox / with escalated execution.
- 当代码修改完成但需要重启local server才能生效时，进行重启供用户验收。

## Current anchors

- Domain language: `CONTEXT.md`
- Product spec: `docs/product-specs/session-transcript-analyzer.md`
- Design doc: `docs/design-docs/logical-event-timeline.md`
- Timeline loading/rendering performance: `docs/design-docs/timeline-loading-and-rendering-performance.md`
- Code Mode operations design: `docs/design-docs/code-mode-operations.md`
- Code Mode structured display catalog: `docs/design-docs/code-mode-structured-display-catalog.md`
- Schema update runbook: `docs/design-docs/schema-update-runbook.md`
- npm release runbook: `docs/design-docs/npm-release-runbook.md`
- Documentation system guide: `docs/design-docs/documentation-system.md`
- Optional Codex hook guardrails: `docs/design-docs/codex-hooks-guardrails.md`
- Transcript source adapters: `docs/design-docs/transcript-source-adapters.md`
- Indexed/Materialized Session lifecycle: `docs/design-docs/indexed-materialized-session-lifecycle.md`
- Active execution plan: `docs/exec-plans/active/2026-08-29-performance-wave-1b-search-render-coalescing.md` (`PASS_M3_CANDIDATE_READY_FOR_M4`)
- Active execution plans (authoritative directory): `docs/exec-plans/active/`
- Completed execution plans (authoritative archive; not itemized here): `docs/exec-plans/completed/`

## Tips

如果你觉得需要，可以通过 `$spawn-specified-subagent` 派出 `gpt-5.6-luna`（thinking effort: max）subagent，处理繁重、复杂但不需要较强启发式判断的任务。Max effort 可能需要数十分钟；不要频繁使用很短的 `wait_agent` timeout。
