#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { createGate, bindGateRpc } = require('./history-eval-mcp');
const { privateTarget } = require('./history-eval-common');

const KIND = 'parent-owned-loopback';
const MAX_AUTH_BYTES = 1024;
const AUTH_TIMEOUT_MS = 3000;
const MAX_PENDING = 8;

function readDescriptor(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Transport descriptor requires an absolute path');
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_AUTH_BYTES) throw new Error('Invalid transport descriptor');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid transport descriptor'); }
  if (!value || Object.keys(value).sort().join(',') !== 'host,kind,port,schemaVersion,token'
    || value.schemaVersion !== 1 || value.kind !== KIND || value.host !== '127.0.0.1'
    || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/u.test(value.token || '')) {
    throw new Error('Invalid transport descriptor');
  }
  return value;
}

// The service/control children belong to the caller's process, not to Codex or
// its MCP shim. Killing the worker tree cannot kill this supervisor mid-journal.
async function startGateTransport({ config, descriptorFile }) {
  descriptorFile = privateTarget(descriptorFile);
  if (fs.existsSync(descriptorFile)) throw new Error('Transport descriptor must be new');
  const gate = await createGate(config);
  const token = randomBytes(32).toString('hex');
  const tokenBytes = Buffer.from(token, 'hex');
  const sockets = new Set();
  let authenticated = false, rpc = null, closing = null;
  const server = net.createServer((socket) => {
    if (closing || authenticated || sockets.size >= MAX_PENDING) { socket.destroy(); return; }
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => socket.destroy(), AUTH_TIMEOUT_MS);
    socket.on('error', () => {});
    socket.once('close', () => { clearTimeout(timer); sockets.delete(socket); });
    const authenticate = (chunk) => {
      if (closing || authenticated) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_AUTH_BYTES) { socket.destroy(); return; }
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      let supplied;
      try { supplied = JSON.parse(buffer.subarray(0, newline).toString('utf8')); } catch { socket.destroy(); return; }
      if (newline !== buffer.length - 1 || !supplied || Object.keys(supplied).join(',') !== 'token'
        || !/^[a-f0-9]{64}$/u.test(supplied.token || '') || !timingSafeEqual(tokenBytes, Buffer.from(supplied.token, 'hex'))) {
        socket.destroy(); return;
      }
      clearTimeout(timer); socket.off('data', authenticate);
      authenticated = true;
      for (const pending of sockets) if (pending !== socket) pending.destroy();
      socket.write('{"authenticated":true}\n');
      rpc = bindGateRpc({ gate, input: socket, output: socket });
    };
    socket.on('data', authenticate);
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    fs.mkdirSync(path.dirname(descriptorFile), { recursive: true });
    fs.writeFileSync(descriptorFile, `${JSON.stringify({ schemaVersion: 1, kind: KIND, host: '127.0.0.1', port, token })}\n`, { flag: 'wx', mode: 0o600 });
    const transport = { kind: KIND, host: '127.0.0.1', port, authentication: '256-bit-token', singleConnection: true, parentPid: process.pid };
    return { descriptorFile, transport, close() {
      if (closing) return closing;
      closing = (async () => {
        const drained = rpc ? rpc.close() : Promise.resolve();
        for (const socket of sockets) socket.destroy();
        const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await Promise.all([closed, gate.close()]);
        let timer;
        try {
          await Promise.race([drained, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('Transport RPC queue did not drain; cleanup remains unconfirmed'), { code: 'TRANSPORT_DRAIN_TIMEOUT' })), 5000);
          })]);
        } finally { clearTimeout(timer); }
      })();
      return closing;
    } };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await gate.close();
    throw error;
  }
}

async function runShim(descriptorFile, { input = process.stdin, output = process.stdout } = {}) {
  const descriptor = readDescriptor(descriptorFile);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: descriptor.host, port: descriptor.port });
    let ready = false, buffer = Buffer.alloc(0), settled = false;
    const timer = setTimeout(() => fail('Transport authentication timed out'), AUTH_TIMEOUT_MS);
    const fail = (message) => {
      if (settled) return;
      settled = true; clearTimeout(timer); input.unpipe(socket); input.pause(); socket.destroy(); reject(new Error(message));
    };
    socket.on('error', () => fail('Transport connection failed'));
    socket.once('connect', () => socket.write(`${JSON.stringify({ token: descriptor.token })}\n`));
    socket.once('close', () => {
      clearTimeout(timer); input.unpipe(socket); input.pause();
      if (!settled) { settled = true; if (ready) resolve(); else reject(new Error('Transport authentication failed')); }
    });
    const authenticate = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_AUTH_BYTES) { fail('Invalid transport authentication response'); return; }
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      if (buffer.subarray(0, newline).toString('utf8') !== '{"authenticated":true}') { fail('Invalid transport authentication response'); return; }
      ready = true; clearTimeout(timer); socket.off('data', authenticate);
      if (newline + 1 < buffer.length) socket.unshift(buffer.subarray(newline + 1));
      socket.pipe(output, { end: false }); input.pipe(socket);
    };
    socket.on('data', authenticate);
  });
}

if (require.main === module) runShim(process.argv[2]).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { startGateTransport, readDescriptor, runShim, MAX_AUTH_BYTES, AUTH_TIMEOUT_MS };
