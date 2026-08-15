# README Visual Capture Runbook

## Status and scope

- Status: accepted documentation baseline for the synthetic README showcase.
- Last updated: 2026-08-14.
- Canonical source: showcase/ and scripts/materialize-showcase.js.
- Tracked storyboards: showcase/captures/readme/search.json and
  showcase/captures/readme/branching.json.
- Candidate capture output: output/readme-capture/.
- Final public media: docs/assets/readme/, published only after manual approval.

This is a durable design/runbook document, not an implementation plan and not a
product specification. It records how to resume README visual work without
repeating the earlier discovery pass or treating a capture-tool limitation as a
product bug.

The current Search and Branching captures were accepted for publication. The
Hero story and composition were also accepted at a deliberate stopping point
despite the documented capture-boundary imperfection.
Do not use this runbook as permission to change parser semantics,
source-switching semantics, fork ownership, logical-event normalization, or
browser layout. A capture problem belongs here first; a product change requires
its own design/spec and test work.

Throughout this document:

- Stable rule means a decision future capture work should preserve.
- Confirmed observation means behavior observed during the previous capture work;
  it may depend on the browser/backend version and is not a portable constant.
- Hypothesis means a possible explanation or workaround that was not accepted
  until measured. Do not promote a hypothesis to a fix without validation.

## 1. System model

The visual system has four deliberately separate layers:

| Layer | Path | Role | Change policy |
| --- | --- | --- | --- |
| Canonical tracked source | showcase/ | Human-readable, synthetic, portable story data and tracked capture storyboards | Edit deliberately; this is the source of truth. |
| Generated runtime materialization | output/showcase/ | Machine-local Codex home and workspace consumed by the real application | Regenerate from source; never hand-edit or commit. |
| Capture output | output/readme-capture/ | Candidate PNGs, GIFs, keyframes, manifests, and capture notes | Disposable and ignored; do not treat as approved public media. |
| Final approved media | docs/assets/readme/ | Manually selected assets referenced by the README | Promote only after human review at README scale. |

The separation is important for three different kinds of reproducibility:

- showcase/ keeps the story reviewable in a code review. It avoids absolute
  paths, browser state, binary noise, and accidental private data. Its tracked
  storyboards preserve the interaction contract without tracking every local
  screenshot or GIF.
- output/showcase/ provides the exact on-disk layout expected by the Codex
  source adapter. Absolute paths, session filenames, index placement, and other
  host-specific details belong here, not in the scenario.
- output/readme-capture/ lets a maintainer compare candidate framing without
  pretending that a screenshot or GIF is canonical data.
- docs/assets/readme/ is a publication boundary. A capture is not public just
  because it exists locally, and no script should silently promote it.

The repository-wide rule is:

> Test fixtures answer “can we prove the parser behaves correctly?” Showcase
> data answers “can a human immediately understand why the product is useful?”

test/fixtures/ is intentionally optimized for parser assertions,
compatibility, negative cases, malformed input, and edge conditions. It is not a
visual design library. Do not merge showcase content into test fixtures merely
to reuse a convenient JSONL shape, and do not redesign existing fixtures to
improve their readability.

The showcase instead optimizes for human readability, a realistic coding-agent
workflow, visual clarity, stable reproducibility, privacy safety, and
representative product value. It must still exercise the real parser and browser
pipeline.

output/ is ignored by the repository’s .gitignore; this intentionally covers
both output/showcase/ and output/readme-capture/. The npm package boundary is
independent of Git ignore rules: package.json files lists the runtime and public
source tree plus manually approved README media under docs/assets/readme/, not
showcase/, scripts/materialize-showcase.js, or output/.

## 2. Canonical story world

All three README visuals should preferably come from one small, coherent
development history. The current world is:

| Role | Synthetic identity | Purpose |
| --- | --- | --- |
| Repository | acme/task-board | Repository-scoped history and readable paths. |
| Parent | Add project-wide search navigation | Hero timeline and Search GIF. |
| Derived child | Review search navigation implementation | One review-derived/materialized child for the Branching GIF. |
| Neighbor | Fix stale project rows after source switch | Natural repository history. |
| Neighbor | Review search count navigation | Search-related history without duplicating the parent. |
| Neighbor | Improve fork relationship display | Relationship-related history. |
| Neighbor | Update browser regression coverage | Browser/test history. |

The canonical scenario is
showcase/scenarios/readme/scenario.js. It is a compact human-authored model,
not hand-written final JSONL. The parent workflow is intentionally short:

1. One user request for project-wide search navigation.
2. A short plan covering the search flow, stable match targets, a regression
   test, and focused checks.
3. A small read/search operation.
4. One or two patches touching the search implementation and regression test.
5. A natural failed focused test with the message
   Expected next search target to be materialized.
6. A follow-up patch.
7. A successful npm test -- search-navigation result containing
   12 tests passed.
8. A short assistant summary.

The stable visual anchors are:

- src/browser/app.js
- src/browser/search-navigation.js
- test/browser/search-navigation.test.js
- searchMatchCount
- materializeSearchTarget
- npm test -- search-navigation
- npm run build:check

Names such as src/browser/search-navigation.js and
test/browser/search-navigation.test.js make a synthetic transcript feel like a
small real repository. They give search, patch, and command cards something
meaningful to say. Names such as foo.js, hello.txt, my-project, or do something
communicate only “fixture” and make the UI harder to understand at a glance.
This is why the showcase uses realistic-but-fictional names rather than toy
placeholders.

The review child is intentionally narrow. It is one child, derived from the
parent, with review provenance and inherited context. Do not add subagents,
multiple relationship kinds, Earlier Branch, and materialized fork variants to
the same GIF just to increase feature coverage. One clear relationship is more
valuable than a taxonomy tour.

All showcase content is synthetic. Do not paste real prompts, usernames, local
paths, private repository names, file contents, environment values, credentials,
tokens, or other private transcript material into the scenario. A real session
may inspire a composition, but the final source must reproduce that composition
with synthetic data.

## 3. Real data path

The intended path for every README visual is:

~~~
human-authored canonical scenario
  -> scripts/materialize-showcase.js
  -> Codex-compatible JSONL + Codex home + synthetic workspace
  -> real Codex source adapter and parser
  -> real index and API
  -> real Session Analyzer browser UI
  -> screenshot/GIF capture
~~~

The visuals are not mocked from Session Analyzer’s internal DTOs. This matters:
the showcase is evidence that project discovery, session discovery, parsing,
logical-event construction, search, relationship resolution, detail APIs, and
browser rendering work together for a believable transcript.

### Canonical versus generated fields

The scenario keeps canonical:

- project display name and relative workspace path;
- synthetic repository files;
- session titles and relationship keys;
- readable event text, commands, outputs, patches, status, and turn names;
- deterministic session IDs, dates, and times.

The materializer generates or resolves:

- the absolute repository path under the local checkout;
- the Codex home directory and config.toml project entry;
- sessions/YYYY/MM/DD/rollout-*.jsonl placement;
- session_index.jsonl entries;
- ISO timestamps with deterministic per-event offsets;
- the absolute session_meta.cwd used for repository discovery;
- the duplicated parent records required by the Codex materialized-child shape.

For readability, command arguments use the portable synthetic workdir
acme/task-board, while session metadata still carries the materialized absolute
workspace path needed by discovery. This is a deliberate presentation choice
inside the generated runtime, not a reason to put host paths in the canonical
scenario.

The materializer currently clears only its generated target output/showcase/,
recreates the workspace and Codex home, and writes a manifest.json identifying
the source scenario. Do not run it as part of a capture-only closeout when
preserving an existing runtime is important; when regeneration is desired,
remember that output/showcase/ is disposable and must be rebuilt rather than
edited by hand.

For derived sessions, `derivedFrom` names the logical parent,
`materializedFrom` names the copied parent context, and `derivedKind` selects the
supported provenance metadata. The current materializer supports `review` and
`subagent` and fails closed for an unknown or missing kind. It does not mutate
the canonical event objects while adding runtime timestamps.

A complete Claude dataset is not required for this README package. Add a
synthetic Claude source only when a future storyboard actually depends on a
Claude-specific visual; do not construct a parallel dataset for symmetry alone.

## 4. Materialize and launch

From the repository root:

~~~powershell
node --check scripts/materialize-showcase.js
node scripts/materialize-showcase.js
~~~

The materializer prints the generated Codex home and workspace paths. The
expected tree is:

~~~
output/showcase/
├── manifest.json
├── codex-home/
│   ├── config.toml
│   ├── session_index.jsonl
│   └── sessions/
│       └── 2026/08/10, 2026/08/11, 2026/08/12/rollout-*.jsonl
└── workspace/acme/task-board/
    ├── package.json
    ├── src/browser/app.js
    ├── src/browser/search-navigation.js
    └── test/browser/search-navigation.test.js
~~~

For a local capture server, use the generated paths explicitly and keep the
server on loopback. The port is an example; choose an unused local port if the
default is occupied:

~~~powershell
$repo = (Resolve-Path 'output/showcase/workspace/acme/task-board').Path
$codexHome = (Resolve-Path 'output/showcase/codex-home').Path
node server.js --source codex --repo $repo --codex-home $codexHome --port 17892
~~~

The repository’s AGENTS.md contains the approved hidden Start-Process variant
for a persistent local server. Do not bind a showcase server to a
network-facing host. Before opening the capture page, confirm:

1. Transcript Source is Codex.
2. The project is acme/task-board.
3. The history list contains the parent, the four neighbors, and the one review
   child relationship.
4. The parent title and child title match the canonical scenario.
5. A reload still discovers the same project and sessions.

Do not use the real default ~/.codex home for a public-material capture. The
explicit generated home is the privacy and reproducibility boundary.

## 5. Selected README narrative and current state

The selected package has three non-duplicative jobs.

### Hero: what is Session Analyzer?

Start with the parent session, repository history visible at left, a readable
Main/Narrative timeline in the middle, and structured Inspector/detail at right.
The selected event is the successful npm test -- search-navigation command; the
timeline or detail must visibly retain the human-readable 12 tests passed result.
The Hero should feel like a tool for browsing, searching, and explaining agent
work history, not a raw JSONL viewer.

Do not make Raw JSON, Protocol noise, the source chooser, Folding Strategy, a
search popover, a giant command output, or a failure the Hero’s main visual.
The Inspector proves that the timeline can be drilled into; it does not need to
carry every metadata field in one frame.

When still available locally, capture files include:

- output/readme-capture/hero-a-polished-1536.png — the best current comparison
  baseline for a future Hero reshoot.
- output/readme-capture/hero-a-polished-1600.png — the neighboring wide-viewport
  comparison candidate.
- output/readme-capture/hero-a-polished-final.png — the earlier named H-A
  baseline, useful for comparison but not a reason to reopen discovery.

The last file inspection recorded these dimensions; treat them as observations
of the current candidates, not as guarantees for a future browser backend:

| Candidate family | Observed dimensions |
| --- | ---: |
| `hero-a-polished-1536.png` | 1495×874 PNG |
| `hero-a-polished-1600.png` | 1495×874 PNG |
| `hero-a-polished-final.png` | 1485×906 PNG |
| Search keyframes | 1416×884 PNG |
| Branching keyframes | 1416×884 PNG |

The 1536 candidate is the recommended baseline because it represents the latest
capture-boundary comparison. It is not described as perfect: the wider viewport
experiments did not prove that the entire Inspector/top-right boundary was
reliably captured. The Hero story and composition are accepted, and further
boundary optimization is intentionally paused. A future agent should compare
against this baseline rather than start by inventing a new Hero concept.

Earlier H-A frames also showed why selection and scroll position matter: the
Inspector’s visible area could be dominated by Metadata, Source, Raw refs, Run
context, and Arguments while the most communicative `12 tests passed` output sat
near the bottom of the timeline. Do not force every result field into the right
column. Keep the successful Command selected, let the timeline carry the result
when necessary, and use the Inspector to prove structured drill-down.

### Search GIF: how do I quickly find what happened?

When still available locally, the current candidate is
output/readme-capture/search/search.gif, with keyframes and timings in
the tracked storyboard showcase/captures/readme/search.json. When available
locally, output/readme-capture/search/manifest.json adds capture-specific
metadata:

| State | Hold | Meaning |
| --- | ---: | --- |
| 01-clean-main.png | 1000 ms | Parent session in clean Main timeline. |
| 02-query-entered.png | 900 ms | search-navigation.test.js, with search feedback visible. |
| 03-jump-highlight.png | 4100 ms | One Next action lands on the target Patch; the exact test file is highlighted and structured detail remains visible. |

The intended chain is:

~~~
clean Main timeline
  -> enter search-navigation.test.js
  -> Next once
  -> jump to the matching Patch
  -> hold with highlighted filename, result card, and structured detail
~~~

The candidate is approximately six seconds and uses the current 10 fps,
keyframe-hold approach. It is about 0.85 MB in the current capture directory.
The semantic target is the Patch result, not the earlier rg -n command.

### Branching GIF: can I understand derived work and return to its source?

When still available locally, the current candidate is
output/readme-capture/branching/branching.gif, with keyframes and timings in
the tracked storyboard showcase/captures/readme/branching.json. When available
locally, output/readme-capture/branching/manifest.json adds capture-specific
metadata. It is approximately eight seconds and 1.53 MB at the current 10 fps
encoding:

| State | Hold | Meaning |
| --- | ---: | --- |
| 01-parent-collapsed.png | 1000 ms | Parent selected; the one child relationship is collapsed. |
| 02-child-expanded.png | 1300 ms | Review search navigation implementation appears under the parent with Review provenance. |
| 03-child-inherited-context.png | 3300 ms | Child selected; Materialized fork and inherited-context summary/counts are visible; Latest inherited Main events (8) stays collapsed and Open parent remains in view. |
| 04-parent-returned.png | 2400 ms | Open parent returns to the parent timeline while the relationship remains expanded. |

The intended chain is:

~~~
parent
  -> expand the one child relationship
  -> open Review search navigation implementation
  -> show Materialized fork + inherited session context summary
  -> Open parent session
  -> return to parent with the relationship still understandable
~~~

The relationship is a review-derived Codex child with materialized fork storage.
Do not add several child types to this story. The GIF is about provenance and
return navigation, not about exhaustively demonstrating fork taxonomy.

In the current UI, keeping `Latest inherited Main events (8)` collapsed is what
leaves the inherited summary/counts and `Open parent session` action visible.

### Deliberately deprioritized opening scenes

Protocol and Raw remain important product layers, but they require more schema
context before a first-time viewer understands the value. Source chooser and
runtime source switching are useful workflow features, but they make the first
frame about configuration rather than agent work history. Folding presets and
error focus are helpful secondary interactions, but they do not explain the
product as quickly as the Hero, Search, and Branching package. These can appear
later in a feature showcase or technical documentation once the core story is
understood.

## 6. Recommended capture workflow

This is the stable procedure for a future reshoot. It is intentionally narrow;
it is not a new discovery exercise.

### Prepare

1. Read this runbook, showcase/README.md, AGENTS.md, and the relevant source
   adapter/fork/search/detail docs before touching the browser.
2. Check the current branch, worktrees, and git status --short. Preserve
   unrelated WIP and never clean another worktree.
3. Materialize only when the generated runtime is intentionally being rebuilt.
4. Launch the analyzer against the generated Codex home and workspace.
5. Verify the project, parent session, child title, and neighboring history.

### Reproduce the state

Use the normal browser controls and real APIs. For the Hero, set the parent
session, Main/Narrative layer, timeline position, selected successful command,
and Inspector position before taking a screenshot. For Search and Branching,
follow the tracked storyboard sequence and timing. Use local manifests only when
available for capture-specific clip or encoder details. Wait for stable content, then remove
loading spinners, tooltips, transient popovers, and mouse travel from the final
sequence.

Do not use DOM/CSS mutations, synthetic internal DTOs, or product-code changes
to make a frame fit. A capture-only state adjustment is acceptable; a semantic
or layout change belongs in a separate product task.

### Measure before committing to a viewport

For the Hero, compare 1536×900 and 1600×900 only as measured experiments. At
minimum record:

- requested browser viewport;
- window.innerWidth and window.innerHeight;
- document.documentElement.scrollWidth and scrollHeight;
- the actual right edge of the Inspector and top-right controls;
- horizontal overflow and scrollbar presence;
- the actual screenshot pixel dimensions and file format.

Do not infer the capture boundary from the requested viewport. If the panel is
outside the actual screenshot boundary, the candidate fails even when the
scrollbar is hidden.

### Review at publication scale

Inspect the native image for clipping and then inspect a scaled copy at roughly
900–1000 px rendered README width. A 1400–1600 px native screenshot can look
excellent while its event text, Inspector labels, or relationship affordance
becomes unreadable in a GitHub README. A temporary mock Markdown/HTML preview is
useful for this check; it must remain disposable and must not modify README
content or be committed.

### Capture outputs

Keep the current conventions:

- If still available locally, Hero candidates live directly under
  output/readme-capture/.
- If still available locally, GIF keyframes and generated manifests live under
  output/readme-capture/search/ or output/readme-capture/branching/.
- The tracked storyboard records viewport intent, timing, interaction sequence,
  semantic keep list, and removed interactions. A local manifest may additionally
  record the actual clip, encoder, and generated frame filenames.
- Use 8–12 fps for mostly stable UI. Hold semantic states instead of encoding
  unnecessary mouse travel, long scrolling, loading, or per-character typing.
- Do not promote to docs/assets/readme/ in the capture task.

## 7. Capture and tooling pitfalls

The following are confirmed observations from the prior capture work, not claims
that every browser/backend version will produce identical numbers.

### Requested viewport is not screenshot content width

The 1536×900 and 1600×900 Hero attempts demonstrated that increasing the
requested browser viewport can increase layout space without expanding the final
effective screenshot boundary in the way expected. In one measurement, the
1536 layout had a document width around 1582 px and the Inspector right edge was
around 1521 px, while the top-right reset control extended to roughly 1582 px. At
1600, the corresponding values grew to roughly 1646 px and 1585 px. The pattern
was “the page grew with its overflow”; it was not proof that every visible
control was inside the capture.

Some standard viewport captures from those attempts were written as 1495×874
PNG files even though the requested viewport was 1536 or 1600. Earlier candidates
were 1416×884 or 1485×906. These numbers are useful evidence that the requested
size and output size are different variables, not portable constants.

Before trying another width, inspect the requested viewport, the layout viewport,
the document scroll width, the page’s min-width/overflow behavior, the actual
panel bounds, and the capture API’s output. Do not blindly continue to 1700 or
1800 after this evidence appears.

### Horizontal overflow is a real failure, even when it looks cosmetic

Hero attempts showed a visible horizontal scrollbar, clipped top-right controls,
and an Inspector extending beyond the effective image boundary. Removing or
cropping the scrollbar region can make the bottom edge look cleaner without
bringing the Inspector or Reset control into the image. The Hero acceptance gate
is the complete intended panel boundary, not merely “no scrollbar visible.”

An out-of-viewport clip was also not a reliable recovery technique; at least one
boundary clip produced an empty or otherwise unusable result. Measure the
available content area first and keep the clip inside the capture surface.

### Inspector selection controls the composition

Large Patch or raw-detail selections can force a dense, awkward Inspector. The
successful Command detail, with the 12 tests passed result visible in the
timeline or detail, made a better Hero state. Select the semantic result first,
then adjust the Inspector’s own scroll position. If the structured detail cannot
show every desirable field at once, let the middle timeline carry the human
readable result and let the Inspector prove structured drill-down.

### Browser zoom is not a proven workaround

Normal browser zoom experiments during this effort did not change the measured
visualViewport.scale or innerWidth in the in-app browser, so they did not
provide a validated fix. Do not report zoom as a solution unless the browser
actually changes the measured layout and the resulting image is rechecked.
Distinguish normal, user-visible browser zoom from DOM/CSS style.zoom or other
capture-only hacks; the latter must not be used to falsify the product layout.

### Screenshot bytes may not match the requested extension

The browser screenshot interface returned JPEG bytes during a PNG-oriented
workflow. Writing those bytes to a .png filename did not make them PNGs. The
validated conversion path was:

~~~powershell
ffmpeg -y -loglevel error -i capture.jpg -frames:v 1 capture.png
~~~

Then validate both the PNG signature and its dimensions. A minimal Node check is:

~~~powershell
node -e "const fs=require('fs'); const p=process.argv[1]; const b=fs.readFileSync(p); const sig=Buffer.from([137,80,78,71,13,10,26,10]); if (!b.subarray(0,8).equals(sig)) throw new Error('not a PNG'); console.log(p, b.readUInt32BE(16)+'x'+b.readUInt32BE(20));" 'output/readme-capture/hero-a-polished-1536.png'
~~~

Use an actual image probe when available as a second check. Always inspect the
file, not the requested viewport, before recording dimensions in a local
manifest. This check applies only when the candidate file is still available;
the tracked storyboard does not depend on the PNG.

### GIFs should start as keyframes plus a manifest

The first useful deliverable was PNG keyframes and JSON manifests rather than a
new GIF dependency. This made the story reviewable, allowed timing changes
without recapturing the browser, and kept the repository/runtime small. The
eventual candidates were encoded with the existing ffmpeg installation at
10 fps, holding stable keyframes instead of producing a 30/60 fps recording:

- Search: search/search.gif, approximately 0.85 MB, six seconds.
- Branching: branching/branching.gif, approximately 1.53 MB, eight seconds.

If the encoder or timing changes later, preserve the keyframes and manifest even
when a new GIF is generated. A manifest is the reproducible interaction contract;
the GIF is only one rendering of it.

### README-scale review is a separate gate

Native-size inspection is necessary for clipping, but it is not sufficient for
publication. The earlier review used a temporary README/mock Markdown context
and scaled copies around 960 px wide. Repeat that check after any new candidate.
Look specifically for:

- readable session titles and event cards;
- a recognizable three-column Hero at a glance;
- a query, target count, and highlighted file in Search;
- a visible provenance label, inherited-context summary, and Open parent action
  in Branching.

## 8. Lessons from the final story refinement

### Search: stop at the semantic payoff

The first Search storyboard reached a strong state after Next landed on the Patch
for test/browser/search-navigation.test.js, with highlighted filename,
touched-file detail, and a human-readable result card. An additional frame then
selected the earlier rg -n Command so that more technical detail would be
visible. That detour made the motion feel like it had jumped away from the
answer it had just found.

The current sequence ends on the Patch result itself:

~~~
clean -> query established -> Next once -> jump/highlight + Patch detail -> hold
~~~

General rule: do not add an interaction merely because it exposes another
technical field. Once the visual story has reached its semantic payoff, hold that
state and end. The tracked `showcase/captures/readme/search.json` is the
known-good timing and interaction contract. A local
`output/readme-capture/search/manifest.json` may mirror or refine capture details,
but do not reintroduce the old fourth detail transition.

The search popover’s intermediate text may say that more jump targets could be
available. That is acceptable as a brief transition state; it should not be held
long enough to compete with the final target.

### Branching: provenance beats feature coverage

The first Branching frame expanded all eight inherited Main events. It proved
that inheritance existed, but the event dump consumed the frame and hid the
important Open parent session affordance. It asked the viewer to read evidence
instead of understanding the relationship.

The current child frame keeps the inherited event list collapsed while showing:

1. parent provenance (Review · from ...);
2. Materialized fork;
3. inherited session context and counts;
4. Open parent session.

The priority is therefore:

~~~
relationship -> inherited-context existence -> return affordance -> detailed events
~~~

This is a general capture rule: provenance comprehension matters more than
maximizing the number of product features visible in one GIF. Keep the tracked
`showcase/captures/readme/branching.json` four-state sequence and one-child
constraint; use the local manifest only when available.

## 9. What not to repeat

| Attempt | Why it seemed reasonable | What actually happened | Check first next time |
| --- | --- | --- | --- |
| Repeatedly increase the Hero viewport after the first wide attempts | More width should include the right Inspector. | The layout and overflow grew with the viewport; the effective screenshot boundary still differed. | Measure layout/content/capture widths and panel bounds before another width. |
| Maximize Inspector information density | More metadata could make the product look powerful. | Large Patch/raw details pushed the Hero toward a metadata viewer and reduced readability. | Select the successful Command; let timeline and Inspector share the story. |
| Treat scrollbar disappearance as a fix | A clean bottom edge looks like a fixed overflow. | The Inspector or top-right controls could still be clipped. | Confirm the complete panel boundary and controls are inside the image. |
| Expand every inherited event | It proves real inherited history exists. | Eight cards made the Branching frame noisy and hid Open parent. | Keep the list collapsed; show summary/count and return action. |
| Add a Search detail transition after the jump | It exposes another technical operation. | It moves away from the exact result and weakens the narrative. | Hold the first state that simultaneously shows query, hit, and detail. |
| Assume .png means PNG | The workflow was intended to produce PNG screenshots. | The browser returned JPEG bytes under the PNG-oriented workflow. | Inspect magic bytes and dimensions; convert explicitly. |
| Use normal zoom without measuring it | Zoom might reduce layout pressure. | In this browser it did not change measured scale/layout. | Measure visualViewport.scale and innerWidth; do not claim success without an image check. |
| Clip beyond the known capture surface | A larger clip might include the missing right edge. | An out-of-range clip produced an unusable/blank result. | Keep clip inside the actual surface or fix the capture setup separately. |

These were capture/tooling dead ends, not evidence that the product needs a semantic
redesign. If a future run reproduces a real UI bug independent of the capture
boundary, record it as a separate “README capture blocker” and open a separate
product follow-up rather than changing the product during a reshoot.

## 10. Capture blockers and acceptance gates

### Current README capture blocker

- Current behavior: the Hero’s wide-viewport experiments can leave the
  effective image boundary different from the requested viewport; the right
  Inspector boundary and top-right controls are not proven to be fully inside
  every candidate. A visible horizontal scrollbar has also appeared in earlier
  attempts.
- Why it harms the visual: clipping makes a polished three-column overview look
  like a broken responsive layout and weakens the Inspector’s drill-down promise.
- Scope: capture-only. The underlying product story, parser, and UI semantics are
  not being changed.
- Follow-up: if publication later requires a cleaner Hero, perform one measured
  capture-only comparison against the 1536 baseline. Do not reopen discovery or
  broaden the storyboard unless the product narrative changes.

### Hero gates

- No horizontal scrollbar in the final image.
- No visibly clipped top-right controls.
- The complete intended Inspector boundary is inside the image.
- Repository/session history is visible at left, readable Main/Narrative events
  are visible in the middle, and the structured Inspector is recognizable at
  right.
- The successful npm test -- search-navigation command and human-readable
  12 tests passed result remain visible.
- The image is readable around 900–1000 px rendered README width.
- No private data, loading spinner, tooltip, transient popover, or layout flash.

### Search GIF gates

- The query search-navigation.test.js is understandable.
- Search count and Next/jump feedback are visible during the transition.
- The exact test file is visibly highlighted at the target.
- The structured detail supports the same semantic target as the highlighted
  event.
- There is no old Command detour, extra Next click, long scroll, or slow typing.
- The final state has a useful hold and can loop without a jarring transition.

### Branching GIF gates

- The parent identity is clear.
- Exactly one derived child is shown.
- Review · from ... or an equivalent provenance label is legible.
- Materialized fork and inherited-context existence/counts are clear.
- The inherited-event list does not hide Open parent session.
- The return action visibly lands back on the parent.
- There is no large inherited-event dump, extra relationship taxonomy, loading
  state, or tooltip artifact.

All three assets must pass the privacy gate and the actual-file format/dimension
gate before promotion. “Looks good at native resolution” is not an acceptance
gate by itself.

## 11. Validation commands

The following commands were used successfully during the showcase/materialization
work or during this documentation closeout. A documentation-only change does not
need the full product matrix again. Commands explicitly described as follow-ups
are recommendations for source changes, not claims about this closeout.

### Source/materializer changes

~~~powershell
node --check scripts/materialize-showcase.js
node scripts/materialize-showcase.js
node --test test/materialize-showcase.test.js
node --test test/codex-search.test.js test/codex-forks.test.js test/codex-fork-review-markers.test.js test/codex-detail.test.js
npm run build:check
~~~

The materializer-focused test covers TOML paths containing apostrophes,
canonical-event immutability, and `derivedKind` provenance dispatch. The
materializer command is intentionally omitted from capture-only work when the
existing generated runtime must be preserved.

The synthetic command text npm test -- search-navigation belongs to the showcase
story; it is not a substitute for the repository’s own test command.

For a broader source/runtime validation after source or product changes, the
repository command is:

~~~powershell
npm run release:check
~~~

That command includes npm run build:check, the Node test suite, and
npm run test:package. It was not needed again for this documentation-only
closeout. The package smoke check was run directly and can also be repeated:

~~~powershell
npm run test:package
~~~

Use npm run test:browser when browser behavior itself has changed; it is not
required for a capture-only timing or framing adjustment. For a package boundary
dry run, use the repository’s normal npm tooling without publishing. If the
default npm cache is not writable in a sandbox, use an explicit temporary cache
as in the successful validation below:

~~~powershell
$cache = Join-Path (Get-Location) '.tmp-npm-cache-validation'
npm pack --dry-run --ignore-scripts --cache $cache
~~~

Confirm that showcase/, output/, and capture-only support files do not appear in
the package listing, then remove the temporary cache within the repository if
one was created.

### Privacy and generated-data checks

Scan the canonical data and materializer source, not only the generated output:

~~~powershell
rg -n -i -e '\bsk-[A-Za-z0-9]{16,}\b' -e '\bgh[pousr]_[A-Za-z0-9]{16,}\b' -e '\bBearer\s+[A-Za-z0-9._-]{16,}\b' -e 'BEGIN [A-Z ]+PRIVATE KEY' -e '(^|[\\/])Users[\\/]' showcase/scenarios scripts/materialize-showcase.js
~~~

Treat any match as a review prompt. The scan is not a proof of privacy: inspect
prompts, paths, repository names, file contents, environment details, and IDs
manually, and ensure they are synthetic.

### Worktree and file checks

~~~powershell
git status --short
git diff --check
~~~

For capture candidates, validate the actual file type and dimensions as shown in
the screenshot-encoding section. Do not add ignored runtime output just to make
the validation visible in Git.

## 12. Current known-good state and limits

The durable state to resume from is:

- Canonical source and materializer are established and should be extended rather
  than replaced.
- The tracked Search and Branching storyboards under
  showcase/captures/readme/ are the recoverable interaction contract; local
  output/readme-capture manifests are optional generated evidence.
- The parent/neighbor/child story is natural enough for long-lived documentation
  use.
- The tracked `showcase/captures/readme/search.json` storyboard expresses Search
  → Jump → Detail without the old Command detour. Its approved publication copy
  is `docs/assets/readme/search-and-jump.gif`; when still available locally,
  `output/readme-capture/search/search.gif` is the source candidate.
- The tracked `showcase/captures/readme/branching.json` storyboard expresses
  Parent → Derived Child → Inherited Context → Parent with one child and a
  visible return action. Its approved publication copy is
  `docs/assets/readme/derived-session-provenance.gif`; when still available
  locally, `output/readme-capture/branching/branching.gif` is the source
  candidate.
- The Hero composition is the accepted first-impression concept, published as
  `docs/assets/readme/session-analyzer-overview.png`.
- If still available locally, `hero-a-polished-1536.png` is the baseline for any
  future Hero reshoot; `hero-a-polished-1600.png` is its width comparison and
  `hero-a-polished-final.png` is the earlier reference.
- Publication was a deliberate manual step; ignored candidates under
  output/readme-capture/ remain disposable and are never promoted automatically.

The unresolved imperfection is specifically capture-boundary reliability around
the Hero’s right side and top-right controls. The published Hero was accepted at
a deliberate stopping point, but it is not claimed to be perfectly solved.
Do not hide this fact by calling a crop “complete” or by assuming that a removed
scrollbar proves that the Inspector is fully visible. The appropriate future
action is a small, measured capture-only reshoot if publication requires it—not
another open-ended visual discovery cycle.

No product behavior was changed to obtain the current package. Search and
Branching story decisions, manifests, keyframes, and product code are considered
stable for now.

## 13. Future Hero reshoot checklist

When a future maintainer resumes this work:

1. Read this runbook, showcase/README.md, and the tracked storyboard files under
   showcase/captures/readme/; do not restart visual discovery
   unless the README product narrative has changed.
2. Inspect git status --short, branch, and worktrees. Preserve unrelated WIP.
3. Materialize the canonical showcase only if the runtime needs rebuilding.
4. Launch Session Analyzer with the generated Codex home and workspace.
5. Confirm acme/task-board, Add project-wide search navigation, the four
   neighboring sessions, and the review child.
6. Reproduce the known Hero baseline: repository history, Main/Narrative timeline,
   selected successful npm test -- search-navigation, visible 12 tests passed,
   and structured Inspector.
7. Change only capture state: viewport, browser zoom if it genuinely works,
   timeline/Inspector scroll position, and selected event. Do not modify scenario
   semantics or product code.
8. Measure requested viewport, layout viewport, scroll width, panel bounds,
   overflow, and actual output dimensions. Compare 1536×900 and 1600×900 only
   when the measurements justify it.
9. Reject any candidate with a clipped panel/control, scrollbar artifact, tooltip,
   loading state, private data, invalid image bytes, or unreadable README-scale
   text.
10. Review at approximately 900–1000 px rendered width, then leave the candidate
    in output/readme-capture/ for human review.
11. Promote manually approved media to docs/assets/readme/ only in a separate,
    explicit publication step.

Do not capture, regenerate, or promote assets merely because a fresh agent has
started. The purpose of this document is to make the next capture deliberate,
bounded, and reproducible.
