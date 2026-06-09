(function initSessionCommandHighlighting(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionCommandHighlighting = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const SHELL_EXTERNAL_COMMAND_WORDS = Object.freeze([
    'adb',
    'bun',
    'cargo',
    'docker',
    'gh',
    'git',
    'go',
    'kubectl',
    'node',
    'npm',
    'npx',
    'pip',
    'pip3',
    'pnpm',
    'pytest',
    'python',
    'python3',
    'rg',
    'uv',
    'yarn',
  ]);

  return {
    SHELL_EXTERNAL_COMMAND_WORDS,
    POWERSHELL_EXTERNAL_COMMAND_WORDS: SHELL_EXTERNAL_COMMAND_WORDS,
  };
}));
