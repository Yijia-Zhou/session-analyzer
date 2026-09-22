'use strict';

const http = require('node:http');

const OPERATIONS = new Set(['status', 'search', 'context', 'read']);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const STRING_FIELDS = new Set(['contextRef', 'cursor', 'query', 'layer', 'kind', 'status', 'tool', 'file', 'retrievalArtifacts', 'view', 'from', 'to']);
const ARRAY_FIELDS = new Set(['queries', 'exclude', 'refs', 'parts']);
const NUMBER_FIELDS = new Set(['limit', 'maxBytes', 'offset', 'length']);

function historyError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function validateHistoryInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw historyError('INVALID_INPUT', 'Input must be a JSON object.');
  for (const [key, value] of Object.entries(input)) {
    if (STRING_FIELDS.has(key)) {
      if (typeof value !== 'string' || !value.trim() || value.length > 65536) throw historyError('INVALID_INPUT', `${key} must be a non-empty string of at most 65536 characters.`);
    } else if (ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 65536)) throw historyError('INVALID_INPUT', `${key} must contain at most 100 non-empty strings.`);
    } else if (NUMBER_FIELDS.has(key)) {
      if (!Number.isSafeInteger(value) || value < 0) throw historyError('INVALID_INPUT', `${key} must be a non-negative safe integer.`);
    } else {
      throw historyError('INVALID_INPUT', `Unknown input field: ${key}.`);
    }
  }
  return input;
}

function errorEnvelope(operation, error) {
  return {
    producer: 'session-analyzer', operation: `history.${operation || 'unknown'}`, schemaVersion: 1,
    error: { code: error?.code || 'INTERNAL_ERROR', message: error?.code ? error.message : 'History request failed.' },
  };
}

function sendJson(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => { req.removeListener('data', onData); req.removeListener('end', onEnd); req.removeListener('error', onError); req.removeListener('aborted', onAborted); };
    const fail = (error) => { cleanup(); reject(error); };
    const onError = () => fail(historyError('REQUEST_ABORTED', 'Request body could not be read.'));
    const onAborted = () => fail(historyError('REQUEST_ABORTED', 'Request was aborted.'));
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { fail(historyError('BODY_TOO_LARGE', `Request exceeds ${MAX_BODY_BYTES} bytes.`, 413)); req.resume(); }
      else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(historyError('INVALID_JSON', 'Request must contain valid JSON.')); }
    };
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
  });
}

function createHistoryServer(service) {
  const server = http.createServer(async (req, res) => {
    const match = /^\/api\/history\/(status|search|context|read)$/.exec(req.url);
    const operation = match?.[1];
    try {
      if (req.headers.origin || req.headers.host !== `127.0.0.1:${server.address().port}`) throw historyError('LOCAL_CLIENT_REQUIRED', 'Use a local non-browser client at 127.0.0.1.', 403);
      if (!operation) throw historyError('NOT_FOUND', 'Unknown history endpoint.', 404);
      if (req.method !== 'POST') throw historyError('METHOD_NOT_ALLOWED', 'Use POST with a JSON object.', 405);
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw historyError('CONTENT_TYPE_REQUIRED', 'Content-Type must be application/json.', 415);
      if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw historyError('BODY_TOO_LARGE', `Request exceeds ${MAX_BODY_BYTES} bytes.`, 413);
      const input = validateHistoryInput(await readBody(req));
      const result = await service.execute(operation, input);
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES) throw historyError('RESPONSE_TOO_LARGE', 'Reduce maxBytes or the number of references.', 413);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error?.statusCode || (error?.code ? 400 : 500), errorEnvelope(operation, error));
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.setTimeout(120000, (socket) => socket.destroy());
  return server;
}

async function startHistoryServer(options, createService) {
  const factory = createService || require('./history-service').createHistoryService;
  const service = await factory(options);
  const server = createHistoryServer(service);
  let closePromise;
  const closeService = () => { closePromise ||= Promise.resolve().then(() => service.close()); return closePromise; };
  server.once('close', () => { closeService().catch(() => {}); });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 17891, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
  } catch (error) { await closeService(); throw error; }
  return { server, service, endpoint: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await closeService(); } };
}

module.exports = { OPERATIONS, MAX_BODY_BYTES, MAX_RESPONSE_BYTES, historyError, errorEnvelope, validateHistoryInput, createHistoryServer, startHistoryServer };
