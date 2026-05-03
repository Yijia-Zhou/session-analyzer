# Transcript Normalization Follow-Ups

## Metadata
- Owner: repository maintainers
- Status: active
- Last updated: 2026-05-03
- Related spec:
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design:
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/documentation-system.md`

## Objective

Stabilize the new logical-event timeline so the main/protocol/raw layers are easier to trust and easier to maintain.

## Scope

### In scope
- Refine protocol subtype labels and summaries
- Improve session title inference
- Reduce noise from empty reasoning rows in the protocol layer
- Add targeted fixture coverage for more historical transcript shapes
- Document current normalization gaps
- Upgrade expanded timeline cards from preview-only text to structured field-level detail rendering

### Out of scope
- LLM summarization
- Persistent indexing
- Multi-user deployment

## Repository context

- Backend parser: `src/codex.js`
- HTTP API: `server.js`
- Frontend timeline rendering: `public/app.js`
- Current tests: `test/codex.test.js`
- Fixture transcripts: `test/fixtures/codex-home/sessions/...`

## Invariants

- Raw JSONL drill-down must remain available
- Main timeline must not regress into duplicate user/assistant messages
- Historical transcripts without newer `event_msg:*_end` rows must remain readable
- No transcript files are mutated

## Milestones

### Milestone 1 - Label quality
#### Changes
- Replace placeholder protocol labels such as `agents instructions`
- Give plan artifacts and protocol records more legible summaries

#### Validation
- Manually inspect the first protocol events from a real local session
- Confirm labels are readable in the browser and API payloads

#### Exit criteria
- Protocol layer labels explain what the event is without opening raw JSON

### Milestone 2 - Title and summary hygiene
#### Changes
- Tighten session title fallback rules
- Avoid protocol-heavy or garbled titles when no thread name exists

#### Validation
- Run a local index build against a real `.codex` directory
- Inspect the session list for current repository sessions

#### Exit criteria
- Session titles are stable enough for browsing and search

### Milestone 3 - Historical transcript coverage
#### Changes
- Add more fixtures for web search, old shell formats, protocol wrappers, and plan artifacts
- Expand tests for raw/protocol/main layer filtering

#### Validation
- `node --test`

#### Exit criteria
- Known transcript shapes are represented in tests

### Milestone 4 - Expanded detail reading quality
#### Changes
- Hide timeline preview text when a card is expanded so the card reads as preview-or-body, not preview-plus-body.
- Treat `markdown-it` as a required dependency and keep a lockfile so Markdown rendering does not silently degrade.
- Add Markdown fixture coverage for headings, tables, lists, raw HTML escaping, and dangerous link filtering.
- Style Markdown block elements for readable expanded cards.
- Avoid duplicate command output sections when stdout/stderr cannot be parsed as JSON or diff.
- Collapse `raw_json` sections by default outside the raw layer while keeping right-pane raw refs available.
- Limit detail loading to visible expanded cards, while loading immediately for user-triggered expansion.
- Hide low-information section titles when they only repeat the event header while preserving structural titles for metadata, streams, payloads, and raw JSON.

#### Validation
- `node test\codex.test.js`
- `node test\renderers.test.js`
- `node --check public\app.js`
- `node --check public\renderers.js`
- `node --check server.js`
- `node --check src\codex.js`

#### Exit criteria
- User/assistant Markdown messages render as structured Markdown in expanded cards.
- Expanded cards no longer repeat truncated preview text above the full body.
- Raw JSON remains available without dominating the main reading flow.

## Validation checklist
- [x] Syntax checks pass
- [x] Tests pass
- [x] Main timeline stays deduplicated
- [x] Protocol layer remains accessible
- [x] Raw refs still open all underlying JSONL rows

## Rollback notes

- If normalization changes hide important history, keep the raw layer unchanged and temporarily route affected cases back to protocol instead of main.
- Avoid deleting older fallback parsing paths until fixture coverage exists.

## Progress log

- 2026-04-21: Added logical-event normalization, protocol layer, raw layer, and tool-call grouping.
- 2026-04-21: Added fixture coverage for duplicated messages, protocol injections, and old/new patch formats.
- 2026-04-21: Documentation system scaffolded for this repository.
- 2026-04-21: Added `/api/sessions/:id/events/:eventId/detail`, section-based detail extraction, inline expanded-body rendering, and renderer tests.
- 2026-05-03: Tracking expanded-detail reading quality follow-up after finding preview/body duplication and silent Markdown fallback in the web UI.
- 2026-05-03: Implemented preview/body separation, required `markdown-it` lockfile, Markdown fixture coverage, Markdown styles, command output de-duplication, collapsible `raw_json`, and visible-card detail loading.
- 2026-05-03: Added `hideTitle` section rendering rule for redundant primary body titles such as Message, Plan, Reasoning, lifecycle notices, and protocol text.

## Decision log

- 2026-04-21: Kept active follow-up work in a separate plan instead of rewriting the completed baseline plan.

## Completion summary

Pending.
