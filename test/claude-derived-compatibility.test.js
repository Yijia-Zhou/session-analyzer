'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  analyzerForkedSkillSessionId,
  analyzerSubagentSessionId,
  analyzerWorkflowAgentSessionId,
  buildClaudeIndex,
  buildClaudeSourceBackedIndex,
  readClaudeRawRecord,
} = require('../src/claude');
const { filterSessions, getTimeline } = require('../src/codex');
const { buildClaudeEventDetail } = require('../src/claude-detail');
const { materializeSessionForIndex, validateIndexOwnership } = require('../src/source-adapters');

const TEMPLATE_ROOT = path.join(
  __dirname,
  'fixtures',
  'claude-derived-compatibility',
  'positive',
);

const PARENT_SOURCE_ID = 'parent-%-π';
const FORK_AGENT_ID = 'skill-%-ß';
const NORMAL_AGENT_ID = 'normal-%-ß';
const WORKFLOW_RUN_ID = 'run-%-Δ';
const WORKFLOW_TASK_ID = 'task-m2';
const WORKFLOW_ONE_AGENT_ID = 'workflow-%-one';
const WORKFLOW_TWO_AGENT_ID = 'workflow-%-two';
const SKILL_NAME = 'm2-skill-%-星';
const VERSION = '2.1.220';

// These are intentionally literal expectations: the compatibility contract is
// the serialized identity, independently of the helper implementation.
const PARENT_ID = 'claude-code:parent-%25-%CF%80';
const FORK_ID = `${PARENT_ID}:forked-skill:skill-%25-%C3%9F`;
const NORMAL_ID = `${PARENT_ID}:agent:normal-%25-%C3%9F`;
const WORKFLOW_ONE_ID = `${PARENT_ID}:workflow-agent:run-%25-%CE%94:workflow-%25-one`;
const WORKFLOW_TWO_ID = `${PARENT_ID}:workflow-agent:run-%25-%CE%94:workflow-%25-two`;

function parentForkLaunchContent(agentId = 'announced-%-child', skillName = SKILL_NAME) {
  return `<local-command-stdout>plain</local-command-stdout><forked-skill-launch>${JSON.stringify({
    skillName,
    agentId,
  })}</forked-skill-launch>`;
}

function parentFile(fixture) {
  return path.join(fixture.project, `${PARENT_SOURCE_ID}.jsonl`);
}

function forkRoot(fixture) {
  return path.join(fixture.parentStem, 'subagents');
}

function forkTranscript(fixture) {
  return path.join(forkRoot(fixture), `agent-${FORK_AGENT_ID}.jsonl`);
}

function forkEvidence(fixture) {
  return path.join(forkRoot(fixture), `agent-${FORK_AGENT_ID}.forked-skill.json`);
}

function forkMarker(fixture) {
  return path.join(forkRoot(fixture), `agent-${FORK_AGENT_ID}.forked-skill.marker.json`);
}

function normalMetadata(fixture) {
  return path.join(forkRoot(fixture), `agent-${NORMAL_AGENT_ID}.meta.json`);
}

function workflowRoot(fixture) {
  return path.join(fixture.parentStem, 'subagents', 'workflows', WORKFLOW_RUN_ID);
}

function workflowManifest(fixture) {
  return path.join(fixture.parentStem, 'workflows', `${WORKFLOW_RUN_ID}.json`);
}

function workflowJournal(fixture) {
  return path.join(workflowRoot(fixture), 'journal.jsonl');
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  await visit(root);
  return files;
}

async function replaceRepoPlaceholders(root, repoRoot) {
  for (const file of await walkFiles(root)) {
    if (!file.endsWith('.jsonl')) continue;
    const source = await fsp.readFile(file, 'utf8');
    const records = source.trim().split(/\r?\n/u).filter(Boolean).map((line) => {
      const record = JSON.parse(line);
      if (record.cwd === '__REPO_ROOT__') record.cwd = repoRoot;
      return record;
    });
    await writeJsonl(file, records);
  }
}

async function makeFixture(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-claude-derived-'));
  const repoRoot = path.join(home, 'repo');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.cp(TEMPLATE_ROOT, home, { recursive: true });
  await replaceRepoPlaceholders(home, repoRoot);
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  return {
    home,
    repoRoot,
    project: path.join(home, 'projects', '-m2-derived'),
    parentStem: path.join(home, 'projects', '-m2-derived', PARENT_SOURCE_ID),
  };
}

async function readJsonl(file) {
  const source = await fsp.readFile(file, 'utf8');
  return source.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJsonl(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function updateJsonl(file, update) {
  const records = await readJsonl(file);
  const changed = await update(records);
  await writeJsonl(file, changed || records);
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await fsp.writeFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

async function updateManifest(fixture, update) {
  const manifest = await readJson(workflowManifest(fixture));
  const changed = await update(manifest);
  await writeJson(workflowManifest(fixture), changed || manifest);
}

async function build(fixture, options = {}) {
  return buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.home,
    ...options,
  });
}

function session(index, id) {
  const value = index.sessionsById.get(id);
  assert.ok(value, `session ${id} is present`);
  return value;
}

function retainedIds(index) {
  return [...index.sessionsById.keys()].sort();
}

function convergentSignature(index) {
  return index.sessions.map((value) => ({
    id: value.id,
    sourceSessionId: value.sourceSessionId,
    sourceDerivedId: value.sourceDerivedId,
    sourceFile: value.sourceFile,
    sourceClientVersion: value.sourceClientVersion,
    parentSessionId: value.parentSessionId,
    primarySessionMetaKind: value.primarySessionMetaKind,
    derivedRunId: value.derivedRunId,
    projectAssociation: value.projectAssociation,
    matchesRepo: value.matchesRepo,
    spawnDepth: value.spawnDepth,
    rawEvents: value.rawEvents.map((raw) => ({ rawId: raw.rawId, line: raw.line })),
    logicalEvents: value.logicalEvents.map((event) => ({
      id: event.id,
      kind: event.kind,
      layer: event.layer,
      status: event.status,
      rawRefs: (event.rawRefs || []).map((ref) => ref.rawId),
    })),
    counts: value.counts,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function comparableTotals(index) {
  const totals = { ...index.totals };
  delete totals.reusedFileCount;
  return totals;
}

function assertUnrelatedSurvivors(index, label) {
  assert.ok(index.sessionsById.has(PARENT_ID), `${label}: parent remains available`);
  assert.ok(index.sessionsById.has(NORMAL_ID), `${label}: ordinary subagent remains available`);
}

test('Milestone 2 positive bundle admits forked-skill/workflow children and preserves ordinary subagent identity', async (t) => {
  const fixture = await makeFixture(t);
  const progress = [];
  const index = await build(fixture, { onProgress: (entry) => progress.push(entry) });

  assert.deepEqual(retainedIds(index), [
    FORK_ID,
    NORMAL_ID,
    PARENT_ID,
    WORKFLOW_ONE_ID,
    WORKFLOW_TWO_ID,
  ].sort());
  assert.equal(index.sessions.length, 5);
  assert.equal(index.totals.sessionCount, index.sessions.length);
  assert.equal(index.totals.candidateFileCount, 1);
  assert.equal(index.totals.indexedFileCount, index.sessions.length);
  assert.equal(index.totals.rawEventCount, index.sessions.reduce((sum, value) => sum + value.rawEvents.length, 0));
  assert.equal(index.totals.eventCount, index.sessions.reduce((sum, value) => sum + value.logicalEvents.length, 0));
  assert.ok(index.totals.rawEventCount > 0);
  assert.ok(index.totals.eventCount > 0);

  const complete = progress.at(-1);
  assert.equal(complete.phase, 'complete');
  assert.equal(complete.sessionCount, index.totals.sessionCount);
  assert.equal(complete.eventCount, index.totals.eventCount);
  assert.equal(complete.rawEventCount, index.totals.rawEventCount);
  assert.equal(complete.indexedFileCount, index.totals.indexedFileCount);

  const parent = session(index, PARENT_ID);
  const fork = session(index, FORK_ID);
  const normal = session(index, NORMAL_ID);
  const workflowOne = session(index, WORKFLOW_ONE_ID);
  const workflowTwo = session(index, WORKFLOW_TWO_ID);
  assert.equal(parent.sourceSessionId, PARENT_SOURCE_ID);
  assert.equal(parent.sourceClientVersion, VERSION);
  assert.equal(parent.parentSessionId, '');
  assert.equal(parent.primarySessionMetaKind, '');
  assert.equal(normal.id, analyzerSubagentSessionId(PARENT_SOURCE_ID, NORMAL_AGENT_ID));
  assert.equal(fork.id, analyzerForkedSkillSessionId(PARENT_SOURCE_ID, FORK_AGENT_ID));
  assert.equal(
    workflowOne.id,
    analyzerWorkflowAgentSessionId(PARENT_SOURCE_ID, WORKFLOW_RUN_ID, WORKFLOW_ONE_AGENT_ID),
  );

  for (const child of [fork, normal, workflowOne, workflowTwo]) {
    assert.equal(child.sourceSessionId, PARENT_SOURCE_ID);
    assert.equal(child.sourceClientVersion, VERSION);
    assert.equal(child.parentSessionId, PARENT_ID);
    assert.equal(child.projectAssociation, 'parent-inherited');
    assert.equal(child.matchesRepo, true);
    assert.deepEqual([...child.cwdSet], [fixture.repoRoot]);
    assert.equal(child.spawnDepth, 1);
    assert.ok(child.sourceFile.startsWith('-m2-derived/parent-%-π/'));
  }
  assert.equal(fork.sourceDerivedId, FORK_AGENT_ID);
  assert.equal(fork.primarySessionMetaKind, 'forked-skill');
  assert.equal(fork.derivedRelationship.kind, 'forked-skill');
  assert.equal(fork.derivedRelationship.ownerSessionId, PARENT_ID);
  assert.equal(fork.derivedRelationship.agentId, FORK_AGENT_ID);
  assert.equal(fork.derivedRelationship.skillName, SKILL_NAME);
  assert.equal(fork.derivedRelationship.launchRawRefs.length, 1);
  assert.equal(fork.derivedRelationship.evidenceFiles.length, 3);
  assert.equal(workflowOne.sourceDerivedId, WORKFLOW_ONE_AGENT_ID);
  assert.equal(workflowOne.primarySessionMetaKind, 'workflow-agent');
  assert.equal(workflowOne.derivedRunId, WORKFLOW_RUN_ID);
  assert.equal(workflowOne.derivedRelationship.kind, 'workflow-agent');
  assert.equal(workflowOne.derivedRelationship.ownerSessionId, PARENT_ID);
  assert.equal(workflowOne.derivedRelationship.runId, WORKFLOW_RUN_ID);
  assert.equal(workflowOne.derivedRelationship.taskId, WORKFLOW_TASK_ID);
  assert.equal(workflowOne.derivedRelationship.agentId, WORKFLOW_ONE_AGENT_ID);
  assert.ok(workflowOne.derivedRelationship.parentRawRefs.length >= 2);
  assert.equal(workflowOne.derivedRelationship.evidenceFiles.length, 3);
  assert.equal(workflowTwo.sourceDerivedId, WORKFLOW_TWO_AGENT_ID);
  assert.equal(workflowTwo.primarySessionMetaKind, 'workflow-agent');
  assert.equal(workflowTwo.derivedRunId, WORKFLOW_RUN_ID);
  assert.notEqual(workflowOne.id, workflowTwo.id);
  assert.ok([
    ...fork.derivedRelationship.evidenceFiles,
    ...workflowOne.derivedRelationship.evidenceFiles,
  ].every((evidence) => evidence.file && !path.isAbsolute(evidence.file)));

  const forkTimeline = getTimeline(index, fork.id, {
    offset: 0,
    limit: 20,
    layer: 'main',
    q: '',
    kind: '',
    status: '',
    tool: '',
    codeModeRequest: '',
    file: '',
    locale: 'en',
  });
  assert.equal(forkTimeline.session.isDerivedSession, true);
  assert.equal(forkTimeline.session.derivedKind, 'forked-skill');
  assert.equal(forkTimeline.session.sourceDerivedId, FORK_AGENT_ID);
  assert.equal(forkTimeline.session.parentSessionId, PARENT_ID);
  assert.equal(forkTimeline.session.parentSessionTitle, parent.title);
  assert.equal(forkTimeline.session.derivedRelationship.kind, 'forked-skill');

  const workflowTimeline = getTimeline(index, workflowOne.id, {
    offset: 0,
    limit: 20,
    layer: 'main',
    q: '',
    kind: '',
    status: '',
    tool: '',
    codeModeRequest: '',
    file: '',
    locale: 'en',
  });
  assert.equal(workflowTimeline.session.isDerivedSession, true);
  assert.equal(workflowTimeline.session.derivedKind, 'workflow-agent');
  assert.equal(workflowTimeline.session.derivedRunId, WORKFLOW_RUN_ID);
  assert.equal(workflowTimeline.session.derivedRelationship.kind, 'workflow-agent');

  const projectSearch = filterSessions(index, {
    q: 'First worker complete',
    locale: 'en',
  });
  const searchedWorkflow = projectSearch.sessions.find((value) => value.id === WORKFLOW_ONE_ID);
  assert.ok(searchedWorkflow, 'workflow-agent remains discoverable through project event search');
  assert.equal(searchedWorkflow.derivedRelationship.kind, 'workflow-agent');
  const workflowDetail = buildClaudeEventDetail(
    workflowOne,
    workflowOne.logicalEvents[0].id,
    'main',
    { locale: 'en' },
  );
  assert.equal(workflowDetail.sourceKind, 'claude-code');
  assert.ok(workflowDetail.meta.source);

  const parentRecords = await readJsonl(parentFile(fixture));
  const launch = parentRecords.find((record) => record.uuid === 'parent-forked-skill-launch');
  assert.equal(launch.content, parentForkLaunchContent());
  assert.notEqual(JSON.parse(launch.content.match(/<forked-skill-launch>(.*?)<\/forked-skill-launch>/u)[1]).agentId, FORK_AGENT_ID);

  assert.ok(fork.sourceFile.endsWith(`/subagents/agent-${FORK_AGENT_ID}.jsonl`));
  assert.ok(workflowOne.sourceFile.endsWith(`/subagents/workflows/${WORKFLOW_RUN_ID}/agent-${WORKFLOW_ONE_AGENT_ID}.jsonl`));
  const forkReadback = await readClaudeRawRecord(index, fork, fork.rawEvents[0]);
  assert.ok(forkReadback);
  assert.equal(forkReadback.parsed.sessionId, PARENT_SOURCE_ID);
  assert.equal(forkReadback.parsed.agentId, FORK_AGENT_ID);
  const workflowReadback = await readClaudeRawRecord(index, workflowOne, workflowOne.rawEvents[1]);
  assert.ok(workflowReadback);
  assert.equal(workflowReadback.parsed.sessionId, PARENT_SOURCE_ID);
  assert.equal(workflowReadback.parsed.agentId, WORKFLOW_ONE_AGENT_ID);

  for (const value of index.sessions) {
    for (const raw of value.rawEvents) {
      assert.ok(value.logicalEvents.some((event) => (
        (event.rawRefs || []).some((ref) => ref.rawId === raw.rawId)
      )), `${value.id}: Raw ${raw.line} remains reachable`);
    }
  }
});

test('strict Claude materialization preserves forked-skill and workflow ownership exactly', async (t) => {
  const fixture = await makeFixture(t);
  const [resident, indexed] = await Promise.all([
    build(fixture),
    buildClaudeSourceBackedIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home }),
  ]);
  assert.equal(validateIndexOwnership(indexed), 'claude-code');
  assert.deepEqual(retainedIds(indexed), retainedIds(resident));
  for (const id of [FORK_ID, NORMAL_ID, WORKFLOW_ONE_ID, WORKFLOW_TWO_ID]) {
    const expected = resident.sessionsById.get(id);
    const indexedSession = indexed.sessionsById.get(id);
    const materialized = await materializeSessionForIndex(indexed, indexedSession);
    assert.deepEqual(materialized.derivedRelationship, expected.derivedRelationship);
    assert.deepEqual(materialized.rawEvents, expected.rawEvents);
    assert.deepEqual(materialized.logicalEvents, expected.logicalEvents);
    assert.deepEqual(materialized.analysis, expected.analysis);
  }
});

test('Milestone 2 derived identity components remain collision-safe', () => {
  const parent = 'parent:/%/π/\ud800';
  const fork = analyzerForkedSkillSessionId(parent, 'agent:/%/ß/\udfff');
  const workflow = analyzerWorkflowAgentSessionId(parent, 'run:/%/Δ/\ud800', 'agent:/%/ß/\udfff');
  assert.notEqual(fork, analyzerForkedSkillSessionId('parent', '/%/π/\ud800:agent:/%/ß/\udfff'));
  assert.notEqual(workflow, analyzerWorkflowAgentSessionId(parent, 'run', '/%/Δ/\ud800:agent:/%/ß/\udfff'));
  assert.notEqual(workflow, analyzerSubagentSessionId(parent, 'run:/%/Δ/\ud800:agent:/%/ß/\udfff'));
  assert.match(fork, /%3A|%2F|%25|%uD800|%uDFFF/u);
  assert.match(workflow, /%3A|%2F|%25|%uD800|%uDFFF/u);
});

test('ordinary subagent admission does not publish missing or malformed optional metadata as evidence', async (t) => {
  const fixture = await makeFixture(t);
  await fsp.rm(normalMetadata(fixture));
  const index = await build(fixture);
  const normal = session(index, NORMAL_ID);

  assert.equal(normal.primarySessionMetaKind, 'subagent');
  assert.equal(normal.derivedRelationship.kind, 'subagent');
  assert.deepEqual(normal.derivedRelationship.evidenceFiles, []);

  const timeline = getTimeline(index, normal.id, {
    offset: 0,
    limit: 20,
    layer: 'main',
    q: '',
    kind: '',
    status: '',
    tool: '',
    codeModeRequest: '',
    file: '',
    locale: 'en',
  });
  assert.deepEqual(timeline.session.derivedRelationship.evidenceFiles, []);

  await fsp.writeFile(normalMetadata(fixture), '{"agentType":', 'utf8');
  const malformedIndex = await build(fixture);
  const malformedNormal = session(malformedIndex, NORMAL_ID);
  assert.equal(malformedNormal.primarySessionMetaKind, 'subagent');
  assert.equal(malformedNormal.derivedRelationship.kind, 'subagent');
  assert.deepEqual(malformedNormal.derivedRelationship.evidenceFiles, []);
});

test('Milestone 2 forked-skill admission fails closed for malformed, duplicate, contradictory, or mismatched evidence', async (t) => {
  const cases = [
    {
      label: 'malformed launch',
      expectedFork: false,
      mutate: (fixture) => updateJsonl(parentFile(fixture), (records) => {
        records.find((record) => record.uuid === 'parent-forked-skill-launch').content = (
          '<local-command-stdout>plain</local-command-stdout><forked-skill-launch>{"skillName":</forked-skill-launch>'
        );
        return records;
      }),
    },
    {
      label: 'duplicate launch',
      expectedFork: false,
      mutate: (fixture) => updateJsonl(parentFile(fixture), (records) => {
        const launch = records.find((record) => record.uuid === 'parent-forked-skill-launch');
        records.push({ ...launch, uuid: 'parent-forked-skill-launch-duplicate' });
        return records;
      }),
    },
    {
      label: 'missing marker sidecar',
      expectedFork: false,
      mutate: (fixture) => fsp.rm(forkMarker(fixture)),
    },
    {
      label: 'missing skill sidecar',
      expectedFork: false,
      mutate: (fixture) => fsp.rm(forkEvidence(fixture)),
    },
    {
      label: 'malformed sidecar',
      expectedFork: false,
      mutate: (fixture) => fsp.writeFile(forkEvidence(fixture), '{"skillName":', 'utf8'),
    },
    {
      label: 'contradictory sidecar skill',
      expectedFork: false,
      mutate: (fixture) => writeJson(forkEvidence(fixture), {
        skillName: 'other-skill',
        attributionName: 'other-skill',
      }),
    },
    {
      label: 'duplicated sidecar values',
      expectedFork: false,
      mutate: (fixture) => writeJson(forkEvidence(fixture), [
        { skillName: SKILL_NAME, attributionName: SKILL_NAME },
        { skillName: SKILL_NAME, attributionName: SKILL_NAME },
      ]),
    },
    {
      label: 'child session mismatch',
      expectedFork: false,
      mutate: (fixture) => updateJsonl(forkTranscript(fixture), (records) => {
        records.forEach((record) => { record.sessionId = 'foreign-child'; });
        return records;
      }),
    },
    {
      label: 'contradictory child session declarations',
      expectedFork: false,
      mutate: (fixture) => updateJsonl(forkTranscript(fixture), (records) => {
        records.at(-1).sessionId = 'foreign-child';
        return records;
      }),
    },
    {
      label: 'child version mismatch',
      expectedFork: false,
      mutate: (fixture) => updateJsonl(forkTranscript(fixture), (records) => {
        records.forEach((record) => { record.version = '2.1.219'; });
        return records;
      }),
    },
    {
      label: 'child filename agent mismatch',
      expectedFork: false,
      mutate: (fixture) => updateJsonl(forkTranscript(fixture), (records) => {
        records.forEach((record) => { record.agentId = 'different-agent'; });
        return records;
      }),
    },
  ];

  for (const item of cases) {
    const fixture = await makeFixture(t);
    await item.mutate(fixture);
    const index = await build(fixture);
    assertUnrelatedSurvivors(index, item.label);
    assert.equal(index.sessionsById.has(FORK_ID), item.expectedFork, item.label);
    assert.ok(index.sessionsById.has(WORKFLOW_ONE_ID), `${item.label}: workflow one survives independently`);
    assert.ok(index.sessionsById.has(WORKFLOW_TWO_ID), `${item.label}: workflow two survives independently`);
  }
});

test('Milestone 2 Workflow admission requires exact manifest/progress/journal ownership and one parent receipt', async (t) => {
  const cases = [
    {
      label: 'missing manifest',
      mutate: (fixture) => fsp.rm(workflowManifest(fixture)),
    },
    {
      label: 'wrong manifest task',
      mutate: (fixture) => updateManifest(fixture, (manifest) => {
        manifest.taskId = 'wrong-task';
        return manifest;
      }),
    },
    {
      label: 'duplicated full progress entry',
      mutate: (fixture) => updateManifest(fixture, (manifest) => {
        manifest.workflowProgress.push({ ...manifest.workflowProgress[0] });
        return manifest;
      }),
    },
    {
      label: 'unmatched full progress entry',
      mutate: (fixture) => updateManifest(fixture, (manifest) => {
        manifest.workflowProgress.push({
          ...manifest.workflowProgress[0],
          agentId: 'unmatched-worker',
        });
        return manifest;
      }),
    },
    {
      label: 'missing journal result',
      mutate: (fixture) => readJsonl(workflowJournal(fixture)).then((rows) => writeJsonl(workflowJournal(fixture), rows.slice(0, 3))),
    },
    {
      label: 'duplicate journal key',
      mutate: (fixture) => updateJsonl(workflowJournal(fixture), (rows) => {
        rows[2].key = rows[0].key;
        return rows;
      }),
    },
    {
      label: 'mismatched journal child',
      mutate: (fixture) => updateJsonl(workflowJournal(fixture), (rows) => {
        rows[1].agentId = WORKFLOW_TWO_AGENT_ID;
        return rows;
      }),
    },
    {
      label: 'reversed journal lifecycle',
      mutate: (fixture) => updateJsonl(workflowJournal(fixture), (rows) => [
        rows[1],
        rows[0],
        rows[2],
        rows[3],
      ]),
    },
    {
      label: 'duplicate parent receipt',
      mutate: (fixture) => updateJsonl(parentFile(fixture), (records) => {
        const launch = records.find((record) => record.uuid === 'parent-workflow-result');
        records.push({ ...launch, uuid: 'parent-workflow-result-duplicate' });
        return records;
      }),
    },
  ];

  for (const item of cases) {
    const fixture = await makeFixture(t);
    await item.mutate(fixture);
    const index = await build(fixture);
    assertUnrelatedSurvivors(index, item.label);
    assert.ok(index.sessionsById.has(FORK_ID), `${item.label}: forked-skill survives independently`);
    assert.equal(index.sessionsById.has(WORKFLOW_ONE_ID), false, `${item.label}: workflow one rejected`);
    assert.equal(index.sessionsById.has(WORKFLOW_TWO_ID), false, `${item.label}: workflow two rejected`);
  }
});

test('Milestone 2 explicit layouts ignore unrelated recursive JSONL', async (t) => {
  const fixture = await makeFixture(t);
  const unrelated = path.join(fixture.parentStem, 'nested', 'deeper', 'agent-ghost.jsonl');
  await writeJsonl(unrelated, [{
    type: 'user',
    sessionId: PARENT_SOURCE_ID,
    agentId: 'ghost',
    cwd: fixture.repoRoot,
    version: VERSION,
    uuid: 'ghost-user',
    timestamp: '2026-08-10T12:01:00.000Z',
    message: { role: 'user', content: 'Unrelated recursive transcript.' },
  }]);
  const index = await build(fixture);
  assert.deepEqual(retainedIds(index), [
    FORK_ID,
    NORMAL_ID,
    PARENT_ID,
    WORKFLOW_ONE_ID,
    WORKFLOW_TWO_ID,
  ].sort());
  assert.equal(index.sessionsById.has(`${PARENT_ID}:agent:ghost`), false);
});

test('Milestone 2 reindex invalidates child, marker, journal, and manifest evidence and converges with a cold index', async (t) => {
  const cases = [
    {
      label: 'child transcript',
      mutate: (fixture) => fsp.appendFile(forkTranscript(fixture), `${JSON.stringify({
        type: 'assistant',
        sessionId: PARENT_SOURCE_ID,
        agentId: FORK_AGENT_ID,
        cwd: fixture.repoRoot,
        version: VERSION,
        uuid: 'skill-reindex-assistant',
        timestamp: '2026-08-10T12:02:00.000Z',
        message: { id: 'skill-reindex-message', role: 'assistant', content: [{ type: 'text', text: 'Changed.' }] },
      })}\n`, 'utf8'),
    },
    {
      label: 'fork marker',
      mutate: (fixture) => writeJson(forkMarker(fixture), { forkedSkill: true, skillName: `${SKILL_NAME}-changed` }),
    },
    {
      label: 'workflow journal',
      mutate: (fixture) => updateJsonl(workflowJournal(fixture), (rows) => {
        rows[1].result.types.push('image');
        return rows;
      }),
    },
    {
      label: 'workflow manifest',
      mutate: (fixture) => updateManifest(fixture, (manifest) => {
        manifest.workflowProgress[1].summary = 'Changed manifest evidence.';
        return manifest;
      }),
    },
  ];

  for (const item of cases) {
    const fixture = await makeFixture(t);
    const first = await build(fixture);
    const unchanged = await build(fixture, { previousIndex: first });
    assert.equal(unchanged.totals.reusedFileCount, first.totals.indexedFileCount, `${item.label}: unchanged bundle reused`);
    await item.mutate(fixture);
    const changed = await build(fixture, { previousIndex: unchanged });
    const cold = await build(fixture);
    assert.ok(
      changed.totals.reusedFileCount < unchanged.totals.reusedFileCount,
      `${item.label}: evidence change invalidates at least one reused file`,
    );
    assert.deepEqual(convergentSignature(changed), convergentSignature(cold), `${item.label}: sessions converge`);
    assert.deepEqual(comparableTotals(changed), comparableTotals(cold), `${item.label}: totals converge`);
  }
});

test('Milestone 2 reindex removes an accepted derived relationship instead of retaining a stale child', async (t) => {
  const fixture = await makeFixture(t);
  const first = await build(fixture);
  assert.ok(first.sessionsById.has(FORK_ID));
  await fsp.rm(forkMarker(fixture));
  const changed = await build(fixture, { previousIndex: first });
  const cold = await build(fixture);
  assert.equal(changed.sessionsById.has(FORK_ID), false);
  assertUnrelatedSurvivors(changed, 'relationship removal');
  assert.deepEqual(convergentSignature(changed), convergentSignature(cold));
  assert.deepEqual(comparableTotals(changed), comparableTotals(cold));
});

test('Milestone 2 discovery and Raw readback reject a physical linked-directory escape when the platform permits links', async (t) => {
  const fixture = await makeFixture(t);
  const first = await build(fixture);
  const child = session(first, WORKFLOW_ONE_ID);
  const outsideRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-claude-derived-outside-'));
  t.after(() => fsp.rm(outsideRoot, { recursive: true, force: true }));
  const runRoot = workflowRoot(fixture);
  const outsideRun = path.join(outsideRoot, WORKFLOW_RUN_ID);
  await fsp.cp(runRoot, outsideRun, { recursive: true });
  await fsp.rm(runRoot, { recursive: true, force: true });
  try {
    await fsp.symlink(outsideRun, runRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`directory links unavailable: ${error.code || error.message}`);
    return;
  }

  assert.equal(await readClaudeRawRecord(first, child, child.rawEvents[0]), null);
  const changed = await build(fixture, { previousIndex: first });
  assert.equal(changed.sessionsById.has(WORKFLOW_ONE_ID), false);
  assert.equal(changed.sessionsById.has(WORKFLOW_TWO_ID), false);
  assertUnrelatedSurvivors(changed, 'linked-directory escape');
  assert.ok(changed.sessionsById.has(FORK_ID), 'linked-directory escape: forked-skill survives independently');
});
