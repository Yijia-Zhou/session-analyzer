'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');

const SOURCE_REF_PREFIX = 'sr1.';
const LOCATOR_TYPE = 'jsonl-line';

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

function indexedAbsolutePath(root, relative) {
  if (typeof root !== 'string' || !path.isAbsolute(root)
      || typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null;
  const absolute = path.resolve(root, relative);
  const inside = path.relative(root, absolute);
  return inside && inside !== '..' && !inside.startsWith(`..${path.sep}`)
    && !path.isAbsolute(inside) ? absolute : null;
}

function sourceRecord(session, index) {
  if (session?.sourceKind !== 'codex' || typeof session.sourceFile !== 'string'
      || !session.sourceFile.endsWith('.jsonl')) return null;
  const descriptor = session.materializationDescriptor;
  const dependencies = index.materializationDependencies?.get(descriptor?.dependencySetId);
  const entry = dependencies?.entries?.find((candidate) => candidate.role === 'primary_transcript');
  if (!entry || entry.pathIdentity !== session.sourceFile || entry.existence !== 'present'
      || entry.kind !== 'file' || entry.policy !== 'accepted_prefix'
      || !Number.isSafeInteger(entry.lineCount) || entry.lineCount < 0
      || !Number.isSafeInteger(entry.acceptedBytes) || entry.acceptedBytes < 0
      || typeof entry.digest !== 'string' || !entry.digest) return null;
  // The materialization descriptor includes session-specific relationships.
  // A source reference instead identifies the accepted primary file snapshot,
  // shared by every derived session that reads the same JSONL bytes.
  const version = digest([entry.pathIdentity, entry.acceptedBytes, entry.lineCount,
    entry.digest, entry.evidence?.fileIdentity]);
  return { path: entry.pathIdentity, version, session };
}

function parseSourceRef(value) {
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith(SOURCE_REF_PREFIX)) {
    fail('INVALID_REFERENCE', 'Malformed source reference');
  }
  let parsed;
  try {
    const encoded = value.slice(SOURCE_REF_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error('invalid encoding');
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    fail('INVALID_REFERENCE', 'Malformed source reference');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof parsed.p !== 'string' || typeof parsed.f !== 'string'
      || typeof parsed.v !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(parsed.v)) {
    fail('INVALID_REFERENCE', 'Malformed source reference');
  }
  return parsed;
}

function createHistorySourceLocator({ index, scope, materialize, makeEvidenceRef }) {
  if (!index || typeof scope !== 'string' || !scope || typeof materialize !== 'function'
      || typeof makeEvidenceRef !== 'function') fail('INVALID_ARGUMENT', 'Invalid source locator setup');
  const scopeId = digest(scope);
  const records = (index.sessions || []).map((session) => sourceRecord(session, index)).filter(Boolean);
  const byPath = new Map();
  const absoluteAliases = new Map();
  const unsupportedPaths = new Set();
  for (const session of index.sessions || []) {
    if (typeof session.sourceFile === 'string' && session.sourceFile && !sourceRecord(session, index)) {
      unsupportedPaths.add(session.sourceFile);
      const absolute = indexedAbsolutePath(index.sessionsRoot, session.sourceFile);
      if (absolute) unsupportedPaths.add(absolute);
    }
  }
  for (const record of records) {
    if (!byPath.has(record.path)) byPath.set(record.path, []);
    byPath.get(record.path).push(record);
    // Alias construction uses only the admitted metadata path and its indexed
    // Codex sessions root; caller text is never resolved as a filesystem path.
    const absolute = indexedAbsolutePath(index.sessionsRoot, record.path);
    if (absolute) absoluteAliases.set(absolute, record.path);
  }

  async function resolveLocator(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || (input.sourceRef === undefined) === (input.sourcePath === undefined)) {
      fail('INVALID_ARGUMENT', 'Provide exactly one sourceRef or sourcePath');
    }
    if (!input.locator || typeof input.locator !== 'object' || Array.isArray(input.locator)
        || Object.keys(input.locator).some((key) => !['type', 'line'].includes(key))) {
      fail('INVALID_ARGUMENT', 'Expected a JSONL line locator with type and line only');
    }
    if (input.locator.type !== LOCATOR_TYPE) {
      fail('UNSUPPORTED_LOCATOR', 'Only physical JSONL line locators are supported');
    }
    if (!Number.isSafeInteger(input.locator.line) || input.locator.line < 1) {
      fail('INVALID_ARGUMENT', 'Expected a positive 1-based JSONL line locator');
    }
    const { line } = input.locator;
    let sourcePath;
    let expectedVersion;
    const legacy = input.sourcePath !== undefined;
    if (legacy) {
      if (typeof input.sourcePath !== 'string' || !input.sourcePath || input.sourcePath.length > 4096) {
        fail('INVALID_ARGUMENT', 'sourcePath must be an indexed source path');
      }
      sourcePath = absoluteAliases.get(input.sourcePath) || input.sourcePath;
    } else {
      const parsed = parseSourceRef(input.sourceRef);
      if (parsed.p !== scopeId) fail('REFERENCE_SCOPE_MISMATCH', 'Source belongs to another project/source/root');
      sourcePath = parsed.f;
      expectedVersion = parsed.v;
    }
    // Exact index metadata lookup only. The input path is never opened,
    // normalized into an owner, or passed to an adapter as a filesystem path.
    const admitted = byPath.get(sourcePath);
    if (!admitted?.length) {
      if (unsupportedPaths.has(sourcePath)) fail('UNSUPPORTED_SOURCE', 'Indexed source is not an uncompressed Codex JSONL file');
      fail('UNKNOWN_SOURCE', 'Source path is not admitted by this index');
    }
    const versions = new Set(admitted.map((record) => record.version));
    if (versions.size !== 1) fail('AMBIGUOUS_SOURCE', 'Indexed sessions disagree on the source snapshot');
    const [version] = versions;
    if (expectedVersion !== undefined && expectedVersion !== version) {
      fail('STALE_REFERENCE', 'Source snapshot changed; obtain a new source reference');
    }
    // Materialization rechecks the indexed source and relationship snapshot.
    // Doing this even for an unassociated line keeps zero-match answers honest.
    const matches = [];
    let lastRawLine = 0;
    for (const record of admitted) {
      let session;
      try { session = await materialize(record.session); }
      catch (error) {
        if (/STALE|SNAPSHOT|ENOENT/u.test(error?.code || '')) {
          fail('STALE_REFERENCE', 'Indexed source changed or became unavailable');
        }
        throw error;
      }
      // entry.lineCount counts nonblank records, while canonical locators use
      // physical line numbers. Bound requests by the furthest verified raw.
      const raws = [];
      for (const raw of session.rawEvents || []) {
        if (raw.sourceLocator?.type !== 'jsonl_line' || raw.sourceLocator.file !== sourcePath.replace(/\\/gu, '/')) continue;
        if (Number.isSafeInteger(raw.sourceLocator.line)) {
          lastRawLine = Math.max(lastRawLine, raw.sourceLocator.line);
          if (raw.sourceLocator.line === line) raws.push(raw);
        }
      }
      for (const raw of raws) {
        const logical = (session.logicalEvents || []).filter((event) =>
          Array.isArray(event.rawRefs) && event.rawRefs.some((ref) => ref.rawId === raw.rawId));
        matches.push({ sessionId: session.id, rawId: raw.rawId,
          rawRef: makeEvidenceRef(record.session, 'raw', raw),
          logicalRefs: logical.map((event) => ({ layer: event.layer, eventId: event.id,
            ref: makeEvidenceRef(record.session, event.layer, event) })) });
      }
    }
    if (line > lastRawLine) fail('INVALID_LOCATOR', 'JSONL line is outside admitted physical raw lines');
    const sourceRef = SOURCE_REF_PREFIX + Buffer.from(JSON.stringify({
      p: scopeId, f: sourcePath, v: version,
    })).toString('base64url');
    return {
      sourceRef, sourcePath, locator: { type: LOCATOR_TYPE, line },
      verification: legacy ? 'unverified_legacy_locator' : 'source_snapshot_verified',
      warnings: legacy ? ['Legacy path and line have no historical version; resolved against the current indexed source snapshot only.'] : [],
      matches,
    };
  }

  return { resolveLocator };
}

module.exports = { createHistorySourceLocator };
