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
- Use folding profiles for narrative reading, debugging, change review, tool inspection, and compact browsing.
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

## Install

```sh
npm install
```

## Run

Start without a repository to choose from discovered projects in the browser:

```sh
npm start
```

Or start with an explicit repository:

```sh
node server.js --repo /path/to/project
```

On Windows:

```powershell
node server.js --repo 'C:\path\to\project'
```

By default the app reads Codex transcripts from `~/.codex`. Use `--codex-home` if your transcripts live elsewhere:

```sh
node server.js --repo /path/to/project --codex-home /path/to/.codex --port 17890
```

Then open:

```text
http://127.0.0.1:17890/
```

## Usage

1. Select a target project, or pass `--repo` when starting the server.
2. Pick a session from the left pane.
3. Use `Main timeline` for normal reading, `Protocol layer` for injected context and lifecycle records, or `Raw records` for exact transcript rows.
4. Search with a case-insensitive plain-text phrase or filters such as `file:src/parser.js`, `kind:command`, `status:failed`, and `layer:raw`. Whitespace inside a phrase matches spaces, tabs, or newlines.
5. Open an event to inspect structured detail and raw references.

## Test

```sh
npm test
```

The test fixtures under `test/fixtures/codex-home` are synthetic transcript data. They intentionally include fake Windows paths and sample transcript shapes for parser coverage.

## Repository Layout

- `server.js`: local HTTP server and API routes.
- `src/codex.js`: transcript parsing, project discovery, indexing, logical timeline construction, and event-detail extraction.
- `src/folding.js`: built-in timeline folding profiles.
- `public/folding.js`: shared browser-and-Node folding rule evaluation.
- `public/`: browser UI, search parsing, renderers, and styles.
- `test/`: Node test suite and synthetic transcript fixtures.
- `docs/`: product specs, design docs, execution plans, and backlog notes.

## Security Notes

This tool is a local viewer, not a hosted multi-user analytics service. If you expose the server beyond localhost, anyone with network access to it may be able to read transcript content available to the process.

Before publishing a fork or issue reproduction, check that any attached transcript samples are synthetic or sanitized.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
