# Session Analyzer Repository Guide

This repository keeps long-lived project intent in `docs/` rather than expanding `AGENTS.md` into a large catch-all file.

## Documentation map

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

- Start: `$process = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @('server.js', '--repo', 'G:\vibe\session-analyzer') -WorkingDirectory 'G:\vibe\session-analyzer' -WindowStyle Hidden -PassThru; $process.Id`
- Verify: `Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:17890/' -TimeoutSec 10`
- In Codex sandboxed tool sessions, background `Start-Process` server launches may be cleaned up when the command finishes. For a persistent browser-verification server, start this command outside the sandbox / with escalated execution.

## Current anchors

- Product spec: `docs/product-specs/session-transcript-analyzer.md`
- Design doc: `docs/design-docs/logical-event-timeline.md`
- Documentation system guide: `docs/design-docs/documentation-system.md`
- Active plans: none
- Completed plans:
  - `docs/exec-plans/completed/2026-04-20-session-analyzer-v1.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`
  - `docs/exec-plans/completed/2026-05-04-viewer-ux-inspector-and-search.md`
