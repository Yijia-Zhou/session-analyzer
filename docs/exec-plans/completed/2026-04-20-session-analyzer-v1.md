# Session Analyzer V1

## Metadata
- Owner: repository maintainers
- Status: completed
- Last updated: 2026-04-21
- Related spec:
  - `docs/product-specs/session-transcript-analyzer.md`
- Related design:
  - `docs/design-docs/logical-event-timeline.md`

## Objective

Deliver a local web-based Codex session viewer with repository filtering, search, timeline browsing, folding profiles, and raw JSONL drill-down.

## Scope

### In scope
- Local HTTP server
- Repository-scoped session scanning
- In-memory indexing
- Search and filtering
- Timeline UI
- Folding profiles

### Out of scope
- Shared deployment
- Persistent index storage
- LLM-generated summaries

## Repository context

- Server entry: `server.js`
- Transcript parser: `src/codex.js`
- Folding profiles: `src/folding.js`
- Frontend UI: `public/`
- Tests: `test/codex.test.js`

## Invariants

- Transcript files stay read-only
- Main workflows must work without external services
- Raw transcript rows remain inspectable

## Milestones

### Milestone 1 - Baseline parser and API
#### Changes
- Added session scanning, session summaries, timeline API, and raw-row API

#### Validation
- Syntax checks and parser tests

#### Exit criteria
- Local server can list repository sessions and fetch timelines

### Milestone 2 - Browser UI
#### Changes
- Added session list, filters, timeline rendering, folding profiles, and detail panel

#### Validation
- Manual browser verification

#### Exit criteria
- Sessions can be browsed end to end in the local UI

### Milestone 3 - Test fixtures
#### Changes
- Added fixture Codex home and parser tests

#### Validation
- `node --test`

#### Exit criteria
- Core parser behavior is covered by repeatable tests

## Validation checklist
- [x] Unit-style parser tests pass
- [x] Local server starts
- [x] Main timeline renders
- [x] Raw JSONL drill-down works

## Rollback notes

- The project has no migration or persistent store, so rollback is file-based only.

## Progress log

- 2026-04-20: Created initial local web app structure.
- 2026-04-20: Added parser, HTTP API, and UI skeleton.
- 2026-04-20: Added folding profiles and fixture tests.

## Decision log

- 2026-04-20: Chose a dependency-light Node application instead of a larger framework.
- 2026-04-20: Kept indexing in memory for the initial version.

## Completion summary

V1 shipped as a usable local repository-scoped transcript browser. Later work moved into transcript normalization and layered timeline follow-ups.
