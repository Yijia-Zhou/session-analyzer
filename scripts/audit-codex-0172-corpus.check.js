'use strict';

// Opt-in synthetic validation, including compression, record cap, ownership joins and privacy.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { inventory, scan } = require('./audit-codex-0172-corpus');

async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-audit-check-'));
  const marker = 'SENSITIVE_SYNTHETIC_SENTINEL';
  const parent = 'bb-' + marker;
  try {
    for (const sub of ['sessions', 'archived_sessions']) await fs.mkdir(path.join(home, sub));
    const rows = [
      { type: 'session_meta', payload: { id: parent, source: 'cli', cli_version: '0.172.0-' + marker } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: marker, output: marker } },
      { type: 'response_item', payload: { type: 'function_call', call_id: marker, arguments: { [marker]: marker } } },
      { type: 'event_msg', payload: { type: marker, [marker]: marker, content_item_metadata: [{ history_sequence: 1 }] } },
      { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'DeliveredAssistantMessage', id: marker } } },
      { type: 'session_meta', payload: { id: parent, cli_version: '0.162.1' } },
      { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'McpToolCall', id: 'item-A', tool: marker, environmentId: marker } } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'item-A', name: marker, namespace: 'mcp__0123456789ab__' + marker } },
      { type: 'response_item', payload: { type: 'function_call_output', output: [{ type: 'input_text', text: 'Script running with cell ID g2:7\nLive output:' }] } },
      { type: 'response_item', payload: { type: 'function_call_output', output: 'Example only\nScript running with cell ID g2:7\n' } },
      { type: 'response_item', payload: { type: 'function_call', name: 'wait', arguments: '{"cell_id":"g2:7"}' } },
    ];
    const file = path.join(home, 'sessions', marker + '.jsonl');
    const header = rows.map(JSON.stringify).join('\n') + '\n';
    await fs.writeFile(file, header + 'x'.repeat(32 * 1024 ** 2 + 1) + '\n?\n');
    const child = JSON.stringify({ type: 'session_meta', payload: { id: 'cc-' + marker, forked_from_id: parent } });
    await fs.writeFile(path.join(home, 'archived_sessions', marker + '.jsonl.zst'), zlib.zstdCompressSync(child));
    const { stats, files } = inventory([home]);
    // Both possible roots are synthetic. A configured home must be exclusive.
    const profile = path.join(home, 'profile');
    const fallback = path.join(profile, '.codex', 'sessions');
    await fs.mkdir(fallback, { recursive: true });
    await fs.writeFile(path.join(fallback, 'control.jsonl'), header);
    const cli = execFileSync(process.execPath, [require.resolve('./audit-codex-0172-corpus'), '--inventory'], {
      env: { ...process.env, HOME: profile, USERPROFILE: profile, CODEX_HOME: home }, encoding: 'utf8',
    });
    assert.equal(JSON.parse(cli).inventory.formats['sessions.plain'].files, 1);
    await fs.appendFile(file, 'x');
    const result = await scan(files);
    assert.equal(stats.formats['sessions.plain'].files, 1);
    assert.equal(result.references['forked_from_id.ownerSeen'], 1);
    assert.equal(result.anomalies.changedSinceInventory, 1);
    assert.equal(result.anomalies.invalidJson, 1);
    assert.equal(result.anomalies.oversizeRecord, 1);
    assert.equal(result.anomalies.filesWithSeveralMetaVersions, 1);
    assert.equal(result.anomalies.tailWithoutLF, 1);
    assert.equal(result.firstMetadataVersions['0.172.0-qualified'], 1);
    assert.equal(result.references['output.callIdSeenInFile'], 1);
    assert.equal(result.markerRecords['canonical.DeliveredAssistantMessage'], 1);
    assert.equal(result.markerRecords['event_msg.other payload.content_item_metadata[].history_sequence number'], 1);
    assert.equal(result.outcomes.readToInventoryEnd, 2);
    assert.equal(JSON.stringify([stats, result]).includes(marker), false);
    const focused = await scan(files, true);
    assert.equal(focused.supplementRecords['plain.mcpJoin.environmentId=nonemptyString/environment_id=absent.nameAndHashNamespaceMatch'], 1);
    assert.equal(focused.supplementRecords['plain.output.generationCellRunningLine'], 1);
    assert.equal(focused.supplementRecords['plain.generationWait.receiptInFile'], 1);
    assert.equal(JSON.stringify(focused).includes(marker), false);
    console.log('Synthetic corpus checks passed.');
  } finally {
    await fs.rm(home, { force: true, recursive: true });
  }
}
main().catch(() => { console.error('Synthetic corpus check failed.'); process.exitCode = 1; });
