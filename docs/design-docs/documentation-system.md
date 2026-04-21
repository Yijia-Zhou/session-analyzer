# Documentation System

## Metadata
- Owner: repository maintainers
- Status: accepted
- Last updated: 2026-04-21
- Related spec:
  - `docs/product-specs/session-transcript-analyzer.md`
- Related plans:
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

## Context

This repository started as a small local tool, but it already has user-facing behavior, internal normalization logic, and ongoing implementation work. Without a consistent documentation split, repository intent would drift into ad hoc chat history and oversized top-level instructions.

## Goals and constraints

- Keep `AGENTS.md` short and navigational.
- Separate external behavior from internal design from step-by-step execution.
- Make active implementation plans self-contained enough for a new executor to continue the work.
- Keep filenames searchable by topic and status.

## Proposed design

### `AGENTS.md`

- Repository navigation only
- Update rules for documentation
- Pointers to the current spec, design docs, and plans

### `docs/product-specs/`

- One document per product behavior area
- Focus on user-visible behavior, goals, non-goals, and acceptance criteria

### `docs/design-docs/`

- One document per important internal model or architectural decision
- Must include alternatives and risks, not just the chosen design

### `docs/exec-plans/active/`

- Self-contained plans for in-progress work
- Must include repository context, invariants, milestones, validation, and a running progress log

### `docs/exec-plans/completed/`

- Archived plans with completion summaries
- Used as historical implementation records

### `docs/exec-plans/tech-debt-tracker.md`

- Cross-plan debt that would otherwise be forgotten
- Each entry should point back to the related spec or design doc where possible

## Alternatives considered

### Keep everything in AGENTS.md

- Pros: one file to search
- Cons: too much context, high drift risk, poor separation of concerns
- Rejected

### Keep only execution plans

- Pros: less writing up front
- Cons: product intent and design rationale get lost in tactical runbooks
- Rejected

### Use only generic templates without current project docs

- Pros: low effort
- Cons: creates a structure without actual repository knowledge inside it
- Rejected

## Risks

- Empty document trees that look formal but do not guide implementation
- Specs drifting away from current UI behavior
- Completed plans becoming the only place where important design decisions are recorded

## Validation

- Every major feature should be traceable from spec -> design -> active/completed plan
- AGENTS should remain small enough to read quickly
- New contributors should be able to identify current product intent without replaying prior chats

## Decision log

- 2026-04-21: Chose a three-tier documentation system with repository-specific starter docs instead of template-only scaffolding.
