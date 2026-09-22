import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 5193, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/town/**', route => route.abort());
  await page.goto('http://127.0.0.1:5193/');
  await page.waitForFunction(() => window.__town?.game.scene.getScene('town')?.textures.exists('art-tree0'));
  const result = await page.evaluate(async () => {
    const art = await import('/src/art/characters.ts');
    const checks = [];
    const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
    const look = art.lookFor('character-regression', 'coordinator');
    const sheet = art.paintCharacterSheet(look);
    const frame = (index, source = sheet) => {
      const c = document.createElement('canvas'); c.width = art.FRAME_W; c.height = art.FRAME_H;
      const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      const columns = art.FRAME_COLUMNS ?? art.FRAME_COUNT;
      ctx.drawImage(source, (index % columns) * art.FRAME_W * art.CHARACTER_SCALE, Math.floor(index / columns) * art.FRAME_H * art.CHARACTER_SCALE, art.FRAME_W * art.CHARACTER_SCALE, art.FRAME_H * art.CHARACTER_SCALE, 0, 0, c.width, c.height);
      return { c, data: ctx.getImageData(0, 0, c.width, c.height).data };
    };
    const signature = index => Array.from(frame(index).data).join(',');
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const countColor = (data, color) => { const [r,g,b] = rgb(color); let n = 0; for(let i=0;i<data.length;i+=4) if(data[i]===r && data[i+1]===g && data[i+2]===b && data[i+3]) n++; return n; };
    const neutral = frame(art.idleFrame ? art.idleFrame('down', 0) : art.walkFrame('down', 0));
    const skin = rgb(look.skin), hands = [[], []];
    for (let y = Math.floor(art.FRAME_H * .5); y < art.FRAME_H; y++) for(let x=0; x<art.FRAME_W; x++) {
      const i=(y*art.FRAME_W+x)*4, a=neutral.data;
      if(a[i]===skin[0] && a[i+1]===skin[1] && a[i+2]===skin[2] && a[i+3]) {
        if(x < art.FRAME_W/2 - 3) hands[0].push(y);
        if(x >= art.FRAME_W/2 + 3) hands[1].push(y);
      }
    }
    check('neutral arms have equal hand baselines', hands.every(h=>h.length) && Math.max(...hands[0])===Math.max(...hands[1]), hands.map(h=>h.length?Math.max(...h):null));
    check('dedicated idle frame exists', typeof art.idleFrame==='function');
    check('walking has a full eight-phase cycle', art.WALK_FRAME_COUNT===8);
    const n = art.WORK_FRAME_COUNT ?? 2;
    for(const facing of ['left','down']) for(let i=0;i<n;i++) {
      const metal=countColor(frame(art.workFrame('hammer',facing,i)).data,'#8b9090')+countColor(frame(art.workFrame('hammer',facing,i)).data,'#b5b8b8');
      check(`hammer visible: ${facing} phase ${i}`,metal>0,metal);
    }
    for(const style of art.WORK_STYLES.filter(s=>s!=='sit')) for(const facing of ['left','down','up']) {
      const unique = new Set(Array.from({length:n},(_,i)=>signature(art.workFrame(style,facing,i)))).size;
      check(`readable distinct work poses: ${style}/${facing}`,unique>=3,unique);
    }
    check('completion and failure have body-frame API',typeof art.reactionFrame==='function');
    if(art.reactionFrame) for(const kind of ['complete','fail']) for(const facing of art.FACINGS) {
      const unique=new Set(Array.from({length:art.REACTION_FRAME_COUNT},(_,i)=>signature(art.reactionFrame(kind,facing,i)))).size;
      check(`${kind} body gesture: ${facing}`,unique>=3,unique);
    }
    check('sprite atlas fits conservative texture limit',sheet.width<=4096 && sheet.height<=4096,{width:sheet.width,height:sheet.height});
    const roles=['coordinator','research','fabrication','review','tooling','general','scheduled'];
    const clipped=[];
    for(const role of roles) {
      const source=art.paintCharacterSheet(art.lookFor(`bounds-${role}`,role));
      for(let i=0;i<art.FRAME_COUNT;i++) {
        const {data}=frame(i,source), w=art.FRAME_W,h=art.FRAME_H;
        let edge=false;
        for(let x=0;x<w;x++) if(data[x*4+3] || data[((h-1)*w+x)*4+3])edge=true;
        for(let y=0;y<h;y++) if(data[y*w*4+3] || data[(y*w+w-1)*4+3])edge=true;
        if(edge)clipped.push(`${role}:${i}`);
      }
    }
    check('all role/pose samples retain transparent clipping gutters',clipped.length===0,clipped);
    return { checks, dimensions:{width:art.FRAME_W,height:art.FRAME_H,count:art.FRAME_COUNT}, failed:checks.filter(x=>!x.pass) };
  });
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/character-regressions.json', JSON.stringify({ ...result, pageErrors: errors }, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, [], 'No page errors');
  assert.deepEqual(result.failed, [], 'Character regression checks');
} finally { await browser?.close(); await server.close(); }
