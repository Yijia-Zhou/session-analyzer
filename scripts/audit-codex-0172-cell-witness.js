'use strict';

// Local-only targeted reader witness. Print counts; never echo rows, paths, IDs or exceptions.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const MiB = 1024 ** 2;
const generation = /^g[1-9][0-9]*:[0-9]+$/;

// Independent witness selector for the pinned writer's default namespace.
function nativeIdentity(payload, name) {
  return (payload.name == null || payload.name === name)
    && (payload.namespace == null || payload.namespace === '' || payload.namespace === 'functions');
}

async function listPlain(dir, result) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await listPlain(file, result);
    if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
    const stat = await fs.stat(file);
    if (stat.size <= 12 * MiB && stat.size > 0 && Date.now() - stat.mtimeMs < 21 * 86400000) {
      result.push({ file, stat });
    }
  }
}

function qualifyingChains(rows) {
  const meta = rows[0]?.payload;
  if (rows[0]?.type !== 'session_meta' || !meta?.cwd || !meta.id || meta.forked_from_id
      || rows.some(row => row.type === 'session_meta' && row.payload.history_base != null)) return [];
  const receipts = new Map(), waits = [], outputs = new Map(), calls = new Map();
  let epoch = 0, inTurn = false;
  for (const [offset, row] of rows.entries()) {
    const p = row.payload;
    if (row.type === 'event_msg' && ['turn_started', 'task_started', 'turn_complete', 'task_complete', 'turn_aborted'].includes(p?.type)) {
      epoch++;
      inTurn = p.type.endsWith('_started');
    }
    if (!inTurn || row.type !== 'response_item' || typeof p?.call_id !== 'string') continue;
    const line = offset + 1;
    if (['function_call', 'custom_tool_call'].includes(p.type)) {
      const nativeExec = p.type === 'custom_tool_call' && p.name === 'exec' && nativeIdentity(p, 'exec');
      calls.set(p.call_id, calls.has(p.call_id) ? null : { epoch, line, nativeExec });
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
      const waitOutput = p.type === 'function_call_output' && nativeIdentity(p, 'wait');
      outputs.set(p.call_id, outputs.has(p.call_id) ? null : { epoch, line, waitOutput });
    }
    if (p.type === 'custom_tool_call_output' && nativeIdentity(p, 'exec')) {
      const header = typeof p.output === 'string' ? p.output : p.output?.[0]?.text;
      const target = typeof header === 'string' && /^Script running with cell ID (g[1-9][0-9]*:[0-9]+)(?:\r?\n|$)/.exec(header)?.[1];
      if (target) {
        const key = epoch + '/' + target;
        receipts.set(key, receipts.has(key) ? null : { epoch, line, id: p.call_id });
      }
    }
    if (p.type === 'function_call' && p.name === 'wait' && nativeIdentity(p, 'wait')) {
      let args;
      try { args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments; } catch { continue; }
      if (generation.test(args?.cell_id)) waits.push({ key: epoch + '/' + args.cell_id, epoch, line, id: p.call_id });
    }
  }
  return waits.flatMap(wait => {
    const receipt = receipts.get(wait.key);
    const exec = receipt && calls.get(receipt.id);
    const output = outputs.get(wait.id);
    if (!exec?.nativeExec || exec.epoch !== wait.epoch || !calls.get(wait.id)
        || outputs.get(receipt.id)?.line !== receipt.line || !output?.waitOutput || output.epoch !== wait.epoch
        || !(exec.line < receipt.line && receipt.line < wait.line && wait.line < output.line)) return [];
    return [{ exec: exec.line, receipt: receipt.line, wait: wait.line, output: output.line }];
  });
}

async function inspect(bytes, rows, chains, basename) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-audit-witness-'));
  let index;
  try {
    const sessions = path.join(home, 'sessions');
    await fs.mkdir(sessions, { mode: 0o700 });
    await fs.writeFile(path.join(sessions, basename), bytes, { flag: 'wx', mode: 0o600 });
    index = await codex.buildSourceBackedIndex({ repoRoot: rows[0].payload.cwd, codexHome: home });
    const summary = index.sessionsById.get(rows[0].payload.id);
    assert.ok(summary);
    const session = await materializeSessionForIndex(index, summary);
    const main = session.logicalEvents.filter(event => event.layer === 'main');
    const owns = (event, line) => event.rawRefs.some(ref => ref.line === line);
    let split = 0, joined = 0, verified = 0;
    for (const chain of chains) {
      const exec = main.filter(event => owns(event, chain.exec) && owns(event, chain.receipt));
      const wait = main.filter(event => owns(event, chain.wait) && owns(event, chain.output));
      if (exec.length !== 1 || wait.length !== 1) continue;
      if (exec[0].id === wait[0].id) joined++;
      else if (exec[0].kind === 'code_mode_operation' && exec[0].codeModeOperation?.observationState === 'unknown'
          && wait[0].kind === 'other_tool_call') split++;
      for (const line of Object.values(chain)) {
        const raw = session.rawEvents.find(raw => raw.source.line === line);
        if (!raw) continue;
        const hydrated = await codex.readIndexedCodexRawRecord(index, session, raw);
        if (hydrated?.parsed?.payload?.call_id === rows[line - 1].payload.call_id
            && hydrated?.parsed?.payload?.type === rows[line - 1].payload.type) verified++;
      }
    }
    return { selectedFiles: 1, matchedWaits: chains.length, splitUnknownExecAndSeparateWait: split,
      joinedOwner: joined, rawOwnerChecks: verified, rawOwnerChecksExpected: 4 * chains.length };
  } finally {
    try { if (index?.projectQueryStore) disposeProjectQueryStore(index.projectQueryStore); }
    finally {
      assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(home).startsWith('codex-audit-witness-'));
      await fs.rm(home, { recursive: true, force: true });
    }
  }
}

async function main() {
  const candidates = [];
  await listPlain(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'), candidates);
  candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  let examined = 0, totalBytes = 0;
  for (const { file, stat } of candidates.slice(0, 40)) {
    if (totalBytes + stat.size > 96 * MiB) break;
    totalBytes += stat.size;
    examined++;
    const handle = await fs.open(file, 'r');
    const bytes = Buffer.alloc(stat.size);
    let pos = 0, stable;
    try {
      while (pos < stat.size) {
        const read = await handle.read(bytes, pos, stat.size - pos, pos);
        if (!read.bytesRead) break;
        pos += read.bytesRead;
      }
      const after = await handle.stat();
      stable = after.ino === stat.ino && after.mtimeMs === stat.mtimeMs && after.size === stat.size;
    } finally { await handle.close(); }
    if (!stable || pos < stat.size || !bytes.includes(Buffer.from('Script running with cell ID g'))) continue;
    let rows;
    try { rows = bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line)); } catch { continue; }
    const chains = qualifyingChains(rows);
    if (!chains.length) continue;
    console.log(JSON.stringify({ examined, ...await inspect(bytes, rows, chains, path.basename(file)) }));
    return;
  }
  console.log(JSON.stringify({ examined, selectedFiles: 0 }));
}

main().catch(() => { console.error('Local witness could not complete'); process.exitCode = 1; });
