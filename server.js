#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const url = require('node:url');
const { buildIndex, buildEventDetail, filterSessions, getTimeline, readRawLine } = require('./src/codex');
const { foldingProfiles } = require('./src/folding');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function parseArgs(argv) {
  const opts = {
    repo: process.cwd(),
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
    '  node server.js --repo <repo-path> [--codex-home <path>] [--port <port>]',
    '',
    'Examples:',
    '  node server.js --repo G:\\vibe\\term-agent',
    '  node server.js --repo G:\\vibe\\term-agent --codex-home C:\\Users\\Yijia\\.codex --port 17890',
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

function parseQuery(reqUrl) {
  const parsed = new url.URL(reqUrl, 'http://localhost');
  return { pathname: parsed.pathname, searchParams: parsed.searchParams };
}

function asNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
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

function createServer(index, buildMs = 0) {
  return http.createServer(async (req, res) => {
    try {
      const { pathname, searchParams } = parseQuery(req.url);
      if (pathname === '/api/state') {
        sendJson(res, 200, {
          repoRoot: index.repoRoot,
          codexHome: index.codexHome,
          generatedAt: index.generatedAt,
          buildMs,
          totals: index.totals,
          foldingProfiles,
        });
        return;
      }

      if (pathname === '/api/sessions') {
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

      const timelineMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/);
      if (timelineMatch) {
        const sessionId = decodeURIComponent(timelineMatch[1]);
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
        const session = index.sessionsById.get(decodeURIComponent(detailMatch[1]));
        if (!session) {
          sendError(res, 404, 'Unknown session');
          return;
        }
        const layer = searchParams.get('layer') || 'main';
        const detail = buildEventDetail(session, decodeURIComponent(detailMatch[2]), layer);
        if (!detail) {
          sendError(res, 404, 'Unknown event');
          return;
        }
        sendJson(res, 200, detail);
        return;
      }

      const analysisMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/analysis$/);
      if (analysisMatch) {
        const session = index.sessionsById.get(decodeURIComponent(analysisMatch[1]));
        if (!session) {
          sendError(res, 404, 'Unknown session');
          return;
        }
        sendJson(res, 200, session.analysis);
        return;
      }

      if (pathname === '/api/raw') {
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
      sendError(res, 500, 'Internal server error', error.stack || error.message);
    }
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const startedAt = Date.now();
  const index = await buildIndex({
    repoRoot: opts.repo,
    codexHome: opts.codexHome,
  });
  const buildMs = Date.now() - startedAt;
  const server = createServer(index, buildMs);

  server.listen(opts.port, opts.host, () => {
    console.log(`Codex Session Analyzer: http://${opts.host}:${opts.port}`);
    console.log(`Repo: ${index.repoRoot}`);
    console.log(`Codex home: ${index.codexHome}`);
    console.log(`Indexed ${index.totals.sessionCount} sessions from ${index.totals.fileCount} files in ${buildMs}ms`);
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
