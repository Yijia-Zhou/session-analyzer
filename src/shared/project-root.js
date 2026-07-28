'use strict';

function isWindowsProjectRoot(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value);
}

function normalizeWindowsProjectRoot(value) {
  let normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[A-Za-z]:$/.test(normalized)) normalized += '/';
  return normalized.toLowerCase();
}

function normalizePosixProjectRoot(value) {
  const normalized = value.replace(/\/+$/, '');
  return normalized || (value.startsWith('/') ? '/' : '');
}

function sameProjectRoot(left, right) {
  const leftRoot = String(left || '');
  const rightRoot = String(right || '');
  if (!leftRoot || !rightRoot) return false;
  const leftIsWindows = isWindowsProjectRoot(leftRoot);
  const rightIsWindows = isWindowsProjectRoot(rightRoot);
  if (leftIsWindows !== rightIsWindows) return false;
  if (leftIsWindows) {
    return normalizeWindowsProjectRoot(leftRoot) === normalizeWindowsProjectRoot(rightRoot);
  }
  return normalizePosixProjectRoot(leftRoot) === normalizePosixProjectRoot(rightRoot);
}

module.exports = {
  sameProjectRoot,
};
