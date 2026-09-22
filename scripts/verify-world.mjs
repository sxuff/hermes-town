import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 5191, strictPort: true } });
await server.listen();
let browser;
try {
  const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim();
  const launchOptions = { headless: true };
  if (channel) launchOptions.channel = channel;
  if (executablePath) launchOptions.executablePath = executablePath;
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1672, height: 940 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5191/?agents=demo&hour=17');
  await page.waitForFunction(() => window.__town?.game.scene.getScene('town')?.textures.exists('art-tree0'));

  const audit = await page.evaluate(async () => {
    const { map, game } = window.__town;
    const scene = game.scene.getScene('town');
    const missingArt = map.props.filter(p => !scene.textures.exists(`art-${p.kind === 'tree' ? 'tree' + (p.variant ?? 0) % 6 : p.kind}`)).map(p => p.kind);
    const legacyTextures = ['tree0', 'bench', 'grave0', 'chicken', 'cat', 'duck', 'sheep', 'tiles'].filter(key => scene.textures.exists(key));
    const { findPath } = await import('/src/world/pathfind.ts');
    const { TownSim } = await import('/src/sim/town.ts');
    const { targetForTool } = await import('/src/sim/toolMap.ts');
    const buildings = [...map.buildings, ...map.homes];
    const targets = [...map.stations.map(s => ({ id: s.id, tile: s.tile })),
      ...buildings.flatMap(b => [{ id: b.id, tile: b.door }, ...b.porch.map((tile, i) => ({ id: `${b.id}-porch-${i}`, tile }))])];
    const unreachable = targets.filter(t => !findPath(map.grid, map.entrance, t.tile)).map(t => t.id);
    const occluded = map.stations.filter(s => buildings.some(b => s.tile.x >= b.x && s.tile.x < b.x + b.w && s.tile.y >= b.y && s.tile.y < b.y + b.h)).map(s => s.id);
    // Exercise the actual lifecycle on the grid: a tool call sends a runner to
    // the tool's building, the turn ends at the notice board and the door,
    // and a departed session sits down on its porch.
    const visits = [];
    for (const tool of ['read_file', 'write_file', 'terminal', 'discord', 'web_search', 'delegate_task', 'Read', 'Edit', 'Bash', 'unknown']) {
      const sim = new TownSim(map), agentId = `h/main/${tool.padEnd(16, '0').slice(0, 16)}`;
      sim.push({ id: '1', agentId, seq: 1, at: 0, type: 'agent.assigned', action: 'turn started' });
      sim.push({ id: '2', agentId, seq: 2, at: 0, type: 'agent.tool_started', tool });
      const resident = sim.residents.get(agentId);
      const runner = [...sim.residents.values()].find(r => r.kind === 'runner' && r.parentId === agentId);
      let arrived = false, returned = false;
      for (let i = 0; i < 3000 && runner; i++) {
        sim.update(0.05);
        if (runner.state === 'working' && runner.place === targetForTool(tool).place) arrived = true;
        if (arrived && (runner.state === 'handing' || runner.state === 'gone')) { returned = true; break; }
      }
      sim.push({ id: '3', agentId, seq: 3, at: sim.now(), type: 'agent.completed', action: 'turn completed' });
      let waited = false;
      for (let i = 0; i < 3000; i++) { sim.update(0.05); if (resident.state === 'waiting') { waited = true; break; } }
      sim.push({ id: '4', agentId, seq: 4, at: sim.now(), type: 'agent.departed' });
      for (let i = 0; i < 3000 && resident.state !== 'resting'; i++) sim.update(0.05);
      visits.push({ tool, runner: Boolean(runner), arrived, returned, waited, home: resident.state === 'resting' });
    }
    return { missingArt, legacyTextures, unreachable, occluded, targets: targets.length, buildings: map.buildings.length, homes: map.homes.length, visits };
  });
  assert.deepEqual(audit.missingArt, [], 'Every placed prop must have an atlas sprite');
  assert.deepEqual(audit.legacyTextures, [], 'No legacy environment or animal textures may be loaded');
  assert.deepEqual(audit.unreachable, [], 'Every station, doorway and porch must be reachable');
  assert.deepEqual(audit.occluded, [], 'No workstation may occupy a building footprint');
  assert.equal(audit.buildings, 7); assert.equal(audit.homes, 7);
  for (const visit of audit.visits) {
    assert.ok(visit.runner && visit.arrived && visit.returned, `${visit.tool}: a runner must reach the building and come back`);
    assert.ok(visit.waited, `${visit.tool}: the session must end its turn waiting at its door`);
    assert.ok(visit.home, `${visit.tool}: a departed session must sit on its porch`);
  }

  const zoom = () => page.evaluate(() => window.__town.game.scene.getScene('town').cameras.main.zoom);
  // The director owns the camera by default; the camera checks below are about manual control.
  await page.getByRole('button', { name: 'Director: on', exact: true }).click();
  await page.waitForFunction(() => !window.__town.game.scene.getScene('town').isDirector());
  await page.getByRole('button', { name: 'Town view', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const initialZoom = await zoom();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.waitForFunction(() => Math.abs(window.__town.game.scene.getScene('town').cameras.main.zoom - 2.5) < 0.01);
  await page.getByRole('button', { name: 'Town view', exact: true }).click();
  assert.ok(Math.abs(await zoom() - initialZoom) < 0.01);
  await page.getByRole('button', { name: 'Follow: off', exact: true }).click();
  await page.waitForFunction(() => window.__town.game.scene.getScene('town').isFollowing());
  await page.getByRole('button', { name: 'Town view', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__town.game.scene.getScene('town').isFollowing()), false);
  assert.equal(await page.locator('#follow').textContent(), 'Follow: off');
  await page.mouse.move(800, 450); await page.mouse.wheel(0, -300);
  await page.waitForFunction(z => window.__town.game.scene.getScene('town').cameras.main.zoom > z + 0.1, initialZoom);
  await page.getByRole('button', { name: 'Town view', exact: true }).click();

  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/world-overview.png' });
  for (const [name, x, y] of [['cemetery', 14.5, 32.5], ['market', 57, 37], ['library', 36, 28]]) {
    await page.evaluate(({x,y}) => { const s = window.__town.game.scene.getScene('town'); s.tweens.killTweensOf(s.cameras.main); s.cameras.main.panEffect.reset(); s.cameras.main.setZoom(3); s.cameras.main.centerOn(x * 16, y * 16); }, {x,y});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `output/playwright/world-${name}.png` });
  }
  await page.getByRole('button', { name: 'Town view', exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForFunction(() => Math.abs(window.__town.game.scene.getScene('town').cameras.main.zoom - Math.min(1366 / (90 * 16), 768 / (50 * 16))) < 0.01);
  await page.screenshot({ path: 'output/playwright/world-1366.png' });

  // Review every locomotion/work pose at readable scale, including atlas boundaries.
  await page.evaluate(async () => {
    const art = await import('/src/art/characters.ts');
    const source = art.paintCharacterSheet(art.lookFor('world-review', 'fabrication'));
    const canvas = document.createElement('canvas');
    const columns = 14, cellW = 80, cellH = 100;
    canvas.id = 'pose-review'; canvas.width = columns * cellW; canvas.height = Math.ceil(art.FRAME_COUNT / columns) * cellH;
    canvas.style.cssText = 'position:fixed;inset:20px auto auto 20px;z-index:9999;background:#66705c';
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < art.FRAME_COUNT; i++) {
      const x = i % columns * cellW, y = Math.floor(i / columns) * cellH;
      const fw = art.FRAME_W * art.CHARACTER_SCALE, fh = art.FRAME_H * art.CHARACTER_SCALE;
      const zoom = Math.min(64 / art.FRAME_W, 84 / art.FRAME_H);
      ctx.drawImage(source, (i % art.FRAME_COLUMNS) * fw, Math.floor(i / art.FRAME_COLUMNS) * fh, fw, fh, x + 8, y + 3, art.FRAME_W * zoom, art.FRAME_H * zoom);
      ctx.fillStyle = '#eee7d5'; ctx.font = '9px monospace'; ctx.fillText(String(i), x + 4, y + 98);
    }
    document.body.appendChild(canvas);
  });
  await page.locator('#pose-review').screenshot({ path: 'output/playwright/resident-poses.png' });
  await page.locator('#pose-review').evaluate(el => el.remove());

  await page.goto('http://127.0.0.1:5191/?agents=demo&hour=22');
  await page.waitForFunction(() => window.__town?.game.scene.getScene('town')?.textures.exists('art-tree0'));
  await page.screenshot({ path: 'output/playwright/world-night.png' });
  // Offline live mode must stay empty rather than substitute demo residents.
  await page.route('**/api/town/**', route => route.abort());
  await page.goto('http://127.0.0.1:5191/');
  await page.waitForFunction(() => window.__town?.game.scene.getScene('town')?.textures.exists('art-tree0'));
  assert.equal(await page.evaluate(() => window.__town.sim.residents.size), 0);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('disconnected'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...audit, camera: 'focus, follow, wheel, overview and resize passed', offlineLive: 'empty and disconnected', pageErrors: errors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
