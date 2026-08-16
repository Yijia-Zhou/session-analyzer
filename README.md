# Session Analyzer

[中文 README](README.zh-CN.md)

Session Analyzer turns local Codex and Claude Code session transcripts into readable work history, organized by repository. Revisit what an agent did, find specific work across a project, and trace related sessions without reading raw JSONL.

![Session Analyzer showing repository session history, a readable Main timeline, and structured command detail](docs/assets/readme/session-analyzer-overview.png)

Repository history stays visible on the left, the Main timeline keeps the work readable in the center, and structured detail remains one click away on the right.

Runs locally by default, reads transcripts without modifying them, and does not upload transcript content.

## Find what happened

Search messages, commands, files, outputs, status, and event kinds. Move through matches and jump directly to the relevant event without manually scanning the transcript.

![Searching for a test file and jumping to its matching patch](docs/assets/readme/search-and-jump.gif)

## See where work came from

Follow reviews and delegated work back to where they started. See what context they inherited, then reopen the parent session when you need it.

![Opening a review-derived session, inspecting inherited context, and returning to its parent](docs/assets/readme/derived-session-provenance.gif)

## Quick Start

Start without a repository to choose from discovered projects in the browser:

```sh
npx session-analyzer
```

Or start with an explicit repository:

```sh
npx session-analyzer --repo /path/to/project
```

On Windows:

```powershell
npx session-analyzer --repo 'C:\path\to\project'
```

Then open:

```text
http://127.0.0.1:17890/
```

Codex is the default startup transcript source and is read from `~/.codex`. Use `--codex-home` if it lives elsewhere:

```sh
npx session-analyzer --repo /path/to/project --codex-home /path/to/.codex --port 17890
```

Claude Code can be selected at startup. The app does not scan `~/.claude` unless Claude Code is the active source:

```sh
npx session-analyzer --source claude-code --repo /path/to/project
```

Use `--claude-home` for a non-default Claude home or an exported project-container directory:

```sh
npx session-analyzer --source claude-code --claude-home /path/to/.claude
```

`--source claude` is accepted as an alias for `--source claude-code`. You can also switch the active transcript source or edit either source home later from the project chooser. One source is active at a time; Session Analyzer does not build a mixed Codex-and-Claude index.

You can also install the CLI globally:

```sh
npm install -g session-analyzer
session-analyzer --repo /path/to/project
```

The default host is `127.0.0.1`. `--host` is an advanced option; binding outside localhost can expose transcript content available to this process to other machines on the network.

## How to Use It

1. Start with the default Codex source or select Claude Code on the CLI, then choose a target project in the browser or pass `--repo` when starting the server.
2. Use the project chooser to switch projects at runtime. From the same chooser, you can switch the active transcript source or edit its home directory; the project list is then rediscovered for that source.
3. Pick a session from the left pane.
4. Use `Main timeline` for normal reading, `Protocol layer` for injected context and lifecycle records, or `Raw records` for exact transcript rows.
5. Enter a case-insensitive plain-text phrase in the search HUD; whitespace inside a phrase matches spaces, tabs, or newlines. Open Search options to switch between the current session and the entire project, edit the always-visible `Touched file`, `Kind`, or `Status` filters, inspect complete counts, or jump to the adjacent global Layer selector. Operator-like input such as `status:failed` remains literal text.
6. Open an event to inspect structured detail and raw references.

The npm package does not promise a stable programmatic API. The supported v0.1 interface is the `session-analyzer` CLI.

## What You Can Inspect

- Discover and switch among projects from Codex or Claude Code session working directories, or start directly with a target repository.
- Switch the active transcript source and configure source home directories from the project chooser without restarting the server.
- Show only sessions that match the selected repository.
- Keep Claude Code subagents separately selectable; distinguish materialized and pointer-backed forks, and show parent-owned inherited context without duplicate metrics or Raw Records.
- Browse three layers: a deduplicated Main timeline, protocol events, and raw JSONL records.
- Search messages, commands, files, outputs, status, event kinds, and layers.
- Inspect structured details for messages, commands, patches, plans, MCP/tool calls, web searches, lifecycle events, and raw records.
- Jump from logical events back to the exact source JSONL rows.
- Use folding profiles for narrative reading, conversation review, error focus, change review, planning, search focus, and compact browsing.
- Render transcript Markdown safely with raw HTML disabled and dangerous link protocols rejected.

## Privacy and Security

This project is intentionally local-first:

- The server binds to `127.0.0.1` by default.
- Transcript files are read from disk and are not modified.
- Derived indexes are held in memory only.
- Raw transcript drill-down is explicit, so sensitive content is not hidden from the user but is not sent anywhere by this app.

Agent transcripts can contain prompts, command output, file paths, environment details, and other private material. Do not commit your real `.codex/sessions`, `.claude/projects`, or exported transcript data to a public repository.

This tool is a local viewer, not a hosted multi-user analytics service. If you expose the server beyond localhost, anyone with network access to it may be able to read transcript content available to the process.

Before publishing a fork or issue reproduction, check that any attached transcript samples are synthetic or sanitized.

## Requirements

- Installed CLI: a supported Node.js LTS release, Node.js 22 or newer (Node.js 24 recommended), plus npm for installation
- Source development and release work: Node.js `^22.22.2 || ^24.15.0` and exactly npm `12.0.2`

### Large transcript histories and Node/V8 memory

Indexing memory depends mainly on the amount and shape of transcript history that matches the selected repository—not on the source-code repository's size. Candidate transcript bytes, Raw Record and Logical Event counts, record composition, and especially an unusually large individual Session all affect memory use.

With the current Indexed/Materialized lifecycle, an aggregate-only Codex run over 490 Sessions and 305,485 Raw Records completed under the default 2.35 GB V8 heap limit. It observed a 788 MB transient V8 heap peak and 2.16 GB process maximum RSS, then retained 56.5 MB V8 heap after forced GC alongside a 1.055 GB packed query store held primarily outside V8 heap. The largest accepted transcript in that run was 116.9 MB: cold materialization took 10.84 seconds, the exact warm cache hit took 0.14 ms without another adapter call, and the cached complete Session added about 37.0 MB heap after GC. Treat histories approaching roughly 1 GB of matching transcript data as high process-memory workloads even though the source-backed lifecycle substantially reduces V8 heap pressure. These empirical measurements are guidance, not guarantees, a prediction formula, an out-of-memory boundary, or hard capacity limits; actual use varies with record shapes, event counts, Node version, the number of distinct Sessions opened in one revision, and unusually large individual Sessions.

When matching history reaches the empirical 800 MiB warning threshold, the CLI emits `[SESSION_ANALYZER_LARGE_TRANSCRIPT_HISTORY]` once and continues indexing normally. The warning is informational for people and agents: attempt normal indexing first, and do not change the heap when indexing succeeds. It does not change `NODE_OPTIONS`, restart the process, or alter the exit code.

For Claude Code, the current warning uses selected primary transcript bytes; derived subagent transcript data may add to the actual indexed workload, and large-scale Claude capacity has not yet been calibrated.

Only if indexing terminates with a V8 heap-exhaustion error such as `JavaScript heap out of memory`, retry with a moderately larger temporary heap. This is a workaround for unusually large history, not a new product default. In PowerShell:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
npx session-analyzer --repo 'C:\path\to\project' --log-dir '.\session-analyzer-logs'
Remove-Item 'Env:NODE_OPTIONS'
```

If `NODE_OPTIONS` was already set, preserve its previous value and restore it afterward instead of removing it.

On POSIX shells, scope the override to one command:

```sh
NODE_OPTIONS='--max-old-space-size=4096' npx session-analyzer --repo /path/to/project --log-dir ./session-analyzer-logs
```

`--log-dir <path>` is the preferred way to collect aggregate indexing diagnostics for investigation. Session Analyzer writes throttled, bounded JSONL lifecycle records containing candidate file/byte counts, Session/Raw/Logical counts, timing, V8 heap limits, current and process-local peak memory, and the stable capacity-warning signal. These records omit repository paths, transcript paths, transcript text, prompts, commands, and source content, and at most 20 indexing logs are retained. Fatal V8 OOM stderr remains the authoritative final crash evidence; a fatal process termination may prevent the diagnostic logger from writing a final record.

The source-backed lifecycle removes corpus-wide complete event graphs, but the packed query store and revision-scoped Materialized Session cache remain material memory owners. The first cache implementation has no eviction; successful project replacement or source switching releases the old cache, while opening many distinct large Sessions in one revision can grow it. Future releases may further reduce indexing and runtime memory use, so these figures describe the current implementation rather than permanent product capacity limits.

## Develop From Source

The published CLI keeps the broader Node.js 22-or-newer runtime requirement above. A source checkout is deliberately stricter because npm 12 enforces the reviewed dependency install-script policy. Before any repository-local `npm install`, `npm ci`, or `npm run`, select a supported Node.js version and, from a directory outside the source checkout, bootstrap the exact npm CLI globally. This first npm command updates the toolchain and does not install project dependencies:

```sh
node --version
npm install --global npm@12.0.2 --ignore-scripts --registry=https://registry.npmjs.org/
npm --version
```

Return to the source checkout only after the bootstrap. Do not continue unless Node.js satisfies `^22.22.2 || ^24.15.0` and `npm --version` prints exactly `12.0.2`. Then install the locked dependencies under the strict default-deny script policy:

```sh
npm ci --strict-allow-scripts --registry=https://registry.npmjs.org/
npm install-scripts ls --json
```

The final command must report no pending install scripts.

Start from a source checkout:

```sh
npm start
```

Or run the server file directly:

```powershell
node server.js --repo 'C:\path\to\project'
```

Build the browser bundle:

```sh
npm run build
```

Run tests:

```sh
npm test
```

Install Chromium and run browser coverage:

```sh
npm run browser:install
npm run test:browser
```

Run package smoke verification before release packaging:

```sh
npm run test:package
```

The package smoke command runs `npm pack`, installs the tarball into a fresh temporary project, checks installed CLI help, and starts the packaged server.

Run the repeatable non-browser release gate:

```sh
npm run release:check
```

The release gate checks generated assets, runs the full Node test suite, and repeats the installed-package smoke. Browser coverage remains a separate CI and local release requirement.

The test fixtures under `test/fixtures/codex-home` and the inline Claude fixtures in `test/claude.test.js` are synthetic transcript data. They intentionally include fake paths and sample transcript shapes for parser coverage.

Browser JavaScript source lives in `src/browser/`, and browser-and-Node shared logic lives in `src/shared/`. The generated runtime bundle is `public/assets/app.js`; do not edit it directly.

## Known Limits

- Mixed Codex-and-Claude indexing and source filters are not supported in v0.1.4.
- Claude Code external `tool-results/*` payloads are not loaded or searched. Their source records and references remain available through protocol/raw fallback.
- Future or unknown Codex and Claude Code protocol events remain inspectable through protocol/raw fallback views, but not every event family has a polished structured renderer.
- Transcript fixture coverage is targeted rather than exhaustive; newly observed historical shapes may need additional fixtures and display adjustments.
- Review finding rendering has synthetic coverage and real non-empty `review_output.findings[]` examples have been observed locally; sanitized fixture strengthening is still useful for future regressions.

## Repository Layout

- `server.js`: local HTTP server and API routes.
- `src/source-adapters.js`: source selection and the source-neutral dispatch boundary.
- `src/codex*.js`: Codex parsing, discovery, logical mapping, indexing, and detail construction.
- `src/claude*.js`: Claude Code discovery, parsing, logical mapping, indexing, and detail construction.
- `src/folding.js`: built-in timeline folding profiles.
- `src/shared/`: browser-and-Node shared logic such as folding rule evaluation and command highlighting metadata.
- `src/browser/`: browser UI source, search controls and state models, renderers, navigation, and app wiring.
- `public/`: static HTML/CSS and generated browser runtime assets.
- `test/`: Node test suite and synthetic transcript fixtures.
- `docs/`: product specs, design docs, execution plans, and backlog notes.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
