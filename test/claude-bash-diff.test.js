'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const source = require('../src/claude-source');
const { createClaudeLogicalBuilder } = require('../src/claude-logical');
const { buildClaudeEventDetail } = require('../src/claude-detail');
const { validateLogicalDetailSection } = require('../src/shared/logical-detail-contract');

// Minimized synthetic example of the 2.1.283 receipt; no real transcript data.
function diffEvidence() {
  return {
    files: [{
      filePath: '/synthetic/example.txt',
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
        lines: [' alpha', '-beta', '+gamma'] }],
    }],
    moreFiles: 0,
    changedFiles: ['/synthetic/example.txt'],
  };
}

function call(id = 'bash-edit', name = 'Bash') {
  return { type: 'tool_use', id, name, input: { command: 'synthetic-edit example.txt' } };
}

function result(id = 'bash-edit') {
  return { type: 'tool_result', tool_use_id: id, content: 'Command finished' };
}

function pair(diff = diffEvidence(), options = {}) {
  return [
    { type: 'assistant', message: { content: [call(options.id, options.name)] } },
    { type: 'user', message: { content: [result(options.id)] },
      toolUseResult: { stdout: 'done', stderr: '', exitCode: 0, bashEditDiff: diff },
    },
  ];
}

function project(records) {
  const rawEvents = records.map((record, index) => source.makeClaudeRawEvent({
    version: '2.1.283', sessionId: 'synthetic-bash-diff',
    uuid: `row-${index}`, parentUuid: index ? `row-${index - 1}` : null,
    ...record,
  }, index + 1, 'synthetic-bash-diff.jsonl', 'claude-code:synthetic-bash-diff', 'synthetic-bash-diff'));
  const builder = createClaudeLogicalBuilder({ ...source, rawRef: source.claudeRawRef });
  const session = { rawEvents, logicalEvents: builder.buildLogicalEvents(rawEvents) };
  const commands = session.logicalEvents.filter((event) => event.layer === 'main' && event.callId);
  return { session, commands, detail: (event = commands[0], locale = 'en') => (
    buildClaudeEventDetail(session, event.id, 'main', { locale })
  ) };
}

test('Bash diff keeps one command, exact files, searchable evidence and localized result detail', () => {
  const fixture = project(pair());
  const [event] = fixture.commands;
  assert.equal(fixture.commands.length, 1);
  assert.equal(event.kind, 'command');
  assert.equal(event.status, 'success');
  assert.deepEqual(event.touchedFiles, ['/synthetic/example.txt']);
  assert.match(event.searchText, /gamma/);
  assert.equal(event.rawRefs.length, 2);
  assert.ok(event.rawRefs.every((ref) => ref.sourceLocator.type === 'jsonl_line'));
  for (const locale of ['en', 'zh-CN']) {
    const detail = fixture.detail(event, locale);
    const section = detail.timelineSections.find((item) => item.type === 'diff');
    assert.equal(section.purpose, 'result');
    assert.equal(section.text, '--- /synthetic/example.txt\n+++ /synthetic/example.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+gamma');
    validateLogicalDetailSection(section);
    assert.ok(detail.inspectorSections.some((item) => item.value?.bashEditDiff));
  }
});

test('partial file lists retain explicit omitted-file names and omission metadata', () => {
  const evidence = diffEvidence();
  evidence.moreFiles = 2;
  evidence.changedFiles.push('/synthetic/binary.bin', '/synthetic/omitted.txt');
  const fixture = project(pair(evidence));
  assert.deepEqual(fixture.commands[0].touchedFiles, evidence.changedFiles);
  const detail = fixture.detail();
  assert.equal(detail.inspectorSections.find((item) => item.value?.bashEditDiff).value.bashEditDiff.moreFiles, 2);
  assert.doesNotMatch(detail.timelineSections.find((item) => item.type === 'diff').text, /binary|omitted/);
});

test('failed commands may retain observed edits but declined commands cannot claim them', () => {
  const failed = pair();
  failed[1].toolUseResult.exitCode = 3;
  const fixture = project(failed);
  assert.equal(fixture.commands[0].status, 'failed');
  assert.deepEqual(fixture.commands[0].touchedFiles, ['/synthetic/example.txt']);
  assert.ok(fixture.detail().timelineSections.some((item) => item.type === 'diff'));
  const denied = pair();
  denied[1].toolDenialKind = 'permission_denied';
  const declined = project(denied);
  assert.equal(declined.commands[0].status, 'declined');
  assert.deepEqual(declined.commands[0].touchedFiles, []);
  assert.ok(!declined.detail().timelineSections.some((item) => item.type === 'diff'));
  assert.ok(declined.detail().inspectorSections.some((item) => item.value?.bashEditDiff));
});

test('batched result rows never lend Bash diff metadata to either call', () => {
  const records = pair();
  records[0].message.content.push(call('other-bash'));
  records[1].message.content.push(result('other-bash'));
  const fixture = project(records);
  for (const event of fixture.commands) {
    assert.deepEqual(event.touchedFiles, []);
    const detail = fixture.detail(event);
    assert.ok(!detail.timelineSections.some((item) => item.type === 'diff'));
    assert.ok(!detail.inspectorSections.some((item) => item.value?.bashEditDiff));
  }
  assert.equal(fixture.session.rawEvents[1].parsed.toolUseResult.bashEditDiff.files.length, 1);
});

test('parallel calls with separate result rows keep diff ownership on the Bash owner', () => {
  const records = pair();
  records[0].message.content.push(call('other-bash'));
  records.push({ type: 'user', message: { content: [result('other-bash')] }, toolUseResult: { stdout: 'no edits' } });
  const fixture = project(records);
  const owner = fixture.commands.find((event) => event.callId === 'bash-edit');
  const other = fixture.commands.find((event) => event.callId === 'other-bash');
  assert.deepEqual(owner.touchedFiles, ['/synthetic/example.txt']);
  assert.deepEqual(other.touchedFiles, []);
  assert.ok(!fixture.detail(other).timelineSections.some((item) => item.type === 'diff'));
});

test('mixed Read/Bash calls do not lend their sibling file paths to command filters', () => {
  const records = pair();
  records[0].message.content.unshift({ type: 'tool_use', id: 'read-only', name: 'Read', input: { file_path: '/synthetic/read-only.txt' } });
  records.push({ type: 'user', message: { content: [result('read-only')] } });
  const fixture = project(records);
  assert.deepEqual(fixture.commands.find((event) => event.callId === 'bash-edit').touchedFiles, ['/synthetic/example.txt']);
  assert.deepEqual(fixture.commands.find((event) => event.callId === 'read-only').touchedFiles, ['/synthetic/read-only.txt']);
  delete records[1].toolUseResult.bashEditDiff;
  const noEdit = project(records).commands.find((event) => event.callId === 'bash-edit');
  assert.deepEqual(noEdit.touchedFiles, []);
  assert.equal(noEdit.bashEditFiles, undefined);
});

test('session edited-file summary counts only accepted Bash diff evidence, not Read or supplemental paths', async (t) => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { buildClaudeIndex } = require('../src/claude');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-bash-summary-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const container = path.join(home, 'projects', 'synthetic');
  await fs.mkdir(container, { recursive: true });
  const records = pair();
  records[0].message.content.unshift({ type: 'tool_use', id: 'read-only', name: 'Read', input: { file_path: '/synthetic/read-only.txt' } });
  records.push({ type: 'user', message: { content: [result('read-only')] } });
  records.push({ type: 'attachment', path: '/synthetic/supplement.txt', attachment: { type: 'future', toolUseID: 'bash-edit' } });
  const build = async () => {
    await fs.writeFile(path.join(container, 'summary.jsonl'), records.map((r, i) => JSON.stringify({
      ...r, sessionId: 'summary', cwd: '/synthetic/repo', uuid: `summary-${i}`, version: '2.1.283',
    })).join('\n') + '\n');
    return (await buildClaudeIndex({ claudeHome: home, repoRoot: '/synthetic/repo' })).sessions[0];
  };
  const edited = await build();
  assert.deepEqual(edited.analysis.patchedFiles, [{ file: '/synthetic/example.txt', count: 1 }]);
  assert.equal(edited.counts.patches, 0);
  delete records[1].toolUseResult.bashEditDiff;
  assert.deepEqual((await build()).analysis.patchedFiles, []);
});

test('duplicate or noncausal pairs never promote the result diff', () => {
  const duplicates = pair();
  duplicates[0].message.content.push(call());
  const duplicateResults = pair();
  duplicateResults.push(structuredClone(duplicateResults[1]));
  for (const records of [duplicates, duplicateResults, pair().reverse()]) {
    const fixture = project(records);
    for (const event of fixture.commands) {
      assert.equal(event.status, 'incomplete');
      assert.deepEqual(event.touchedFiles, []);
      assert.ok(!fixture.detail(event).timelineSections.some((item) => item.type === 'diff'));
    }
    assert.ok(fixture.session.logicalEvents.some((event) => event.subtype === 'unmatched_tool_result'));
  }
});

test('non-Bash tools cannot acquire file facts from Bash-specific result metadata', () => {
  const fixture = project(pair(diffEvidence(), { name: 'mcp__synthetic__read' }));
  assert.deepEqual(fixture.commands[0].touchedFiles, []);
  assert.ok(!fixture.detail().timelineSections.some((item) => item.type === 'diff'));
});

test('malformed, contradictory, truncated and oversized diff evidence remains JSON/Raw only', () => {
  const mutations = [
    (value) => { value.files[0].hunks[0].lines.pop(); },
    (value) => { value.files[0].hunks[0].oldLines = '2'; },
    (value) => { value.files[0].hunks[0].lines[0] = 'not a diff line'; },
    (value) => { value.files[0].hunks[0].lines[0] = ' alpha\n+fabricated'; },
    (value) => { value.files[0].hunks[0].oldStart = 0; },
    (value) => { value.files[0].hunks[0].oldStart = Number.MAX_SAFE_INTEGER; },
    (value) => { value.files[0].hunks[0].lines[0] = ` ${'x'.repeat(128_001)}`; },
    (value) => { value.changedFiles = ['/synthetic/contradiction.txt']; },
    (value) => { value.moreFiles = -1; },
    (value) => { value.files.push(structuredClone(value.files[0])); },
    (value) => { value.files[0].filePath = '/synthetic/injected\npath'; },
    (value) => { value.files = Array(65).fill(value.files[0]); },
    (value) => { value.changedFiles = Array(257).fill('/synthetic/example.txt'); },
  ];
  for (const mutate of mutations) {
    const evidence = diffEvidence();
    mutate(evidence);
    const fixture = project(pair(evidence));
    assert.deepEqual(fixture.commands[0].touchedFiles, []);
    const detail = fixture.detail();
    assert.ok(!detail.timelineSections.some((item) => item.type === 'diff'));
    assert.ok(detail.inspectorSections.some((item) => item.value?.bashEditDiff));
    assert.ok(fixture.session.rawEvents[1].parsed.toolUseResult.bashEditDiff);
  }
});

test('bounded diff text remains a valid detail section when source output is large', () => {
  const evidence = diffEvidence();
  evidence.files[0].hunks = [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 100,
    lines: Array(100).fill(`+${'x'.repeat(500)}`) }];
  const records = pair(evidence);
  records[1].toolUseResult.stdout = 'o'.repeat(80_000);
  const fixture = project(records);
  const section = fixture.detail().timelineSections.find((item) => item.type === 'diff');
  validateLogicalDetailSection(section);
  assert.ok(section.text.length < 33_000);
  assert.match(section.text, /omitted; see raw refs/);
});
