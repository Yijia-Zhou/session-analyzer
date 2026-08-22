#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const url = require('node:url');
const {
  SOURCE_KIND,
  buildEventDetailForSession,
  materializeSessionForIndex,
  normalizeSourceKind,
  queryForIndex,
  readImagePreviewForSession,
  readIndexedRawRecord,
  readLegacyRawLineForSession,
  resolveLegacyRawOwnerForIndex,
  requireExplicitSourceKind,
  requireSourceAdapter,
  supportedSourceOptions,
  supportedSourceKinds,
  validateIndexOwnership,
  validateIndexOwnershipForCommit,
} = require('./src/source-adapters');
const {
  clearIndexRevision,
  initializeIndexRevisionState,
  installIndexRevision,
  materializeSessionWithLease,
  withIndexRevisionLease,
} = require('./src/index-revision-lease');
const { SESSION_LIFECYCLE } = require('./src/source-adapter-contract');
const { scheduleBoundedSessionPrewarm } = require('./src/session-prewarm');
const { isPathInsideOrSame, normalizeFsPath } = require('./src/shared/fs-path');
const { foldingProfiles } = require('./src/folding');
const i18n = require('./src/shared/i18n');
const { createIndexDiagnostics } = require('./src/runtime-diagnostics');
const { createLargeTranscriptHistoryWarning } = require('./src/runtime-capacity');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const PUBLIC_RUNTIME_ERROR_CODES = new Set([
  'MATERIALIZATION_BUSY',
  'MATERIALIZATION_CONTRACT_VIOLATION',
]);

function parseArgs(argv) {
  const opts = {
    repo: null,
    source: SOURCE_KIND.CODEX,
    codexHome: path.join(os.homedir(), '.codex'),
    claudeHome: path.join(os.homedir(), '.claude'),
    port: 17890,
    host: '127.0.0.1',
    logDir: '',
    errors: [],
  };
  const canonicalOptionFor = (arg) => {
    if (arg === '-h') return '--help';
    if (!arg.startsWith('--')) return null;
    const key = arg.slice(2).replace(/[-_]/g, '').toLowerCase();
    const aliases = {
      repo: '--repo',
      repos: '--repo',
      repository: '--repo',
      repopath: '--repo',
      reporoot: '--repo',
      project: '--repo',
      projectroot: '--repo',
      source: '--source',
      transcriptsource: '--source',
      codexhome: '--codex-home',
      codexpath: '--codex-home',
      codexdir: '--codex-home',
      codexdirectory: '--codex-home',
      claudehome: '--claude-home',
      claudepath: '--claude-home',
      dshhome: '--dsh-home',
      dshpath: '--dsh-home',
      deepseekhome: '--dsh-home',
      deepseekharnesshome: '--dsh-home',
      claudedir: '--claude-home',
      claudedirectory: '--claude-home',
      port: '--port',
      host: '--host',
      hostname: '--host',
      logdir: '--log-dir',
      help: '--help',
    };
    return aliases[key] || null;
  };
  const isMissingOptionValue = (value) => value === undefined
    || (typeof value === 'string' && (value.startsWith('--') || /^-[A-Za-z]/.test(value)));
  const isBlankOptionValue = (value) => typeof value === 'string' && value.trim() === '';
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const option = canonicalOptionFor(arg);
    if (arg.startsWith('-') && !option) {
      opts.errors.push(`Unknown option: ${arg}.`);
      if (next !== undefined && !String(next).startsWith('-')) i += 1;
      continue;
    }
    if (!option) {
      opts.errors.push(`Unexpected positional argument: ${arg}. Use --repo <repo-path> to choose a repository.`);
      continue;
    }
    if (option === '--repo') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --repo. Expected a repository path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.repo = next;
      i += 1;
    } else if (option === '--source') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push(`Missing value for --source. Expected one of: ${supportedSourceKinds().join(', ')}.`);
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.source = normalizeSourceKind(next);
      if (!supportedSourceKinds().includes(opts.source)) {
        opts.errors.push(`Invalid value for --source: ${JSON.stringify(next)}. Expected one of: ${supportedSourceKinds().join(', ')}.`);
      }
      i += 1;
    } else if (option === '--codex-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --codex-home. Expected a Codex home path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.codexHome = next;
      i += 1;
    } else if (option === '--claude-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --claude-home. Expected a Claude home path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.claudeHome = next;
      i += 1;
    } else if (option === '--dsh-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --dsh-home. Expected a DeepSeek Harness sessions root.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.dshHome = next;
      i += 1;
    } else if (option === '--port') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --port. Expected an integer between 1 and 65535.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      const port = Number(next);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        opts.errors.push(`Invalid value for --port: ${JSON.stringify(next)}. Expected an integer between 1 and 65535.`);
        i += 1;
        continue;
      }
      opts.port = port;
      i += 1;
    } else if (option === '--host') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --host. Expected a non-empty host name or IP address.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.host = next;
      i += 1;
    } else if (option === '--log-dir') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --log-dir. Expected a directory path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.logDir = next;
      i += 1;
    } else if (option === '--help') {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  console.log([
    'Session Analyzer',
    '',
    'Usage:',
    '  session-analyzer [--repo <repo-path>] [--source <source>] [--codex-home <path>] [--claude-home <path>] [--dsh-home <path>] [--port <port>] [--host <host>] [--log-dir <path>]',
    '',
    'Options:',
    '  --repo <repo-path>     Repository to analyze. If omitted, select a project in the browser.',
    '  --source <source>       Transcript source: codex, claude-code, or deepseek-harness. Defaults to codex.',
    '  --codex-home <path>    Codex home directory. Defaults to ~/.codex.',
    '  --claude-home <path>   Claude home directory. Used only with --source claude-code. Defaults to ~/.claude.',
    '  --dsh-home <path>      DeepSeek Harness sessions persistence root. Used only with --source deepseek-harness. Defaults to ~/.dsh/sessions.',
    '  --port <port>          Local server port. Must be an integer from 1 to 65535. Defaults to 17890.',
    '  --host <host>          Advanced: bind host. Defaults to 127.0.0.1.',
    '  --log-dir <path>       Write throttled indexing diagnostics as bounded JSONL logs.',
    '',
    'Examples:',
    '  session-analyzer',
    '  session-analyzer --repo C:\\path\\to\\project',
    '  session-analyzer --repo C:\\path\\to\\project --codex-home C:\\Users\\you\\.codex --port 17890',
    '  session-analyzer --source claude-code --repo C:\\path\\to\\project --claude-home C:\\Users\\you\\.claude',
    '  session-analyzer --source deepseek-harness --repo C:\\path\\to\\project --dsh-home C:\\Users\\you\\.dsh\\sessions',
    '',
    'Privacy:',
    '  The default host is 127.0.0.1. Binding to another host can expose transcript content',
    '  available to this process to other machines on the network.',
  ].join('\n'));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, message, details, code) {
  sendJson(res, status, { error: message, details, code });
}

function sendImage(res, image) {
  res.writeHead(200, {
    'content-type': image.mimeType,
    'content-length': String(image.bytes.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(image.bytes);
}

function requestAbortContext(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onResponseClose = () => {
    if (!res.writableEnded) abort();
  };
  const cleanup = () => {
    req.removeListener('aborted', abort);
    res.removeListener('close', onResponseClose);
    res.removeListener('finish', cleanup);
  };
  req.once('aborted', abort);
  res.once('close', onResponseClose);
  res.once('finish', cleanup);
  return { signal: controller.signal, cleanup };
}

function parseQuery(reqUrl) {
  const parsed = new url.URL(reqUrl, 'http://localhost');
  return { pathname: parsed.pathname, searchParams: parsed.searchParams };
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    const error = new Error('Malformed URL path segment');
    error.statusCode = 400;
    throw error;
  }
}

function asNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    error.statusCode = 400;
    error.message = 'Invalid JSON request body';
    throw error;
  }
}

function statePayload(state, locale = i18n.DEFAULT_LOCALE) {
  const resolvedLocale = i18n.resolveLocale(locale);
  const query = queryForIndex(state.index);
  return {
    ...sourceConfigurationPayload(state),
    locale: resolvedLocale,
    supportedLocales: i18n.SUPPORTED_LOCALES,
    repoRoot: state.index.repoRoot,
    generatedAt: state.index.generatedAt,
    indexRevision: state.indexRevision,
    buildMs: state.buildMs,
    totals: state.index.totals,
    eventKinds: state.index.eventKinds
      ? {
        main: state.index.eventKinds.main.map((item) => ({ ...item, label: i18n.eventKindLabel(item.value, resolvedLocale) })),
        protocol: state.index.eventKinds.protocol.map((item) => ({ ...item, label: i18n.eventKindLabel(item.value, resolvedLocale) })),
        raw: state.index.eventKinds.raw.map((item) => ({ ...item, label: i18n.rawRecordLabel(item.value, resolvedLocale) })),
      }
      : state.index.eventKinds,
    ...query.indexPresentation(state.index, { locale: resolvedLocale }),
    foldingProfiles: foldingProfiles.map((profile) => i18n.localizeProfile(profile, resolvedLocale)),
    projectSelected: true,
  };
}

function activeProjectJob(state) {
  const job = state.activeProjectJob;
  return job && ['queued', 'running'].includes(job.status) ? job : null;
}

function requireIndex(state, res) {
  if (state.index) return state.index;
  sendError(res, 409, 'Project not selected', {
    ...sourceConfigurationPayload(state),
    projectSelected: false,
  });
  return null;
}

function materializeLeasedSession(capture, indexedSession, materializeSession) {
  return materializeSessionWithLease(
    capture.lease,
    indexedSession,
    capture.signal,
    ({ index, indexRevision, signal }) => materializeSession(index, indexedSession, {
      indexRevision,
      signal,
    }),
  );
}

function scheduleRevisionPrewarm(state, lease) {
  if (!state.sessionPrewarmPolicy
      || state.adapter.sessionLifecycle !== SESSION_LIFECYCLE.INDEXED_MATERIALIZED) return null;
  try {
    return scheduleBoundedSessionPrewarm(
      lease,
      (indexedSession, { index, indexRevision, signal }) => state.materializeSession(
        index,
        indexedSession,
        { indexRevision, signal },
      ),
      state.sessionPrewarmPolicy,
    );
  } catch (error) {
    try {
      state.warn(`Session prewarm scheduling skipped (${String(error?.code || error?.name || 'ERROR')}).`);
    } catch {
      // Background diagnostics must never change a committed project revision.
    }
    return null;
  }
}

function projectJobPayload(job) {
  if (!job) return null;
  return {
    id: job.id,
    repoRoot: job.repoRoot,
    locale: job.locale || i18n.DEFAULT_LOCALE,
    status: job.status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    buildMs: job.buildMs,
    error: job.error,
    progress: job.progress,
  };
}

function projectCachePayload(projects) {
  return (projects || []).map((project) => ({ ...project }));
}

function mergeProjectLists(configProjects = [], scannedProjects = [], options = {}) {
  const map = new Map();
  const order = [];
  const put = (project, override = true) => {
    const key = normalizeFsPath(project.repoRoot);
    if (!key) return;
    if (!map.has(key)) order.push(key);
    if (!override && map.has(key)) return;
    map.set(key, { ...project });
  };

  const putScanned = (project) => {
    put({
      ...project,
      statsPending: false,
      source: project.source || 'transcripts',
    });
  };

  if (options.full) {
    for (const project of scannedProjects) putScanned(project);
    for (const project of configProjects) put(project, false);
  } else {
    for (const project of configProjects) put(project);
    for (const project of scannedProjects) putScanned(project);
  }

  if (options.full) {
    for (const key of order) {
      const project = map.get(key);
      if (project.statsPending) {
        map.set(key, {
          ...project,
          sessionCount: 0,
          updatedAt: '',
          statsPending: false,
        });
      }
    }
  }

  return order.map((key) => map.get(key));
}

function sourceConfigHome(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Object.hasOwn(config, 'home')) return '';
  return typeof config.home === 'string' && config.home.trim() ? config.home : '';
}

function invalidSourceConfigError(kind) {
  const error = new Error(`${kind}.home must be an explicitly provided non-empty string.`);
  error.code = 'INVALID_SOURCE_CONFIG';
  return error;
}

function requireSourceConfigMap(sourceConfigs, owner = 'sourceConfigs') {
  if (!sourceConfigs || typeof sourceConfigs !== 'object' || Array.isArray(sourceConfigs)) {
    const error = new Error(`${owner} must be an object keyed by supported transcript source.`);
    error.code = 'INVALID_SOURCE_CONFIG';
    throw error;
  }
  const supportedKinds = new Set(supportedSourceKinds());
  for (const kind of Object.keys(sourceConfigs)) {
    if (!supportedKinds.has(kind)) {
      const error = new Error(`Unsupported source configuration: ${kind}.`);
      error.code = 'UNSUPPORTED_SOURCE_CONFIG';
      throw error;
    }
  }
  return sourceConfigs;
}

function sourceConfigEntryHome(sourceConfigs, kind) {
  if (!Object.hasOwn(sourceConfigs, kind)) return null;
  const home = sourceConfigHome(sourceConfigs[kind]);
  if (!home) throw invalidSourceConfigError(kind);
  return home;
}

function cloneSourceConfigs(sourceConfigs = {}) {
  const configuredSourceConfigs = requireSourceConfigMap(sourceConfigs);
  const result = {};
  for (const kind of supportedSourceKinds()) {
    const adapter = requireSourceAdapter(kind);
    const configured = sourceConfigEntryHome(configuredSourceConfigs, kind);
    const home = configured ?? adapter.defaultHome();
    result[kind] = { home: path.resolve(home) };
  }
  return result;
}

function sourceConfigsFromState(state) {
  if (Object.hasOwn(state, 'sourceConfigs')) {
    return cloneSourceConfigs(state.sourceConfigs);
  }
  const result = {};
  for (const kind of supportedSourceKinds()) {
    const adapter = requireSourceAdapter(kind);
    const legacyHome = state[adapter.homeOption];
    const fallback = kind === state.sourceKind ? state.sourceHome : adapter.defaultHome();
    result[kind] = { home: path.resolve(legacyHome || fallback) };
  }
  return result;
}

function activeSourceHome(state, sourceKind = state.sourceKind, sourceConfigs = sourceConfigsFromState(state)) {
  const home = sourceConfigHome(sourceConfigs[sourceKind]);
  if (!home) throw new Error(`Missing configured home for transcript source: ${sourceKind}`);
  return path.resolve(home);
}

function createInitialSourceConfigs(initialIndex, options, sourceKind) {
  const provided = Object.hasOwn(options, 'sourceConfigs')
    ? options.sourceConfigs
    : (initialIndex && Object.hasOwn(initialIndex, 'sourceConfigs') ? initialIndex.sourceConfigs : undefined);
  const canonicalSourceConfigs = provided === undefined ? null : requireSourceConfigMap(provided);
  const result = {};
  for (const kind of supportedSourceKinds()) {
    const adapter = requireSourceAdapter(kind);
    const configured = canonicalSourceConfigs
      ? sourceConfigEntryHome(canonicalSourceConfigs, kind)
      : null;
    let home = configured;
    if (home === null) {
      const legacy = initialIndex?.[adapter.homeOption]
        || initialIndex?.[`${kind}HomePath`]
        || options[adapter.homeOption];
      home = legacy || adapter.defaultHome();
      if (kind === sourceKind) {
        home = initialIndex?.sourceHome || options.sourceHome || home;
      }
    }
    result[kind] = { home: path.resolve(home) };
  }
  return result;
}

function legacySourceHomePayload(sourceConfigs) {
  const payload = {};
  for (const kind of supportedSourceKinds()) {
    const adapter = requireSourceAdapter(kind);
    payload[adapter.homeOption] = activeSourceHome({ sourceKind: kind }, kind, sourceConfigs);
  }
  return payload;
}

function sourceConfigurationPayload(state) {
  const sourceConfigs = sourceConfigsFromState(state);
  return {
    sourceKind: state.sourceKind,
    sourceHome: activeSourceHome(state, state.sourceKind, sourceConfigs),
    sourceConfigs,
    ...legacySourceHomePayload(sourceConfigs),
    supportedSources: supportedSourceKinds(),
    sourceOptions: supportedSourceOptions(),
  };
}

function cancelProjectJob(job) {
  if (!job || !['queued', 'running'].includes(job.status)) return;
  job.controller.abort();
  job.status = 'cancelled';
  job.completedAt = new Date().toISOString();
  job.buildMs = Date.now() - job.startedAtMs;
  job.error = 'Indexing cancelled';
  job.diagnostics?.finish('cancelled', { buildMs: job.buildMs });
}

async function discoverProjectsForSource(state, mode) {
  const revision = state.sourceRevision;
  const adapter = state.adapter;
  const sourceConfigs = sourceConfigsFromState(state);
  const context = {
    sourceKind: state.sourceKind,
    sourceHome: activeSourceHome(state, state.sourceKind, sourceConfigs),
    sourceConfigs,
  };
  const configuredProjects = await adapter.discoverConfiguredProjects(context);
  if (revision !== state.sourceRevision) return { stale: true };
  if (mode === 'summary') {
    const projects = mergeProjectLists(configuredProjects, state.projectCache?.projects || []);
    return {
      stale: false,
      payload: {
        ...sourceConfigurationPayload(state),
        projects,
        summary: true,
        cached: Boolean(state.projectCache),
      },
    };
  }
  const scannedProjects = await adapter.discoverProjects(context);
  if (revision !== state.sourceRevision) return { stale: true };
  const projects = mergeProjectLists(configuredProjects, scannedProjects, { full: true });
  state.projectCache = {
    generatedAt: new Date().toISOString(),
    projects: projectCachePayload(projects),
  };
  return {
    stale: false,
    payload: {
      ...sourceConfigurationPayload(state),
      projects,
    },
  };
}

function resolveSourceMutation(state, body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Invalid request body: expected a JSON object.'] };
  }
  const supportedKinds = supportedSourceKinds();
  const homeOptions = supportedKinds.map((kind) => requireSourceAdapter(kind).homeOption);
  const allowedFields = new Set(['source', 'sourceConfigs', ...homeOptions]);
  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    errors.push(`Unknown field${unknownFields.length > 1 ? 's' : ''}: ${unknownFields.join(', ')}.`);
  }
  const rawSource = body.source;
  if (typeof rawSource !== 'string' || rawSource.trim() === '') {
    errors.push(`Missing value for source. Expected one of: ${supportedSourceKinds().join(', ')}.`);
  } else {
    const candidateSourceKind = normalizeSourceKind(rawSource);
    if (!supportedKinds.includes(candidateSourceKind)) {
      errors.push(`Invalid value for source: ${JSON.stringify(rawSource)}. Expected one of: ${supportedKinds.join(', ')}.`);
    }
  }
  const currentSourceConfigs = sourceConfigsFromState(state);
  const nextSourceConfigs = cloneSourceConfigs(currentSourceConfigs);
  const resolveHome = (value, current) => {
    if (value === undefined) return current;
    if (typeof value !== 'string' || value.trim() === '') return null;
    return path.resolve(value);
  };

  if (Object.hasOwn(body, 'sourceConfigs')) {
    const canonicalKinds = new Set();
    if (!body.sourceConfigs || typeof body.sourceConfigs !== 'object' || Array.isArray(body.sourceConfigs)) {
      errors.push('sourceConfigs must be an object keyed by supported transcript source.');
    } else {
      for (const [kind, config] of Object.entries(body.sourceConfigs)) {
        if (!supportedKinds.includes(kind)) {
          errors.push(`Unsupported source configuration: ${kind}.`);
          continue;
        }
        canonicalKinds.add(kind);
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
          errors.push(`${kind} must be an object with a home when provided.`);
          continue;
        }
        if (!Object.hasOwn(config, 'home')
          || typeof config.home !== 'string'
          || config.home.trim() === '') {
          errors.push(`${kind}.home must be an explicitly provided non-empty string.`);
          continue;
        }
        nextSourceConfigs[kind] = { home: path.resolve(config.home) };
      }
    }

    for (const kind of supportedKinds) {
      const adapter = requireSourceAdapter(kind);
      if (canonicalKinds.has(kind) || !Object.hasOwn(body, adapter.homeOption)) continue;
      const nextHome = resolveHome(body[adapter.homeOption], sourceConfigHome(currentSourceConfigs[kind]));
      if (nextHome === null) {
        errors.push(`${adapter.homeOption} must be a non-empty string when provided.`);
      } else {
        nextSourceConfigs[kind] = { home: nextHome };
      }
    }
  } else {
    for (const kind of supportedKinds) {
      const adapter = requireSourceAdapter(kind);
      if (!Object.hasOwn(body, adapter.homeOption)) continue;
      const nextHome = resolveHome(body[adapter.homeOption], sourceConfigHome(currentSourceConfigs[kind]));
      if (nextHome === null) {
        errors.push(`${adapter.homeOption} must be a non-empty string when provided.`);
      } else {
        nextSourceConfigs[kind] = { home: nextHome };
      }
    }
  }
  if (errors.length > 0) return { errors };

  const nextSourceKind = normalizeSourceKind(rawSource);
  const configChanged = nextSourceKind !== state.sourceKind
    || supportedKinds.some((kind) => (
      normalizeFsPath(nextSourceConfigs[kind].home) !== normalizeFsPath(currentSourceConfigs[kind].home)
    ));
  if (configChanged) {
    const nextActiveHome = activeSourceHome(state, nextSourceKind, nextSourceConfigs);
    const activeIdentityChanged = nextSourceKind !== state.sourceKind
      || normalizeFsPath(nextActiveHome) !== normalizeFsPath(activeSourceHome(state, state.sourceKind, currentSourceConfigs));
    if (activeIdentityChanged) {
      cancelProjectJob(state.activeProjectJob);
      clearIndexRevision(state);
      state.projectCache = null;
      state.buildMs = 0;
      state.sourceKind = nextSourceKind;
      state.adapter = requireSourceAdapter(nextSourceKind);
    }
    state.sourceConfigs = nextSourceConfigs;
    state.sourceRevision += 1;
  } else if (!state.sourceConfigs) {
    state.sourceConfigs = currentSourceConfigs;
  }
  return {
    errors: [],
    payload: {
      ...sourceConfigurationPayload(state),
      projectSelected: Boolean(state.index),
    },
  };
}

function startProjectJob(state, repoRoot, locale = i18n.DEFAULT_LOCALE) {
  cancelProjectJob(state.activeProjectJob);

  const id = String(state.nextProjectJobId++);
  const controller = new AbortController();
  const resolvedLocale = i18n.resolveLocale(locale);
  const startedAtMs = Date.now();
  const job = {
    id,
    repoRoot,
    locale: resolvedLocale,
    controller,
    status: 'running',
    startedAt: new Date().toISOString(),
    startedAtMs,
    completedAt: '',
    buildMs: 0,
    error: '',
    progress: {
      phase: 'queued',
      repoRoot,
      filesTotal: 0,
      filesScanned: 0,
      candidateFileCount: 0,
      skippedFileCount: 0,
      unknownFileCount: 0,
      indexedFileCount: 0,
      indexedBytes: 0,
      elapsedMs: 0,
    },
  };
  job.diagnostics = createIndexDiagnostics({
    logDir: state.logDir,
    jobId: id,
    sourceKind: state.sourceKind,
  });
  job.capacityWarning = createLargeTranscriptHistoryWarning({
    warn: state.warn,
    onWarning: (warning) => job.diagnostics?.capacityWarning(warning),
  });
  state.activeProjectJob = job;

  const jobSourceConfigs = sourceConfigsFromState(state);
  const jobSourceKind = state.sourceKind;
  const jobSourceHome = activeSourceHome(state, jobSourceKind, jobSourceConfigs);
  const buildIndex = state.buildIndexOverride || ((context) => state.adapter.buildIndex(context));
  job.promise = Promise.resolve().then(() => buildIndex({
    repoRoot,
    sourceKind: jobSourceKind,
    sourceHome: jobSourceHome,
    sourceConfigs: jobSourceConfigs,
    previousIndex: state.index,
    signal: controller.signal,
    onProgress: (progress) => {
      job.progress = { ...job.progress, ...progress };
      job.diagnostics?.progress(job.progress);
      job.capacityWarning.observe(job.progress);
    },
  })).then(async (index) => {
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = 'Indexing cancelled';
      job.completedAt ||= new Date().toISOString();
      job.buildMs = Date.now() - startedAtMs;
      job.diagnostics?.finish('cancelled', { buildMs: job.buildMs });
      return;
    }
    const claimedIndexSourceKind = requireExplicitSourceKind(index?.sourceKind, 'index');
    if (claimedIndexSourceKind !== jobSourceKind) {
      const error = new Error(`Source ownership mismatch: job ${jobSourceKind}, index ${claimedIndexSourceKind}`);
      error.code = 'SOURCE_OWNERSHIP_MISMATCH';
      throw error;
    }
    await validateIndexOwnershipForCommit(index, {
      signal: controller.signal,
      onChunk: state.onIndexValidationChunk,
    });
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = 'Indexing cancelled';
      job.completedAt ||= new Date().toISOString();
      job.buildMs = Date.now() - startedAtMs;
      job.diagnostics?.finish('cancelled', { buildMs: job.buildMs });
      return;
    }
    job.status = 'succeeded';
    job.completedAt = new Date().toISOString();
    job.buildMs = Date.now() - startedAtMs;
    const lease = installIndexRevision(state, index);
    state.buildMs = job.buildMs;
    job.diagnostics?.finish('succeeded', { buildMs: job.buildMs });
    scheduleRevisionPrewarm(state, lease);
  }).catch((error) => {
    job.completedAt ||= new Date().toISOString();
    job.buildMs = Date.now() - startedAtMs;
    if (controller.signal.aborted || job.status === 'cancelled' || error.name === 'AbortError') {
      job.status = 'cancelled';
      job.error = 'Indexing cancelled';
      job.diagnostics?.finish('cancelled', { buildMs: job.buildMs });
      return;
    }
    job.status = 'failed';
    job.error = error.message || 'Indexing failed';
    job.diagnostics?.finish('failed', {
      buildMs: job.buildMs,
      errorName: error.name || 'Error',
      errorCode: error.code || '',
    });
  });

  return job;
}

async function serveStatic(res, pathname) {
  const publicRoot = path.join(__dirname, 'public');
  const target = resolveStaticAssetPath(publicRoot, pathname);
  if (!target) {
    sendError(res, 403, 'Forbidden');
    return;
  }
  try {
    const data = await fsp.readFile(target);
    res.writeHead(200, {
      'content-type': MIME[path.extname(target)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendError(res, 404, 'Not found');
      return;
    }
    sendError(res, 500, 'Unable to read static asset');
  }
}

function resolveStaticAssetPath(publicRoot, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const target = path.resolve(publicRoot, `.${safePath}`);
  return isPathInsideOrSame(target, publicRoot) ? target : '';
}

function createServer(initialIndex = null, buildMs = 0, options = {}) {
  const debugErrors = options.debugErrors ?? process.env.SESSION_ANALYZER_DEBUG_ERRORS === '1';
  const sourceKind = initialIndex?.repoRoot
    ? validateIndexOwnership(initialIndex, {
      allowUninspectableSessions: options.allowUninspectableSessions === true,
    })
    : normalizeSourceKind(options.sourceKind || options.source);
  const adapter = requireSourceAdapter(sourceKind);
  const sourceConfigs = createInitialSourceConfigs(initialIndex, options, sourceKind);
  const state = {
    index: initialIndex?.repoRoot ? initialIndex : null,
    buildMs: initialIndex?.repoRoot ? buildMs : 0,
    sourceKind,
    sourceConfigs,
    adapter,
    sourceRevision: 0,
    buildIndexOverride: options.buildIndex || null,
    onIndexValidationChunk: options.onIndexValidationChunk || null,
    materializeSession: options.materializeSession || materializeSessionForIndex,
    sessionPrewarmPolicy: options.sessionPrewarm === false
      ? null
      : { ...(options.sessionPrewarm || {}) },
    nextProjectJobId: 1,
    activeProjectJob: null,
    projectCache: null,
    logDir: options.logDir ? path.resolve(options.logDir) : '',
    warn: options.warn || console.warn,
  };
  initializeIndexRevisionState(state, state.index);
  if (options.repo) startProjectJob(state, options.repo, options.locale);

  const server = http.createServer(async (req, res) => {
    const requestAbort = requestAbortContext(req, res);
    try {
      const { pathname, searchParams } = parseQuery(req.url);
      const locale = i18n.resolveLocale(searchParams.get('locale') || req.headers['accept-language']);
      if (pathname === '/api/projects') {
        const mode = searchParams.get('summary') === '1' ? 'summary' : 'full';
        const result = await discoverProjectsForSource(state, mode);
        if (result.stale) {
          sendError(res, 409, 'Source changed during project discovery');
          return;
        }
        sendJson(res, 200, result.payload);
        return;
      }

      if (pathname === '/api/source' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = resolveSourceMutation(state, body);
        if (result.errors.length > 0) {
          sendError(res, 400, result.errors.join(' '));
          return;
        }
        sendJson(res, 200, result.payload);
        return;
      }

      if (pathname === '/api/project' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const repoRoot = String(body.repoRoot || '').trim();
        if (!repoRoot) {
          sendError(res, 400, 'repoRoot is required');
          return;
        }
        const job = startProjectJob(state, repoRoot, body.locale || locale);
        sendJson(res, 202, { job: projectJobPayload(job) });
        return;
      }

      if (pathname === '/api/project/status' && req.method === 'GET') {
        const job = state.activeProjectJob;
        const jobId = searchParams.get('jobId') || '';
        if (!job || (jobId && job.id !== jobId)) {
          sendError(res, 404, 'Project indexing job not found');
          return;
        }
        const payload = { job: projectJobPayload(job) };
        if (job.status === 'succeeded'
            && normalizeFsPath(state.index?.repoRoot) === normalizeFsPath(job.repoRoot)) {
          const stateLocale = searchParams.has('locale') ? locale : (job.locale || locale);
          payload.state = statePayload(state, stateLocale);
        }
        sendJson(res, 200, payload);
        return;
      }

      if (pathname === '/api/project/status' && req.method === 'DELETE') {
        const job = state.activeProjectJob;
        const jobId = searchParams.get('jobId') || '';
        if (!job || (jobId && job.id !== jobId)) {
          sendError(res, 404, 'Project indexing job not found');
          return;
        }
        cancelProjectJob(job);
        sendJson(res, 200, { job: projectJobPayload(job) });
        return;
      }

      if (pathname === '/api/state') {
        const activeJob = activeProjectJob(state);
        if (activeJob) {
          const payload = {
            ...sourceConfigurationPayload(state),
            projectSelected: false,
            job: projectJobPayload(activeJob),
          };
          if (state.index) {
            const stateLocale = searchParams.has('locale') ? locale : (activeJob.locale || locale);
            payload.currentState = statePayload(state, stateLocale);
          }
          sendJson(res, 202, payload);
          return;
        }
        if (!requireIndex(state, res)) return;
        sendJson(res, 200, statePayload(state, locale));
        return;
      }

      if (pathname === '/api/sessions') {
        if (!requireIndex(state, res)) return;
        const { value: result, lease } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          ({ index, signal }) => {
            const query = queryForIndex(index);
            return query.filterSessions(
              index,
              query.filtersFromSearchParams(searchParams, { locale }),
              { signal },
            );
          },
        );
        sendJson(res, 200, { ...result, indexRevision: lease.indexRevision });
        return;
      }

      if (pathname === '/api/file-suggestions') {
        if (!requireIndex(state, res)) return;
        const sessionId = searchParams.get('sessionId') || '';
        const { value: files, lease } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          async (capture) => {
            const { index, signal } = capture;
            const query = queryForIndex(index);
            const options = { layer: searchParams.get('layer') || 'main' };
            if (!sessionId) return query.projectFileSuggestions(index, options, { signal });
            const indexedSession = index.sessionsById.get(sessionId);
            if (!indexedSession) return null;
            const materializedSession = await materializeLeasedSession(
              capture,
              indexedSession,
              state.materializeSession,
            );
            return query.sessionFileSuggestions(index, materializedSession, options);
          },
        );
        if (files === null) {
          sendError(res, 404, 'Unknown session');
          return;
        }
        sendJson(res, 200, { files, indexRevision: lease.indexRevision });
        return;
      }

      const timelineMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/);
      if (timelineMatch) {
        if (!requireIndex(state, res)) return;
        const sessionId = decodePathSegment(timelineMatch[1]);
        const { value: result } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          async (capture) => {
            const { index } = capture;
            const indexedSession = index.sessionsById.get(sessionId);
            if (!indexedSession) return null;
            const session = await materializeLeasedSession(capture, indexedSession, state.materializeSession);
            const query = queryForIndex(index);
            return query.getTimeline(index, session, query.filtersFromSearchParams(searchParams, {
              offset: asNumber(searchParams.get('offset'), 0, 0, 1_000_000),
              limit: asNumber(searchParams.get('limit'), 150, 1, 500),
              locale,
            }));
          },
        );
        if (!result) {
          sendError(res, 404, 'Unknown session');
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      const eventMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/([^/]+)$/);
      if (eventMatch) {
        if (!requireIndex(state, res)) return;
        const sessionId = decodePathSegment(eventMatch[1]);
        const eventId = decodePathSegment(eventMatch[2]);
        const { value: event } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          async (capture) => {
            const { index } = capture;
            const indexedSession = index.sessionsById.get(sessionId);
            if (!indexedSession) return null;
            const session = await materializeLeasedSession(capture, indexedSession, state.materializeSession);
            return queryForIndex(index).getEvent(index, session, eventId, {
              layer: searchParams.get('layer') || 'main',
              locale,
            });
          },
        );
        if (!event) {
          sendError(res, 404, 'Unknown event');
          return;
        }
        sendJson(res, 200, event);
        return;
      }

      const detailMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/([^/]+)\/detail$/);
      if (detailMatch) {
        if (!requireIndex(state, res)) return;
        const sessionId = decodePathSegment(detailMatch[1]);
        const layer = searchParams.get('layer') || 'main';
        const { value: detail } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          async (capture) => {
            const { index, signal } = capture;
            const indexedSession = index.sessionsById.get(sessionId);
            if (!indexedSession) return null;
            const session = await materializeLeasedSession(capture, indexedSession, state.materializeSession);
            return buildEventDetailForSession(
              index,
              session,
              decodePathSegment(detailMatch[2]),
              layer,
              { locale, signal },
            );
          },
        );
        if (!detail) {
          sendError(res, 404, 'Unknown event');
          return;
        }
        sendJson(res, 200, detail);
        return;
      }

      const imagePreviewMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/([^/]+)\/image-previews\/([^/]+)$/);
      if (imagePreviewMatch) {
        if (!requireIndex(state, res)) return;
        const sessionId = decodePathSegment(imagePreviewMatch[1]);
        const { value: image } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          async (capture) => {
            const { index, signal } = capture;
            const indexedSession = index.sessionsById.get(sessionId);
            if (!indexedSession) return { statusCode: 404, error: 'Unknown session' };
            const session = await materializeLeasedSession(capture, indexedSession, state.materializeSession);
            return readImagePreviewForSession(
              index,
              session,
              decodePathSegment(imagePreviewMatch[2]),
              decodePathSegment(imagePreviewMatch[3]),
              { signal },
            );
          },
        );
        if (image.error) {
          sendError(
            res,
            image.statusCode,
            image.code === 'INDEXED_SOURCE_STALE'
              ? 'Indexed source changed; reindex required'
              : image.error,
            undefined,
            image.code,
          );
          return;
        }
        sendImage(res, image);
        return;
      }

      const analysisMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/analysis$/);
      if (analysisMatch) {
        if (!requireIndex(state, res)) return;
        const sessionId = decodePathSegment(analysisMatch[1]);
        const { value: analysis } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          async (capture) => {
            const { index } = capture;
            const indexedSession = index.sessionsById.get(sessionId);
            if (!indexedSession) return null;
            const session = await materializeLeasedSession(capture, indexedSession, state.materializeSession);
            return session.analysis;
          },
        );
        if (!analysis) {
          sendError(res, 404, 'Unknown session');
          return;
        }
        sendJson(res, 200, analysis);
        return;
      }

      const rawRecordMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/raw\/([^/]+)$/);
      if (rawRecordMatch) {
        if (!requireIndex(state, res)) return;
        const sessionId = decodePathSegment(rawRecordMatch[1]);
        const { value: raw } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          async (capture) => {
            const { index, signal } = capture;
            const indexedSession = index.sessionsById.get(sessionId);
            if (!indexedSession) return null;
            const session = await materializeLeasedSession(capture, indexedSession, state.materializeSession);
            return readIndexedRawRecord(index, session, decodePathSegment(rawRecordMatch[2]), { signal });
          },
        );
        if (!raw) {
          sendError(res, 404, 'Raw record not found');
          return;
        }
        sendJson(res, 200, raw);
        return;
      }

      if (pathname === '/api/raw') {
        if (!requireIndex(state, res)) return;
        const file = searchParams.get('file') || '';
        const line = asNumber(searchParams.get('line'), 0, 1, 1_000_000_000);
        if (!file || !line) {
          sendError(res, 400, 'file and line are required');
          return;
        }
        const { value: raw } = await withIndexRevisionLease(
          state,
          requestAbort.signal,
          async (capture) => {
            const { index, signal } = capture;
            const owner = resolveLegacyRawOwnerForIndex(index, file, line);
            if (!owner) return null;
            const indexedSession = index.sessionsById.get(owner.sessionId);
            if (!indexedSession) return null;
            const session = await materializeLeasedSession(capture, indexedSession, state.materializeSession);
            return readLegacyRawLineForSession(index, session, owner, owner.adapter, { signal });
          },
        );
        if (!raw) {
          sendError(res, 404, 'Raw line not found');
          return;
        }
        sendJson(res, 200, raw);
        return;
      }

      await serveStatic(res, pathname);
    } catch (error) {
      if (res.destroyed) return;
      if (error.name === 'AbortError') return;
      const statusCode = error.statusCode || 500;
      if (error.retryAfterSeconds && !res.headersSent) {
        res.setHeader('retry-after', String(error.retryAfterSeconds));
      }
      const details = debugErrors
        ? (statusCode >= 500 ? error.stack || error.message : error.message)
        : undefined;
      sendError(
        res,
        statusCode,
        statusCode >= 500 ? 'Internal server error' : error.message,
        details,
        statusCode < 500 || PUBLIC_RUNTIME_ERROR_CODES.has(error.code)
          ? error.code
          : undefined,
      );
    } finally {
      requestAbort.cleanup();
    }
  });
  server.on('close', () => clearIndexRevision(state));
  return server;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.errors.length > 0) {
    for (const message of opts.errors) {
      console.error(`Error: ${message}`);
    }
    printHelp();
    process.exitCode = 1;
    return;
  }

  const server = createServer(null, 0, {
    source: opts.source,
    codexHome: opts.codexHome,
    claudeHome: opts.claudeHome,
    dshHome: opts.dshHome,
    repo: opts.repo,
    logDir: opts.logDir,
  });
  const startupSourceConfigs = createInitialSourceConfigs(null, opts, opts.source);
  const startupAdapter = requireSourceAdapter(opts.source);
  const startupSourceHome = activeSourceHome({ sourceKind: opts.source }, opts.source, startupSourceConfigs);

  server.listen(opts.port, opts.host, () => {
    console.log(`Session Analyzer: http://${opts.host}:${opts.port}`);
    console.log(`Transcript source: ${opts.source}`);
    console.log(`${startupAdapter.homeLabel}: ${startupSourceHome}`);
    if (opts.repo) {
      console.log(`Repo: indexing ${path.resolve(opts.repo)}`);
    } else {
      console.log('Repo: select in browser');
    }
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createServer,
  discoverProjectsForSource,
  parseArgs,
  resolveSourceMutation,
  resolveStaticAssetPath,
};
