#!/usr/bin/env node
// Start the Hermes Town live server.
//
//   npm run serve:live
// node server/serve-live.mjs [--port 4187] [--host 127.0.0.1|localhost|::1]
//                              [--token-file PATH] [--journal PATH]
//                              [--static dist] [--no-static]
//
// Defaults match the plugin's defaults, so an operator who ran the installer
// needs no flags at all. The bridge token is read once and never printed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer, loadToken } from './townServer.mjs';
import { cronSeedEntries, readEnabledJobIds } from './lib/cronSeed.mjs';

const root = path.resolve(import.meta.dirname, '..');

function defaultTokenPath() {
  const home = process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes');
  return path.join(home, 'hermes-town', 'runtime', 'bridge-token');
}

function defaultJobsPath() {
  const home = process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes');
  return path.join(home, 'cron', 'jobs.json');
}

function parseArgs(argv) {
  const options = {
    port: Number(process.env.HERMES_TOWN_PORT ?? 4187),
    host: process.env.HERMES_TOWN_HOST ?? '127.0.0.1',
    tokenFile: process.env.HERMES_TOWN_BRIDGE_TOKEN_FILE ?? defaultTokenPath(),
    journal: path.join(root, 'runtime', 'town-journal.jsonl'),
    staticRoot: path.join(root, 'dist'),
    heartbeatSeconds: 15,
    // Keepers for scheduled jobs stand at their posts from boot. On by
    // default when the scheduler's jobs file exists; --no-cron-seeds opts out.
    cronJobs: process.env.HERMES_TOWN_CRON_JOBS ?? defaultJobsPath(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case '--port': options.port = Number(value()); break;
      case '--host': options.host = value(); break;
      case '--token-file': options.tokenFile = path.resolve(value()); break;
      case '--journal': options.journal = path.resolve(value()); break;
      case '--static': options.staticRoot = path.resolve(value()); break;
      case '--no-static': options.staticRoot = null; break;
      case '--heartbeat-seconds': options.heartbeatSeconds = Number(value()); break;
      case '--cron-jobs': options.cronJobs = path.resolve(value()); break;
      case '--no-cron-seeds': options.cronJobs = null; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid --port: ${options.port}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log([
    'Usage: node server/serve-live.mjs [options]',
    '',
    '  --port N               Listen port (default 4187)',
    '  --host ADDR            Bind address (default 127.0.0.1)',
    '  --token-file PATH      Bridge token (default $HERMES_HOME/hermes-town/runtime/bridge-token)',
    '  --journal PATH         Durable journal (default runtime/town-journal.jsonl)',
    '  --static DIR           Built app to serve (default dist)',
    '  --no-static            API only',
    '  --heartbeat-seconds N  SSE heartbeat interval (default 15)',
    '  --cron-jobs PATH       Scheduler jobs file to seed keepers from',
    '                         (default $HERMES_HOME/cron/jobs.json)',
    '  --no-cron-seeds        Do not seed keepers for scheduled jobs',
  ].join('\n'));
  process.exit(0);
}

if (options.staticRoot !== null && !fs.existsSync(options.staticRoot)) {
  console.error(`Built app not found at ${options.staticRoot}. Run: npm run build`);
  process.exit(1);
}

let town;
let cronNote = 'off';
try {
  const token = loadToken(options.tokenFile);
  let cronSeeds = [];
  if (options.cronJobs !== null) {
    const jobs = readEnabledJobIds(options.cronJobs);
    if (jobs.ok && !jobs.absent) {
      cronSeeds = cronSeedEntries(token, jobs.ids);
      cronNote = `${cronSeeds.length} keepers from ${options.cronJobs}`
        + `${jobs.skipped ? `, ${jobs.skipped} entries skipped (disabled or malformed id)` : ''}`;
    } else if (jobs.ok) {
      cronNote = `no jobs file at ${options.cronJobs}`;
    } else {
      // A jobs file the town cannot parse is a silent no-op by design: the
      // scheduler is the authority, and the town must not fail to boot or
      // guess at entries it could not read.
      cronNote = `jobs file unreadable (${jobs.reason})`;
    }
  }
  town = createTownServer({
    token,
    journalPath: options.journal,
    staticRoot: options.staticRoot,
    heartbeatSeconds: options.heartbeatSeconds,
    cronSeeds,
  });
  await town.listen(options.port, options.host);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const origin = `http://${options.host}:${options.port}`;
const report = town.state.loadReport;
console.log('Hermes Town live server');
console.log(`  listening      ${origin}`);
console.log(`  town           ${origin}/?agents=live`);
console.log(`  ingest         POST ${origin}/api/town/ingest   (bearer token required)`);
console.log(`  snapshot       GET  ${origin}/api/town/snapshot  (public, read-only)`);
console.log(`  stream         GET  ${origin}/api/town/events    (public, read-only, SSE)`);
console.log(`  health         GET  ${origin}/api/town/health`);
console.log(`  journal        ${options.journal}`);
console.log(`  cron keepers   ${cronNote}`);
console.log(`  restored       ${report.restored} events${report.fresh ? ' (fresh journal)' : ''}`
  + `${report.malformedLines > 0 ? `, ${report.malformedLines} malformed lines skipped` : ''}`);
console.log(`  cursor         ${town.state.cursor}`);

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal}: closing live server`);
  try {
    await town.close();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
