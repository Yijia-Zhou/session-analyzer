'use strict';

// Current-history navigation is separate from snapshot-bound history references.
// A bookmark names an admitted artifact and an unchanged physical entry, not a leaf.
const path = require('node:path');
const storage = require('./pi-storage');
const logical = require('./pi-logical');
const { nativeStatistics } = require('./pi-native-statistics');
const { redactEmbeddedDataUrls } = require('./shared/logical-detail-sanitizer');

const PREFIX = 'pi-entry-v1.';
const MAX_REFERENCE = 8192;
const MAX_BRANCHES = 100;
const MAX_LABELS = 50;
const text = (value, limit = 240) => typeof value === 'string' ? redactEmbeddedDataUrls(value).trim().slice(0, limit) : '';
const digest = (value) => storage.hash(value);
const scope = (index) => digest(JSON.stringify([path.resolve(index.sessionsRoot), path.resolve(index.repoRoot)]));
const contentText = (content) => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n') : '';
const title = (session) => text(session.title.replace(/^\[branch [^\]]*\]\s*/, ''));

function decode(reference) {
  if (typeof reference !== 'string' || reference.length > MAX_REFERENCE || !reference.startsWith(PREFIX)) return null;
  const encoded = reference.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  let value;
  try { value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'artifact,entry,hash,layer,projection,scope,session,v'
      || value.v !== 1 || typeof value.scope !== 'string' || typeof value.hash !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.scope) || !/^[a-f0-9]{64}$/.test(value.hash)
      || !['artifact', 'entry', 'session'].every((key) => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 2048)
      || typeof value.projection !== 'string' || value.projection.length > 200
      || !['raw', 'main', 'protocol'].includes(value.layer)
      || (value.layer === 'raw' && value.projection !== '')) return null;
  return value;
}

function referenceFor(index, session, row, projection = '', layer = 'raw') {
  if (!row?.parsed?.id) return null;
  const value = { v: 1, scope: scope(index), artifact: session.sourceFile,
    session: session.sourceSessionId, entry: row.parsed.id, hash: digest(row.text), projection, layer };
  const result = PREFIX + Buffer.from(JSON.stringify(value)).toString('base64url');
  return result.length <= MAX_REFERENCE ? result : null;
}

async function documentFor(index, session, signal) {
  storage.abort(signal);
  if (index.sourceKind !== 'pi' || !session || session.sourceKind !== 'pi') return null;
  const { snapshotForSession } = require('./pi');
  let snapshot;
  try { snapshot = await snapshotForSession(index, session, signal); }
  catch (error) {
    if (error.code === 'INDEXED_SOURCE_STALE') error.statusCode = 409;
    throw error;
  }
  const document = storage.parsePiDocument(snapshot);
  if (document.invalidTree || document.header.id !== session.sourceSessionId) return null;
  return document;
}

function ancestry(document, leafId) {
  const rows = [];
  for (let row = document.byId.get(leafId); row; row = document.byId.get(row.parsed.parentId)) rows.push(row);
  return rows.reverse();
}

function entryPreview(row) {
  const entry = row?.parsed;
  if (!entry) return '';
  const message = entry.message;
  if (message?.role === 'bashExecution') return text(message.command);
  const content = contentText(message?.content ?? entry.content);
  if (content) return text(content);
  if (entry.summary) return text(entry.summary);
  const call = Array.isArray(message?.content) && message.content.find((block) => block?.type === 'toolCall');
  if (call) return text(call.name);
  return '';
}

function branchInfo(document, session) {
  const rows = ancestry(document, session.sourceDerivedId);
  let tip = '';
  for (let i = rows.length - 1; i >= 0 && !tip; i--) tip = entryPreview(rows[i]);
  return { sessionId: session.id, leafId: session.sourceDerivedId, title: title(session), tip, updatedAt: session.updatedAt };
}

function artifactBranches(index, session) {
  return index.sessions.filter((candidate) => candidate.sourceKind === 'pi'
    && candidate.sourceSessionId === session.sourceSessionId && candidate.sourceFile === session.sourceFile);
}

async function readPiNavigation(index, session, options = {}) {
  const document = await documentFor(index, session, options.signal);
  if (!document) return null;
  const candidates = artifactBranches(index, session);
  const selectedRows = ancestry(document, session.sourceDerivedId);
  const selectedIds = new Set(selectedRows.map((row) => row.parsed.id));
  // Keep the selected branch visible even when a very large tree is truncated.
  const visible = [session, ...candidates.filter((candidate) => candidate.id !== session.id)].slice(0, MAX_BRANCHES);
  const branches = visible.map((branch) => {
    storage.abort(options.signal);
    const rows = ancestry(document, branch.sourceDerivedId);
    const common = branch.id === session.id ? null : rows.findLast((row) => selectedIds.has(row.parsed.id));
    return { ...branchInfo(document, branch), reference: referenceFor(index, branch, rows.at(-1)),
      divergence: common ? { entryId: common.parsed.id, preview: entryPreview(common),
        reference: referenceFor(index, branch, common) } : null };
  });
  let name = '';
  const labels = new Map();
  for (const row of document.entries) {
    const entry = row.parsed;
    if (entry?.type === 'session_info' && typeof entry.name === 'string') name = text(entry.name);
    if (entry?.type !== 'label' || typeof entry.targetId !== 'string') continue;
    const target = document.byId.get(entry.targetId);
    if (!target || target.line >= row.line) continue;
    if (typeof entry.label === 'string' && entry.label.length) {
      labels.set(entry.targetId, { label: text(entry.label), entryId: entry.targetId,
        reference: referenceFor(index, session, target) });
    } else if (entry.label === undefined || entry.label === '') labels.delete(entry.targetId);
  }
  return { nativeSessionId: session.sourceSessionId, name, sourceFile: session.sourceFile,
    nativeStatistics: nativeStatistics(document, session.sourceFile, options),
    branchCount: candidates.length, branches, labels: [...labels.values()].slice(0, MAX_LABELS), totalLabels: labels.size,
    truncated: candidates.length > MAX_BRANCHES || labels.size > MAX_LABELS, selectedSessionId: session.id,
    summaryTarget: { sessionId: session.id, eventId: `${session.id}:event:${document.rows[0].line}:pi_branch`, layer: 'protocol' } };
}

function relatedRow(document, row, selectedIds) {
  const entry = row.parsed;
  const id = entry.type === 'branch_summary' ? entry.fromId
    : entry.type === 'label' || entry.type === 'context_edit' ? entry.targetId
      : entry.type === 'compaction' ? entry.firstKeptEntryId : null;
  const target = typeof id === 'string' && document.byId.get(id);
  if (!target || target.line >= row.line) return null;
  if (['context_edit', 'compaction'].includes(entry.type) && !selectedIds.has(id)) return null;
  return target;
}

async function createPiEntryReference(index, session, eventId, layer, options = {}) {
  const document = await documentFor(index, session, options.signal);
  if (!document) return null;
  // Derive ownership from the exact accepted projection; caller IDs cannot select a sibling.
  const projected = logical.sessionsFromPiDocument(document, session.sourceFile, session.sourceDerivedId)
    .find((candidate) => candidate.id === session.id);
  if (!projected) return null;
  const event = layer === 'raw' ? projected.rawEvents.find((raw) => raw.rawId === eventId)
    : projected.logicalEvents.find((candidate) => candidate.id === eventId && candidate.layer === layer);
  if (!event) return null;
  const line = layer === 'raw' ? event.line : event.source.line;
  const row = document.rows.find((candidate) => candidate.line === line);
  const selectedIds = new Set(projected.rawEvents.map((raw) => raw.entryId));
  if (!row || !document.byId.has(row.parsed?.id)) return { reference: null, relatedReference: null, relatedLabel: null };
  const projection = layer === 'raw' ? '' : event.id.slice(`${session.id}:event:${line}:`.length);
  const target = relatedRow(document, row, selectedIds);
  return { reference: referenceFor(index, session, row, projection, layer),
    relatedReference: target ? referenceFor(index, session, target) : null,
    relatedLabel: target ? (row.parsed.type === 'branch_summary' ? 'summarized_branch' : 'referenced_entry') : null };
}

async function resolvePiEntryReference(index, reference, options = {}) {
  const branchOffset = options.branchOffset === undefined ? 0 : options.branchOffset;
  if (!Number.isSafeInteger(branchOffset) || branchOffset < 0) {
    throw Object.assign(new Error('Invalid branch offset'), { statusCode: 400 });
  }
  const unavailable = () => ({ status: 'unavailable', reference: typeof reference === 'string' && reference.length <= MAX_REFERENCE ? reference : '', branches: [] });
  const value = decode(reference);
  if (!value || index.sourceKind !== 'pi' || value.scope !== scope(index)) return unavailable();
  // Never open a path supplied by the reference: first match an indexed artifact.
  const owner = index.sessions.find((session) => session.sourceKind === 'pi'
    && session.sourceSessionId === value.session && session.sourceFile === value.artifact);
  if (!owner) return unavailable();
  const document = await documentFor(index, owner, options.signal);
  const row = document?.byId.get(value.entry);
  if (!row || digest(row.text) !== value.hash) return unavailable();
  const candidates = artifactBranches(index, owner).filter((session) => {
    storage.abort(options.signal);
    return ancestry(document, session.sourceDerivedId).some((candidate) => candidate.parsed.id === value.entry);
  });
  const chosen = options.branchId ? candidates.find((session) => session.id === options.branchId)
    : candidates.length === 1 ? candidates[0] : null;
  if (!candidates.length || (options.branchId && !chosen)) return unavailable();
  const visible = chosen ? [chosen, ...candidates.filter((session) => session.id !== chosen.id)].slice(0, MAX_BRANCHES)
    : candidates.slice(branchOffset, branchOffset + MAX_BRANCHES);
  const branches = visible.map((session) => ({ ...branchInfo(document, session),
    target: { sessionId: session.id, eventId: `${session.id}:raw:${row.line}`, layer: 'raw' } }));
  const result = { status: chosen ? 'resolved' : 'choose_branch', reference, entryId: value.entry,
    branchCount: candidates.length, branches, truncated: candidates.length > MAX_BRANCHES,
    nextOffset: !chosen && branchOffset + visible.length < candidates.length ? branchOffset + visible.length : null };
  if (chosen) {
    let event;
    if (value.layer !== 'raw') {
      const projected = logical.sessionsFromPiDocument(document, chosen.sourceFile, chosen.sourceDerivedId)
        .find((session) => session.id === chosen.id);
      const id = `${chosen.id}:event:${row.line}:${value.projection}`;
      event = projected?.logicalEvents.find((candidate) => candidate.id === id && candidate.layer === value.layer);
    }
    result.target = { sessionId: chosen.id, eventId: event?.id || `${chosen.id}:raw:${row.line}`, layer: event?.layer || 'raw' };
    result.projectionUnavailable = value.layer !== 'raw' && !event;
  }
  return result;
}

module.exports = { readPiNavigation, createPiEntryReference, resolvePiEntryReference };
