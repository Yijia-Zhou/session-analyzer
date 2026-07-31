'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { __testOnly, buildIndex } = require('../src/codex');

const {
  formatResetTime,
  isEcmaScriptWhitespace,
  resetTimeCacheLimit,
  resetTimeCacheSize,
  sessionReviewMarkers,
  truncate,
} = __testOnly;

function legacyFormatResetTime(value, now) {
  if (value == null || value === '') return '';
  const source = typeof value === 'number' ? (value < 10000000000 ? value * 1000 : value) : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return String(value);
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return date.toLocaleString('en-US', {
    month: sameDay ? undefined : 'short',
    day: sameDay ? undefined : 'numeric',
    year: sameDay ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function legacyTruncate(value, limit = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return (max) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
}

async function makeTempCodexHome(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-indexing-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

test('reset time formatter matches legacy locale output and isolates same-day/full cache modes', () => {
  const timestamp = new Date(2037, 5, 15, 13, 5, 0, 0);
  const sameDayNow = new Date(2037, 5, 15, 20, 0, 0, 0);
  const fullNow = new Date(2037, 5, 16, 8, 0, 0, 0);

  const fullExpected = legacyFormatResetTime(timestamp.getTime(), fullNow);
  const sameDayExpected = legacyFormatResetTime(timestamp.getTime(), sameDayNow);
  assert.equal(formatResetTime(timestamp.getTime(), fullNow), fullExpected);
  assert.equal(formatResetTime(timestamp.getTime(), sameDayNow), sameDayExpected);
  assert.notEqual(fullExpected, sameDayExpected);

  const seconds = timestamp.getTime() / 1000;
  assert.equal(formatResetTime(seconds, sameDayNow), legacyFormatResetTime(seconds, sameDayNow));
  assert.equal(formatResetTime('not-a-date', sameDayNow), 'not-a-date');
  assert.equal(formatResetTime('', sameDayNow), '');

  const cacheBase = new Date(2041, 0, 1, 0, 0, 0, 0).getTime();
  for (let index = 0; index < resetTimeCacheLimit + 32; index += 1) {
    formatResetTime(cacheBase + index * 60_000, fullNow);
  }
  assert.equal(resetTimeCacheSize(), resetTimeCacheLimit);
});

test('truncate preserves legacy output at native/bounded boundaries and trailing whitespace edges', () => {
  const cases = [
    'a'.repeat(1000),
    'a'.repeat(1001),
    `${' '.repeat(1001)}abc`,
    `${'a'.repeat(240)}${' '.repeat(1001)}`,
    `${'a'.repeat(240)}${' '.repeat(1001)}b`,
    `${'a'.repeat(237)} ${'b'.repeat(1000)}`,
    `${'a'.repeat(239)}\n\t${'b'.repeat(1000)}`,
  ];
  const limits = [0, 1, 2, 3, 4, 120, 239, 240, 241, 4000, -1, 4.5, '12', Infinity];

  for (const source of cases) {
    for (const limit of limits) {
      assert.equal(truncate(source, limit), legacyTruncate(source, limit), `length=${source.length}, limit=${limit}`);
    }
  }
});

test('truncate bounded path uses the ECMAScript whitespace set by code unit', () => {
  const whitespaceCodeUnits = [
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
    0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
  ];
  for (const codeUnit of whitespaceCodeUnits) {
    const whitespace = String.fromCharCode(codeUnit);
    const source = `left${whitespace.repeat(1001)}right`;
    assert.equal(truncate(source, 240), 'left right', `U+${codeUnit.toString(16).padStart(4, '0')}`);
  }

  for (const codeUnit of [0x0085, 0x180e, 0x200b]) {
    const source = `left${String.fromCharCode(codeUnit).repeat(1001)}right`;
    assert.equal(truncate(source, 240), legacyTruncate(source, 240), `non-whitespace U+${codeUnit.toString(16).padStart(4, '0')}`);
  }

  for (let codeUnit = 0; codeUnit <= 0xffff; codeUnit += 1) {
    assert.equal(
      isEcmaScriptWhitespace(codeUnit),
      /\s/.test(String.fromCharCode(codeUnit)),
      `classifier mismatch at U+${codeUnit.toString(16).padStart(4, '0')}`,
    );
  }
});

test('truncate bounded path is randomly equivalent to the legacy implementation', () => {
  const random = makeRandom(0x5eedc0de);
  const codeUnits = [
    0x0061, 0x0062, 0x005a, 0x0030, 0x002e, 0x002f,
    0x0009, 0x000a, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2003, 0x2028,
    0x202f, 0x3000, 0xfeff, 0x0085, 0x180e, 0x200b, 0xd83d, 0xde00,
  ];

  for (let iteration = 0; iteration < 5000; iteration += 1) {
    const targetLength = 1001 + random(2000);
    const chunks = [];
    for (let index = 0; index < targetLength; index += 1) {
      chunks.push(String.fromCharCode(codeUnits[random(codeUnits.length)]));
    }
    const source = chunks.join('');
    const limit = random(600);
    assert.equal(truncate(source, limit), legacyTruncate(source, limit), `iteration=${iteration}, limit=${limit}`);
  }
});

test('raw timestamps drive session time range and review marker timestamps', async (t) => {
  const codexHome = await makeTempCodexHome(t);
  const repoRoot = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '07', '13');
  const id = '13131313-1313-1313-1313-131313131313';
  const file = path.join(sessionDir, `rollout-2026-07-13T10-00-00-${id}.jsonl`);
  const records = [
    { timestamp: '2026-07-13T10:00:00.000Z', type: 'session_meta', payload: { id, cwd: repoRoot } },
    { timestamp: '2026-07-13T09:00:00.000Z', type: 'event_msg', payload: { type: 'entered_review_mode' } },
    { timestamp: 'not-a-timestamp', type: 'event_msg', payload: { type: 'warning', message: 'invalid timestamp fixture' } },
    { timestamp: '2026-07-13T11:00:00.000Z', type: 'event_msg', payload: { type: 'exited_review_mode' } },
  ];
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  assert.equal(session.startedAt, '2026-07-13T09:00:00.000Z');
  assert.equal(session.updatedAt, '2026-07-13T11:00:00.000Z');
  assert.equal(session.rawEvents[2].timestamp, '');
  assert.deepEqual(sessionReviewMarkers(session), [{
    enteredAt: '2026-07-13T09:00:00.000Z',
    exitedAt: '2026-07-13T11:00:00.000Z',
  }]);
});

test('empty review marker arrays are valid caches and avoid raw event rescans', () => {
  const cachedMarkers = [];
  const session = { _reviewMarkers: cachedMarkers };
  Object.defineProperty(session, 'rawEvents', {
    get() {
      throw new Error('rawEvents should not be read for a valid marker cache');
    },
  });

  assert.equal(sessionReviewMarkers(session), cachedMarkers);
  assert.deepEqual(sessionReviewMarkers({
    rawEvents: [
      { recordType: 'event_msg', payloadType: 'entered_review_mode', timestamp: '2026-07-13T09:00:00.000Z' },
      { recordType: 'event_msg', payloadType: 'exited_review_mode', timestamp: '2026-07-13T11:00:00.000Z' },
    ],
  }), [{
    enteredAt: '2026-07-13T09:00:00.000Z',
    exitedAt: '2026-07-13T11:00:00.000Z',
  }]);
});
