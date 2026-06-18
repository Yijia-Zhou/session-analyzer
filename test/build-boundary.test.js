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
  '/search-query.js',
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
