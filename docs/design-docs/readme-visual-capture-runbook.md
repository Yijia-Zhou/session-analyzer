# README Visual Capture Runbook

## Status and scope

- Status: accepted documentation baseline for the synthetic README showcase.
- Last updated: 2026-09-20.
- Canonical source: showcase/ and scripts/materialize-showcase.js.
- Current storyboards: showcase/captures/readme/reading.json, project-search.json,
  and branching.json. The same directory retains search.json as an unreferenced
  legacy storyboard; search-and-jump.gif is not in either current README.
- Candidate capture output: output/readme-capture/.
- Final public media: docs/assets/readme/, published only after manual approval.

### Current scenario refresh / 当前场景更新

The 2026-09-19 scenario selectively incorporates the video's two code reads and
failure-format improvements, retaining English and the compact source helpers.
The parent now has ten Main events / seven tool calls; its materialized child has
26 inherited Raw Records supporting ten Main events and one Protocol event.
The child is now the ordinary subagent `Docs`, titled `Write search navigation
usage examples`: a delegated documentation task that intentionally reuses parent
context, not an independent review. Its recorded provenance is `subagent`.
Current indexing reports six Sessions, 30 Logical Events, and 89 Raw Records.
The tracked storyboards describe this updated source. Historical capture counts
and dimensions below describe the previously approved assets, not this refresh.

2026-09-19 场景选择性吸收视频中的两次代码读取和失败格式改进，保留英文及紧凑的
源文件辅助函数。父会话现有十个 Main 事件／七次工具调用；物化子会话的 26 条
继承 Raw Records 支持十个 Main 事件及一个 Protocol 事件。子会话现为普通
subagent `Docs`，标题为 `Write search navigation usage examples`：它是有意复用
父会话上下文的委派文档任务，不是独立 review；记录的来源类型为 `subagent`。
当前索引结果为六个
会话、30 个逻辑事件、89 条原始记录。受版本管理的分镜对应新场景；下文历史取景
中的计数与尺寸描述此前获批素材，不代表本次更新。

Both failed and passing commands use synthetic Node spec-reporter output. The
initial source, patch, failure read, assertion location, and repair agree; the
count function continues to return a number. The focused scenario check applies
the two patches and executes this small module in a temporary directory, observing
11 pass / 1 fail and then 12 pass. This is new, bounded module evidence, not evidence
that the full task-board story or the video's original successful transcript ran.
The video probe supplied only a failure-format reference. Transcript timings and
stack excerpts remain authored and paths are portable.

失败和成功命令统一采用合成 Node spec reporter 输出。初始源码、补丁、失败后的
读取、断言位置和修复相互一致；计数函数仍返回数字。聚焦场景检查在临时目录中
应用两次补丁并执行该小型模块，观察到十一项通过／一项失败，随后十二项通过。
这是本次新增且范围有限的模块证据，不证明完整 task-board 故事或视频原有成功
转录实际运行过。视频 probe 仅提供失败格式参考；转录时长与堆栈节选仍为编写
内容，路径保持可移植。

Candidate media and evidence are in `output/readme-capture/refresh-2026-09-19/`;
see the [completed record](../exec-plans/completed/2026-09-19-readme-showcase-refresh.md).
Four PNGs and the two currently referenced GIFs are regenerated. Preserve their
original jobs: the overview uses Timeline with the successful command expanded,
the reading pair compares Timeline and Trajectory, and operation detail shows the
expanded patch. Only the dedicated Trajectory image uses that presentation.
The two GIFs use 900px-high viewports and one-second real timeline scrolls to keep
patch details readable; do not replace concrete work with an overview to fit it
on one screen. The overview is a scrolled work segment, not all ten events at once.
File search now shows 1 / 4 then 2 / 4 targets and five full-text
occurrences; the next target is still the first patch. The unreferenced historical
`search-and-jump.gif` has not been regenerated.

候选素材与证据位于 `output/readme-capture/refresh-2026-09-19/`，见上述执行交接记录。
已重新生成四张 PNG 和 README 当前引用的两份 GIF。保留原来的呈现分工：主图为
Timeline 并展开成功命令，阅读对照图比较 Timeline 与 Trajectory，操作图展示
展开补丁；只有专门的 Trajectory 图片使用该呈现。两份 GIF 使用 900px 高视口，
通过一秒的真实时间线滚动保留补丁可读性，不为塞入一屏而把具体工作改为概览。
主图是滚动后的工作片段，不声称同时显示全部十个事件。
文件搜索现为 1 / 4 → 2 / 4 跳转目标、五次
全文出现，下一目标仍是首个补丁；未重拍当前未引用的历史 `search-and-jump.gif`。

The maintainer approved all six current candidates on 2026-09-19. They were copied
byte-for-byte into `docs/assets/readme/`, and both READMEs now describe the subagent
example. Development README media uses relative `docs/assets/readme/` links so
the images follow the current ref. The release runbook still requires matching
immutable raw-content URLs before packing a release. No tag, public repository
or npm artifact was changed by this local promotion.

维护者于 2026-09-19 批准全部六份当前候选，已逐字节复制到 `docs/assets/readme/`，
双语 README 也已改用 subagent 示例文案。开发 README 的媒体使用相对
`docs/assets/readme/` 链接，使图片跟随当前 ref；发布手册仍要求打包前转换为
匹配的不可变 raw 内容 URL。本次本地替换未修改 tag、公开仓库或 npm 制品。

This is a durable design/runbook document, not an implementation plan and not a
product specification. It records how to resume README visual work without
repeating the earlier discovery pass or treating a capture-tool limitation as a
product bug.

All six current assets were accepted on 2026-09-19. Earlier capture-boundary
experiments below are historical evidence. Future captures must still pass the
current gates in section 10.
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

All six current README assets should come from one small, coherent
development history. The current world is:

| Role | Synthetic identity | Purpose |
| --- | --- | --- |
| Repository | acme/task-board | Repository-scoped history and readable paths. |
| Parent | Add project-wide search navigation | Overview, reading/operation PNGs, and starting session for both GIFs. |
| Derived child | Write search navigation usage examples | One ordinary subagent, nickname Docs, with materialized context for the Branching GIF. |
| Neighbor / search target | Fix stale project rows after source switch | Destination for npm test -- project-switch. |
| Neighbor | Review search count navigation | Search-related history without duplicating the parent. |
| Neighbor | Improve fork relationship display | Relationship-related history. |
| Neighbor | Update browser regression coverage | Browser/test history. |

The canonical scenario is
showcase/scenarios/readme/scenario.js. It is a compact human-authored model,
not hand-written final JSONL. The parent workflow is intentionally short:

1. One user request for project-wide search navigation.
2. A short plan covering the search flow, stable match targets, a regression
   test, and focused checks.
3. A code read before the first patch.
4. A patch touching the search implementation and regression test.
5. A failed focused test with synthetic Node spec-reporter output (11 pass / 1 fail).
6. A failure-context read followed by the repair patch.
7. A successful npm test -- search-navigation result (12 pass).
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

The documentation child is intentionally narrow: one ordinary subagent named
Docs, titled Write search navigation usage examples, with subagent provenance
and ten inherited Main events. Do not add more children, multiple relationship
kinds, Earlier Branch, or materialized fork variants just to increase coverage.
One clear relationship is more valuable than a taxonomy tour.

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
3. The history list contains six sessions: the parent, four neighbors, and one
   ordinary subagent child relationship.
4. The child is Subagent Docs, titled Write search navigation usage examples;
   its provenance is Subagent · from ... and it has ten inherited Main events
   (26 inherited Raw Records and one inherited Protocol event).
5. Indexing completes with 30 Logical Events, 89 Raw Records, and zero diagnostics;
   a reload still discovers the same project and sessions.
6. Search npm test -- project-switch: no match in the parent, then exactly one
   matching session / one event under Entire project. Open Fix stale project rows
   after source switch and verify Project switch suite / 8 tests passed.

Do not use the real default ~/.codex home for a public-material capture. The
explicit generated home is the privacy and reproducibility boundary.

## 5. Selected README narrative and current state

### Current six-asset contract / 当前六份素材契约

Both READMEs reference these four PNGs and two GIFs under docs/assets/readme/.
Use the current source and storyboards when reshooting; the 2026-09-19 approved
assets and completed refresh record are the comparison baseline.

双语 README 引用下列四张 PNG 和两份 GIF。重拍遵循当前源码与分镜，以 2026-09-19
获批素材及已完成的更新记录为对照基线。

| Asset | Current job / 当前用途 | Contract |
| --- | --- | --- |
| session-analyzer-overview.png | Timeline overview with successful command / 展开成功命令的 Timeline 总览 | Hero gates; approved 1600×1000 baseline |
| session-reading-timeline.png | Folded Timeline reading / 折叠 Timeline 阅读 | reading.json |
| session-reading-trajectory.png | Same ten Main events in Trajectory / 同十个 Main 事件的 Trajectory | reading.json |
| operation-detail.png | Expanded first patch and result / 展开的首个补丁及结果 | reading.json |
| project-search-and-read.gif | Find another session and read it / 找回另一会话并阅读 | project-search.json; 1240×900, 13.4s |
| derived-session-provenance.gif | Subagent Docs, inherited context, return / Subagent Docs、继承上下文与返回 | branching.json; 1440×900, 9s |

search.json and docs/assets/readme/search-and-jump.gif are an **unreferenced
legacy storyboard/asset** for within-session navigation. The storyboard follows
the updated source, but the old GIF was not regenerated. Neither defines current
README Search gates.

search.json 与 docs/assets/readme/search-and-jump.gif 是当前 README **未引用的
历史分镜／素材**，用于会话内导航。分镜已随源码更新，旧 GIF 未重拍；两者均不
定义当前 README 搜索验收要求。

### Current project-search GIF

Follow showcase/captures/readme/project-search.json. Begin in Add project-wide
search navigation with the first patch expanded; preserve the one-second real
Timeline scroll. Search npm test -- project-switch: Current session shows
No matches / 0 / 0. Choose Entire project through the scope pill; the sole
matching session/event is Fix stale project rows after source switch. Open it,
expand/select its Command, and hold on Project switch suite, 8 tests passed,
and surrounding messages. The six held states plus ten scroll frames at 10 fps
total 13.4s. This is a same-project, same-source A-to-B story.

### Current Branching GIF

Follow showcase/captures/readme/branching.json. The child is Subagent Docs,
titled Write search navigation usage examples, with subagent provenance and
materialized fork storage. The five held states plus a one-second real scroll
total 9s at 10 fps:

| State | Hold | Meaning |
| --- | ---: | --- |
| 01-parent-collapsed.png | 1000 ms | Parent Timeline; first patch expanded/selected and readable; one child relationship collapsed. |
| 02-child-expanded.png | 1300 ms | Write search navigation usage examples appears with Subagent Docs provenance. |
| 03-child-inherited-context.png | 3300 ms | Subagent · from ..., Materialized fork, and inherited summary visible; Latest inherited Main events (10) collapsed; Open parent visible. |
| 04-parent-returned.png | 700 ms | Open parent returns to the parent Timeline at its top; patch and relationship remain expanded. |
| 05-parent-patch.png | 1700 ms | After a 1000 ms real scroll, the complete first patch is visible with result/files in the Inspector. |

Keep the inherited list collapsed and show only this one child relationship.
Current approved evidence, when locally available, lives under
output/readme-capture/refresh-2026-09-19/; the final Branching keyframes/concat
are branching-subagent/ and branching-subagent.txt.

### Historical three-asset package / 历史三素材组合

The following 2026-09-08/09 notes, Hero experiments, within-session Search, and
review-child Branching sequence record the previous package. Paths, counts,
timings, and recommendations in this subsection are historical evidence only;
they do not govern current materialization, capture, acceptance, or reshoots.
Use the current contracts above and gates in section 10 instead.

下列 2026-09-08/09 记录、Hero 实验、会话内搜索及 review 子会话分镜属于此前组合。
本小节路径、计数、时长及建议仅保留为历史经验，不指导当前物化、取景、验收或
重拍；当前操作遵循上文契约及第 10 节验收要求。

The 2026-09-08 user-entry refresh leads with reviewing session work, inspecting
one operation, and finding an older session to continue reading. Its tracked
contracts are `showcase/captures/readme/reading.json` and `project-search.json`.
The overview and branching assets remain reusable; the descriptions below record
the previously accepted package, rather than proving the new project-search
scenario. Candidate refresh media lives in `output/readme-capture/entry/` until
the existing human review boundary is satisfied.

2026-09-08 用户入口重排优先展示回顾会话工作、查看一次操作、找回旧会话继续阅读，
分镜记录在上述两个新增文件中。总览与关联素材可复用；下文记录此前已接受的素材，
不能作为新的项目搜索场景证据。新候选素材在既有人工审阅完成前保存在
`output/readme-capture/entry/`。

On 2026-09-09, the maintainer reviewed and approved all four refresh assets.
`session-reading-timeline.png`, `session-reading-trajectory.png`,
`operation-detail.png`, and `project-search-and-read.gif` were copied unchanged
into `docs/assets/readme/`; SHA-256 comparisons confirmed candidate identity,
and the npm pack manifest includes all four. The README references now resolve
without the local preview mapping.

2026-09-09，维护者审阅并认可全部四份新素材。上述文件已原样复制至正式素材目录，
SHA-256 核验确认与认可候选一致，npm 打包清单包含全部四份文件。
README 引用已无需本地预览映射即可解析。

Timeline places the expanded patch changes in the center and its result/files
in Supplemental Detail on the right. Trajectory places the selected event's
Primary Detail on the right. Reading captions must describe the actual placement.
For the search story, capture the complete search/session-list/reading region;
the Inspector is not required because the matching command and output are visible
in the expanded Timeline event. Do not use CSS edits to hide layout overflow.

Timeline 将展开的补丁修改放在中间，将结果／文件放在右侧补充详情；Trajectory
将所选事件的主体详情放在右侧。图注必须描述实际位置。搜索故事捕获完整的搜索、
会话列表与阅读区域；命中命令与输出已在展开事件内可见，因此不要求包含 Inspector。
不得通过修改 CSS 隐藏布局溢出。

The previously selected package had three non-duplicative jobs.

#### Historical Hero: what is Session Analyzer?

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

- output/readme-capture/hero-a-polished-1536.png — the historical comparison
  baseline for the earlier Hero experiments.
- output/readme-capture/hero-a-polished-1600.png — the neighboring wide-viewport
  comparison candidate.
- output/readme-capture/hero-a-polished-final.png — the earlier named H-A
  baseline, useful for comparison but not a reason to reopen discovery.

The last file inspection recorded these dimensions; treat them as observations
of the historical candidates, not as guarantees for a future browser backend:

| Candidate family | Observed dimensions |
| --- | ---: |
| `hero-a-polished-1536.png` | 1495×874 PNG |
| `hero-a-polished-1600.png` | 1495×874 PNG |
| `hero-a-polished-final.png` | 1485×906 PNG |
| Search keyframes | 1416×884 PNG |
| Branching keyframes | 1416×884 PNG |

The 1536 candidate was the recommended baseline for that earlier
capture-boundary comparison. It is not described as perfect: the wider viewport
experiments did not prove that the entire Inspector/top-right boundary was
reliably captured. The Hero story and composition are accepted, and further
boundary optimization is intentionally paused. For current reshoots, use the approved overview listed above; these old files
remain optional capture-boundary comparisons.

Earlier H-A frames also showed why selection and scroll position matter: the
Inspector’s visible area could be dominated by Metadata, Source, Raw refs, Run
context, and Arguments while the most communicative `12 tests passed` output sat
near the bottom of the timeline. Do not force every result field into the right
column. Keep the successful Command selected, let the timeline carry the result
when necessary, and use the Inspector to prove structured drill-down.

#### Historical Search GIF: how do I quickly find what happened?

When still available locally, the historical candidate is
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

The candidate is approximately six seconds and uses the then-used 10 fps,
keyframe-hold approach. It is about 0.85 MB in the historical capture directory.
The semantic target is the Patch result, not the earlier rg -n command.

#### Historical Branching GIF: can I understand derived work and return to its source?

When still available locally, the historical candidate is
output/readme-capture/branching/branching.gif, with keyframes and timings in
the tracked storyboard showcase/captures/readme/branching.json. When available
locally, output/readme-capture/branching/manifest.json adds capture-specific
metadata. It is approximately eight seconds and 1.53 MB at the then-used 10 fps
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

In that earlier UI capture, keeping `Latest inherited Main events (8)` collapsed is what
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
5. Apply section 4 startup checks: six sessions, Subagent Docs with ten inherited
   Main events, and the unique project-search destination.
6. Identify affected assets from the current six-asset table. Use reading.json,
   project-search.json, and branching.json; search.json is legacy.

### Reproduce the state

Use the normal browser controls and real APIs. For the Hero, set the parent
session, Main/Narrative layer, timeline position, selected successful command,
and Inspector position before taking a screenshot. For reading/operation PNGs,
follow reading.json; for project-search and Branching, follow project-search.json
and branching.json, including their one-second real scrolls. Use local manifests
only when available for capture-specific clip or encoder details. Wait for stable
content, then remove
loading spinners, tooltips, transient popovers, and mouse travel from the final
sequence.

Do not use DOM/CSS mutations, synthetic internal DTOs, or product-code changes
to make a frame fit. A capture-only state adjustment is acceptable; a semantic
or layout change belongs in a separate product task.

### Measure before committing to a viewport

For the Hero, start from the approved 1600×1000 overview. Change dimensions
only as measured experiments; the older 1536×900/1600×900 trials are historical. At
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

- Current approved refresh evidence, when locally available, lives under
  output/readme-capture/refresh-2026-09-19/. Use a distinct directory under
  output/readme-capture/ for new candidates and record it in the manifest.
- Older search/ and branching/ directories retain historical evidence; do not
  assume their media matches current source or approved assets.
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
- the project-search query, scope transition, unique result, and expanded
  matching Command in the destination session;
- a visible provenance label, inherited-context summary, and Open parent action
  in Branching.

## 8. Lessons from the final story refinement

### Historical within-session Search lesson (unreferenced legacy asset)

The first Search storyboard reached a strong state after Next landed on the Patch
for test/browser/search-navigation.test.js, with highlighted filename,
touched-file detail, and a human-readable result card. An additional frame then
selected the earlier rg -n Command so that more technical detail would be
visible. That detour made the motion feel like it had jumped away from the
answer it had just found.

The legacy sequence ended on the Patch result itself:

~~~
clean -> query established -> Next once -> jump/highlight + Patch detail -> hold
~~~

General rule: do not add an interaction merely because it exposes another
technical field. Once the visual story has reached its semantic payoff, hold that
state and end. The tracked `showcase/captures/readme/search.json` retains the
legacy demo contract. Current README Search uses `project-search.json` and ends
on the other session’s matching Command and surrounding context. A local
`output/readme-capture/search/manifest.json` may mirror or refine capture details,
but do not reintroduce the old fourth detail transition.

The search popover’s intermediate text may say that more jump targets could be
available. That is acceptable as a brief transition state; it should not be held
long enough to compete with the final target.

### Branching: provenance beats feature coverage

The historical review-child frame expanded all eight inherited Main events.
It proved that inheritance existed, but the event dump consumed the frame and hid the
important Open parent session affordance. It asked the viewer to read evidence
instead of understanding the relationship.

The current child frame keeps the inherited event list collapsed while showing:

1. Subagent Docs identity and parent provenance (Subagent · from ...);
2. Materialized fork;
3. inherited context with Latest inherited Main events (10) collapsed;
4. Open parent session.

The priority is therefore:

~~~
relationship -> inherited-context existence -> return affordance -> detailed events
~~~

This is a general capture rule: provenance comprehension matters more than
maximizing the number of product features visible in one GIF. Keep the tracked
`showcase/captures/readme/branching.json` five-state sequence, real scroll, and one-child
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

### Historical Hero capture limitation

These observations describe earlier experiments. The approved 2026-09-19
overview is the current baseline; reassess the risks on each new candidate.

- Previously observed behavior: the Hero’s wide-viewport experiments can leave the
  effective image boundary different from the requested viewport; the right
  Inspector boundary and top-right controls are not proven to be fully inside
  every candidate. A visible horizontal scrollbar has also appeared in earlier
  attempts.
- Why it harms the visual: clipping makes a polished three-column overview look
  like a broken responsive layout and weakens the Inspector’s drill-down promise.
- Scope: capture-only. The underlying product story, parser, and UI semantics are
  not being changed.
- Follow-up: if publication later requires a cleaner Hero, perform one measured
  capture-only comparison against the approved 1600×1000 overview. Do not reopen discovery or
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

### Reading and operation PNG gates

- The reading pair uses the same ten loaded Main events and final assistant
  selection. Timeline folds the plan/tools while retaining messages; Trajectory
  expands the seven-call Tool Activity Group.
- The operation PNG shows the first two-file patch expanded and selected in
  Timeline: readable highlighted changes in the center, result/files/Raw entry
  in Supplemental Detail at right.
- Captions match actual presentation and detail placement; partial coverage is
  not described as a full-session overview.

### Current project-search GIF gates

- Asset: project-search-and-read.gif; contract: project-search.json.
- npm test -- project-switch is readable, with No matches / 0 / 0 in the parent
  under Current session before choosing Entire project.
- Scope choices and exactly one matching session / one event are visible;
  the destination is Fix stale project rows after source switch.
- Opening the result visibly changes sessions; the expanded/selected Command
  shows Project switch suite, 8 tests passed, and surrounding messages.
- Preserve the one-second real Timeline scroll and readable patch context;
  no slow typing, loading waits, or unrelated detail detours.
- Capture the complete search/list/reading region; Inspector is not required.
- The final reading state has a useful hold and loops without a jarring transition.
- Legacy search.json / search-and-jump.gif do not satisfy these gates.

### Branching GIF gates

- The parent identity is clear.
- Exactly one ordinary subagent child is shown: Subagent Docs, titled
  Write search navigation usage examples.
- Subagent · from ... is legible.
- Materialized fork and Latest inherited Main events (10) are clear; inherited
  context corresponds to 26 Raw Records and one Protocol event.
- The inherited-event list does not hide Open parent session.
- The return action visibly lands back on the parent Timeline, followed by the
  storyboard’s one-second real scroll to the expanded patch.
- There is no large inherited-event dump, extra relationship taxonomy, loading
  state, or tooltip artifact.

All six current README assets (four PNGs and two GIFs) must pass the privacy
gate and actual-file format/dimension gate before promotion. “Looks good at native resolution” is not an acceptance
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
- Current recoverable contracts are reading.json, project-search.json, and
  branching.json under showcase/captures/readme/. Local manifests are optional
  generated evidence; the current six-asset table defines public scope.
- The parent/neighbor/Subagent Docs story is the canonical world, with ten
  inherited Main events in the child.
- project-search-and-read.gif uses npm test -- project-switch and moves from the
  parent to Fix stale project rows after source switch to resume reading.
- derived-session-provenance.gif uses Subagent provenance and a visible return
  action, then scrolls to the parent patch.
- search.json and search-and-jump.gif are an unreferenced legacy storyboard/asset,
  not the current Search publication contract.
- The approved overview is docs/assets/readme/session-analyzer-overview.png
  (1600×1000); use it as the Hero reshoot baseline. Older hero-a-polished PNGs,
  when available, are historical comparisons only.
- Publication was a deliberate manual step; ignored candidates under
  output/readme-capture/ remain disposable and are never promoted automatically.

Earlier Hero experiments exposed capture-boundary uncertainty around the right
side and top-right controls. Preserve that lesson: a removed scrollbar alone
does not prove a complete Inspector. Future reshoots must measure actual output
and pass section 10 against the current approved baseline.

No product behavior was changed to obtain the current package. Search and
Branching story decisions, manifests, keyframes, and product code are considered
stable for now.

## 13. Future Hero reshoot checklist

When a future maintainer resumes this work:

1. Read this runbook, showcase/README.md, and current reading.json,
   project-search.json, and branching.json storyboards. search.json is legacy;
   do not restart visual discovery unless the README product narrative has changed.
2. Inspect git status --short, branch, and worktrees. Preserve unrelated WIP.
3. Materialize the canonical showcase only if the runtime needs rebuilding.
4. Launch Session Analyzer with the generated Codex home and workspace.
5. Apply section 4 checks: acme/task-board, the parent, four neighbors, and
   Subagent Docs (Write search navigation usage examples), with ten inherited
   Main events and `Subagent · from ...`. Verify npm test -- project-switch
   finds only the intended neighbor under Entire project.
6. Reproduce the approved 1600×1000 Hero baseline: repository history, Main/Narrative timeline,
   selected successful npm test -- search-navigation, visible 12 tests passed,
   and structured Inspector. Preserve the scrolled work segment; do not claim
   all ten events are visible at once.
7. Change only capture state: viewport, browser zoom if it genuinely works,
   timeline/Inspector scroll position, and selected event. Do not modify scenario
   semantics or product code.
8. Measure requested viewport, layout viewport, scroll width, panel bounds,
   overflow, and actual output dimensions. Compare alternative dimensions with
   the current baseline only when measurements justify it.
9. Reject any candidate with a clipped panel/control, scrollbar artifact, tooltip,
   loading state, private data, invalid image bytes, or unreadable README-scale
   text.
10. Review at approximately 900–1000 px rendered width in both READMEs; confirm
    all six current assets still resolve and apply relevant section 10 gates.
    Keep project-search-and-read.gif as current Search, not search-and-jump.gif.
    Leave candidates in output/readme-capture/ for human review.
11. Promote manually approved media to docs/assets/readme/ only in a separate,
    explicit publication step.

Do not capture, regenerate, or promote assets merely because a fresh agent has
started. The purpose of this document is to make the next capture deliberate,
bounded, and reproducible.
