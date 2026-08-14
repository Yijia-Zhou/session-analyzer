'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const scenario = require('../showcase/scenarios/readme/scenario');

const repoRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(repoRoot, 'output', 'showcase');
const codexHome = path.join(outputRoot, 'codex-home');
const workspaceRoot = path.join(outputRoot, 'workspace');
const projectRoot = path.join(workspaceRoot, ...scenario.project.relativePath.slice(1));

const DERIVED_KINDS = Object.freeze({
  review: Object.freeze({ sourceSubagent: 'review', defaultNickname: 'Review' }),
  subagent: Object.freeze({ sourceSubagent: 'subagent', defaultNickname: 'Subagent' }),
});

function assertInside(target, parent) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (resolvedTarget !== resolvedParent && !resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Refusing to write outside generated output: ${resolvedTarget}`);
  }
}

function isoFromParts(date, time, offsetSeconds = 0) {
  const timePart = String(time).startsWith(`${date}T`) ? String(time).slice(date.length + 1) : String(time);
  const base = Date.parse(`${date}T${timePart.replace(/-/g, ':')}.000Z`);
  if (!Number.isFinite(base)) throw new Error(`Invalid showcase timestamp: ${date} ${time}`);
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function sessionFilePath(session) {
  const [year, month, day] = session.date.split('-');
  const filename = `rollout-${session.date}T${session.time.slice(11)}-${session.id}.jsonl`;
  return path.join(codexHome, 'sessions', year, month, day, filename);
}

function projectConfigText(projectPath) {
  // TOML literal strings cannot escape a single quote. Use a basic quoted key
  // so apostrophes and Windows backslashes remain valid in the generated file.
  return `[projects.${JSON.stringify(String(projectPath))}]\n`;
}

function patchText(files) {
  const sections = ['*** Begin Patch'];
  for (const [file, change] of Object.entries(files || {})) {
    sections.push(`*** Update File: ${file}`);
    sections.push(change.unified_diff || '');
  }
  sections.push('*** End Patch');
  return sections.join('\n');
}

function formatCommandOutput(event) {
  const wallTime = event.status === 'failed' ? '0.7s' : '0.9s';
  const output = event.output || '';
  return `Exit code: ${event.exitCode}\nWall time: ${wallTime}\nOutput:\n${output}`;
}

function pushMessage(records, timestamp, event, role, text) {
  const responseType = role === 'user' ? 'input_text' : 'output_text';
  const eventType = role === 'user' ? 'user_message' : 'agent_message';
  const responseRecord = {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      content: [{ type: responseType, text }],
      turn_id: event.turn,
    },
  };
  const eventRecord = {
    timestamp,
    type: 'event_msg',
    payload: {
      type: eventType,
      message: text,
      turn_id: event.turn,
      images: [],
      local_images: [],
      text_elements: [],
    },
  };
  if (role === 'user') records.push(responseRecord, eventRecord);
  else records.push(eventRecord, responseRecord);
}

function pushPlan(records, event, index, date, time) {
  const planText = [
    '<proposed_plan>',
    event.explanation,
    '',
    ...event.steps.map(([step, status]) => `- ${status}: ${step}`),
    '</proposed_plan>',
  ].join('\n');
  const timestamp = isoFromParts(date, time, index);
  records.push({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: event.turn,
      item: { type: 'Plan', text: planText },
    },
  });
  records.push({
    timestamp: isoFromParts(date, time, index + 0.05),
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      turn_id: event.turn,
      content: [{ type: 'output_text', text: planText }],
    },
  });
}

function pushCommand(records, event, index, projectCwd, date, time) {
  const callId = `call-${event.command.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-${index}`;
  const commandTimestamp = isoFromParts(date, time, index);
  const command = event.command;
  records.push({
    timestamp: commandTimestamp,
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'shell_command',
      call_id: callId,
      turn_id: event.turn,
      arguments: {
        command,
        workdir: projectCwd,
      },
    },
  });
  records.push({
    timestamp: isoFromParts(date, time, index + 0.1),
    type: 'event_msg',
    payload: {
      type: 'exec_command_end',
      call_id: callId,
      turn_id: event.turn,
      command,
      cwd: projectCwd,
      stdout: event.output,
      stderr: event.stderr || '',
      aggregated_output: event.output,
      exit_code: event.exitCode,
      duration: { secs: event.status === 'failed' ? 0.7 : 0.9, nanos: 0 },
      status: event.status === 'failed' ? 'failed' : 'completed',
    },
  });
  records.push({
    timestamp: isoFromParts(date, time, index + 0.2),
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: callId,
      turn_id: event.turn,
      output: formatCommandOutput(event),
    },
  });
}

function pushPatch(records, event, index, date, time) {
  const callId = `call-apply-patch-${index}`;
  const timestamp = isoFromParts(date, time, index);
  records.push({
    timestamp,
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'apply_patch',
      call_id: callId,
      turn_id: event.turn,
      input: patchText(event.files),
    },
  });
  records.push({
    timestamp: isoFromParts(date, time, index + 0.1),
    type: 'response_item',
    payload: {
      type: 'custom_tool_call_output',
      call_id: callId,
      turn_id: event.turn,
      output: JSON.stringify({
        output: event.output,
        metadata: {
          status: 'success',
          duration_seconds: 0.2,
        },
      }),
    },
  });
}

function buildSessionRecords(session, projectCwd) {
  const records = [];
  const sessionTimestamp = isoFromParts(session.date, session.time, 0);
  const meta = {
    id: session.id,
    cwd: projectRoot,
  };
  if (session.derivedFrom) {
    const parent = scenario.sessions.find((candidate) => candidate.key === session.derivedFrom);
    if (!parent) throw new Error(`Unknown derived parent: ${session.derivedFrom}`);
    const derivedKind = DERIVED_KINDS[session.derivedKind];
    if (!derivedKind) {
      throw new Error(`Unsupported derived session kind: ${session.derivedKind || '(missing)'}`);
    }
    meta.session_id = parent.id;
    meta.parent_thread_id = parent.id;
    if (session.materializedFrom) meta.forked_from_id = parent.id;
    meta.thread_source = 'subagent';
    meta.source = { subagent: derivedKind.sourceSubagent };
    meta.agent_nickname = session.agentNickname || derivedKind.defaultNickname;
  }
  records.push({ timestamp: sessionTimestamp, type: 'session_meta', payload: meta });

  if (session.materializedFrom) {
    const parent = scenario.sessions.find((candidate) => candidate.key === session.materializedFrom);
    if (!parent) throw new Error(`Unknown materialized parent: ${session.materializedFrom}`);
    records.push(...buildSessionRecords(parent, projectCwd).map((record) => structuredClone(record)));
  }

  const eventDate = session.date;
  const eventTime = session.time.slice(11);
  let offset = 1;
  for (const event of session.events) {
    if (event.type === 'user') pushMessage(records, isoFromParts(eventDate, session.time, offset), event, 'user', event.text);
    else if (event.type === 'assistant') pushMessage(records, isoFromParts(eventDate, session.time, offset), event, 'assistant', event.text);
    else if (event.type === 'plan') pushPlan(records, event, offset, eventDate, eventTime);
    else if (event.type === 'command') pushCommand(records, event, offset, projectCwd, eventDate, eventTime);
    else if (event.type === 'patch') pushPatch(records, event, offset, eventDate, eventTime);
    else throw new Error(`Unknown showcase event type: ${event.type}`);
    offset += 1;
  }
  return records;
}

async function writeJsonl(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function materialize() {
  assertInside(outputRoot, path.join(repoRoot, 'output'));
  await fsp.rm(outputRoot, { recursive: true, force: true });
  await fsp.mkdir(projectRoot, { recursive: true });
  for (const [relativeFile, contents] of Object.entries(scenario.project.files)) {
    const target = path.join(projectRoot, relativeFile);
    assertInside(target, projectRoot);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, contents, 'utf8');
  }

  await fsp.mkdir(codexHome, { recursive: true });
  const configPath = path.join(codexHome, 'config.toml');
  await fsp.writeFile(configPath, projectConfigText(projectRoot), 'utf8');

  // Keep command detail readable and portable; session_meta still carries the
  // materialized absolute cwd used for repository discovery.
  const projectCwd = 'acme/task-board';
  for (const session of scenario.sessions) {
    await writeJsonl(sessionFilePath(session), buildSessionRecords(session, projectCwd));
  }
  await writeJsonl(path.join(codexHome, 'session_index.jsonl'), scenario.sessions.map((session) => ({
    id: session.id,
    thread_name: session.title,
    updated_at: isoFromParts(session.date, session.time, session.events.length + 1),
  })));

  const manifest = {
    schemaVersion: scenario.version,
    synthetic: true,
    source: 'showcase/scenarios/readme/scenario.js',
    sourceKind: 'codex',
    project: scenario.project.displayName,
    sessionKeys: scenario.sessions.map((session) => session.key),
    parentSessionKey: 'parent',
    derivedSessionKey: 'review-child',
    runtime: {
      codexHome: 'codex-home',
      workspace: 'workspace/acme/task-board',
    },
  };
  await fsp.writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`Materialized ${scenario.sessions.length} synthetic sessions for ${scenario.project.displayName}\n`);
  process.stdout.write(`Codex home: ${codexHome}\n`);
  process.stdout.write(`Workspace: ${projectRoot}\n`);
}

if (require.main === module) {
  materialize().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSessionRecords,
  materialize,
  projectConfigText,
};
