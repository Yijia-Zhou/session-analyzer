#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const { ROOT, sha256, privateTarget } = require('./history-eval-common');
const { createSupervisor } = require('./history-eval-supervisor');
const { startGateTransport } = require('./history-eval-transport');
const { buildCodexArgs, commonConfigSha256 } = require('./history-eval-codex-config');

const SYNTHETIC_TOOL = Object.freeze({ name: 'history_eval', description: 'Synthetic controlled history gateway for startup exposure calibration only.',
  inputSchema: { type: 'object', properties: { operation: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['operation', 'args'], additionalProperties: false } });

function syntheticMcp() {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request.id === undefined) return;
    let result;
    if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} }, serverInfo: { name: 'history-eval-exposure-probe', version: '1' } };
    else if (request.method === 'tools/list') result = { tools: [SYNTHETIC_TOOL] };
    else if (request.method === 'tools/call') result = { isError: true, content: [{ type: 'text', text: 'Synthetic exposure probe never executes tools.' }] };
    else if (request.method === 'ping') result = {};
    else { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })}\n`); return; }
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  });
}

function listTools(tools, prefix = '') {
  if (!Array.isArray(tools)) throw new Error('Provider request lacks a tools array');
  return tools.flatMap((tool) => {
    const name = tool.name || tool.function?.name || tool.type;
    const qualified = prefix ? `${prefix}.${name}` : name;
    if (tool.type === 'namespace') return listTools(tool.tools, qualified);
    const nestedToolNames = [...(tool.description || '').matchAll(/declare const tools: \{\s*([a-zA-Z0-9_]+)\(/gu)].map((match) => match[1]);
    return [{ name: qualified, type: tool.type, nestedToolNames, schemaSha256: sha256(JSON.stringify(tool)), schema: tool }];
  });
}

function checkExposure(tools, { verifiedResourceGate = false } = {}) {
  const listed = listTools(tools);
  const gatewayNames = new Set(['mcp__history_eval__history_eval', 'functions.mcp__history_eval__history_eval', 'mcp__history_eval.history_eval']);
  const allowed = (name) => gatewayNames.has(name);
  // These native tools carry no historical body or filesystem/network access.
  // Their presence is still reported, and no other unknown tool is accepted.
  const harmless = new Set(['update_plan', 'request_user_input', 'request_user_input_async',
    'functions.update_plan', 'functions.request_user_input', 'functions.request_user_input_async', 'clock.sleep', 'clock.curr_time']);
  if (verifiedResourceGate) for (const name of ['functions.list_mcp_resources', 'functions.list_mcp_resource_templates', 'functions.read_mcp_resource', 'tool_search']) harmless.add(name);
  const gateways = listed.filter((tool) => allowed(tool.name));
  const unexpected = listed.filter((tool) => !allowed(tool.name) && !harmless.has(tool.name));
  return { passed: (gateways.length === 1 || (verifiedResourceGate && gateways.length === 0)) && unexpected.length === 0, tools: listed,
    gatewayCount: gateways.length, unexpectedTools: unexpected.map((tool) => tool.name) };
}

function requestTools(body) {
  return [...(body?.tools || []), ...(body?.input || []).filter((item) => ['additional_tools', 'tool_search_output'].includes(item.type)).flatMap((item) => item.tools || [])];
}

function assessAdversarial(requests, { outsideCanary, controlledCanary, markerExists, processResult }) {
  const items = requests.flatMap((request) => request.body?.input || []);
  const output = (id) => items.find((item) => item.call_id === `call_probe_${id}` && /_output$/u.test(item.type));
  const text = (id) => { const item = output(id); return typeof item?.output === 'string' ? item.output : JSON.stringify(item?.output ?? ''); };
  const search = output('search');
  const firstBody = requests[0]?.body;
  const firstTools = firstBody ? listTools([...(firstBody.tools || []), ...(firstBody.input || [])
    .filter((item) => item.type === 'additional_tools').flatMap((item) => item.tools || [])]) : [];
  const directRegistry = firstTools.filter((tool) => tool.name.startsWith('mcp__'));
  const registry = directRegistry.length ? directRegistry : search?.tools ? listTools(search.tools) : [];
  const registryVerified = registry.length === 1 && registry[0].name === 'mcp__history_eval.history_eval';
  const checks = { registryVerified,
    unknownServerRejected: /unknown MCP server 'outside_probe'/u.test(text('unknown_resource')),
    fileResourceRejected: /Mcp error: -32601: Unsupported method/u.test(text('known_resource')),
    httpResourceRejected: /Mcp error: -32601: Unsupported method/u.test(text('known_resource_http')),
    undeclaredPatchRejected: /unsupported custom tool call: apply_patch/u.test(text('undeclared_patch')),
    undeclaredCodeModeRejected: /unsupported custom tool call: exec/u.test(text('undeclared_exec')),
    undeclaredCommandRejected: /unsupported call: exec_command/u.test(text('undeclared_exec_command')),
    patchNotCreated: !markerExists,
    outsideCanaryWithheld: !JSON.stringify(items).includes(outsideCanary),
    controlledToolDelivered: text('controlled_read').includes(controlledCanary),
    noHttpResourceFallback: requests.every((request) => request.url?.split('?')[0].endsWith('/responses')),
    processCompleted: processResult.exitCode === 0 && !processResult.timedOut && processResult.captureComplete,
  };
  return { passed: Object.values(checks).every(Boolean), checks, registry, registryExposure: directRegistry.length ? 'direct' : 'discovered',
    results: Object.fromEntries(['unknown_resource', 'known_resource', 'known_resource_http', 'undeclared_patch', 'undeclared_exec', 'undeclared_exec_command', 'controlled_read'].map((id) => [id, output(id) ?? null])) };
}

function decodeBody(bytes, encoding) {
  if (!encoding || encoding === 'identity') return bytes;
  if (encoding === 'gzip') return zlib.gunzipSync(bytes);
  if (encoding === 'deflate') return zlib.inflateSync(bytes);
  if (encoding === 'br') return zlib.brotliDecompressSync(bytes);
  if (encoding === 'zstd' && zlib.zstdDecompressSync) return zlib.zstdDecompressSync(bytes);
  throw new Error(`Unsupported request encoding: ${encoding}`);
}

async function prepareSyntheticGate(directory, model) {
  const { freeze } = require('./freeze-history-eval');
  const { freezeScope } = require('./history-eval-scope');
  const project = path.join(directory, 'project'); fs.mkdirSync(project);
  const original = path.join(directory, 'rollout-probe.jsonl');
  const canary = 'SYNTHETIC_CONTROLLED_GATE_CANARY';
  fs.writeFileSync(original, [
    { type: 'session_meta', timestamp: '2026-11-01T00:00:00Z', payload: { id: 'probe-synthetic', cwd: project } },
    { type: 'event_msg', timestamp: '2026-11-01T00:00:01Z', payload: { type: 'user_message', message: canary } },
  ].map(JSON.stringify).join('\n') + '\n');
  const corpus = freeze({ target: path.join(directory, 'frozen'), inputs: [original], repo: project });
  const corpusManifest = path.join(directory, 'frozen/manifest.json');
  const serveArgs = ['serve', '--repo', project, '--source', 'codex', '--codex-home', corpus.codexHome, '--port', '17891'];
  const scope = await freezeScope({ corpusManifest, serveArgs, expectedSessionIds: ['probe-synthetic'] });
  const scopeFile = path.join(directory, 'scope.json'); fs.writeFileSync(scopeFile, JSON.stringify(scope));
  const guideRoot = path.join(directory, 'guide'); fs.mkdirSync(guideRoot);
  fs.writeFileSync(path.join(guideRoot, 'SKILL.md'), 'Synthetic probe guide only.\n');
  const configFile = path.join(directory, 'gate-config.json');
  const config = { directory: path.join(directory, 'gate'), trial: 'synthetic-native-tool-probe', condition: 'raw', task: 'synthetic-tool-boundary',
    model, harness: 'native-fake-provider', scopeFile, corpusManifest, runtimeRoot: ROOT, maxRetrievalCalls: 20,
    maxOutputBytes: 65536, serveArgs, port: 17891, serviceTimeoutMs: 10000, initialState: 'no-service',
    calibrationControl: false, pollWaitMs: 50, guideRoot, guides: { 'SKILL.md': sha256(fs.readFileSync(path.join(guideRoot, 'SKILL.md'))) }, rgExecutable: 'rg' };
  fs.writeFileSync(configFile, JSON.stringify(config));
  const outside = path.join(directory, 'outside-source.txt');
  fs.writeFileSync(outside, 'SYNTHETIC_OUTSIDE_SOURCE_MUST_NOT_BE_DELIVERED');
  const marker = path.join(directory, 'unexpected-patch.txt');
  const readOutside = `Get-Content -Encoding UTF8 -LiteralPath '${outside.replaceAll("'", "''")}'`;
  const steps = [
    { id: 'unknown_resource', item: { type: 'function_call', namespace: 'functions', name: 'read_mcp_resource', arguments: JSON.stringify({ server: 'outside_probe', uri: pathToFileURL(outside).href }) } },
    { id: 'known_resource', item: { type: 'function_call', namespace: 'functions', name: 'read_mcp_resource', arguments: JSON.stringify({ server: 'history_eval', uri: pathToFileURL(outside).href }) } },
    { id: 'known_resource_http', item: { type: 'function_call', namespace: 'functions', name: 'read_mcp_resource', arguments: null } },
    { id: 'undeclared_patch', item: { type: 'custom_tool_call', namespace: 'functions', name: 'apply_patch', input: `*** Begin Patch\n*** Add File: ${marker.replaceAll('\\', '/')}\n+unexpected\n*** End Patch` } },
    { id: 'undeclared_exec', item: { type: 'custom_tool_call', namespace: 'functions', name: 'exec', input: `text(await tools.exec_command(${JSON.stringify({ cmd: readOutside, max_output_tokens: 1000 })}));` } },
    { id: 'undeclared_exec_command', item: { type: 'function_call', namespace: 'functions', name: 'exec_command', arguments: JSON.stringify({ cmd: readOutside, max_output_tokens: 1000 }) } },
    { id: 'controlled_read', item: { type: 'function_call', namespace: 'mcp__history_eval', name: 'history_eval', arguments: JSON.stringify({ args: ['raw', 'read', corpus.files[0].relativePath, '1', '2', '0', '4096'] }) } },
  ];
  return { mcpScript: path.join(ROOT, 'scripts/history-eval-mcp.js'), mcpConfig: configFile, config, canary, outside, marker, steps };
}

function respondWithItems(response, items, serial) {
  const record = { id: `resp_probe_${serial}`, object: 'response', status: 'completed', output: items,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
  send({ type: 'response.created', response: { ...record, status: 'in_progress', output: [] } });
  for (const [index, item] of items.entries()) {
    send({ type: 'response.output_item.added', output_index: index, item });
    send({ type: 'response.output_item.done', output_index: index, item });
  }
  send({ type: 'response.completed', response: record });
  response.end();
}

async function probe({ codexPath, directory, model = 'gpt-6.1-terra', effort = 'max', timeoutMs = 45000, modelCatalog, adversarial = false }) {
  if (!path.isAbsolute(codexPath)) throw new Error('Codex executable requires an absolute path');
  // Validate readable inputs before acquiring listeners or process owners.
  const codexSha256 = sha256(fs.readFileSync(codexPath));
  const modelCatalogSha256 = modelCatalog ? sha256(fs.readFileSync(modelCatalog)) : null;
  directory = privateTarget(directory);
  fs.mkdirSync(directory, { recursive: true });
  const workerHome = path.join(directory, 'worker-home');
  const cwd = path.join(directory, 'workspace');
  fs.mkdirSync(workerHome); fs.mkdirSync(cwd);
  const gate = adversarial ? await prepareSyntheticGate(directory, model) : null;
  const mcpConfig = gate?.mcpConfig || path.join(directory, 'synthetic-mcp.json');
  if (!gate) fs.writeFileSync(mcpConfig, JSON.stringify({ mode: 'tool-exposure-probe' }), { flag: 'wx' });
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = []; let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) request.destroy(); else chunks.push(chunk);
    });
    request.on('end', () => {
      const record = { at: new Date().toISOString(), method: request.method, url: request.url,
        contentEncoding: request.headers['content-encoding'] || null, bytes, body: null, decodeError: null };
      try { record.body = JSON.parse(decodeBody(Buffer.concat(chunks), record.contentEncoding).toString('utf8')); }
      catch (error) { record.decodeError = error.message; }
      requests.push(record);
      fs.appendFileSync(path.join(directory, 'provider-requests.jsonl'), `${JSON.stringify(record)}\n`);
      if (gate && request.url?.endsWith('/responses')) {
        const step = gate.steps[requests.length - 1];
        const item = step ? { id: `item_probe_${step.id}`, call_id: `call_probe_${step.id}`, status: 'completed', ...step.item }
          : { id: 'msg_probe_final', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Synthetic boundary probe completed.', annotations: [] }] };
        respondWithItems(response, [item], requests.length); return;
      }
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Tool exposure captured locally; inference is deliberately refused.', type: 'invalid_request_error', code: 'history_tool_probe_only' } }));
    });
  });
  let supervisor = null, transport = null, processResult, transportClosed = false;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (gate) gate.steps.find((step) => step.id === 'known_resource_http').item.arguments = JSON.stringify({ server: 'history_eval', uri: `http://127.0.0.1:${server.address().port}/unexpected-resource-fallback` });
    supervisor = createSupervisor({ directory: path.join(directory, 'process'), identity: { kind: 'synthetic-tool-exposure' } });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENAI_|AZURE_|ANTHROPIC_|CODEX_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$)/iu.test(key)));
    env.CODEX_HOME = workerHome;
    env.NO_PROXY = '127.0.0.1,localhost';
    transport = gate ? await startGateTransport({ config: gate.config, descriptorFile: path.join(directory, 'gate-transport.json') }) : null;
    const args = buildCodexArgs({ model, effort, modelCatalog,
      mcpScript: transport ? path.join(__dirname, 'history-eval-transport.js') : __filename,
      mcpConfig: transport?.descriptorFile || mcpConfig, cwd,
      provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } });
    fs.writeFileSync(path.join(directory, 'configuration.json'), `${JSON.stringify({ codexPath, codexSha256,
      args, model, effort, modelCatalog: modelCatalog ? { path: modelCatalog, sha256: modelCatalogSha256 } : null,
      workerHome, source: 'synthetic', auth: 'none; fresh home and loopback provider without credentials',
      node: process.version, platform: process.platform }, null, 2)}\n`, { flag: 'wx' });
    const child = supervisor.start({ id: 'codex', command: codexPath, args, cwd, env,
      input: 'This is a synthetic tool-exposure probe. No historical evidence exists. Say probe only.\n', timeoutMs });
    processResult = await child.completed;
  } finally {
    try { if (supervisor) await supervisor.close(); } finally {
      try { if (transport) { await transport.close(); transportClosed = true; } }
      finally { if (server.listening) await new Promise((resolve) => server.close(resolve)); }
    }
  }
  const responseRequests = requests.filter((request) => request.url?.split('?')[0].endsWith('/responses'));
  const adversarialProof = gate ? assessAdversarial(requests, { outsideCanary: 'SYNTHETIC_OUTSIDE_SOURCE_MUST_NOT_BE_DELIVERED',
    controlledCanary: gate.canary, markerExists: fs.existsSync(gate.marker), processResult }) : null;
  const exposures = responseRequests.map((request) => requestTools(request.body).length ? checkExposure(requestTools(request.body), { verifiedResourceGate: adversarialProof?.passed === true })
    : { passed: false, tools: [], gatewayCount: 0, unexpectedTools: [], error: request.decodeError || 'Missing tools' });
  const catalogUnchanged = !modelCatalog || sha256(fs.readFileSync(modelCatalog)) === modelCatalogSha256;
  const passed = exposures.length > 0 && exposures.every((exposure) => exposure.passed) && catalogUnchanged && (!gate || (adversarialProof.passed && transportClosed));
  const gateDependencies = gate ? ['history-eval-mcp.js', 'history-eval-transport.js', 'history-eval-scope.js', 'history-eval-supervisor.js', 'history-eval-common.js', 'record-history-eval.js']
    .map((name) => { const file = path.join(ROOT, 'scripts', name); return { path: file, sha256: sha256(fs.readFileSync(file)) }; }) : [];
  const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), passed, status: passed ? 'pass' : 'blocked', codexSha256,
    commonConfigSha256: commonConfigSha256({ model, effort, modelCatalog }),
    modelCatalog: modelCatalog ? { path: modelCatalog, sha256: modelCatalogSha256, unchanged: catalogUnchanged } : null,
    toolNames: [...new Set(exposures.flatMap((exposure) => exposure.tools.map((tool) => tool.name)))],
    unsafeTools: [...new Set(exposures.flatMap((exposure) => exposure.unexpectedTools))],
    nestedToolNames: [...new Set(exposures.flatMap((exposure) => exposure.tools.flatMap((tool) => tool.nestedToolNames || [])))],
    reason: passed ? 'No native file/execution tools; the unique MCP registry, resource-helper denials and controlled gateway delivery were verified.'
      : 'A controlled gateway-only tool surface could not be established; do not start real evidence workers.',
    proofFiles: ['configuration.json', ...(requests.length ? ['provider-requests.jsonl'] : []), ...(gate ? ['gate-config.json', 'gate-transport.json', 'scope.json', 'frozen/manifest.json'] : [])].map((name) => ({ path: path.join(directory, name), sha256: sha256(fs.readFileSync(path.join(directory, name))) })),
    transport: transport ? { ...transport.transport, closed: transportClosed } : null,
    kind: 'local-fake-provider-tool-exposure', inferenceRequestsToRealProvider: 0, model, effort,
    requests: requests.length, responseRequests: responseRequests.length, exposures, process: processResult,
    mcpTool: gate ? adversarialProof.registry[0]?.schema ?? null : SYNTHETIC_TOOL,
    mcpToolSchemaSha256: gate ? adversarialProof.registry[0]?.schemaSha256 ?? null : sha256(JSON.stringify(SYNTHETIC_TOOL)),
    gateDependencies,
    adversarial: gate ? { ...adversarialProof, steps: gate.steps, outsideCanaryForwarded: requests.some((request) => JSON.stringify(request.body?.input || []).includes('SYNTHETIC_OUTSIDE_SOURCE_MUST_NOT_BE_DELIVERED')),
      patchMarkerCreated: fs.existsSync(gate.marker), controlledCanaryForwarded: requests.some((request) => JSON.stringify(request.body?.input || []).includes(gate.canary)),
      gateScript: { path: gate.mcpScript, sha256: sha256(fs.readFileSync(gate.mcpScript)) }, gateDirectory: gate.config.directory } : null,
    limits: 'Native executable request capture with a synthetic MCP tool and loopback fake provider. No inference or usage calibration. The real runner must use the same common startup settings; changing the executable, model or features requires another exposure probe. Harmless planning/time/input tools are listed but cannot retrieve evidence.' };
  fs.writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && fs.existsSync(args[0]) && JSON.parse(fs.readFileSync(args[0], 'utf8')).mode === 'tool-exposure-probe') return syntheticMcp();
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (key === '--adversarial') { options[key] = true; continue; }
    if (!['--codex', '--directory', '--model', '--effort', '--model-catalog'].includes(key) || !args.length) throw new Error('Usage: probe-history-codex-tools.js --codex <exe> --directory <new-tmp-dir> [--model <model> --effort <effort> --model-catalog <absolute-json> --adversarial]');
    options[key] = args.shift();
  }
  const report = await probe({ codexPath: options['--codex'], directory: options['--directory'], model: options['--model'], effort: options['--effort'], modelCatalog: options['--model-catalog'], adversarial: options['--adversarial'] });
  process.stdout.write(`${JSON.stringify({ passed: report.passed, requests: report.requests,
    tools: report.exposures.flatMap((item) => item.tools.map((tool) => tool.name)), exitCode: report.process.exitCode, report: path.join(options['--directory'], 'report.json') })}\n`);
  if (!report.passed) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { buildCodexArgs, checkExposure, decodeBody, listTools, probe, requestTools, assessAdversarial };
