// Production-browser onboarding checks. All events are synthetic fixtures.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createTownServer } from '../server/townServer.mjs';
import { INGRESS_VERSION } from '../server/lib/contract.mjs';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'output/playwright/onboarding');
await fs.mkdir(output,{recursive:true});
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'town-ui-onboarding-'));
const token=crypto.randomBytes(32).toString('base64url');
const town=createTownServer({token,journalPath:path.join(temp,'journal.jsonl'),staticRoot:path.join(root,'dist'),cronSeeds:[{key:'h/cron/0123456789abcdef'}]});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
const receipts={syntheticActivity:true};
try {
  const {port}=await town.listen(0);
  const base=`http://127.0.0.1:${port}`;
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('waiting for first Hermes event'));
  assert.equal(await page.locator('#connection-help').isVisible(),true);
  await page.locator('#connection-help summary').click();
  assert.match(await page.locator('#connection-note').textContent(),/does not prove/);
  await page.screenshot({path:path.join(output,'waiting.png')});
  receipts.before=await page.locator('#status').textContent();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'waiting-mobile.png')});
  assert.equal(await page.evaluate(()=>document.querySelector('#masthead').getBoundingClientRect().right<=innerWidth),true);
  const ingest=await fetch(base+'/api/town/ingest',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({v:INGRESS_VERSION,events:[{id:'onboarding_browser_001',key:'h/main/1234567890abcdef',kind:'spawned',role:'coordinator'}]})});
  assert.equal(ingest.status,202);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Hermes events received'));
  assert.equal(await page.locator('#connection-help').isVisible(),false);
  receipts.after=await page.locator('#status').textContent();
  await page.setViewportSize({width:1280,height:800});
  await page.screenshot({path:path.join(output,'received.png')});
  await page.close();
  // Block transport in a fresh browser. No fallback residents or false success.
  const offline=await browser.newPage();
  offline.on('pageerror',e=>errors.push(e.message));
  await offline.route('**/api/**',route=>route.abort());
  await offline.goto(base);
  await offline.waitForFunction(()=>document.querySelector('#status').textContent.includes('disconnected'));
  assert.equal(await offline.evaluate(()=>window.__town.sim.residents.size),0);
  receipts.disconnected=await offline.locator('#status').textContent();
  await offline.screenshot({path:path.join(output,'disconnected.png')});
  await offline.close();
  // Older servers without bridge telemetry must report unknown, not infer delivery.
  const legacy=await browser.newPage();
  await legacy.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      constructor() { super(); setTimeout(() => { this.dispatchEvent(new Event('open')); this.dispatchEvent(new MessageEvent('hello', {data:'{}'})); }, 50); }
      close() {}
    };
  });
  await legacy.route('**/api/town/snapshot*',async route=>{const res=await route.fetch();const body=await res.json();delete body.bridge;await route.fulfill({json:body});});
  await legacy.goto(base, {waitUntil:'domcontentloaded'});
  await legacy.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('bridge status unknown'), null, {timeout:10000});
  receipts.legacyUnknown=true;
  await legacy.close();
  const demo=await browser.newPage();
  let apiCalls=0;
  demo.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/'))apiCalls++;});
  await demo.goto(base+'/?agents=demo');
  await demo.waitForFunction(()=>document.querySelector('#status').textContent.includes('scripted demo'));
  assert.equal(await demo.locator('#connection-help').isVisible(),false);
  assert.equal(apiCalls,0);
  receipts.demoApiRequests=apiCalls;
  assert.deepEqual(errors,[]);
  receipts.browserErrors=errors;
  receipts.ok=true;
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(receipts,null,2)+'\n');
  console.log(JSON.stringify(receipts));
} finally {await browser.close();await town.close();await fs.rm(temp,{recursive:true,force:true});}
