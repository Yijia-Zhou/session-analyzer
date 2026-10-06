#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');

const exactDocuments = new Set(['README.md', 'README.zh-CN.md', 'docs/development.md']);
const commitPattern = /^[a-f0-9]{40}$/u;

function isAllowedDocument(filename) {
  if (typeof filename !== 'string' || /[\x00-\x1f\x7f\\]/u.test(filename)
    || path.posix.isAbsolute(filename) || path.posix.normalize(filename) !== filename) return false;
  return exactDocuments.has(filename)
    || (filename.startsWith('docs/exec-plans/') && filename.endsWith('.md'));
}

function parseRawDiff(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!isUtf8(buffer)) throw new Error('Non-UTF-8 diff paths.');
  if (buffer.length === 0) return [];
  const text = buffer.toString('utf8');
  if (!text.endsWith('\0')) throw new Error('Incomplete raw diff.');
  const fields = text.slice(0, -1).split('\0');
  if (fields.length % 2 !== 0) throw new Error('Incomplete raw diff entry.');
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const header = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([A-Z])$/u.exec(fields[index]);
    if (!header || !fields[index + 1]) throw new Error('Unexpected raw diff entry.');
    entries.push({ oldMode: header[1], newMode: header[2], status: header[5], path: fields[index + 1] });
  }
  return entries;
}

function fullScope(reason, changedFiles = null) {
  return { mode: 'full', browserRequired: true, reason, changedFiles };
}

function classifyChanges(entries) {
  if (entries.length === 0) return fullScope('empty-diff', 0);
  for (const entry of entries) {
    const ordinaryModes = (entry.status === 'A' && entry.oldMode === '000000' && entry.newMode === '100644')
      || (entry.status === 'D' && entry.oldMode === '100644' && entry.newMode === '000000')
      || (entry.status === 'M' && entry.oldMode === '100644' && entry.newMode === '100644');
    if (!ordinaryModes || !isAllowedDocument(entry.path)) return fullScope('outside-document-scope', entries.length);
  }
  return { mode: 'docs-only', browserRequired: false, reason: 'allowlisted-documents', changedFiles: entries.length };
}

function hasOnlyTextChanges(value, entries) {
  if (!Buffer.isBuffer(value) || !isUtf8(value)) return false;
  const text = value.toString('utf8');
  if (!text.endsWith('\0')) return false;
  const paths = new Set();
  for (const line of text.slice(0, -1).split('\0')) {
    const match = /^\d+\t\d+\t(.+)$/u.exec(line);
    if (!match || paths.has(match[1])) return false; // Binary numstat uses '-'.
    paths.add(match[1]);
  }
  return paths.size === entries.length && entries.every(entry => paths.has(entry.path));
}

function determineScope({ eventName, baseSha, headSha, cwd = process.cwd() }, git = (args) => execFileSync('git', args, {
  cwd, encoding: null, maxBuffer: 16 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
})) {
  if (eventName !== 'pull_request') return fullScope('non-pull-request');
  if (!commitPattern.test(baseSha || '') || !commitPattern.test(headSha || '')) return fullScope('missing-commit-identity');
  try {
    // The PR's own changes, not unrelated changes subsequently made on base.
    const mergeBase = git(['merge-base', baseSha, headSha]).toString('utf8').trim();
    if (!commitPattern.test(mergeBase)) return fullScope('missing-merge-base');
    // Disable rename detection: a move must qualify at BOTH its old and new paths.
    const entries = parseRawDiff(git(['diff', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', mergeBase, headSha, '--']));
    const result = classifyChanges(entries);
    if (!result.browserRequired && !hasOnlyTextChanges(git(['diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', mergeBase, headSha, '--']), entries)) {
      return fullScope('non-text-or-incomplete-diff', entries.length);
    }
    return { ...result, baseSha, headSha, mergeBase };
  } catch {
    // Classification is an optimization. Missing history, malformed/truncated
    // output, command errors or timeouts must never waive browser coverage.
    return fullScope('comparison-unavailable');
  }
}

function main(environment = process.env) {
  const result = determineScope({
    eventName: environment.GITHUB_EVENT_NAME,
    baseSha: environment.CI_BASE_SHA,
    headSha: environment.CI_HEAD_SHA,
  });
  if (environment.GITHUB_OUTPUT) {
    fs.appendFileSync(environment.GITHUB_OUTPUT, `mode=${result.mode}\nbrowser_required=${result.browserRequired}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { classifyChanges, determineScope, isAllowedDocument, parseRawDiff };
