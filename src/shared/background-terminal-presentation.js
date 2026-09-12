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

module.exports = { backgroundTerminalLabel };
