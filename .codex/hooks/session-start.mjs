import { execFileSync } from 'node:child_process';
import path from 'node:path';

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function normalizeStatusLine(line) {
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

const repoRoot = runGit(['rev-parse', '--show-toplevel']) || process.cwd();
const branch = runGit(['branch', '--show-current']) || runGit(['rev-parse', '--short', 'HEAD']) || 'unknown';
const statusLines = runGit(['status', '--short'])
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean);

const shownStatus = statusLines.slice(0, 8).map(normalizeStatusLine);
const moreStatus = statusLines.length > shownStatus.length ? `\n  ... ${statusLines.length - shownStatus.length} more changed file(s)` : '';
const relativeRoot = path.relative(process.cwd(), repoRoot) || '.';

console.log([
  'session-analyzer guardrails:',
  `- repo: ${relativeRoot}`,
  `- branch: ${branch}`,
  statusLines.length ? `- git status:\n  ${shownStatus.join('\n  ')}${moreStatus}` : '- git status: clean',
  '- read docs/product-specs/session-transcript-analyzer.md, docs/design-docs/logical-event-timeline.md, docs/design-docs/codex-protocol-event-coverage.md, and docs/exec-plans/tech-debt-tracker.md before behavior changes.',
  '- do not commit real .codex/sessions data, exported transcripts, or unsanitized transcript fixtures.',
  '- public/assets/app.js is generated; edit src/browser/ or src/shared/ and run npm run build:check.',
  '- keep machine identifiers such as kind/status/layer/rawRefs/sourceLocator stable and untranslated.'
].join('\n'));
