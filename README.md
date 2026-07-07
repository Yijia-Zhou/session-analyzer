# Codex Session Analyzer

[中文 README](README.zh-CN.md)

Codex Session Analyzer is a local web viewer for Codex session transcripts. It turns noisy JSONL transcript history into repository-scoped session lists, searchable timelines, structured tool-call details, and raw-record drill-downs.

The app is designed for local use. It reads transcript files from your own Codex home directory, keeps analysis in memory, and does not upload transcript content.

## Features

- Discover projects from Codex session working directories, or start directly with a target repository.
- Show only sessions that match the selected repository.
- Browse three layers: a deduplicated main timeline, protocol events, and raw JSONL records.
- Search messages, commands, files, outputs, status, event kinds, and layers.
- Inspect structured details for messages, commands, patches, plans, MCP/tool calls, web searches, lifecycle events, and raw records.
- Jump from logical events back to the exact source JSONL rows.
- Use folding profiles for narrative reading, conversation review, error focus, change review, planning, search focus, and compact browsing.
- Render transcript Markdown safely with raw HTML disabled and dangerous link protocols rejected.

## Privacy Model

This project is intentionally local-first:

- The server binds to `127.0.0.1` by default.
- Transcript files are read from disk and are not modified.
- Derived indexes are held in memory only.
- Raw transcript drill-down is explicit, so sensitive content is not hidden from the user but is not sent anywhere by this app.

Codex transcripts can contain prompts, command output, file paths, environment details, and other private material. Do not commit your real `.codex/sessions` directory or exported transcript data to a public repository.

## Requirements

- Node.js 18 or newer
- npm

## Run With npm

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

By default the app reads Codex transcripts from `~/.codex`. Use `--codex-home` if your transcripts live elsewhere:

```sh
npx session-analyzer --repo /path/to/project --codex-home /path/to/.codex --port 17890
```

Then open:

```text
http://127.0.0.1:17890/
```

You can also install the CLI globally:

```sh
npm install -g session-analyzer
session-analyzer --repo /path/to/project
```

The default host is `127.0.0.1`. `--host` is an advanced option; binding outside localhost can expose transcript content available to this process to other machines on the network.

## Develop From Source

Install dependencies:

```sh
npm install
```

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

Run package smoke verification before release packaging:

```sh
npm run test:package
```

The package smoke command runs `npm pack`, installs the tarball into a fresh temporary project, checks installed CLI help, and starts the packaged server.

The test fixtures under `test/fixtures/codex-home` are synthetic transcript data. They intentionally include fake Windows paths and sample transcript shapes for parser coverage.

Browser JavaScript source lives in `src/browser/`, and browser-and-Node shared logic lives in `src/shared/`. The generated runtime bundle is `public/assets/app.js`; do not edit it directly.

## Usage

1. Select a target project, or pass `--repo` when starting the server.
2. Pick a session from the left pane.
3. Use `Main timeline` for normal reading, `Protocol layer` for injected context and lifecycle records, or `Raw records` for exact transcript rows.
4. Enter a case-insensitive plain-text phrase in the search HUD; whitespace inside a phrase matches spaces, tabs, or newlines. Open Search parameters to switch between the current session and the entire project, add `file`, `kind`, or `status` filters, inspect complete counts, or jump to the global Layer selector. Operator-like input such as `status:failed` remains literal text.
5. Open an event to inspect structured detail and raw references.

The npm package does not promise a stable programmatic API. The supported v0.1 interface is the `session-analyzer` CLI.

## Known Limits

- v0.1 supports Codex transcripts only. Non-Codex transcript formats are design references for future adapters, not supported import sources.
- Future or unknown Codex protocol events remain inspectable through protocol/raw fallback views, but not every event family has a polished structured renderer.
- Transcript fixture coverage is targeted rather than exhaustive; newly observed historical shapes may need additional fixtures and display adjustments.
- Review finding rendering has synthetic coverage and real non-empty `review_output.findings[]` examples have been observed locally; sanitized fixture strengthening is still useful for future regressions.

## Repository Layout

- `server.js`: local HTTP server and API routes.
- `src/codex.js`: transcript parsing, project discovery, indexing, logical timeline construction, and event-detail extraction.
- `src/folding.js`: built-in timeline folding profiles.
- `src/shared/`: browser-and-Node shared logic such as folding rule evaluation and command highlighting metadata.
- `src/browser/`: browser UI source, search controls and state models, renderers, navigation, and app wiring.
- `public/`: static HTML/CSS and generated browser runtime assets.
- `test/`: Node test suite and synthetic transcript fixtures.
- `docs/`: product specs, design docs, execution plans, and backlog notes.

## Security Notes

This tool is a local viewer, not a hosted multi-user analytics service. If you expose the server beyond localhost, anyone with network access to it may be able to read transcript content available to the process.

Before publishing a fork or issue reproduction, check that any attached transcript samples are synthetic or sanitized.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
