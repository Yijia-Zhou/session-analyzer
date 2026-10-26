'use strict';

const { abort } = require('./pi-storage');

const IMAGE_PREVIEW_LIMIT = 8;
const IMAGE_PREVIEW_MAX_ENCODED_CHARS = 16 * 1024 * 1024;
const IMAGE_PREVIEW_MAX_DECODED_BYTES = 12 * 1024 * 1024;
const SAVED_IMAGE_MARKER = '[saved image payload omitted; see image preview or raw refs]';
const errorResult = (statusCode, error, code = '') => ({ statusCode, error, ...(code ? { code } : {}) });

// pi 1.4.0 ImageContent is { type: 'image', data: base64, mimeType }.
// Do not interpret URLs, paths, nested extension values or data URLs as images.
function inspectPiImage(block) {
  if (!block || block.type !== 'image' || typeof block.mimeType !== 'string'
      || !/^image\/(?:png|jpeg|gif|webp|avif)$/i.test(block.mimeType) || typeof block.data !== 'string') {
    return errorResult(422, 'Image preview payload is unsupported or malformed');
  }
  // Bound the original string too, so whitespace cannot evade the budget.
  if (block.data.length > IMAGE_PREVIEW_MAX_ENCODED_CHARS) return errorResult(413, 'Image preview is too large');
  const compact = block.data.replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0) {
    return errorResult(422, 'Image preview payload is unsupported or malformed');
  }
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  // A repeated-group base64 regexp can overflow V8's regexp stack on a valid
  // multi-megabyte payload. Scan once with constant auxiliary space instead.
  for (let index = 0; index < compact.length - padding; index++) {
    const code = compact.charCodeAt(index);
    if (!(code >= 65 && code <= 90) && !(code >= 97 && code <= 122)
        && !(code >= 48 && code <= 57) && code !== 43 && code !== 47) {
      return errorResult(422, 'Image preview payload is unsupported or malformed');
    }
  }
  const estimatedBytes = compact.length * 3 / 4 - padding;
  if (estimatedBytes > IMAGE_PREVIEW_MAX_DECODED_BYTES) return errorResult(413, 'Image preview is too large');
  return { mimeType: block.mimeType.toLowerCase(), estimatedBytes, compact };
}

// Cached display evidence has no reason to retain bare image bytes. Work from
// a shallow copy: original snapshot records remain exact Raw/readback evidence.
function sanitizePiImageRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  // Context edits own replacement.content in the pinned writer schema. Only
  // these known content owners are normalized; extension fields stay opaque.
  const owner = record.type === 'custom_message' ? record
    : record.type === 'message' && ['user', 'assistant', 'custom', 'toolResult'].includes(record.message?.role)
      ? record.message
      : record.type === 'context_edit' && record.replacement && typeof record.replacement === 'object'
        && !Array.isArray(record.replacement) ? record.replacement : null;
  if (!owner || !Array.isArray(owner.content)) return record;
  const content = owner.content.map((block) => block?.type === 'image' && Object.hasOwn(block, 'data')
    ? { ...block, data: SAVED_IMAGE_MARKER } : block);
  if (owner === record) return { ...record, content };
  const ownerKey = record.type === 'context_edit' ? 'replacement' : 'message';
  return { ...record, [ownerKey]: { ...owner, content } };
}

function rawRecord(snapshot, raw, session) {
  if (!raw || raw.sessionId !== session.id || raw.source?.file !== session.sourceFile
      || raw.source?.line !== raw.line || !Number.isSafeInteger(raw.line) || raw.line < 1) return null;
  let record;
  try { record = JSON.parse(snapshot.lines[raw.line - 1]); } catch { return null; }
  return record?.id === raw.entryId ? record : null;
}

function imageCandidates(session, event, snapshot) {
  if (!event || event.layer === 'raw'
      || session.logicalEvents.some((candidate) => candidate.subtype === 'pi_branch' && candidate.pi?.invalidTree)) return [];
  const raws = (event.rawRefs || []).map((ref) => session.rawEvents.find((raw) => raw.rawId === ref.rawId
    && raw.source?.file === ref.file && raw.line === ref.line)).filter(Boolean);
  const first = raws[0];
  const record = rawRecord(snapshot, first, session);
  if (!record) return [];
  let owner = null;
  let selectedRaw = first;
  let blockIndex = null;
  if (event.subtype === 'pi_custom_message') {
    owner = record.type === 'custom_message' ? record
      : record.type === 'message' && record.message?.role === 'custom' ? record.message : null;
  } else if (record.type === 'message' && ['user', 'assistant'].includes(record.message?.role)) {
    const indexedImage = /^pi_content_image_(\d+)$/.exec(event.subtype || '');
    blockIndex = Number.isSafeInteger(event.pi?.blockIndex) ? event.pi.blockIndex
      : indexedImage ? Number(indexedImage[1]) : null;
    if (['command', 'other_tool_call', 'patch'].includes(event.kind) && event.pi?.pairing === 'exact_id_ancestor') {
      const call = Array.isArray(record.message.content) ? record.message.content[blockIndex] : null;
      if (call?.type !== 'toolCall' || call.id !== event.pi.callId || call.name !== event.toolName) return [];
      selectedRaw = raws[1];
      const result = rawRecord(snapshot, selectedRaw, session);
      if (result?.type !== 'message' || result.message?.role !== 'toolResult' || selectedRaw.line <= first.line
          || result.message.toolCallId !== call.id || result.message.toolName !== call.name) return [];
      owner = result.message;
      blockIndex = null;
    } else if (blockIndex !== null && blockIndex >= 0) owner = record.message;
  }
  if (!Array.isArray(owner?.content)) return [];
  const candidates = [];
  for (let index = 0; index < owner.content.length; index++) {
    if (blockIndex !== null && blockIndex !== index) continue;
    const block = owner.content[index];
    if (block?.type === 'image') candidates.push({ block, blockIndex: index, previewId: `image-${selectedRaw.line}-${index}` });
  }
  return candidates;
}

function piImagePreviewSection(session, event, snapshot) {
  const candidates = imageCandidates(session, event, snapshot);
  if (!candidates.length) return null;
  const images = [];
  let unavailable = 0;
  let omitted = 0;
  for (const candidate of candidates) {
    if (images.length >= IMAGE_PREVIEW_LIMIT) { omitted++; continue; }
    const inspected = inspectPiImage(candidate.block);
    if (inspected.error) { unavailable++; continue; }
    images.push({ previewId: candidate.previewId,
      src: `/api/sessions/${encodeURIComponent(session.id)}/events/${encodeURIComponent(event.id)}/image-previews/${encodeURIComponent(candidate.previewId)}`,
      mimeType: inspected.mimeType, estimatedBytes: inspected.estimatedBytes,
      detail: `Saved content block ${candidate.blockIndex + 1}`, alt: `Saved image ${candidate.blockIndex + 1}` });
  }
  const notices = [];
  if (unavailable) notices.push(`${unavailable} saved image block${unavailable === 1 ? ' is' : 's are'} unsupported, malformed or too large to preview.`);
  if (omitted) notices.push(`${omitted} additional saved image blocks remain available through raw refs.`);
  return { type: 'image_preview', purpose: 'content', title: 'Saved images', images, notice: notices.join(' ') };
}

async function readPiImagePreview(index, session, eventId, previewId, options = {}) {
  const event = session?.logicalEvents?.find((candidate) => candidate.id === eventId);
  if (!event) return errorResult(404, 'Unknown event');
  // This is the same admitted-root, accepted-prefix/digest and inode validation
  // used by Detail and physical Raw. Never read a path from an image block.
  let snapshot;
  try { snapshot = await require('./pi').snapshotForSession(index, session, options.signal); }
  catch (error) {
    if (error.code === 'INDEXED_SOURCE_STALE') return errorResult(409, 'Image preview source is stale', error.code);
    throw error;
  }
  abort(options.signal);
  const candidate = imageCandidates(session, event, snapshot).find((item) => item.previewId === previewId);
  if (!candidate) return errorResult(404, 'Unknown image preview');
  const inspected = inspectPiImage(candidate.block);
  if (inspected.error) return inspected;
  const bytes = Buffer.from(inspected.compact, 'base64');
  abort(options.signal);
  if (bytes.length > IMAGE_PREVIEW_MAX_DECODED_BYTES) return errorResult(413, 'Image preview is too large');
  return { bytes, mimeType: inspected.mimeType };
}

module.exports = { piImagePreviewSection, readPiImagePreview, sanitizePiImageRecord,
  IMAGE_PREVIEW_LIMIT, IMAGE_PREVIEW_MAX_ENCODED_CHARS, IMAGE_PREVIEW_MAX_DECODED_BYTES, SAVED_IMAGE_MARKER };
