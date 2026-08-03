#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const packageMetadata = require('../package.json');
const lockMetadata = require('../package-lock.json');
const officialRegistry = 'https://registry.npmjs.org/';
const expectedRepository = 'git+https://github.com/Yijia-Zhou/session-analyzer.git';
const expectedWorkflowRepository = 'https://github.com/Yijia-Zhou/session-analyzer';
const expectedWorkflowPath = '.github/workflows/publish.yml';
const expectedWorkflowRef = 'refs/heads/main';
const credentialEnvironmentNames = [
  'NPM_TOKEN',
  'NPM_AUTH_TOKEN',
  'NODE_AUTH_TOKEN',
  'NPM_CONFIG__AUTH',
  'NPM_CONFIG__AUTH_TOKEN',
];

function fail(message) {
  throw new Error(message);
}

function parseOptions(argv, environment = process.env) {
  const [command, ...tokens] = argv;
  if (!['preflight', 'review-stage', 'verify-public'].includes(command)) {
    fail('Usage: release-automation.js <preflight|review-stage|verify-public> <command-specific values>');
  }
  const options = { command };
  const positionalKeys = {
    preflight: ['version'],
    'review-stage': ['version', 'stageId', 'expectedSha256', 'expectedSourceSha'],
    'verify-public': ['version', 'expectedSha256', 'expectedSourceSha'],
  }[command];
  const usesPositionals = tokens.length > 0 && tokens.every((token) => !token.startsWith('--'));
  if (usesPositionals) {
    if (tokens.length !== positionalKeys.length) {
      fail(`${command} requires positional values: ${positionalKeys.join(', ')}`);
    }
    positionalKeys.forEach((key, index) => { options[key] = tokens[index]; });
  } else {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
      const key = token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      const value = tokens[index + 1];
      if (!value || value.startsWith('--')) fail(`Missing value for ${token}`);
      if (Object.hasOwn(options, key)) fail(`Duplicate option: ${token}`);
      options[key] = value;
      index += 1;
    }
  }
  if (Object.hasOwn(options, 'releaseVersion')) {
    if (Object.hasOwn(options, 'version')) fail('Specify release version only once.');
    options.version = options.releaseVersion;
    delete options.releaseVersion;
  }
  const environmentFallbacks = {
    version: environment.RELEASE_VERSION,
    expectedSha256: environment.EXPECTED_SHA256,
    expectedSourceSha: environment.EXPECTED_SOURCE_SHA,
    stageId: environment.NPM_STAGE_ID,
    summaryFile: environment.GITHUB_STEP_SUMMARY,
  };
  for (const [key, value] of Object.entries(environmentFallbacks)) {
    if (!Object.hasOwn(options, key) && value) options[key] = value;
  }
  const allowedKeys = new Set(['command', ...positionalKeys, 'summaryFile']);
  const unknownKeys = Object.keys(options).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) fail(`Unexpected option(s): ${unknownKeys.join(', ')}`);
  validateStableVersion(options.version);
  if (command === 'review-stage') {
    validateStageId(options.stageId);
    validateHex(options.expectedSha256, 64, 'expected SHA-256');
    validateHex(options.expectedSourceSha, 40, 'expected source SHA');
  }
  if (command === 'verify-public') {
    validateHex(options.expectedSha256, 64, 'expected SHA-256');
    validateHex(options.expectedSourceSha, 40, 'expected source SHA');
  }
  return options;
}

function validateStableVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
    fail(`Release version must be a stable x.y.z version; received ${JSON.stringify(version)}`);
  }
}

function validateStageId(stageId) {
  if (typeof stageId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(stageId)) {
    fail('Stage ID must be a UUID.');
  }
}

function validateHex(value, length, label) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`, 'iu').test(value)) {
    fail(`${label} must contain exactly ${length} hexadecimal characters.`);
  }
}

function commandSpec(command, args) {
  const requiresCommandShell = ['npm', 'npx'].includes(command) || /\.(?:cmd|bat)$/iu.test(command);
  if (process.platform !== 'win32' || !requiresCommandShell) {
    return { command, args };
  }
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', command, ...args],
  };
}

function run(command, args, options = {}) {
  const spec = commandSpec(command, args);
  const result = childProcess.spawnSync(spec.command, spec.args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      ...options.env,
    },
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout || 5 * 60 * 1000,
  });
  if (!options.allowFailure && result.status !== 0) {
    fail([
      `${command} ${args.join(' ')} failed with exit code ${result.status}`,
      result.error ? result.error.stack || result.error.message : '',
      result.signal ? `signal: ${result.signal}` : '',
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function runNpm(args, options = {}) {
  return run('npm', args, options);
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`${label} did not return valid JSON: ${error.message}\n${output}`);
  }
}

function unwrapSingleNpmValue(value) {
  if (Array.isArray(value) && value.length === 1) return value[0];
  return value;
}

function normalizePackManifest(value) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value)
      : [];
  if (entries.length !== 1 || !entries[0] || typeof entries[0].filename !== 'string') {
    fail('npm pack --json must describe exactly one package artifact.');
  }
  return entries[0];
}

function assertPackageIdentity(version) {
  if (packageMetadata.name !== 'session-analyzer') fail('Unexpected package name.');
  if (packageMetadata.version !== version) fail(`package.json version is ${packageMetadata.version}, expected ${version}.`);
  if (lockMetadata.name !== packageMetadata.name || lockMetadata.version !== version) fail('package-lock root identity does not match package.json.');
  if (lockMetadata.packages?.['']?.name !== packageMetadata.name || lockMetadata.packages?.['']?.version !== version) {
    fail('package-lock packages[""] identity does not match package.json.');
  }
  if (packageMetadata.repository?.url !== expectedRepository) fail('Unexpected package repository metadata.');
  if (packageMetadata.publishConfig?.registry !== officialRegistry || packageMetadata.publishConfig?.access !== 'public') {
    fail('publishConfig must use the public npm registry and public access.');
  }
}

function isCredentialEnvironmentName(name) {
  const expectedNames = new Set(credentialEnvironmentNames.map((name) => name.toUpperCase()));
  const normalized = name.toUpperCase();
  if (expectedNames.has(normalized)) return true;
  if (!normalized.startsWith('NPM_CONFIG_')) return false;
  return normalized.endsWith('_AUTH')
    || normalized.endsWith('_TOKEN')
    || normalized.includes('AUTH_TOKEN')
    || normalized.includes('AUTHTOKEN')
    || normalized.includes(':_AUTH');
}

function assertNoCredentialEnvironment() {
  const present = Object.keys(process.env).filter(isCredentialEnvironmentName);
  if (present.length > 0) fail(`Remove inherited npm credential environment variables: ${present.join(', ')}`);
}

function isTemporaryUserconfigPath(configured) {
  if (!configured) return false;
  const resolved = path.resolve(configured);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relative = path.relative(temporaryRoot, resolved);
  return Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolved) === '.npmrc');
}

function assertTemporaryInteractiveUserconfig() {
  const configured = process.env.NPM_CONFIG_USERCONFIG || process.env.npm_config_userconfig;
  if (!isTemporaryUserconfigPath(configured)) {
    fail('Stage review NPM_CONFIG_USERCONFIG must be a .npmrc beneath the system temporary directory.');
  }
}

function isolatedNpmEnvironment(root) {
  const userconfig = path.join(root, '.npmrc');
  return {
    NPM_CONFIG_USERCONFIG: userconfig,
    npm_config_userconfig: userconfig,
    NPM_CONFIG_REGISTRY: officialRegistry,
    NPM_CONFIG_DRY_RUN: 'false',
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_dry_run: 'false',
    npm_config_registry: officialRegistry,
  };
}

function assertAnonymous(env) {
  const result = runNpm(['whoami', '--registry', officialRegistry], { env, allowFailure: true });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0 || !/\bENEEDAUTH\b/iu.test(output)) {
    fail('Release verification is not demonstrably anonymous; npm whoami must fail with ENEEDAUTH.');
  }
}

function shaFile(filePath, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest('hex');
}

function sha512FromIntegrity(value) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(value || '');
  if (!match) fail('Public registry integrity is not a single SHA-512 digest.');
  const digest = Buffer.from(match[1], 'base64');
  if (digest.length !== 64) fail('Public registry SHA-512 integrity digest has an unexpected length.');
  return digest.toString('hex');
}

function normalizeTarEntries(output) {
  return output
    .split(/\r?\n/gu)
    .map((entry) => entry.trim().replace(/^\.\//u, ''))
    .filter((entry) => entry && !entry.endsWith('/'))
    .map((entry) => entry.startsWith('package/') ? entry.slice('package/'.length) : entry)
    .sort();
}

function sourcePackFiles(env = {}) {
  const result = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json'], {
    env: { ...env, NPM_CONFIG_DRY_RUN: 'false', npm_config_dry_run: 'false' },
  });
  const manifest = normalizePackManifest(parseJsonOutput(result.stdout, 'source npm pack --dry-run'));
  return manifest.files.map((file) => file.path.replace(/\\/gu, '/')).sort();
}

function assertSameFiles(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const unexpected = actual.filter((entry) => !expectedSet.has(entry));
    const missing = expected.filter((entry) => !actualSet.has(entry));
    fail(`${label} manifest mismatch; unexpected=${JSON.stringify(unexpected)}, missing=${JSON.stringify(missing)}`);
  }
}

function appendSummary(summaryFile, lines) {
  if (!summaryFile) return;
  fs.appendFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8');
}

async function safeRemoveTemp(root, prefix) {
  const resolvedRoot = path.resolve(root);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (path.dirname(resolvedRoot) !== resolvedTemp || !path.basename(resolvedRoot).startsWith(prefix)) {
    fail(`Refusing to remove unexpected temporary directory: ${resolvedRoot}`);
  }
  await fsp.rm(resolvedRoot, { recursive: true, force: true });
}

function validateReleaseToolchain() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 15) fail(`Release automation requires Node.js ^24.15.0; found ${process.versions.node}.`);
  const npmVersion = runNpm(['--version']).stdout.trim();
  if (npmVersion !== packageMetadata.devEngines?.packageManager?.version) {
    fail(`Release automation requires npm ${packageMetadata.devEngines?.packageManager?.version}; found ${npmVersion}.`);
  }
  return { node: process.versions.node, npm: npmVersion };
}

function assertChangelogEntry(version) {
  const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
  if (!new RegExp(`^## ${version.replace(/\./gu, '\\.')} - \\d{4}-\\d{2}-\\d{2}$`, 'mu').test(changelog)) {
    fail(`CHANGELOG.md does not contain a dated ${version} entry.`);
  }
}

async function preflight(options) {
  assertPackageIdentity(options.version);
  assertChangelogEntry(options.version);
  assertNoCredentialEnvironment();
  const toolchain = validateReleaseToolchain();
  const status = run('git', ['status', '--porcelain']).stdout.trim();
  if (status) fail('Preflight requires a clean worktree.');
  const sourceSha = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const remoteMainLine = run('git', ['ls-remote', '--heads', 'origin', 'main']).stdout.trim();
  const remoteMainSha = remoteMainLine.split(/\s+/u)[0];
  if (!remoteMainSha || sourceSha !== remoteMainSha) fail(`HEAD ${sourceSha} is not exact origin/main ${remoteMainSha || '(missing)'}.`);
  const localTag = run('git', ['tag', '--list', `v${options.version}`]).stdout.trim();
  const remoteTag = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${options.version}`, `refs/tags/v${options.version}^{}`]).stdout.trim();
  if (localTag || remoteTag) fail(`Release tag v${options.version} already exists.`);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-release-preflight-'));
  try {
    const env = isolatedNpmEnvironment(tempRoot);
    assertAnonymous(env);
    const view = runNpm(['view', `${packageMetadata.name}@${options.version}`, 'version', '--registry', officialRegistry], {
      env,
      allowFailure: true,
    });
    const viewOutput = `${view.stdout || ''}\n${view.stderr || ''}`;
    if (view.status === 0) fail(`${packageMetadata.name}@${options.version} already exists on npm.`);
    if (!/\bE404\b/iu.test(viewOutput)) fail(`Registry unused-version check failed ambiguously:\n${viewOutput}`);
    const distTagsValue = unwrapSingleNpmValue(parseJsonOutput(
      runNpm(['view', packageMetadata.name, 'dist-tags', '--json', '--registry', officialRegistry], { env }).stdout,
      'npm dist-tags',
    ));
    const files = sourcePackFiles(env);
    const result = {
      decision: 'ready-for-authorized-main-workflow-dispatch',
      package: `${packageMetadata.name}@${options.version}`,
      sourceSha,
      toolchain,
      registry: officialRegistry,
      registryTargetUnused: true,
      currentDistTags: distTagsValue,
      packEntryCount: files.length,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    appendSummary(options.summaryFile, [
      '### npm release preflight',
      '',
      `- Decision: \`${result.decision}\``,
      `- Package: \`${result.package}\``,
      `- Source: \`${sourceSha}\``,
      `- Pack entries: \`${files.length}\``,
      '- Registry target: unused (`E404`)',
    ]);
  } finally {
    await safeRemoveTemp(tempRoot, 'session-analyzer-release-preflight-');
  }
}

async function reviewStage(options) {
  assertPackageIdentity(options.version);
  assertNoCredentialEnvironment();
  assertTemporaryInteractiveUserconfig();
  validateReleaseToolchain();
  const sourceSha = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  if (sourceSha !== options.expectedSourceSha.toLowerCase()) {
    fail(`Checked-out source ${sourceSha} does not match expected source ${options.expectedSourceSha}.`);
  }
  if (run('git', ['status', '--porcelain']).stdout.trim()) fail('Stage review requires a clean source checkout.');
  const remoteMainLine = run('git', ['ls-remote', '--heads', 'origin', 'main']).stdout.trim();
  const remoteMainSha = remoteMainLine.split(/\s+/u)[0];
  if (!remoteMainSha || sourceSha !== remoteMainSha) fail(`Stage review source ${sourceSha} is not exact origin/main ${remoteMainSha || '(missing)'}.`);
  const whoami = runNpm(['whoami', '--registry', officialRegistry], { allowFailure: true });
  if (whoami.status !== 0) fail('review-stage requires a maintainer-controlled interactive npmjs.org login.');
  const stageValue = unwrapSingleNpmValue(parseJsonOutput(
    runNpm(['stage', 'view', options.stageId, '--json', '--registry', officialRegistry]).stdout,
    'npm stage view',
  ));
  const expectedStage = {
    packageName: packageMetadata.name,
    version: options.version,
    tag: 'latest',
    access: 'public',
    actorType: 'trusted automation',
  };
  for (const [key, expected] of Object.entries(expectedStage)) {
    if (stageValue?.[key] !== expected) fail(`Staged ${key} is ${JSON.stringify(stageValue?.[key])}, expected ${JSON.stringify(expected)}.`);
  }
  validateHex(stageValue.shasum, 40, 'staged SHA-1');

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-stage-review-'));
  try {
    runNpm(['stage', 'download', options.stageId, '--registry', officialRegistry], { cwd: tempRoot });
    const tarballs = (await fsp.readdir(tempRoot)).filter((entry) => entry.endsWith('.tgz'));
    if (tarballs.length !== 1) fail(`Expected one downloaded staged tarball, found ${tarballs.length}.`);
    const tarballPath = path.join(tempRoot, tarballs[0]);
    const sha1 = shaFile(tarballPath, 'sha1');
    const sha256 = shaFile(tarballPath, 'sha256');
    if (sha1 !== stageValue.shasum.toLowerCase()) fail('Downloaded staged tarball SHA-1 does not match npm stage metadata.');
    if (sha256 !== options.expectedSha256.toLowerCase()) fail('Downloaded staged tarball SHA-256 does not match the workflow candidate.');
    const tarEntries = normalizeTarEntries(run('tar', ['-tf', tarballPath]).stdout);
    const expectedFiles = sourcePackFiles();
    assertSameFiles(tarEntries, expectedFiles, 'staged tarball');
    const packedPackage = parseJsonOutput(run('tar', ['-xOf', tarballPath, 'package/package.json']).stdout, 'staged package.json');
    if (packedPackage.name !== packageMetadata.name || packedPackage.version !== options.version || packedPackage.repository?.url !== expectedRepository) {
      fail('Staged package.json identity does not match the release source.');
    }
    const result = {
      decision: 'ready-for-maintainer-webauthn-approval',
      package: `${packageMetadata.name}@${options.version}`,
      sourceSha,
      stageId: options.stageId,
      actor: stageValue.actor,
      actorType: stageValue.actorType,
      tag: stageValue.tag,
      entryCount: tarEntries.length,
      sha1,
      sha256,
      preApprovalProvenance: 'not-exposed-by-npm-stage-view; verify-public is a mandatory post-approval gate',
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await safeRemoveTemp(tempRoot, 'session-analyzer-stage-review-');
  }
}

function validateAttestationUrl(value, version) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') fail('Unexpected npm attestation URL origin.');
  if (url.pathname !== `/-/npm/v1/attestations/${packageMetadata.name}@${version}`) fail('Unexpected npm attestation URL path.');
  return url;
}

function decodeEnvelopePayload(entry) {
  const encoded = entry?.bundle?.dsseEnvelope?.payload;
  if (typeof encoded !== 'string') fail('Provenance DSSE payload is missing.');
  return parseJsonOutput(Buffer.from(encoded, 'base64').toString('utf8'), 'provenance DSSE payload');
}

function extractProvenance(attestationResponse) {
  const entry = attestationResponse?.attestations?.find((candidate) => candidate.predicateType === 'https://slsa.dev/provenance/v1');
  if (!entry) fail('Public SLSA v1 provenance attestation is missing.');
  return decodeEnvelopePayload(entry);
}

function validateProvenance(payload, options, tarballSha512) {
  const expectedSubject = `pkg:npm/${packageMetadata.name}@${options.version}`;
  const subject = payload?.subject?.find((candidate) => candidate.name === expectedSubject);
  if (!subject) fail(`Public provenance subject ${expectedSubject} is missing.`);
  if (subject.digest?.sha512 !== tarballSha512) {
    fail(`Public provenance SHA-512 ${JSON.stringify(subject.digest?.sha512)} does not match downloaded tarball SHA-512 ${tarballSha512}.`);
  }
  if (payload.predicateType !== 'https://slsa.dev/provenance/v1') fail('Unexpected provenance predicate type.');
  const definition = payload.predicate?.buildDefinition;
  const workflow = definition?.externalParameters?.workflow;
  if (workflow?.repository !== expectedWorkflowRepository || workflow?.path !== expectedWorkflowPath || workflow?.ref !== expectedWorkflowRef) {
    fail('Public provenance workflow identity does not match the trusted release workflow.');
  }
  const source = definition?.resolvedDependencies?.find((candidate) => candidate?.digest?.gitCommit);
  if (source?.digest?.gitCommit !== options.expectedSourceSha.toLowerCase()) fail('Public provenance source commit does not match the expected release commit.');
  const builder = payload.predicate?.runDetails?.builder?.id;
  if (builder !== 'https://github.com/actions/runner/github-hosted') fail('Public provenance builder is not GitHub-hosted Actions.');
  const invocation = payload.predicate?.runDetails?.metadata?.invocationId;
  if (typeof invocation !== 'string' || !invocation.startsWith(`${expectedWorkflowRepository}/actions/runs/`)) {
    fail('Public provenance invocation does not identify the expected GitHub repository.');
  }
  return {
    repository: workflow.repository,
    workflow: workflow.path,
    ref: workflow.ref,
    sourceCommit: source.digest.gitCommit,
    builder,
    invocation,
  };
}

function validateAttestationResponse(response, options, tarballSha512) {
  return validateProvenance(extractProvenance(response), options, tarballSha512);
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(url, predicate, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail(`Packaged server exited before verification with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const body = await response.text();
      if (await predicate(response, body)) return { response, body };
      lastError = new Error(`${url} returned ${response.status}: ${body.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fail(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    childProcess.spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function verifyPackagedServer(globalPrefix, tempRoot) {
  const projectDir = path.join(tempRoot, 'project');
  const codexHome = path.join(tempRoot, 'codex-home');
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '03');
  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'session_index.jsonl'), `${JSON.stringify({
    id: sessionId,
    thread_name: 'public release smoke',
    updated_at: '2026-08-03T00:00:01.000Z',
  })}\n`, 'utf8');
  const records = [
    {
      timestamp: '2026-08-03T00:00:00.000Z',
      type: 'session_meta',
      payload: { id: sessionId, cwd: projectDir, originator: 'release_public_smoke' },
    },
    {
      timestamp: '2026-08-03T00:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Verify the public package.' },
    },
  ];
  await fsp.writeFile(
    path.join(sessionDir, `rollout-2026-08-03T00-00-00-${sessionId}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
  const globalRoot = runNpm(['root', '--global', '--prefix', globalPrefix]).stdout.trim();
  const serverPath = path.join(globalRoot, packageMetadata.name, 'server.js');
  if (!fs.existsSync(serverPath)) fail(`Globally installed server is missing: ${serverPath}`);
  const port = await reservePort();
  const child = childProcess.spawn(process.execPath, [
    serverPath,
    '--repo', projectDir,
    '--codex-home', codexHome,
    '--host', '127.0.0.1',
    '--port', String(port),
  ], {
    cwd: tempRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHttp(`${baseUrl}/`, (response, body) => (
      response.status === 200 && body.includes('Session Analyzer') && body.includes('/assets/app.js')
    ), child);
    await waitForHttp(`${baseUrl}/api/state`, (response, body) => {
      if (response.status !== 200) return false;
      const value = parseJsonOutput(body, 'packaged /api/state');
      return Boolean(
        value
        && typeof value === 'object'
        && value.totals
        && Array.isArray(value.supportedLocales)
        && value.eventKinds
        && Array.isArray(value.codeModeRequests)
        && value.projectSelected === true,
      );
    }, child);
  } finally {
    await stopChild(child);
  }
}

async function verifyPublic(options) {
  assertPackageIdentity(options.version);
  assertNoCredentialEnvironment();
  const toolchain = validateReleaseToolchain();
  const sourceSha = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  if (sourceSha !== options.expectedSourceSha.toLowerCase()) fail(`Checked-out source ${sourceSha} does not match expected source ${options.expectedSourceSha}.`);
  if (run('git', ['status', '--porcelain']).stdout.trim()) fail('Public verification requires a clean source checkout.');

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-public-verify-'));
  try {
    const env = isolatedNpmEnvironment(tempRoot);
    assertAnonymous(env);
    const versionValue = unwrapSingleNpmValue(parseJsonOutput(
      runNpm(['view', `${packageMetadata.name}@${options.version}`, 'version', '--json', '--registry', officialRegistry], { env }).stdout,
      'npm exact-version metadata',
    ));
    if (versionValue !== options.version) fail(`Public registry returned version ${JSON.stringify(versionValue)}.`);
    const distTags = unwrapSingleNpmValue(parseJsonOutput(
      runNpm(['view', packageMetadata.name, 'dist-tags', '--json', '--registry', officialRegistry], { env }).stdout,
      'npm dist-tags',
    ));
    if (distTags?.latest !== options.version) fail(`Public latest is ${JSON.stringify(distTags?.latest)}, expected ${options.version}.`);
    const repository = unwrapSingleNpmValue(parseJsonOutput(
      runNpm(['view', `${packageMetadata.name}@${options.version}`, 'repository', '--json', '--registry', officialRegistry], { env }).stdout,
      'npm repository metadata',
    ));
    if (repository?.url !== expectedRepository) fail('Public repository metadata does not match package.json.');
    const dist = unwrapSingleNpmValue(parseJsonOutput(
      runNpm(['view', `${packageMetadata.name}@${options.version}`, 'dist', '--json', '--registry', officialRegistry], { env }).stdout,
      'npm dist metadata',
    ));
    validateHex(dist?.shasum, 40, 'public SHA-1');
    const attestationUrl = validateAttestationUrl(dist?.attestations?.url, options.version);

    const downloads = path.join(tempRoot, 'downloads');
    await fsp.mkdir(downloads);
    const packValue = parseJsonOutput(runNpm([
      'pack', `${packageMetadata.name}@${options.version}`, '--ignore-scripts', '--json', '--pack-destination', downloads,
      '--registry', officialRegistry,
    ], { env }).stdout, 'npm public pack');
    const pack = normalizePackManifest(packValue);
    const tarballPath = path.join(downloads, pack.filename);
    const sha1 = shaFile(tarballPath, 'sha1');
    const sha256 = shaFile(tarballPath, 'sha256');
    const sha512 = shaFile(tarballPath, 'sha512');
    if (sha1 !== dist.shasum.toLowerCase()) fail('Public tarball SHA-1 does not match registry metadata.');
    if (sha256 !== options.expectedSha256.toLowerCase()) fail('Public tarball SHA-256 does not match the staged workflow candidate.');
    if (sha512 !== sha512FromIntegrity(dist.integrity)) fail('Public tarball SHA-512 does not match registry integrity metadata.');
    const publicFiles = pack.files.map((file) => file.path.replace(/\\/gu, '/')).sort();
    assertSameFiles(publicFiles, sourcePackFiles(env), 'public tarball');

    const installDir = path.join(tempRoot, 'install');
    await fsp.mkdir(installDir);
    await fsp.writeFile(path.join(installDir, 'package.json'), `${JSON.stringify({
      name: 'session-analyzer-public-release-verification',
      version: '0.0.0',
      private: true,
    }, null, 2)}\n`, 'utf8');
    runNpm(['install', `${packageMetadata.name}@${options.version}`, '--ignore-scripts', '--no-fund', '--no-audit', '--registry', officialRegistry], {
      cwd: installDir,
      env,
    });
    const audit = runNpm(['audit', 'signatures', '--registry', officialRegistry], { cwd: installDir, env });
    if (!/verified attestation/iu.test(audit.stdout) || !/verified registry signatures/iu.test(audit.stdout)) {
      fail(`npm audit signatures did not report verified signatures and provenance:\n${audit.stdout}`);
    }

    const attestationResponse = await fetch(attestationUrl, { signal: AbortSignal.timeout(60000) });
    if (!attestationResponse.ok) fail(`Public attestation request failed with HTTP ${attestationResponse.status}.`);
    const provenance = validateAttestationResponse(await attestationResponse.json(), options, sha512);

    const npxDir = path.join(tempRoot, 'npx');
    await fsp.mkdir(npxDir);
    await fsp.writeFile(path.join(npxDir, 'package.json'), '{"private":true}\n', 'utf8');
    const npxHelp = run('npx', [
      '--yes', '--package', `${packageMetadata.name}@${options.version}`, '--registry', officialRegistry,
      packageMetadata.name, '--help',
    ], { cwd: npxDir, env });
    if (!npxHelp.stdout.includes('session-analyzer [--repo <repo-path>]')) fail('Exact-version npx help did not contain the expected usage.');

    const globalPrefix = path.join(tempRoot, 'global');
    await fsp.mkdir(globalPrefix);
    runNpm(['install', '--global', '--prefix', globalPrefix, `${packageMetadata.name}@${options.version}`, '--ignore-scripts', '--no-fund', '--no-audit', '--registry', officialRegistry], { env });
    const globalBin = process.platform === 'win32'
      ? path.join(globalPrefix, 'session-analyzer.cmd')
      : path.join(globalPrefix, 'bin', 'session-analyzer');
    const globalHelp = run(globalBin, ['--help'], { env });
    if (!globalHelp.stdout.includes('session-analyzer [--repo <repo-path>]')) fail('Global CLI help did not contain the expected usage.');
    await verifyPackagedServer(globalPrefix, tempRoot);

    const result = {
      decision: 'public-release-verified; tag-and-github-release-may-proceed',
      os: `${process.platform}-${process.arch}`,
      package: `${packageMetadata.name}@${options.version}`,
      sourceSha,
      toolchain,
      anonymousProof: 'ENEEDAUTH',
      latest: distTags.latest,
      previousNext: distTags.next || null,
      entryCount: publicFiles.length,
      sha1,
      sha256,
      provenance,
      signatures: 'verified',
      npx: 'passed',
      globalInstall: 'passed',
      packagedServer: 'root and /api/state passed',
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    appendSummary(options.summaryFile, [
      `### Public npm verification (${result.os})`,
      '',
      `- Decision: \`${result.decision}\``,
      `- Package: \`${result.package}\``,
      `- Source: \`${sourceSha}\``,
      `- SHA-256: \`${sha256}\``,
      `- Entries: \`${publicFiles.length}\``,
      `- Provenance workflow: \`${provenance.workflow}\` on \`${provenance.ref}\``,
      '- Anonymous npx/global install/CLI/server: passed',
      '- Registry signatures and provenance attestation: verified',
    ]);
  } finally {
    await safeRemoveTemp(tempRoot, 'session-analyzer-public-verify-');
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.command === 'preflight') return preflight(options);
  if (options.command === 'review-stage') return reviewStage(options);
  return verifyPublic(options);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  extractProvenance,
  isCredentialEnvironmentName,
  isTemporaryUserconfigPath,
  normalizePackManifest,
  normalizeTarEntries,
  parseOptions,
  sha512FromIntegrity,
  validateAttestationResponse,
  validateProvenance,
};
