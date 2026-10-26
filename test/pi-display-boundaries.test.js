'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, readPiRawRecord } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession } = require('../src/source-adapters');
const { createHistoryService } = require('../src/history-service');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');
const { LARGE_VALUE_MARKER } = require('../src/shared/logical-detail-sanitizer');
const { sanitizePiImageRecord, SAVED_IMAGE_MARKER } = require('../src/pi-images');

const timestamp = '2026-10-26T05:00:00.000Z';
const entry = (id, parentId, type, fields = {}) => ({ type, id, parentId, timestamp, ...fields });
const message = (id, parentId, role, content, fields = {}) => entry(id, parentId, 'message', {
  message: { role, content, timestamp: Date.parse(timestamp), ...fields },
});
const text = (value) => ({ type: 'text', text: value });
const call = (id, parentId, callId) => message(id, parentId, 'assistant', [
  { type: 'toolCall', id: callId, name: 'extension_report', arguments: {} },
]);
const result = (id, parentId, callId, output) => message(id, parentId, 'toolResult', [text(output)], {
  toolCallId: callId, toolName: 'extension_report', isError: false,
});
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6MsAAAAASUVORK5CYII=';
const image = () => ({ type: 'image', mimeType: 'image/png', data: png });

async function fixture(t, name, rows) {
  const sourceHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-display-boundaries-'));
  t.after(() => fs.rm(sourceHome, { recursive: true, force: true }));
  const repoRoot = path.join(sourceHome, 'project');
  const sessionsRoot = path.join(sourceHome, 'sessions');
  await fs.mkdir(repoRoot);
  await fs.mkdir(sessionsRoot);
  const file = path.join(sessionsRoot, 'saved.jsonl');
  const contents = [{ type: 'session', version: 3, id: name, cwd: repoRoot, timestamp }, ...rows]
    .map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(file, contents);
  const index = await buildPiIndex({ sourceHome, repoRoot });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  const sessions = await Promise.all(index.sessions.map((session) => materializeSessionForIndex(index, session)));
  const service = await createHistoryService({ repo: repoRoot, source: 'pi', piHome: sourceHome });
  t.after(() => service.close());
  return { index, sessions, service, file, contents };
}

test('tool Detail marks omitted long output while exact-boundary output, branch pairing, search and Raw stay intact', async (t) => {
  const tail = 'UNIQUE_LONG_RESULT_TAIL_20261026';
  const output = 'report-body\n'.repeat(10_000) + tail;
  const boundary = 'B'.repeat(100_000);
  const f = await fixture(t, 'long-output', [
    message('u', null, 'user', 'Run report'),
    call('boundary-call', 'u', 'boundary'), result('boundary-result', 'boundary-call', 'boundary', boundary),
    call('long-call', 'boundary-result', 'long'), result('long-result', 'long-call', 'long', output),
    result('sibling-result', 'long-call', 'long', 'SIBLING_ONLY_OUTPUT'),
    result('ambiguous-first', 'long-call', 'long', 'AMBIGUOUS_FIRST_OUTPUT'),
    result('ambiguous-last', 'ambiguous-first', 'long', 'AMBIGUOUS_LAST_OUTPUT'),
  ]);
  assert.equal(f.sessions.length, 3);
  for (const session of f.sessions) {
    const boundedCall = session.logicalEvents.find((event) => event.pi?.callId === 'boundary');
    const boundedDetail = await buildEventDetailForSession(f.index, session, boundedCall.id, 'main');
    validateStructuredLogicalDetailDto(boundedDetail);
    assert.equal(boundedDetail.timelineSections.find((section) => section.type === 'terminal').text, boundary);

    const event = session.logicalEvents.find((candidate) => candidate.pi?.callId === 'long');
    const detail = await buildEventDetailForSession(f.index, session, event.id, 'main');
    validateStructuredLogicalDetailDto(detail);
    const displayed = detail.timelineSections.find((section) => section.type === 'terminal');
    if (session.sourceDerivedId === 'ambiguous-last') {
      assert.equal(event.status, 'incomplete');
      assert.equal(event.rawRefs.length, 1);
      assert.equal(displayed, undefined);
      assert.match(JSON.stringify(detail), /No unique completed result/);
    } else {
      assert.equal(event.status, 'success');
      assert.equal(event.pi.pairing, 'exact_id_ancestor');
      assert.equal(event.rawRefs.length, 2);
      if (session.sourceDerivedId === 'long-result') {
        assert.ok(displayed.text.includes(LARGE_VALUE_MARKER));
        assert.ok(displayed.text.startsWith(output.slice(0, 100_000).trimEnd()));
        assert.ok(displayed.text.length < output.length);
        assert.equal(displayed.text.includes(tail), false);
        assert.equal(JSON.stringify(detail).includes('SIBLING_ONLY_OUTPUT'), false);
        const raw = session.rawEvents.find((item) => item.entryId === 'long-result');
        const exact = await readPiRawRecord(f.index, session, raw);
        assert.equal(exact.raw, f.contents.split('\n')[raw.line - 1]);
        assert.equal(exact.parsed.message.content[0].text, output);
      } else {
        assert.equal(displayed.text, 'SIBLING_ONLY_OUTPUT');
        assert.equal(JSON.stringify(detail).includes(tail), false);
      }
    }
  }
  assert.equal((await f.service.execute('search', { layer: 'main', query: tail })).scan.matchedEvents, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.contents);
});

test('context-edit images are omitted from cached records, logical facts and public Detail across descendant branches', async (t) => {
  const f = await fixture(t, 'context-image', [
    message('u', null, 'user', [text('original caption'), image()]),
    entry('edit', 'u', 'context_edit', { targetId: 'u', replacement: { content: [text('replacement caption'), image()] } }),
    message('a', 'edit', 'user', 'Branch A'), message('b', 'edit', 'user', 'Branch B'),
  ]);
  assert.equal(f.sessions.length, 2);
  for (const session of f.sessions) {
    const original = session.rawEvents.find((raw) => raw.entryId === 'u');
    const edited = session.rawEvents.find((raw) => raw.entryId === 'edit');
    const event = session.logicalEvents.find((candidate) => candidate.subtype === 'pi_context_edit');
    assert.equal(original.parsed.message.content[1].data, SAVED_IMAGE_MARKER);
    assert.equal(edited.parsed.replacement.content[1].data, SAVED_IMAGE_MARKER);
    assert.deepEqual(event.pi.replacement, edited.parsed.replacement);
    assert.equal(event.pi.replacement.content[1].data, SAVED_IMAGE_MARKER);
    assert.equal(JSON.stringify(session.rawEvents).includes(png), false);
    assert.equal(JSON.stringify(session.logicalEvents).includes(png), false);
    for (const [id, layer] of [[event.id, 'protocol'], [edited.rawId, 'raw']]) {
      const detail = await buildEventDetailForSession(f.index, session, id, layer);
      if (layer === 'protocol') validateStructuredLogicalDetailDto(detail);
      assert.equal(JSON.stringify(detail).includes(png), false);
      assert.equal(detail.timelineSections.some((section) => section.type === 'image_preview'), false);
      if (layer === 'protocol') {
        const replacement = detail.inspectorSections.find((section) => section.title?.startsWith('Recorded context replacement'));
        assert.equal(replacement.value.content[1].data, SAVED_IMAGE_MARKER);
      }
    }
    for (const raw of [original, edited]) {
      const exact = await readPiRawRecord(f.index, session, raw);
      assert.equal(exact.raw, f.contents.split('\n')[raw.line - 1]);
      assert.ok(exact.raw.includes(png));
    }
  }
  for (const layer of ['main', 'protocol', 'raw']) {
    assert.equal((await f.service.execute('search', { layer, query: png })).scan.matchedEvents, 0);
  }
  assert.equal((await f.service.execute('search', { layer: 'protocol', query: 'replacement caption' })).scan.matchedEvents, 2);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.contents);
});

test('context-edit sanitization preserves null, text and malformed replacements without walking extension fields', async (t) => {
  const replacements = [null, 'malformed replacement', false, 7, [], {}, { content: null },
    { content: 'replacement text' }, { content: { type: 'image', data: png } },
    { content: [null, 3, 'unknown', { type: 'text', text: 'READABLE' }, { type: 'image' }] }];
  for (const replacement of replacements) {
    const record = entry('edit', 'u', 'context_edit', { targetId: 'u', replacement });
    assert.deepEqual(sanitizePiImageRecord(record), record);
  }
  const scoped = entry('edit', 'u', 'context_edit', { targetId: 'u', replacement: {
    content: [image()], extension: { content: [image()] },
  }, extension: { content: [image()] } });
  const before = JSON.stringify(scoped);
  const sanitized = sanitizePiImageRecord(scoped);
  assert.equal(sanitized.replacement.content[0].data, SAVED_IMAGE_MARKER);
  assert.equal(sanitized.replacement.extension.content[0].data, png);
  assert.equal(sanitized.extension.content[0].data, png);
  assert.equal(JSON.stringify(scoped), before);

  const f = await fixture(t, 'malformed-replacements', [message('u', null, 'user', 'Original'),
    ...replacements.map((replacement, index) => entry(`edit-${index}`, index ? `edit-${index - 1}` : 'u',
      'context_edit', { targetId: 'u', replacement })),
  ]);
  const session = f.sessions[0];
  const events = session.logicalEvents.filter((event) => event.subtype === 'pi_context_edit');
  assert.equal(events.length, replacements.length);
  for (const [index, event] of events.entries()) {
    assert.deepEqual(event.pi.replacement, replacements[index]);
    const detail = await buildEventDetailForSession(f.index, session, event.id, 'protocol');
    validateStructuredLogicalDetailDto(detail);
    assert.deepEqual(detail.inspectorSections.find((section) => section.title?.startsWith('Recorded context replacement')).value,
      replacements[index]);
  }
});
