#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256, privateTarget, mainGuard } = require('./history-eval-common');

const operations = new Set(['search', 'context', 'read', 'status']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value) => typeof value === 'string' && value.length > 0 ? value : null;
const number = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const bytes = (value) => Buffer.byteLength(value || '', 'utf8');

function operationOf(row) {
  const args = Array.isArray(row.args) ? row.args : [];
  const historyAt = args.indexOf('history');
  if (historyAt >= 0 && operations.has(args[historyAt + 1])) {
    // CLI flags take one value; a literal --query "--help" is not help.
    for (let at = historyAt + 2; at < args.length; at += 2) {
      if (['--help', '-h'].includes(args[at])) return 'help';
    }
    return args[historyAt + 1];
  }
  const executable = path.basename(String(row.command || '')).toLowerCase().replace(/\.exe$/u, '');
  if (['rg', 'grep', 'findstr'].includes(executable)) return 'search';
  return null; // Arbitrary shell scripts and pipelines cannot be classified safely.
}

function refsOf(row) {
  const args = Array.isArray(row.args) ? row.args : [];
  const refs = [];
  let unknownInputs = 0;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--refs' || args[index] === '--ref') {
      const value = args[index + 1];
      if (typeof value === 'string' && value) refs.push(value); // Refs are opaque, not comma-separated.
      else unknownInputs += 1;
    } else if (args[index] === '--input') {
      try {
        const input = JSON.parse(args[index + 1]);
        if (isObject(input) && Array.isArray(input.refs) && input.refs.every((ref) => typeof ref === 'string' && ref)) refs.push(...input.refs);
        else unknownInputs += 1;
      } catch { unknownInputs += 1; }
    }
  }
  return { refs, unknownInputs };
}

function eventKey(item) {
  if (string(item.sessionId) && string(item.eventId) && string(item.layer)) {
    return JSON.stringify([item.sessionId, item.layer, item.eventId]);
  }
  const ref = string(item.evidenceRef) || string(item.ref);
  if (ref?.startsWith('er2.')) {
    const parts = ref.split('.');
    if (parts.length >= 7 && parts[5] === 'e') return parts.slice(0, 7).join('.');
  }
  if (ref?.startsWith('er1.')) return ref; // Opaque legacy locator: no offset normalization is justified.
  return null;
}

function analyzeRows(rows, annotation = null) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('A nonempty recorder log is required');
  if (rows.some((row) => !isObject(row))) throw new Error('Recorder rows must be objects');
  const identity = rows[0].identity || null;
  if (rows.some((row) => JSON.stringify(row.identity || null) !== JSON.stringify(identity))) throw new Error('Mixed trial identities');
  if (annotation !== null && (!isObject(annotation) || !string(annotation.provenance))) throw new Error('Annotation requires provenance');
  const verdictFields = ['answerSupported', 'evidenceUsed', 'laterStateResolved'];
  if (annotation && verdictFields.some((field) => annotation[field] !== undefined && annotation[field] !== null && typeof annotation[field] !== 'boolean')) {
    throw new Error('Annotation verdicts must be boolean or null');
  }
  const searchEvents = new Set();
  const shownEvents = new Set();
  const readEvents = new Set();
  const positions = new Set();
  const excerptSeen = new Set();
  const aliases = new Map();
  const calls = [];
  let firstReadStep = null;
  let searchesBeforeFirstRead = 0;
  let independentQueriesBeforeFirstRead = 0;
  let searchRequests = 0;
  let executedSearchRequests = 0;
  let readAttempts = 0;
  let executedReadRequests = 0;
  let successfulReadRequests = 0;
  let independentQueriesRequested = 0;
  let independentQueriesExecuted = 0;
  let independentQueriesNotExecuted = 0;
  let independentQueryResultsOmitted = 0;
  let independentQueriesUnknown = 0;
  let unclassifiedExecCalls = 0;
  let searchHits = 0;
  let unknownSearchHits = 0;
  let returnedExcerptBytes = 0;
  let repeatedIdenticalExcerptBytes = 0;
  let incompleteExcerptCount = 0;
  let knownReadRequests = 0;
  let unknownReadRequests = 0;
  let readResponseEvents = 0;
  let unknownReadResponseEvents = 0;

  function remember(item, contextRef) {
    const ref = string(item.ref);
    const prior = lookup(ref, contextRef) || lookup(string(item.evidenceRef), contextRef);
    const key = string(item.sessionId) && string(item.eventId) && string(item.layer)
      ? eventKey(item) : prior || eventKey(item);
    if (key && ref) aliases.set(JSON.stringify([contextRef || null, ref]), key);
    if (key && string(item.evidenceRef)) aliases.set(JSON.stringify([contextRef || null, item.evidenceRef]), key);
    for (const candidate of [ref, string(item.evidenceRef)]) {
      const durable = eventKey({ ref: candidate });
      if (key && durable) aliases.set(durable, key);
    }
    return key;
  }
  function lookup(ref, contextRef) {
    if (!ref) return null;
    // er2 event identity retains scope, session, snapshot, layer and event;
    // only the search-hit offset is removed. Compact handles remain contextual.
    return aliases.get(JSON.stringify([contextRef || null, ref]))
      || aliases.get(eventKey({ ref })) || null;
  }
  function excerpt(item, key) {
    const part = item.excerpt;
    if (!isObject(part) || typeof part.text !== 'string') return;
    const length = bytes(part.text);
    returnedExcerptBytes += length;
    if (part.truncated === true || part.nextOffset !== undefined && part.nextOffset !== null) incompleteExcerptCount += 1;
    const repr = string(part.representation) || 'unknown';
    const hit = number(part.hitOffset);
    if (key && hit !== null) positions.add(JSON.stringify([key, repr, hit]));
    const exact = key && JSON.stringify([key, repr, part.text]);
    if (exact && excerptSeen.has(exact)) repeatedIdenticalExcerptBytes += length;
    if (exact) excerptSeen.add(exact);
  }

  rows.forEach((row, index) => {
    const phase = row.phase || 'retrieval';
    const operation = operationOf(row);
    const executed = row.executed !== false;
    const delivered = typeof row.deliveredStdout === 'string' ? row.deliveredStdout : row.stdout;
    let result = null;
    let parseError = null;
    if (executed && typeof delivered === 'string' && delivered.trim()) {
      try { result = JSON.parse(delivered); } catch (error) { parseError = error.message; }
    }
    const valid = isObject(result) && Array.isArray(result.items) && result.operation === `history.${operation}`;
    const contextRef = valid ? string(result.contextRef) : null;
    const call = { step: index + 1, phase, operation, executed, exitCode: row.exitCode ?? null,
      error: row.error ?? null, outputTruncated: row.outputTruncated ?? null,
      captureComplete: row.captureComplete ?? null, parsed: valid,
      parseError: parseError || (result && !valid ? 'Unexpected response shape or operation' : null),
      responseError: isObject(result?.error) ? result.error : null,
      shownEvents: 0, searchHits: 0, readEvents: 0, independentQueries: 0,
      independentQueriesNotExecuted: 0, independentQueryResultsOmitted: 0 };
    calls.push(call);
    if (phase !== 'retrieval') return;
    if (!operation && executed) unclassifiedExecCalls += 1;
    if (operation === 'search') searchRequests += 1;
    if (operation === 'search' && executed) {
      executedSearchRequests += 1;
      if (firstReadStep === null) searchesBeforeFirstRead += 1;
    }
    if (operation === 'read') {
      readAttempts += 1;
      if (executed) executedReadRequests += 1;
      if (executed && row.exitCode === 0 && valid && !result.error) {
        successfulReadRequests += 1;
        if (firstReadStep === null) firstReadStep = index + 1;
      }
    }
    if (!valid) {
      if (operation === 'search') independentQueriesUnknown += 1;
      if (operation === 'read') {
        const requested = refsOf(row);
        unknownReadRequests += requested.refs.length + requested.unknownInputs;
      }
      return;
    }
    if (operation === 'search') {
      let items = result.items;
      if (Array.isArray(result.groups)) {
        items = [];
        for (const group of result.groups) {
          if (!isObject(group) || !['complete', 'results_omitted', 'not_executed'].includes(group.state)) {
            independentQueriesUnknown += 1;
            continue;
          }
          independentQueriesRequested += 1;
          call.independentQueries += 1;
          if (firstReadStep === null) independentQueriesBeforeFirstRead += 1;
          if (group.state === 'not_executed') {
            independentQueriesNotExecuted += 1;
            call.independentQueriesNotExecuted += 1;
          } else {
            independentQueriesExecuted += 1;
            if (group.state === 'results_omitted') {
              independentQueryResultsOmitted += 1;
              call.independentQueryResultsOmitted += 1;
            }
          }
          if (Array.isArray(group.items)) items.push(...group.items);
          else independentQueriesUnknown += 1;
        }
      } else {
        independentQueriesRequested += 1;
        independentQueriesExecuted += 1;
        call.independentQueries = 1;
        if (firstReadStep === null) independentQueriesBeforeFirstRead += 1;
      }
      for (const item of items) {
        searchHits += 1; call.searchHits += 1;
        const key = remember(item, contextRef);
        if (key) { searchEvents.add(key); shownEvents.add(key); call.shownEvents += 1; }
        else unknownSearchHits += 1;
        excerpt(item, key);
      }
    } else if (operation === 'context') {
      const events = Array.isArray(result.events) ? result.events : result.items.flatMap((item) => Array.isArray(item.events) ? item.events : []);
      for (const item of events) {
        const key = remember(item, contextRef);
        if (key) { shownEvents.add(key); call.shownEvents += 1; }
        excerpt(item, key);
      }
    } else if (operation === 'read') {
      const requested = refsOf(row);
      unknownReadRequests += requested.unknownInputs;
      for (const ref of requested.refs) {
        const key = lookup(ref, contextRef) || eventKey({ ref });
        if (key) knownReadRequests += 1; else unknownReadRequests += 1;
      }
      for (const item of result.items) {
        readResponseEvents += 1;
        const key = remember(item, contextRef);
        if (key) { readEvents.add(key); shownEvents.add(key); call.readEvents += 1; }
        else unknownReadResponseEvents += 1;
      }
    }
  });
  const searchEventsRead = [...searchEvents].filter((key) => readEvents.has(key)).length;
  return { schemaVersion: 1, identity, annotation: annotation ? { provenance: annotation.provenance,
    answerSupported: annotation.answerSupported ?? null, evidenceUsed: annotation.evidenceUsed ?? null,
    laterStateResolved: annotation.laterStateResolved ?? null } : { provenance: null, answerSupported: null, evidenceUsed: null, laterStateResolved: null },
  metrics: { searchesBeforeFirstRead: firstReadStep === null ? null : searchesBeforeFirstRead,
    searchesWithoutObservedRead: firstReadStep === null ? searchesBeforeFirstRead : null, firstReadStep,
    searchRequests, executedSearchRequests, readAttempts, executedReadRequests, successfulReadRequests,
    independentQueriesRequested, independentQueriesExecuted,
    independentQueriesNotExecuted, independentQueryResultsOmitted, independentQueriesUnknown,
    independentQueriesBeforeFirstRead: firstReadStep === null ? null : independentQueriesBeforeFirstRead,
    independentQueriesWithoutObservedRead: firstReadStep === null ? independentQueriesBeforeFirstRead : null,
    unclassifiedExecCalls,
    searchHits, uniqueSearchEvents: searchEvents.size, uniqueShownEvents: shownEvents.size, unknownSearchHits,
    distinctKnownMatchPositions: positions.size, matchPositionCoverage: unknownSearchHits ? 'partial' : 'known_items_only',
    returnedExcerptBytes, repeatedIdenticalExcerptBytes, incompleteExcerptCount,
    knownReadRequests, unknownReadRequests, readResponseEvents, unknownReadResponseEvents,
    uniqueReadEvents: readEvents.size, searchEventsRead,
    searchToReadConversion: searchEvents.size ? searchEventsRead / searchEvents.size : null }, calls,
  limitations: ['Returned excerpt bytes are observed payload, not saved context or tokens.',
    'Identical excerpt repeats are counted separately from overlapping or changed excerpts.',
    'Event aliases require explicit identity or a resolvable evidence reference; unknowns are retained.',
    'Search/read behavior does not establish answer support or evidence use.'] };
}

function analyzeFile(file, annotation = null) {
  const raw = fs.readFileSync(file, 'utf8');
  const rows = raw.split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  return { logPath: path.resolve(file), logSha256: sha256(raw), ...analyzeRows(rows, annotation) };
}

function main() {
  const args = process.argv.slice(2);
  let report = null;
  let annotationFile = null;
  const files = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--report') report = args.shift();
    else if (arg === '--annotations') annotationFile = args.shift();
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else files.push(arg);
  }
  if (!files.length || report === undefined || annotationFile === undefined) throw new Error('Usage: measure-history-convergence.js [--report tmp/report.json] [--annotations annotations.json] <log.jsonl>...');
  const annotations = annotationFile ? JSON.parse(fs.readFileSync(annotationFile, 'utf8')) : {};
  if (!isObject(annotations)) throw new Error('Annotations must be an object keyed by condition/trial');
  const trials = files.map((file) => {
    const draft = analyzeFile(file);
    const id = draft.identity;
    const key = id ? `${id.condition}/${id.trial}` : null;
    return key && Object.hasOwn(annotations, key) ? analyzeFile(file, annotations[key]) : draft;
  });
  const output = `${JSON.stringify({ schemaVersion: 1, measuredAt: new Date().toISOString(), trials }, null, 2)}\n`;
  if (report) {
    const target = privateTarget(report);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, { flag: 'wx' });
  }
  process.stdout.write(output);
}
if (require.main === module) mainGuard(main);
module.exports = { analyzeRows, analyzeFile, eventKey };
