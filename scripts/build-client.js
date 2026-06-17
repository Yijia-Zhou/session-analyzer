#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');
const appEntry = path.join(repoRoot, 'src', 'browser', 'entry.js');
const vendorEntry = path.join(repoRoot, 'scripts', 'highlight-vendor-entry.js');
const appOutfile = path.join(repoRoot, 'public', 'assets', 'app.js');
const vendorOutfile = path.join(repoRoot, 'public', 'vendor', 'highlightjs', 'highlight.min.js');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function buildApp(outfile) {
  await fs.mkdir(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [appEntry],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: false,
    splitting: false,
    minify: true,
    logLevel: 'info',
  });
}

async function buildVendor(outfile) {
  await fs.mkdir(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [vendorEntry],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'sessionHighlightVendor',
    sourcemap: false,
    splitting: false,
    minify: true,
    logLevel: 'info',
  });
}

async function sameFile(left, right) {
  try {
    const [leftBytes, rightBytes] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
    return leftBytes.equals(rightBytes);
  } catch {
    return false;
  }
}

async function checkGeneratedAssets({ vendorOnly }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-build-'));
  try {
    const tempVendor = path.join(tempDir, 'highlight.min.js');
    await buildVendor(tempVendor);
    const stale = [];
    if (!(await sameFile(tempVendor, vendorOutfile))) stale.push(path.relative(repoRoot, vendorOutfile));

    if (!vendorOnly) {
      const tempApp = path.join(tempDir, 'app.js');
      await buildApp(tempApp);
      if (!(await sameFile(tempApp, appOutfile))) stale.push(path.relative(repoRoot, appOutfile));
    }

    if (stale.length) {
      throw new Error(`Generated assets are stale. Run npm run build. Stale: ${stale.join(', ')}`);
    }
    console.log('Generated assets are current.');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const vendorOnly = hasFlag('--vendor-highlight-only');
  const check = hasFlag('--check');
  if (check) {
    await checkGeneratedAssets({ vendorOnly });
    return;
  }
  await buildVendor(vendorOutfile);
  if (!vendorOnly) await buildApp(appOutfile);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
