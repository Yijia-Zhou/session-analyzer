'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SOURCE_KIND, normalizeSourceKind, supportedSourceKinds } = require('./source-adapters');
const { normalizeProjectPathRules } = require('./project-path-context');

async function loadPathConfig(filePath) {
  const absolute = path.resolve(filePath);
  let config;
  try {
    const text = await fs.readFile(absolute, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('Path configuration exceeds 1 MiB.');
    config = JSON.parse(text);
  } catch (cause) {
    throw Object.assign(new Error(`Cannot read path configuration: ${cause.message}`), { code: 'INVALID_PROJECT_PATH_POLICY' });
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw Object.assign(new Error('Path configuration must be a sourceConfigs object.'), { code: 'INVALID_PROJECT_PATH_POLICY' });
  }
  const result = {};
  for (const [kind, entry] of Object.entries(config)) {
    if (!supportedSourceKinds().includes(kind) || !entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).some((key) => !['home', 'projectPathRules', ...(kind === 'qoder' ? ['desktopDb'] : [])].includes(key))
        || typeof entry.home !== 'string' || !entry.home.trim() || entry.home.includes('\0')) {
      throw Object.assign(new Error('Each path configuration entry requires a supported source, home and optional projectPathRules.'), { code: 'INVALID_PROJECT_PATH_POLICY' });
    }
    if (Object.hasOwn(entry, 'desktopDb') && (typeof entry.desktopDb !== 'string' || !entry.desktopDb.trim() || entry.desktopDb.includes('\0'))) {
      throw Object.assign(new Error('qoder.desktopDb must be a non-empty database path.'), { code: 'INVALID_PROJECT_PATH_POLICY' });
    }
    const home = path.resolve(path.dirname(absolute), entry.home);
    result[kind] = { home, ...(entry.desktopDb !== undefined ? { desktopDb: path.resolve(path.dirname(absolute), entry.desktopDb) } : {}), ...(entry.projectPathRules !== undefined
      ? { projectPathRules: normalizeProjectPathRules(entry.projectPathRules, home) } : {}) };
  }
  return result;
}

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
      pihome: '--pi-home',
      pipath: '--pi-home',
      pidir: '--pi-home',
      pidirectory: '--pi-home',
      opencodehome: '--opencode-home',
      opencodepath: '--opencode-home',
      opencodedir: '--opencode-home',
      opencodedatabase: '--opencode-home',
      workbuddyhome: '--workbuddy-home',
      workbuddypath: '--workbuddy-home',
      workbuddydir: '--workbuddy-home',
      workbuddydirectory: '--workbuddy-home',
      qoderdesktopdb: '--qoder-desktop-db',
      qoderhome: '--qoder-home',
      qoderpath: '--qoder-home',
      qoderdir: '--qoder-home',
      qoderdirectory: '--qoder-home',
      claudedir: '--claude-home',
      claudedirectory: '--claude-home',
      port: '--port',
      host: '--host',
      hostname: '--host',
      logdir: '--log-dir',
      pathconfig: '--path-config',
      projectpathsemantics: '--project-path-semantics',
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
    } else if (option === '--pi-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --pi-home. Expected a pi agent directory.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.piHome = next;
      i += 1;
    } else if (option === '--opencode-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --opencode-home. Expected an OpenCode data directory or database path.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.opencodeHome = next;
      i += 1;
    } else if (option === '--workbuddy-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --workbuddy-home. Expected a WorkBuddy / CodeBuddy config root.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.workbuddyHome = next;
      i += 1;
    } else if (option === '--qoder-home') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --qoder-home. Expected a Qoder home directory.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.qoderHome = next;
      i += 1;
    } else if (option === '--qoder-desktop-db') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next) || next.includes('\0')) {
        opts.errors.push('Missing or invalid value for --qoder-desktop-db. Expected a desktop SQLite file.');
        if (!isMissingOptionValue(next)) i += 1;
        continue;
      }
      opts.qoderDesktopDb = next;
      i += 1;
    } else if (option === '--path-config') {
      if (isMissingOptionValue(next) || isBlankOptionValue(next)) {
        opts.errors.push('Missing value for --path-config. Expected a JSON configuration file.');
        if (isBlankOptionValue(next)) i += 1;
        continue;
      }
      opts.pathConfig = next;
      i += 1;
    } else if (option === '--project-path-semantics') {
      if (!['windows', 'posix'].includes(next)) {
        opts.errors.push('Invalid value for --project-path-semantics. Expected windows or posix.');
        if (!isMissingOptionValue(next)) i += 1;
        continue;
      }
      opts.projectPathSemantics = next;
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
    '  session-analyzer [--repo <repo-path>] [--source <source>] [--codex-home <path>] [--claude-home <path>] [--dsh-home <path>] [--pi-home <path>] [--opencode-home <path>] [--workbuddy-home <path>] [--qoder-home <path>] [--port <port>] [--host <host>] [--log-dir <path>]',
    '',
    'Options:',
    '  --repo <repo-path>     Repository to analyze. If omitted, select a project in the browser.',
    '  --source <source>       Transcript source: codex, claude-code, deepseek-harness, pi, opencode, workbuddy, or qoder. Defaults to codex.',
    '  --codex-home <path>    Codex home directory. Defaults to ~/.codex.',
    '  --claude-home <path>   Claude home directory. Used only with --source claude-code. Defaults to ~/.claude.',
    '  --dsh-home <path>      DeepSeek Harness sessions persistence root. Used only with --source deepseek-harness. Defaults to ~/.dsh/sessions.',
    '  --pi-home <path>       pi agent directory containing sessions/. Used only with --source pi. Defaults to PI_CODING_AGENT_DIR or ~/.pi/agent.',
    '  --opencode-home <path> OpenCode data directory or SQLite database. Used only with --source opencode. Defaults to OPENCODE_DB or the OpenCode XDG data directory.',
    '  --workbuddy-home <path> WorkBuddy / CodeBuddy config root containing projects/. Used only with --source workbuddy. Defaults to CODEBUDDY_CONFIG_DIR or ~/.codebuddy.',
    '  --qoder-home <path>    Qoder home directory containing projects/. Used only with --source qoder. Defaults to ~/.qoder-cn.',
    '  --qoder-desktop-db <file> Optional Qoder desktop title database. Captured during indexing; JSONL remains the transcript source.',
    '  --path-config <file>   Analyzer sourceConfigs JSON with home and scoped projectPathRules. Configured homes take precedence over home flags; relative homes use the file directory.',
    '  --project-path-semantics <windows|posix> Explicit interpretation of --repo only; historical cwd interpretation uses scoped path rules.',
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
    '  session-analyzer --source pi --repo C:\\path\\to\\project --pi-home C:\\Users\\you\\.pi\\agent',
    '  session-analyzer --source opencode --repo /path/to/project --opencode-home /path/to/opencode.db',
    '  session-analyzer --source workbuddy --repo /path/to/project --workbuddy-home /path/to/config-root',
    '  session-analyzer --source qoder --repo /path/to/project --qoder-home /path/to/qoder-home',
    '',
    'Privacy:',
    '  The default host is 127.0.0.1. Binding to another host can expose transcript content',
    '  available to this process to other machines on the network.',
  ].join('\n');
}

module.exports = {
  parseArgs,
  formatHelp,
  loadPathConfig,
};
