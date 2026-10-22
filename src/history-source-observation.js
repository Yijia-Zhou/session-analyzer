'use strict';

// Metadata observations belong to the history service, not the canonical index.
// They never validate content or advance the service's evidence snapshot.
const fs = require('node:fs/promises');
const path = require('node:path');
const { isCodexRolloutArtifactName, isHistoryRelativePath } = require('./codex-rollout-storage');

const DEFAULT_MAX_FILES = 10000;
const MAX_DURATION_MS = 5000;
const CHANGE_KINDS = ['metadata_unchanged', 'size_increased', 'size_decreased', 'metadata_changed',
  'identity_changed', 'missing', 'unreadable', 'unobserved', 'new_candidate', 'prior_existence_unknown'];
const counts = () => Object.fromEntries(CHANGE_KINDS.map((key) => [key, 0]));
const iso = (now) => new Date(now()).toISOString();
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

function physicalMetadata(stat) {
  return Object.fromEntries(['size', 'mtimeNs', 'ctimeNs', 'dev', 'ino'].map((key) => [key, String(stat[key])]));
}

// Bound both file stats and directory traversal. The time budget is cooperative:
// a pending filesystem operation must return before its deadline can be checked.
async function survey(root, knownPaths, { io, now, maxFiles, maxDurationMs, discover = true }) {
  const started = now();
  const report = { startedAt: new Date(started).toISOString(), endedAt: null, files: new Map(),
    complete: true, gaps: {}, directoryEntries: 0, limits: {
      maxFiles, maxDirectoryEntries: maxFiles * 10 + 1000, maxDurationMs,
    } };
  const gap = (code) => { report.complete = false; report.gaps[code] = (report.gaps[code] || 0) + 1; };
  let stopped = false;
  const withinTime = () => {
    if (!stopped && now() - started >= maxDurationMs) { stopped = true; gap('time_budget'); }
    return !stopped;
  };
  const checkedDirectories = new Map();
  async function directoryCheck(directory) {
    if (checkedDirectories.has(directory)) return checkedDirectories.get(directory);
    let result;
    try {
      const stat = await io.lstat(directory);
      result = stat.isSymbolicLink() ? 'SYMLINK_NOT_FOLLOWED' : stat.isDirectory() ? null : 'NOT_DIRECTORY';
    } catch (error) { result = error.code || 'STAT_FAILED'; }
    checkedDirectories.set(directory, result);
    return result;
  }
  async function sample(file) {
    if (report.files.has(file)) return true;
    if (!withinTime()) return false;
    if (report.files.size >= maxFiles) { gap('file_budget'); stopped = true; return false; }
    let entry;
    try {
      // Do not follow directory links when observing an admitted path either.
      const boundary = inside(root, file) ? root : path.resolve(root, '..', 'archived_sessions');
      const directories = [];
      for (let parent = path.dirname(file); inside(boundary, parent); parent = path.dirname(parent)) {
        directories.push(parent);
        if (parent === boundary) break;
      }
      for (const directory of directories.reverse()) {
        if (!withinTime()) return false;
        const code = await directoryCheck(directory);
        if (code) throw Object.assign(new Error(code), { code });
      }
      const stat = await io.lstat(file, { bigint: true });
      if (stat.isSymbolicLink()) throw Object.assign(new Error('symlink'), { code: 'SYMLINK_NOT_FOLLOWED' });
      if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'NOT_REGULAR_FILE' });
      entry = { state: 'present', metadata: physicalMetadata(stat) };
    } catch (error) {
      const code = error.code || 'STAT_FAILED';
      entry = { state: code === 'ENOENT' ? 'missing' : 'unreadable', code };
      if (entry.state === 'unreadable') gap(code);
    }
    report.files.set(file, { ...entry, sampledAt: iso(now) });
    return true;
  }
  // Previously sampled/admitted files take priority over discovering new ones.
  for (const file of knownPaths) if (!await sample(file)) break;
  const pending = discover ? [root] : [];
  while (pending.length && withinTime()) {
    const directory = pending.pop();
    const code = await directoryCheck(directory);
    if (code) { gap(code); continue; }
    let handle;
    try {
      handle = await io.opendir(directory);
      while (withinTime()) {
        const entry = await handle.read();
        if (!entry) break;
        report.directoryEntries += 1;
        if (report.directoryEntries > report.limits.maxDirectoryEntries) {
          gap('directory_entry_budget'); stopped = true; break;
        }
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) gap('SYMLINK_NOT_FOLLOWED');
        else if (entry.isDirectory()) pending.push(target);
        else if (entry.isFile() && isCodexRolloutArtifactName(entry.name) && !await sample(target)) break;
      }
    } catch (error) { gap(error.code || 'DIRECTORY_READ_FAILED'); }
    finally { if (handle) await handle.close().catch((error) => gap(error.code || 'DIRECTORY_CLOSE_FAILED')); }
  }
  withinTime();
  report.endedAt = iso(now);
  return report;
}

function compare(before, after, completeBaseline) {
  if (!after) return 'unobserved';
  if (after.state !== 'present') return after.state;
  if (!before) return completeBaseline ? 'new_candidate' : 'prior_existence_unknown';
  if (before.state === 'missing') return 'new_candidate';
  if (before.state !== 'present') return 'prior_existence_unknown';
  const a = before.metadata;
  const b = after.metadata;
  if (a.dev !== b.dev || a.ino !== b.ino) return 'identity_changed';
  if (BigInt(b.size) > BigInt(a.size)) return 'size_increased';
  if (BigInt(b.size) < BigInt(a.size)) return 'size_decreased';
  if (a.mtimeNs !== b.mtimeNs || a.ctimeNs !== b.ctimeNs) return 'metadata_changed';
  return 'metadata_unchanged';
}

async function createHistorySourceObservation({ sourceHome, io = fs, now = Date.now,
  maxFiles = DEFAULT_MAX_FILES, maxDurationMs = MAX_DURATION_MS }) {
  const root = path.resolve(sourceHome, 'sessions');
  const defaults = { io, now, maxFiles, maxDurationMs };
  const baseline = await survey(root, [], defaults);
  for (const entry of baseline.files.values()) entry.basis = 'pre_index_inventory';
  const owners = new Map();
  const sessionIds = new Set();
  let dependencyObservation;
  let indexing;

  async function bindIndex(index, interval) {
    indexing = { ...interval };
    for (const session of index.sessions) {
      sessionIds.add(session.id);
      const dependencySet = index.materializationDependencies?.get(session.materializationDescriptor?.dependencySetId);
      for (const entry of dependencySet?.entries || []) {
        if (entry.kind !== 'file' || entry.policy !== 'accepted_prefix' || entry.existence !== 'present'
            || !['primary_transcript', 'history_transcript'].includes(entry.role)
            || !isHistoryRelativePath(root, entry.pathIdentity)) continue;
        const compression = entry.evidence?.fileIdentity?.compression;
        if (compression !== undefined && !['none', 'zstd'].includes(compression)) continue;
        const physical = path.resolve(root, entry.pathIdentity + (compression === 'zstd' ? '.zst' : ''));
        if (!owners.has(physical)) owners.set(physical, new Set());
        owners.get(physical).add(session.id);
      }
    }
    // Archived ancestors are admitted dependencies, never a second discovery
    // root. Their baseline is honestly labelled as a later sample.
    const additional = [...owners.keys()].filter((file) => !baseline.files.has(file));
    dependencyObservation = await survey(root, additional, { ...defaults, discover: false,
      maxFiles: Math.max(0, maxFiles - baseline.files.size) });
    for (const [file, entry] of dependencyObservation.files) {
      baseline.files.set(file, { ...entry, basis: 'post_index_dependency_observation' });
    }
  }

  async function observe({ callerSessionId, maxFiles: requestedMaxFiles = DEFAULT_MAX_FILES, limit = 8 } = {}) {
    const knownPaths = new Set([...owners.keys(), ...baseline.files.keys()]);
    const current = await survey(root, knownPaths, { ...defaults, maxFiles: requestedMaxFiles });
    const allPaths = new Set([...knownPaths, ...current.files.keys()]);
    const summary = counts();
    const callerCounts = counts();
    const otherCounts = counts();
    const items = [];
    let detailCount = 0;
    let callerDetailCount = 0;
    let unattributedFiles = 0;
    for (const physicalPath of allPaths) {
      const before = baseline.files.get(physicalPath);
      const after = current.files.get(physicalPath);
      // An indexed dependency without a sample never inherits discovery's
      // absence claim, even if the ordinary candidate inventory was complete.
      const change = compare(before, after, baseline.complete && !owners.has(physicalPath));
      summary[change] += 1;
      const indexedOwners = owners.get(physicalPath);
      const associated = Boolean(callerSessionId && indexedOwners?.has(callerSessionId));
      const callerAssociation = associated ? 'caller_associated' : indexedOwners?.size ? 'other_indexed' : 'unattributed';
      if (!indexedOwners?.size) unattributedFiles += 1;
      (associated ? callerCounts : otherCounts)[change] += 1;
      if (change === 'metadata_unchanged') continue;
      detailCount += 1;
      if (associated) callerDetailCount += 1;
      if (items.length >= limit) continue;
      const ownerIds = [...(indexedOwners || [])];
      items.push({ physicalPath, change, callerAssociation,
        projectMembership: ownerIds.length ? 'indexed_dependency' : 'not_checked',
        indexedSessionIds: ownerIds.slice(0, 8), indexedSessionIdsOmitted: Math.max(0, ownerIds.length - 8),
        baseline: before || { state: 'not_sampled' }, current: after || { state: 'not_sampled' } });
    }
    const report = {
      strength: 'metadata_only', startedAt: current.startedAt, endedAt: current.endedAt,
      baseline: { startedAt: baseline.startedAt, endedAt: baseline.endedAt,
        complete: baseline.complete && dependencyObservation.complete,
        candidateInventoryComplete: baseline.complete, sampledFiles: baseline.files.size,
        gaps: baseline.gaps, limits: baseline.limits, indexing,
        dependencies: { startedAt: dependencyObservation.startedAt, endedAt: dependencyObservation.endedAt,
          complete: dependencyObservation.complete, sampledFiles: dependencyObservation.files.size,
          gaps: dependencyObservation.gaps } },
      scope: { candidateRoot: root, includes: ['normal_session_artifacts', 'admitted_history_dependencies'],
        unexamined: ['file_content', 'project_membership_of_unadmitted_candidates', 'head_selection_controls',
          'copied_session_metadata', 'history_relationship_changes', 'unadmitted_archives'] },
      limits: current.limits, sampledFiles: current.files.size, directoryEntries: current.directoryEntries,
      counts: summary, unattributedFiles,
      partial: !current.complete || !baseline.complete || !dependencyObservation.complete || summary.unobserved > 0,
      gaps: current.gaps,
      caller: { sessionId: callerSessionId ?? null, assertion: 'caller_supplied_not_authenticated',
        indexedSessionMatched: Boolean(callerSessionId && sessionIds.has(callerSessionId)),
        counts: callerCounts, detailsOmitted: callerDetailCount },
      other: { counts: otherCounts, detailsOmitted: detailCount - callerDetailCount },
      detailCount, itemsOmitted: detailCount,
      interpretation: 'Metadata equality does not verify content; growth does not prove append-only history. '
        + 'This is an interval observation, not proof of latest history or a refresh requirement. '
        + 'Repeated checks compare the original baseline; omitted details have no cursor. '
        + 'Keep a task evidence cutoff; explicitly start a new snapshot only when later evidence is needed.',
    };
    return structuredClone({ observation: report, items });
  }
  return { bindIndex, observe };
}

module.exports = { createHistorySourceObservation, DEFAULT_MAX_FILES, MAX_DURATION_MS };
