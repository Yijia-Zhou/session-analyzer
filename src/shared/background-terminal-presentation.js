'use strict';

const i18n = require('./i18n');

function backgroundTerminalLabel(fact, locale) {
  const label = fact?.action === 'poll' ? 'Background terminal poll request'
    : fact?.action === 'input' ? 'Background terminal input request' : '';
  return label ? i18n.sectionTitle(label, locale) : '';
}

module.exports = { backgroundTerminalLabel };
