import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { INGRESS_VERSION } from '../server/lib/contract.mjs';
import { parseIngressBody } from '../server/lib/ingress.mjs';
import { createTownServer } from '../server/townServer.mjs';

const PRIVATE = 'HT_PRIVATE_SENTINEL';
const PUBLIC_EVENT_KEYS = new Set([
  'cursor', 'id', 'seq', 'at', 'agentId', 'type', 'role', 'displayName',
  'district', 'action', 'tool', 'reason',
]);
const token = crypto.randomBytes(32).toString('base64url');
const key = 'h/main/0123456789abcdef';
const ingressEvent = { id: 'event_12345678', key, kind: 'spawned', role: 'coordinator' };
const body = { v: INGRESS_VERSION, events: [ingressEvent] };

assert.equal(parseIngressBody(JSON.stringify(body)).ok, true);
assert.equal(parseIngressBody(JSON.stringify({ ...body, prompt: PRIVATE })).ok, false);
assert.equal(parseIngressBody(JSON.stringify({
  ...body,
  events: [{ ...ingressEvent, prompt: PRIVATE }],
})).ok, false);

const temp = await mkdtemp(path.join(os.tmpdir(), 'hermes-town-server-contract-'));
const tokenFile = path.join(temp, 'bridge-token');
await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
await chmod(tokenFile, 0o600);
const town = createTownServer({
  token,
  journalPath: path.join(temp, 'journal.jsonl'),
  staticRoot: null,
  heartbeatSeconds: 60,
});

try {
  await assert.rejects(() => town.listen(0, '0.0.0.0'), /only binds to loopback/);
  const address = await town.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${base}/api/town/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(unauthorized.status, 401);

  const rejected = await fetch(`${base}/api/town/ingest`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, events: [{ ...ingressEvent, prompt: PRIVATE }] }),
  });
  assert.equal(rejected.status, 400);

  const accepted = await fetch(`${base}/api/town/ingest`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(accepted.status, 202);

  const snapshotResponse = await fetch(`${base}/api/town/snapshot`);
  assert.equal(snapshotResponse.status, 200);
  assert.equal(snapshotResponse.headers.get('access-control-allow-origin'), null);
  assert.match(snapshotResponse.headers.get('content-security-policy') ?? '', /connect-src 'self'/);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].agentId, key);
  assert.equal(JSON.stringify(snapshot).includes(PRIVATE), false);
  assert.equal(JSON.stringify(snapshot).includes(token), false);
  for (const name of Object.keys(snapshot.events[0])) {
    assert.equal(PUBLIC_EVENT_KEYS.has(name), true, `unexpected public event field: ${name}`);
  }

  const healthResponse = await fetch(`${base}/api/town/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  const healthText = JSON.stringify(health);
  assert.equal(healthText.includes(token), false);
  assert.equal(healthText.includes(temp), false);

  const childReport = await new Promise((resolve, reject) => {
    const child = spawn('python3', ['tests/emit-plugin-events.py'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERMES_TOWN_BRIDGE_URL: `${base}/api/town/ingest`,
        HERMES_TOWN_BRIDGE_TOKEN_FILE: tokenFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    // The report on stdout is the verdict. The interpreter's own exit status is
    // not: a daemon delivery thread can still be winding down at shutdown.
    child.once('close', code => {
      let report = null;
      try { report = JSON.parse(stdout.trim().split('\n').pop() ?? ''); } catch { report = null; }
      if (report && typeof report.ok === 'boolean') resolve(report);
      else reject(new Error(`plugin delivery produced no report (exit ${code}): ${stderr || stdout}`));
    });
  });
  assert.equal(childReport.ok, true);

  // The emitted session ends, so the present-town snapshot deliberately leaves
  // it out and says so; the journal still has it, which the incremental
  // snapshot (the polling fallback's view) shows.
  const deliveredSnapshot = await (await fetch(`${base}/api/town/snapshot`)).json();
  assert.ok(deliveredSnapshot.cursor > snapshot.cursor, 'delivery must advance the server cursor');
  assert.ok(deliveredSnapshot.omitted.departed >= 1, 'a departed session is omitted from the present-town snapshot');
  assert.equal(deliveredSnapshot.events.some((event) => event.agentId !== key), false, 'no departed resident in the present-town snapshot');
  const incremental = await (await fetch(`${base}/api/town/snapshot?since=${snapshot.cursor}&stream=${encodeURIComponent(snapshot.streamId)}`)).json();
  assert.ok(incremental.events.length > 0, 'the incremental snapshot replays the delivered events');
  assert.ok(incremental.events.some((event) => event.type === 'agent.departed'));
  for (const event of [...deliveredSnapshot.events, ...incremental.events]) {
    for (const name of Object.keys(event)) assert.equal(PUBLIC_EVENT_KEYS.has(name), true, `unexpected public event field: ${name}`);
  }
  const deliveredText = JSON.stringify(deliveredSnapshot) + JSON.stringify(incremental);
  assert.equal(deliveredText.includes('HT_DELIVERY_PRIVATE_SENTINEL'), false);
  assert.equal(deliveredText.includes(token), false);

  console.log(JSON.stringify({
    ok: true,
    unauthorizedIngest: 401,
    unknownField: 400,
    acceptedIngest: 202,
    publicEvents: incremental.events.length,
    omittedDeparted: deliveredSnapshot.omitted.departed,
    pluginDelivery: true,
    nonLoopbackBindRejected: true,
    privateSentinelAbsent: true,
    tokenAbsent: true,
  }));
} finally {
  await town.close();
  await rm(temp, { recursive: true, force: true });
}
