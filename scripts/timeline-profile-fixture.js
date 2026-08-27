'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_EVENT_COUNT = 1800;
const DEFAULT_SEARCHABLE_TEXT_BYTES = 3700;
const DEFAULT_HIT_POSITIONS = [1650];
const DEFAULT_CONTEXT_REVEAL_INDEX = 24;
const CONTEXT_REVEAL_TOOL_NAME = 'context-profile-token';

function normalizePositions(values, eventCount) {
  return new Set((Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < eventCount));
}

function stableCanonicalValue(value) {
  if (Array.isArray(value)) return value.map(stableCanonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      stableCanonicalValue(value[key]),
    ]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Semantic fixture proof cannot serialize a non-finite number');
  }
  return value;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathLiteralPattern(value) {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? '[\\\\/]' : '';
  const body = normalized.split('/').filter(Boolean).map(escapeRegex).join('[\\\\/]');
  return new RegExp(`${prefix}${body}`, process.platform === 'win32' ? 'gi' : 'g');
}

function replaceEvery(value, needle, replacement) {
  return needle ? value.split(needle).join(replacement) : value;
}

function assertNoFixtureIdentityLiterals(value, { repoRoot, sessionIds }) {
  const text = String(value);
  if (pathLiteralPattern(repoRoot).test(text)
      || sessionIds.some((sessionId) => sessionId && text.includes(sessionId))) {
    throw new Error('Semantic fixture proof retained a generated absolute path or literal Session ID');
  }
}

function semanticFixtureValue(value, replacements, forbiddenLiterals, fieldName = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => semanticFixtureValue(entry, replacements, forbiddenLiterals, fieldName));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      semanticFixtureValue(entry, replacements, forbiddenLiterals, key),
    ]));
  }
  if (typeof value !== 'string') return value;
  let normalized = value;
  const pathToken = fieldName === 'cwd' ? '<cwd>' : '<repoRoot>';
  normalized = normalized.replace(pathLiteralPattern(replacements.repoRoot), pathToken);
  for (const [literal, token] of replacements.sessionLiterals) {
    normalized = replaceEvery(normalized, literal, token);
  }
  assertNoFixtureIdentityLiterals(normalized, forbiddenLiterals);
  return normalized;
}

async function readJsonlRecords(file) {
  const text = await fsp.readFile(file, 'utf8');
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function computeTimelineProfileFixtureProof({
  files,
  parameters,
  repoRoot,
  longSessionId,
  secondarySessionId,
}) {
  const replacements = {
    repoRoot,
    sessionLiterals: [
      [longSessionId, '<session:primary>'],
      [secondarySessionId, '<session:secondary>'],
    ],
  };
  const forbiddenLiterals = { repoRoot, sessionIds: [longSessionId, secondarySessionId] };
  const semanticFiles = [];
  for (const descriptor of files) {
    const records = await readJsonlRecords(descriptor.file);
    semanticFiles.push({
      name: descriptor.name,
      records: semanticFixtureValue(records, replacements, forbiddenLiterals),
    });
  }
  const document = stableCanonicalValue({
    proofVersion: 1,
    parameters: stableCanonicalValue(parameters),
    files: semanticFiles,
  });
  const serialized = `${JSON.stringify(document)}\n`;
  assertNoFixtureIdentityLiterals(serialized, forbiddenLiterals);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function syntheticText(index, options = {}) {
  const searchableTextBytes = Math.max(256, Number(options.searchableTextBytes) || DEFAULT_SEARCHABLE_TEXT_BYTES);
  const markers = [
    `Synthetic timeline event ${String(index).padStart(4, '0')}.`,
    options.hasHit ? 'far-needle' : 'ordinary-target',
    options.hasCommonTerm ? 'common-term' : 'sparse-term',
  ].join(' ');
  const padding = ` deterministic profiling payload ${String(index).padStart(4, '0')}`;
  let text = markers;
  while (text.length < searchableTextBytes) text += padding;
  return text.slice(0, searchableTextBytes);
}

function codeModeContextRows(timestamp, repoRoot) {
  const iso = (offset) => new Date(timestamp + offset).toISOString();
  const callId = 'profile-context-exec';
  const turnId = 'profile-context-turn';
  return [
    {
      timestamp: iso(0),
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: callId,
        turn_id: turnId,
        input: "const value = await tools.fixture({ status: 'failed' }); text(value);",
      },
    },
    {
      timestamp: iso(1000),
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: callId,
        turn_id: turnId,
        output: 'Script running with cell ID 4242\ncommon-term context output',
      },
    },
    {
      timestamp: iso(2000),
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'wait',
        call_id: 'profile-context-wait-1',
        turn_id: turnId,
        arguments: '{"cell_id":"4242"}',
      },
    },
    {
      timestamp: iso(3000),
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'profile-context-wait-1',
        turn_id: turnId,
        output: 'Script running with cell ID 4242\ncommon-term intermediate output',
      },
    },
    {
      timestamp: iso(4000),
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'wait',
        call_id: 'profile-context-wait-2',
        turn_id: turnId,
        arguments: '{"cell_id":"4242"}',
      },
    },
    {
      timestamp: iso(5000),
      type: 'event_msg',
      payload: {
        type: 'mcp_tool_call_end',
        call_id: 'profile-context-nested',
        turn_id: turnId,
        tool_name: CONTEXT_REVEAL_TOOL_NAME,
        status: 'failed',
      },
    },
    {
      timestamp: iso(6000),
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'profile-context-wait-2',
        turn_id: turnId,
        output: 'Script completed\ncommon-term context completion',
      },
    },
  ];
}

function makeSessionRows({
  sessionId,
  repoRoot,
  eventCount,
  searchableTextBytes,
  hitPositions,
  commonTermEvery,
  detailHeavyPositions,
  startTime,
  includeContextReveal,
  contextRevealIndex,
}) {
  const rows = [{
    timestamp: new Date(startTime).toISOString(),
    type: 'session_meta',
    payload: { id: sessionId, cwd: repoRoot },
  }];
  const hits = normalizePositions(hitPositions, eventCount);
  const details = normalizePositions(detailHeavyPositions, eventCount);
  for (let index = 0; index < eventCount; index += 1) {
    const timestamp = startTime + ((index + 1) * 2000);
    // This protocol sequence projects to two Main logical events, so replace two ordinary rows
    // and keep the fixed profiling corpus at exactly eventCount Main events.
    if (includeContextReveal && index === contextRevealIndex && index + 1 < eventCount) {
      rows.push(...codeModeContextRows(timestamp, repoRoot));
      index += 1;
      continue;
    }
    const text = syntheticText(index, {
      searchableTextBytes,
      hasHit: hits.has(index),
      hasCommonTerm: commonTermEvery > 0 && index % commonTermEvery === 0,
    });
    if (details.has(index)) {
      const callId = `profile-command-${index}`;
      rows.push(
        {
          timestamp: new Date(timestamp).toISOString(),
          type: 'event_msg',
          payload: {
            type: 'exec_command_begin',
            call_id: callId,
            command: ['powershell.exe', '-Command', `Write-Output profile-${index}`],
            cwd: repoRoot,
          },
        },
        {
          timestamp: new Date(timestamp + 1000).toISOString(),
          type: 'event_msg',
          payload: {
            type: 'exec_command_end',
            call_id: callId,
            command: ['powershell.exe', '-Command', `Write-Output profile-${index}`],
            cwd: repoRoot,
            stdout: text,
            stderr: '',
            exit_code: 0,
            status: 'completed',
          },
        },
      );
      continue;
    }
    const role = index % 2 === 0 ? 'user' : 'assistant';
    rows.push({
      timestamp: new Date(timestamp).toISOString(),
      type: 'response_item',
      payload: {
        type: 'message',
        role,
        content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
      },
    });
  }
  return rows;
}

async function writeJsonl(file, rows) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

async function createTimelineProfileFixture(baseDir, options = {}) {
  const eventCount = Math.max(1, Number(options.eventCount) || DEFAULT_EVENT_COUNT);
  const searchableTextBytes = Math.max(256, Number(options.searchableTextBytes) || DEFAULT_SEARCHABLE_TEXT_BYTES);
  const hitPositions = Array.isArray(options.hitPositions) ? options.hitPositions : DEFAULT_HIT_POSITIONS;
  const commonTermEvery = Math.max(0, Number(options.commonTermEvery) || 1);
  const detailHeavyPositions = Array.isArray(options.detailHeavyPositions) ? options.detailHeavyPositions : [];
  const includeContextReveal = options.includeContextReveal === true && eventCount >= 4;
  const requestedContextRevealIndex = Number(options.contextRevealIndex);
  const contextRevealIndex = Number.isInteger(requestedContextRevealIndex)
    && requestedContextRevealIndex >= 0
    && requestedContextRevealIndex + 1 < eventCount
    ? requestedContextRevealIndex
    : Math.min(DEFAULT_CONTEXT_REVEAL_INDEX, Math.max(0, eventCount - 2));
  const secondaryEventCount = Math.max(1, Number(options.secondaryEventCount) || 40);
  const codexHome = path.join(baseDir, 'codex-home');
  const repoRoot = path.join(baseDir, 'repo');
  const longSessionId = '18181818-1818-4181-8181-181818181818';
  const secondarySessionId = '28282828-2828-4282-8282-282828282828';
  const longStart = Date.parse('2026-07-20T01:00:00.000Z');
  const secondaryStart = Date.parse('2026-07-19T01:00:00.000Z');
  await fsp.mkdir(repoRoot, { recursive: true });

  const longRows = makeSessionRows({
    sessionId: longSessionId,
    repoRoot,
    eventCount,
    searchableTextBytes,
    hitPositions,
    commonTermEvery,
    detailHeavyPositions,
    startTime: longStart,
    includeContextReveal,
    contextRevealIndex,
  });
  const secondaryRows = makeSessionRows({
    sessionId: secondarySessionId,
    repoRoot,
    eventCount: secondaryEventCount,
    searchableTextBytes: Math.min(searchableTextBytes, 512),
    hitPositions: [],
    commonTermEvery: 1,
    detailHeavyPositions: [],
    startTime: secondaryStart,
  });
  const longFile = path.join(codexHome, 'sessions', '2026', '07', '20', `rollout-2026-07-20T09-00-00-${longSessionId}.jsonl`);
  const secondaryFile = path.join(codexHome, 'sessions', '2026', '07', '19', `rollout-2026-07-19T09-00-00-${secondarySessionId}.jsonl`);
  await writeJsonl(longFile, longRows);
  await writeJsonl(secondaryFile, secondaryRows);
  await fsp.writeFile(path.join(codexHome, 'session_index.jsonl'), [
    JSON.stringify({ id: longSessionId, thread_name: 'Synthetic 1,800-event profiling session' }),
    JSON.stringify({ id: secondarySessionId, thread_name: 'Synthetic transition target session' }),
    '',
  ].join('\n'), 'utf8');

  const parameters = {
    eventCount,
    searchableTextBytes,
    hitPositions: [...normalizePositions(hitPositions, eventCount)].sort((left, right) => left - right),
    commonTermEvery,
    detailHeavyPositions: [...normalizePositions(detailHeavyPositions, eventCount)].sort((left, right) => left - right),
    secondaryEventCount,
    includeContextReveal,
    contextRevealIndex: includeContextReveal ? contextRevealIndex : null,
  };
  const sessionIndexFile = path.join(codexHome, 'session_index.jsonl');
  const proofFiles = [
    { name: 'primary-session.jsonl', file: longFile },
    { name: 'secondary-session.jsonl', file: secondaryFile },
    { name: 'session-index.jsonl', file: sessionIndexFile },
  ];
  const semanticFixtureProof = await computeTimelineProfileFixtureProof({
    files: proofFiles,
    parameters,
    repoRoot,
    longSessionId,
    secondarySessionId,
  });

  return {
    codexHome,
    repoRoot,
    longSessionId,
    secondarySessionId,
    parameters,
    semanticFixtureProof,
    proofVersion: 1,
    generatedFiles: Object.freeze({
      primary: longFile,
      secondary: secondaryFile,
      sessionIndex: sessionIndexFile,
    }),
    contextReveal: includeContextReveal ? { toolName: CONTEXT_REVEAL_TOOL_NAME } : null,
  };
}

module.exports = {
  DEFAULT_EVENT_COUNT,
  DEFAULT_SEARCHABLE_TEXT_BYTES,
  DEFAULT_HIT_POSITIONS,
  CONTEXT_REVEAL_TOOL_NAME,
  assertNoFixtureIdentityLiterals,
  computeTimelineProfileFixtureProof,
  createTimelineProfileFixture,
};
