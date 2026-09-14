import { T, TILE } from './tiles';
import { mulberry } from './painter';
import type { TownMap } from '../world/map';

const WATER = new Set<number>([T.water, T.water2, T.water3, T.waterLily0, T.waterLily1, T.waterStone, T.bridge, T.plank]);
const PATH = new Set<number>([T.path, T.path2, T.pathEdge, T.pathGrassy, T.pathStones, T.pathMud, T.trail, T.trail2, T.trampled, T.soot, T.earth, T.earth2, T.mud, T.mudWet]);
const STONE = new Set<number>([T.cobble, T.cobble2, T.cobbleCracked, T.cobbleLeaves, T.cobbleMoss, T.cobbleWorn]);
const BANK = new Set<number>([T.shore, T.shoreGrass, T.reeds0, T.reeds1]);
const family = (tile: number) => WATER.has(tile) ? 3 : PATH.has(tile) ? 1 : STONE.has(tile) ? 2 : BANK.has(tile) ? 4 : 0;

/** The navigation grid stays discrete; the visible ground interpolates across it. */
export function paintTerrain(map: TownMap): HTMLCanvasElement {
  const w = map.grid.w * TILE * 2, h = map.grid.h * TILE * 2;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(w, h), d = pixels.data;
  const mask = new Uint8Array(w * h);
  const r = mulberry(72178);
  const kinds = map.ground.map(row => row.map(family));
  const get = (x: number, y: number) => kinds[Math.max(0, Math.min(map.grid.h - 1, y))]![Math.max(0, Math.min(map.grid.w - 1, x))]!;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = (x + Math.sin(y * 0.19) * 1.6) / (TILE * 2) - 0.5;
    const fy = (y + Math.sin(x * 0.17) * 1.6) / (TILE * 2) - 0.5;
    const tx = Math.floor(fx), ty = Math.floor(fy), u = fx - tx, v = fy - ty;
    const weights = [0, 0, 0, 0, 0];
    weights[get(tx, ty)]! += (1 - u) * (1 - v);
    weights[get(tx + 1, ty)]! += u * (1 - v);
    weights[get(tx, ty + 1)]! += (1 - u) * v;
    weights[get(tx + 1, ty + 1)]! += u * v;
    // Stochastic coverage breaks up the last few pixels of a material edge.
    const edgeNoise = (r() - 0.5) * 0.2;
    weights[0]! += edgeNoise;
    let kind = 0;
    for (let k = 1; k < 5; k++) if (weights[k]! > weights[kind]!) kind = k;
    // A narrow, irregular turf margin replaces the rectangular sand tiles.
    if (kind === 4) kind = weights[3]! > 0.08 ? 4 : 0;
    const grain = (r() - 0.5) * (kind === 3 ? 4 : 15);
    const broad = Math.sin(x * 0.027 + Math.sin(y * 0.018) * 2) * 7 + Math.sin(y * 0.043 + x * 0.011) * 6 + Math.sin(x * 0.31 + Math.sin(y * 0.25) * 2) * 3;
    const c = kind === 3 ? [36, 76, 88] : kind === 2 ? [90, 85, 70] : kind === 1 ? [141, 116, 73] : kind === 4 ? [94, 95, 61] : [72, 86, 43];
    const i = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = c[ch]! + grain + broad;
    d[i + 3] = 255; mask[y * w + x] = kind;
  }
  ctx.putImageData(pixels, 0, 0);
  // Irregular cobbles span tile boundaries. Each stone has its own mortar,
  // cool shadow, warm upper face, and occasional moss-filled joint.
  for (let y = 0, row = 0; y < h; y += 9, row++) {
    for (let x = row % 2 ? -6 : 0; x < w;) {
      const sw = 8 + Math.floor(r() * 7), sh = 6 + Math.floor(r() * 3);
      if (x >= 0 && mask[y * w + x] === 2) {
        const light = Math.floor(r() * 24);
        ctx.fillStyle = `rgb(${111 + light},${106 + light},${91 + light})`;
        ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + sw - 2, y);
        ctx.lineTo(x + sw, y + 1); ctx.lineTo(x + sw - 1, y + sh - 1);
        ctx.lineTo(x + 1, y + sh); ctx.lineTo(x, y + 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(224,205,163,.22)'; ctx.fillRect(x + 1, y, sw - 3, 1);
        if (r() < 0.13) { ctx.fillStyle = '#516044'; ctx.fillRect(x, y + sh, 2, 1); }
      }
      x += sw + 1;
    }
  }
  for (let i = 0; i < w * h / 14; i++) {
    const x = Math.floor(r() * w), y = Math.floor(r() * h), k = mask[y * w + x];
    if (k === 0) {
      ctx.fillStyle = r() < 0.5 ? '#71804a' : '#40592f';
      ctx.fillRect(x, y, 1, 1 + Math.floor(r() * 3));
      if (r() < 0.09) { ctx.fillStyle = ['#c4ae61', '#bcbfad', '#a86d82'][Math.floor(r() * 3)]!; ctx.fillRect(x, y - 1, 2, 2); }
    } else if (k === 1 && r() < 0.18) {
      ctx.fillStyle = r() < 0.5 ? '#af9b6d' : '#746342'; ctx.fillRect(x, y, 2, 1);
    } else if (k === 3 && r() < 0.25) {
      ctx.fillStyle = 'rgba(125,170,174,.24)'; ctx.fillRect(x, y, 2 + Math.floor(r() * 5), 1);
    } else if (k === 4 && r() < 0.4) {
      for (let j = 0; j < 4; j++) {
        ctx.strokeStyle = j % 2 ? '#82904b' : '#4a653d';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + j * 2 - 3, y - 8 - r() * 18); ctx.stroke();
      }
    }
  }
  return canvas;
}
