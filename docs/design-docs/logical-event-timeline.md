# Logical Event Timeline

## Metadata
- Owner: repository maintainers
- Status: accepted
- Last updated: 2026-04-21
- Related spec:
  - `docs/product-specs/session-transcript-analyzer.md`
- Related plans:
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

## Context

Codex transcript JSONL files contain multiple channels for the same semantic action. A user message can appear as both `response_item.message role=user` and `event_msg.user_message`. Assistant responses, reasoning, tool calls, and plan artifacts may also be mirrored or split across multiple rows. Transcript formats also evolve over time, so old sessions and new sessions cannot be normalized with a single simplistic rule.

The first version of this repository rendered raw records directly, which caused duplicate messages and exposed protocol injections in the main reading flow.

## Design goals

- Derive a stable, readable logical timeline from noisy raw transcript rows.
- Preserve traceability back to original JSONL lines.
- Support both newer and older Codex transcript formats.
- Keep the main timeline readable without hiding important debugging information forever.

## Non-goals

- Lossless semantic reconstruction of every historical transcript quirk
- Cloud-scale indexing or storage optimization
- Rewriting transcript files into a canonical on-disk format

## Proposed design

### High-level architecture

1. Parse JSONL into `rawEvents`.
2. Build `logicalEvents` on top of `rawEvents`.
3. Serve one of three layers:
   - `main`
   - `protocol`
   - `raw`

### Main components

- Raw parser in `src/codex.js`
- Logical-event builder in `src/codex.js`
- HTTP API in `server.js`
- Layer-aware UI rendering in `public/app.js`

### Data flow

1. Load session metadata and raw JSONL rows.
2. Annotate each raw row with extracted text, call IDs, command text, outputs, and touched files when available.
3. Group by `call_id` first for tool operations.
4. Walk the remaining rows in order and fold them into logical messages, reasoning entries, protocol events, lifecycle events, or plan artifacts.
5. Expose logical events to the main and protocol layers; expose raw rows separately.

## Data model / schema

### Raw event

Important fields:

- `rawId`
- `recordType`
- `payloadType`
- `role`
- `timestamp`
- `turnId`
- `callId`
- `messageText`
- `searchText`
- `commandText`
- `stdout`
- `stderr`
- `touchedFiles`
- `source`

### Logical event

Important fields:

- `id`
- `kind`
- `subtype`
- `layer`
- `role`
- `timestamp`
- `turnId`
- `preview`
- `searchText`
- `severity`
- `status`
- `toolName`
- `touchedFiles`
- `rawRefs[]`
- `channels[]`

### Event detail DTO

Expanded cards do not reuse `preview` for rich rendering. The server derives an `EventDetailDto` from the underlying logical event plus its referenced raw rows:

- `id`
- `kind`
- `subtype`
- `layer`
- `title`
- `meta`
- `rawRefs[]`
- `sections[]`

`meta` always includes `timestamp`, `turnId`, `status`, `severity`, `toolName`, `touchedFiles`, `outputStats`, `channels`, and `source`.

`sections[]` is a discriminated union of:

- `markdown`
- `code`
- `terminal`
- `json`
- `diff`
- `kv`
- `notice`
- `raw_json`

Expanded-card rendering treats `markdown-it` as a required server dependency. Markdown source is converted server-side with raw HTML disabled and dangerous link protocols rejected. In the main and protocol layers, `raw_json` sections are rendered as collapsible fallback material so the right-side raw refs panel remains the primary full-source view.

Sections may set `hideTitle: true` when the section title only restates the event header, such as the primary `Message`, `Plan`, `Reasoning`, or protocol text body. Renderer implementations should keep titles visible for structural sections such as stdout/stderr, metadata tables, request/response payloads, patch files, and raw JSON summaries.

## API / contract changes

- `/api/sessions/:id/timeline` accepts `layer=main|protocol|raw`
- `/api/sessions/:id/events/:eventId/detail?layer=main|protocol|raw` returns the structured detail DTO for one event
- Main and protocol layers return logical events
- Raw layer returns raw-record DTOs
- Event detail uses `rawRefs` so one logical event can expose multiple source rows

## Alternatives considered

### Render raw transcript rows directly

- Pros: simplest parser, minimal inference
- Cons: duplicates everywhere, protocol noise dominates, poor default reading experience
- Rejected because it breaks the product goal of readable repository history

### Hide duplicated channels without adding event layers

- Pros: smaller implementation change
- Cons: protocol rows and plan artifacts still lack a stable place to live
- Rejected because it treats symptoms but not transcript structure

### Persist a canonical normalized store

- Pros: faster reloads, easier offline analysis later
- Cons: storage versioning and migration complexity
- Deferred because current product still prefers in-memory local processing

## Risks and failure modes

- Over-aggressive deduplication may hide genuinely distinct rows
- Historical tool formats may not provide enough metadata for perfect normalization
- Protocol classification may need refinement as Codex transcript shapes evolve
- Search behavior may confuse users if matches only exist in protocol or raw layers

## Security / privacy / compliance

- All transcript data stays local
- No transcript mutation
- Raw transcript access remains explicit and traceable
- Derived logical events should not expose more than the source rows already contain

## Rollout plan

- Keep raw layer available during normalization rollout
- Default users to `main` layer
- Use `protocol` layer for debugging and classification validation
- Add fixture coverage for known transcript patterns before broadening rules

## Validation

- Parser tests covering mirrored message channels
- Tests for protocol classification and old/new patch formats
- Detail DTO tests covering structured sections for conversation, command, patch, plan, protocol, and raw fallback cases
- Renderer tests covering markdown/code/terminal/json/diff/notice output and escaping
- Manual verification against a real local `.codex` directory
- Confirm that one logical event can reveal all underlying raw rows

## Decision log

- 2026-04-21: Adopted the three-layer model (`main`, `protocol`, `raw`) instead of raw-only rendering.
- 2026-04-21: Treated protocol injections as first-class events instead of hiding them permanently.
- 2026-04-21: Grouped tool operations by `call_id` to make shell, patch, MCP, and JS REPL activity readable.
- 2026-04-21: Added server-side event-detail extraction plus a frontend renderer registry so expanded cards show structured content without trusting raw HTML from transcripts.
