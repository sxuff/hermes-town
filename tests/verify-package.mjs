#!/usr/bin/env node
// All writes and running servers are isolated in disposable homes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, PLUGIN_FILES, packagePlugin, verifyRuntime, walk, sha256 } from '../scripts/package-plugin.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'town-package-'));
const source = path.join(ROOT, 'integrations/hermes-town-plugin');
const runtime = path.join(source, 'runtime');
let checks = 0;
function test(name, fn) { fn(); checks += 1; console.log(`PASS ${name}`); }
function copy(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); }
function inventory(dir) { return Object.fromEntries(walk(dir).map((name) => [name, sha256(fs.readFileSync(path.join(dir, name)))])); }
function run(home, extra = [], good = true, base = ROOT) {
  const result = spawnSync(process.execPath, [path.join(base, 'scripts/install-hermes-town-plugin.mjs'), '--hermes-home', home, ...extra], {
    cwd: tmp, env: { ...process.env, HERMES_HOME: home }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status === 0, good, result.stderr || result.stdout);
  return result;
}
function home(name) { const dir = path.join(tmp, name); fs.mkdirSync(dir); return dir; }
const tokenPath = (dir) => path.join(dir, 'hermes-town/runtime/bridge-token');
try {
  test('manifest integrity and current source/build equality', () => { verifyRuntime(runtime); packagePlugin({ check: true }); });
  test('deterministic rebuild', () => {
    const before = inventory(runtime); packagePlugin(); assert.deepEqual(inventory(runtime), before);
  });
  const isolated = path.join(tmp, 'payload');
  copy(source, path.join(isolated, 'integrations/hermes-town-plugin'));
  for (const name of ['install-hermes-town-plugin.mjs', 'package-plugin.mjs']) copy(path.join(ROOT, 'scripts', name), path.join(isolated, 'scripts', name));
  const h = home('fresh');
  const config = 'plugins:\n  enabled: []\n# PRIVATE TEST CONFIG\n';
  fs.writeFileSync(path.join(h, 'config.yaml'), config);
  test('isolated install needs neither repository sources nor node_modules', () => {
    assert(!fs.existsSync(path.join(isolated, 'node_modules')));
    assert(!fs.existsSync(path.join(isolated, 'package.json')));
    assert(!fs.existsSync(path.join(isolated, 'server')));
    const result = run(h, [], true, isolated);
    for (const command of ['hermes plugins enable hermes-town', 'hermes town start', 'hermes town status']) assert(result.stdout.includes(command));
    for (const name of PLUGIN_FILES) assert(fs.readFileSync(path.join(h, 'plugins/hermes-town', name)).equals(fs.readFileSync(path.join(source, name))));
    assert.deepEqual(verifyRuntime(path.join(h, 'plugins/hermes-town/runtime')), verifyRuntime(runtime));
    assert.equal(fs.readFileSync(path.join(h, 'config.yaml'), 'utf8'), config);
    assert.equal(fs.statSync(tokenPath(h)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(tokenPath(h))).mode & 0o777, 0o700);
    assert(!result.stdout.includes(fs.readFileSync(tokenPath(h), 'utf8').trim()));
  });
  test('idempotent install keeps token and config', () => {
    const token = fs.readFileSync(tokenPath(h)); const before = inventory(path.join(h, 'plugins'));
    fs.chmodSync(tokenPath(h), 0o644);
    run(h, [], true, isolated);
    assert(fs.readFileSync(tokenPath(h)).equals(token)); assert.equal(fs.statSync(tokenPath(h)).mode & 0o777, 0o600);
    assert.deepEqual(inventory(path.join(h, 'plugins')), before);
    assert.equal(fs.readFileSync(path.join(h, 'config.yaml'), 'utf8'), config);
  });
  for (const marker of ['catalog', 'metadata']) test(`${marker}-managed payload remains byte-for-byte untouched`, () => {
    const dir = home(marker); const target = path.join(dir, 'plugins/hermes-town'); copy(source, target);
    fs.appendFileSync(path.join(target, 'README.md'), '\nReviewed catalog README, not developer checkout.\n');
    if (marker === 'catalog') fs.writeFileSync(path.join(target, '.hermes-catalog.json'), '{"reviewed":true}\n');
    else fs.writeFileSync(path.join(dir, 'plugins/.install-metadata.json'), JSON.stringify({ 'hermes-town': { source: 'catalog', revision: 'a'.repeat(40) } }));
    const before = inventory(path.join(dir, 'plugins')); run(dir);
    assert.deepEqual(inventory(path.join(dir, 'plugins')), before);
  });
  test('invalid catalog bundle rejected before token creation without repairs', () => {
    const dir = home('invalid-catalog'); const target = path.join(dir, 'plugins/hermes-town'); copy(source, target);
    fs.writeFileSync(path.join(target, '.hermes-catalog.json'), '{}');
    fs.appendFileSync(path.join(target, 'runtime/dist/index.html'), 'tampered');
    const before = inventory(path.join(dir, 'plugins')); run(dir, [], false);
    assert(!fs.existsSync(tokenPath(dir))); assert.deepEqual(inventory(path.join(dir, 'plugins')), before);
  });
  test('tampered or missing source bundle rejected before token writes', () => {
    const dir = home('tampered'); const file = path.join(isolated, 'integrations/hermes-town-plugin/runtime/dist/index.html');
    const bytes = fs.readFileSync(file); fs.appendFileSync(file, 'tampered'); run(dir, [], false, isolated);
    assert(!fs.existsSync(tokenPath(dir))); fs.writeFileSync(file, bytes);
    fs.renameSync(file, `${file}.missing`); run(dir, [], false, isolated); assert(!fs.existsSync(tokenPath(dir))); fs.renameSync(`${file}.missing`, file);
  });
  test('missing argument values and obsolete force never write tokens', () => {
    const dir = home('args');
    for (const args of [['--hermes-home'], ['--hermes-home='], ['--hermes-home', '--force'], ['--force']]) run(dir, args, false);
    assert(!fs.existsSync(tokenPath(dir)));
  });
  test('token and parent symlinks rejected; outside bytes/permissions unchanged', () => {
    const outside = path.join(tmp, 'outside'); fs.writeFileSync(outside, 'unchanged', { mode: 0o644 });
    const dir = home('symlink'); fs.mkdirSync(path.dirname(tokenPath(dir)), { recursive: true }); fs.symlinkSync(outside, tokenPath(dir));
    run(dir, [], false); assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged'); assert.equal(fs.statSync(outside).mode & 0o777, 0o644);
    const other = home('parent-symlink'); fs.symlinkSync(dir, path.join(other, 'hermes-town')); run(other, [], false);
  });
  test('unexpected files, symlinks, and digest tampering rejected', () => {
    const bundle = path.join(tmp, 'bad-runtime'); copy(runtime, bundle);
    const privateFile = path.join(bundle, 'bridge-token'); fs.writeFileSync(privateFile, 'private'); assert.throws(() => verifyRuntime(bundle)); fs.unlinkSync(privateFile);
    fs.symlinkSync(path.join(bundle, 'LICENSE'), privateFile); assert.throws(() => verifyRuntime(bundle)); fs.unlinkSync(privateFile);
    fs.appendFileSync(path.join(bundle, 'LICENSE'), 'changed'); assert.throws(() => verifyRuntime(bundle));
  });
  test('source, server, config, and freshly-built UI drift rejected', () => {
    const fixture = path.join(tmp, 'build-fixture'); const manifest = verifyRuntime(runtime);
    for (const name of Object.keys(manifest.sources)) copy(path.join(ROOT, name), path.join(fixture, name));
    for (const name of ['dist', 'integrations/hermes-town-plugin/runtime', 'node_modules/phaser/LICENSE.md', 'node_modules/phaser/package.json']) copy(path.join(ROOT, name), path.join(fixture, name));
    packagePlugin({ root: fixture, check: true });
    for (const name of ['src/main.ts', 'server/townServer.mjs', 'vite.config.ts', 'dist/index.html']) {
      const file = path.join(fixture, name); const bytes = fs.readFileSync(file); fs.appendFileSync(file, '\n// source drift\n');
      assert.throws(() => packagePlugin({ root: fixture, check: true }), /stale/); fs.writeFileSync(file, bytes);
    }
    fs.symlinkSync(path.join(fixture, 'LICENSE'), path.join(fixture, 'dist/leak.txt')); assert.throws(() => packagePlugin({ root: fixture }), /Symlink/);
  });
  // Execute the installed Node-only server against the installed static files,
  // from a directory that has no repository or dependency tree.
  const installed = path.join(h, 'plugins/hermes-town/runtime');
  const { createTownServer } = await import(pathToFileURL(path.join(installed, 'server/townServer.mjs')));
  const town = createTownServer({ token: fs.readFileSync(tokenPath(h), 'utf8').trim(), journalPath: path.join(h, 'hermes-town/runtime/test-journal.jsonl'), staticRoot: path.join(installed, 'dist') });
  try {
    const address = await town.listen(0, '127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(origin); assert.equal(response.status, 200);
    assert.equal(await response.text(), fs.readFileSync(path.join(installed, 'dist/index.html'), 'utf8'));
    assert.equal((await fetch(`${origin}/api/town/health`)).status, 200);
    checks += 1; console.log('PASS installed dependency-free server serves real packaged UI and health');
  } finally { await town.close(); }
  console.log(`Package verification passed: ${checks} checks; temporary homes only.`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
