'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {
  extractProvenance,
  isCredentialEnvironmentName,
  isTemporaryUserconfigPath,
  normalizePackManifest,
  normalizeTarEntries,
  parseOptions,
  sha512FromIntegrity,
  validateAttestationResponse,
  validateProvenance,
} = require('../scripts/release-automation');

function provenanceResponse({ version = '1.2.3', sourceSha = '1'.repeat(40), sha512 = 'a'.repeat(128) } = {}) {
  const payload = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{
      name: `pkg:npm/session-analyzer@${version}`,
      digest: { sha512 },
    }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: 'https://github.com/Yijia-Zhou/session-analyzer',
            path: '.github/workflows/publish.yml',
            ref: 'refs/heads/main',
          },
        },
        resolvedDependencies: [{
          uri: 'git+https://github.com/Yijia-Zhou/session-analyzer@refs/heads/main',
          digest: { gitCommit: sourceSha },
        }],
      },
      runDetails: {
        builder: { id: 'https://github.com/actions/runner/github-hosted' },
        metadata: {
          invocationId: 'https://github.com/Yijia-Zhou/session-analyzer/actions/runs/123/attempts/1',
        },
      },
    },
  };
  return {
    attestations: [{
      predicateType: 'https://slsa.dev/provenance/v1',
      bundle: {
        dsseEnvelope: {
          payload: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
      },
    }],
  };
}

test('release automation parses strict command-specific inputs', () => {
  const parseIsolated = (argv) => parseOptions(argv, {});
  assert.deepEqual(parseIsolated(['preflight', '1.2.3']), {
    command: 'preflight',
    version: '1.2.3',
  });
  assert.equal(parseIsolated([
    'review-stage',
    '1.2.3',
    'e263604d-5669-4e0a-a265-ab33e70ded7e',
    'a'.repeat(64),
    'b'.repeat(40),
  ]).stageId, 'e263604d-5669-4e0a-a265-ab33e70ded7e');
  assert.deepEqual(parseOptions(['preflight'], {
    RELEASE_VERSION: '1.2.3',
    GITHUB_STEP_SUMMARY: '/tmp/release-summary.md',
  }), {
    command: 'preflight',
    version: '1.2.3',
    summaryFile: '/tmp/release-summary.md',
  });
  assert.throws(() => parseIsolated(['preflight', '1.2.3-beta.1']), /stable x\.y\.z/u);
  assert.throws(() => parseIsolated(['verify-public', '1.2.3']), /requires positional values/u);
  assert.throws(() => parseIsolated(['verify-public', '--release-version', '1.2.3']), /expected SHA-256/u);
  assert.throws(() => parseIsolated(['preflight', '--release-version', '1.2.3', '--version', '1.2.3']), /only once/u);
  assert.throws(() => parseIsolated(['preflight', '--release-version', '1.2.3', '--release-version', '1.2.4']), /Duplicate option/u);
  assert.throws(() => parseIsolated(['preflight', '--release-version', '1.2.3', '--mystery', 'value']), /Unexpected option/u);
});

test('release automation rejects token-like npm credential environment names', () => {
  assert.equal(isCredentialEnvironmentName('NPM_TOKEN'), true);
  assert.equal(isCredentialEnvironmentName('node_auth_token'), true);
  assert.equal(isCredentialEnvironmentName('npm_config_//registry.npmjs.org/:_authToken'), true);
  assert.equal(isCredentialEnvironmentName('NPM_CONFIG_AUTH_TYPE'), false);
  assert.equal(isCredentialEnvironmentName('NPM_CONFIG_REGISTRY'), false);
});

test('release automation accepts only a temporary isolated stage-review userconfig', () => {
  assert.equal(isTemporaryUserconfigPath(path.join(os.tmpdir(), 'session-analyzer-stage-auth-example', '.npmrc')), true);
  assert.equal(isTemporaryUserconfigPath(path.join(os.tmpdir(), 'session-analyzer-stage-auth-example', 'config.txt')), false);
  assert.equal(isTemporaryUserconfigPath(path.join(os.homedir(), '.npmrc')), false);
  assert.equal(isTemporaryUserconfigPath(''), false);
});

test('release automation normalizes npm pack and tar manifest shapes', () => {
  const artifact = { filename: 'session-analyzer-1.2.3.tgz', files: [] };
  assert.equal(normalizePackManifest([artifact]), artifact);
  assert.equal(normalizePackManifest({ 'session-analyzer': artifact }), artifact);
  assert.throws(() => normalizePackManifest({}), /exactly one package artifact/u);
  assert.deepEqual(normalizeTarEntries([
    'package/',
    'package/server.js',
    './package/package.json',
    '',
  ].join('\n')), ['package.json', 'server.js']);
});

test('release automation decodes a strict npm SHA-512 integrity value', () => {
  const digest = Buffer.from('ab'.repeat(64), 'hex');
  assert.equal(sha512FromIntegrity(`sha512-${digest.toString('base64')}`), 'ab'.repeat(64));
  assert.throws(() => sha512FromIntegrity('sha256-not-accepted'), /single SHA-512/u);
  assert.throws(() => sha512FromIntegrity('sha512-YQ=='), /unexpected length/u);
});

test('release automation extracts and validates exact public provenance', () => {
  const sourceSha = '1'.repeat(40);
  const sha512 = 'b'.repeat(128);
  const response = provenanceResponse({ sourceSha, sha512 });
  const payload = extractProvenance(response);
  const result = validateAttestationResponse(response, {
    version: '1.2.3',
    expectedSourceSha: sourceSha,
  }, sha512);
  assert.equal(result.sourceCommit, sourceSha);
  assert.equal(result.workflow, '.github/workflows/publish.yml');
  assert.match(result.invocation, /actions\/runs\/123\/attempts\/1/u);
  assert.throws(() => validateProvenance(payload, {
    version: '1.2.3',
    expectedSourceSha: '0'.repeat(40),
  }, sha512), /source commit/u);
});

test('published verification workflow is anonymous, read-only, and cross-platform', () => {
  const fs = require('node:fs');
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'verify-published.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|pull_request_target|release|schedule):/mu);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /ubuntu-latest/u);
  assert.match(workflow, /windows-latest/u);
  assert.match(workflow, /npm run release:verify-public/u);
  assert.match(workflow, /test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.equal(workflow.split('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803').length - 1, 1);
  assert.equal(workflow.split('actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38').length - 1, 1);
  assert.doesNotMatch(workflow, /uses:\s+actions\/(?:checkout|setup-node)@v\d+/u);
  assert.doesNotMatch(workflow, /^\s+environment:/mu);
  assert.doesNotMatch(workflow, /id-token: write|NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.|npm login|npm publish|npm stage|git push/u);
});
