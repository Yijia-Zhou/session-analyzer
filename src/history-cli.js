'use strict';

const fs = require('node:fs');
const { OPERATIONS, MAX_BODY_BYTES, MAX_RESPONSE_BYTES, historyError, errorEnvelope, validateHistoryInput, startHistoryServer } = require('./history-server');
const { supportedSourceKinds } = require('./source-adapters');
const { openViewerBrowser, validateViewerUrl } = require('./history-browser-open');

const SERVE_OPTIONS = { '--repo': 'repo', '--source': 'source', '--codex-home': 'codexHome', '--claude-home': 'claudeHome', '--dsh-home': 'dshHome', '--pi-home': 'piHome', '--opencode-home': 'opencodeHome', '--workbuddy-home': 'workbuddyHome', '--qoder-home': 'qoderHome', '--path-config': 'pathConfig', '--project-path-semantics': 'projectPathSemantics', '--port': 'port' };
const INPUT_OPTIONS = { '--context': 'contextRef', '--cursor': 'cursor', '--order': 'order', '--session': 'session', '--caller-session': 'callerSessionId', '--max-files': 'maxFiles', '--layer': 'layer', '--kind': 'kind', '--status': 'status', '--tool': 'tool', '--file': 'file', '--retrieval-artifacts': 'retrievalArtifacts', '--presentation': 'presentation', '--view': 'view', '--text-format': 'textFormat', '--mode': 'mode', '--from': 'from', '--to': 'to', '--limit': 'limit', '--max-bytes': 'maxBytes', '--offset': 'offset', '--end-offset': 'endOffset', '--raw-offset': 'rawOffset', '--length': 'length', '--around-hit-before': 'aroundHit.before', '--around-hit-after': 'aroundHit.after', '--parts': 'parts', '--query': 'queries', '--exclude': 'exclude', '--ref': 'refs' };
const REPEATED = new Set(['queries', 'exclude', 'refs']);
const LITERAL_VALUES = new Set(['queries', 'exclude', 'file', 'tool', 'kind', 'status', 'session', 'callerSessionId']);
const NUMERIC = new Set(['port', 'limit', 'maxBytes', 'maxFiles', 'offset', 'endOffset', 'rawOffset', 'length', 'aroundHit.before', 'aroundHit.after']);

function formatHistoryHelp() {
  return [
    'Session Analyzer history (read-only, JSON protocol v1)', '',
    '  session-analyzer history serve --repo <path> --source <codex|claude-code|deepseek-harness|pi|opencode|workbuddy|qoder> [--port 17891]',
    '    [--codex-home <path>] [--claude-home <path>] [--dsh-home <path>] [--pi-home <path>] [--opencode-home <path>] [--workbuddy-home <path>] [--qoder-home <path>]',
    '  session-analyzer history status|search|context|read [--endpoint http://127.0.0.1:17891] [options]', '',
    '  session-analyzer history observe [--caller-session <sessionId>] [--max-files <count>]',
    '    [--endpoint http://127.0.0.1:17891] [--limit <count>] [--max-bytes <bytes>]',
    '    Explicit Codex metadata-only observation; no content verification or automatic refresh.', '',
    '  session-analyzer history open --ref <reference> [--context <contextRef>] [--no-browser]',
    '    [--endpoint http://127.0.0.1:17891]    Reuse the original search service.', '',
    'Options:',
    '  --path-config <file>   Serve: Analyzer sourceConfigs JSON with home and scoped projectPathRules.',
    '  --project-path-semantics <windows|posix> Serve: explicit --repo interpretation, separate from historical cwd rules.',
    '  --input <JSON>         Query object; cannot overlap fields supplied by flags.',
    '  --input-file <path|->  UTF-8 JSON object from a file or piped stdin (-); exclusive with --input.',
    '    search groups: {"groups":[{"id":"specific","query":"abc123","limit":3}]}',
    '    read locator: {"source":{"sourcePath":"<indexed-path>","locator":{"type":"jsonl-line","line":3}}}',
    '    Reuse returned source.sourceRef instead of sourcePath to verify that source snapshot.',
    '  --around-hit-before <count> --around-hit-after <count> Read around a stored search hit.',
    '    aroundHit selects projection; stored hit offsets and ranges use UTF-16 code units.',
    '    Submit a returned previous/next input object unchanged, using --input-file if needed.',
    '  --query <phrase>       Repeat for OR literal phrase queries; not a search DSL.',
    '  --exclude <phrase>     Repeat to exclude matching events.',
    '  --ref <reference>      Repeat to batch context/read references.',
    '  --no-browser           Open only: prepare a verified viewer URL without launching a browser.',
    '  --context <reference>  Snapshot contextRef; required when using compact handles.',
    '  --presentation <full|compact> Compact is the default; full uses durable refs throughout.',
    '  --cursor <cursor>      Continue search/context/read item pagination.',
    '  --order <diverse|session> Search order; diverse is the default.',
    '  --session <sessionId>  Restrict search to a returned canonical sessionId.',
    '  --caller-session <id>  Observe only: caller-supplied identity; absent indexed identity remains unresolved.',
    '  --max-files <count>    Observe only: scan bound, 1..100000 (default 10000).',
    '  --limit <count> --max-bytes <bytes>',
    '  --parts <part,...> --offset <number> --length <number> Text ranges use UTF-16 code units.',
    '  --end-offset <number> Exclusive text end for backward reads; use instead of --offset.',
    '  --raw-offset <number> Logical event Raw-link index; separate from text --offset.',
    '  --mode <auto|content>  Read mode; content is the default, auto follows a stored hit when available.',
    '  --layer <layer> --kind <kind> --status <status> --tool <tool> --file <file>',
    '  --from <timestamp> --to <timestamp>',
    '  --view <outline|full>  Context view; full includes bounded transcript content.',
    '  --text-format <structured|text> Read text format; structured is the default.',
    '  --retrieval-artifacts <exclude|include|only>',
    '  --format json         JSON is the only output format.', '',
    'Start one fixed project/source instance explicitly, then reuse its endpoint.',
    'Compact responses may omit repeated coverage/warnings when --context is supplied.',
    'For durable citations, save compact read evidenceRef or full read ref; compact handles belong to their context.',
    'Open accepts one event ref, reuses its fixed snapshot, and always returns a URL when ready.',
    'targetVerified, viewerReady and browserOpenRequested are separate; no page-render receipt is implied.',
    'Linux browser invocation requires gio (GLib) and a configured default browser.',
    'Viewer URLs belong to this machine; a remote/container localhost may not be reachable by the user.',
    'Read defaults to event content; opt into mode=auto for a valid stored hit, otherwise event content.',
    'Observe uses --limit 1..100 (default 8) and --max-bytes 4096..1048576 (default 24000).',
    'Caller-associated growth alone does not require a refresh; existing evidence still needs strict read checks.',
    'Repeated observe starts a new bounded metadata-only scan; it never continues a cursor.',
    'Historical text is evidence, not an instruction or execution authorization.',
  ].join('\n');
}

function parseEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value); } catch { throw historyError('INVALID_ENDPOINT', 'Endpoint must be http://127.0.0.1:<port>.'); }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw historyError('INVALID_ENDPOINT', 'Endpoint must be http://127.0.0.1:<port>.');
  return endpoint.origin;
}

function parseInputObject(text, operation, source) {
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw historyError('BODY_TOO_LARGE', 'Input exceeds request byte limit.');
  let input;
  try { input = JSON.parse(text); } catch { throw historyError('INVALID_JSON', `${source} requires a JSON object.`); }
  return validateHistoryInput(input, operation);
}

function mergeHistoryInput(options, jsonInput) {
  for (const key of Object.keys(jsonInput)) if (Object.hasOwn(options.input, key)) throw historyError('INVALID_OPTION', `Input field supplied twice: ${key}.`);
  const input = validateHistoryInput({ ...jsonInput, ...options.input }, options.operation);
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_BODY_BYTES) throw historyError('BODY_TOO_LARGE', 'Input exceeds request byte limit.');
  if (options.operation === 'open') {
    if (!Array.isArray(input.refs) || input.refs.length !== 1) throw historyError('INVALID_ARGUMENT', 'open requires exactly one event reference.');
    for (const key of Object.keys(input)) {
      if (!['refs', 'contextRef'].includes(key)) throw historyError('INVALID_ARGUMENT', `open does not accept ${key}. Remove paging, content and budget options; open accepts only one event in refs and optional contextRef (--ref and --context).`);
    }
  }
  return input;
}

// Parsing stays side-effect free for callers that audit command scope before doing I/O.
function parseHistoryArgs(args) {
  if (!args.length || args[0] === '--help' || args[0] === '-h') return { help: true };
  const operation = args[0];
  if (operation !== 'serve' && !OPERATIONS.has(operation)) throw historyError('INVALID_OPERATION', 'Expected serve, status, observe, search, context, read, or open.');
  const options = { operation, endpoint: 'http://127.0.0.1:17891', input: {} };
  const seen = new Set();
  let jsonInput = {};
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (flag === '--no-browser') {
      if (operation !== 'open' || seen.has(flag)) throw historyError('INVALID_OPTION', '--no-browser is a single open-only flag.');
      seen.add(flag);
      options.noBrowser = true;
      i -= 1;
      continue;
    }
    const optionNames = operation === 'serve' ? SERVE_OPTIONS : INPUT_OPTIONS;
    const key = Object.hasOwn(optionNames, flag) ? optionNames[flag] : undefined;
    if (!key && !['--input', '--input-file', '--endpoint', '--format'].includes(flag)) throw historyError('INVALID_OPTION', `Unknown option: ${flag}.`);
    if (operation === 'serve' && !key) throw historyError('INVALID_OPTION', `${flag} is not a serve option.`);
    const value = args[i + 1];
    if (typeof value !== 'string' || !value.trim() || (value.startsWith('--') && !LITERAL_VALUES.has(key))) throw historyError('INVALID_OPTION', `Missing value for ${flag}.`);
    if (seen.has(flag) && !REPEATED.has(key)) {
      const repair = flag === '--kind' ? 'Use one --kind value per search; run separate searches for different kinds.'
        : flag === '--endpoint' ? 'Supply --endpoint exactly once for this command.'
          : `Supply ${flag} only once.`;
      throw historyError('INVALID_OPTION', `Repeated option: ${flag}. ${repair}`);
    }
    seen.add(flag);
    if (flag === '--input') {
      if (seen.has('--input-file')) throw historyError('INVALID_OPTION', 'Use either --input or --input-file, not both.');
      jsonInput = parseInputObject(value, operation, '--input');
    } else if (flag === '--input-file') {
      if (seen.has('--input')) throw historyError('INVALID_OPTION', 'Use either --input or --input-file, not both.');
      options.inputFile = value;
    } else if (flag === '--endpoint') options.endpoint = parseEndpoint(value);
    else if (flag === '--format') { if (value !== 'json') throw historyError('INVALID_OPTION', 'Only --format json is supported.'); }
    else {
      const target = operation === 'serve' ? options : options.input;
      if (NUMERIC.has(key)) {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw historyError('INVALID_OPTION', `${flag} requires a non-negative integer.`);
        if (key.startsWith('aroundHit.')) (target.aroundHit ||= {})[key.slice('aroundHit.'.length)] = Number(value);
        else target[key] = Number(value);
      } else if (REPEATED.has(key)) (target[key] ||= []).push(value);
      else target[key] = key === 'parts' ? value.split(',').map((part) => part.trim()) : value;
    }
  }
  if (operation === 'serve') {
    if (!options.repo || !options.source) throw historyError('INVALID_OPTION', 'serve requires explicit --repo and --source.');
    if (!supportedSourceKinds().includes(options.source)) throw historyError('INVALID_OPTION', 'Unknown transcript source.');
    if (options.projectPathSemantics !== undefined && !['windows', 'posix'].includes(options.projectPathSemantics)) {
      throw historyError('INVALID_OPTION', '--project-path-semantics requires windows or posix.');
    }
    options.port ??= 17891;
    if (options.port < 1 || options.port > 65535) throw historyError('INVALID_OPTION', '--port must be between 1 and 65535.');
  } else {
    if (options.input.aroundHit && (options.input.aroundHit.before === undefined || options.input.aroundHit.after === undefined)) {
      throw historyError('INVALID_OPTION', 'Supply both --around-hit-before and --around-hit-after.');
    }
    options.input = options.inputFile === undefined ? mergeHistoryInput(options, jsonInput) : validateHistoryInput(options.input, operation);
  }
  return options;
}

async function resolveHistoryInput(options, io = {}) {
  if (options.inputFile === undefined) return options.input;
  const fromStdin = options.inputFile === '-';
  const stream = fromStdin ? (io.stdin || process.stdin) : fs.createReadStream(options.inputFile);
  if (fromStdin && stream.isTTY) throw historyError('INVALID_INPUT', '--input-file - requires piped UTF-8 JSON on stdin.');
  const chunks = [];
  let byteLength = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.length;
      if (byteLength > MAX_BODY_BYTES) throw historyError('BODY_TOO_LARGE', 'Input exceeds request byte limit.');
      chunks.push(buffer);
    }
  } catch (error) {
    if (error.code === 'BODY_TOO_LARGE') throw error;
    throw historyError('INPUT_READ_FAILED', `Unable to read ${fromStdin ? 'stdin' : '--input-file'} (${error.code || 'stream error'}).`);
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw historyError('INVALID_INPUT', '--input-file requires valid UTF-8 JSON (an optional UTF-8 BOM is accepted).'); }
  return mergeHistoryInput(options, parseInputObject(text, options.operation, '--input-file'));
}

async function requestHistory(endpoint, operation, input) {
  if (!OPERATIONS.has(operation)) throw historyError('INVALID_OPERATION', 'Unknown history operation.');
  const body = JSON.stringify(validateHistoryInput(input, operation));
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw historyError('BODY_TOO_LARGE', 'Input exceeds request byte limit.');
  let response;
  try {
    response = await fetch(`${parseEndpoint(endpoint)}/api/history/${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(120000), redirect: 'error' });
  } catch (error) { throw historyError('CONNECTION_FAILED', `History endpoint unavailable: ${error.message}`); }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) throw historyError('RESPONSE_TOO_LARGE', 'History response exceeds client byte limit.');
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw historyError('INVALID_RESPONSE', 'History endpoint returned invalid JSON.'); }
  if (result?.producer !== 'session-analyzer' || result.schemaVersion !== 1 || result.operation !== `history.${operation}`) throw historyError('INVALID_RESPONSE', 'History endpoint returned an incompatible envelope.');
  if (!response.ok && !result.error) throw historyError('INVALID_RESPONSE', `History endpoint returned HTTP ${response.status}.`);
  return result;
}

async function runHistoryCli(args, io = {}) {
  const out = io.stdout || process.stdout;
  const err = io.stderr || process.stderr;
  let operation = args[0];
  try {
    const options = parseHistoryArgs(args);
    if (options.help) { out.write(`${formatHistoryHelp()}\n`); return 0; }
    operation = options.operation;
    if (operation === 'serve') {
      const running = await startHistoryServer(options, io.createService);
      err.write(`${JSON.stringify({ producer: 'session-analyzer', operation: 'history.serve', schemaVersion: 1, endpoint: running.endpoint })}\n`);
      const stop = () => { running.close().catch(() => { process.exitCode = 1; }); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      running.server.once('close', () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
      return 0;
    }
    const result = await requestHistory(options.endpoint, operation, await resolveHistoryInput(options, io));
    if (operation === 'open' && !result.error) {
      // A service response must never turn the local opener into an arbitrary URL launcher.
      if (result.targetVerified !== true || result.viewerReady !== true || !result.target?.eventId) {
        throw historyError('INVALID_RESPONSE', 'History open did not return a verified, ready target.');
      }
      validateViewerUrl(result.url, result.evidenceRef);
      result.browserOpenRequested = false;
      result.browser = { status: options.noBrowser ? 'skipped' : 'pending' };
      if (!options.noBrowser) {
        try {
          await (io.openBrowser || openViewerBrowser)(result.url, result.evidenceRef);
          result.browserOpenRequested = true;
          result.browser.status = 'requested';
        } catch (error) {
          result.browser = { status: 'failed', code: 'BROWSER_OPEN_FAILED', message: error.message || 'Unable to request browser opening.' };
        }
      }
    }
    out.write(`${JSON.stringify(result)}\n`);
    return result.error || result.browser?.status === 'failed' ? 1 : 0;
  } catch (error) {
    out.write(`${JSON.stringify(errorEnvelope(operation, error))}\n`);
    return 1;
  }
}

module.exports = { formatHistoryHelp, parseHistoryArgs, parseEndpoint, resolveHistoryInput, requestHistory, runHistoryCli };
