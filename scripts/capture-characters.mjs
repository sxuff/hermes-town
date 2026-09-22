// Reproducible visual evidence. All activity in these captures is synthetic.
// Run after npm run build. Never connects to a Hermes live server.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';

const out='output/playwright/characters';
await mkdir(out,{recursive:true});
const dev=await createServer({server:{host:'127.0.0.1',port:5195,strictPort:true}});
await dev.listen();
const prod=await preview({preview:{host:'127.0.0.1',port:5196,strictPort:true}});
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/town/**',route=>route.abort());
  await page.goto('http://127.0.0.1:5195/');
  await page.waitForFunction(()=>window.__town?.game.scene.getScene('town')?.textures.exists('art-tree0'));
  const exported=await page.evaluate(async()=>{
    const a=await import('/src/art/characters.ts');
    const roles=['coordinator','research','fabrication','review','tooling','general','scheduled'];
    // Same bucket as the retained baseline audit for the coordinator comparison.
    const sheets=roles.map(role=>{const look=a.lookFor(role==='coordinator'?'coordinator-14':`preview-${role}`,role);return {role,look,png:a.paintCharacterSheet(look).toDataURL()};});
    const clips=[{name:'Idle',kind:'idle',facing:'down'},{name:'Walk / front',kind:'walk',facing:'down'},{name:'Walk / side',kind:'walk',facing:'left'},...a.WORK_STYLES.filter(s=>s!=='sit').map(style=>({name:style,kind:'work',style,facing:'left'})),{name:'Complete',kind:'reaction',reaction:'complete',facing:'down'},{name:'Failure',kind:'reaction',reaction:'fail',facing:'down'}];
    const samples=clips.map(clip=>({...clip,frames:Array.from({length:160},(_,tick)=>{
      const t=tick/20;
      if(clip.kind==='walk')return a.walkFrame(clip.facing,Math.floor(t*44/24*a.WALK_FRAME_COUNT));
      if(clip.kind==='work')return a.workFrame(clip.style,clip.facing,a.poseFrameAt('work',t,clip.style));
      // Pause between explicitly labeled repeated reaction samples.
      if(clip.kind==='reaction'){const local=t%3;return local<a.REACTION_DURATION?a.reactionFrame(clip.reaction,clip.facing,a.poseFrameAt('reaction',local,clip.reaction)):a.idleFrame(clip.facing,0);}
      return a.idleFrame(clip.facing,a.poseFrameAt('idle',t));
    })}));
    return {sheets,samples,meta:{frameWidth:a.FRAME_W,frameHeight:a.FRAME_H,scale:a.CHARACTER_SCALE,columns:a.FRAME_COLUMNS,count:a.FRAME_COUNT,baseline:a.CHARACTER_BASELINE,idleFrames:a.FACINGS.map(f=>a.idleFrame(f,0)),walkFrames:Array.from({length:a.WALK_FRAME_COUNT},(_,i)=>a.walkFrame('down',i))}};
  });
  for(const sheet of exported.sheets){await writeFile(`${out}/${sheet.role}.png`,Buffer.from(sheet.png.split(',')[1],'base64'));delete sheet.png;}
  await writeFile(`${out}/atlas-metadata.json`,JSON.stringify(exported,null,2));
  await page.goto('http://127.0.0.1:5196/?hour=17');
  await page.waitForFunction(()=>window.__town?.game.scene.getScene('town')?.textures.exists('art-tree0'));
  const fixture=await page.evaluate(()=>{
    const {sim,game,map}=window.__town,s=game.scene.getScene('town');sim.reset();s.setDirector(false);
    const id='h/main/000000000000cafe';
    sim.push({agentId:id,seq:1,at:0,type:'agent.assigned',role:'fabrication'});sim.settle();
    sim.push({agentId:id,seq:2,at:0,type:'agent.tool_started',tool:'write_file',role:'fabrication'});
    const runner=sim.runners()[0];
    for(let i=0;i<3000 && !(runner.state==='working' && runner.settleFacing===null);i++)sim.update(.05);
    s.update(0,0);s.cameras.main.setZoom(3);s.cameras.main.centerOn(runner.x,runner.y-28);s.select(runner.id);
    document.querySelector('#masthead').style.display='none';
    const label=document.createElement('div');label.id='capture-label';label.textContent='CHARACTER ANIMATION PREVIEW · scripted events, not live activity';label.style.cssText='position:fixed;top:18px;left:18px;z-index:99999;background:#211d24;color:#f1e6ce;padding:12px 16px;font:13px monospace;border:1px solid #655444';document.body.appendChild(label);
    return {id,runnerId:runner.id,state:runner.state,anim:runner.anim,place:runner.place,station:runner.station.id,mapBuildings:map.buildings.length};
  });
  assert.equal(fixture.state,'working');assert.equal(fixture.anim,'work');
  await page.waitForTimeout(150);
  await page.screenshot({path:`${out}/production-workshop.png`});
  await page.evaluate(()=>{const s=window.__town.game.scene.getScene('town');s.overview();});
  await page.waitForTimeout(100);
  await page.screenshot({path:`${out}/production-overview.png`});
  await page.evaluate(({id})=>{const {sim,game}=window.__town;sim.push({agentId:id,seq:3,at:sim.now(),type:'agent.completed'});const r=sim.residents.get(id),s=game.scene.getScene('town');s.cameras.main.setZoom(3);s.cameras.main.centerOn(r.x,r.y-20);s.select(id);},fixture);
  await page.waitForTimeout(200);
  await page.screenshot({path:`${out}/production-complete.png`});
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/capture-receipt.json`,JSON.stringify({source:'production build, explicit synthetic events',fixture,pageErrors:errors},null,2));
  console.log(JSON.stringify({out,...exported.meta,fixture,pageErrors:errors},null,2));
} finally {
  await browser?.close();await dev.close();
  await new Promise(resolve=>prod.httpServer.close(resolve));
}
