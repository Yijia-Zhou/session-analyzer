'use strict';

// A database primary key is not a file line. Keep its label tied to the
// captured locator, including when the backing snapshot has a temporary path.
function sourceReferenceLabel(ref) {
  if (!ref || typeof ref !== 'object') return '';
  const source = ref.source || ref;
  const locator = ref.sourceLocator || source.sourceLocator;
  if (locator?.type === 'sqlite_row') {
    const id = locator.messageID || locator.sessionID;
    if (typeof locator.table === 'string' && typeof id === 'string' && id) {
      return locator.table + ':' + id + (locator.pointer ? ' ' + locator.pointer : '');
    }
  }
  const file = source.file || locator?.file || '';
  const line = source.line ?? locator?.line;
  if (file && line != null) return file + ':' + line;
  return String(file || ref.rawId || '');
}

module.exports = { sourceReferenceLabel };
