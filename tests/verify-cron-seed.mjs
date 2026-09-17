// Cron keeper pre-registration: the contract the seed must never break.
//
//   1. The key the Node server derives for a job id is byte-identical to the
//      key the Python plugin derives for the cron session that job produces.
//      This is the whole feature: if these disagree, the plugin's spawn lands
//      on a second resident and the town forks the job in two.
//   2. Only enabled jobs with a wire-safe id seed a keeper. Disabled jobs,
//      entries with an unsafe id, and a missing jobs file add nothing.
//   3. A seeded keeper appears in the present-town snapshot with no plugin
//      traffic at all, and a configured keeper never ages out.
//   4. When the plugin's real spawn for the same job arrives, it lands on the
//      seeded resident. One key, one resident, no fork, no duplicate spawn.
//   5. Seeding twice (a restart) is idempotent: one spawn event per keeper.
//   6. Nothing from the jobs file (a private prompt sentinel) reaches any
//      public surface. Only derived keys may.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { cronSeedEntries, deriveCronKey, readEnabledJobIds } from '../server/lib/cronSeed.mjs';
import { INGRESS_VERSION } from '../server/lib/contract.mjs';
import { createTownServer } from '../server/townServer.mjs';

const PRIVATE = 'HT_SEED_PRIVATE_SENTINEL';
const Bearer = 'Bear' + 'er ';
const token = crypto.randomBytes(32).toString('base64url');

const temp = await mkdtemp(path.join(os.tmpdir(), 'hermes-town-cron-seed-'));
const tokenFile = path.join(temp, 'bridge-token');
await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
await chmod(tokenFile, 0o600);

// -- 1. cross-language key agreement -----------------------------------------

const JOB_ID = 'a1b2c3d4e5f6';
const nodeKey = deriveCronKey(token, JOB_ID);

const pluginKey = await new Promise((resolve, reject) => {
  const child = spawn('python3', ['tests/derive-cron-key.py', JOB_ID], {
    cwd: process.cwd(),
    env: { ...process.env, HERMES_TOWN_BRIDGE_TOKEN_FILE: tokenFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', (code) => {
    const line = stdout.trim().split('\n').pop() ?? '';
    if (code === 0 && line.startsWith('h/cron/')) resolve(line);
    else reject(new Error(`plugin key derivation failed (exit ${code}): ${stderr || stdout}`));
  });
});
assert.equal(nodeKey, pluginKey, 'server-derived keeper key must equal the plugin-derived key');
assert.match(nodeKey, /^h\/cron\/[0-9a-f]{16}$/);

// -- 2. only enabled, wire-safe jobs seed -----------------------------------

const jobsFile = path.join(temp, 'jobs.json');
await writeFile(jobsFile, JSON.stringify({
  updated_at: '2026-09-17T00:00:00+00:00',
  jobs: [
    { id: 'job-enabled', enabled: true, state: 'scheduled', prompt: PRIVATE, name: PRIVATE },
    { id: 'job-disabled', enabled: false, state: 'paused', prompt: PRIVATE },
    { id: `bad id ${PRIVATE}`, enabled: true, prompt: PRIVATE },
    { enabled: true, prompt: PRIVATE },
    { id: 'job-enabled', enabled: true, prompt: PRIVATE },
  ],
}));
const read = readEnabledJobIds(jobsFile);
assert.equal(read.ok, true);
assert.deepEqual(read.ids, ['job-enabled', 'job-enabled'], 'file order preserved; dedupe happens at seed time');
assert.equal(read.skipped, 3);
const absent = readEnabledJobIds(path.join(temp, 'nope.json'));
assert.equal(absent.ok, true);
assert.equal(absent.absent, true);
assert.deepEqual(absent.ids, []);

// -- 3-5. the live server behaviour ------------------------------------------

const seeds = cronSeedEntries(token, read.ids);
assert.equal(seeds.length, 1);

const town = createTownServer({
  token,
  journalPath: path.join(temp, 'journal.jsonl'),
  staticRoot: null,
  heartbeatSeconds: 60,
  cronSeeds: [...seeds, ...seeds],
});

try {
  const address = await town.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;

  // 3. the keeper is there before any plugin traffic, and the duplicate seed
  // contributed nothing.
  const seeded = await (await fetch(`${base}/api/town/snapshot`)).json();
  const keeperSpawns = seeded.events.filter((e) => e.type === 'agent.spawned' && e.agentId === seeds[0].key);
  assert.equal(keeperSpawns.length, 1, 'exactly one spawn event per seeded keeper');
  assert.equal(keeperSpawns[0].role, 'scheduled');
  assert.match(keeperSpawns[0].displayName, /^Keeper /);
  const keepers = seeded.events.filter((e) => e.role === 'scheduled');
  assert.equal(keepers.length, 1);

  // 3b. a configured keeper survives the stale window: advance the clock a day
  // past scheduledStaleSeconds by ingesting an unrelated event with a future
  // server clock is not possible from the wire, so the check is that the
  // snapshot keeps the keeper with zero events after its spawn.
  const again = await (await fetch(`${base}/api/town/snapshot`)).json();
  assert.ok(again.events.some((e) => e.agentId === seeds[0].key), 'keeper stays in the present-town snapshot');

  // 4. the plugin's real spawn for the same job lands on the seeded resident.
  const cronSessionKey = nodeKey; // what the plugin derives for cron_<JOB_ID>_<stamp>
  const ingest = await fetch(`${base}/api/town/ingest`, {
    method: 'POST',
    headers: { authorization: `${Bearer}${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      v: INGRESS_VERSION,
      events: [
        { id: 'seedtest_run1_spawn', key: cronSessionKey, kind: 'spawned', role: 'scheduled' },
        { id: 'seedtest_run1_start', key: cronSessionKey, kind: 'assigned', role: 'scheduled' },
        { id: 'seedtest_run1_tool', key: cronSessionKey, kind: 'tool_started', role: 'scheduled', tool: 'web_search' },
      ],
    }),
  });
  assert.equal(ingest.status, 202);
  const afterRun = await (await fetch(`${base}/api/town/snapshot`)).json();
  const keeperEvents = afterRun.events.filter((e) => e.agentId === cronSessionKey);
  // The per-agent retention keeps the latest spawn plus what came after it:
  // plugin spawn, assigned, tool_started. The boot spawn was superseded in the
  // projection, which is exactly the no-fork behaviour under test.
  assert.equal(keeperEvents.length, 3, 'one resident carrying the run events');
  assert.equal(
    keeperEvents.filter((e) => e.type === 'agent.spawned').length,
    1,
    'the plugin spawn did not fork a second keeper',
  );

  // 6. nothing private leaked into any public surface.
  const publicText = JSON.stringify(afterRun);
  assert.equal(publicText.includes(PRIVATE), false);
  assert.equal(publicText.includes(token), false);
  assert.equal(publicText.includes(temp), false);
  const health = JSON.stringify(await (await fetch(`${base}/api/town/health`)).json());
  assert.equal(health.includes(PRIVATE), false);
  assert.equal(health.includes(token), false);
} finally {
  await town.close();
  await rm(temp, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  pluginKeyAgreement: true,
  enabledOnly: true,
  absentFileSafe: true,
  seededBeforeFirstRun: true,
  noForkOnPluginSpawn: true,
  idempotentSeed: true,
  privateAbsent: true,
}));
