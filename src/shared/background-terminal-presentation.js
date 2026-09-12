'use strict';

const i18n = require('./i18n');

function backgroundTerminalLabel(fact, locale) {
  const label = fact?.action === 'poll' ? 'Background terminal poll request'
    : fact?.action === 'input' ? 'Background terminal input request' : '';
  if (!label) return '';
  const suffix = fact.originEventId && typeof fact.commandPreview === 'string' && fact.commandPreview
    ? ` · ${fact.commandPreview}` : '';
  return i18n.sectionTitle(label, locale) + suffix;
}

// Compose display copies only; request/result evidence keeps its original ownership.
function compactBackgroundTerminalSections(sections) {
  const request = sections.find((section) => section.type === 'kv' && section.title === 'Request');
  const result = sections.find((section) => section.type === 'kv' && section.title === 'Run result');
  if (!request || !result) return sections;
  const processId = request.entries.find((entry) => entry.key === 'Process ID')?.value;
  const entries = result.entries.flatMap((entry) => {
    if (!['Process ID', 'Process running with session ID'].includes(entry.key)) return [entry];
    return entry.value === processId ? [] : [{ ...entry, key: 'Response Process ID' }];
  });
  return sections.filter((section) => section !== result).map((section) => section === request
    ? { ...request, purpose: 'content', entries: [...request.entries, ...entries] }
    : section);
}

module.exports = { backgroundTerminalLabel, compactBackgroundTerminalSections };
