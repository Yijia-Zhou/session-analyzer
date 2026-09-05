'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const {
  acquireCodexSourceStat,
  normalizeCodexSourceBigIntStat,
  sameCodexSourceIdentity,
  sourceSizeCoversAcceptedBytes,
  sourceSizeEqualsAcceptedBytes,
  sourceSizeToSafeNumber,
} = require('../src/shared/codex-source-stat');

const NS_PER_SECOND = 1_000_000_000n;
const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

function statFixture(overrides = {}) {
  return {
    dev: 1n,
    ino: 2n,
    size: 0n,
    mtimeNs: 0n,
    ...overrides,
  };
}

function syntheticHistoricalInode(actualInode) {
  const preferred = '129478489286935540';
  const fallback = String(Number(129478489286935568n));
  const selected = preferred === actualInode ? fallback : preferred;
  assert.notEqual(selected, actualInode);
  return selected;
}

async function makeSingleSessionFixture(t, label) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), `session-analyzer-${label}-`));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionRoot = path.join(codexHome, 'sessions', '2026', '09', '05');
  const id = 'abababab-abab-4bab-8bab-abababababab';
  const file = path.join(sessionRoot, `rollout-2026-09-05T10-00-00-${id}.jsonl`);
  const records = [
    {
      timestamp: '2026-09-05T10:00:00.000Z',
      type: 'session_meta',
      payload: { id, cwd: repoRoot },
    },
    {
      timestamp: '2026-09-05T10:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'exact identity fixture' },
    },
  ];
  const originalText = `${records.map(JSON.stringify).join('\n')}\n`;
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionRoot, { recursive: true });
  await fsp.writeFile(file, originalText, 'utf8');
  return { codexHome, file, id, originalText, repoRoot };
}

function cloneCompactWithIdentity(index, id, identity) {
  const previous = structuredClone(index);
  const session = previous.sessionsById.get(id);
  session._sourceIdentity = identity;
  assert.equal(previous.sessions[previous.sessions.length - 1] === session || previous.sessions[0] === session, true);
  return previous;
}

test('exact Codex identity preserves BigInt inode values that alias as Number', () => {
  const first = 129478489286935535n;
  const second = 129478489286935536n;
  assert.equal(Number(first), Number(second));
  const left = normalizeCodexSourceBigIntStat(statFixture({ ino: first }));
  const right = normalizeCodexSourceBigIntStat(statFixture({ ino: second }));
  assert.equal(left.fileIdentity.inode, '129478489286935535');
  assert.equal(right.fileIdentity.inode, '129478489286935536');
  assert.equal(sameCodexSourceIdentity(left.fileIdentity, right.fileIdentity), false);
});

test('exact Codex identity compares only device and inode', () => {
  const base = normalizeCodexSourceBigIntStat(statFixture({ size: 1n, mtimeNs: 2_000_000n }));
  const samePair = { device: base.fileIdentity.device, inode: base.fileIdentity.inode };
  assert.equal(sameCodexSourceIdentity(base.fileIdentity, samePair), true);
  assert.equal(sameCodexSourceIdentity(base.fileIdentity, { device: '2', inode: base.fileIdentity.inode }), false);
  assert.equal(sameCodexSourceIdentity(base.fileIdentity, { device: base.fileIdentity.device, inode: '3' }), false);
  assert.equal(sameCodexSourceIdentity(
    { ...base.fileIdentity, ignored: 'left' },
    { ...samePair, ignored: 'right' },
  ), true);
});

test('Codex BigInt stat normalization rejects non-BigInt required fields', () => {
  for (const field of ['dev', 'ino', 'size', 'mtimeNs']) {
    const missing = statFixture();
    delete missing[field];
    assert.throws(() => normalizeCodexSourceBigIntStat(missing), TypeError, field);
    const numberValue = statFixture({ [field]: 1 });
    assert.throws(() => normalizeCodexSourceBigIntStat(numberValue), TypeError, field);
  }
});

test('Codex source stat snapshot contains only the closed ephemeral fields', () => {
  const snapshot = normalizeCodexSourceBigIntStat({
    ...statFixture({ dev: 11n, ino: 12n, size: 13n, mtimeNs: 14n }),
    mtime: new Date('1999-01-01T00:00:00.000Z'),
    mtimeMs: 123,
    mtimeNsExtra: 456n,
  });
  assert.deepEqual(Object.keys(snapshot).sort(), ['fileIdentity', 'mtime', 'mtimeMs', 'sizeBigInt'].sort());
  assert.deepEqual(snapshot.fileIdentity, { device: '11', inode: '12' });
  assert.equal(snapshot.sizeBigInt, 13n);
  assert.equal(typeof snapshot.mtimeMs, 'number');
  assert.equal(snapshot.mtime instanceof Date, true);
  assert.deepEqual(Object.keys(snapshot.fileIdentity).sort(), ['device', 'inode']);
});

test('Codex source stat acquisition matches direct BigInt filesystem identity', async (t) => {
  const file = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-source-stat-')), 'source.txt');
  t.after(() => fsp.rm(path.dirname(file), { recursive: true, force: true }));
  await fsp.writeFile(file, 'source stat', 'utf8');
  const snapshot = await acquireCodexSourceStat(file);
  const direct = await fsp.stat(file, { bigint: true });
  assert.deepEqual(snapshot.fileIdentity, {
    device: direct.dev.toString(),
    inode: direct.ino.toString(),
  });
  assert.equal(snapshot.sizeBigInt, direct.size);
});

test('Codex mtime normalization preserves current Number Stats semantics', () => {
  const cases = [
    ['zero', 0, 0],
    ['positive fractional millisecond', 1_700_000_000, 123_456_789],
    ['below half millisecond', 1, 499_999],
    ['above half millisecond', 1, 500_001],
    ['before second boundary', 1, 999_999_999],
    ['exact second boundary', 2, 0],
    ['negative fractional timestamp', -1, 999_750_000],
    ['before negative second boundary', -2, 999_999_999],
    ['exact negative second boundary', -1, 0],
    ['after negative second boundary', -1, 1],
    ['large Date-valid timestamp', 8_000_000_000_000, 123_456_789],
  ];
  for (const [label, sec, nsec] of cases) {
    const mtimeNs = BigInt(sec) * NS_PER_SECOND + BigInt(nsec);
    const snapshot = normalizeCodexSourceBigIntStat(statFixture({ mtimeNs }));
    const expectedMs = sec * 1000 + nsec / 1_000_000;
    const expectedDate = new Date(Math.round(expectedMs));
    assert.equal(snapshot.mtimeMs, expectedMs, label);
    assert.equal(snapshot.mtime.getTime(), expectedDate.getTime(), label);
    assert.equal(snapshot.mtime.toISOString(), expectedDate.toISOString(), label);
  }
});

test('Codex source size conversion fails closed outside the safe byte domain', () => {
  assert.equal(sourceSizeToSafeNumber(0n), 0);
  assert.equal(sourceSizeToSafeNumber(1n), 1);
  assert.equal(sourceSizeToSafeNumber(MAX_SAFE_BYTES), Number.MAX_SAFE_INTEGER);
  assert.equal(sourceSizeToSafeNumber(MAX_SAFE_BYTES + 1n), null);
  assert.equal(sourceSizeToSafeNumber(-1n), null);
  assert.throws(() => sourceSizeToSafeNumber(1), TypeError);
});

test('Codex accepted prefix coverage preserves oversized physical files', () => {
  const acceptedBytes = Number.MAX_SAFE_INTEGER;
  const physicalSize = MAX_SAFE_BYTES + 1n;
  assert.equal(sourceSizeCoversAcceptedBytes(physicalSize, acceptedBytes), true);
  assert.equal(sourceSizeEqualsAcceptedBytes(physicalSize, acceptedBytes), false);
  assert.equal(sourceSizeToSafeNumber(physicalSize), null);
});

test('Codex source size predicates reject invalid accepted byte lengths', () => {
  for (const acceptedBytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(sourceSizeCoversAcceptedBytes(1n, acceptedBytes), false);
    assert.equal(sourceSizeEqualsAcceptedBytes(1n, acceptedBytes), false);
  }
  assert.throws(() => sourceSizeCoversAcceptedBytes(1, 1), TypeError);
  assert.throws(() => sourceSizeEqualsAcceptedBytes(1, 1), TypeError);
});

test('Codex compact reuse rejects historical lossy source identity without failing the build', async (t) => {
  const fixture = await makeSingleSessionFixture(t, 'compact-historical-identity');
  const first = await codex.buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const direct = await fsp.stat(fixture.file, { bigint: true });
  const expectedIdentity = { device: direct.dev.toString(), inode: direct.ino.toString() };
  const historicalInode = syntheticHistoricalInode(expectedIdentity.inode);
  const oldSession = first.sessionsById.get(fixture.id);
  const oldSessionJson = JSON.stringify(oldSession);
  const migrated = cloneCompactWithIdentity(first, fixture.id, {
    device: expectedIdentity.device,
    inode: historicalInode,
  });
  const migratedSession = migrated.sessionsById.get(fixture.id);
  const migratedSessionBefore = JSON.stringify(migratedSession);
  const rebuilt = await codex.buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: migrated,
  });
  const rebuiltSession = rebuilt.sessionsById.get(fixture.id);
  assert.equal(rebuilt.totals.reusedFileCount, 0);
  assert.deepEqual(rebuiltSession._sourceIdentity, expectedIdentity);
  assert.equal(rebuiltSession.bytes, oldSession.bytes);
  assert.equal(rebuiltSession.sourceFingerprint, oldSession.sourceFingerprint);
  assert.equal(JSON.stringify(oldSession), oldSessionJson);
  assert.equal(JSON.stringify(migratedSession), migratedSessionBefore);

  const unchanged = await codex.buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: rebuilt,
  });
  assert.equal(unchanged.totals.reusedFileCount, 1);
  assert.deepEqual(unchanged.sessionsById.get(fixture.id)._sourceIdentity, expectedIdentity);
});

test('Codex compact reuse rejects missing or malformed retained identity', async (t) => {
  const fixture = await makeSingleSessionFixture(t, 'compact-malformed-identity');
  const first = await codex.buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const malformed = [
    (identity) => { delete identity.inode; },
    (identity) => { identity.inode = 42; },
    (identity) => { identity.extra = 'not allowed'; },
  ];
  for (const [index, mutate] of malformed.entries()) {
    const previous = structuredClone(first);
    const session = previous.sessionsById.get(fixture.id);
    mutate(session._sourceIdentity);
    const rebuilt = await codex.buildIndex({
      repoRoot: fixture.repoRoot,
      codexHome: fixture.codexHome,
      previousIndex: previous,
    });
    assert.equal(rebuilt.totals.reusedFileCount, 0, `malformed identity ${index}`);
  }
});

test('Codex compact reuse rejects same-content physical replacement', async (t) => {
  const fixture = await makeSingleSessionFixture(t, 'compact-physical-replacement');
  const fixedTime = new Date('2026-09-05T10:00:00.000Z');
  await fsp.utimes(fixture.file, fixedTime, fixedTime);
  const first = await codex.buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const firstSession = first.sessionsById.get(fixture.id);
  const replacement = `${fixture.file}.replacement`;
  const displaced = `${fixture.file}.displaced`;
  await fsp.writeFile(replacement, fixture.originalText, 'utf8');
  await fsp.utimes(replacement, fixedTime, fixedTime);
  const originalRaw = await fsp.stat(fixture.file, { bigint: true });
  const replacementRaw = await fsp.stat(replacement, { bigint: true });
  assert.equal(
    originalRaw.dev !== replacementRaw.dev || originalRaw.ino !== replacementRaw.ino,
    true,
  );
  await fsp.rename(fixture.file, displaced);
  await fsp.rename(replacement, fixture.file);
  const currentRaw = await fsp.stat(fixture.file, { bigint: true });
  const currentStat = await fsp.stat(fixture.file);
  const displacedRaw = await fsp.stat(displaced, { bigint: true });
  assert.equal(currentRaw.dev, replacementRaw.dev);
  assert.equal(currentRaw.ino, replacementRaw.ino);
  assert.equal(displacedRaw.dev, originalRaw.dev);
  assert.equal(displacedRaw.ino, originalRaw.ino);
  assert.equal(currentStat.size, firstSession.bytes);
  assert.equal(currentStat.mtime.toISOString(), firstSession.sourceUpdatedAt);
  const rebuilt = await codex.buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: first,
  });
  const rebuiltSession = rebuilt.sessionsById.get(fixture.id);
  assert.equal(rebuilt.totals.reusedFileCount, 0);
  assert.deepEqual(rebuiltSession._sourceIdentity, {
    device: replacementRaw.dev.toString(),
    inode: replacementRaw.ino.toString(),
  });
  assert.equal(rebuiltSession.bytes, firstSession.bytes);
  assert.equal(rebuiltSession.sourceUpdatedAt, firstSession.sourceUpdatedAt);
  assert.equal(rebuiltSession.sourceFingerprint, firstSession.sourceFingerprint);
});
