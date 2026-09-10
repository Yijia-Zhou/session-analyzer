# Session Analyzer

[中文说明](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/README.zh-CN.md)

**Local session history viewer for Codex, Claude Code, and DeepSeek Harness.**

**See what your AI did and how it did it.** Tool calls and long outputs can bury the conversation and make individual operations hard to review. Session Analyzer keeps messages and tool activity readable together, with commands, file changes, and results you can open in context. Browse and search earlier sessions by project when you need to find the work first.

Session Analyzer reads existing transcripts locally, without modifying or uploading their contents. Review the saved history of a current or past session in your browser.

[Quick Start](#quick-start) · [Read a session](#review-what-happened-in-a-session) · [Inspect an operation](#inspect-how-a-concrete-operation-was-performed) · [Search history](#find-an-older-session-and-continue-reading)

![Session Analyzer with project sessions on the left, readable work in the middle, and command details on the right](https://raw.githubusercontent.com/Yijia-Zhou/session-analyzer/v0.2.0/docs/assets/readme/session-analyzer-overview.png)

Keep the surrounding work in view while checking a specific operation. All demonstrations below use synthetic Codex transcripts.

## Quick Start

Use **Node.js 24** (recommended) and npm.

**Choose your version:** npm **0.2.0** is publicly available and supports Codex, Claude Code, and DeepSeek Harness, including Timeline and Trajectory. Use the matching package commands below.

Choose one command for your transcript source:

```sh
# Codex
npx session-analyzer@0.2.0
```

```sh
# Claude Code
npx session-analyzer@0.2.0 --source claude-code
```

```sh
# DeepSeek Harness
npx session-analyzer@0.2.0 --source deepseek-harness
```

For local checkout development or validation, run from the Analyzer checkout:

```sh
node server.js --source deepseek-harness
```

Open **<http://127.0.0.1:17890/>**, choose your project, wait for indexing, and open a session from the left panel. Start reading in **Main timeline**. To search older sessions, click the **session** scope pill beside search, then choose **Entire project**.

To select a project at startup, add `--repo /path/to/project`. On Windows:

```powershell
npx session-analyzer@0.2.0 --repo 'C:\path\to\project'
```

`--repo` is the project whose history you want to read. The Analyzer checkout or installation and the transcript root are separate locations. An agent can follow the [startup and verification guide](https://github.com/Yijia-Zhou/session-analyzer/blob/51a9ec530b1a9c03f3d96761632baa05590ccefe/docs/usage/agent-quickstart.md) to configure them for you.

## Review what happened in a session

In the example below, the agent changes two files, encounters a failed test, applies a follow-up patch, and reruns the test. Read messages and tool activity in order in the default **Timeline**, folding output and opening details as needed.

![Folded Timeline keeps messages and tool activity readable in a tool-heavy synthetic session](https://raw.githubusercontent.com/Yijia-Zhou/session-analyzer/v0.2.0/docs/assets/readme/session-reading-timeline.png)

When tool calls get noisy, switch to **Trajectory** to review the same conversation and tool activity in a compact view. Expand a tool group to inspect individual operations; use the sequence overview to navigate.

![The same session segment in Trajectory, with readable messages and compact, expandable tool activity](https://raw.githubusercontent.com/Yijia-Zhou/session-analyzer/v0.2.0/docs/assets/readme/session-reading-trajectory.png)

Both views show currently loaded events; load more to continue through a long session.

## Inspect how a concrete operation was performed

To check a particular change or failed command, expand its event in **Timeline**, or select the operation in **Trajectory**. Timeline shows command output and highlighted changes within the event, with supporting details on the right; Trajectory opens the selected operation's details on the right. Inspect what was requested and returned while keeping the surrounding work in view.

![An expanded Timeline patch shows highlighted changes in the center, with its result, files, and source information on the right](https://raw.githubusercontent.com/Yijia-Zhou/session-analyzer/v0.2.0/docs/assets/readme/operation-detail.png)

Read what was requested, what changed, and what the tool returned, then continue through the session. **Protocol layer** exposes supporting runtime records. **Raw records** and an event's Raw References let you check the original transcript entries when structured detail is insufficient.

## Find an older session and continue reading

Remember a filename, command, or phrase but not the session? Click the **session** scope pill beside search, choose **Entire project**, and search messages, commands, file paths, and outputs. Open a match to reach the other session and its matching event, then read the surrounding work.

![Starting in one session, searching the entire project, and opening a match in another session to resume reading](https://raw.githubusercontent.com/Yijia-Zhou/session-analyzer/v0.2.0/docs/assets/readme/project-search-and-read.gif)

The demonstration starts in session A, searches for `npm test -- project-switch`, and finds the command in session B. It ends at B's matching operation and context. For your own history, use a filename, command, or phrase you remember. Search is case-insensitive plain text; separate file, type, and status filters narrow results. Text such as `status:failed` is searched literally.

## More context when you need it

- **Related sessions:** follow supported review, subagent, and fork relationships, inspect inherited context, and return to the parent session. Availability follows each source's recorded relationships.
- **Code Mode:** inspect supported operations inside tool orchestration through structured requests and results. Coverage depends on the source and recorded evidence.
- **Codex token and cache observations:** inspect per-request token accounting and conservatively inferred drops in cache reuse, with supporting Protocol evidence. These do not establish cache expiry or server-side cache state.

![A synthetic Codex review-derived session shows inherited context and navigation back to its parent](https://raw.githubusercontent.com/Yijia-Zhou/session-analyzer/v0.2.0/docs/assets/readme/derived-session-provenance.gif)

This Codex review example demonstrates inherited-context navigation. See [source support and boundaries](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/docs/design-docs/transcript-source-adapters.md) for differences between sources.

## Sources and requirements

| Source | Default transcript root | Custom-root option |
| --- | --- | --- |
| Codex (default) | `~/.codex` | `--codex-home` |
| Claude Code | `~/.claude` | `--claude-home` |
| DeepSeek Harness | `~/.dsh/sessions` | `--dsh-home` |

Pass the relevant option followed by your transcript root. For DeepSeek Harness, this is the sessions persistence directory. You can also switch source or edit roots in the project chooser without restarting. Only the active source is scanned; there is no mixed-source index.

The installed CLI supports Node.js LTS releases starting at **22**, with **24 recommended**, and npm for installation. DeepSeek `session.jsonl.zstd` needs Node's built-in Zstandard API, available in Node 22 from **22.15.0**, subject to the actual capability check. Uncompressed `session.jsonl` remains readable without it. [Source development](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/docs/development.md) has a separate, stricter Node/npm policy.

Current-session reading uses persisted history; it does not promise live monitoring or automatic refresh. The views present recorded operations and results without inferring hidden reasoning or causal relationships.

Claude Code external `tool-results/*` payloads are not loaded or searched. Unrecognized events in supported formats retain Protocol/Raw fallback, but not every event has a dedicated renderer. Unsupported DeepSeek format versions are skipped with diagnostics.

The server binds to `127.0.0.1` by default. Exposing it beyond localhost with `--host` can let other machines read transcripts accessible to the process. The supported v0.2 interface is the CLI; internal HTTP APIs are version-specific.

## Questions and troubleshooting

**No projects or sessions?** Check the selected source, transcript root, and project path, then clear filters. Zero matches do not establish that no history exists. See [troubleshooting](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/docs/usage/troubleshooting.md).

**The page opens, but is my history ready?** Wait for indexing and check the session count and diagnostics. A reachable page only proves HTTP readiness; readable sessions may coexist with skipped artifacts. The [agent guide](https://github.com/Yijia-Zhou/session-analyzer/blob/51a9ec530b1a9c03f3d96761632baa05590ccefe/docs/usage/agent-quickstart.md) distinguishes these outcomes.

**Large history or indexing failure?** Try normal indexing first. See [diagnostics and memory recovery](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/docs/usage/troubleshooting.md) for aggregate logging and temporary heap changes only after a relevant failure.

## Let an agent start it for you

Copy this request and fill in your project and source:

```text
Start Session Analyzer locally for me: https://github.com/Yijia-Zhou/session-analyzer
Project: <project path>
Transcript source: <Codex / Claude Code / DeepSeek Harness>
Choose a version that supports this source and follow its README and linked
startup guide. Verify indexing and open a session to check that it is readable.
Report the local URL, actual version, session count, and any diagnostics.
```

The [online startup and verification guide](https://github.com/Yijia-Zhou/session-analyzer/blob/51a9ec530b1a9c03f3d96761632baa05590ccefe/docs/usage/agent-quickstart.md) covers version selection, configuration, and actual reading checks. Usage guides are online documentation and are not promised inside the npm package.

## Development and contribution

See [development setup, checks, and repository layout](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/docs/development.md), the [documentation index](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/docs/README.md), [architecture](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/docs/design-docs/logical-event-timeline.md), and [performance](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/docs/design-docs/timeline-loading-and-rendering-performance.md). For issues, include the version, source, and reproduction steps; use synthetic or redacted transcripts in public reports.

BSD 3-Clause. See [LICENSE](https://github.com/Yijia-Zhou/session-analyzer/blob/v0.2.0/LICENSE).
