'use strict';

const i18n = require('./i18n');

function backgroundTerminalLabel(fact, locale) {
  const label = fact?.action === 'poll' ? 'Background terminal poll request'
    : fact?.action === 'input' ? 'Background terminal input request' : '';
  if (!label) return '';
  const suffix = fact.originEventId && typeof fact.commandPreview === 'string' && fact.commandPreview
    ? ` · ${Array.from(fact.commandPreview).slice(0, 48).join('')}${Array.from(fact.commandPreview).length > 48 ? '…' : ''}` : '';
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

function terminalOutcomeSummary(event, sections, locale, { request = false, receipt = null } = {}) {
  const isRequest = request || event?.toolName === 'write_stdin';
  if (!isRequest && event?.kind !== 'command') return '';
  if (event.status === 'declined') return '';
  const entries = sections.flatMap((section) => section.type === 'kv' ? section.entries || [] : []);
  const recordedExit = entries.find((entry) => entry.key === 'Exit code')?.value;
  const exit = receipt?.exitCode ?? event.outputStats?.exitCode ?? recordedExit;
  const completed = ['completed', 'success', 'failed'].includes(event.status);
  if (exit != null && /^-?\d+$/.test(String(exit))) {
    return i18n.t(locale, 'ui', isRequest ? 'terminalRequestExit' : 'terminalCommandExit', { code: exit });
  }
  if (receipt?.processId != null || entries.some((entry) => entry.key === 'Process running with session ID') || event.status === 'in_progress') {
    return i18n.t(locale, 'ui', 'terminalRecordedRunning');
  }
  return i18n.t(locale, 'ui', completed ? 'terminalExitUnrecorded' : 'terminalCompletionMissing');
}

module.exports = { backgroundTerminalLabel, compactBackgroundTerminalSections, terminalOutcomeSummary };
