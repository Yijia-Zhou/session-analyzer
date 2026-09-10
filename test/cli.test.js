'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, formatHelp } = require('../src/cli');

const parse = (...args) => parseArgs(['node', 'server.js', ...args]);
const defaults = () => ({
  repo: null, source: 'codex',
  codexHome: path.join(os.homedir(), '.codex'),
  claudeHome: path.join(os.homedir(), '.claude'),
  port: 17890, host: '127.0.0.1', logDir: '', errors: [],
});

test('CLI defaults and server compatibility export', () => {
  assert.deepEqual(parse(), defaults());
  assert.equal(require('../server').parseArgs, parseArgs);
  const first = parse();
  first.errors.push('local');
  assert.deepEqual(parse(), defaults());
});

test('canonical options preserve values and repeated options use the last value', () => {
  assert.deepEqual(parse(
    '--repo', 'old', '--repo', ' project ', '--source', 'claude-code',
    '--codex-home', 'codex', '--claude-home', 'claude', '--dsh-home', 'dsh',
    '--port', '9000', '--host', '0.0.0.0', '--log-dir', 'logs',
  ), { repo: ' project ', source: 'claude-code', codexHome: 'codex',
    claudeHome: 'claude', dshHome: 'dsh', port: 9000, host: '0.0.0.0', logDir: 'logs', errors: [] });
});

test('aliases normalize long-option case, hyphens and underscores', () => {
  const groups = [
    ['repo', ['repo', 'repos', 'repository', 'repopath', 'reporoot', 'project', 'projectroot']],
    ['source', ['source', 'transcriptsource']],
    ['codexHome', ['codexhome', 'codexpath', 'codexdir', 'codexdirectory']],
    ['claudeHome', ['claudehome', 'claudepath', 'claudedir', 'claudedirectory']],
    ['dshHome', ['dshhome', 'dshpath', 'deepseekhome', 'deepseekharnesshome']],
    ['port', ['port']], ['host', ['host', 'hostname']], ['logDir', ['logdir']],
  ];
  for (const [field, aliases] of groups) {
    const value = field === 'source' ? 'codex' : field === 'port' ? '1234' : 'value';
    for (const alias of aliases) {
      for (const spelling of [alias, alias.toUpperCase().split('').join('-_')]) {
        assert.deepEqual(parse(`--${spelling}`, value), {
          ...defaults(), [field]: field === 'port' ? 1234 : value,
        });
      }
    }
  }
  for (const alias of ['-h', '--help', '--H_E-LP']) {
    assert.deepEqual(parse(alias), { ...defaults(), help: true });
  }
});

test('missing and blank values retain exact errors and following options', () => {
  const expected = [
    ['--repo', 'a repository path'],
    ['--source', 'one of: codex, claude-code, deepseek-harness'],
    ['--codex-home', 'a Codex home path'],
    ['--claude-home', 'a Claude home path'],
    ['--dsh-home', 'a DeepSeek Harness sessions root'],
    ['--port', 'an integer between 1 and 65535'],
    ['--host', 'a non-empty host name or IP address'],
    ['--log-dir', 'a directory path'],
  ];
  for (const [option, description] of expected) {
    const errors = [`Missing value for ${option}. Expected ${description}.`];
    assert.deepEqual(parse(option), { ...defaults(), errors });
    for (const blank of ['', ' \t ']) {
      assert.deepEqual(parse(option, blank, '--help'), { ...defaults(), errors, help: true });
    }
    for (const help of ['--help', '-h']) {
      assert.deepEqual(parse(option, help), { ...defaults(), errors, help: true });
    }
  }
});

test('unknown options consume only the following non-option and errors stay ordered', () => {
  assert.deepEqual(parse('--unknown', 'consumed', 'extra', '-x', '--repo', '--port', '0', '--host', 'localhost'), {
    ...defaults(), host: 'localhost', errors: [
      'Unknown option: --unknown.',
      'Unexpected positional argument: extra. Use --repo <repo-path> to choose a repository.',
      'Unknown option: -x.',
      'Missing value for --repo. Expected a repository path.',
      'Invalid value for --port: "0". Expected an integer between 1 and 65535.',
    ],
  });
  assert.deepEqual(parse('--unknown', '-1', 'consumed').errors, [
    'Unknown option: --unknown.', 'Unknown option: -1.',
  ]);
  assert.deepEqual(parse('--repo=-value', 'consumed').errors, ['Unknown option: --repo=-value.']);
  assert.deepEqual(parse('--repo', '-1'), { ...defaults(), repo: '-1' });
});

test('source normalization and invalid sources preserve parsed value and errors', () => {
  for (const source of ['codex', 'claude-code', 'deepseek-harness']) {
    assert.deepEqual(parse('--source', ` ${source.toUpperCase()} `), { ...defaults(), source });
  }
  assert.deepEqual(parse('--source', 'UNKNOWN', '--source', 'codex'), {
    ...defaults(), errors: ['Invalid value for --source: "UNKNOWN". Expected one of: codex, claude-code, deepseek-harness.'],
  });
  assert.equal(parse('--source', 'UNKNOWN').source, 'unknown');
});

test('port accepts integer numeric representations in range and preserves last valid port', () => {
  for (const [value, port] of [['1', 1], ['65535', 65535], ['1e3', 1000], ['0x10', 16], [' 42 ', 42]]) {
    assert.deepEqual(parse('--port', value), { ...defaults(), port });
  }
  for (const value of ['0', '-1', '65536', '1.5', 'NaN', 'Infinity', 'abc']) {
    assert.deepEqual(parse('--port', '1234', '--port', value), {
      ...defaults(), port: 1234,
      errors: [`Invalid value for --port: ${JSON.stringify(value)}. Expected an integer between 1 and 65535.`],
    });
  }
});

test('formatHelp returns the exact public help without terminal output or trailing newline', (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const expected = [
    "Session Analyzer",
    "",
    "Usage:",
    "  session-analyzer [--repo <repo-path>] [--source <source>] [--codex-home <path>] [--claude-home <path>] [--dsh-home <path>] [--port <port>] [--host <host>] [--log-dir <path>]",
    "",
    "Options:",
    "  --repo <repo-path>     Repository to analyze. If omitted, select a project in the browser.",
    "  --source <source>       Transcript source: codex, claude-code, or deepseek-harness. Defaults to codex.",
    "  --codex-home <path>    Codex home directory. Defaults to ~/.codex.",
    "  --claude-home <path>   Claude home directory. Used only with --source claude-code. Defaults to ~/.claude.",
    "  --dsh-home <path>      DeepSeek Harness sessions persistence root. Used only with --source deepseek-harness. Defaults to ~/.dsh/sessions.",
    "  --port <port>          Local server port. Must be an integer from 1 to 65535. Defaults to 17890.",
    "  --host <host>          Advanced: bind host. Defaults to 127.0.0.1.",
    "  --log-dir <path>       Write throttled indexing diagnostics as bounded JSONL logs.",
    "",
    "Examples:",
    "  session-analyzer",
    "  session-analyzer --repo C:\\path\\to\\project",
    "  session-analyzer --repo C:\\path\\to\\project --codex-home C:\\Users\\you\\.codex --port 17890",
    "  session-analyzer --source claude-code --repo C:\\path\\to\\project --claude-home C:\\Users\\you\\.claude",
    "  session-analyzer --source deepseek-harness --repo C:\\path\\to\\project --dsh-home C:\\Users\\you\\.dsh\\sessions",
    "",
    "Privacy:",
    "  The default host is 127.0.0.1. Binding to another host can expose transcript content",
    "  available to this process to other machines on the network.",
  ].join('\n');
  assert.equal(formatHelp(), expected);
  assert.equal(formatHelp(), expected);
  assert.equal(log.mock.callCount(), 0);
});
