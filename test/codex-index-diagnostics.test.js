'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { createServer } = require('../server');
const { disposeProjectQueryStore } = require('../src/project-query-store');

async function fixture(t, healthy = true) {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-index-diagnostics-'));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionsRoot = path.join(codexHome, 'sessions');
  await fs.mkdir(repoRoot);
  await fs.mkdir(sessionsRoot);
  if (healthy) {
    const records = [
      { type: 'session_meta', payload: { id: 'synthetic-diagnostics', cwd: repoRoot } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Healthy synthetic history' } },
    ];
    await fs.writeFile(path.join(sessionsRoot, 'healthy.jsonl'), `${records.map(JSON.stringify).join('\n')}\n`);
  }
  const broken = path.join(sessionsRoot, 'broken.jsonl.zst');
  await fs.writeFile(broken, 'invalid synthetic compressed artifact');
  return { codexHome, repoRoot, broken };
}

function assertDiagnostic(summary, count = 1) {
  assert.ok(summary, 'the Index must retain its own diagnostics without a caller callback');
  assert.equal(summary.totalCount, count);
  assert.equal(summary.counts.CODEX_ROLLOUT_STORAGE_INVALID || 0, count);
  assert.equal(summary.samples.length, count);
  assert.equal(summary.truncatedCount, 0);
}

for (const builder of [codex.buildIndex, codex.buildSourceBackedIndex]) {
  for (const healthy of [true, false]) {
    test(`${builder.name} retains diagnostics with ${healthy ? 'mixed' : 'all-unreadable'} artifacts`, async t => {
      const f = await fixture(t, healthy);
      const index = await builder(f);
      t.after(() => disposeProjectQueryStore(index.projectQueryStore));
      assert.equal(index.sessions.length, Number(healthy));
      assertDiagnostic(index.sourceDiagnostics);
      assert.equal(index.sourceDiagnostics.samples[0].path, f.broken);
    });
  }
}

test('Codex reused query storage receives fresh bounded diagnostics without mutating the previous Index', async t => {
  const f = await fixture(t);
  const reports = [];
  const first = await codex.buildSourceBackedIndex({ ...f, onDiagnostic: d => reports.push(d) });
  t.after(() => disposeProjectQueryStore(first.projectQueryStore));
  assertDiagnostic(first.sourceDiagnostics);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].code, first.sourceDiagnostics.samples[0].code);
  const previousSummary = structuredClone(first.sourceDiagnostics);
  await fs.unlink(f.broken);
  const clean = await codex.buildSourceBackedIndex({ ...f, previousIndex: first });
  assert.equal(clean.projectQueryStore, first.projectQueryStore);
  assertDiagnostic(clean.sourceDiagnostics, 0);
  assert.deepEqual(first.sourceDiagnostics, previousSummary);

  for (let i = 0; i < 23; i += 1) await fs.writeFile(`${f.broken}.${i}.jsonl.zst`, 'invalid frame');
  const damaged = await codex.buildSourceBackedIndex({ ...f, previousIndex: clean });
  assert.equal(damaged.projectQueryStore, clean.projectQueryStore);
  assert.equal(damaged.sourceDiagnostics.totalCount, 23);
  assert.equal(damaged.sourceDiagnostics.counts.CODEX_ROLLOUT_STORAGE_INVALID, 23);
  assert.equal(damaged.sourceDiagnostics.samples.length, 20);
  assert.equal(damaged.sourceDiagnostics.truncatedCount, 3);
  assertDiagnostic(clean.sourceDiagnostics, 0);
});

test('Codex project settlement and app state expose skipped-artifact diagnostics while healthy history remains readable', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  let settle;
  const finished = new Promise(resolve => { settle = resolve; });
  const server = createServer(null, 0, {
    codexHome: f.codexHome, sessionPrewarm: false, onProjectJobSettled: settle,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/project`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoRoot: f.repoRoot }),
  });
  assert.equal(response.status, 202);
  const started = await response.json();
  const settled = await finished;
  assert.equal(settled.status, 'succeeded');
  assertDiagnostic(settled.sourceDiagnostics);
  const status = await (await fetch(`${base}/api/project/status?jobId=${started.job.id}`)).json();
  assert.equal(status.job.status, 'succeeded');
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.totals.sessionCount, 1);
  assert.deepEqual(state.sourceDiagnostics, settled.sourceDiagnostics);
  const timeline = await (await fetch(`${base}/api/sessions/synthetic-diagnostics/timeline?layer=main`)).json();
  assert.ok(timeline.events.some(event => event.preview === 'Healthy synthetic history'));
});
