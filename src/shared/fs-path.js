'use strict';

const path = require('node:path');

function fsPathFlavor(input) {
  const text = String(input || '');
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(text)) return 'win32';
  if (text.startsWith('/')) return 'posix';
  return process.platform === 'win32' ? 'win32' : 'posix';
}

function fsPathApi(input) {
  return fsPathFlavor(input) === 'win32' ? path.win32 : path.posix;
}

function resolveFsPath(input) {
  const text = String(input || '');
  if (!text) return '';
  return fsPathApi(text).resolve(text);
}

function normalizeFsPath(input) {
  if (!input) return '';
  const resolved = resolveFsPath(input);
  return fsPathFlavor(input) === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideOrSame(child, parent) {
  if (!child || !parent || fsPathFlavor(child) !== fsPathFlavor(parent)) return false;
  const childPath = normalizeFsPath(child);
  const parentPath = normalizeFsPath(parent);
  const separator = fsPathApi(parent).sep;
  const boundary = parentPath.endsWith(separator) ? parentPath : `${parentPath}${separator}`;
  return childPath === parentPath || childPath.startsWith(boundary);
}

module.exports = {
  fsPathApi,
  fsPathFlavor,
  isPathInsideOrSame,
  normalizeFsPath,
  resolveFsPath,
};
