# Canonical README showcase

`showcase/` is the long-lived, human-oriented source of truth for Session
Analyzer screenshots, GIFs, documentation visuals, release demos, and manual UI
inspection. It is completely synthetic and intentionally separate from
`test/fixtures/`: test fixtures optimize for parser assertions, compatibility,
negative cases, and edge coverage, while this data optimizes for human
readability and a believable coding-agent workflow.

The canonical story is the synthetic repository `acme/task-board`. Its parent
session is `Add project-wide search navigation`; neighboring sessions make the
repository history feel real, and `Write search navigation usage examples` is
a single ordinary subagent child used to show inherited context and navigation back
to the parent. This delegated documentation task intentionally reuses implementation
context; it is not an independent review. Keep README visuals in this story world
whenever possible.

派生会话使用普通 subagent 撰写搜索导航使用示例，复用实现上下文并展示返回父会话；
此示例是委派的文档任务，不是独立 review。

## Source and runtime data

The tracked source is the human-authored scenario at
`showcase/scenarios/readme/scenario.js`. It contains relative paths, readable
events, stable synthetic IDs, and deterministic dates; it must not contain
machine-specific absolute paths or copied private transcripts.

The tracked capture storyboards are:

```text
showcase/captures/readme/
├── search.json
├── branching.json
├── reading.json
└── project-search.json
```

They preserve the canonical README interaction sequences, frame timing, viewport
intent, and semantic keep/remove rules. Local manifests under
`output/readme-capture/` may add capture-specific details, but they are optional
generated artifacts and are not required for a fresh clone to reproduce the
storyboard.

The user-entry refresh uses `reading.json` for Timeline/Trajectory and patch
inspection, and `project-search.json` for a true transition from the parent
session to `Fix stale project rows after source switch`. Its query,
`npm test -- project-switch`, occurs only in that neighbor. The older
`search.json` remains a within-session navigation demonstration. The passing
parent command uses synthetic Node spec-reporter output. The parent contains ten
Main events and seven tool calls, including a read before the first patch and a
read between failure and repair. The assistant conclusion remains `12 tests passed`.
Both README languages share the English scenario and English UI captures.

用户入口重排使用 `reading.json` 展示 Timeline／Trajectory 与补丁检查，使用
`project-search.json` 从父会话跳转到 `Fix stale project rows after source switch`；
`npm test -- project-switch` 只存在于该相邻会话，`search.json` 仍展示会话内导航。
父会话使用合成 Node spec reporter 输出，包含十个 Main 事件和
七次工具调用：首次补丁前读取代码，失败与修复之间再次读取。最终 assistant 结论
仍为 `12 tests passed`。双语 README 共用英文场景与英文界面素材。

The initial files and both patches are checked in a disposable module: the first
patch produces eleven passing tests and one assertion failure; the repair passes
all twelve. This validates the small synthetic module only, not a full task-board
application, real agent session, or every neighboring session. Recorded timings
and reporter stack excerpts remain authored. The video's isolated probe verified
failure formatting only; its original passing story was not execution evidence.

初始文件和两次补丁在临时模块中核验：首次补丁后十一项通过、一项断言失败，修复
后十二项通过。此证据只覆盖小型合成模块，不代表完整 task-board 应用、真实 agent
会话或全部相邻会话。转录中的时长与报错堆栈节选仍为编写内容。视频阶段的隔离
probe 只验证失败格式，原有成功故事不是实际执行证据。

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
