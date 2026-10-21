'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const { buildDeepSeekIndex, deepSeekAdapter, readDeepSeekRawRecord } = require('../src/deepseek-harness');
const { buildEventDetailForSession, materializeSessionForIndex } = require('../src/source-adapters');
const { projectQueryProjectionDigestAsync } = require('../src/project-query-store');
const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');

// Minimized synthetic writer shapes from DSH 0.2.1-rc.2, 687f282e8625c6b8d11ff58211a90524be2e4317:
// core/session/src/types.ts, core/tools/src/{types,ptc}.ts,
// shell/tool-{bash,pwsh}/src/index.ts, fs/tool-fs/src/{read,write,edit,read-image}.ts.
const call = (id, name, args) => ({ type: 'tool/call', data: {
  turn: 1, step: 1, callId: id, name, arguments: JSON.stringify(args),
} });
const result = (id, meta) => ({ type: 'tool/result', surfaceOp: 'append', data: {
  turn: 1, step: 1,
  message: { id: `result-${id}`, role: 'tool', source: { kind: 'tool', callId: id }, toolCallId: id,
    isError: false, content: [{ type: 'text', text: 'synthetic output' }] },
  ...(meta === undefined ? {} : { meta }),
} });
const nested = (id, name, args, meta) => {
  const data = { rootCallId: 'outer', parentCallId: 'outer', subCallId: id, name, arguments: args };
  return [
    { type: 'tool/ptc-dispatch-start', data },
    { type: 'tool/ptc-dispatch', data: { ...data, isError: false,
      content: [{ type: 'text', text: 'synthetic output' }], ...(meta === undefined ? {} : { meta }) } },
  ];
};

async function fixture(t, records, compressed = false) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sa-dsh-operation-meta-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sourceHome = path.join(root, 'sessions');
  const directory = path.join(sourceHome, 'synthetic', 'operation-metadata');
  await fsp.mkdir(directory, { recursive: true });
  const header = { type: 'session', version: 4, id: 'operation-metadata', createdAt: 1,
    cwd: root, isSeeded: false, delegationDepth: 0 };
  const rows = [header, ...records.map((record, seq) => ({ seq, time: 1000 + seq, ...record }))];
  const lines = rows.map(row => JSON.stringify(row) + '\n');
  const file = path.join(directory, 'session.v4.jsonl' + (compressed ? '.zstd' : ''));
  await fsp.writeFile(file, compressed
    ? Buffer.concat(lines.map(line => zstdCompressSync(Buffer.from(line)))) : lines.join(''));
  const before = await fsp.readFile(file);
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot: root });
  assert.equal(index.sourceDiagnostics.totalCount, 0, JSON.stringify(index.sourceDiagnostics));
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  const session = await materializeSessionForIndex(index, indexed);
  assert.deepEqual(indexed.counts, session.counts);
  assert.equal(await projectQueryProjectionDigestAsync(session, deepSeekAdapter.query.projectQueryPresentation), indexed.queryProjectionDigest);
  const detail = async (id, locale = 'en') => {
    const event = session.logicalEvents.find(event => event.id.endsWith(`:${id}`));
    assert.ok(event, `missing operation ${id}`);
    const value = await buildEventDetailForSession(index, session, event.id, event.layer, { locale });
    validateStructuredLogicalDetailDto(value);
    assert.deepEqual(value.rawRefs, event.rawRefs);
    return value;
  };
  const exactRaw = async () => {
    for (const raw of session.rawEvents) {
      assert.equal((await readDeepSeekRawRecord(index, session, raw)).raw, JSON.stringify(rows[raw.sourceLocator.recordOrdinal]));
    }
    assert.deepEqual(await fsp.readFile(file), before);
  };
  return { index, indexed, session, detail, exactRaw };
}

const provenance = detail => detail.inspectorSections.find(section => section.title === 'Recorded operation metadata'
  || section.title === '已记录的操作元数据');
const fallback = detail => detail.inspectorSections.find(section => section.title === 'Other operation metadata'
  || section.title === '其他操作元数据');

for (const compressed of [false, true]) {
  test(`current writer operation metadata uses exact direct/PTC ownership in both locales (compressed=${compressed})`, async t => {
    const cases = [
      ['shell-bash', 'bash', { command: 'pwd' }, { cwd: '/recorded/command-directory' }, 'Working directory', '/recorded/command-directory'],
      ['shell-pwsh', 'pwsh', { command: 'Get-Location', workdir: 'relative-request' }, { cwd: 'C:\\recorded\\directory' }, 'Working directory', 'C:\\recorded\\directory'],
      ['file-read', 'read', { file_path: 'relative.txt' }, { path: '/recorded/read.txt', offset: 1, lines: [{ number: 1, text: 'retained line' }], totalLines: 1 }, 'File target', '/recorded/read.txt'],
      ['file-write', 'write', { file_path: 'relative.txt', content: '' }, { path: '/recorded/write.txt', operation: 'create', diffs: [] }, 'File target', '/recorded/write.txt'],
      ['file-edit', 'edit', { file_path: 'relative.txt', old_string: 'old', new_string: 'new' }, { path: '/recorded/edit.txt', diffs: [{ path: '/recorded/edit.txt', oldText: 'old', newText: 'new' }] }, 'File target', '/recorded/edit.txt'],
      ['file-image', 'read_image', { file_path: 'relative.png' }, { path: '/recorded/image.png' }, 'File target', '/recorded/image.png'],
    ];
    const records = [call('outer', 'run_code', { code: 'await tools.read({file_path:"relative.txt"})', description: 'Synthetic metadata' })];
    for (const [id, name, args, meta] of cases) records.push(call(`direct-${id}`, name, args), result(`direct-${id}`, meta), ...nested(`nested-${id}`, name, args, meta));
    records.push(result('outer'));
    const data = await fixture(t, records, compressed);
    const beforeEvents = JSON.stringify(data.session.logicalEvents);
    for (const [id, , , meta, key, value] of cases) for (const prefix of ['direct-', 'nested-']) {
      for (const locale of ['en', 'zh-CN']) {
        const detail = await data.detail(prefix + id, locale);
        const section = provenance(detail);
        assert.ok(section, `${prefix}${id} has metadata evidence`);
        assert.equal(section.type, 'kv');
        assert.equal(section.purpose, 'traceability');
        assert.deepEqual(section.entries, [{ key: locale === 'en' ? key : key === 'Working directory' ? '工作目录' : '文件目标', value }]);
        const residual = Object.fromEntries(Object.entries(meta).filter(([key]) => !['cwd', 'path'].includes(key)));
        assert.deepEqual(fallback(detail)?.value, Object.keys(residual).length ? residual : undefined);
        assert.ok(!section.entries.some(entry => entry.href || entry.fact));
      }
    }
    assert.equal(JSON.stringify(data.session.logicalEvents), beforeEvents);
    assert.equal(await projectQueryProjectionDigestAsync(data.session, deepSeekAdapter.query.projectQueryPresentation), data.indexed.queryProjectionDigest);
    const withoutMetadata = records.map(record => {
      const copy = structuredClone(record);
      delete copy.data.meta;
      return copy;
    });
    const historical = await fixture(t, withoutMetadata, compressed);
    assert.deepEqual(data.session.counts, historical.session.counts);
    assert.deepEqual(data.session.logicalEvents, historical.session.logicalEvents);
    await data.exactRaw();
  });
}

test('operation metadata does not infer absent values or promote unknown tool and malformed shapes', async t => {
  const cases = [
    ['legacy', 'bash', { command: 'pwd', workdir: '/requested-only' }, undefined],
    ['wrong-case', 'Bash', { command: 'pwd' }, { cwd: '/unproven' }],
    ['alias', 'read_file', { file_path: 'x' }, { path: '/unproven' }],
    ['shell-arguments', 'bash', { command: 7 }, { cwd: '/unproven' }],
    ['file-arguments', 'read', { path: 'x' }, { path: '/unproven' }],
    ['empty-path', 'read_image', { file_path: 'x' }, { path: '' }],
    ['numeric-cwd', 'pwsh', { command: 'Get-Location' }, { cwd: 7 }],
    ['array', 'bash', { command: 'pwd' }, [{ cwd: '/unproven' }]],
    ['null', 'bash', { command: 'pwd' }, null],
  ];
  const records = [call('outer', 'run_code', { code: 'return 1' })];
  for (const [id, name, args, meta] of cases) records.push(call(`direct-${id}`, name, args), result(`direct-${id}`, meta), ...nested(`nested-${id}`, name, args, meta));
  const misplaced = result('misplaced');
  misplaced.data.message.meta = { cwd: '/wrong-slot' };
  records.push(call('misplaced', 'bash', { command: 'pwd' }), misplaced, result('outer'));
  const data = await fixture(t, records);
  for (const [id, , , meta] of cases) for (const prefix of ['direct-', 'nested-']) {
    const detail = await data.detail(prefix + id);
    assert.equal(provenance(detail), undefined);
    if (meta === undefined) assert.equal(fallback(detail), undefined);
    else {
      assert.deepEqual(fallback(detail)?.value, meta);
      assert.equal(fallback(detail)?.expanded, false);
      assert.equal(fallback(detail)?.purpose, 'fallback');
    }
  }
  assert.equal(provenance(await data.detail('misplaced')), undefined);
  assert.equal(fallback(await data.detail('misplaced')), undefined);
  await data.exactRaw();
});

test('unknown operation metadata has bounded fallback while physical Raw stays exact', async t => {
  const meta = { unknown: 'x'.repeat(100000), nested: Array.from({ length: 1000 }, (_, i) => ({ i })) };
  const data = await fixture(t, [call('opaque', 'third_party', {}), result('opaque', meta)]);
  const detail = await data.detail('opaque');
  assert.equal(provenance(detail), undefined);
  const section = fallback(detail);
  assert.ok(section);
  assert.ok(JSON.stringify(section).length < 20000);
  assert.match(JSON.stringify(section), /omitted/);
  await data.exactRaw();
});

test('duplicate call/result identities and ambiguous PTC metadata are not attributed to an operation', async t => {
  const records = [
    call('duplicate-call', 'bash', { command: 'pwd' }), call('duplicate-call', 'bash', { command: 'pwd' }),
    result('duplicate-call', { cwd: '/ambiguous-call' }),
    call('duplicate-result', 'bash', { command: 'pwd' }), result('duplicate-result', { cwd: '/first' }),
    result('duplicate-result', { cwd: '/second' }),
    call('outer', 'run_code', { code: 'return 1' }),
    ...nested('ambiguous-nested', 'bash', { command: 'pwd' }, { cwd: '/first' }),
    nested('ambiguous-nested', 'bash', { command: 'pwd' }, { cwd: '/second' })[1], result('outer'),
  ];
  const data = await fixture(t, records);
  for (const event of data.session.logicalEvents) {
    const detail = await buildEventDetailForSession(data.index, data.session, event.id, event.layer);
    assert.equal(provenance(detail), undefined);
    assert.equal(fallback(detail), undefined);
  }
  await data.exactRaw();
});
