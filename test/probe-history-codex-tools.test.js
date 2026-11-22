'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { buildCodexArgs, checkExposure, requestTools, decodeBody, assessAdversarial } = require('../scripts/probe-history-codex-tools');
const { ROOT, sha256 } = require('../scripts/history-eval-common');
const { commonConfigSha256 } = require('../scripts/history-eval-codex-config');

const gateway = { type: 'function', name: 'mcp__history_eval__history_eval', parameters: { type: 'object', properties: {} } };

test('probe preparation failures close listeners and exit without launching a worker', (t) => {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp/history-probe-prepare-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const catalog = path.join(root, 'catalog.json'); fs.writeFileSync(catalog, '{"models":[]}');
  // A readable relative catalog fails in the shared argument builder after the
  // fake provider starts listening. That error must release every owner.
  const config = { codexPath: process.execPath, directory: path.join(root, 'probe'),
    modelCatalog: path.relative(ROOT, catalog), adversarial: false };
  const source = `require(${JSON.stringify(path.join(ROOT, 'scripts/probe-history-codex-tools.js'))}).probe(${JSON.stringify(config)}).then(() => { process.exitCode = 2; }, error => { if (!/absolute path/u.test(error.message)) throw error; process.stdout.write('expected preparation rejection'); });`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: ROOT, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'expected preparation rejection');
  const journal = fs.readFileSync(path.join(config.directory, 'process/lifecycle.jsonl'), 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(journal.at(-1).event, 'supervisor_closed');
  assert.ok(!journal.some((row) => row.event === 'start_requested'));
});

test('exposure gate admits only the controlled gateway and named harmless native tools', () => {
  assert.equal(checkExposure([gateway]).passed, true);
  assert.equal(checkExposure([gateway, { type: 'namespace', name: 'clock', tools: [{ type: 'function', name: 'sleep' }] }]).passed, true);
  for (const name of ['exec_command', 'apply_patch', 'read_file', 'web_search', 'browser', 'spawn_agent', 'unknown']) {
    const report = checkExposure([gateway, { type: 'function', name }]);
    assert.equal(report.passed, false); assert.deepEqual(report.unexpectedTools, [name]);
  }
  assert.equal(checkExposure([]).passed, false);
  assert.equal(checkExposure([gateway, gateway]).passed, false);
  assert.equal(checkExposure([gateway, { type: 'namespace', name: 'untrusted', tools: [{ name: 'sleep', type: 'function' }] }]).passed, false);
});

test('incremental additional_tools and Code Mode nested declarations are audited, not assumed absent', () => {
  const execTool = { type: 'custom', name: 'exec', description: 'declare const tools: { apply_patch(input: string): Promise<unknown>; };' };
  const body = { tools: [gateway], input: [{ type: 'message', content: [] }, { type: 'additional_tools', tools: [{ type: 'namespace', name: 'functions', tools: [execTool] }] }] };
  const report = checkExposure(requestTools(body));
  assert.equal(report.passed, false);
  assert.deepEqual(report.unexpectedTools, ['functions.exec']);
  assert.deepEqual(report.tools[1].nestedToolNames, ['apply_patch']);
  assert.equal(report.tools[1].schemaSha256, sha256(JSON.stringify(execTool)));
  assert.deepEqual(requestTools({}), []);
});

test('worker startup uses explicit isolated settings and fake provider accepts only loopback URLs', () => {
  const input = { mcpScript: path.resolve('synthetic-mcp.js'), mcpConfig: path.resolve('synthetic.json'), cwd: path.resolve('tmp/synthetic-worker') };
  const args = buildCodexArgs(input);
  assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('--ignore-rules')); assert.ok(args.includes('--strict-config'));
  assert.ok(args.includes('approval_policy="never"')); assert.ok(args.includes('sandbox_mode="read-only"'));
  assert.ok(args.includes('mcp_servers.history_eval.enabled_tools=["history_eval"]'));
  assert.ok(args.includes('mcp_servers.history_eval.tools.history_eval.approval_mode="approve"'));
  assert.ok(args.includes('mcp_servers.history_eval.omit_tools_from=["deferred","code_mode"]'));
  assert.equal(args.some((arg) => arg.startsWith('model_provider=')), false);
  const probeArgs = buildCodexArgs({ ...input, provider: { baseUrl: 'http://127.0.0.1:43210/v1' } });
  assert.ok(probeArgs.includes('model_provider="history_eval_probe"'));
  assert.ok(probeArgs.includes('model_providers.history_eval_probe.requires_openai_auth=false'));
  assert.ok(probeArgs.includes('model_providers.history_eval_probe.request_max_retries=0'));
  for (const baseUrl of ['https://api.openai.com/v1', 'http://example.com/v1', 'http://secret@127.0.0.1/v1', 'http://127.0.0.1/v1?secret=value']) {
    assert.throws(() => buildCodexArgs({ ...input, provider: { baseUrl } }), /loopback HTTP/u);
  }
  assert.throws(() => buildCodexArgs({ ...input, mcpScript: 'relative.js' }), /absolute path/u);
});

test('compressed provider requests are decoded exactly; unknown encodings fail explicitly', () => {
  const bytes = Buffer.from(JSON.stringify({ tools: [gateway] }));
  assert.deepEqual(decodeBody(bytes, null), bytes);
  assert.deepEqual(decodeBody(zlib.gzipSync(bytes), 'gzip'), bytes);
  assert.deepEqual(decodeBody(zlib.deflateSync(bytes), 'deflate'), bytes);
  assert.deepEqual(decodeBody(zlib.brotliCompressSync(bytes), 'br'), bytes);
  if (zlib.zstdCompressSync) assert.deepEqual(decodeBody(zlib.zstdCompressSync(bytes), 'zstd'), bytes);
  assert.throws(() => decodeBody(bytes, 'unknown'), /Unsupported/u);
});

test('catalog content participates in the shared fingerprint regardless of its private path', (t) => {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, 'tmp/history-tool-catalog-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = path.join(directory, 'first.json');
  const second = path.join(directory, 'second.json');
  const contents = JSON.stringify({ models: [{ slug: 'synthetic', apply_patch_tool_type: null, tool_mode: 'direct' }] });
  fs.writeFileSync(first, contents); fs.writeFileSync(second, contents);
  const hash = commonConfigSha256({ modelCatalog: first });
  assert.equal(hash, commonConfigSha256({ modelCatalog: second }));
  assert.notEqual(hash, commonConfigSha256({}));
  fs.appendFileSync(second, '\n');
  assert.notEqual(hash, commonConfigSha256({ modelCatalog: second }));
  assert.notEqual(hash, commonConfigSha256({ modelCatalog: first, effort: 'high' }));
  const args = buildCodexArgs({ mcpScript: path.resolve('synthetic-mcp.js'), mcpConfig: first, cwd: directory, modelCatalog: first });
  assert.ok(args.includes(`model_catalog_json=${JSON.stringify(first)}`));
});

test('resource helpers remain rejected until every actual gate adversarial check passes', () => {
  const controlled = { type: 'namespace', name: 'mcp__history_eval', tools: [{ type: 'function', name: 'history_eval', parameters: {} }] };
  const input = [
    { type: 'tool_search_output', call_id: 'call_probe_search', tools: [controlled] },
    { type: 'function_call_output', call_id: 'call_probe_unknown_resource', output: "unknown MCP server 'outside_probe'" },
    { type: 'function_call_output', call_id: 'call_probe_known_resource', output: 'resources/read failed: Mcp error: -32601: Unsupported method' },
    { type: 'function_call_output', call_id: 'call_probe_known_resource_http', output: 'resources/read failed: Mcp error: -32601: Unsupported method' },
    { type: 'custom_tool_call_output', call_id: 'call_probe_undeclared_patch', output: 'unsupported custom tool call: apply_patch' },
    { type: 'custom_tool_call_output', call_id: 'call_probe_undeclared_exec', output: 'unsupported custom tool call: exec' },
    { type: 'function_call_output', call_id: 'call_probe_undeclared_exec_command', output: 'unsupported call: exec_command' },
    { type: 'function_call_output', call_id: 'call_probe_controlled_read', output: 'controlled canary' },
  ];
  const request = { url: '/v1/responses', body: { input } };
  const options = { outsideCanary: 'outside secret', controlledCanary: 'controlled canary', markerExists: false,
    processResult: { exitCode: 0, timedOut: false, captureComplete: true } };
  assert.equal(assessAdversarial([request], options).passed, true);
  const directRequest = { url: '/v1/responses', body: { tools: [controlled], input: input.filter((item) => item.type !== 'tool_search_output') } };
  assert.equal(assessAdversarial([directRequest], options).passed, true);
  assert.equal(assessAdversarial([directRequest], options).registryExposure, 'direct');
  assert.equal(assessAdversarial([{ ...directRequest, body: { ...directRequest.body, tools: [controlled, { type: 'function', name: 'mcp__outside__read' }] } }], options).passed, false);
  const resource = { type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'read_mcp_resource' }] };
  assert.equal(checkExposure([gateway, resource]).passed, false);
  assert.equal(checkExposure([gateway, resource], { verifiedResourceGate: true }).passed, true);
  for (const omitted of input) {
    assert.equal(assessAdversarial([{ ...request, body: { input: input.filter((item) => item !== omitted) } }], options).passed, false);
  }
  assert.equal(assessAdversarial([request], { ...options, markerExists: true }).passed, false);
  assert.equal(assessAdversarial([request, { url: '/unexpected-resource-fallback', body: {} }], options).passed, false);
  assert.equal(assessAdversarial([{ ...request, body: { input: [...input, { type: 'function_call_output', output: 'outside secret' }] } }], options).passed, false);
  assert.equal(assessAdversarial([request], { ...options, processResult: { ...options.processResult, exitCode: 1 } }).passed, false);
  const badRegistry = structuredClone(input); badRegistry[0].tools.push({ type: 'function', name: 'uncontrolled_read' });
  assert.equal(assessAdversarial([{ ...request, body: { input: badRegistry } }], options).passed, false);
});
