'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { buildWorkbuddyIndex, workbuddyAdapter } = require('../src/workbuddy');
const { readDesktopOrigins, validOrigin } = require('../src/workbuddy-desktop-origin');
const { materializeSessionForIndex, validateIndexOwnershipForCommit, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeIndexResources } = require('../src/index-resources');
const { validateLogicalDetailEnvelope, validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');
const { createHistoryService } = require('../src/history-service');
async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-origin-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project'); const dir = path.join(home, 'projects', 'synthetic');
  await fs.mkdir(repo); await fs.mkdir(dir, { recursive: true });
  const lines = [
    { type: 'message', id: 'initial', role: 'user', content: [{ type: 'input_text', text: 'AUTOMATIC_INPUT_MARKER' }], providerData: { startsNewUserRequest: true } },
    { type: 'message', id: 'answer', role: 'assistant', content: [{ type: 'output_text', text: 'AUTOMATIC_RESULT' }] },
    { type: 'message', id: 'followup', role: 'user', content: [{ type: 'input_text', text: 'HUMAN_FOLLOWUP' }], providerData: { startsNewUserRequest: true } },
  ].map(row => JSON.stringify({ timestamp: 1794300000000, sessionId: 'scheduled', cwd: repo, ...row }));
  const file = path.join(dir, 'scheduled.jsonl'); await fs.writeFile(file, lines.join('\n') + '\n');
  const dbFile = path.join(home, 'workbuddy.db');
  if (!options.absent) {
    const db = new DatabaseSync(dbFile);
    try {
      db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY, cwd TEXT, is_background_automation INTEGER, session_settings TEXT); CREATE TABLE automation_runs(thread_id TEXT PRIMARY KEY, automation_id TEXT, source_cwd TEXT, metadata_json TEXT)');
      const settings = options.settings ?? JSON.stringify({ conversationTags: { automationId: 'automation-1' } });
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('scheduled', options.sessionCwd || repo, options.flag ?? 1, settings);
      const insert = db.prepare('INSERT INTO automation_runs VALUES (?, ?, ?, ?)');
      const meta = { sessionId: 'scheduled', conversationId: 'scheduled', runKind: 'scheduled', ...options.meta };
      insert.run('run-1', options.automationId || 'automation-1', options.runCwd || repo, JSON.stringify(meta));
      if (options.ambiguous) insert.run('run-2', 'automation-1', repo, JSON.stringify(meta));
    } finally { db.close(); }
  }
  return { home, repo, file, dbFile, lines };
}
async function indexFor(t, f) {
  const index = await buildWorkbuddyIndex({ sourceHome: f.home, repoRoot: f.repo });
  t.after(() => disposeIndexResources(index)); await validateIndexOwnershipForCommit(index); return index;
}
async function addIndependentScheduledSession(f) {
  const sessionId = 'a-other'; const automationId = 'other-automation';
  const rows = f.lines.map((line) => JSON.stringify({ ...JSON.parse(line), sessionId }));
  await fs.writeFile(path.join(path.dirname(f.file), sessionId + '.jsonl'), rows.join('\n') + '\n');
  const db = new DatabaseSync(f.dbFile);
  try {
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(sessionId, f.repo, 1,
      JSON.stringify({ conversationTags: { automationId } }));
    db.prepare('INSERT INTO automation_runs VALUES (?, ?, ?, ?)').run('other-run', automationId, f.repo,
      JSON.stringify({ sessionId, conversationId: sessionId, runKind: 'scheduled' }));
  } finally { db.close(); }
}

test('desktop scheduled origin excludes only initial input and preserves query, detail and exact JSONL Raw', async (t) => {
  const f = await fixture(t); const dbBefore = await fs.readFile(f.dbFile);
  const index = await indexFor(t, f); const indexed = index.sessions[0];
  assert.equal(index.sourceDiagnostics.totalCount, 0);
  assert.equal(indexed.counts.userMessages, 1); assert.equal(indexed.counts.turns, 1); assert.equal(indexed.title, 'HUMAN_FOLLOWUP');
  const session = await materializeSessionForIndex(index, indexed);
  const event = session.logicalEvents.find(e => e.subtype === 'workbuddy_scheduled_input');
  assert.equal(event.kind, 'protocol'); assert.equal(event.layer, 'protocol'); assert.equal(event.role, 'user');
  assert.equal(session.rawEvents[0].turnId, ''); assert.equal(session.rawEvents[2].turnId, 'followup');
  const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
  validateStructuredLogicalDetailDto(detail); validateLogicalDetailEnvelope(detail, event);
  assert.match(JSON.stringify(detail.timelineSections), /AUTOMATIC_INPUT_MARKER/);
  assert.match(JSON.stringify(detail.inspectorSections), /workbuddy.db: sessions \+ automation_runs.*copied_value.*automation-1.*run-1/);
  const chinese = await buildEventDetailForSession(index, session, event.id, event.layer, { locale: 'zh-CN' });
  assert.equal(chinese.title, '定时自动化输入');
  assert.match(JSON.stringify(chinese.timelineSections), /不计为用户消息或新回合/);
  assert.match(JSON.stringify(chinese.inspectorSections), /已记录的自动化来源.*automation-1.*run-1/);
  const timeline = workbuddyAdapter.query.getTimeline(index, session, { layer: 'protocol', locale: 'zh-CN' });
  const localizedEvent = timeline.events.find((item) => item.subtype === 'workbuddy_scheduled_input');
  assert.equal(localizedEvent.label, '定时自动化输入');
  assert.equal(localizedEvent.preview, 'AUTOMATIC_INPUT_MARKER');
  assert.equal(timeline.eventKinds.protocol.find((item) => item.value === 'workbuddy_scheduled_input').label, '定时自动化输入');
  assert.equal((await readIndexedRawRecord(index, session, event.rawRefs[0].rawId)).raw, f.lines[0]);
  const service = await createHistoryService({ source: 'workbuddy', workbuddyHome: f.home, repo: f.repo });
  t.after(() => service.close());
  assert.equal((await service.execute('search', { query: 'AUTOMATIC_INPUT_MARKER', layer: 'protocol' })).items.length, 1);
  assert.equal((await service.execute('search', { query: 'AUTOMATIC_INPUT_MARKER', kind: 'user_message' })).items.length, 0);
  assert.deepEqual(await fs.readFile(f.dbFile), dbBefore);
});

test('copied desktop origin replays the accepted index even when live metadata is edited or removed', async (t) => {
  const f = await fixture(t); const index = await indexFor(t, f);
  const db = new DatabaseSync(f.dbFile); db.exec('UPDATE sessions SET is_background_automation=0'); db.close();
  const old = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(old.counts.userMessages, 1);
  const rebuilt = await indexFor(t, f); assert.equal(rebuilt.sessions[0].counts.userMessages, 2);
  await fs.unlink(f.dbFile);
  const replay = await materializeSessionForIndex(index, index.sessions[0]); assert.equal(replay.counts.userMessages, 1);
  const event = replay.logicalEvents.find(e => e.subtype === 'workbuddy_scheduled_input');
  await buildEventDetailForSession(index, replay, event.id, event.layer);
});

test('missing, ambiguous, mismatched and malformed desktop provenance never creates scheduled identity', async (t) => {
  for (const options of [{ absent: true }, { flag: 0 }, { flag: 'true' }, { ambiguous: true },
    { settings: '{broken' }, { sessionCwd: '/different' }, { runCwd: '/different' },
    { automationId: 'other' }, { meta: { conversationId: 'other' } }, { meta: { runKind: 'manual' } }]) {
    const f = await fixture(t, options); const index = await indexFor(t, f);
    assert.equal(index.sessions[0].counts.userMessages, 2);
    const session = await materializeSessionForIndex(index, index.sessions[0]);
    assert.ok(session.logicalEvents.every(e => e.subtype !== 'workbuddy_scheduled_input'));
  }
});

async function assertCwdScenarios(t, scenarios) {
  const script = `
    const { buildWorkbuddyIndex } = require(process.argv[1]);
    const { validateIndexOwnershipForCommit, materializeSessionForIndex, readIndexedRawRecord } = require(process.argv[2]);
    const { disposeIndexResources } = require(process.argv[3]);
    (async () => {
      const index = await buildWorkbuddyIndex({ sourceHome: process.argv[4], repoRoot: process.argv[5] });
      try {
        await validateIndexOwnershipForCommit(index);
        if (index.sessions.length === 0) {
          process.stdout.write(JSON.stringify({ sessionCount: 0, diagnostics: index.sourceDiagnostics.counts }));
          return;
        }
        const session = await materializeSessionForIndex(index, index.sessions[0]);
        const first = session.logicalEvents.find((event) => event.source.line === 1
          && (event.kind === 'user_message' || event.subtype === 'workbuddy_scheduled_input'));
        if (!first) throw new Error('Initial input is missing');
        const raw = await readIndexedRawRecord(index, session, first.rawRefs[0].rawId);
        process.stdout.write(JSON.stringify({
          userMessages: session.counts.userMessages, turns: session.counts.turns, title: session.title,
          first: { kind: first.kind, layer: first.layer, subtype: first.subtype, turnId: first.turnId },
          diagnostics: index.sourceDiagnostics.counts, raw: raw.raw,
        }));
      } finally { await disposeIndexResources(index); }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  for (const options of scenarios) {
    const f = await fixture(t, options);
    if (options.rootRelativeRun || options.rootRelativeSession || options.rootRelativeTranscript) {
      const rootRelative = f.repo.replace(/^[A-Za-z]:/, '');
      assert.notEqual(rootRelative, f.repo, 'Windows fixture must use a drive-qualified path');
      if (options.rootRelativeTranscript) {
        f.lines = f.lines.map((line) => JSON.stringify({ ...JSON.parse(line), cwd: rootRelative }));
        await fs.writeFile(f.file, f.lines.join('\n') + '\n');
      } else {
        const db = new DatabaseSync(f.dbFile);
        try {
          db.prepare(options.rootRelativeRun ? 'UPDATE automation_runs SET source_cwd = ?' : 'UPDATE sessions SET cwd = ?').run(rootRelative);
        } finally { db.close(); }
      }
    }
    const beforeDb = await fs.readFile(f.dbFile); const beforeJsonl = await fs.readFile(f.file);
    const results = [f.repo, f.home].map((cwd) => {
      const child = spawnSync(process.execPath, ['--no-warnings', '-e', script,
        require.resolve('../src/workbuddy'), require.resolve('../src/source-adapters'),
        require.resolve('../src/index-resources'), f.home, f.repo], { cwd, encoding: 'utf8', timeout: 15000 });
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    });
    const automatic = Object.keys(options).length === 0;
    // Root-relative transcript cwd has no stable project meaning. Unlike a
    // rejected DB origin, it must not borrow the child's current drive/cwd.
    const expected = options.rootRelativeTranscript ? {
      sessionCount: 0, diagnostics: { PROJECT_PATH_UNSUPPORTED: 1 },
    } : {
      userMessages: automatic ? 1 : 2, turns: automatic ? 1 : 2,
      title: automatic ? 'HUMAN_FOLLOWUP' : 'AUTOMATIC_INPUT_MARKER',
      first: automatic
        ? { kind: 'protocol', layer: 'protocol', subtype: 'workbuddy_scheduled_input', turnId: '' }
        : { kind: 'user_message', layer: 'main', subtype: '', turnId: 'initial' },
      diagnostics: automatic ? {} : { WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED: 1 }, raw: f.lines[0],
    };
    for (const result of results) assert.deepEqual(result, expected, JSON.stringify(options));
    assert.deepEqual(await fs.readFile(f.dbFile), beforeDb);
    assert.deepEqual(await fs.readFile(f.file), beforeJsonl);
  }
}

test('desktop run working directories require absolute evidence independent of process cwd', async (t) => {
  await assertCwdScenarios(t, [{ runCwd: '.' }, { runCwd: path.join('..', 'project') }, { runCwd: 'C:project' },
    { sessionCwd: '.' }, { sessionCwd: path.join('..', 'project') }, { sessionCwd: 'C:project' }, {}]);
});

test('Windows root-relative desktop paths do not establish origin', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows path and working-drive behavior');
  if (!/^[A-Za-z]:[\\/]/.test(os.tmpdir())) return t.skip('A drive-qualified temporary directory is required');
  await assertCwdScenarios(t, [{ rootRelativeRun: true }, { rootRelativeSession: true }, { rootRelativeTranscript: true }]);
});

test('desktop origin paths must be fully qualified across path flavors', () => {
  for (const [cwd, accepted] of [['/synthetic/project', true], ['C:\\project', true],
    ['\\\\server\\share\\project', true], ['C:project', false], ['\\project', false],
    ['\\\\server', false], ['//server', false], ['///server/share', false]]) {
    const origin = { sessionId: 'scheduled', cwd, automationId: 'automation-1', runId: 'run-1', runKind: 'scheduled' };
    assert.equal(Boolean(validOrigin(origin, 'scheduled', cwd)), accepted, cwd);
  }
  const origin = { sessionId: 'scheduled', cwd: 'C:\\project', automationId: 'automation-1', runId: 'run-1', runKind: 'scheduled' };
  assert.equal(Boolean(validOrigin(origin, 'scheduled', '\\project')), false, 'recorded JSONL cwd must also be fully qualified');
  const unc = { ...origin, cwd: '//server/share/project' };
  assert.equal(Boolean(validOrigin(unc, 'scheduled', '\\\\SERVER\\SHARE\\project')), true);
  assert.equal(Boolean(validOrigin(unc, 'scheduled', '/server/share/project')), false);
  assert.equal(Boolean(validOrigin({ ...origin, cwd: '/server/share/project' }, 'scheduled', unc.cwd)), false);
});

test('desktop origin matches UNC spellings without conflating POSIX paths', async (t) => {
  const f = await fixture(t);
  const forward = '//server/share/project'; const backslash = '\\\\SERVER\\SHARE\\project';
  const posix = '/server/share/project'; const sourceFile = 'synthetic/scheduled.jsonl';
  for (const [candidateCwd, sessionCwd, runCwd, accepted] of [
    [forward, backslash, forward, true], [backslash, forward, backslash, true],
    [forward, forward, posix, false], [posix, posix, forward, false], [forward, posix, forward, false],
  ]) {
    const db = new DatabaseSync(f.dbFile);
    try {
      db.prepare('UPDATE sessions SET cwd = ?').run(sessionCwd);
      db.prepare('UPDATE automation_runs SET source_cwd = ?').run(runCwd);
    } finally { db.close(); }
    const diagnostics = [];
    const origins = await readDesktopOrigins(f.home, [{ sourceFile, header: { id: 'scheduled', cwd: candidateCwd } }],
      undefined, (diagnostic) => diagnostics.push(diagnostic));
    assert.equal(origins.has(sourceFile), accepted, JSON.stringify({ candidateCwd, sessionCwd, runCwd }));
    if (accepted) {
      assert.equal(origins.get(sourceFile).cwd, sessionCwd, 'preserve recorded cwd spelling');
      assert.deepEqual(diagnostics, []);
    } else assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.code), ['WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED']);
  }
});

test('UNC origin evidence survives indexing and materialization without matching POSIX lookalikes', async (t) => {
  const f = await fixture(t);
  const forward = '//server/share/project'; const backslash = '\\\\SERVER\\SHARE\\project';
  const lines = f.lines.map((line) => JSON.stringify({ ...JSON.parse(line), cwd: forward }));
  await fs.writeFile(f.file, lines.join('\n') + '\n');
  const db = new DatabaseSync(f.dbFile);
  try {
    db.prepare('UPDATE sessions SET cwd = ?').run(backslash);
    db.prepare('UPDATE automation_runs SET source_cwd = ?').run(forward);
  } finally { db.close(); }
  const index = await buildWorkbuddyIndex({ sourceHome: f.home, repoRoot: forward });
  t.after(() => disposeIndexResources(index)); await validateIndexOwnershipForCommit(index);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(session.counts.userMessages, 1);
  assert.deepEqual(index.sourceDiagnostics.counts, { PROJECT_PATH_LEGACY_ASSUMPTION: 1 });
  const event = session.logicalEvents.find((item) => item.subtype === 'workbuddy_scheduled_input');
  assert.ok(event);
  assert.equal((await readIndexedRawRecord(index, session, event.rawRefs[0].rawId)).raw, lines[0]);

  const changed = new DatabaseSync(f.dbFile);
  try { changed.prepare('UPDATE automation_runs SET source_cwd = ?').run('/server/share/project'); }
  finally { changed.close(); }
  const rebuilt = await buildWorkbuddyIndex({ sourceHome: f.home, repoRoot: forward });
  t.after(() => disposeIndexResources(rebuilt)); await validateIndexOwnershipForCommit(rebuilt);
  assert.equal(rebuilt.sessions[0].counts.userMessages, 2);
  assert.equal(rebuilt.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, 1);
});

test('recurring automation history does not hide its current scheduled run or other origins', async (t) => {
  const f = await fixture(t); await addIndependentScheduledSession(f);
  const db = new DatabaseSync(f.dbFile);
  try {
    const insert = db.prepare('INSERT INTO automation_runs VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 101; i++) {
      const sessionId = 'old-session-' + i;
      insert.run('old-run-' + i, 'automation-1', f.repo, JSON.stringify({ sessionId, conversationId: sessionId, runKind: 'scheduled' }));
    }
    insert.run('malformed-run', 'automation-1', f.repo, '{broken');
    insert.run('oversized-run', 'automation-1', f.repo, JSON.stringify({ padding: 'x'.repeat(16385) }));
  } finally { db.close(); }
  const index = await indexFor(t, f);
  assert.equal(index.sessions.length, 2);
  assert.equal(index.sourceDiagnostics.totalCount, 0);
  assert.ok(index.sessions.every((session) => session.counts.userMessages === 1 && session.counts.turns === 1));
  for (const indexed of index.sessions) {
    const session = await materializeSessionForIndex(index, indexed);
    assert.ok(session.logicalEvents.some((event) => event.subtype === 'workbuddy_scheduled_input'));
  }
});

test('an overflowing correlated run lookup preserves other verified scheduled origins', async (t) => {
  const f = await fixture(t); await addIndependentScheduledSession(f);
  const db = new DatabaseSync(f.dbFile);
  try {
    const insert = db.prepare('INSERT INTO automation_runs VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 101; i++) {
      insert.run('mismatched-run-' + i, 'automation-1', path.join(f.home, 'different'),
        JSON.stringify({ sessionId: 'scheduled', conversationId: 'scheduled', runKind: 'scheduled' }));
    }
  } finally { db.close(); }
  const index = await indexFor(t, f);
  const busy = index.sessions.find((session) => session.sourceSessionId === 'scheduled');
  const other = index.sessions.find((session) => session.sourceSessionId === 'a-other');
  assert.equal(busy.counts.userMessages, 2);
  assert.equal(other.counts.userMessages, 1);
  assert.equal(index.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, 1);
  assert.equal(index.sourceDiagnostics.totalCount, 1);
  const otherSession = await materializeSessionForIndex(index, other);
  assert.ok(otherSession.logicalEvents.some((event) => event.subtype === 'workbuddy_scheduled_input'));
});

test('invalid desktop session values do not discard other verified origins', async (t) => {
  const f = await fixture(t); await addIndependentScheduledSession(f);
  const db = new DatabaseSync(f.dbFile);
  try { db.exec("UPDATE sessions SET is_background_automation = 9223372036854775807 WHERE id = 'scheduled'"); }
  finally { db.close(); }
  const index = await indexFor(t, f);
  const invalid = index.sessions.find((session) => session.sourceSessionId === 'scheduled');
  const other = index.sessions.find((session) => session.sourceSessionId === 'a-other');
  assert.equal(invalid.counts.userMessages, 2);
  assert.equal(other.counts.userMessages, 1);
  assert.equal(index.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, 1);
  assert.equal(index.sourceDiagnostics.totalCount, 1);
});

test('desktop candidate and run scans yield so cancellation stops the scan', async (t) => {
  for (const phase of ['candidates', 'runs']) {
    const f = await fixture(t);
    if (phase === 'runs') {
      const db = new DatabaseSync(f.dbFile);
      try {
        db.exec('BEGIN');
        const insert = db.prepare('INSERT INTO automation_runs VALUES (?, ?, ?, ?)');
        for (let i = 0; i < 600; i++) {
          const sessionId = 'old-' + i;
          insert.run('old-' + i, 'automation-1', f.repo, JSON.stringify({ sessionId, conversationId: sessionId, runKind: 'scheduled' }));
        }
        db.exec('COMMIT');
      } finally { db.close(); }
    }
    const ids = phase === 'candidates' ? Array.from({ length: 600 }, (_, i) => 'absent-' + i) : ['scheduled'];
    const candidates = ids.map((id) => ({ sourceFile: `synthetic/${id}.jsonl`, header: { id, cwd: f.repo } }));
    const controller = new AbortController(); let checks = 0;
    const signal = { throwIfAborted() {
      if (++checks === 40) setImmediate(() => controller.abort());
      controller.signal.throwIfAborted();
    } };
    const diagnostics = [];
    await assert.rejects(readDesktopOrigins(f.home, candidates, signal, (diagnostic) => diagnostics.push(diagnostic)), { name: 'AbortError' }, phase);
    assert.ok(checks < 300, phase + ' should stop before exhausting the scan');
    assert.deepEqual(diagnostics, []);
  }
});

test('corrupt desktop databases produce diagnostics without breaking standalone JSONL reading', async (t) => {
  const f = await fixture(t, { absent: true });
  await fs.writeFile(f.dbFile, 'not a database');
  const index = await indexFor(t, f); assert.equal(index.sessions[0].counts.userMessages, 2);
  assert.equal(index.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNAVAILABLE, 1);
});

test('symlink desktop databases produce diagnostics without breaking standalone JSONL reading', async (t) => {
  const f = await fixture(t, { absent: true });
  const target = path.join(f.home, 'untrusted.db'); await fs.writeFile(target, 'not a database');
  try { await fs.symlink(target, f.dbFile); } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Native file symlinks unavailable: ' + error.code);
    throw error;
  }
  const index = await indexFor(t, f); assert.equal(index.sessions[0].counts.userMessages, 2);
  assert.equal(index.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNAVAILABLE, 1);
});

test('a forged copied origin is rejected by the materialization descriptor validator', async (t) => {
  const f = await fixture(t); const index = await indexFor(t, f); const indexed = index.sessions[0];
  const dependency = index.materializationDependencies.get(indexed.materializationDescriptor.dependencySetId);
  dependency.entries[1].evidence.origin.sessionId = 'another-session';
  await assert.rejects(validateIndexOwnershipForCommit(index));
});

test('duplicate physical session names cannot borrow a unique desktop origin', async (t) => {
  const f = await fixture(t); const other = path.join(f.home, 'projects', 'another-container');
  await fs.mkdir(other); await fs.copyFile(f.file, path.join(other, 'scheduled.jsonl'));
  const index = await indexFor(t, f); assert.equal(index.sessions.length, 2);
  assert.ok(index.sessions.every(s => s.counts.userMessages === 2));
  assert.equal(index.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, 2);
});

test('duplicate main-session names outside the selected project cannot establish desktop origin', async (t) => {
  for (const malformed of [false, true]) {
    const f = await fixture(t); const otherRepo = path.join(f.home, 'other-project');
    const other = path.join(f.home, 'projects', 'another-container');
    await fs.mkdir(otherRepo); await fs.mkdir(other);
    const duplicate = f.lines.map((line) => JSON.stringify({ ...JSON.parse(line), cwd: otherRepo }));
    await fs.writeFile(path.join(other, 'scheduled.jsonl'), malformed ? '{broken\n' : duplicate.join('\n') + '\n');
    const index = await indexFor(t, f);
    assert.equal(index.sessions.length, 1);
    assert.equal(index.sessions[0].counts.userMessages, 2);
    assert.equal(index.sessions[0].counts.turns, 2);
    assert.equal(index.sessions[0].title, 'AUTOMATIC_INPUT_MARKER');
    assert.equal(index.sourceDiagnostics.counts.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, 1);
    const session = await materializeSessionForIndex(index, index.sessions[0]);
    assert.ok(session.logicalEvents.every((event) => event.subtype !== 'workbuddy_scheduled_input'));
    const first = session.logicalEvents.find((event) => event.kind === 'user_message');
    assert.equal((await readIndexedRawRecord(index, session, first.rawRefs[0].rawId)).raw, f.lines[0]);
  }
});

test('a same-named subagent does not make the main desktop session ambiguous', async (t) => {
  const f = await fixture(t); const otherRepo = path.join(f.home, 'other-project');
  const children = path.join(f.home, 'projects', 'synthetic', 'scheduled', 'subagents');
  await fs.mkdir(otherRepo); await fs.mkdir(children, { recursive: true });
  const child = f.lines.map((line) => JSON.stringify({ ...JSON.parse(line), cwd: otherRepo }));
  await fs.writeFile(path.join(children, 'scheduled.jsonl'), child.join('\n') + '\n');
  const index = await indexFor(t, f);
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessions[0].counts.userMessages, 1);
  assert.equal(index.sourceDiagnostics.totalCount, 0);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  assert.ok(session.logicalEvents.some((event) => event.subtype === 'workbuddy_scheduled_input'));
});

function indexWithUnreadableDirectory(f, unreadable) {
  const script = `
    const fs = require('node:fs/promises');
    const readdir = fs.readdir;
    fs.readdir = async (directory, ...options) => {
      if (directory === process.argv[6]) {
        const error = new Error('Synthetic unreadable directory'); error.code = 'EACCES'; throw error;
      }
      return readdir(directory, ...options);
    };
    const { buildWorkbuddyIndex } = require(process.argv[1]);
    const { validateIndexOwnershipForCommit, materializeSessionForIndex } = require(process.argv[2]);
    const { disposeIndexResources } = require(process.argv[3]);
    (async () => {
      const index = await buildWorkbuddyIndex({ sourceHome: process.argv[4], repoRoot: process.argv[5] });
      try {
        await validateIndexOwnershipForCommit(index);
        if (index.sessions.length !== 1) throw new Error('Expected one selected Session');
        const session = await materializeSessionForIndex(index, index.sessions[0]);
        process.stdout.write(JSON.stringify({ counts: session.counts, title: session.title,
          diagnostics: index.sourceDiagnostics.counts,
          scheduled: session.logicalEvents.some((event) => event.subtype === 'workbuddy_scheduled_input') }));
      } finally { await disposeIndexResources(index); }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const child = spawnSync(process.execPath, ['--no-warnings', '-e', script,
    require.resolve('../src/workbuddy'), require.resolve('../src/source-adapters'), require.resolve('../src/index-resources'),
    f.home, f.repo, unreadable], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('an unreadable project container leaves desktop origin unverified', async (t) => {
  const f = await fixture(t); const otherRepo = path.join(f.home, 'other-project');
  const other = path.join(f.home, 'projects', 'unreadable-container');
  await fs.mkdir(otherRepo); await fs.mkdir(other);
  const duplicate = f.lines.map((line) => JSON.stringify({ ...JSON.parse(line), cwd: otherRepo }));
  await fs.writeFile(path.join(other, 'scheduled.jsonl'), duplicate.join('\n') + '\n');
  const result = indexWithUnreadableDirectory(f, other);
  assert.equal(result.counts.userMessages, 2);
  assert.equal(result.counts.turns, 2);
  assert.equal(result.title, 'AUTOMATIC_INPUT_MARKER');
  assert.equal(result.scheduled, false);
  assert.equal(result.diagnostics.SOURCE_ARTIFACT_UNREADABLE, 1);
  assert.equal(result.diagnostics.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, 1);
});

test('an unreadable subagent directory does not invalidate main-session name evidence', async (t) => {
  const f = await fixture(t); const children = path.join(f.home, 'projects', 'synthetic', 'scheduled', 'subagents');
  await fs.mkdir(children, { recursive: true });
  const result = indexWithUnreadableDirectory(f, children);
  assert.equal(result.counts.userMessages, 1);
  assert.equal(result.scheduled, true);
  assert.equal(result.diagnostics.SOURCE_ARTIFACT_UNREADABLE, 1);
  assert.equal(result.diagnostics.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, undefined);
});

test('desktop origin requires stable main-session directories through database capture', async (t) => {
  for (const mode of ['duplicate', 'unrelated', 'unreadable', 'aba', 'unchanged']) {
    const f = await fixture(t, { flag: 0 });
    const other = path.join(f.home, 'projects', 'another-container'); await fs.mkdir(other);
    const script = `
      const fs = require('node:fs/promises'); const path = require('node:path');
      const { DatabaseSync } = require('node:sqlite');
      const storage = require(process.argv[1]);
      const snapshot = storage.readWorkbuddySnapshot; const stat = fs.stat;
      let changed = false; let removed = false;
      fs.stat = async (directory, ...options) => {
        if (changed && process.argv[8] === 'unreadable' && directory === process.argv[6]) {
          const error = new Error('Synthetic unreadable directory'); error.code = 'EACCES'; throw error;
        }
        if (changed && !removed && process.argv[8] === 'aba' && directory === process.argv[6]) {
          removed = true;
          await fs.rm(path.join(directory, 'scheduled.jsonl'));
          await fs.utimes(directory, new Date(0), new Date(0));
        }
        return stat(directory, ...options);
      };
      storage.readWorkbuddySnapshot = async (...args) => {
        const result = await snapshot(...args);
        if (!changed) {
          changed = true;
          const name = ['duplicate', 'aba'].includes(process.argv[8]) ? 'scheduled.jsonl' : 'unrelated.jsonl';
          if (process.argv[8] !== 'unchanged') await fs.copyFile(process.argv[7], path.join(process.argv[6], name));
          const db = new DatabaseSync(path.join(process.argv[4], 'workbuddy.db'));
          try { db.exec('UPDATE sessions SET is_background_automation=1'); } finally { db.close(); }
        }
        return result;
      };
      const { buildWorkbuddyIndex } = require(process.argv[2]);
      const { validateIndexOwnershipForCommit, materializeSessionForIndex } = require(process.argv[3]);
      const { disposeIndexResources } = require(process.argv[9]);
      (async () => {
        const index = await buildWorkbuddyIndex({ sourceHome: process.argv[4], repoRoot: process.argv[5] });
        try {
          await validateIndexOwnershipForCommit(index);
          if (index.sessions.length !== 1) throw new Error('Expected the original discovery snapshot');
          const session = await materializeSessionForIndex(index, index.sessions[0]);
          process.stdout.write(JSON.stringify({ userMessages: session.counts.userMessages,
            scheduled: session.logicalEvents.some((event) => event.subtype === 'workbuddy_scheduled_input'),
            diagnostics: index.sourceDiagnostics.counts }));
        } finally { await disposeIndexResources(index); }
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `;
    const child = spawnSync(process.execPath, ['--no-warnings', '-e', script,
      require.resolve('../src/workbuddy-storage'), require.resolve('../src/workbuddy'), require.resolve('../src/source-adapters'),
      f.home, f.repo, other, f.file, mode, require.resolve('../src/index-resources')], { encoding: 'utf8', timeout: 15000 });
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout); const accepted = mode === 'unchanged';
    assert.equal(result.userMessages, accepted ? 1 : 2, mode);
    assert.equal(result.scheduled, accepted, mode);
    assert.equal(result.diagnostics.WORKBUDDY_DESKTOP_ORIGIN_UNVERIFIED, accepted ? undefined : 1, mode);
    if (mode === 'unreadable') assert.equal(result.diagnostics.SOURCE_ARTIFACT_UNREADABLE, 1);
  }
});

test('a leading protocol user record does not transfer scheduled identity to later input', async (t) => {
  for (const providerData of [{ skipRun: true }, { scheduledTaskTrigger: { taskId: 'synthetic' } }]) {
    const f = await fixture(t);
    const first = JSON.stringify({ type: 'message', id: 'internal', role: 'user', sessionId: 'scheduled', cwd: f.repo,
      content: [{ type: 'input_text', text: 'INTERNAL_PREFIX' }], providerData });
    await fs.writeFile(f.file, [first, ...f.lines].join('\n') + '\n');
    const index = await indexFor(t, f); const session = await materializeSessionForIndex(index, index.sessions[0]);
    assert.equal(session.counts.userMessages, 2);
    assert.equal(session.counts.turns, 2);
    assert.equal(session.title, 'AUTOMATIC_INPUT_MARKER');
    assert.ok(session.logicalEvents.every((event) => event.subtype !== 'workbuddy_scheduled_input'));
    assert.ok(session.logicalEvents.some((event) => event.layer === 'protocol' && event.searchText.includes('INTERNAL_PREFIX')));
    assert.equal(index.sourceDiagnostics.totalCount, 0);
  }
});

test('a conflicting first record sessionId cannot acquire scheduled identity', async (t) => {
  for (const conflicting of ['foreign-session', '', null, 42]) {
    const f = await fixture(t);
    const first = JSON.stringify({ ...JSON.parse(f.lines[0]), sessionId: conflicting });
    await fs.writeFile(f.file, [first, ...f.lines.slice(1)].join('\n') + '\n');
    const index = await indexFor(t, f); const session = await materializeSessionForIndex(index, index.sessions[0]);
    assert.equal(session.counts.userMessages, 2, JSON.stringify(conflicting));
    assert.equal(session.counts.turns, 2);
    assert.equal(session.title, 'AUTOMATIC_INPUT_MARKER');
    assert.ok(session.logicalEvents.every((event) => event.subtype !== 'workbuddy_scheduled_input'));
    const event = session.logicalEvents.find((item) => item.kind === 'user_message');
    assert.equal((await readIndexedRawRecord(index, session, event.rawRefs[0].rawId)).raw, first);
  }
  const f = await fixture(t);
  const record = JSON.parse(f.lines[0]); delete record.sessionId;
  await fs.writeFile(f.file, [JSON.stringify(record), ...f.lines.slice(1)].join('\n') + '\n');
  const index = await indexFor(t, f); const session = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(session.counts.userMessages, 1, 'a missing optional sessionId remains supported');
  assert.ok(session.logicalEvents.some((event) => event.subtype === 'workbuddy_scheduled_input'));
});

test('WAL capture preserves committed WAL evidence without creating or changing source side files', async (t) => {
  for (const live of [false, true]) {
    const f = await fixture(t, { flag: 0 }); const writer = new DatabaseSync(f.dbFile);
    let writerOpen = true;
    try {
      writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE sessions SET is_background_automation=1');
      if (!live) { writer.close(); writerOpen = false; }
      const namesBefore = (await fs.readdir(f.home)).sort();
      const captured = new Map();
      for (const name of namesBefore.filter(n => n.startsWith('workbuddy.db'))) captured.set(name, await fs.readFile(path.join(f.home, name)));
      const index = await indexFor(t, f);
      assert.equal(index.sourceDiagnostics.totalCount, 0);
      assert.equal(index.sessions[0].counts.userMessages, 1, 'committed WAL metadata is included');
      assert.deepEqual((await fs.readdir(f.home)).sort(), namesBefore, 'source directory members are unchanged');
      for (const [name, bytes] of captured) assert.deepEqual(await fs.readFile(path.join(f.home, name)), bytes, name);
    } finally {
      if (writerOpen) writer.close();
    }
  }
});
