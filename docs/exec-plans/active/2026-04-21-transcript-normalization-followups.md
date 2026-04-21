# Transcript Normalization Follow-Ups

## Metadata
- Owner: repository maintainers
- Status: active
- Last updated: 2026-04-21
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

## Validation checklist
- [ ] Syntax checks pass
- [ ] Tests pass
- [ ] Main timeline stays deduplicated
- [ ] Protocol layer remains accessible
- [ ] Raw refs still open all underlying JSONL rows

## Rollback notes

- If normalization changes hide important history, keep the raw layer unchanged and temporarily route affected cases back to protocol instead of main.
- Avoid deleting older fallback parsing paths until fixture coverage exists.

## Progress log

- 2026-04-21: Added logical-event normalization, protocol layer, raw layer, and tool-call grouping.
- 2026-04-21: Added fixture coverage for duplicated messages, protocol injections, and old/new patch formats.
- 2026-04-21: Documentation system scaffolded for this repository.

## Decision log

- 2026-04-21: Kept active follow-up work in a separate plan instead of rewriting the completed baseline plan.

## Completion summary

Pending.
