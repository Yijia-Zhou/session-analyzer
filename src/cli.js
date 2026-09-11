'use strict';

const os = require('node:os');
const path = require('node:path');
const { SOURCE_KIND, normalizeSourceKind, supportedSourceKinds } = require('./source-adapters');

function parseArgs(argv) {
  const opts = {
    repo: null,
    source: SOURCE_KIND.CODEX,
    codexHome: path.join(os.homedir(), '.codex'),
    claudeHome: path.join(os.homedir(), '.claude'),
    port: 17890,
    host: '127.0.0.1',
    logDir: '',
    errors: [],
  };
  const canonicalOptionFor = (arg) => {
    if (arg === '-h') return '--help';
    if (!arg.startsWith('--')) return null;
    const key = arg.slice(2).replace(/[-_]/g, '').toLowerCase();
    const aliases = {
      repo: '--repo',
      repos: '--repo',
      repository: '--repo',
      repopath: '--repo',
      reporoot: '--repo',
      project: '--repo',
      projectroot: '--repo',
      source: '--source',
      transcriptsource: '--source',
      codexhome: '--codex-home',
      codexpath: '--codex-home',
      codexdir: '--codex-home',
      codexdirectory: '--codex-home',
      claudehome: '--claude-home',
      claudepath: '--claude-home',
      dshhome: '--dsh-home',
      dshpath: '--dsh-home',
      deepseekhome: '--dsh-home',
      deepseekharnesshome: '--dsh-home',
      claudedir: '--claude-home',
      claudedirectory: '--claude-home',
      port: '--port',
      host: '--host',
      hostname: '--host',
      logdir: '--log-dir',
      help: '--help',
    };
    return aliases[key] || null;
  };
  const isMissingOptionValue = (value) => value === undefined
    || (typeof value === 'string' && (value.startsWith('--') || /^-[A-Za-z]/.test(value)));
  const isBlankOptionValue = (value) => typeof value === 'string' && value.trim() === '';
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const option = canonicalOptionFor(arg);
    if (arg.startsWith('-') && !option) {
      opts.errors.push(`Unknown option: ${arg}.`);
      if (next !== undefined && !String(next).startsWith('-')) i += 1;
      continue;
    }
    if (!option) {
      opts.errors.push(`Unexpected positional argument: ${arg}. Use --repo <repo-path> to choose a repository.`);
      continue;
    }
    if (option === '--repo') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --repo. Expected a repository path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.repo = next;
      i += 1;
    } else if (option === '--source') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push(`Missing value for --source. Expected one of: ${supportedSourceKinds().join(', ')}.`);
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.source = normalizeSourceKind(next);
      if (!supportedSourceKinds().includes(opts.source)) {
        opts.errors.push(`Invalid value for --source: ${JSON.stringify(next)}. Expected one of: ${supportedSourceKinds().join(', ')}.`);
      }
      i += 1;
    } else if (option === '--codex-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --codex-home. Expected a Codex home path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.codexHome = next;
      i += 1;
    } else if (option === '--claude-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --claude-home. Expected a Claude home path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.claudeHome = next;
      i += 1;
    } else if (option === '--dsh-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --dsh-home. Expected a DeepSeek Harness sessions root.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.dshHome = next;
      i += 1;
    } else if (option === '--port') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --port. Expected an integer between 1 and 65535.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      const port = Number(next);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        opts.errors.push(`Invalid value for --port: ${JSON.stringify(next)}. Expected an integer between 1 and 65535.`);
        i += 1;
        continue;
      }
      opts.port = port;
      i += 1;
    } else if (option === '--host') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --host. Expected a non-empty host name or IP address.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.host = next;
      i += 1;
    } else if (option === '--log-dir') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --log-dir. Expected a directory path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.logDir = next;
      i += 1;
    } else if (option === '--help') {
      opts.help = true;
    }
  }
  return opts;
}

function formatHelp() {
  return [
    'Session Analyzer',
    '',
    'Usage:',
    '  session-analyzer [--repo <repo-path>] [--source <source>] [--codex-home <path>] [--claude-home <path>] [--dsh-home <path>] [--port <port>] [--host <host>] [--log-dir <path>]',
    '',
    'Options:',
    '  --repo <repo-path>     Repository to analyze. If omitted, select a project in the browser.',
    '  --source <source>       Transcript source: codex, claude-code, or deepseek-harness. Defaults to codex.',
    '  --codex-home <path>    Codex home directory. Defaults to ~/.codex.',
    '  --claude-home <path>   Claude home directory. Used only with --source claude-code. Defaults to ~/.claude.',
    '  --dsh-home <path>      DeepSeek Harness sessions persistence root. Used only with --source deepseek-harness. Defaults to ~/.dsh/sessions.',
    '  --port <port>          Local server port. Must be an integer from 1 to 65535. Defaults to 17890.',
    '  --host <host>          Advanced: bind host. Defaults to 127.0.0.1.',
    '  --log-dir <path>       Write throttled indexing diagnostics as bounded JSONL logs.',
    '',
    'Examples:',
    '  session-analyzer',
    '  session-analyzer --repo C:\\path\\to\\project',
    '  session-analyzer --repo C:\\path\\to\\project --codex-home C:\\Users\\you\\.codex --port 17890',
    '  session-analyzer --source claude-code --repo C:\\path\\to\\project --claude-home C:\\Users\\you\\.claude',
    '  session-analyzer --source deepseek-harness --repo C:\\path\\to\\project --dsh-home C:\\Users\\you\\.dsh\\sessions',
    '',
    'Privacy:',
    '  The default host is 127.0.0.1. Binding to another host can expose transcript content',
    '  available to this process to other machines on the network.',
  ].join('\n');
}

module.exports = {
  parseArgs,
  formatHelp,
};
