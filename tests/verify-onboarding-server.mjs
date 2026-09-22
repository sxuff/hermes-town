import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTownServer } from '../server/townServer.mjs';
import { INGRESS_VERSION } from '../server/lib/contract.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'town-onboarding-'));
const token = crypto.randomBytes(32).toString('base64url');
const managementToken = crypto.randomBytes(32).toString('base64url');
const journalPath = path.join(temp, 'journal.jsonl');
const auth = value => ({ authorization: `Bearer ${value}` });
let stopped = false;
let town = createTownServer({ token, journalPath, managementToken, onStop: () => { stopped = true; }, cronSeeds: [{key: 'h/cron/0123456789abcdef'}] });
try {
  let address = await town.listen(0);
  let base = `http://127.0.0.1:${address.port}`;
  const get = route => fetch(base + route).then(r => r.json());
  assert.deepEqual((await get('/api/town/health')).bridge, {receivedEvents: 0, lastEventAt: null}, 'cron seeds must not prove bridge delivery');
  assert.deepEqual((await get('/api/town/snapshot')).bridge, {receivedEvents: 0, lastEventAt: null});
  for (const secret of [null, token, 'incorrect']) {
    const headers = secret ? auth(secret) : {};
    assert.equal((await fetch(base + '/api/town/manage', {headers})).status, 401);
    assert.equal((await fetch(base + '/api/town/manage/stop', {method:'POST', headers})).status, 401);
  }
  assert.equal(stopped, false);
  assert.equal((await fetch(base + '/api/town/manage', {headers:auth(managementToken)})).status, 200);
  assert.equal((await fetch(base + '/api/town/manage/stop', {headers:auth(managementToken)})).status, 405);
  const body = {v: INGRESS_VERSION, events:[{id:'onboarding_event_123',key:'h/main/abcdef0123456789',kind:'spawned',role:'coordinator'}]};
  const send = b => fetch(base+'/api/town/ingest', {method:'POST',headers:{...auth(token),'content-type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await send({...body,secret:'not-allowed'})).status,400);
  assert.equal((await get('/api/town/health')).bridge.receivedEvents,0);
  assert.equal((await send(body)).status,202);
  let health = await get('/api/town/health');
  assert.equal(health.bridge.receivedEvents,1);
  assert.equal(typeof health.bridge.lastEventAt,'number');
  assert.equal((await get('/api/town/snapshot')).bridge.receivedEvents,1);
  await send(body);
  assert.equal((await get('/api/town/health')).bridge.receivedEvents,1, 'duplicates do not count twice');
  for (const route of ['/api/town/health','/api/town/snapshot']) {
    const text=JSON.stringify(await get(route));
    for(const secret of [token,managementToken,temp]) assert.equal(text.includes(secret),false);
  }
  assert.equal((await fetch(base+'/api/town/manage/stop',{method:'POST',headers:auth(managementToken)})).status,202);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(stopped,true);
  await town.close();
  town=createTownServer({token,journalPath});
  address=await town.listen(0); base=`http://127.0.0.1:${address.port}`;
  assert.deepEqual((await get('/api/town/health')).bridge,{receivedEvents:0,lastEventAt:null},'journal replay is not a fresh bridge event');
  assert.equal((await fetch(base+'/api/town/manage',{headers:auth(managementToken)})).status,404);
  console.log(JSON.stringify({ok:true,seedAndReplayHonesty:true,receivedOnlyAcceptedEvents:true,managementAuth:true,managementOptIn:true,secretsAbsent:true}));
} finally { await town.close(); await fs.rm(temp,{recursive:true,force:true}); }
