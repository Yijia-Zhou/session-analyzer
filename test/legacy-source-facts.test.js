'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSourceBackedIndex } = require('../src/codex');
const { getSourceAdapter, validateIndexOwnership, validateIndexOwnershipForCommit } = require('../src/source-adapters');

const options = { repoRoot: 'G:\\vibe\\term-agent', codexHome: path.join(__dirname, 'fixtures', 'codex-home') };

test('legacy per-file fact hook preserves single-file validation and rejects malformed or mutating facts', async () => {
  const index = await buildSourceBackedIndex(options);
  const base = getSourceAdapter('codex');
  const ordinary = { ...base, legacyRawSessionFacts: undefined };
  validateIndexOwnership(index, { adapter: ordinary });
  const valid = { ...base, legacyRawSessionFacts: (session) => ({ sourceFileBounds: [[session.sourceFile, session.bytes]] }) };
  validateIndexOwnership(index, { adapter: valid });
  await validateIndexOwnershipForCommit(index, { adapter: valid });
  for (const hook of [
    () => ({ unknown: [] }),
    () => ({ sourceFileBounds: [] }),
    () => ({ sourceFileBounds: Array.from({ length: 4097 }, () => ['x', 1]) }),
    () => ({ sourceFileBounds: [['x', -1]] }),
    () => ({ sourceFileBounds: [['x'.repeat(65537), 1]] }),
    () => ({ sourceFileBounds: [['x', 1], ['x', 1]] }),
  ]) {
    const adapter = { ...base, legacyRawSessionFacts: hook };
    assert.throws(() => validateIndexOwnership(index, { adapter }), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
    await assert.rejects(validateIndexOwnershipForCommit(index, { adapter }), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  }
  const first = index.sessionsById.values().next().value;
  const originalTitle = first.title;
  try {
    assert.throws(() => validateIndexOwnership(index, { adapter: { ...base, legacyRawSessionFacts(session) {
      session.title += 'mutated'; return {};
    } } }), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  } finally { first.title = originalTitle; }
});
