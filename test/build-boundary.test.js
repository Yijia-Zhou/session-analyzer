'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const oldPublicScripts = [
  '/app.js',
  '/command-highlighting.js',
  '/event-chips.js',
  '/folding.js',
  '/highlight.js',
  '/navigation.js',
  '/renderers.js',
  '/search-controls.js',
];

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('browser runtime assets are generated and index loads only the bundle path', () => {
  const appBundle = path.join(repoRoot, 'public', 'assets', 'app.js');
  const appBundleMap = `${appBundle}.map`;
  assert.ok(fs.existsSync(appBundle), 'public/assets/app.js should exist after npm run build');
  assert.ok(fs.statSync(appBundle).size > 0, 'public/assets/app.js should not be empty');
  assert.equal(fs.existsSync(appBundleMap), false, 'public/assets/app.js.map should not be generated or committed');
  const appText = fs.readFileSync(appBundle, 'utf8');
  assert.equal(appText.includes('//# sourceMappingURL='), false, 'app bundle should not reference a source map');
  assert.ok(appText.split(/\r?\n/).length < 400, 'app bundle should be minified into a compact line count');
  assert.equal(appText.includes('function applyStaticLocale()'), false, 'app bundle should not retain unminified source function declarations');

  const index = readText(path.join('public', 'index.html'));
  assert.match(index, /src="\/vendor\/highlightjs\/highlight\.min\.js"/);
  assert.match(index, /src="\/assets\/app\.js"/);
  assert.doesNotMatch(index, /\.map(?:["?]|$)/);
  assert.match(index, /<html lang="en">/);
  assert.match(index, /Reading local sessions\.\.\./);
  assert.doesNotMatch(index, /正在读取本地 sessions/);
  for (const script of oldPublicScripts) {
    assert.doesNotMatch(index, new RegExp(`src="${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.equal(fs.existsSync(path.join(repoRoot, 'public', script.slice(1))), false, `${script} should not remain as public source`);
  }
});

test('client build script minifies without source maps', () => {
  const script = readText(path.join('scripts', 'build-client.js'));
  assert.match(script, /sourcemap:\s*false/);
  assert.match(script, /minify:\s*true/);
  assert.doesNotMatch(script, /app\.js\.map/);
});

test('source modules no longer depend on public as a source tree', () => {
  const sourceRoots = ['src', 'test', 'server.js', 'scripts'];
  const offenders = [];
  for (const sourceRoot of sourceRoots) {
    const absolute = path.join(repoRoot, sourceRoot);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    const files = stat.isDirectory()
      ? fs.readdirSync(absolute, { recursive: true }).map((file) => path.join(absolute, file))
      : [absolute];
    for (const file of files) {
      if (!fs.statSync(file).isFile() || !file.endsWith('.js')) continue;
      const text = fs.readFileSync(file, 'utf8');
      const publicSourcePath = '../' + 'public/';
      const singleQuotePublicRequire = 'require(' + `'${publicSourcePath}`;
      const doubleQuotePublicRequire = 'require(' + `"${publicSourcePath}`;
      if (text.includes(singleQuotePublicRequire) || text.includes(doubleQuotePublicRequire)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('codex logical builder stays a pure logical-construction boundary', () => {
  const logicalModule = require('../src/codex-logical');
  const text = readText(path.join('src', 'codex-logical.js'));
  const forbiddenPatterns = [
    /\brequire\s*\(/,
    /\bimport\s+/,
    /server\.js/,
    /src[\\/]browser/,
    /public[\\/]/,
    /assets[\\/]/,
    /node:fs/,
    /\bfs\./,
    /\breadFile\b/,
    /\bwriteFile\b/,
    /\bcreateReadStream\b/,
  ];

  assert.deepEqual(Object.keys(logicalModule), ['createCodexLogicalBuilder']);
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(text, pattern);
  }
});

test('codex detail builder stays a detail-construction boundary', () => {
  const detailModule = require('../src/codex-detail');
  const text = readText(path.join('src', 'codex-detail.js'));
  const codexText = readText(path.join('src', 'codex.js'));
  const forbiddenPatterns = [
    /\brequire\s*\(/,
    /\bimport\s+/,
    /server\.js/,
    /src[\\/]browser/,
    /public[\\/]/,
    /assets[\\/]/,
    /node:fs/,
    /\bfs\./,
    /\breadFile\b/,
    /\bwriteFile\b/,
    /\bcreateReadStream\b/,
  ];

  assert.deepEqual(Object.keys(detailModule), ['createCodexDetailBuilder']);
  assert.match(codexText, /createCodexDetailBuilder\(\{\s*envelope:\s*\{/);
  for (const group of ['sourceTrace', 'localization', 'sectionBuilders', 'sectionExtractors']) {
    assert.match(codexText, new RegExp(`\\n  ${group}: \\{`));
  }
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(text, pattern);
  }
});

test('source-neutral session query owns the shared search contract', () => {
  const queryModule = require('../src/session-query');
  const queryText = readText(path.join('src', 'session-query.js'));
  const compatibilityText = readText(path.join('src', 'codex-search.js'));
  const forbiddenPatterns = [
    /server\.js/,
    /src[\\/]browser/,
    /public[\\/]/,
    /assets[\\/]/,
    /node:fs/,
    /\bfs\./,
    /\breadFile\b/,
    /\bwriteFile\b/,
    /\bcreateReadStream\b/,
  ];

  assert.deepEqual(Object.keys(queryModule), [
    'createSessionQuery',
    'defaultDisplayProjectFile',
    'defaultEventKindCatalog',
    'defaultRawRef',
  ]);
  assert.match(compatibilityText, /require\('\.\/session-query'\)/);
  for (const token of [
    'codex',
    'code_mode_operation',
    'codeModeRequest',
    'codeModeRequests',
    'codeModeDeclaredRequests',
    'normalizeCodeModeRequest',
    'presentationIndexes',
    'defaultSourceKind',
    'jsonl_line',
  ]) {
    assert.doesNotMatch(queryText, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(queryText, pattern);
  }
});

test('server shared query routes do not depend on Codex ownership', () => {
  const serverText = readText('server.js');
  const adapterText = readText(path.join('src', 'source-adapters.js'));
  assert.doesNotMatch(serverText, /src[\\/]codex(?:\.js|['"])/);
  for (const token of [
    'code_mode_operation',
    'codeModeRequest',
    'codeModeDeclaredRequests',
    'normalizeCodeModeRequest',
    'codeModeRequests',
  ]) {
    assert.doesNotMatch(serverText, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(serverText, /queryForIndex\(index\)/);
  assert.match(adapterText, /function queryForIndex\(index\)/);
  assert.doesNotMatch(serverText, /require\s*\(\s*['"]\.\/src\/codex[-./\\'"]/);
});

test('runtime source configuration is registry-driven across server and browser', () => {
  const registry = require('../src/source-adapters');
  const serverText = readText('server.js');
  const browserText = readText(path.join('src', 'browser', 'app.js'));
  const indexText = readText(path.join('public', 'index.html'));

  assert.deepEqual(registry.supportedSourceOptions(), [
    { kind: 'codex', label: 'Codex', homeOption: 'codexHome', homeLabel: 'Codex home' },
    { kind: 'claude-code', label: 'Claude Code', homeOption: 'claudeHome', homeLabel: 'Claude home' },
  ]);
  assert.match(serverText, /sourceConfigs/);
  assert.match(serverText, /supportedSourceOptions\(\)/);
  assert.doesNotMatch(serverText, /state(?:\.(?:codexHome|claudeHome)\b|\[['"](?:codexHome|claudeHome)['"]\])/);
  assert.match(browserText, /sourceConfigs/);
  assert.match(browserText, /supportedSourceKindsForUi\(\)/);
  assert.match(browserText, /data-source-home/);
  assert.doesNotMatch(browserText, /state(?:\.(?:codexHome|claudeHome)\b|\[['"](?:codexHome|claudeHome)['"]\])/);
  assert.doesNotMatch(browserText, /project(?:Codex|Claude)HomeInput/);
  assert.match(indexText, /id="projectHomeFields"/);
  assert.doesNotMatch(indexText, /id="project(?:Codex|Claude)HomeInput"/);
});

test('Claude logical builder stays a pure source-specific construction boundary', () => {
  const logicalModule = require('../src/claude-logical');
  const text = readText(path.join('src', 'claude-logical.js'));
  const forbiddenPatterns = [
    /\brequire\s*\(/,
    /\bimport\s+/,
    /server\.js/,
    /src[\\/]browser/,
    /public[\\/]/,
    /assets[\\/]/,
    /node:fs/,
    /\bfs\./,
    /\breadFile\b/,
    /\bwriteFile\b/,
    /\bcreateReadStream\b/,
  ];

  assert.deepEqual(Object.keys(logicalModule), ['createClaudeLogicalBuilder']);
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(text, pattern);
  }
});

test('source adapter registry owns source dispatch without adding Claude branches to Codex builders', () => {
  const registry = require('../src/source-adapters');
  const codexLogical = readText(path.join('src', 'codex-logical.js'));
  const codexDetail = readText(path.join('src', 'codex-detail.js'));

  assert.deepEqual(registry.supportedSourceKinds(), ['codex', 'claude-code']);
  assert.equal(registry.requireSourceAdapter('codex').kind, 'codex');
  assert.equal(registry.requireSourceAdapter(registry.normalizeSourceKind('claude')).kind, 'claude-code');
  assert.doesNotMatch(codexLogical, /claude/i);
  assert.doesNotMatch(codexDetail, /claude/i);
});

test('strict adapter registry lookup rejects absent and non-canonical source ownership', () => {
  const registry = require('../src/source-adapters');

  assert.equal(registry.getSourceAdapter(undefined), null);
  assert.equal(registry.getSourceAdapter(' codex '), null);
  assert.throws(
    () => registry.requireSourceAdapter(undefined),
    { code: 'MISSING_SOURCE_OWNERSHIP' },
  );
  assert.throws(
    () => registry.requireSourceAdapter(' codex '),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.equal(registry.normalizeSourceKind(' Claude-Code '), 'claude-code');
  assert.equal(registry.requireSourceAdapter(registry.normalizeSourceKind(' Claude-Code ')).kind, 'claude-code');
});

test('source-specific builders remain isolated from the other transcript source', () => {
  for (const relativePath of [
    'src/codex.js',
    'src/codex-source.js',
    'src/codex-logical.js',
    'src/codex-detail.js',
  ]) {
    assert.doesNotMatch(readText(relativePath), /\bclaude(?:-code)?\b/i, relativePath);
  }
  for (const relativePath of [
    'src/claude.js',
    'src/claude-source.js',
    'src/claude-logical.js',
    'src/claude-detail.js',
  ]) {
    assert.doesNotMatch(readText(relativePath), /\bcodex\b/i, relativePath);
  }
});

test('canonical dispatch requires explicit ownership instead of normalizing missing values', () => {
  const adapterText = readText(path.join('src', 'source-adapters.js'));
  const queryBoundaryStart = adapterText.indexOf('function queryForIndex');
  const sessionBoundaryStart = adapterText.indexOf('function adapterForSession');
  const detailBoundaryStart = adapterText.indexOf('async function buildEventDetailForSession');
  const queryBoundary = adapterText.slice(queryBoundaryStart, sessionBoundaryStart);
  const sessionBoundary = adapterText.slice(sessionBoundaryStart, detailBoundaryStart);
  assert.match(
    adapterText,
    /function queryForIndex\(index\)[\s\S]*?requireExplicitSourceKind\(index\?\.sourceKind, 'index'\)/,
  );
  assert.match(
    adapterText,
    /function adapterForSession\(session\)[\s\S]*?requireExplicitSourceKind\(session\?\.sourceKind/,
  );
  assert.doesNotMatch(queryBoundary, /normalizeSourceKind/);
  assert.doesNotMatch(sessionBoundary, /normalizeSourceKind/);
});
