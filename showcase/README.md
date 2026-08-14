# Canonical README showcase

`showcase/` is the long-lived, human-oriented source of truth for Session
Analyzer screenshots, GIFs, documentation visuals, release demos, and manual UI
inspection. It is completely synthetic and intentionally separate from
`test/fixtures/`: test fixtures optimize for parser assertions, compatibility,
negative cases, and edge coverage, while this data optimizes for human
readability and a believable coding-agent workflow.

The canonical story is the synthetic repository `acme/task-board`. Its parent
session is `Add project-wide search navigation`; neighboring sessions make the
repository history feel real, and `Review search navigation implementation` is
a single review-derived child used to show inherited context and navigation back
to the parent. Keep README visuals in this story world whenever possible.

## Source and runtime data

The tracked source is the human-authored scenario at
`showcase/scenarios/readme/scenario.js`. It contains relative paths, readable
events, stable synthetic IDs, and deterministic dates; it must not contain
machine-specific absolute paths or copied private transcripts.

The tracked capture storyboards are:

```text
showcase/captures/readme/
├── search.json
└── branching.json
```

They preserve the canonical README interaction sequences, frame timing, viewport
intent, and semantic keep/remove rules. Local manifests under
`output/readme-capture/` may add capture-specific details, but they are optional
generated artifacts and are not required for a fresh clone to reproduce the
storyboard.

Materialize a disposable Codex home and workspace with:

```text
node scripts/materialize-showcase.js
```

The generated layout is:

```text
output/showcase/
├── manifest.json
├── codex-home/
│   ├── config.toml
│   ├── session_index.jsonl
│   └── sessions/YYYY/MM/DD/rollout-*.jsonl
└── workspace/acme/task-board/
    ├── package.json
    ├── src/browser/...
    └── test/browser/...
```

The materializer supplies the absolute workspace path, Codex home layout,
session/index placement, and other runtime-only fields. Session Analyzer then
reads the generated JSONL through the normal Codex source adapter, parser,
index/API, and browser UI. Do not construct internal DTOs directly for a
showcase capture.

For derived sessions, `derivedFrom` identifies the parent,
`materializedFrom` identifies copied parent context, and `derivedKind` identifies
the supported provenance kind (`review` or `subagent`). The materializer validates
that kind and uses it for the generated Codex provenance metadata.

`output/` is intentionally gitignored, including `output/showcase/` and
`output/readme-capture/`. Candidate media remains disposable until a maintainer
manually promotes an approved asset to `docs/assets/readme/`; nothing is promoted
automatically. The tracked storyboards under `showcase/captures/readme/` are the
recoverable interaction contract, while local keyframes/GIFs remain disposable.
The showcase source, materializer, or capture output is not part of the npm
package (`package.json.files` does not include those paths). Only manually
promoted public README media under `docs/assets/readme/` is packaged with the
READMEs that reference it.

## Privacy rule

Never copy real or private Codex/Claude Code transcripts into this directory.
Prompts, usernames, repository names, local paths, file contents, credentials,
tokens, and environment details must remain synthetic and safe to publish. If a
real session inspires a useful composition, reproduce the composition with the
canonical data or another sanitized scenario instead of retaining the transcript.

For the detailed capture model, known failure modes, validation gates, and future
reshoot procedure, see
[`docs/design-docs/readme-visual-capture-runbook.md`](../docs/design-docs/readme-visual-capture-runbook.md).
