import Phaser from 'phaser';
import { TILE, T } from './art/tiles';
import { createDemoSource } from './live/demoSource';
import { createLiveSource } from './live/liveSource';
import type { Source } from './live/events';
import { TownScene } from './scenes/TownScene';
import { TownSim } from './sim/town';
import { PLACE_LABEL, type Place } from './sim/toolMap';
import { MAP_H, MAP_W, buildTownMap } from './world/map';


const params = new URLSearchParams(location.search);
const mode = params.get('agents') === 'demo' ? 'demo' : 'live';
const hourParam = params.get('hour');
const hour = hourParam !== null && Number.isFinite(Number(hourParam)) ? Number(hourParam) : null;

const map = buildTownMap();
const sim = new TownSim(map);
const source: Source = mode === 'demo' ? createDemoSource(sim) : createLiveSource(sim);

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const statusEl = $('#status');
const panel = $('#panel');
const followBtn = $<HTMLButtonElement>('#follow');
const minimap = $<HTMLCanvasElement>('#minimap');

let scene: TownScene | null = null;
let selectedId: string | null = null;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: Math.max(640, window.innerWidth),
  height: Math.max(360, window.innerHeight),
  pixelArt: true,
  fps: { forceSetTimeOut: true, target: 60 },
  roundPixels: true,
  backgroundColor: '#1a1620',
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [],
});
const fit = (): void => {
  const w = Math.max(320, window.innerWidth), h = Math.max(240, window.innerHeight);
  if (game.scale.width !== w || game.scale.height !== h) game.scale.resize(w, h);
};
window.addEventListener('resize', fit);
window.setInterval(fit, 1000);
game.scene.add('town', TownScene, true, {
  map,
  sim,
  hour,
  onSelect: (id: string | null) => { selectedId = id; renderPanel(); },
});
game.events.once("ready", () => { scene = game.scene.getScene("town") as TownScene; });
(window as unknown as { __town: unknown }).__town = { game, sim, map };
source.start();

// ------------------------------------------------------------------ HUD

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-goto]')) {
  btn.addEventListener('click', () => scene?.goTo(btn.dataset.goto!));
}
$('#overview').addEventListener('click', () => { scene?.overview(); renderStatus(); });
followBtn.addEventListener('click', () => {
  if (!scene) return;
  const on = !scene.isFollowing();
  if (on && !selectedId) {
    const first = sim.active()[0];
    if (first) scene.select(first.id);
  }
  scene.setFollow(on);
  followBtn.textContent = `Follow: ${scene.isFollowing() ? 'on' : 'off'}`;
  followBtn.classList.toggle('on', scene.isFollowing());
});

function ago(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function renderPanel(): void {
  const r = selectedId ? sim.residents.get(selectedId) : null;
  if (!r) { panel.hidden = true; return; }
  panel.hidden = false;
  const place = r.place ? PLACE_LABEL[r.place] : r.state === 'leaving' ? 'going home' : 'on the road';
  const rows: [string, string][] = [
    ['state', r.state],
    ['where', place],
    ['doing', r.bubble ?? (r.anim === 'sit' ? 'resting' : r.anim)],
    ['home', r.home.label],
    ['in town', ago(sim.now() - r.spawnedAt)],
    ['last event', `${ago(sim.now() - r.lastEventAt)} ago`],
    ['queued', String(r.queue.length)],
  ];
  panel.innerHTML = `
    <h3>${escapeHtml(r.name)}</h3>
    <div class="sub">${escapeHtml(r.title ?? (r.isChild ? 'subagent' : 'session'))} · ${escapeHtml(r.role)}</div>
    ${rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${escapeHtml(v)}</span></div>`).join('')}
    <ul>${r.history.map((h) => `<li><b>${escapeHtml(h.text)}</b> <span>${ago(sim.now() - h.at)} ago</span></li>`).join('')}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function renderStatus(): void {
  followBtn.textContent = `Follow: ${scene?.isFollowing() ? 'on' : 'off'}`;
  followBtn.classList.toggle('on', scene?.isFollowing() ?? false);
  const st = source.status();
  const active = sim.active();
  const resting = [...sim.residents.values()].filter((r) => r.state === 'resting').length;
  const working = active.filter((r) => r.state === 'working').length;
  const mains = active.filter((r) => !r.isChild).length;
  let text: string;
  if (mode === 'demo') {
    text = `scripted demo · ${mains} simulated sessions · ${active.length - mains} simulated helpers · ${working} working` + (resting ? ` · ${resting} resting` : '');
  } else {
    text = `live Hermes events · ${st}`;
    if (st === 'connected') text += ` · ${mains} sessions · ${active.length - mains} helpers · ${working} working` + (resting ? ` · ${resting} resting` : '');
    if (st === 'disconnected') text += ' · start the live server or open ?agents=demo';
  }
  statusEl.textContent = text;
  statusEl.className = `status ${mode === 'demo' ? 'demo' : st === 'connected' ? 'ok' : st === 'disconnected' ? 'bad' : ''}`;
}

// ------------------------------------------------------------- minimap

const base = document.createElement('canvas');
base.width = MAP_W; base.height = MAP_H;
{
  const c = base.getContext('2d')!;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const g = map.ground[y]![x]!;
    c.fillStyle = g === T.water || g === T.water2 || g === T.water3 ? '#2f5566'
      : g === T.cobble || g === T.cobble2 ? '#6f6a68'
      : g === T.path || g === T.path2 || g === T.bridge ? '#8a6a44'
      : g === T.trail || g === T.trail2 ? '#6f6a3e'
      : g === T.grassDry || g === T.grassDry2 || g === T.seed0 ? '#7a7a3c'
      : g === T.grassWet || g === T.grassWet2 || g === T.mudWet ? '#3f5a30'
      : g === T.ledge || g === T.cliff ? '#5a4a3e'
      : '#4f6b34';
    c.fillRect(x, y, 1, 1);
  }
  for (const p of map.props) if (p.kind === 'tree') { c.fillStyle = '#2f5228'; c.fillRect(Math.floor((p.x + 16) / TILE), Math.floor((p.y + 34) / TILE), 1, 1); }
  for (const b of [...map.buildings, ...map.homes]) { c.fillStyle = b.kind === 'house' ? '#6b3d2a' : '#c9b391'; c.fillRect(b.x, b.y, b.w, b.h); }
}
const mctx = minimap.getContext('2d')!;
mctx.imageSmoothingEnabled = false;
const scaleX = minimap.width / MAP_W, scaleY = minimap.height / MAP_H;

function renderMinimap(): void {
  mctx.clearRect(0, 0, minimap.width, minimap.height);
  mctx.drawImage(base, 0, 0, minimap.width, minimap.height);
  for (const r of sim.residents.values()) {
    mctx.fillStyle = r.id === selectedId ? '#ffd36b' : r.isChild ? '#c9b58f' : '#f3e6c9';
    mctx.fillRect(Math.round((r.x / TILE) * scaleX) - 1, Math.round((r.y / TILE) * scaleY) - 1, 3, 3);
  }
  if (scene) {
    const v = scene.getCameraRect();
    mctx.strokeStyle = 'rgba(255,255,255,0.7)';
    mctx.lineWidth = 1;
    mctx.strokeRect((v.x / TILE) * scaleX, (v.y / TILE) * scaleY, (v.w / TILE) * scaleX, (v.h / TILE) * scaleY);
  }
}
minimap.addEventListener('click', (e) => {
  const rect = minimap.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * MAP_W * TILE;
  const y = ((e.clientY - rect.top) / rect.height) * MAP_H * TILE;
  scene?.centerOn(x, y);
});

window.setInterval(() => { renderStatus(); renderPanel(); }, 500);
const loop = (): void => { renderMinimap(); requestAnimationFrame(loop); };
requestAnimationFrame(loop);

void PLACE_LABEL;
export type { Place };
