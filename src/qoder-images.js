'use strict';

// Only native inline base64 is previewable. Recorded paths and URLs are never fetched.
const error = (statusCode, message, code) => ({ statusCode, error: message, ...(code ? { code } : {}) });
const LIMIT = 12 * 1024 * 1024;
function inspect(block) {
  const source = block?.type === 'image' && block.source;
  if (source?.type !== 'base64' || typeof source.media_type !== 'string'
      || !/^image\/(png|jpeg|gif|webp|avif)$/i.test(source.media_type) || typeof source.data !== 'string') {
    return error(422, 'Unsupported saved Qoder image');
  }
  if (source.data.length > 16 * 1024 * 1024) return error(413, 'Saved image is too large');
  const data = source.data.replace(/\s/g, '');
  if (!data || data.length % 4) return error(422, 'Malformed saved Qoder image');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  // Avoid repeated-group regex stack growth on multi-megabyte images.
  for (let n = 0; n < data.length - padding; n++) {
    const c = data.charCodeAt(n);
    if (!(c >= 65 && c <= 90) && !(c >= 97 && c <= 122) && !(c >= 48 && c <= 57) && c !== 43 && c !== 47) return error(422, 'Malformed saved Qoder image');
  }
  const estimatedBytes = data.length * 3 / 4 - padding;
  if (estimatedBytes > LIMIT) return error(413, 'Saved image is too large');
  return { data, estimatedBytes, mimeType: source.media_type.toLowerCase() };
}
function candidates(session, event, snapshot) {
  const facts = event?.qoder;
  if (!facts) return [];
  const refs = event.rawRefs || [];
  const result = [];
  for (const [refIndex, ref] of refs.entries()) {
    const raw = session.rawEvents.find((item) => item.rawId === ref.rawId);
    if (!raw || raw.source.file !== session.sourceFile || raw.line !== ref.line) continue;
    let row; try { row = JSON.parse(snapshot.lines[raw.line - 1]); } catch { continue; }
    const blocks = row?.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const [blockIndex, block] of blocks.entries()) {
      if (refIndex === 0 && block?.type === 'image' && (facts.blockIndex === undefined || facts.blockIndex === blockIndex)) {
        result.push({ block, previewId: `image-${raw.line}-${blockIndex}` });
      } else if (refIndex === 1 && block?.type === 'tool_result' && block.tool_use_id === facts.callId
          && facts.resultBlockIndex === blockIndex && Array.isArray(block.content)) {
        for (const [index, image] of block.content.entries()) if (image?.type === 'image') {
          result.push({ block: image, previewId: `image-${raw.line}-${blockIndex}-${index}` });
        }
      }
    }
    // Some MCP results persist inline image blocks in toolUseResult while the
    // message carries remote URLs. Preview these as their own recorded bytes;
    // never assume they are identical to the remote representation.
    if (refIndex === 1 && blocks.filter((block) => block?.type === 'tool_result').length === 1
        && blocks[facts.resultBlockIndex]?.tool_use_id === facts.callId && Array.isArray(row.toolUseResult)) {
      for (const [index, block] of row.toolUseResult.entries()) if (block?.type === 'image') {
        result.push({ block, previewId: `image-${raw.line}-metadata-${index}` });
      }
    }
  }
  return result;
}
function qoderImageSection(session, event, snapshot) {
  const all = candidates(session, event, snapshot);
  if (!all.length) return null;
  const images = []; let unavailable = 0;
  for (const candidate of all.slice(0, 8)) {
    const info = inspect(candidate.block);
    if (info.error) { unavailable++; continue; }
    images.push({ previewId: candidate.previewId,
      src: `/api/sessions/${encodeURIComponent(session.id)}/events/${encodeURIComponent(event.id)}/image-previews/${candidate.previewId}`,
      mimeType: info.mimeType, estimatedBytes: info.estimatedBytes, alt: 'Saved Qoder image', detail: 'Native inline image' });
  }
  return { type: 'image_preview', purpose: 'content', title: 'Saved images', images,
    notice: unavailable || all.length > 8 ? 'Some images are unsupported or exceed preview limits; see Raw references.' : '' };
}
async function readQoderImagePreview(index, session, eventId, previewId, options = {}) {
  const event = session.logicalEvents.find((item) => item.id === eventId);
  if (!event) return error(404, 'Unknown event');
  let snapshot;
  try { snapshot = await require('./qoder').snapshotForSession(index, session, options.signal); }
  catch (cause) {
    if (cause.code === 'INDEXED_SOURCE_STALE') return error(409, 'Image source changed; reindex the project.', cause.code);
    throw cause;
  }
  const candidate = candidates(session, event, snapshot).find((item) => item.previewId === previewId);
  if (!candidate) return error(404, 'Unknown image preview');
  const info = inspect(candidate.block);
  if (info.error) return info;
  options.signal?.throwIfAborted();
  return { bytes: Buffer.from(info.data, 'base64'), mimeType: info.mimeType };
}
module.exports = { qoderImageSection, readQoderImagePreview };
