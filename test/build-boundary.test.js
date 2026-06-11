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
  assert.ok(fs.existsSync(appBundle), 'public/assets/app.js should exist after npm run build');
  assert.ok(fs.statSync(appBundle).size > 0, 'public/assets/app.js should not be empty');

  const index = readText(path.join('public', 'index.html'));
  assert.match(index, /src="\/vendor\/highlightjs\/highlight\.min\.js"/);
  assert.match(index, /src="\/assets\/app\.js"/);
  for (const script of oldPublicScripts) {
    assert.doesNotMatch(index, new RegExp(`src="${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.equal(fs.existsSync(path.join(repoRoot, 'public', script.slice(1))), false, `${script} should not remain as public source`);
  }
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
