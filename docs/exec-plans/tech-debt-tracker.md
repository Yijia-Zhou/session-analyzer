# Tech Debt Tracker

## Open items

### 1. Protocol label quality
- Status: open
- Problem: some protocol event labels are still generic or mechanically derived
- Related docs:
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

### 2. Historical transcript coverage
- Status: open
- Problem: many older transcript shapes are only partially represented in fixtures
- Related docs:
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

### 3. Session title inference
- Status: open
- Problem: fallback titles can still be noisy when thread naming is missing
- Related docs:
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

### 4. Optional persistent index
- Status: deferred
- Problem: startup cost may grow once the local transcript corpus becomes much larger
- Related docs:
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/design-docs/logical-event-timeline.md`
