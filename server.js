#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const url = require('node:url');
const { buildIndex, buildEventDetail, discoverConfiguredProjects, discoverProjects, fileSuggestions, filterSessions, getTimeline, normalizeFsPath, readImagePreview, readRawLine } = require('./src/codex');
const { foldingProfiles } = require('./src/folding');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function parseArgs(argv) {
  const opts = {
    repo: null,
    codexHome: path.join(os.homedir(), '.codex'),
    port: 17890,
    host: '127.0.0.1',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--repo' && next) {
      opts.repo = next;
      i += 1;
    } else if (arg === '--codex-home' && next) {
      opts.codexHome = next;
      i += 1;
    } else if (arg === '--port' && next) {
      opts.port = Number(next);
      i += 1;
    } else if (arg === '--host' && next) {
      opts.host = next;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  console.log([
    'Codex Session Analyzer',
    '',
    'Usage:',
    '  node server.js [--repo <repo-path>] [--codex-home <path>] [--port <port>]',
    '',
    'Examples:',
    '  node server.js',
    '  node server.js --repo C:\\path\\to\\project',
    '  node server.js --repo C:\\path\\to\\project --codex-home C:\\Users\\you\\.codex --port 17890',
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

function sendError(res, status, message, details) {
  sendJson(res, status, { error: message, details });
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

function statePayload(state) {
  return {
    repoRoot: state.index.repoRoot,
    codexHome: state.index.codexHome,
    generatedAt: state.index.generatedAt,
    buildMs: state.buildMs,
    totals: state.index.totals,
    eventKinds: state.index.eventKinds,
    foldingProfiles,
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
    codexHome: state.codexHome,
    projectSelected: false,
  });
  return null;
}

function projectJobPayload(job) {
  if (!job) return null;
  return {
    id: job.id,
    repoRoot: job.repoRoot,
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

function startProjectJob(state, repoRoot) {
  if (state.activeProjectJob && ['queued', 'running'].includes(state.activeProjectJob.status)) {
    state.activeProjectJob.controller.abort();
  }

  const id = String(state.nextProjectJobId++);
  const controller = new AbortController();
  const job = {
    id,
    repoRoot,
    controller,
    status: 'running',
    startedAt: new Date().toISOString(),
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
  state.activeProjectJob = job;

  const startedAt = Date.now();
  job.promise = state.buildIndex({
    repoRoot,
    codexHome: state.codexHome,
    signal: controller.signal,
    onProgress: (progress) => {
      job.progress = { ...job.progress, ...progress };
    },
  }).then((index) => {
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = 'Indexing cancelled';
      return;
    }
    job.status = 'succeeded';
    job.completedAt = new Date().toISOString();
    job.buildMs = Date.now() - startedAt;
    state.index = index;
    state.buildMs = job.buildMs;
  }).catch((error) => {
    job.completedAt = new Date().toISOString();
    job.buildMs = Date.now() - startedAt;
    if (error.name === 'AbortError') {
      job.status = 'cancelled';
      job.error = 'Indexing cancelled';
      return;
    }
    job.status = 'failed';
    job.error = error.message || 'Indexing failed';
  });

  return job;
}

async function serveStatic(res, pathname) {
  const publicRoot = path.join(__dirname, 'public');
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const target = path.resolve(publicRoot, `.${safePath}`);
  if (!target.startsWith(publicRoot)) {
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
    sendError(res, 500, 'Unable to read static asset', error.message);
  }
}

function createServer(initialIndex = null, buildMs = 0, options = {}) {
  const state = {
    index: initialIndex?.repoRoot ? initialIndex : null,
    buildMs: initialIndex?.repoRoot ? buildMs : 0,
    codexHome: path.resolve(initialIndex?.codexHome || initialIndex?.codexHomePath || options.codexHome || path.join(os.homedir(), '.codex')),
    nextProjectJobId: 1,
    activeProjectJob: null,
    projectCache: null,
    buildIndex: options.buildIndex || buildIndex,
  };
  if (options.repo) startProjectJob(state, options.repo);

  return http.createServer(async (req, res) => {
    try {
      const { pathname, searchParams } = parseQuery(req.url);
      if (pathname === '/api/projects') {
        const configuredProjects = await discoverConfiguredProjects({ codexHome: state.codexHome });
        if (searchParams.get('summary') === '1') {
          const projects = mergeProjectLists(configuredProjects, state.projectCache?.projects || []);
          sendJson(res, 200, { codexHome: state.codexHome, projects, summary: true, cached: Boolean(state.projectCache) });
          return;
        }
        const scannedProjects = await discoverProjects({ codexHome: state.codexHome });
        const projects = mergeProjectLists(configuredProjects, scannedProjects, { full: true });
        state.projectCache = {
          generatedAt: new Date().toISOString(),
          projects: projectCachePayload(projects),
        };
        sendJson(res, 200, { codexHome: state.codexHome, projects });
        return;
      }

      if (pathname === '/api/project' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const repoRoot = String(body.repoRoot || '').trim();
        if (!repoRoot) {
          sendError(res, 400, 'repoRoot is required');
          return;
        }
        const job = startProjectJob(state, repoRoot);
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
        if (job.status === 'succeeded' && state.index?.repoRoot === path.resolve(job.repoRoot)) {
          payload.state = statePayload(state);
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
        if (['queued', 'running'].includes(job.status)) {
          job.controller.abort();
          job.status = 'cancelled';
          job.completedAt = new Date().toISOString();
          job.error = 'Indexing cancelled';
        }
        sendJson(res, 200, { job: projectJobPayload(job) });
        return;
      }

      if (pathname === '/api/state') {
        const activeJob = activeProjectJob(state);
        if (activeJob) {
          const payload = {
            projectSelected: false,
            codexHome: state.codexHome,
            job: projectJobPayload(activeJob),
          };
          if (state.index) {
            payload.currentState = statePayload(state);
          }
          sendJson(res, 202, payload);
          return;
        }
        if (!requireIndex(state, res)) return;
        sendJson(res, 200, statePayload(state));
        return;
      }

      if (pathname === '/api/sessions') {
        const index = requireIndex(state, res);
        if (!index) return;
        const result = filterSessions(index, {
          q: searchParams.get('q') || '',
          from: searchParams.get('from') || '',
          to: searchParams.get('to') || '',
          layer: searchParams.get('layer') || '',
          kind: searchParams.get('kind') || '',
          status: searchParams.get('status') || '',
          tool: searchParams.get('tool') || '',
          file: searchParams.get('file') || '',
          sort: searchParams.get('sort') || 'updated-desc',
        });
        sendJson(res, 200, result);
        return;
      }

      if (pathname === '/api/file-suggestions') {
        const index = requireIndex(state, res);
        if (!index) return;
        sendJson(res, 200, { files: fileSuggestions(index) });
        return;
      }

      const timelineMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/);
      if (timelineMatch) {
        const index = requireIndex(state, res);
        if (!index) return;
        const sessionId = decodePathSegment(timelineMatch[1]);
        const result = getTimeline(index, sessionId, {
          offset: asNumber(searchParams.get('offset'), 0, 0, 1_000_000),
          limit: asNumber(searchParams.get('limit'), 150, 1, 500),
          layer: searchParams.get('layer') || 'main',
          q: searchParams.get('q') || '',
          kind: searchParams.get('kind') || '',
          status: searchParams.get('status') || '',
          tool: searchParams.get('tool') || '',
          file: searchParams.get('file') || '',
        });
        if (!result) {
          sendError(res, 404, 'Unknown session');
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      const detailMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/([^/]+)\/detail$/);
      if (detailMatch) {
        const index = requireIndex(state, res);
        if (!index) return;
        const session = index.sessionsById.get(decodePathSegment(detailMatch[1]));
        if (!session) {
          sendError(res, 404, 'Unknown session');
          return;
        }
        const layer = searchParams.get('layer') || 'main';
        const detail = buildEventDetail(session, decodePathSegment(detailMatch[2]), layer);
        if (!detail) {
          sendError(res, 404, 'Unknown event');
          return;
        }
        sendJson(res, 200, detail);
        return;
      }

      const imagePreviewMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/([^/]+)\/image-previews\/([^/]+)$/);
      if (imagePreviewMatch) {
        const index = requireIndex(state, res);
        if (!index) return;
        const image = await readImagePreview(
          index,
          decodePathSegment(imagePreviewMatch[1]),
          decodePathSegment(imagePreviewMatch[2]),
          decodePathSegment(imagePreviewMatch[3]),
        );
        if (image.error) {
          sendError(res, image.statusCode, image.error);
          return;
        }
        sendImage(res, image);
        return;
      }

      const analysisMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/analysis$/);
      if (analysisMatch) {
        const index = requireIndex(state, res);
        if (!index) return;
        const session = index.sessionsById.get(decodePathSegment(analysisMatch[1]));
        if (!session) {
          sendError(res, 404, 'Unknown session');
          return;
        }
        sendJson(res, 200, session.analysis);
        return;
      }

      if (pathname === '/api/raw') {
        const index = requireIndex(state, res);
        if (!index) return;
        const file = searchParams.get('file') || '';
        const line = asNumber(searchParams.get('line'), 0, 1, 1_000_000_000);
        if (!file || !line) {
          sendError(res, 400, 'file and line are required');
          return;
        }
        const raw = await readRawLine(index, file, line);
        if (!raw) {
          sendError(res, 404, 'Raw line not found');
          return;
        }
        sendJson(res, 200, raw);
        return;
      }

      await serveStatic(res, pathname);
    } catch (error) {
      sendError(res, error.statusCode || 500, error.statusCode ? error.message : 'Internal server error', error.statusCode ? undefined : error.stack || error.message);
    }
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const server = createServer(null, 0, { codexHome: opts.codexHome, repo: opts.repo });

  server.listen(opts.port, opts.host, () => {
    console.log(`Codex Session Analyzer: http://${opts.host}:${opts.port}`);
    if (opts.repo) {
      console.log(`Repo: indexing ${path.resolve(opts.repo)}`);
      console.log(`Codex home: ${path.resolve(opts.codexHome)}`);
    } else {
      console.log('Repo: select in browser');
      console.log(`Codex home: ${path.resolve(opts.codexHome)}`);
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
  parseArgs,
};
