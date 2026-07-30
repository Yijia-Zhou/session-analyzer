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

- Start: `$repo = (git rev-parse --show-toplevel); $process = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @('server.js', '--repo', $repo) -WorkingDirectory $repo -WindowStyle Hidden -PassThru; $process.Id`
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
- Documentation system guide: `docs/design-docs/documentation-system.md`
- Optional Codex hook guardrails: `docs/design-docs/codex-hooks-guardrails.md`
- Active plans:
- Completed plans:
  - `docs/exec-plans/completed/2026-07-30-code-mode-detail-presentation-contract.md`
  - `docs/exec-plans/completed/2026-07-25-code-mode-request-facets-and-folding.md`
  - `docs/exec-plans/completed/2026-07-22-code-mode-context-and-discoverability.md`
  - `docs/exec-plans/completed/2026-07-20-timeline-transition-safety-and-profiling.md`
  - `docs/exec-plans/completed/2026-07-16-code-mode-adaptive-presentation.md`
  - `docs/exec-plans/completed/2026-07-15-code-mode-structured-nested-projections.md`
  - `docs/exec-plans/completed/2026-07-14-code-mode-operation-grouping.md`
  - `docs/exec-plans/completed/2026-07-13-codex-event-schema-review.md`
  - `docs/exec-plans/completed/2026-07-12-search-jump-target-canonicalization.md`
  - `docs/exec-plans/completed/2026-07-06-search-hud-integration.md`
  - `docs/exec-plans/completed/2026-06-29-search-scope-mental-model-convergence.md`
  - `docs/exec-plans/completed/2026-06-28-search-navigation-state-convergence.md`
  - `docs/exec-plans/completed/2026-06-26-search-count-and-jump-target-convergence.md`
  - `docs/exec-plans/completed/2026-06-26-search-detail-state-convergence.md`
  - `docs/exec-plans/completed/2026-06-15-external-review-followups.md`
  - `docs/exec-plans/completed/2026-06-10-v0.1-release-hardening.md`
  - `docs/exec-plans/completed/2026-06-02-inspector-search-target-reveal.md`
  - `docs/exec-plans/completed/2026-06-02-find-in-page-phrase-search.md`
  - `docs/exec-plans/completed/2026-05-31-folding-rule-priority-governance.md`
  - `docs/exec-plans/completed/2026-05-31-lazy-image-preview-payload-externalization.md`
  - `docs/exec-plans/completed/2026-05-26-event-body-inspector-responsibility-split.md`
  - `docs/exec-plans/completed/2026-05-21-codex-protocol-event-coverage-followup.md`
  - `docs/exec-plans/completed/2026-04-20-session-analyzer-v1.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`
  - `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md`

## Tips

如果你觉得需要，可以通过 `$spawn-specified-subagent` 派出 `gpt-5.6-luna`（thinking effort: max）subagent，处理繁重、复杂但不需要较强启发式判断的任务。Max effort 可能需要数十分钟；不要频繁使用很短的 `wait_agent` timeout。
