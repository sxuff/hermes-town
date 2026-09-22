#!/usr/bin/env node
// Developer fallback only: copy the reviewed payload; never enable/restart Hermes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, PLUGIN_FILES, verifyRuntime, walk } from './package-plugin.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--hermes-home' || arg.startsWith('--hermes-home=')) {
      const value = arg === '--hermes-home' ? argv[++index] : arg.slice('--hermes-home='.length);
      if (!value?.trim() || value.startsWith('-')) throw new Error('--hermes-home needs a non-empty path');
      options.home = value;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--force') throw new Error('--force is not supported: existing bridge tokens are always preserved');
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}
function exists(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function safePath(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    if (exists(current)?.isSymbolicLink()) throw new Error(`Symlink forbidden: ${current}`);
    if (path.dirname(current) === current) break;
  }
}
function managed(target) {
  if (exists(path.join(target, '.hermes-catalog.json'))) return true;
  const metadata = path.join(path.dirname(target), '.install-metadata.json');
  if (!exists(metadata)) return false;
  safePath(metadata);
  const value = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Hermes install metadata; refusing to overwrite');
  // Preserve every Hermes-managed installation, including exact-SHA git installs.
  return Object.hasOwn(value, 'hermes-town');
}
function payload(source) {
  safePath(source);
  for (const file of PLUGIN_FILES) {
    const stat = exists(path.join(source, file));
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`Plugin payload missing/unsafe: ${file}`);
  }
  verifyRuntime(path.join(source, 'runtime'));
  return [...PLUGIN_FILES, ...walk(path.join(source, 'runtime')).map((name) => `runtime/${name}`)];
}
function tokenPreflight(tokenPath) {
  safePath(tokenPath);
  const stat = exists(tokenPath);
  if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error('Bridge token must be a regular, non-hardlinked file');
}
function ensureToken(tokenPath) {
  tokenPreflight(tokenPath);
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(tokenPath), 0o700);
  let fd;
  let created = false;
  try {
    try {
      fd = fs.openSync(tokenPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      created = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      fd = fs.openSync(tokenPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    }
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unsafe bridge token');
    fs.fchmodSync(fd, 0o600);
    if (created) fs.writeFileSync(fd, `${crypto.randomBytes(32).toString('base64url')}\n`);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  return created ? 'created' : 'kept';
}
function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Developer fallback: node scripts/install-hermes-town-plugin.mjs [--hermes-home PATH]\nCopies the prebuilt plugin. Never enables, edits config, restarts, downloads, or rotates tokens.');
    return;
  }
  const rawHome = options.home ?? process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes');
  if (!rawHome.trim()) throw new Error('Hermes home must not be empty');
  const home = path.resolve(rawHome.replace(/^~(?=$|\/)/, os.homedir()));
  safePath(home);
  if (!exists(home)?.isDirectory()) throw new Error(`Hermes home does not exist or is not a directory: ${home}`);
  const target = path.join(home, 'plugins/hermes-town');
  safePath(target);
  const catalogManaged = managed(target);
  const source = catalogManaged ? target : path.join(ROOT, 'integrations/hermes-town-plugin');
  const files = payload(source); // Verify complete bundle BEFORE any target/token write.
  const token = path.join(home, 'hermes-town/runtime/bridge-token');
  tokenPreflight(token);
  if (!catalogManaged) {
    // Validate all existing destinations before copying even one file.
    for (const file of files) {
      const destination = path.join(target, file);
      safePath(destination);
      const stat = exists(destination);
      if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error(`Unsafe destination: ${file}`);
    }
    // Replace only the generated runtime, to remove obsolete hashed assets.
    const runtime = path.join(target, 'runtime');
    if (exists(runtime)) walk(runtime);
    fs.rmSync(runtime, { recursive: true, force: true });
    for (const file of files) {
      const destination = path.join(target, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      const bytes = fs.readFileSync(path.join(source, file));
      if (!exists(destination) || !fs.readFileSync(destination).equals(bytes)) fs.writeFileSync(destination, bytes, { mode: 0o644 });
    }
    payload(target);
  }
  const outcome = ensureToken(token);
  console.log(catalogManaged ? 'Hermes-managed plugin left untouched; bundled runtime verified.' : 'Prebuilt Hermes Town plugin installed (developer fallback).');
  console.log(`Bridge token ${outcome}, mode 0600; value not printed.`);
  console.log('No configuration changed; no plugin enabled; no process started or restarted.');
  console.log('\nNext, as the operator:\n  hermes plugins enable hermes-town\n  hermes town start\n  hermes town status');
  console.log('Start a new Hermes CLI session or explicitly restart the surface you want to observe.');
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
