#!/usr/bin/env node
// Install the Hermes Town bridge plugin into an active Hermes home.
//
// This is the one step that touches anything outside this repository, and it
// only ever does three things: copy the plugin source, create the bridge token
// if it is missing, and print the exact commands an operator runs next.
//
// It deliberately does NOT enable the plugin, edit config.yaml, restart Hermes,
// or start the live server. Enabling a plugin that observes every tool call is
// an operator decision, not an installer's.
//
//   node scripts/install-hermes-town-plugin.mjs [--hermes-home PATH] [--force]
//
// Idempotent: running it twice copies the same files and leaves an existing
// token untouched. The token value is never printed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'integrations', 'hermes-town-plugin');

/** Exactly the files that make up the plugin. Nothing else is copied. */
const PLUGIN_FILES = ['plugin.yaml', '__init__.py', 'README.md'];

const PLUGIN_ID = 'hermes-town';
const TOKEN_BYTES = 32;

function parseArgs(argv) {
  const options = { home: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--hermes-home') {
      options.home = argv[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith('--hermes-home=')) {
      options.home = arg.slice('--hermes-home='.length);
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function resolveHome(explicit) {
  const raw = explicit ?? process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes');
  const resolved = path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Hermes home does not exist: ${resolved}\n`
      + 'Pass --hermes-home PATH or set HERMES_HOME to the profile you want to install into.',
    );
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Hermes home is not a directory: ${resolved}`);
  }
  return resolved;
}

/**
 * Copy one file only when its bytes differ, so a re-run is a no-op the
 * filesystem can confirm rather than a claim this script makes.
 */
function syncFile(from, to) {
  const next = fs.readFileSync(from);
  if (fs.existsSync(to)) {
    const current = fs.readFileSync(to);
    if (current.equals(next)) return 'unchanged';
    fs.writeFileSync(to, next, { mode: 0o644 });
    return 'updated';
  }
  fs.writeFileSync(to, next, { mode: 0o644 });
  return 'created';
}

/**
 * Create the shared secret if it is missing, and verify its permissions if it
 * is not. The value is never returned, printed, or logged.
 */
function ensureToken(tokenPath, force) {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(path.dirname(tokenPath), 0o700);
  } catch { /* a pre-existing directory we do not own is reported below */ }

  if (fs.existsSync(tokenPath) && !force) {
    const info = fs.statSync(tokenPath);
    if (!info.isFile()) throw new Error(`Bridge token path is not a regular file: ${tokenPath}`);
    if (info.mode & 0o077) {
      fs.chmodSync(tokenPath, 0o600);
      return 'tightened';
    }
    return 'kept';
  }
  // base64url of 32 random bytes: 43 characters, ~258 bits under the server's
  // conservative estimator, and safe in an HTTP header without quoting.
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  fs.chmodSync(tokenPath, 0o600);
  return force ? 'rotated' : 'created';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log([
      'Usage: node scripts/install-hermes-town-plugin.mjs [options]',
      '',
      '  --hermes-home PATH  Hermes home to install into.',
      '                      Defaults to $HERMES_HOME, then ~/.hermes.',
      '  --force             Rotate the bridge token instead of keeping it.',
      '',
      'Copies the plugin source and ensures the bridge token exists.',
      'Does not enable the plugin, edit config.yaml, or restart Hermes.',
    ].join('\n'));
    return;
  }

  for (const file of PLUGIN_FILES) {
    const from = path.join(source, file);
    if (!fs.existsSync(from)) throw new Error(`Plugin source file is missing: ${from}`);
  }

  const home = resolveHome(options.home);
  const target = path.join(home, 'plugins', PLUGIN_ID);
  fs.mkdirSync(target, { recursive: true, mode: 0o755 });

  const copied = PLUGIN_FILES.map((file) => ({
    file,
    outcome: syncFile(path.join(source, file), path.join(target, file)),
  }));

  const tokenPath = path.join(home, 'hermes-town', 'runtime', 'bridge-token');
  const tokenOutcome = ensureToken(tokenPath, options.force);

  console.log('Hermes Town bridge plugin installed.');
  console.log('');
  console.log(`  hermes home    ${home}`);
  console.log(`  plugin         ${target}`);
  for (const entry of copied) console.log(`                 ${entry.file} (${entry.outcome})`);
  console.log(`  bridge token   ${tokenPath} (${tokenOutcome}, mode 0600, value not printed)`);
  console.log('');
  console.log('Next, as the operator:');
  console.log('');
  console.log('  1. Validate the plugin against the real loader:');
  console.log(`       hermes plugins doctor ${target} --ci`);
  console.log('');
  console.log('  2. Enable it (opt-in; this is the step that starts observation):');
  console.log(`       hermes plugins enable ${PLUGIN_ID} --no-allow-tool-override`);
  console.log('       hermes plugins list');
  console.log('');
  console.log('  3. Start the Town live server on the same host, in this repository:');
  console.log('       npm run build');
  console.log('       npm run serve:live');
  console.log('');
  console.log('  4. Restart whatever Hermes surface will be observed, so the newly');
  console.log('     enabled plugin is loaded into that process:');
  console.log('       hermes gateway restart          # gateway');
  console.log('       # or simply start a new `hermes` CLI session');
  console.log('');
  console.log('  5. Open the live town:');
  console.log('       http://127.0.0.1:4187/');
  console.log('');
  console.log('To remove it again:');
  console.log(`       hermes plugins disable ${PLUGIN_ID}`);
  console.log(`       rm -rf ${target}`);
  console.log(`       rm -f  ${tokenPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
