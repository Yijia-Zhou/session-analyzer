# Session Transcript Analyzer

## Metadata
- Owner: repository maintainers
- Status: draft
- Last updated: 2026-04-21
- Related docs:
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

## Summary

Session Transcript Analyzer is a local web tool for reviewing Codex session transcripts for a specific repository. It helps a single developer move from raw transcript dumps to usable history: searchable sessions, layered timelines, tool-call analysis, and drill-down into the original JSONL when needed. The product is optimized for long sessions, repeated iterations, and mixed protocol noise inside Codex transcripts.

## Problem

- Raw Codex transcripts are long, repetitive, and hard to review after many sessions.
- The same user or assistant content may appear through multiple channels, which makes naive viewers noisy.
- Tool activity, protocol injections, and plan artifacts are useful for debugging but should not dominate normal reading.
- Without a local review tool, repository-specific engineering history becomes hard to search and hard to trust.

## Target users

- Primary users: individual developers using Codex across many sessions in the same repository
- Secondary users: maintainers debugging transcript format changes or viewer behavior
- Non-target users: multi-user hosted analytics or cloud reporting consumers

## Goals

- Make repository-scoped session history readable without opening raw JSONL files by hand.
- Support fast search across messages, tool calls, files, and outputs.
- Provide a main timeline that reflects logical work rather than raw duplicated transcript rows.
- Preserve access to protocol and raw transcript detail for debugging and verification.

## Non-goals

- Cloud sync, shared collaboration, or hosted dashboards
- LLM-based summarization or semantic clustering
- Editing or mutating Codex transcript files
- Supporting every historical Codex transcript variant perfectly on day one

## User stories

- As a developer, I want to list only sessions that touched my current repository, so that unrelated Codex history stays out of the way.
- As a developer, I want to search for a file path, command, or error string, so that I can jump back to the relevant work quickly.
- As a developer, I want the default timeline to collapse protocol noise and duplicate message channels, so that I can follow the real flow of work.
- As a maintainer, I want a protocol layer and a raw layer, so that I can verify how the logical timeline was derived.
- As a maintainer, I want tool operations grouped by logical call, so that shell runs, patch applications, and MCP calls are easier to inspect.

## User-facing behavior

1. The user starts the local server with a repository root.
2. The application scans the local Codex home and shows only matching sessions.
3. The user sees a session list with counts, sizes, timestamps, and failure indicators.
4. Opening a session shows the main timeline by default.
5. The user may switch between `Main timeline`, `Protocol layer`, and `Raw records`.
6. The user may search, filter by kind/status/file, and inspect grouped tool operations.
7. Clicking an event shows all underlying raw JSONL rows for verification.

## Acceptance criteria

- [ ] Main timeline does not show duplicated user or assistant messages when mirrored transcript channels exist.
- [ ] Protocol injections such as `AGENTS.md`, environment blocks, and developer instructions are accessible but not mixed into the default main timeline.
- [ ] Tool calls are visible as logical operations with status, affected files, and raw drill-down.
- [ ] Raw JSONL rows remain accessible for every logical event.
- [ ] Filtering by keyword, file, status, and event kind works across the selected layer.
- [ ] Repository filtering is case-insensitive on Windows paths.

## Edge cases

- Sessions with no `session_index.jsonl` entry
- Sessions with partial or malformed JSONL rows
- Old transcripts that only expose tool call plus output without an `event_msg:*_end` row
- Empty reasoning records
- Sessions that contain user-side protocol wrappers such as `<turn_aborted>` or `<user_shell_command>`

## Metrics

- Adoption: number of repository sessions loaded and revisited locally
- Success: time to locate a prior session or relevant command/file path
- Failure: duplicate content still visible in main timeline, or important protocol data impossible to recover
- Guardrail: raw row drill-down always remains available

## Open questions

- Whether protocol subtypes should get custom icons and richer inline summaries
- Whether session titles should be manually editable or inferred only
- Whether future transcript indexing should remain in-memory only or allow an optional local cache
