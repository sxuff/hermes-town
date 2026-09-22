#!/usr/bin/env node
// Build-time only. Catalog installs consume these reviewed bytes without npm.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_FILES = ['README.md', '__init__.py', 'plugin.yaml', 'town_cli.py'];
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sorted = (entries) => Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const safeName = (name) => name.split('/').every((part) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part));
const staticFile = (name) => safeName(name) && /\.(?:html|js|css|png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf|ogg|mp3|wav)$/.test(name);
const allowed = (name) => name === 'LICENSE' || name === 'THIRD-PARTY-NOTICES.txt'
  || (name.startsWith('server/') && safeName(name) && name.endsWith('.mjs'))
  || (name.startsWith('dist/') && staticFile(name));

export function walk(dir, prefix = '') {
  const info = fs.lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Not a regular directory: ${dir}`);
  return fs.readdirSync(dir).sort().flatMap((name) => {
    const relative = prefix + name;
    const absolute = path.join(dir, name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlink forbidden: ${relative}`);
    if (stat.isDirectory()) return walk(absolute, `${relative}/`);
    if (!stat.isFile()) throw new Error(`Non-regular file forbidden: ${relative}`);
    return [relative];
  });
}

export function verifyRuntime(runtime) {
  const names = walk(runtime);
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || typeof manifest.version !== 'string'
      || !manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object'
      || !manifest.sources || typeof manifest.sources !== 'object') throw new Error('Invalid runtime manifest');
  const expected = Object.keys(manifest.files).sort();
  if (JSON.stringify(names.filter((name) => name !== 'manifest.json').sort()) !== JSON.stringify(expected)) {
    throw new Error('Runtime manifest file inventory mismatch');
  }
  for (const required of ['server/serve-live.mjs', 'server/townServer.mjs', 'dist/index.html', 'LICENSE', 'THIRD-PARTY-NOTICES.txt']) {
    if (!expected.includes(required)) throw new Error(`Runtime missing required file: ${required}`);
  }
  for (const name of expected) {
    if (!allowed(name) || !/^[a-f0-9]{64}$/.test(manifest.files[name])) throw new Error(`Invalid runtime entry: ${name}`);
    if (sha256(fs.readFileSync(path.join(runtime, name))) !== manifest.files[name]) throw new Error(`Runtime integrity mismatch: ${name}`);
  }
  return manifest;
}

function sourceInputs(root) {
  const names = ['package.json', 'package-lock.json', 'index.html', 'LICENSE', 'scripts/package-plugin.mjs'];
  for (const dir of ['src', 'public', 'server']) {
    for (const name of walk(path.join(root, dir))) names.push(`${dir}/${name}`);
  }
  names.push(...fs.readdirSync(root).filter((name) => /^(?:vite\.config\.|tsconfig.*\.json$)/.test(name)));
  return sorted(names.map((name) => {
    const file = path.join(root, name);
    if (!fs.lstatSync(file).isFile()) throw new Error(`Invalid source input: ${name}`);
    return [name, sha256(fs.readFileSync(file))];
  }));
}

function expectedBundle(root) {
  const files = new Map();
  for (const name of walk(path.join(root, 'server'))) {
    if (!safeName(name) || !name.endsWith('.mjs')) throw new Error(`Unexpected server input: ${name}`);
    files.set(`server/${name}`, fs.readFileSync(path.join(root, 'server', name)));
  }
  for (const name of walk(path.join(root, 'dist'))) {
    if (name.endsWith('.map')) continue;
    if (!staticFile(name)) throw new Error(`Unexpected dist input: ${name}`);
    files.set(`dist/${name}`, fs.readFileSync(path.join(root, 'dist', name)));
  }
  if (!files.has('dist/index.html')) throw new Error('Missing build: run npm run build first');
  files.set('LICENSE', fs.readFileSync(path.join(root, 'LICENSE')));
  const phaserLicense = fs.readFileSync(path.join(root, 'node_modules/phaser/LICENSE.md'), 'utf8').replace(/\r\n/g, '\n');
  const phaser = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/phaser/package.json'), 'utf8'));
  files.set('THIRD-PARTY-NOTICES.txt', Buffer.from(`Hermes Town code and original artwork: MIT; see LICENSE.\n\nPhaser ${phaser.version} (bundled in the prebuilt frontend)\nhttps://phaser.io/\n\n${phaserLicense}`));
  const manifest = {
    schemaVersion: 1,
    version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    files: sorted([...files].map(([name, bytes]) => [name, sha256(bytes)])),
    sources: sourceInputs(root),
  };
  return { files, manifest };
}

export function packagePlugin({ root = ROOT, check = false } = {}) {
  const runtime = path.join(root, 'integrations/hermes-town-plugin/runtime');
  const { files, manifest } = expectedBundle(root);
  if (check) {
    const existing = verifyRuntime(runtime);
    if (encode(existing) !== encode(manifest)) throw new Error('Packaged runtime is stale: source/build equality failed; run npm run build then node scripts/package-plugin.mjs');
    if (fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8') !== encode(manifest)) throw new Error('Runtime manifest is not canonical');
  } else {
    if (fs.existsSync(runtime)) walk(runtime); // Never follow a symlink during replacement.
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.mkdirSync(runtime, { recursive: true });
    for (const [name, bytes] of files) {
      const destination = path.join(runtime, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { mode: 0o644 });
    }
    fs.writeFileSync(path.join(runtime, 'manifest.json'), encode(manifest), { mode: 0o644 });
    verifyRuntime(runtime);
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/package-plugin.mjs [--check]');
    const manifest = packagePlugin({ check: process.argv.includes('--check') });
    console.log(`Runtime ${process.argv.includes('--check') ? 'verified' : 'packaged'}: v${manifest.version}, ${Object.keys(manifest.files).length} files; no downloads or install-time build.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
