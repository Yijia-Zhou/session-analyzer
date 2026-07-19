'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeModeAssociableOutputFragments } = require('../src/codex-code-mode');
const { projectDeclaredCodeModeCalls } = require('../src/codex-code-mode-declared');

const CODE_MODE_FIXTURE_DIR = path.join(__dirname, 'fixtures', 'code-mode');

test('projects sequential literal requests and associates emitted results by bounded order', () => {
  const projection = projectDeclaredCodeModeCalls(`
    const plan = await tools.update_plan({
      explanation: 'fixture',
      plan: [
        { step: 'Inspect', status: 'in_progress' },
        { step: 'Render', status: 'pending' },
      ],
    });
    const command = await tools.shell_command({ command: 'Write-Output fixture', timeout_ms: 1000 });
    text(plan);
    text(command);
  `, { outputFragments: ['{}', 'Exit code: 0\nWall time: 1 second\nOutput:\nfixture'] });

  assert.equal(projection.supported, true);
  assert.equal(projection.hasCompleteOutputAssociation, true);
  assert.deepEqual(projection.calls.map((call) => ({
    toolName: call.toolName,
    resultVariable: call.resultVariable,
    resultAssociation: call.resultAssociation,
    resultText: call.resultText,
  })), [
    { toolName: 'update_plan', resultVariable: 'plan', resultAssociation: 'bounded', resultText: '{}' },
    {
      toolName: 'shell_command',
      resultVariable: 'command',
      resultAssociation: 'bounded',
      resultText: 'Exit code: 0\nWall time: 1 second\nOutput:\nfixture',
    },
  ]);
  assert.equal(projection.calls[0].requestValue.plan[0].step, 'Inspect');
  assert.equal(projection.calls[0].requestValue.plan[0].status, 'in_progress');
  assert.equal(Object.getPrototypeOf(projection.calls[0].requestValue), null);
});

test('keeps safe declared requests when no bounded result association is available', () => {
  const projection = projectDeclaredCodeModeCalls(`
    await tools.get_goal({});
    const command = await tools.shell_command({ command: \`Write-Output fixture\` });
  `, { outputFragments: ['unowned output'] });

  assert.equal(projection.supported, true);
  assert.equal(projection.hasCompleteOutputAssociation, false);
  assert.deepEqual(projection.calls.map((call) => [call.toolName, call.resultAssociation]), [
    ['get_goal', 'none'],
    ['shell_command', 'none'],
  ]);
});

test('preserves request argument presence for omitted, null, and empty-object calls', () => {
  const projection = projectDeclaredCodeModeCalls(`
    await tools.get_goal();
    await tools.get_goal(null);
    await tools.get_goal({});
  `);

  assert.equal(projection.supported, true);
  assert.deepEqual(projection.calls.map((call) => call.hasRequestArgument), [false, true, true]);
  assert.equal(projection.calls[0].requestValue, null);
  assert.equal(projection.calls[1].requestValue, null);
  assert.deepEqual(Object.keys(projection.calls[2].requestValue), []);
  assert.equal(Object.getPrototypeOf(projection.calls[2].requestValue), null);
});

test('recognizes the standard string-or-JSON result emission wrapper', () => {
  const projection = projectDeclaredCodeModeCalls(`
    const result = await tools.shell_command({ command: 'Write-Output fixture' });
    text(typeof result === "string" ? result : JSON.stringify(result));
  `, { outputFragments: ['Exit code: 0\nOutput:\nfixture'] });

  assert.equal(projection.supported, true);
  assert.equal(projection.hasCompleteOutputAssociation, true);
  assert.equal(projection.calls.length, 1);
  assert.equal(projection.calls[0].toolName, 'shell_command');
  assert.equal(projection.calls[0].resultVariable, 'result');
  assert.equal(projection.calls[0].resultAssociation, 'bounded');
});

test('rejects lookalike conditional result emissions', () => {
  const sources = [
    'const result = await tools.shell_command({ command: "fixture" }); text(typeof other === "string" ? result : JSON.stringify(result));',
    'const result = await tools.shell_command({ command: "fixture" }); text(typeof result === "string" ? other : JSON.stringify(result));',
    'const result = await tools.shell_command({ command: "fixture" }); text(typeof result === "string" ? result : JSON.parse(result));',
  ];

  for (const source of sources) assert.equal(projectDeclaredCodeModeCalls(source).supported, false, source);
});

test('fails closed when a declared result shadows projector runtime identifiers', () => {
  const sources = [
    'const JSON = await tools.get_goal({}); text(typeof JSON === "string" ? JSON : JSON.stringify(JSON));',
    'const tools = await tools.get_goal({}); text(tools);',
    'const text = await tools.get_goal({}); text(text);',
  ];

  for (const source of sources) {
    const projection = projectDeclaredCodeModeCalls(source, { outputFragments: ['fixture'] });
    assert.equal(projection.supported, false, source);
    assert.equal(projection.reason, 'unsupported_binding', source);
    assert.deepEqual(projection.calls, [], source);
    assert.equal(projection.hasCompleteOutputAssociation, false, source);
  }
});

test('fails the whole program closed for unknown, dynamic, control-flow, and concurrent calls', () => {
  const sources = [
    'const result = await tools.fixture({}); text(result);',
    'const args = {}; const result = await tools.update_plan(args); text(result);',
    'if (ready) { await tools.update_plan({ plan: [] }); }',
    'for (const item of items) await tools.update_plan({ plan: [] });',
    'const result = await Promise.all([tools.update_plan({ plan: [] })]); text(result);',
    'const result = await tools[toolName]({}); text(result);',
  ];

  for (const source of sources) {
    const projection = projectDeclaredCodeModeCalls(source, { outputFragments: ['fixture'] });
    assert.equal(projection.supported, false, source);
    assert.deepEqual(projection.calls, [], source);
  }
});

test('rejects dynamic literal members, unsafe bindings, and syntax errors', () => {
  const sources = [
    'const result = await tools.update_plan({ plan, extra: true }); text(result);',
    'const result = await tools.update_plan({ ...fixture }); text(result);',
    'const result = await tools.update_plan({ [key]: true }); text(result);',
    'let result = await tools.update_plan({ plan: [] }); text(result);',
    'const a = await tools.update_plan({}), b = await tools.get_goal({}); text(a); text(b);',
    'const result = await tools.update_plan({ plan: [] };',
  ];

  for (const source of sources) assert.equal(projectDeclaredCodeModeCalls(source).supported, false, source);
});

test('rejects ambiguous emission order and fragment cardinality without discarding request projections', () => {
  const source = `
    const first = await tools.update_plan({ plan: [] });
    const second = await tools.shell_command({ command: 'fixture' });
    text(second);
    text(first);
  `;
  const reversed = projectDeclaredCodeModeCalls(source, { outputFragments: ['second', 'first'] });
  const missing = projectDeclaredCodeModeCalls(source.replace('text(second);\n', ''), { outputFragments: ['first'] });
  const extra = projectDeclaredCodeModeCalls(source.replace('text(second);\n    text(first);', 'text(first);\n    text(second);'), {
    outputFragments: ['first', 'second', 'extra'],
  });

  for (const projection of [reversed, missing, extra]) {
    assert.equal(projection.supported, true);
    assert.equal(projection.hasCompleteOutputAssociation, false);
    assert.ok(projection.calls.every((call) => call.resultAssociation === 'none'));
  }
});

test('fails closed for __proto__ object-initializer semantics and safely keeps ordinary constructor keys', () => {
  const unsafe = projectDeclaredCodeModeCalls(`
    const result = await tools.update_plan({ '__proto__': { polluted: true }, constructor: 'fixture' });
    text(result);
  `, { outputFragments: ['{}'] });
  const safe = projectDeclaredCodeModeCalls(`
    const result = await tools.update_plan({ constructor: 'fixture' });
    text(result);
  `, { outputFragments: ['{}'] });
  const request = safe.calls[0].requestValue;

  assert.equal(unsafe.supported, false);
  assert.equal(safe.supported, true);
  assert.equal(Object.getPrototypeOf(request), null);
  assert.equal(request.constructor, 'fixture');
  assert.equal({}.polluted, undefined);
});

test('sanitized fixtures freeze structured and raw-fallback projection behavior', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CODE_MODE_FIXTURE_DIR, 'manifest.json'), 'utf8'));
  const fixtures = manifest.fixtures.filter((fixture) => fixture.declaredProjection);

  assert.deepEqual(fixtures.map((fixture) => fixture.declaredProjection), ['bounded', 'raw_fallback']);
  for (const fixture of fixtures) {
    const rows = fs.readFileSync(path.join(CODE_MODE_FIXTURE_DIR, fixture.file), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const call = rows.find((row) => row.payload?.type === 'custom_tool_call');
    const output = rows.find((row) => row.payload?.type === 'custom_tool_call_output');
    const projection = projectDeclaredCodeModeCalls(call.payload.input, {
      outputFragments: codeModeAssociableOutputFragments({ parsed: output }),
    });

    assert.equal(projection.calls.length, fixture.projectionCount, fixture.file);
    assert.equal(projection.hasCompleteOutputAssociation, fixture.declaredProjection === 'bounded', fixture.file);
    assert.equal(projection.supported, fixture.declaredProjection !== 'raw_fallback', fixture.file);
  }
});
