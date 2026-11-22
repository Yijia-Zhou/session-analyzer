#!/usr/bin/env node
'use strict';

// Private harness child, not a shipped history operation. Both the service and
// diagnostic control use the same parent, stdin and captured stdout/stderr.
const path = require('node:path');
const readline = require('node:readline');
const { createAuditedHistoryService, verifyPreflight } = require('./history-eval-scope');

async function main() {
  const input = readline.createInterface({ input: process.stdin });
  const config = await new Promise((resolve, reject) => {
    input.once('line', (line) => { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } });
    input.once('error', reject);
  });
  input.close();
  const emit = (value) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
  if (process.argv.includes('--control')) {
    emit({ event: 'control_ready', pid: process.pid, ppid: process.ppid });
    const timer = setInterval(() => emit({ event: 'control_alive', pid: process.pid }), 1000);
    process.on('SIGTERM', () => { clearInterval(timer); process.exitCode = 0; });
    return;
  }
  const { options } = await verifyPreflight(config.scope, config.args);
  emit({ event: 'preflight_passed', pid: process.pid, ppid: process.ppid });
  emit({ event: 'indexing_started' });
  const { service, audit } = await createAuditedHistoryService(config.scope, config.args);
  emit({ event: 'indexing_complete', audit });
  const { startHistoryServer } = require(path.join(config.runtimeRoot, 'src/history-server'));
  const running = await startHistoryServer(options, async () => service);
  emit({ event: 'ready', endpoint: running.endpoint, audit });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    running.close().then(() => emit({ event: 'closed', signal }), (error) => {
      emit({ event: 'close_error', code: error.code || null }); process.exitCode = 1;
    });
  });
}

if (require.main === module) main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ event: 'failed', code: error.code || 'SERVICE_FAILED', message: error.message })}\n`);
  process.exitCode = 1;
});
