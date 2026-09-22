import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 5194, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  await page.route('**/api/town/**',route=>route.abort());
  await page.goto('http://127.0.0.1:5194/');
  await page.waitForFunction(()=>window.__town?.game.scene.getScene('town')?.textures.exists('art-tree0'));
  const result = await page.evaluate(async()=>{
    const { TownSim, STATION_SETTLE_SECONDS } = await import('/src/sim/town.ts');
    const art = await import('/src/art/characters.ts');
    const { residentPose, WALK_CYCLE_DISTANCE } = await import('/src/scenes/residentAnimation.ts');
    const map=window.__town.map, checks=[];
    const check=(name,pass,detail='')=>checks.push({name,pass:Boolean(pass),detail});
    const sim=new TownSim(map), id='h/main/0000000000001234';let seq=0;
    const emit=(type,extra={})=>sim.push({id:String(++seq),agentId:id,seq,at:sim.now(),type,role:'coordinator',...extra});
    emit('agent.assigned');
    const r=sim.residents.get(id);
    sim.update(.01);
    const before={x:r.x,y:r.y,d:r.walkDistance};sim.update(.05);
    const moved=Math.hypot(r.x-before.x,r.y-before.y);
    check('gait distance follows actual movement',moved>0 && Math.abs(r.walkDistance-before.d-moved)<1e-6,{moved,distance:r.walkDistance-before.d});
    const gait=residentPose({...r,anim:'walk',reaction:null,walkDistance:WALK_CYCLE_DISTANCE*.2},0);
    const delayed=residentPose({...r,anim:'walk',reaction:null,walkDistance:WALK_CYCLE_DISTANCE*.2},100);
    check('wall time cannot advance a stationary walk pose',gait.frame===delayed.frame);
    const frames=new Set(Array.from({length:8},(_,i)=>residentPose({...r,kind:'session',anim:'walk',reaction:null,walkDistance:WALK_CYCLE_DISTANCE*i/8},0).frame));
    check('distance drives all eight gait phases',frames.size===8,frames.size);
    // Every station arrival must stop, face its prop, then work without skating.
    emit('agent.tool_started',{tool:'write_file'});
    const runner=sim.runners()[0];
    for(let i=0;i<3000 && runner.state!=='working';i++)sim.update(.05);
    check('runner reaches the real work station',runner.state==='working' && runner.station?.place==='workshop');
    check('arrival holds a neutral pose before work',runner.anim==='stand' && runner.settleUntil>sim.now());
    const anchor={x:runner.x,y:runner.y,d:runner.walkDistance};
    sim.update(STATION_SETTLE_SECONDS*.55);
    check('turn occurs while planted',runner.facing===runner.station.facing && runner.anim==='stand' && runner.x===anchor.x && runner.y===anchor.y);
    sim.update(STATION_SETTLE_SECONDS*.5);
    check('work starts after settle without advancing gait',runner.anim==='work' && runner.walkDistance===anchor.d);
    const p=residentPose(runner,sim.now());
    check('working pose uses the authored work frame',p.frame===art.workFrame(runner.style,runner.facing,art.poseFrameAt('work',sim.now()-runner.workStartedAt,runner.style)));
    const reverse=residentPose({...runner,facing:'right'},sim.now());
    check('right-facing work mirrors left art only',reverse.flipX && !residentPose({...runner,facing:'left'},sim.now()).flipX);
    const seated = {...runner,anim:'sit',facing:'right',reaction:null,clock:3.15};
    const seatedPose = residentPose(seated,sim.now());
    check('right-facing seated pose mirrors authored left art',seatedPose.flipX);
    check('seated breathing uses its own hold and blink timing',seatedPose.frame===art.sitFrame('right',art.poseFrameAt('work',seated.clock,'sit')));
    // A tool error reacts on that runner, not the whole session.
    emit('agent.failed',{reason:'tool error'});
    check('observed tool failure gestures on its runner',runner.failed && runner.reaction==='fail' && r.reaction===null);
    const failPos={x:runner.x,y:runner.y,d:runner.walkDistance};sim.update(.2);
    check('failure gesture is planted, not walking in place',runner.x===failPos.x && runner.y===failPos.y && runner.walkDistance===failPos.d);
    sim.update(art.REACTION_DURATION);
    check('failure gesture expires',runner.reaction===null);
    emit('agent.completed');
    check('completion gesture requires a completion event',r.reaction==='complete');
    const receipt=sim.board.length;
    check('completion receipt exists before animation ends',receipt===1);
    const completeAt=r.reactionAt;
    sim.update(.2);
    sim.push({agentId:id,seq,at:sim.now(),type:'agent.completed'});
    check('duplicate completion does not replay the gesture',r.reactionAt===completeAt && sim.board.length===receipt);
    const completePose=residentPose(r,sim.now());
    check('renderer chooses event-driven body reaction',completePose.frame===art.reactionFrame('complete',r.facing,art.poseFrameAt('reaction',sim.now()-r.reactionAt,'complete')));
    emit('agent.assigned');
    check('new work interrupts stale completion gesture',r.reaction===null);
    // Silence is never success; fixture only, no real endpoint connected.
    const silent=new TownSim(map);
    silent.push({agentId:id,seq:1,at:0,type:'agent.assigned'});
    let fabricated=false;
    for(let i=0;i<200;i++){silent.update(.1);if(silent.residents.get(id).reaction==='complete')fabricated=true;}
    check('silence never invents a completion gesture',!fabricated && silent.board.length===0);
    // Exercise actual Phaser sheet registration and drawing, not just helper math.
    const live=window.__town.sim,scene=window.__town.game.scene.getScene('town');
    live.push({agentId:id,seq:1,at:0,type:'agent.assigned',role:'coordinator'});
    live.settle();scene.update(0,16);
    const actual=live.residents.get(id),view=scene.views.get(id);
    scene.syncView(view,actual);
    check('Phaser displays the production-selected frame',Number(view.sprite.frame.name)===residentPose(actual,live.now()).frame);
    check('sprite origin uses the shared foot baseline',Math.abs(view.sprite.originY-art.CHARACTER_BASELINE/art.FRAME_H)<1e-9);
    check('frame dimensions match the padded source grid',view.sprite.frame.width===art.FRAME_W*art.CHARACTER_SCALE && view.sprite.frame.height===art.FRAME_H*art.CHARACTER_SCALE);
    return {checks,failed:checks.filter(x=>!x.pass)};
  });
  await mkdir('output/playwright',{recursive:true});
  await writeFile('output/playwright/motion-regressions.json',JSON.stringify({...result,pageErrors:errors},null,2));
  console.log(JSON.stringify(result,null,2));
  assert.deepEqual(errors,[]);
  assert.deepEqual(result.failed,[],'Motion regression checks');
} finally {await browser?.close();await server.close();}
