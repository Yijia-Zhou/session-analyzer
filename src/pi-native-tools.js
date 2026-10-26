'use strict';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string';
// pi 1.4.0 edit emits createTwoFilesPatch(path, path, ..., FILE_HEADERS_ONLY).
// Admit only one update with exact request paths and fully accounted hunk ranges.
function nativeEditPatch(value, path) {
  if (!text(value)) return null;
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== `--- ${path}` || lines[1] !== `+++ ${path}`) return null;
  const file = { path, recordedPath: path, changeType: 'update', additions: 0, deletions: 0, hunks: [], lineNumbers: true };
  let cursor = 2;
  let previousOldEnd = 1; let previousNewEnd = 1;
  let oldEnded = false; let newEnded = false;
  while (cursor < lines.length) {
    const header = lines[cursor++];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(header);
    if (!match) return null;
    const oldAnchor = Number(match[1]); const newAnchor = Number(match[3]);
    const oldCount = Number(match[2] ?? 1); const newCount = Number(match[4] ?? 1);
    // A zero-count range names the preceding line, rather than its next line.
    // Compare exclusive ranges in one coordinate system, including empty files.
    let oldLine = oldAnchor + (oldCount === 0 ? 1 : 0);
    let newLine = newAnchor + (newCount === 0 ? 1 : 0);
    if (![oldAnchor, newAnchor, oldLine, newLine, oldCount, newCount].every(Number.isSafeInteger)
        || oldLine === 0 || newLine === 0
        || !Number.isSafeInteger(oldLine + oldCount) || !Number.isSafeInteger(newLine + newCount)
        || oldLine < previousOldEnd || newLine < previousNewEnd
        || oldLine - previousOldEnd !== newLine - previousNewEnd
        || (oldEnded && (oldCount > 0 || oldLine !== previousOldEnd))
        || (newEnded && (newCount > 0 || newLine !== previousNewEnd))) return null;
    const startOld = oldLine; const startNew = newLine;
    const hunk = { header, lineNumbers: true, lines: [] };
    let precedingPrefix = '';
    while (cursor < lines.length && !lines[cursor].startsWith('@@')) {
      const line = lines[cursor++];
      if (line === '\\ No newline at end of file') {
        // The marker belongs to the preceding data line's side(s), and means
        // no later data line may consume that side. It is not a free comment.
        if (!precedingPrefix) return null;
        if (precedingPrefix !== '+') oldEnded = true;
        if (precedingPrefix !== '-') newEnded = true;
        precedingPrefix = '';
        continue;
      }
      const prefix = line[0];
      if (![' ', '+', '-'].includes(prefix)
          || (prefix !== '+' && oldEnded) || (prefix !== '-' && newEnded)) return null;
      precedingPrefix = prefix;
      const kind = prefix === '+' ? 'added' : prefix === '-' ? 'removed' : 'context';
      hunk.lines.push({ kind, content: line.slice(1), oldLine: prefix === '+' ? null : oldLine++, newLine: prefix === '-' ? null : newLine++, lineNumberReliable: true });
      if (prefix === '+') file.additions++;
      if (prefix === '-') file.deletions++;
    }
    if (oldLine - startOld !== oldCount || newLine - startNew !== newCount || !hunk.lines.length) return null;
    previousOldEnd = oldLine; previousNewEnd = newLine;
    file.hunks.push(hunk);
  }
  return file.hunks.length && file.additions + file.deletions ? { type: 'patch', purpose: 'result', files: [file], lineNumbers: true } : null;
}
// Cap typed structures before the generic detail sanitizer. Its omission markers
// belong in JSON, never in patch.hunks/lines, which require typed objects.
function nativePatchSections(patch) {
  if (!patch || !Array.isArray(patch.files)) return [];
  let remainingLines = 80; let remainingHunks = 24;
  let omittedLines = 0; let omittedHunks = 0;
  const files = patch.files.slice(0, 1).map((file) => {
    const hunks = [];
    for (const hunk of file.hunks) {
      if (!remainingHunks || !remainingLines) {
        omittedHunks++; omittedLines += hunk.lines.length; continue;
      }
      const lines = hunk.lines.slice(0, remainingLines);
      remainingLines -= lines.length; remainingHunks--;
      omittedLines += hunk.lines.length - lines.length;
      hunks.push({ ...hunk, lines });
    }
    return { ...file, hunks };
  });
  const sections = [{ ...patch, files }];
  if (omittedLines || omittedHunks) sections.push({ type: 'notice', purpose: 'result', level: 'info',
    text: `Patch display omitted ${omittedLines} lines and ${omittedHunks} complete hunks. File additions and deletions include the complete recorded patch; see Raw references for all lines.` });
  return sections;
}
function nativeTool(name, args, result, status) {
  if (!object(args)) return null;
  const optional = (key, type) => args[key] === undefined || (typeof args[key] === type && (type !== 'number' || Number.isFinite(args[key])));
  if (['read', 'grep', 'find', 'ls'].includes(name) && !optional('limit', 'number')) return null;
  if (name === 'read' && !optional('offset', 'number')) return null;
  if (name === 'grep' && (!optional('glob', 'string') || !optional('ignoreCase', 'boolean')
      || !optional('literal', 'boolean') || !optional('context', 'number'))) return null;
  if (['bash', 'powershell'].includes(name) && !optional('timeout', 'number')) return null;
  if (['bash', 'powershell'].includes(name)) return text(args.command) ? { command: args.command, language: name === 'bash' ? 'bash' : 'powershell' } : null;
  const path = text(args.path) && args.path.length ? args.path : '';
  // Pinned grep/find/ls execute with path || "."; an empty string is valid
  // current-directory evidence, without inventing a recorded touched path.
  const optionalPath = args.path === undefined || text(args.path);
  if (name === 'read' && path) return { path, preview: `Read ${path}`, activity: 'read' };
  if (name === 'write' && path && text(args.content)) return { path, preview: `Write ${path}`, activity: 'write' };
  if (name === 'edit' && path && Array.isArray(args.edits) && args.edits.length
      && args.edits.every((edit) => object(edit) && text(edit.oldText) && text(edit.newText))) {
    const patch = status === 'success' ? nativeEditPatch(result?.details?.patch, path) : null;
    return { path, preview: `${patch ? 'Edited' : 'Edit requested:'} ${path}`, activity: 'edit', patch };
  }
  if (['grep', 'find'].includes(name) && text(args.pattern) && optionalPath) return { path, activity: name, preview: `${name === 'grep' ? 'Search' : 'Find'} ${args.pattern}${path ? ` in ${path}` : ''}` };
  if (name === 'ls' && optionalPath) return { path, activity: 'ls', preview: `List ${path || '(current directory)'}` };
  return null;
}
module.exports = { nativeEditPatch, nativePatchSections, nativeTool };
